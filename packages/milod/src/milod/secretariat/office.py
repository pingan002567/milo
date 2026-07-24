"""Office：秘书长的执行体——把分解/路由/派单/汇报/升级/验收串成闭环。

人事红线：本类只按已签署的 org.yaml 招募/请离，不做任何自主人事变动。
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import yaml

from milod.adapter.base import MemberSpec
from milod.adapter.subprocess_adapter import SubprocessAdapter
from milod.config.paths import artifacts_dir, org_dir, resolve_member_source
from milod.models import EventType, MiloEvent, Reach, TaskEnvelope, TaskState
from milod.pack.renderer import render
from milod.secretariat import acceptance
from milod.secretariat.decompose import Roster, build_prompt, parse_plan
from milod.secretariat.route import Candidate, NoMemberForTask, route
from milod.store.repo import Store


class Office:
    def __init__(self, org: str, *, on_event=None) -> None:
        self.org = org
        self.root = org_dir(org)
        self.store = Store(self.root / "milo.sqlite")
        self._adapters: dict[str, SubprocessAdapter] = {}
        self._specs: dict[str, MemberSpec] = {}
        self._pumps: dict[str, asyncio.Task] = {}  # member -> 事件泵
        self._busy: set[str] = set()
        self._last_summary: dict[str, str] = {}  # task_id -> 交付摘要（前递用）
        self._runs: dict[str, str] = {}          # task_id -> 当前 run_id
        self._on_event = on_event  # UI/CLI 回调

    def start_group(self, group_id: str, request: str, *, context: str = "") -> None:
        """开群：落标题 + 记录组长的原始需求（CLI 与 API 共用，避免两处逻辑漂移）。

        context（P0-1）：秘书与负责人对话中澄清出的约束/背景，随需求一起存进
        owner chat 事件的 metadata——分解时喂给模型，重试时也能一并捞回
        （text 进 content 作可见气泡，context 进 metadata 不污染气泡文本）。
        """
        self.store.ensure_group(group_id, title=short_title(request))
        payload: dict[str, Any] = {"text": request}
        if context.strip():
            payload["context"] = context.strip()
        self._emit(MiloEvent(
            group_id=group_id, type=EventType.CHAT, actor="owner", payload=payload))

    def sync_group_status(self, group_id: str) -> None:
        """按任务终局收口群状态：有待决→waiting，全终态→**review（待你确认）**。

        秘书的验收只是初筛（产物在不在、格式对不对）；"这活儿办得对不对"
        由用户确认才算终局（验收与返工设计 §一）——所以全终态不再直接归档。
        """
        tasks = self.store.tasks(group_id)
        if not tasks:
            return
        status = next((g["status"] for g in self.store.groups()
                       if g["group_id"] == group_id), None)
        if status == "failed":
            # failed 是粘性的，只有显式重试/返工能解除。否则"最后一步超时失败"
            # 会因为剩下的任务恰好都终态而被判成"全部完成，等你确认"——
            # 失败卡和重试入口一起消失，用户看到的是一个假的成功。
            return
        if any(t["state"] == "input_required" for t in tasks):
            self.store.set_group_status(group_id, "waiting")
        elif all(t["state"] in {"accepted", "rejected", "failed", "canceled"} for t in tasks):
            if status not in ("review", "archived"):
                self.store.enter_review(group_id)
                self._emit(MiloEvent(
                    group_id=group_id, type=EventType.SYSTEM, actor="secretariat",
                    reach=Reach.MENTION,
                    payload={"msg": "任务已完成，等你确认验收",
                             "awaiting_confirm": True}))
        else:
            self.store.set_group_status(group_id, "active")

    def _new_run(self, task_id: str) -> str:
        """开启一次新执行。assign 与每次 resume 各开一个 run，便于区分尝试与只回放最后一次。"""
        import uuid

        run_id = f"r-{uuid.uuid4().hex[:8]}"
        self._runs[task_id] = run_id
        return run_id

    # ---- 编制 ------------------------------------------------------------
    def _org_yaml(self) -> dict[str, Any]:
        f = self.root / "org.yaml"
        if not f.exists():
            raise FileNotFoundError(f"未初始化组织：{f}")
        return yaml.safe_load(f.read_text(encoding="utf-8"))

    def _bindings(self) -> dict[str, Any]:
        f = self.root / "bindings.yaml"
        return yaml.safe_load(f.read_text(encoding="utf-8")) if f.exists() else {}

    async def open(self) -> None:
        """按 org.yaml 招募全部已入组成员（调和：spec 是期望，此处落实为实例）。

        enrolled=False 的成员是"已招募待加入"——组长在组织页点「加入组织」
        （enroll_member）后才真正分配实例运行（人事红线：实例化也由用户触发）。
        """
        spec = self._org_yaml()["spec"]
        for m in spec.get("members", []):
            if m.get("enrolled", True):
                await self._spawn(m)

    async def enroll_member(self, name: str) -> MemberSpec:
        """热加载一名成员：无需重启 milod，渲染工作区 + 拉起子进程。

        前置：org.yaml 里已有该成员条目（招募已落编制）。幂等——已在运行则直接返回。
        """
        if name in self._specs:
            return self._specs[name]
        m = next((x for x in self._org_yaml()["spec"].get("members", [])
                  if x["name"] == name), None)
        if m is None:
            raise KeyError(f"成员 {name} 不在编制中")
        return await self._spawn(m)

    async def _spawn(self, m: dict[str, Any]) -> MemberSpec:
        """把一条编制记录落实为运行中的实例（open 与热加载共用）。"""
        binding = self._bindings()
        model = binding["model"]
        secrets = {model["secret_env"]: _read_secret(model["secret_env"])}
        member_spec = render(
            org_root=self.root,
            pack_dir=resolve_member_source(m),  # agent 引用（库）或旧式 pack 路径
            member_name=m["name"],
            model=model,
            secrets=secrets,
            # 实例自持配置（§3.5 修正）：能力/权限/描述以 org.yaml 快照为准，
            # 模板只是出厂来源；快照在则模板缺失也能拉起
            snapshot={k: m[k] for k in ("capabilities", "permissions", "description",
                                        "template_name", "slug") if k in m},
            extra_tools=[
                {"name": n, "group": "milo",
                 "use": f"milod.member_tools:{n}_tool"}
                for n in ("update_my_persona", "update_my_profile")
            ],
        )
        # 私聊全权通道（用户决策）：成员带自我修改工具，但工具内有线程门禁——
        # 只在 -dm 私聊线程可执行，任务线程调用直接拒绝（防注入驱动自改）
        import os as _os

        member_spec.extra_env = {
            "MILO_API_BASE": f"http://127.0.0.1:{_os.environ.get('MILO_PORT', '8899')}",
            "MILO_ORG": self.org,
            "MILO_MEMBER": m["name"],
        }
        adapter = SubprocessAdapter()
        await adapter.enroll(member_spec)
        self._adapters[m["name"]] = adapter
        self._specs[m["name"]] = member_spec
        self._pumps[m["name"]] = asyncio.create_task(self._pump(m["name"], adapter))
        self._emit(MiloEvent(
            group_id="org", type=EventType.SYSTEM, actor="system",
            payload={"msg": f"成员 {m['name']} 已加入", "capabilities": member_spec.capabilities},
        ))
        return member_spec

    async def dismiss_member(self, name: str, *, purge: bool = False) -> None:
        """停下一名成员的实例（停职/请离共用；人事红线：仅由用户经 API 触发）。

        purge=True（请离）连私有工作区一起销毁——"成果归组织、过程随实例销毁"：
        artifacts 在组织级目录不受影响，销毁的是成员的 home/threads/memory。
        该成员名下未终局的任务转 failed（member_dismissed），不留悬空等待。
        """
        import shutil

        pump = self._pumps.pop(name, None)
        if pump:
            pump.cancel()
        adapter = self._adapters.pop(name, None)
        self._specs.pop(name, None)
        self._busy.discard(name)
        if adapter:
            await adapter.dismiss()

        touched: set[str] = set()
        for t in self.store.tasks():
            if t["member"] == name and t["state"] in {
                "queued", "assigned", "working", "input_required",
            }:
                self.store.set_state(t["task_id"], TaskState.FAILED)
                self.store.set_stop_reason(t["task_id"], "member_dismissed")
                touched.add(t["group_id"])
        for gid in touched:
            self.sync_group_status(gid)

        if purge:
            shutil.rmtree(self.root / "members" / name, ignore_errors=True)
        self._emit(MiloEvent(
            group_id="org", type=EventType.SYSTEM, actor="system",
            payload={"msg": f"成员 {name} {'已请离（工作区已销毁）' if purge else '已停职（记忆保留，可复岗）'}",
                     "interrupted": sorted(touched)},
        ))

    def is_busy(self, name: str) -> bool:
        return name in self._busy

    async def recover(self) -> list[dict]:
        """崩溃恢复：把上次运行遗留的"运行中"任务重新接上（open() 之后调用）。

        成员侧 checkpointer 已保住上下文（thread_id 不变），所以恢复不是重跑，
        而是**接续**——按最后一条事件判断该怎么续：
          - 最后是 escalation → 其实已在等人，改判为 input_required（不必打扰成员）
          - 否则 → 重新 assign 同一信封，成员凭 checkpoint 从中断处继续
        """
        recovered: list[dict] = []
        for row in self.store.orphan_tasks():
            member = row["member"]
            if member not in self._adapters:
                self.store.set_state(row["task_id"], TaskState.FAILED)
                self.store.set_stop_reason(row["task_id"], "member_gone")
                continue

            events = self.store.group_events(row["group_id"])
            last = next((e for e in reversed(events) if e["task_id"] == row["task_id"]), None)
            if last and last["type"] == "escalation":
                # 崩溃前成员已请示，任务本就该等人——不必重启执行
                self.store.set_state(row["task_id"], TaskState.INPUT_REQUIRED)
                self.store.set_stop_reason(row["task_id"], "recovered_pending_reply")
                self.sync_group_status(row["group_id"])
                recovered.append({"task_id": row["task_id"], "action": "await_reply"})
                continue

            env = TaskEnvelope.model_validate_json(row["envelope"])
            self.store.set_stop_reason(row["task_id"], "recovered_resumed")
            self._emit(MiloEvent(
                group_id=row["group_id"], task_id=row["task_id"], type=EventType.SYSTEM,
                actor="system",
                payload={"msg": f"恢复中断的任务（第 {row['attempts'] + 1} 次执行）"}))
            self._busy.add(member)
            self.store.set_state(row["task_id"], TaskState.WORKING,
                                 run_id=self._new_run(row["task_id"]))
            await self._adapters[member].assign(env)
            recovered.append({"task_id": row["task_id"], "action": "resumed"})
        return recovered

    async def close(self) -> None:
        for t in self._pumps.values():
            t.cancel()
        for a in self._adapters.values():
            await a.dismiss()

    # ---- 任务 ------------------------------------------------------------
    def roster(self) -> Roster:
        return Roster([(n, list(s.capabilities)) for n, s in self._specs.items()])

    def plan_prompt(self, request: str, *, context: str = "") -> str:
        return build_prompt(request, self.roster(), context=context)

    def parse_plan(self, text: str, group_id: str) -> list[TaskEnvelope]:
        return parse_plan(text, self.roster(), group_id=group_id)

    async def dispatch(self, envelopes: list[TaskEnvelope], group_id: str) -> list[str]:
        """派单一批任务（同批视为可并行）。无人能接则抛 NoMemberForTask（回问组长）。

        v0 无 DAG：多步计划由调用方逐步派发并前递产物（见 CLI 的顺序执行），
        本方法只负责把给定批次派出去。
        """
        assigned: list[str] = []
        self.store.ensure_group(group_id)
        for env in envelopes:
            member = route(env, self._candidates(), busy=self._busy)
            self.store.upsert_task(env, group_id=group_id, member=member, state=TaskState.ASSIGNED)
            self._emit(MiloEvent(
                group_id=group_id, task_id=env.task_id, type=EventType.ENVELOPE,
                actor="secretariat",
                payload={"member": member, "objective": env.objective,
                         "output": env.output_spec.model_dump(), "constraints": env.constraints},
            ))
            self._busy.add(member)
            # 状态必须在 await 之前置为 WORKING：worker 的 assign 会同步跑完整个事件流，
            # 返回时 _pump 可能已把状态推进到 INPUT_REQUIRED/DELIVERED——之后再写 WORKING 会覆盖终局。
            run_id = self._new_run(env.task_id)
            self.store.set_state(env.task_id, TaskState.WORKING, run_id=run_id)
            await self._adapters[member].assign(env)
            assigned.append(member)
        return assigned

    async def dm(self, name: str, text: str,
                 *, attachments: list[dict] | None = None) -> None:
        """老板私聊成员（全权调教通道）：独立线程、共享实例记忆，不承载任务。

        attachments：把资料注入该私聊线程的 uploads 目录，成员可 read_file 读。
        """
        if name not in self._adapters:
            raise KeyError(f"成员 {name} 不在运行中——先让其加入")
        gid = f"dm-{name}"
        self.store.ensure_group(gid, title=f"私聊 · {name}")
        self._emit(MiloEvent(
            group_id=gid, type=EventType.CHAT, actor="owner",
            payload={"text": text, "attachments": attachments or []}))
        await self._adapters[name].chat(text, group_id=gid, channel="dm",
                                        attachments=attachments)

    async def reset_dm(self, member: str) -> None:
        """重置某成员私聊：清空对话历史（记忆型人设不变，只清对话线程）。"""
        if member in self._adapters:
            await self._adapters[member].reset("dm")
            gid = f"dm-{member}"
            self._emit(MiloEvent(
                group_id=gid, type=EventType.SYSTEM, actor="system",
                payload={"msg": "对话已重置", "reset": True}))

    async def cancel(self, member: str, task_id: str) -> None:
        """停止某成员当前回合（私聊或任务）。"""
        if member in self._adapters:
            await self._adapters[member].cancel(task_id)
            self._busy.discard(member)

    async def reply(self, task_id: str, answer: str) -> None:
        """组长答复被中断的任务 → resume 接续。"""
        row = next((t for t in self.store.tasks() if t["task_id"] == task_id), None)
        if not row:
            raise KeyError(f"未知任务 {task_id}")
        member = row["member"]
        self._emit(MiloEvent(
            group_id=row["group_id"], task_id=task_id, type=EventType.CHAT,
            actor="owner", payload={"text": answer},
        ))
        self.store.set_state(task_id, TaskState.WORKING, run_id=self._new_run(task_id))
        self._busy.add(member)
        await self._adapters[member].resume(task_id, answer, group_id=row["group_id"])

    def last_delivery(self, task_id: str) -> dict[str, Any] | None:
        """取某任务的交付事件负载（供产物前递给下一步）。"""
        row = next((t for t in self.store.tasks() if t["task_id"] == task_id), None)
        if not row:
            return None
        for e in reversed(self.store.group_events(row["group_id"])):
            if e["task_id"] == task_id and e["type"] in {"delivery", "acceptance"}:
                return e["payload"]
        return None

    async def collect(self, task_id: str) -> acceptance.Verdict:
        """取交付物并按 output_spec 验收。"""
        row = next(t for t in self.store.tasks() if t["task_id"] == task_id)
        env = TaskEnvelope.model_validate_json(row["envelope"])
        delivery = await self._adapters[row["member"]].deliver(task_id)
        self._last_summary[task_id] = delivery.summary
        verdict = acceptance.check(env, delivery)
        self.store.set_state(task_id, TaskState.ACCEPTED if verdict.accepted else TaskState.REJECTED)
        self._emit(MiloEvent(
            group_id=row["group_id"], task_id=task_id, type=EventType.ACCEPTANCE,
            actor="secretariat",
            payload={"verdict": verdict.summary,
                     "artifacts": [a.model_dump() for a in delivery.artifacts]},
        ))
        return verdict

    # ---- 内部 ------------------------------------------------------------
    def _candidates(self) -> list[Candidate]:
        return [Candidate(n, tuple(s.capabilities)) for n, s in self._specs.items()]

    async def _pump(self, member: str, adapter: SubprocessAdapter) -> None:
        async for ev in adapter.events():
            if ev.group_id.startswith("dm-"):
                # 私聊语境：交付/请示都是"成员说话"，没有任务状态机
                if ev.type in (EventType.DELIVERY, EventType.ESCALATION):
                    text = str(ev.payload.get("summary")
                               or ev.payload.get("question") or "").strip()
                    if text:
                        payload: dict[str, Any] = {"text": text}
                        conf = ev.payload.get("confidence")
                        if conf:               # 成员自评信心度 → 前端徽章
                            payload["confidence"] = conf
                        self._emit(MiloEvent(
                            group_id=ev.group_id, type=EventType.CHAT,
                            actor=member, payload=payload))
                elif ev.type == EventType.STATUS:
                    self._emit(ev)
                elif ev.type == EventType.SYSTEM and ev.payload.get("aborted"):
                    # 用户点了停止：对话流里要给出终局，否则界面一直"正在输入"
                    self._emit(MiloEvent(
                        group_id=ev.group_id, type=EventType.CHAT, actor=member,
                        payload={"text": "（已停止）", "aborted": True}))
                continue
            if ev.task_id:
                if ev.type == EventType.ESCALATION:
                    self.store.set_state(ev.task_id, TaskState.INPUT_REQUIRED)
                    self._busy.discard(member)
                    self.sync_group_status(ev.group_id)
                elif ev.type == EventType.DELIVERY:
                    self.store.set_state(ev.task_id, TaskState.DELIVERED)
                    self._busy.discard(member)
            self._emit(ev)

    def _emit(self, ev: MiloEvent) -> None:
        self.store.append(ev, run_id=self._runs.get(ev.task_id or ""))
        if self._on_event:
            self._on_event(ev)


def short_title(text: str, limit: int = 18) -> str:
    """把需求压成一行群标题（对齐 harness TitleConfig 的 max_words 意图，中文按字数）。"""
    t = " ".join(str(text).split())
    for sep in ("，", "。", "；", ",", ".", ";", "\n"):
        if sep in t:
            t = t.split(sep)[0]
            break
    return t if len(t) <= limit else t[: limit - 1] + "…"


def _read_secret(env_name: str) -> str:
    """凭证解引用：优先 keyring，回退环境变量（密钥零落盘）。"""
    import os

    try:
        import keyring

        val = keyring.get_password("milo", env_name)
        if val:
            return val
    except Exception:  # noqa: BLE001 —— 无钥匙串后端时回退
        pass
    return os.environ.get(env_name, "")

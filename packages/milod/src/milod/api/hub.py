"""Hub：进程内的组织注册表 + 事件广播 + 后台执行。

一个 milod 进程可服务多个组织；每组织一个 Office（其下每成员一子进程）。
"""
from __future__ import annotations

import asyncio
from typing import Any

import yaml

from milod.config.paths import org_dir
from milod.models import EventType, MiloEvent, TaskEnvelope, TaskState
from milod.secretariat.decompose import DecomposeError
from milod.secretariat.office import Office, _read_secret, short_title
from milod.secretariat.route import NoMemberForTask


class Hub:
    def __init__(self) -> None:
        self._offices: dict[str, Office] = {}
        self._desks: dict[str, Any] = {}  # org -> SecretaryDesk（对话式操作面）
        self._subs: dict[str, set[asyncio.Queue]] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()

    # ---- 秘书 ----------------------------------------------------------
    async def secretary(self, org: str):
        """取该团队的秘书（懒启动）：一个团队一个实例，常驻记忆。"""
        import os

        from milod.secretary import SECRETARY_GROUP, SecretaryDesk

        office = await self.office(org)
        if org not in self._desks:
            b = office._bindings()["model"]
            desk = SecretaryDesk(
                org,
                api_base=f"http://127.0.0.1:{os.environ.get('MILO_PORT', '8899')}",
                emit=office._emit,
            )
            office.store.ensure_group(SECRETARY_GROUP, title="秘书")
            await desk.ensure_started(
                model=b, secrets={b["secret_env"]: _read_secret(b["secret_env"])})
            self._desks[org] = desk
        return self._desks[org]

    # ---- 组织 ----------------------------------------------------------
    async def office(self, org: str) -> Office:
        async with self._lock:
            if org not in self._offices:
                o = Office(org, on_event=lambda ev, _o=org: self._broadcast(_o, ev))
                await o.open()
                self._offices[org] = o
                # 崩溃恢复：上次运行遗留的"运行中"任务重新接上（成员 checkpoint 仍在）
                recovered = await o.recover()
                if recovered:
                    o._emit(MiloEvent(
                        group_id="org", type=EventType.SYSTEM, actor="system",
                        payload={"msg": f"已恢复 {len(recovered)} 个中断任务",
                                 "recovered": recovered}))
            return self._offices[org]

    async def close_all(self) -> None:
        for t in self._tasks.values():
            t.cancel()
        for d in self._desks.values():
            await d.close()
        self._desks.clear()
        for o in self._offices.values():
            await o.close()
        self._offices.clear()

    # ---- 订阅 ----------------------------------------------------------
    def subscribe(self, org: str, q: asyncio.Queue) -> None:
        self._subs.setdefault(org, set()).add(q)

    def unsubscribe(self, org: str, q: asyncio.Queue) -> None:
        self._subs.get(org, set()).discard(q)

    def _broadcast(self, org: str, ev: MiloEvent) -> None:
        for q in list(self._subs.get(org, set())):
            q.put_nowait(ev)

    def track(self, group_id: str, task: asyncio.Task) -> None:
        self._tasks[group_id] = task
        task.add_done_callback(lambda _t: self._tasks.pop(group_id, None))

    # ---- 执行 ----------------------------------------------------------
    async def execute(self, org: str, group_id: str, request: str, auto_approve: bool) -> None:
        """后台执行一次需求：分解 → （批准）→ 逐步派单 → 前递产物 → 验收。

        遇升级即停在该步（任务转 input_required），等 UI 端提交答复后 resume。
        """
        office = await self.office(org)
        office.start_group(group_id, request)  # 落标题 + 记录组长需求（与 CLI 共用）

        try:
            envelopes = await self._decompose(office, request, group_id)
        except Exception as e:  # noqa: BLE001
            self._fail_group(office, group_id, request, e)
            return

        if envelopes:
            office.store.set_group_title(group_id, short_title(envelopes[0].objective))
        office._emit(MiloEvent(
            group_id=group_id, type=EventType.SYSTEM, actor="secretariat",
            payload={"plan": [{"capability": e.capability, "objective": e.objective,
                               "task_id": e.task_id} for e in envelopes],
                     "approved": auto_approve}))
        if not auto_approve:
            # 计划前置授权：暂存等组长批准（编制设计 §5.2）——批准即授权到里程碑。
            # 落盘而非内存：milod 重启后计划仍在，群不会悬置成"僵尸待批"
            office.store.save_pending_plan(group_id, envelopes)
            office.store.set_group_status(group_id, "waiting")
            return

        await self._run_steps(office, envelopes, group_id)
        office.sync_group_status(group_id)

    async def _decompose(self, office: Office, request: str, group_id: str) -> list:
        """分解需求。失败时把错误回喂模型重试一次——LLM 看到"X 不是能力、
        可选能力是 …"通常一次就能改对（实测常见错误：把成员名当能力 ID）。
        """
        prompt = office.plan_prompt(request)
        try:
            return office.parse_plan(await _ask_llm(org=office.org, prompt=prompt), group_id)
        except DecomposeError as first:
            office._emit(MiloEvent(
                group_id=group_id, type=EventType.SYSTEM, actor="secretariat",
                payload={"msg": f"分解结果不合法，正在重试：{first}"}))
            retry = (f"{prompt}\n\n上一次输出不合法：{first}\n"
                     f"请严格只用上面列出的能力 ID（不是成员名），重新输出 JSON。")
            return office.parse_plan(await _ask_llm(org=office.org, prompt=retry), group_id)

    async def retry_decompose(self, org: str, group_id: str) -> bool:
        """重试分解（P0 死锁出口）：用原始需求或用户改写后的需求重新走一遍。"""
        office = await self.office(org)
        events = office.store.group_events(group_id)
        request = next((e["content"] for e in events
                        if e["type"] == "chat" and e["actor"] == "owner" and e["content"]), None)
        if not request:
            return False
        office.store.set_group_status(group_id, "active")
        task = asyncio.create_task(self._replan(office, group_id, request))
        self.track(f"{group_id}-replan", task)
        return True

    def _fail_group(self, office: Office, group_id: str, request: str, err: Exception) -> None:
        """分解失败的统一收口：转 failed（不冒充进行中）+ 留重试入口 + 能力缺口引导。

        缺口引导（P2）：团队能力表就在手边，与其只报错，不如告诉用户
        "现在能干的是这些、缺的可能是那个"，把死胡同变成下一步动作。
        """
        caps = sorted(office.roster().capabilities)
        office._emit(MiloEvent(
            group_id=group_id, type=EventType.SYSTEM, actor="system",
            payload={"error": f"分解失败：{err}", "retriable": True, "request": request,
                     "available_capabilities": caps,
                     "hint": ("团队现有能力：" + "、".join(caps) if caps else "团队还没有成员")
                             + "。若这项工作确实无人能做，到「Agent 市场」下载合适的模板再招募，"
                               "或改写需求后重试分解。"}))
        office.store.set_group_status(group_id, "failed")

    async def _replan(self, office: Office, group_id: str, request: str) -> None:
        try:
            envelopes = await self._decompose(office, request, group_id)
        except Exception as e:  # noqa: BLE001
            self._fail_group(office, group_id, request, e)
            return
        office.store.set_group_title(group_id, short_title(envelopes[0].objective))
        office._emit(MiloEvent(
            group_id=group_id, type=EventType.SYSTEM, actor="secretariat",
            payload={"plan": [{"capability": e.capability, "objective": e.objective,
                               "task_id": e.task_id} for e in envelopes], "approved": False}))
        office.store.save_pending_plan(group_id, envelopes)
        office.store.set_group_status(group_id, "waiting")

    async def stop_channel(self, org: str, *, member: str | None = None,
                           task_id: str | None = None) -> bool:
        """停止正在进行的回合：秘书对话 / 成员私聊 / 任务执行通用。"""
        office = await self.office(org)
        if member:
            await office.cancel(member, task_id or "dm")
            return True
        desk = self._desks.get(org)
        if desk is not None:
            await desk.cancel()
            return True
        return False

    # ---- 验收确认与返工（验收与返工设计 §一）----------------------------
    async def accept_group(self, org: str, group_id: str, note: str = "") -> bool:
        """验收通过（**不归档**）：任务留在视野里可继续用、继续提要求；
        归档是另一个动作（手动或 24h 后自动）。"""
        office = await self.office(org)
        cur = next((g["status"] for g in office.store.groups()
                    if g["group_id"] == group_id), None)
        if cur != "review":
            return False
        office._emit(MiloEvent(
            group_id=group_id, type=EventType.CHAT, actor="owner",
            payload={"text": f"验收通过{('：' + note) if note else ''}"}))
        office.store.mark_accepted(group_id)
        return True

    async def archive_group(self, org: str, group_id: str) -> bool:
        """归档：收进历史（验收之后的独立动作，也可由超时自动触发）。"""
        office = await self.office(org)
        cur = next((g["status"] for g in office.store.groups()
                    if g["group_id"] == group_id), None)
        if cur not in ("accepted", "review", "failed"):
            return False
        office._emit(MiloEvent(
            group_id=group_id, type=EventType.SYSTEM, actor="owner",
            payload={"msg": "已归档"}))
        office.store.set_group_status(group_id, "archived")
        return True

    async def rework_group(self, org: str, group_id: str, feedback: str,
                           artifacts: list[dict] | None = None) -> bool:
        """产出不符预期：补充要求/资料，**在同一个群**重新组织执行。

        不新建群、不新建任务——同一 task 新开一轮（attempts+1），
        上一轮产物经 inputs.artifacts 回传给成员：它是"改稿"不是"从零重做"。
        """
        from milod.models import ArtifactRef

        office = await self.office(org)
        tasks = office.store.tasks(group_id)
        if not tasks:
            return False
        # 返工目标：最后一个交付过的任务（多步计划里通常就是最终产出方）
        target = next((t for t in reversed(tasks)
                       if t["state"] in ("accepted", "rejected", "delivered")), None)  # 已验收也可打回
        if target is None:
            return False

        env = TaskEnvelope.model_validate_json(target["envelope"])
        env.constraints.append(f"组长返工要求（第 {target['attempts'] + 1} 轮）：{feedback}")
        # 上一轮产物回传，成员在既有基础上改
        prev = office.last_delivery(target["task_id"]) or {}
        arts = [a for a in (prev.get("artifacts") or []) if a.get("uri")]
        if arts:
            env.inputs.artifacts = [
                ArtifactRef(name=a["name"], uri=a["uri"], media_type=a.get("media_type"))
                for a in arts
            ]
        for a in artifacts or []:  # 用户补充的资料（v0 预留，R3 支持文件上传）
            if a.get("name") and a.get("uri"):
                env.inputs.artifacts.append(ArtifactRef(name=a["name"], uri=a["uri"]))

        office._emit(MiloEvent(
            group_id=group_id, task_id=target["task_id"], type=EventType.CHAT,
            actor="owner", payload={"text": feedback, "rework": True,
                                    "round": target["attempts"] + 1}))
        office.store.set_group_status(group_id, "active")
        task = asyncio.create_task(self._rerun(office, env, group_id))
        self.track(f"{group_id}-rework", task)
        return True

    async def _rerun(self, office: Office, env, group_id: str) -> None:
        try:
            await office.dispatch([env], group_id)
        except NoMemberForTask as e:
            office._emit(MiloEvent(
                group_id=group_id, task_id=env.task_id, type=EventType.SYSTEM,
                actor="secretariat", payload={"error": str(e)}))
            office.store.set_group_status(group_id, "failed")
            return
        state = await self._await_settled(office, env.task_id)
        if state == TaskState.DELIVERED.value:
            await office.collect(env.task_id)
        office.sync_group_status(group_id)

    async def sweep_due_archives(self, hours: float = 24.0) -> int:
        """**已验收**超过保留时长 → 自动归档。后台定时 + 惰性检查双保险。

        只扫 accepted：未确认的群不自动归档——验收是用户的判断，不能代劳。
        """
        n = 0
        for _org, office in list(self._offices.items()):
            for gid in office.store.due_archives(hours):
                office._emit(MiloEvent(
                    group_id=gid, type=EventType.SYSTEM, actor="system",
                    payload={"msg": f"验收通过已满 {hours:.0f} 小时，自动归档"}))
                office.store.set_group_status(gid, "archived")
                n += 1
        return n

    # ---- 计划批准 ------------------------------------------------------
    async def pending_plan(self, org: str, group_id: str) -> list | None:
        office = await self.office(org)
        return office.store.pending_plan(group_id)

    async def approve_plan(
        self, org: str, group_id: str, *, edits: dict[str, Any] | None = None
    ) -> bool:
        """组长批准计划（可带逐步修订）→ 开始执行。

        edits: {task_id: "新目标"} 或 {task_id: {objective?, artifacts?, format?, constraints?}}。
        目标与交付要求要一起改——只改目标会让验收仍按旧 output_spec 判定
        （实测踩过：把"输出文件"改成"一句话"后仍被判"缺少产物"）。
        """
        office = await self.office(org)
        envelopes = office.store.pending_plan(group_id)
        if envelopes is None:
            return False
        office.store.delete_pending_plan(group_id)
        for env in envelopes if edits else []:
            edit = edits.get(env.task_id)
            if edit is None:
                continue
            before = {"objective": env.objective,
                      "artifacts": list(env.output_spec.artifacts),
                      "format": env.output_spec.format}
            if isinstance(edit, str):
                env.objective = edit
            else:
                if "objective" in edit:
                    env.objective = str(edit["objective"])
                if "artifacts" in edit:
                    env.output_spec.artifacts = [str(a) for a in (edit["artifacts"] or [])]
                if "format" in edit:
                    env.output_spec.format = str(edit["format"])
                if "constraints" in edit:
                    env.constraints = [str(c) for c in (edit["constraints"] or [])]
            office._emit(MiloEvent(
                group_id=group_id, task_id=env.task_id, type=EventType.SYSTEM,
                actor="owner",
                payload={"msg": "组长修订了步骤", "before": before,
                         "after": {"objective": env.objective,
                                   "artifacts": env.output_spec.artifacts,
                                   "format": env.output_spec.format}}))
        office._emit(MiloEvent(
            group_id=group_id, type=EventType.CHAT, actor="owner",
            payload={"text": "已批准计划，授权执行到里程碑"}))
        office.store.set_group_status(group_id, "active")
        task = asyncio.create_task(self._after_approve(office, envelopes, group_id))
        self.track(f"{group_id}-exec", task)
        return True

    async def reject_plan(self, org: str, group_id: str, reason: str = "") -> bool:
        office = await self.office(org)
        envelopes = office.store.pending_plan(group_id)
        if envelopes is None:
            return False
        office.store.delete_pending_plan(group_id)
        office._emit(MiloEvent(
            group_id=group_id, type=EventType.CHAT, actor="owner",
            payload={"text": f"未批准计划{('：' + reason) if reason else ''}"}))
        office.store.set_group_status(group_id, "archived")
        return True

    async def _after_approve(self, office: Office, envelopes: list, group_id: str) -> None:
        await self._run_steps(office, envelopes, group_id)
        office.sync_group_status(group_id)

    async def _run_steps(self, office: Office, envelopes: list, group_id: str) -> None:
        """逐步派单并前递产物。

        前递 = artifact 引用授权（编制设计 §3.4）：上一步的交付物以引用形式
        写进下一步信封的 inputs.artifacts，由适配层注入成员输入目录——
        只递文件名不递文件，下游只能凭空猜（实测：评审员拿不到代码就自己
        重构一份来评审，结论全部作废）。
        """
        from milod.models import ArtifactRef

        carry: list[str] = []
        prev_arts: list[dict] = []
        for env in envelopes:
            if prev_arts:
                env.inputs.artifacts = [
                    ArtifactRef(name=a["name"], uri=a["uri"],
                                media_type=a.get("media_type"))
                    for a in prev_arts if a.get("uri")
                ]
            if carry:
                env.constraints.append("参考上一步的产出：" + carry[-1][:300])
            try:
                await office.dispatch([env], group_id)
            except NoMemberForTask as e:
                office._emit(MiloEvent(
                    group_id=group_id, task_id=env.task_id, type=EventType.SYSTEM,
                    actor="secretariat",
                    payload={"error": str(e), "available_capabilities": e.available,
                             "hint": f"没有成员声明能力 {e.capability}——"
                                     f"到「Agent 市场」找具备该能力的模板招募，或改写需求重试。"}))
                office.store.set_group_status(group_id, "failed")
                return

            state = await self._await_settled(office, env.task_id)
            if state == TaskState.INPUT_REQUIRED.value:
                return  # 停在此步，等组长答复（reply → resume 后由 _after_resume 续跑）
            if state == TaskState.DELIVERED.value:
                v = await office.collect(env.task_id)
                payload = office.last_delivery(env.task_id) or {}
                arts = payload.get("artifacts") or []
                prev_arts = [a for a in arts if a.get("uri")]
                carry.append("产物 " + "、".join(a["name"] for a in arts) if arts
                             else str(payload.get("summary") or ""))
                if not v.accepted:
                    return

    async def _await_settled(self, office: Office, task_id: str, timeout: float = 600) -> str:
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(0.5)
            row = next((t for t in office.store.tasks() if t["task_id"] == task_id), None)
            if row and row["state"] not in {"queued", "assigned", "working"}:
                return row["state"]
        return "timeout"

    async def resume(self, org: str, task_id: str, answer: str) -> None:
        office = await self.office(org)
        await office.reply(task_id, answer)
        state = await self._await_settled(office, task_id)
        if state == TaskState.DELIVERED.value:
            await office.collect(task_id)


async def _ask_llm(*, org: str, prompt: str) -> str:
    import httpx

    b = yaml.safe_load((org_dir(org) / "bindings.yaml").read_text(encoding="utf-8"))["model"]
    key = _read_secret(b["secret_env"])
    async with httpx.AsyncClient(timeout=120) as c:
        r = await c.post(
            f"{b['api_base'].rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": b["model"], "messages": [{"role": "user", "content": prompt}],
                  "temperature": 0},
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]

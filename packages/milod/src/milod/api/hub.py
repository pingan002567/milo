"""Hub：进程内的组织注册表 + 事件广播 + 后台执行。

一个 milod 进程可服务多个组织；每组织一个 Office（其下每成员一子进程）。
"""
from __future__ import annotations

import asyncio
from typing import Any

import yaml

from milod.config.paths import org_dir
from milod.models import EventType, MiloEvent, TaskState
from milod.secretariat.decompose import DecomposeError
from milod.secretariat.office import Office, _read_secret, short_title
from milod.secretariat.route import NoMemberForTask


class Hub:
    def __init__(self) -> None:
        self._offices: dict[str, Office] = {}
        self._subs: dict[str, set[asyncio.Queue]] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._pending_plans: dict[str, list] = {}  # group_id -> 待批准的任务信封
        self._lock = asyncio.Lock()

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
            plan_text = await _ask_llm(org, office.plan_prompt(request))
            envelopes = office.parse_plan(plan_text, group_id)
        except (DecomposeError, Exception) as e:  # noqa: BLE001
            office._emit(MiloEvent(
                group_id=group_id, type=EventType.SYSTEM, actor="system",
                payload={"error": f"分解失败：{e}"}))
            return

        if envelopes:
            office.store.set_group_title(group_id, short_title(envelopes[0].objective))
        office._emit(MiloEvent(
            group_id=group_id, type=EventType.SYSTEM, actor="secretariat",
            payload={"plan": [{"capability": e.capability, "objective": e.objective,
                               "task_id": e.task_id} for e in envelopes],
                     "approved": auto_approve}))
        if not auto_approve:
            # 计划前置授权：暂存等组长批准（编制设计 §5.2）——批准即授权到里程碑
            self._pending_plans[group_id] = envelopes
            office.store.set_group_status(group_id, "waiting")
            return

        await self._run_steps(office, envelopes, group_id)
        office.sync_group_status(group_id)

    # ---- 计划批准 ------------------------------------------------------
    def pending_plan(self, group_id: str) -> list | None:
        return self._pending_plans.get(group_id)

    async def approve_plan(
        self, org: str, group_id: str, *, edits: dict[str, Any] | None = None
    ) -> bool:
        """组长批准计划（可带逐步修订）→ 开始执行。

        edits: {task_id: "新目标"} 或 {task_id: {objective?, artifacts?, format?, constraints?}}。
        目标与交付要求要一起改——只改目标会让验收仍按旧 output_spec 判定
        （实测踩过：把"输出文件"改成"一句话"后仍被判"缺少产物"）。
        """
        envelopes = self._pending_plans.pop(group_id, None)
        if envelopes is None:
            return False
        office = await self.office(org)
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
        envelopes = self._pending_plans.pop(group_id, None)
        if envelopes is None:
            return False
        office = await self.office(org)
        office._emit(MiloEvent(
            group_id=group_id, type=EventType.CHAT, actor="owner",
            payload={"text": f"未批准计划{('：' + reason) if reason else ''}"}))
        office.store.set_group_status(group_id, "archived")
        return True

    async def _after_approve(self, office: Office, envelopes: list, group_id: str) -> None:
        await self._run_steps(office, envelopes, group_id)
        office.sync_group_status(group_id)

    async def _run_steps(self, office: Office, envelopes: list, group_id: str) -> None:
        carry: list[str] = []
        for env in envelopes:
            if carry:
                env.constraints.append("参考上一步的产出：" + carry[-1][:300])
            try:
                await office.dispatch([env], group_id)
            except NoMemberForTask as e:
                office._emit(MiloEvent(
                    group_id=group_id, task_id=env.task_id, type=EventType.SYSTEM,
                    actor="secretariat", payload={"error": str(e)}))
                return

            state = await self._await_settled(office, env.task_id)
            if state == TaskState.INPUT_REQUIRED.value:
                return  # 停在此步，等组长答复（reply → resume 后由 _after_resume 续跑）
            if state == TaskState.DELIVERED.value:
                v = await office.collect(env.task_id)
                payload = office.last_delivery(env.task_id) or {}
                arts = payload.get("artifacts") or []
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


async def _ask_llm(org: str, prompt: str) -> str:
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

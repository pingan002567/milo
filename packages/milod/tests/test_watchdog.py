"""执行看门狗回归测试：活性判定 · 超时收口 · failed 粘性。

覆盖的缺陷：`_await_settled` 原为绝对 600s 墙钟且返回 "timeout" 后无人处理——
任务永久停在 working、群永久 active（绿点冒充进行中），既无终局也无重试入口。

运行：PYTHONPATH=packages/milod/src python packages/milod/tests/test_watchdog.py
"""
import asyncio
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from milod.models import EventType, MiloEvent, TaskEnvelope, TaskState  # noqa: E402
from milod.store.repo import Store  # noqa: E402

ok = True


def check(label: str, cond: bool) -> None:
    global ok
    print(f"  {label}: {'✅' if cond else '❌'}")
    ok = ok and cond


def _envelope(task_id: str, group_id: str) -> TaskEnvelope:
    return TaskEnvelope.model_validate({
        "task_id": task_id, "group_id": group_id, "context_id": "c-1",
        "capability": "python", "objective": "写个脚本",
        "output_spec": {"artifacts": ["x.py"], "format": "file"},
    })


class FakeOffice:
    """只提供看门狗与收口用到的表面：store / cancel / _emit / 群状态。"""

    def __init__(self, store: Store) -> None:
        self.store = store
        self.canceled: list[tuple[str, str]] = []
        self.emitted: list[MiloEvent] = []

    async def cancel(self, member: str, task_id: str) -> None:
        self.canceled.append((member, task_id))

    def _emit(self, ev: MiloEvent) -> None:
        self.emitted.append(ev)
        self.store.append(ev)


class _Verdict:
    accepted = True
    summary = "通过"


async def _accepted(store: Store, task_id: str) -> _Verdict:
    store.set_state(task_id, TaskState.ACCEPTED)
    return _Verdict()


def new_office(tmp: Path) -> FakeOffice:
    store = Store(tmp / "milo.db")
    store.ensure_group("g-1", title="测试群")
    store.upsert_task(_envelope("t-1", "g-1"), group_id="g-1", member="小张",
                      state=TaskState.WORKING)
    return FakeOffice(store)


async def main() -> None:
    from milod.api import hub as hubmod

    tmp = Path(tempfile.mkdtemp())
    hub = hubmod.Hub()

    # --- 场景 A：久无事件 → timeout:idle（真卡死才判死） ---------------
    print("\n【A · 静默超过阈值 → timeout:idle】")
    hubmod.TASK_IDLE_SECONDS = 1.5
    hubmod.TASK_MAX_SECONDS = 30
    office = new_office(tmp / "a")
    state = await hub._await_settled(office, "t-1")
    check("返回 timeout:idle", state == "timeout:idle")

    # --- 场景 B：持续有事件 → 静默闸不触发，长任务不被腰斩 ------------
    print("\n【B · 有脉搏就不判死（长任务不被腰斩）】")
    office = new_office(tmp / "b")

    async def heartbeat() -> None:
        for i in range(6):          # 3 秒内持续输出，跨过 1.5s 静默闸两次
            await asyncio.sleep(0.5)
            office._emit(MiloEvent(group_id="g-1", task_id="t-1",
                                   type=EventType.STATUS, actor="小张",
                                   payload={"kind": "trace", "text": f"思考 {i}"}))
        office.store.set_state("t-1", TaskState.DELIVERED)

    beat = asyncio.create_task(heartbeat())
    state = await hub._await_settled(office, "t-1")
    await beat
    check("熬过静默闸并等到交付", state == TaskState.DELIVERED.value)

    # --- 场景 C：一直有事件但永不落定 → 绝对闸兜底 ---------------------
    print("\n【C · 刷事件的死循环 → 绝对闸 timeout:cap】")
    hubmod.TASK_MAX_SECONDS = 2
    office = new_office(tmp / "c")
    spin = True

    async def spinner() -> None:
        n = 0
        while spin:
            await asyncio.sleep(0.3)
            n += 1
            office._emit(MiloEvent(group_id="g-1", task_id="t-1",
                                   type=EventType.STATUS, actor="小张",
                                   payload={"kind": "trace", "text": f"循环 {n}"}))

    sp = asyncio.create_task(spinner())
    state = await hub._await_settled(office, "t-1")
    spin = False
    await sp
    check("返回 timeout:cap", state == "timeout:cap")
    hubmod.TASK_MAX_SECONDS = 30

    # --- 场景 D：超时收口 = 止损 + 终局 + 重试入口 ---------------------
    print("\n【D · 超时收口：叫停成员 + 任务 failed + 群 failed + 可重试】")
    office = new_office(tmp / "d")
    await hub._timeout_task(office, "g-1", "t-1", "timeout:idle")
    row = office.store.task("t-1")
    grp = next(g for g in office.store.groups() if g["group_id"] == "g-1")
    err = next((e for e in office.emitted if e.payload.get("error")), None)
    check("叫停了成员（不继续烧 token）", office.canceled == [("小张", "t-1")])
    check("任务转 failed", row["state"] == "failed")
    check("留下 stop_reason", row["stop_reason"] == "timeout:idle")
    check("群转 failed（不冒充进行中）", grp["status"] == "failed")
    check("错误事件可重试", bool(err) and err.payload.get("retriable") is True)

    # --- 场景 E：failed 粘性——不被 sync_group_status 洗成"待你确认" ----
    print("\n【E · failed 粘性：全终态也不翻成 review】")
    from milod.secretariat.office import Office

    Office.sync_group_status(office, "g-1")  # type: ignore[arg-type]
    grp = next(g for g in office.store.groups() if g["group_id"] == "g-1")
    check("仍是 failed", grp["status"] == "failed")
    check("没有误发'等你确认'", not any(
        e.payload.get("awaiting_confirm") for e in office.emitted))

    # --- 场景 F：多步计划里某步超时 → 收口并止步，不空手派下一步 -------
    print("\n【F · 步骤超时 → 止步收口，后续步骤不派单】")
    hubmod.TASK_IDLE_SECONDS = 1.0
    store = Store(tmp / "f" / "milo.db")
    store.ensure_group("g-2", title="两步计划")
    office = FakeOffice(store)
    dispatched: list[str] = []

    async def dispatch(envs, group_id):        # noqa: ANN001
        for e in envs:
            dispatched.append(e.task_id)
            store.upsert_task(e, group_id=group_id, member="小张",
                              state=TaskState.WORKING)

    office.dispatch = dispatch                 # type: ignore[attr-defined]
    office.sync_group_status = lambda gid: None  # type: ignore[attr-defined]
    await hub._run_steps(office, [_envelope("t-a", "g-2"), _envelope("t-b", "g-2")], "g-2")
    grp = next(g for g in store.groups() if g["group_id"] == "g-2")
    check("只派了第一步（第二步不空手接单）", dispatched == ["t-a"])
    check("第一步 failed", store.task("t-a")["state"] == "failed")
    check("群 failed（有出口）", grp["status"] == "failed")

    # --- 场景 G：请示停步 → 剩余步骤落盘 → 答复后续跑 ------------------
    # 原缺陷：resume 到 collect 就结束——多步计划只要有一步请示过，后面的步骤
    # 再也不会派出去，群还永远停在「等待中」，既无产出也等不到验收卡。
    print("\n【G · 请示停步 → 答复后续跑剩余步骤】")
    hubmod.TASK_IDLE_SECONDS = 30
    store = Store(tmp / "g" / "milo.db")
    store.ensure_group("g-3", title="两步计划")
    office = FakeOffice(store)
    dispatched: list[str] = []

    async def dispatch_esc(envs, group_id):    # noqa: ANN001
        """第一步请示、第二步直接交付。"""
        for e in envs:
            dispatched.append(e.task_id)
            store.upsert_task(e, group_id=group_id, member="小张",
                              state=TaskState.WORKING)
            store.set_state(e.task_id, TaskState.INPUT_REQUIRED
                            if e.task_id == "t-a" else TaskState.DELIVERED)

    office.dispatch = dispatch_esc             # type: ignore[attr-defined]
    office.sync_group_status = lambda gid: None  # type: ignore[attr-defined]
    office.collect = lambda tid: _accepted(store, tid)  # type: ignore[attr-defined]
    office.last_delivery = lambda tid: {"artifacts": [], "summary": "做完了"}  # type: ignore[attr-defined]

    plan = [_envelope("t-a", "g-3"), _envelope("t-b", "g-3")]
    await hub._run_steps(office, plan, "g-3")
    saved = store.plan_progress("g-3")
    check("停在第一步，只派了它", dispatched == ["t-a"])
    check("剩余步骤已落盘（含当前步）",
          bool(saved) and [e.task_id for e in saved] == ["t-a", "t-b"])

    # 答复：模拟 office.reply 让任务接续到交付，再走 hub 的续跑
    async def reply(tid, answer):              # noqa: ANN001
        store.set_state(tid, TaskState.DELIVERED)

    office.reply = reply                       # type: ignore[attr-defined]
    await hub._continue_plan(office, "g-3", "t-a")
    check("第二步被派出去了", dispatched == ["t-a", "t-b"])
    check("计划跑完后剩余记录已清", store.plan_progress("g-3") is None)

    print("\n" + ("全部通过" if ok else "有失败用例"))
    sys.exit(0 if ok else 1)


asyncio.run(main())

"""验证中断恢复链路：ask_clarification 中断 → 组长答复 → resume 接续。

这是"任务群里回复即恢复执行"的技术基础（需 checkpointer，SPIKE-01 结论 3）。
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent / "packages" / "milod" / "src"))

from milod.adapter.base import MemberSpec  # noqa: E402
from milod.adapter.subprocess_adapter import SubprocessAdapter  # noqa: E402
from milod.models import EventType, OutputSpec, TaskEnvelope  # noqa: E402
from test_e2e import render_member  # noqa: E402


async def drain_until(adapter: SubprocessAdapter, *types, timeout: float = 180) -> list:
    got: list = []

    async def loop() -> None:
        async for ev in adapter.events():
            got.append(ev)
            if ev.type in types:
                return

    try:
        await asyncio.wait_for(asyncio.create_task(loop()), timeout=timeout)
    except TimeoutError:
        pass
    return got


async def main() -> int:
    root = HERE / "run-resume"
    shutil.rmtree(root, ignore_errors=True)
    wd = render_member(root, "writer", "你是「撰写成员」writer。需要信息时调用 ask_clarification。")

    ad = SubprocessAdapter()
    await ad.enroll(
        MemberSpec(name="writer", pack_ref="local", workdir=wd,
                   secrets={"MIMO_API_KEY": os.environ["MIMO_API_KEY"]})
    )

    env = TaskEnvelope(
        capability="writing",
        objective="给我们的项目写一句宣传标语。",  # 缺"项目是什么" -> 应澄清
        output_spec=OutputSpec(format="text"),
    )

    print("── 第一轮：派单，期待中断 ──")
    collector = asyncio.create_task(drain_until(ad, EventType.ESCALATION, EventType.DELIVERY))
    await ad.assign(env)
    evs = await collector
    esc = [e for e in evs if e.type == EventType.ESCALATION]
    print(f"事件: {[e.type.value for e in evs]}")
    if esc:
        print(f"⚠ 中断原因: policy={esc[0].payload.get('policy')} "
              f"q={str(esc[0].payload.get('question'))[:80]}")
    else:
        print("（未触发澄清，直接看第二轮是否仍有上下文）")

    print("\n── 第二轮：组长答复，resume 接续 ──")
    answer = "项目叫 Milo，是一个让用户指挥多个 AI 成员协作的桌面应用。语气简洁有力。"
    collector = asyncio.create_task(drain_until(ad, EventType.DELIVERY))
    await ad.resume(env.task_id, answer)
    evs2 = await collector
    print(f"事件: {[e.type.value for e in evs2]}")
    final = "".join(
        str(e.payload.get("summary") or e.payload.get("doing") or "") for e in evs2
    )
    print(f"产出: {final[:300]}")

    print(f"\n{'=' * 60}\n【断言】")
    print("  第一轮中断           :", "✅" if esc else "⚠ 未触发（模型未调用工具）")
    print("  第二轮接续并产出内容 :", "✅" if final.strip() else "❌")
    print("  上下文保持（提到 Milo）:", "✅" if "Milo" in final or "milo" in final.lower() else "❌")

    await ad.dismiss()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

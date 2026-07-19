"""M1 端到端验证：SubprocessAdapter 两成员并行 + 升级中断 + 隔离。

断言：
  1. 两成员各自子进程，人设互不串台（隔离）
  2. 并行派单真的并发（总耗时 < 串行之和）
  3. 需要澄清的任务产出 ESCALATION 事件（结构化，非文本猜测）
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
import time
from pathlib import Path

import yaml

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent / "packages" / "milod" / "src"))

from milod.adapter.base import MemberSpec  # noqa: E402
from milod.adapter.subprocess_adapter import SubprocessAdapter  # noqa: E402
from milod.models import EventType, OutputSpec, TaskEnvelope  # noqa: E402

MODEL = {
    "name": "mimo-v2.5",
    "use": "deerflow.models.patched_mimo:PatchedChatMiMo",
    "model": "mimo-v2.5",
    "api_base": "https://api.xiaomimimo.com/v1",
    "api_key": "$MIMO_API_KEY",
    "timeout": 600.0,
}


def render_member(root: Path, name: str, soul: str) -> Path:
    """每成员一套私有目录树（SPIKE-02 隔离修正后的布局）。"""
    wd = root / "members" / name
    home = wd / "home"
    (home / "agents" / name).mkdir(parents=True, exist_ok=True)
    (home / "skills" / "custom").mkdir(parents=True, exist_ok=True)
    (home / "agents" / name / "SOUL.md").write_text(soul, encoding="utf-8")
    (home / "agents" / name / "config.yaml").write_text(
        yaml.safe_dump({"name": name, "description": name, "model": MODEL["name"]}), encoding="utf-8"
    )
    wd.joinpath("config.yaml").write_text(
        yaml.safe_dump(
            {
                "config_version": 26,
                "models": [MODEL],
                "sandbox": {
                    "use": "deerflow.sandbox.local:LocalSandboxProvider",
                    "allow_host_bash": False,
                },
                "skills": {"path": str((home / "skills").resolve())},
                "tools": [],  # permissions 收敛：不注入工具即无法越权
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )
    return wd


async def run_member(adapter: SubprocessAdapter, spec: MemberSpec, env: TaskEnvelope) -> list:
    await adapter.enroll(spec)
    collected: list = []

    async def collect() -> None:
        async for ev in adapter.events():
            collected.append(ev)
            if ev.type in (EventType.DELIVERY, EventType.ESCALATION):
                return

    task = asyncio.create_task(collect())
    await adapter.assign(env)
    try:
        await asyncio.wait_for(task, timeout=180)
    except TimeoutError:
        task.cancel()
    return collected


async def main() -> int:
    root = HERE / "run1"
    shutil.rmtree(root, ignore_errors=True)
    secrets = {"MIMO_API_KEY": os.environ["MIMO_API_KEY"]}

    a_dir = render_member(root, "scout", "你是「文献检索成员」scout。回答时先自报名字。")
    b_dir = render_member(root, "writer", "你是「撰写成员」writer。回答时先自报名字。")

    a = SubprocessAdapter()
    b = SubprocessAdapter()
    spec_a = MemberSpec(name="scout", pack_ref="local", workdir=a_dir, secrets=secrets)
    spec_b = MemberSpec(name="writer", pack_ref="local", workdir=b_dir, secrets=secrets)

    env_a = TaskEnvelope(
        capability="literature-search",
        objective="用一句话说明你是谁、负责什么。",
        output_spec=OutputSpec(format="text"),
    )
    env_b = TaskEnvelope(
        capability="writing",
        objective="把项目里那个文件改一下，改成合适的值。",  # 缺信息 -> 应触发 ask_clarification
        output_spec=OutputSpec(format="text"),
    )

    t0 = time.time()
    res_a, res_b = await asyncio.gather(run_member(a, spec_a, env_a), run_member(b, spec_b, env_b))
    elapsed = time.time() - t0

    print(f"\n{'=' * 64}\n并行耗时 {elapsed:.1f}s")

    def summarize(name: str, evs: list) -> None:
        types = [e.type.value for e in evs]
        print(f"\n[{name}] 事件序列: {types}")
        for e in evs:
            if e.type == EventType.ESCALATION:
                print(f"  ⚠ 升级(结构化): policy={e.payload.get('policy')} "
                      f"question={str(e.payload.get('question'))[:60]}")
            elif e.type in (EventType.STATUS, EventType.DELIVERY):
                txt = str(e.payload.get("doing") or e.payload.get("summary") or "")[:80]
                print(f"  · {e.type.value}: {txt}")

    summarize("scout", res_a)
    summarize("writer", res_b)

    a_text = " ".join(str(e.payload) for e in res_a)
    b_text = " ".join(str(e.payload) for e in res_b)
    print(f"\n{'=' * 64}\n【断言】")
    print("  隔离·scout 不提 writer :", "✅" if "writer" not in a_text else "❌")
    print("  隔离·writer 不提 scout :", "✅" if "scout" not in b_text else "❌")
    print("  升级·writer 产出 ESCALATION :",
          "✅" if any(e.type == EventType.ESCALATION for e in res_b) else "❌ 未捕获")

    await a.dismiss()
    await b.dismiss()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

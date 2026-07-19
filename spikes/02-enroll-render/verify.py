"""Spike 02 验证：渲染后的成员是否真的加载了 SOUL.md / 技能，并遵守升级契约。

三个断言用例：
  A. 人设注入 —— 问"你是谁、你的职责边界"，回答应体现文献检索成员身份
  B. 技能可见 —— 问"你有哪些技能"，应提及 citation-check
  C. 升级契约 —— 给一个需要外网（permissions 未授权）的任务，
     期待输出 MILO_ESCALATE 结构化块，而非自然语言提问
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent / "packages" / "milod" / "src"))

CASES = {
    "identity": "你是谁？你的职责边界是什么？一句话回答。",
    "skills": "列出你当前可用的技能名称，只列名称。",
    "escalate": (
        "请检索 arxiv.org 上 2026 年关于蛋白质扩散模型的最新论文并给我清单。"
        "注意：你当前没有外网访问权限。"
    ),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workdir", type=Path, default=HERE / "run1")
    ap.add_argument("--agent", default="lit-scout")
    ap.add_argument("--case", choices=list(CASES) + ["all"], default="all")
    args = ap.parse_args()

    os.environ["DEER_FLOW_CONFIG_PATH"] = str(args.workdir / "config.yaml")
    os.environ["DEER_FLOW_HOME"] = str(args.workdir / "home")

    from deerflow.client import DeerFlowClient  # noqa: E402
    from milod.adapter.embedded import parse_escalation  # noqa: E402

    client = DeerFlowClient(
        config_path=str(args.workdir / "config.yaml"),
        agent_name=args.agent,
    )

    cases = list(CASES) if args.case == "all" else [args.case]
    for case in cases:
        print(f"\n{'=' * 60}\n[{case}] {CASES[case]}\n{'-' * 60}")
        text_parts: list[str] = []
        for ev in client.stream(CASES[case], thread_id=f"spike02-{case}"):
            if getattr(ev, "type", None) == "messages-tuple":
                d = getattr(ev, "data", None)
                if isinstance(d, dict) and d.get("type") == "ai" and d.get("content"):
                    text_parts.append(str(d["content"]))
        text = "".join(text_parts)
        print(text[:900])

        if case == "escalate":
            esc = parse_escalation(text)
            print(f"\n>>> 契约解析: {'✅ ' + str(esc) if esc else '❌ 未产出 MILO_ESCALATE 结构化块'}")
        elif case == "identity":
            hit = any(k in text for k in ("文献", "检索", "lit-scout"))
            print(f"\n>>> 人设注入: {'✅' if hit else '❌ 未体现 SOUL.md 身份'}")
        elif case == "skills":
            hit = "citation-check" in text or "引用" in text
            print(f"\n>>> 技能可见: {'✅' if hit else '❌ 未提及 citation-check'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

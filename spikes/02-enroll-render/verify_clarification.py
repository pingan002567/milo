"""验证官方原生升级机制：ask_clarification 工具 + ClarificationMiddleware。

发现（SPIKE-02）：harness 内置 `ask_clarification` 工具，被 ClarificationMiddleware 拦截后
返回 Command(goto=END)，并产出一条 ToolMessage：
    name="ask_clarification"
    id="clarification:<tool_call_id>"
    artifact={"human_input": {...}}   <-- 结构化载荷
这比自定义 MILO_ESCALATE 标记可靠得多：由运行时中间件保证，不依赖成员照做人设。
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

HERE = Path(__file__).parent

PROMPT = (
    "把项目里那个配置文件改一下，改成正确的值。"  # 缺文件名与目标值 -> 必须澄清
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workdir", type=Path, default=HERE / "run1")
    ap.add_argument("--agent", default="lit-scout")
    args = ap.parse_args()

    os.environ["DEER_FLOW_CONFIG_PATH"] = str(args.workdir / "config.yaml")
    os.environ["DEER_FLOW_HOME"] = str(args.workdir / "home")

    from deerflow.client import DeerFlowClient

    client = DeerFlowClient(
        config_path=str(args.workdir / "config.yaml"), agent_name=args.agent
    )

    out = args.workdir / "clarification-events.jsonl"
    out.unlink(missing_ok=True)
    found: list[dict] = []

    print(f"[i] prompt: {PROMPT}\n{'-' * 60}")
    for ev in client.stream(PROMPT, thread_id="spike02-clarify"):
        etype = getattr(ev, "type", None)
        data = getattr(ev, "data", None)
        with out.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"type": etype, "data": data}, ensure_ascii=False, default=str) + "\n")

        # 归一化候选信号 1：messages-tuple 中 name=ask_clarification 的 ToolMessage
        if isinstance(data, dict) and data.get("name") == "ask_clarification":
            found.append(data)
        # 候选信号 2：values 快照里的同名工具消息
        if etype == "values" and isinstance(data, dict):
            for m in data.get("messages", []) or []:
                if isinstance(m, dict) and m.get("name") == "ask_clarification":
                    found.append(m)
        # 候选信号 3：AI 消息里的 tool_calls
        if isinstance(data, dict):
            for tc in data.get("tool_calls") or []:
                if tc.get("name") == "ask_clarification":
                    found.append({"tool_call": tc})

    print(f"\n[✓] 事件已写入 {out}")
    if found:
        print(f"[✓] 捕获 {len(found)} 条 ask_clarification 信号，样本：")
        print(json.dumps(found[0], ensure_ascii=False, default=str)[:900])
    else:
        print("[x] 未捕获 ask_clarification —— 检查 config 是否需显式启用 clarification")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

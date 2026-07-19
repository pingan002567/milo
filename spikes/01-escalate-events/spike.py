"""Spike 01：抓取 DeerFlowClient 全量事件流，观察 escalate 形态。

写法刻意防御：DeerFlowClient 的确切签名以安装版本为准，跑不通的调用会打印
可用属性帮助现场调整——这是勘探脚本，不是产品代码。
"""
from __future__ import annotations

import argparse
import inspect
import json
import os
import shutil
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent

CASES = {
    # 模糊到必然需要澄清
    "ambiguous": "帮我处理一下那个文件，弄好一点。",
    # 明确任务 + plan_mode 应触发计划审批中断
    "plan": "调研「扩散模型在蛋白质设计」近三年的三篇代表工作，输出对比表格保存为 markdown。",
}


def prepare_workdir(workdir: Path) -> Path:
    workdir.mkdir(parents=True, exist_ok=True)
    cfg = workdir / "config.yaml"
    if not cfg.exists():
        shutil.copy(HERE / "member-config.template.yaml", cfg)
        print(f"[i] 已生成 {cfg}（对照官方 config.example.yaml 按需增删字段）")
    return cfg


def dump(obj) -> dict:
    """尽力把任意事件对象转成可 JSON 化的 dict。"""
    import dataclasses

    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        try:
            return dataclasses.asdict(obj)
        except Exception:  # noqa: BLE001
            return {f.name: repr(getattr(obj, f.name)) for f in dataclasses.fields(obj)}
    for attr in ("model_dump", "dict", "_asdict"):
        fn = getattr(obj, attr, None)
        if callable(fn):
            try:
                return fn()
            except Exception:  # noqa: BLE001
                pass
    if isinstance(obj, dict):
        return obj
    return {"__repr__": repr(obj), "__type__": type(obj).__name__}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workdir", type=Path, default=Path("./run1"))
    ap.add_argument("--case", choices=list(CASES), default="ambiguous")
    ap.add_argument("--plan-mode", action="store_true", help="plan 用例建议开启")
    args = ap.parse_args()

    try:
        from deerflow.client import DeerFlowClient  # type: ignore
    except ImportError as e:
        print(f"[x] deerflow-harness 未安装: {e}\n    见 README.md 准备步骤")
        return 1

    cfg = prepare_workdir(args.workdir)
    out = args.workdir / "events.jsonl"

    print(f"[i] DeerFlowClient 签名: {inspect.signature(DeerFlowClient.__init__)}")
    client = DeerFlowClient(
        config_path=str(cfg),
        plan_mode=args.plan_mode or args.case == "plan",
    )
    print(f"[i] client 可用方法: {[m for m in dir(client) if not m.startswith('_')]}")

    prompt = CASES[args.case]
    print(f"[i] case={args.case!r} prompt={prompt!r}")

    census: Counter[str] = Counter()
    # 已核实签名：stream(message: str, *, thread_id: str | None, **kwargs) -> Generator[StreamEvent]
    stream = client.stream(prompt, thread_id=f"spike-{args.case}")

    def record(ev) -> None:
        d = dump(ev)
        key = str(d.get("type") or d.get("event") or d.get("__type__", "?"))
        census[key] += 1
        with out.open("a", encoding="utf-8") as f:
            f.write(json.dumps(d, ensure_ascii=False, default=str) + "\n")

    if inspect.isasyncgen(stream):
        import asyncio

        async def run() -> None:
            async for ev in stream:
                record(ev)

        asyncio.run(run())
    else:
        for ev in stream:
            record(ev)

    print(f"\n[✓] 事件已写入 {out}")
    print("[✓] 事件类型直方图：")
    for k, v in census.most_common():
        print(f"    {v:>4}  {k}")
    print(
        "\n[→] 下一步：在 events.jsonl 里定位澄清/中断/计划审批事件的结构特征，"
        "\n    回填 EmbeddedAdapter.events() 的归一化规则，并记录内存占用（ps -o rss）。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

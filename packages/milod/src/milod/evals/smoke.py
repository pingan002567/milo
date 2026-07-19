"""质检冒烟：把市场页的"质检门槛"从自报数字变成可复跑的实测报告。

护城河的落点（产品方案 §2.3）：市面上的 prompt/GPTs 市场全靠用户评论，
Milo 的包上架前平台复跑评测集"验货"。v0 是冒烟而非完整评测：

- 评测集：包内 ``eval/smoke.yaml``（milo 原生格式；llm-space Thread JSON
  评测集的导入转换推迟到 v1，格式对齐后做）
- 断言：contains（全部出现于交付摘要）/ regex / artifacts（交付物名）；
  评测中成员升级请示 = 该案例不通过（评测无人应答，包应自足完成冒烟题）
- 计分：5 分制（对齐 manifest ``eval.min_score``）= 5 × 通过率
- 报告：落 ``~/.milo/eval-reports/<name>@<version>.json``，市场 API 附带展示；
  报告与包分离——包作者自报的是门槛，报告是本机实测，两者在 UI 上分开呈现
"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from milod.config.paths import milo_home
from milod.models import EventType, OutputSpec, TaskEnvelope


class SuiteError(Exception):
    pass


def load_suite(pack_dir: Path) -> dict[str, Any]:
    f = pack_dir / "eval" / "smoke.yaml"
    if not f.exists():
        raise SuiteError(f"包内没有冒烟评测集：{f}")
    suite = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    cases = suite.get("cases") or []
    if not cases:
        raise SuiteError("评测集没有任何案例（cases 为空）")
    for i, c in enumerate(cases):
        if not c.get("id") or not c.get("prompt"):
            raise SuiteError(f"案例 #{i} 缺少 id 或 prompt")
    return suite


def score_case(
    expect: dict[str, Any], summary: str, artifact_names: list[str]
) -> tuple[bool, list[str]]:
    """纯函数计分：返回（是否通过，未满足项清单）。"""
    reasons: list[str] = []
    text = summary or ""
    for needle in expect.get("contains") or []:
        if str(needle) not in text:
            reasons.append(f"摘要缺少「{needle}」")
    if expect.get("regex"):
        if not re.search(str(expect["regex"]), text, re.S):
            reasons.append(f"摘要不匹配 /{expect['regex']}/")
    for name in expect.get("artifacts") or []:
        if str(name) not in artifact_names:
            reasons.append(f"缺少交付物「{name}」")
    return (not reasons, reasons)


def report_path(name: str, version: str | None) -> Path:
    d = milo_home() / "eval-reports"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{name}@{version or '0'}.json"


def save_report(report: dict[str, Any]) -> Path:
    p = report_path(report["pack"], report.get("version"))
    p.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


def load_report(name: str, version: str | None) -> dict[str, Any] | None:
    p = report_path(name, version)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 —— 坏报告等同没有报告，不让市场页挂掉
        return None


async def run_smoke(
    pack_dir: Path,
    *,
    model: dict[str, Any],
    secrets: dict[str, str],
    default_timeout: float = 300,
    on_progress=None,
) -> dict[str, Any]:
    """对一个 MiloPack 跑冒烟评测并写报告。

    在临时目录渲染一个一次性成员实例（与任何组织隔离，评测不留痕于编制），
    逐案例派单并按 expect 断言交付。
    """
    import tempfile

    from milod.adapter.subprocess_adapter import SubprocessAdapter
    from milod.pack.renderer import load_manifest, render

    manifest = load_manifest(pack_dir)
    suite = load_suite(pack_dir)
    results: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory(prefix="milo-eval-") as tmp:
        spec = render(org_root=Path(tmp), pack_dir=pack_dir,
                      member_name=f"eval-{manifest['name']}", model=model, secrets=secrets)
        adapter = SubprocessAdapter()
        await adapter.enroll(spec)
        try:
            for case in suite["cases"]:
                expect = case.get("expect") or {}
                env = TaskEnvelope(
                    capability=(manifest.get("capabilities") or [{}])[0].get("id", "eval"),
                    objective=str(case["prompt"]),
                    output_spec=OutputSpec(format="text",
                                           artifacts=[str(a) for a in expect.get("artifacts") or []]),
                    constraints=["这是自动化评测：不要提问或请示，独立完成并直接交付"],
                )
                outcome = await _run_case(adapter, env,
                                          timeout=float(expect.get("timeout", default_timeout)))
                if outcome["settled"] == "delivery":
                    passed, reasons = score_case(expect, outcome["summary"], outcome["artifacts"])
                else:
                    passed, reasons = False, [outcome["reason"]]
                results.append({"id": case["id"], "passed": passed, "reasons": reasons})
                if on_progress:
                    on_progress(case["id"], passed, reasons)
        finally:
            await adapter.dismiss()

    total, ok = len(results), sum(1 for r in results if r["passed"])
    score = round(5 * ok / total, 2)
    min_score = float((manifest.get("eval") or {}).get("min_score") or 0)
    report = {
        "pack": manifest["name"],
        "version": manifest.get("version"),
        "suite": "eval/smoke.yaml",
        "ran_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": model.get("name"),
        "cases_total": total,
        "cases_passed": ok,
        "score": score,           # 5 分制，对齐 manifest.eval.min_score
        "min_score": min_score,
        "meets_min": score >= min_score,
        "cases": results,
    }
    save_report(report)
    return report


async def _run_case(adapter, env: TaskEnvelope, *, timeout: float) -> dict[str, Any]:
    """派单一个案例并等它落定：交付 → 取 Delivery；升级/超时 → 判不通过。"""
    await adapter.assign(env)
    events = adapter.events()
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        remain = deadline - asyncio.get_event_loop().time()
        if remain <= 0:
            return {"settled": "timeout", "reason": f"超时（>{timeout:.0f}s）未交付"}
        try:
            ev = await asyncio.wait_for(anext(events), timeout=remain)
        except (StopAsyncIteration, asyncio.TimeoutError):
            return {"settled": "timeout", "reason": f"超时（>{timeout:.0f}s）未交付"}
        if ev.task_id != env.task_id:
            continue
        if ev.type == EventType.ESCALATION:
            q = str((ev.payload or {}).get("question") or "")[:80]
            return {"settled": "escalation",
                    "reason": f"评测中升级请示（应独立完成）：{q}"}
        if ev.type == EventType.DELIVERY:
            d = await adapter.deliver(env.task_id)
            return {"settled": "delivery", "summary": d.summary,
                    "artifacts": [a.name for a in d.artifacts]}

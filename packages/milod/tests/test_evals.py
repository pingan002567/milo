"""质检冒烟回归测试：计分纯函数 · 评测集校验 · 报告读写 · 市场附带。

运行：PYTHONPATH=packages/milod/src python packages/milod/tests/test_evals.py
"""
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from milod.evals.smoke import (  # noqa: E402
    SuiteError, load_report, load_suite, save_report, score_case,
)

# ---- score_case：纯函数计分 ----------------------------------------------
passed, reasons = score_case({"contains": ["SMOKE-OK"]}, "清单…\nSMOKE-OK", [])
assert passed and reasons == [], (passed, reasons)

passed, reasons = score_case({"contains": ["SMOKE-OK", "缺这个"]}, "只有 SMOKE-OK", [])
assert not passed and len(reasons) == 1 and "缺这个" in reasons[0], reasons

passed, reasons = score_case({"regex": r"\(\d{4}\)"}, "Wang, L. (2024). Title.", [])
assert passed, reasons
passed, reasons = score_case({"regex": r"\(\d{4}\)"}, "没有年份", [])
assert not passed and "不匹配" in reasons[0], reasons

passed, reasons = score_case({"artifacts": ["report.md"]}, "", ["report.md", "extra.txt"])
assert passed, reasons
passed, reasons = score_case({"artifacts": ["report.md"]}, "", [])
assert not passed and "report.md" in reasons[0], reasons

# 组合：多项不满足要逐条报出，而非只报第一条
passed, reasons = score_case(
    {"contains": ["A"], "regex": "B", "artifacts": ["c.md"]}, "x", [])
assert not passed and len(reasons) == 3, reasons
print("✅ score_case 七场景")

# ---- load_suite：格式校验 -------------------------------------------------
with tempfile.TemporaryDirectory() as tmp:
    pack = Path(tmp)
    try:
        load_suite(pack)
        raise AssertionError("缺文件应报 SuiteError")
    except SuiteError:
        pass
    (pack / "eval").mkdir()
    (pack / "eval" / "smoke.yaml").write_text("suite: smoke\ncases: []\n", encoding="utf-8")
    try:
        load_suite(pack)
        raise AssertionError("空 cases 应报 SuiteError")
    except SuiteError:
        pass
    (pack / "eval" / "smoke.yaml").write_text(
        "cases:\n  - id: a\n    prompt: p\n    expect: {contains: [x]}\n", encoding="utf-8")
    suite = load_suite(pack)
    assert suite["cases"][0]["id"] == "a"
print("✅ load_suite 三场景")

# ---- 报告读写（隔离 MILO_HOME，不碰真实 ~/.milo）--------------------------
with tempfile.TemporaryDirectory() as tmp:
    os.environ["MILO_HOME"] = tmp
    report = {"pack": "demo-pack", "version": "1.2.0", "score": 5.0,
              "cases_total": 2, "cases_passed": 2, "meets_min": True,
              "ran_at": "2026-07-19T00:00:00+00:00", "min_score": 4.0, "cases": []}
    p = save_report(report)
    assert p == Path(tmp) / "eval-reports" / "demo-pack@1.2.0.json", p
    assert load_report("demo-pack", "1.2.0")["score"] == 5.0
    assert load_report("demo-pack", "9.9.9") is None      # 版本不匹配 = 未实测
    p.write_text("{broken", encoding="utf-8")             # 坏报告 = 未实测，不抛
    assert load_report("demo-pack", "1.2.0") is None
    del os.environ["MILO_HOME"]
print("✅ 报告读写四场景")

# ---- 市场 API 附带报告（enroll→报告存在→eval_report 非空）------------------
with tempfile.TemporaryDirectory() as tmp:
    os.environ["MILO_HOME"] = tmp
    os.environ["MILO_PACKS"] = str(Path(tmp) / "packs")
    src_pack = Path(__file__).resolve().parents[3] / "spikes" / "02-enroll-render" / "pack"
    import shutil
    shutil.copytree(src_pack, Path(tmp) / "packs" / "lit-scout")
    save_report({"pack": "lit-scout", "version": "0.1.0", "score": 5.0,
                 "cases_total": 2, "cases_passed": 2, "meets_min": True,
                 "ran_at": "2026-07-19T00:00:00+00:00", "min_score": 4.0, "cases": []})

    import asyncio
    from milod.api.server import market
    packs = asyncio.run(market())["packs"]
    assert len(packs) == 1 and packs[0]["name"] == "lit-scout", packs
    r = packs[0]["eval_report"]
    assert r and r["score"] == 5.0 and r["meets_min"] is True, r
    assert packs[0]["eval"]["min_score"] == 4.0  # 自报门槛仍单独保留
    del os.environ["MILO_HOME"], os.environ["MILO_PACKS"]
print("✅ 市场附带实测报告")

print("\n全部通过")

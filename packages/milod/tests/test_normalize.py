"""归一化回归测试：human_input 载荷提取 · 半截等待 · 兜底上报 · 信任边界。

运行：PYTHONPATH=packages/milod/src python packages/milod/tests/test_normalize.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from milod.adapter.normalize import find_clarification_args, escalation_payload, iter_normalized
from milod.models import EscalationPayload
from dataclasses import dataclass
from typing import Any

@dataclass
class SE:
    type: str
    data: dict

# 场景 A：最终 ToolMessage（含 harness 规范化的 human_input，带 options）
tool_msg = {
    "type": "tool", "name": "ask_clarification",
    "content": "⚠️ 该操作不可逆\n\n确认删除生产数据？\n\n1. 确认删除\n2. 取消",
    "artifact": {"human_input": {
        "version": 1, "kind": "human_input_request", "source": "ask_clarification",
        "request_id": "clarification:call_abc", "tool_call_id": "call_abc",
        "clarification_type": "risk_confirmation",
        "question": "确认删除生产数据？", "context": "该操作不可逆",
        "input_mode": "choice_with_other",
        "options": [{"id": "option-1", "label": "确认删除", "value": "确认删除"},
                    {"id": "option-2", "label": "取消", "value": "取消"}],
    }},
}
p = EscalationPayload.model_validate(escalation_payload(find_clarification_args(tool_msg)))
print("【A · 最终 ToolMessage】")
print(f"  question   : {p.question}")
print(f"  policy     : {p.policy}  (risk_confirmation → risky-action)")
print(f"  reversible : {p.dimensions['reversible']}  (危险动作应为 False)")
print(f"  input_mode : {p.input_mode}")
print(f"  options    : {[(o.id, o.label) for o in p.options]}")
print(f"  request_id : {p.request_id}  (待办幂等键)")
print(f"  fallback   : {p.fallback_text[:20]}…")

# 场景 B：半截流式 tool_call —— 不应立即上报
partial = SE("messages-tuple", {"type": "ai", "content": "",
             "tool_calls": [{"name": "ask_clarification", "args": {}, "id": "call_x"}]})
final = SE("values", {"messages": [tool_msg]})
end = SE("end", {"usage": {"total_tokens": 100}})
frames = list(iter_normalized([partial, final, end], task_id="t-1"))
print("\n【B · 半截 tool_call → 等完整载荷】")
print(f"  事件序列: {[f.event for f in frames]}")
esc = [f for f in frames if f.event == "escalation"]
print(f"  升级仅 1 条且 question 完整: {'✅' if len(esc)==1 and esc[0].payload['question'] else '❌'}")

# 场景 C：只有半截、始终没等到完整 —— 兜底仍须上报，避免静默卡死
frames = list(iter_normalized([partial, end], task_id="t-2"))
esc = [f for f in frames if f.event == "escalation"]
print("\n【C · 载荷始终不完整 → 兜底上报】")
print(f"  事件序列: {[f.event for f in frames]}")
print(f"  仍上报升级（不静默卡死）: {'✅' if esc else '❌'}")

# 场景 E：options 是未解析的 JSON 字符串（流式增量）——不得逐字符拆成选项
for raw, expect_n, label in [
    ('["科技产品","教育软件"]', 2, "完整 JSON 字符串"),
    ('["科技产品","教育', 0, "半截 JSON（宁可无选项也不产乱码）"),
    (["A", "B"], 2, "已是列表"),
    ("单个选项", 1, "裸字符串"),
    (None, 0, "缺省"),
]:
    p = EscalationPayload.model_validate(escalation_payload({"question": "q", "options": raw}))
    ok = len(p.options) == expect_n
    print(f"\n【E · {label}】选项数 {len(p.options)}（期望 {expect_n}）: {'✅' if ok else '❌'}")
    if p.options:
        print(f"  → {[o.label for o in p.options][:3]}")

# 场景 D：自然语言提问不触发（信任边界）
plain = SE("messages-tuple", {"type": "ai", "content": "请问您指的是哪个文件？需要我继续吗？"})
frames = list(iter_normalized([plain, end], task_id="t-3"))
print("\n【D · 自然语言提问（信任边界）】")
print(f"  事件序列: {[f.event for f in frames]}")
print(f"  未产生 escalation: {'✅' if not any(f.event=='escalation' for f in frames) else '❌'}")

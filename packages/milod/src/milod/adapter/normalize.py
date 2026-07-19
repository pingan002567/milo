"""harness StreamEvent → Milo 事件的归一化（SPIKE-01/02 实测规则）。

信任边界在此层执行：
- 只有结构化信号（ask_clarification 工具调用）能产生 ESCALATION；
- 成员正文一律作为不可信数据放进 payload，绝不由文本内容推导事件类型。
"""
from __future__ import annotations

import json
import re
from collections.abc import Iterable, Iterator
from typing import Any

from milod.adapter.protocol import EventFrame

#: harness 内置澄清工具；ClarificationMiddleware 拦截后中断执行等待用户（SPIKE-02）
CLARIFICATION_TOOL = "ask_clarification"

#: clarification_type → Milo 升级策略分类（编制设计 §5.2 四维判定输入）
CLARIFICATION_POLICY = {
    "risk_confirmation": "risky-action",
    "approach_choice": "approach-choice",
    "ambiguous_requirement": "ambiguous-task",
    "missing_info": "missing-info",
    "suggestion": "suggestion",
}

#: 兜底：成员主动输出的自定义结构化块（实测成员不会自发照做，仅兼容）
ESCALATE_MARKER = "MILO_ESCALATE"
_ESCALATE_RE = re.compile(
    rf"```(?:json|yaml)?\s*{ESCALATE_MARKER}\s*(?P<body>\{{.*?\}})\s*```", re.DOTALL
)


def find_clarification_args(data: dict[str, Any]) -> dict[str, Any] | None:
    """定位澄清请求的载荷（SPIKE-02 实测三处位置）。

    **优先取 ToolMessage 的 `artifact.human_input`**——harness 已把它规范化为
    `{kind: human_input_request, version, question, context, input_mode, options[{id,label,value}],
    request_id}` 的 UI 契约；从流式 tool_call.args 重建会丢结构，且增量未拼完时 question 为空。
    """
    # 1) 最终 ToolMessage：结构最全
    if data.get("name") == CLARIFICATION_TOOL:
        artifact = data.get("artifact")
        if isinstance(artifact, dict) and isinstance(artifact.get("human_input"), dict):
            return {**artifact["human_input"], "_fallback_text": str(data.get("content") or "")}
        return {"question": str(data.get("content") or ""), "_partial": True}
    # 2) 快照里的消息（递归找最终态）
    for m in data.get("messages") or []:
        if isinstance(m, dict):
            found = find_clarification_args(m)
            if found is not None:
                return found
    # 3) 流式 tool_call：可能只有半截 args，标记为 partial 供上层决定是否等待
    for tc in data.get("tool_calls") or []:
        if tc.get("name") == CLARIFICATION_TOOL:
            args = dict(tc.get("args") or {})
            return {**args, "_partial": True} if args else {"_partial": True}
    return None


def _coerce_options(raw: Any) -> list[Any]:
    """规范化 options。

    流式增量里它可能是尚未解析的 JSON 字符串（如 '["A","B"]'）——
    直接迭代会把字符串**逐字符**拆成选项（实测踩过：一句话变成 80 个选项）。
    """
    if raw is None:
        return []
    if isinstance(raw, str):
        s = raw.strip()
        if s.startswith("["):
            try:
                parsed = json.loads(s)
                return parsed if isinstance(parsed, list) else [s]
            except json.JSONDecodeError:
                return []  # 半截 JSON：宁可无选项，也不产出乱码
        return [s] if s else []
    if isinstance(raw, (list, tuple)):
        return list(raw)
    return []


def escalation_payload(args: dict[str, Any]) -> dict[str, Any]:
    """把 human_input_request 映射为 Milo 的 EscalationPayload 字段。"""
    ctype = str(args.get("clarification_type") or "missing_info")
    raw_options = _coerce_options(args.get("options"))
    options: list[dict[str, str]] = []
    for i, o in enumerate(raw_options, 1):
        if isinstance(o, dict):  # harness 已规范化为 {id,label,value}
            options.append({
                "id": str(o.get("id") or f"option-{i}"),
                "label": str(o.get("label") or o.get("value") or ""),
                "value": str(o.get("value") or o.get("label") or ""),
            })
        else:  # 兜底：自定义标记路径给的是纯字符串
            options.append({"id": f"option-{i}", "label": str(o), "value": str(o)})

    return {
        "question": str(args.get("question") or ""),
        "policy": CLARIFICATION_POLICY.get(ctype, ctype),
        "context": args.get("context"),
        "input_mode": str(args.get("input_mode") or ("choice_with_other" if options else "free_text")),
        "options": options,
        "request_id": args.get("request_id"),
        "dimensions": {
            "clarification_type": ctype,
            "reversible": ctype != "risk_confirmation",
        },
        "fallback_text": args.get("_fallback_text"),
    }


def parse_marker_escalation(text: str) -> dict[str, Any] | None:
    m = _ESCALATE_RE.search(text or "")
    if not m:
        return None
    try:
        return json.loads(m.group("body"))
    except json.JSONDecodeError:  # 畸形标记按"无升级"处理，绝不猜测意图
        return None


def iter_normalized(
    stream: Iterable[Any], *, task_id: str, status_min_chars: int = 120
) -> Iterator[EventFrame]:
    """把 harness 事件流转成 EventFrame 序列。

    规则（实测）：
      含 ask_clarification            -> escalation（并意味着 run 已中断等待答复）
      messages-tuple(ai, 无 tool_call) -> status（**按字数聚合节流**，见下）
      end                              -> system（用量）
      values 快照                      -> 取末条 ai 文本作为 delivery 摘要素材

    节流：harness 的 messages-tuple 是 token 级增量，逐条上抛会让任务群刷屏
    （实测一句话产生十余条）。这里累积到 status_min_chars 才发一条 status，
    落实"汇报是给人看的摘要，不是日志流"。
    """
    last_text = ""
    # 升级采用**终局判定**而非即时判定：resume 时 harness 会重放历史消息，
    # 其中包含已经答复过的 ask_clarification（tool_call 与 ToolMessage 都会再现）。
    # 若见到升级就立刻定性，重放会把整个 run 误标 interrupted、吞掉 delivery
    # （实测：评审员明明交了 review.md，任务却一直停在 input_required）。
    # 规则：升级信号先挂起（held）；其后又有新的 AI 产出 = 那次升级是历史/已答复，
    # 撤销挂起；只有流在挂起状态下结束，才是真的在等人。
    held: dict[str, Any] | None = None
    pending_escalation = False  # 见过半截 tool_call，等完整载荷
    buf: list[str] = []

    def flush_status() -> Iterator[EventFrame]:
        if buf:
            text = "".join(buf).strip()
            buf.clear()
            if text:
                yield EventFrame(
                    event="status",
                    task_id=task_id,
                    payload={"doing": text[:400], "why": "(untrusted member text)"},
                )

    for ev in stream:
        etype = getattr(ev, "type", None)
        data = getattr(ev, "data", None)
        if not isinstance(data, dict):
            continue

        args = find_clarification_args(data)
        if args is not None:
            # 半截 tool_call（question 为空）先记待定，等完整载荷；
            # 同一请示的完整 ToolMessage 载荷后到时直接覆盖（options 更全）
            if args.get("_partial") and not args.get("question"):
                pending_escalation = True
                continue
            held = escalation_payload(args)
            pending_escalation = False
            continue

        if etype == "messages-tuple" and data.get("type") == "ai":
            text = str(data.get("content") or "")
            if not text.strip():
                continue
            marker = parse_marker_escalation(text)
            if marker:
                held = marker
                continue
            if not data.get("tool_calls"):
                if held is not None or pending_escalation:
                    # 升级之后成员又有新产出 → 升级已被答复（重放场景），撤销
                    held = None
                    pending_escalation = False
                buf.append(text)
                if sum(len(x) for x in buf) >= status_min_chars:
                    yield from flush_status()

        elif etype == "values":
            for m in reversed(data.get("messages") or []):
                if isinstance(m, dict) and m.get("type") == "ai" and m.get("content"):
                    last_text = str(m["content"])
                    break

        elif etype == "end":
            yield from flush_status()
            # 只见半截 tool_call 却始终没等到完整载荷：仍需上报中断，否则任务会静默卡死
            if pending_escalation and held is None:
                held = escalation_payload(
                    {"question": last_text[:400] or "成员请求澄清（载荷不完整）"})
            if held is not None:
                yield EventFrame(event="escalation", task_id=task_id, payload=held)
            yield EventFrame(
                event="system",
                task_id=task_id,
                payload={"usage": data.get("usage", {}), "interrupted": held is not None},
            )
            if held is None:
                yield EventFrame(
                    event="delivery", task_id=task_id, payload={"summary": last_text[:2000]}
                )

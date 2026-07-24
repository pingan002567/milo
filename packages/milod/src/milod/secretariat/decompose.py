"""任务分解：秘书长**唯一**使用 LLM 的环节。

输出走 JSON Schema 强校验——模型只负责"理解意图"，产出的结构必须合法，
否则重试；绝不让自由文本直接驱动调度。
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from milod.models import Budget, OutputSpec, TaskEnvelope

PLAN_PROMPT = """你是一个组织的秘书，负责把组长的一句话需求分解为可派发的任务。

**可选能力 ID（capability 只能从这里选，逐字复制）：**
{caps}

（供参考的成员与其能力，成员名不是能力 ID、不要填进 capability）：
{roster}

组长的需求：{request}
{context}
请输出 JSON（不要任何解释文字），格式：
{{"steps": [
  {{"capability": "必须从上面能力列表中选择",
    "objective": "给成员的明确目标，含可验收的产出描述",
    "format": "markdown|text|json",
    "artifacts": ["产出文件名，可为空数组"],
    "constraints": ["边界约束，可为空数组"]}}
]}}

要求：
- 步骤数 ≤ {max_steps}，能一步完成就只给一步
- capability 必须精确匹配现有能力，不要发明新能力
- objective 要具体到可验收，不要复述组长原话
"""


@dataclass
class Roster:
    members: list[tuple[str, list[str]]]  # (成员名, 能力列表)

    def render(self) -> str:
        return "\n".join(f"- {n}：{'、'.join(caps)}" for n, caps in self.members) or "（暂无成员）"

    @property
    def capabilities(self) -> set[str]:
        return {c for _, caps in self.members for c in caps}


class DecomposeError(RuntimeError):
    pass


def _extract_json(text: str) -> dict[str, Any]:
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise DecomposeError(f"分解结果不含 JSON：{text[:200]}")
    return json.loads(m.group(0))


def build_prompt(request: str, roster: Roster, max_steps: int = 3,
                 *, context: str = "") -> str:
    caps = "\n".join(f"- {c}" for c in sorted(roster.capabilities)) or "（暂无可用能力）"
    # context 与 request 分列（不拼进 request）：让模型分清"要办的事"与"边界/背景"，
    # 避免约束被当成目标复述。来自秘书与负责人的对话澄清（P0-1）。
    ctx_block = (f"\n补充上下文（来自与负责人的对话，请据此确定目标与约束，"
                 f"但不要照抄进 objective）：\n{context.strip()}\n") if context.strip() else ""
    return PLAN_PROMPT.format(caps=caps, roster=roster.render(),
                              request=request, context=ctx_block, max_steps=max_steps)


def parse_plan(text: str, roster: Roster, *, group_id: str | None = None) -> list[TaskEnvelope]:
    """把模型输出解析为任务信封；能力越界即报错（不猜测、不放行）。"""
    data = _extract_json(text)
    steps = data.get("steps")
    if not isinstance(steps, list) or not steps:
        raise DecomposeError("分解结果缺少 steps")

    by_member = {n: caps for n, caps in roster.members}
    envelopes: list[TaskEnvelope] = []
    for i, s in enumerate(steps):
        cap = str(s.get("capability", "")).strip()
        if cap not in roster.capabilities:
            # 常见错误：模型把成员名填进 capability——自愈映射到该成员的首个能力
            if cap in by_member and by_member[cap]:
                cap = by_member[cap][0]
            else:
                raise DecomposeError(
                    f"第 {i + 1} 步能力 {cap!r} 不在现有能力集内；"
                    f"可选能力：{sorted(roster.capabilities)}")
        env = TaskEnvelope(
            capability=cap,
            objective=str(s.get("objective", "")).strip(),
            output_spec=OutputSpec(
                format=str(s.get("format") or "markdown"),
                artifacts=[str(a) for a in (s.get("artifacts") or [])],
            ),
            constraints=[str(c) for c in (s.get("constraints") or [])],
            budget=Budget(),
        )
        if group_id:
            env.parent_task = group_id
            env.context_id = group_id
        if not env.objective:
            raise DecomposeError(f"第 {i + 1} 步缺少 objective")
        envelopes.append(env)
    return envelopes

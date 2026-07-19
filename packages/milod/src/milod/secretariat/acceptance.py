"""验收：按任务信封的 output_spec 校验交付物。

校验依据来自**信封**而非成员自述——成员说"我做完了"不算数。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from milod.adapter.base import Delivery
from milod.models import TaskEnvelope


@dataclass
class Verdict:
    accepted: bool
    reasons: list[str] = field(default_factory=list)

    @property
    def summary(self) -> str:
        return "通过" if self.accepted else "退回：" + "；".join(self.reasons)


def check(envelope: TaskEnvelope, delivery: Delivery) -> Verdict:
    reasons: list[str] = []

    expected = set(envelope.output_spec.artifacts)
    got = {a.name for a in delivery.artifacts}
    missing = expected - got
    if missing:
        reasons.append(f"缺少产物：{sorted(missing)}")

    if not expected and not delivery.summary.strip():
        reasons.append("既无产物也无交付内容")

    return Verdict(accepted=not reasons, reasons=reasons)

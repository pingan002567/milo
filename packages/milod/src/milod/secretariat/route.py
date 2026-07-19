"""路由：任务信封 → 成员。**确定性代码，不用 LLM**。

v0 小组模式规则：capability 精确匹配 > 能力标签交集 > 无匹配则问组长。
（自定义 CEL 路由规则是 v1，部门是 v2。）
"""
from __future__ import annotations

from dataclasses import dataclass

from milod.models import TaskEnvelope


@dataclass(frozen=True)
class Candidate:
    name: str
    capabilities: tuple[str, ...]


class NoMemberForTask(Exception):
    """无人能接——按设计回问组长，绝不硬塞给不合适的成员。"""

    def __init__(self, capability: str, available: list[str]) -> None:
        super().__init__(f"没有成员声明能力 {capability!r}；现有能力：{available}")
        self.capability = capability
        self.available = available


def route(envelope: TaskEnvelope, members: list[Candidate], *, busy: set[str] | None = None) -> str:
    busy = busy or set()
    exact = [m for m in members if envelope.capability in m.capabilities]
    if not exact:
        raise NoMemberForTask(
            envelope.capability, sorted({c for m in members for c in m.capabilities})
        )
    idle = [m for m in exact if m.name not in busy]
    return (idle or exact)[0].name

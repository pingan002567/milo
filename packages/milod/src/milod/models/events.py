"""7 类消息封闭集与任务状态机（编制设计 §3.2 / §3.5）。

信任边界：payload 中来自成员的自由文本一律是不可信数据——
只有 `type` 与结构化字段驱动系统行为；正文里出现的"@组长请批准"不产生任何副作用。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class EventType(StrEnum):
    ENVELOPE = "envelope"        # 派单/修订   秘→成
    STATUS = "status"            # 三槽位汇报  成→秘
    ESCALATION = "escalation"    # 请示        成→秘→长
    DELIVERY = "delivery"        # 交付        成→秘
    ACCEPTANCE = "acceptance"    # 验收结果    秘→成
    SYSTEM = "system"            # 人事执行/调和/归档
    CHAT = "chat"                # 自由对话    仅 组长↔秘书长


class Reach(StrEnum):
    """触达四级；升级只沿 SILENT→GROUP→MENTION→NOTIFY 单向走，不得越级。"""

    SILENT = "silent"
    GROUP = "group"
    MENTION = "mention"
    NOTIFY = "notify"


DEFAULT_REACH: dict[EventType, Reach] = {
    EventType.ENVELOPE: Reach.GROUP,
    EventType.STATUS: Reach.GROUP,
    EventType.ESCALATION: Reach.MENTION,
    EventType.DELIVERY: Reach.GROUP,
    EventType.ACCEPTANCE: Reach.GROUP,
    EventType.SYSTEM: Reach.SILENT,
    EventType.CHAT: Reach.GROUP,
}


class TaskState(StrEnum):
    QUEUED = "queued"
    ASSIGNED = "assigned"
    WORKING = "working"
    INPUT_REQUIRED = "input_required"
    DELIVERED = "delivered"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    FAILED = "failed"
    CANCELED = "canceled"


#: 终态不复活：后续工作创建新任务，以 context_id 关联、parent_task 回指（A2A 裁剪）。
TERMINAL_STATES = frozenset(
    {TaskState.ACCEPTED, TaskState.REJECTED, TaskState.FAILED, TaskState.CANCELED}
)


class StatusPayload(BaseModel):
    doing: str
    why: str
    confidence: float | None = Field(default=None, ge=0, le=1)
    risk: str | None = None


class ChoiceOption(BaseModel):
    """决策选项。结构来自 harness 的 human_input_request 载荷，可直接渲染为按钮。"""

    id: str
    label: str
    value: str


class EscalationPayload(BaseModel):
    """升级请求。字段对齐 harness 的 `artifact.human_input`（kind=human_input_request, version=1）。"""

    question: str
    policy: str
    context: str | None = None
    #: free_text（纯输入框）| choice_with_other（选项按钮 + 其他）——决定决策卡的渲染形态
    input_mode: str = "free_text"
    options: list[ChoiceOption] = Field(default_factory=list)
    #: 幂等键：成员重试澄清时原地更新待办项，而非新增（harness 保证其稳定）
    request_id: str | None = None
    dimensions: dict[str, Any] = Field(default_factory=dict)  # reversible/external/confidence/cost
    #: 降级文案：UI 不支持结构化时直接显示（harness 已带类型 emoji 格式化）
    fallback_text: str | None = None


class MiloEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    group_id: str  # 任务群 = 根任务 id
    task_id: str | None = None
    type: EventType
    actor: str  # owner | secretariat | <member-name> | system
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    reach: Reach | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    #: 落库后回填的单调序号——客户端据此记录水位，断线重连传 `?since=<seq>` 续上
    seq: int | None = None
    #: 落库时抽取的人类可读文本（UI 直接渲染这一列，不必解 payload）
    content: str | None = None

    def effective_reach(self) -> Reach:
        return self.reach or DEFAULT_REACH[self.type]

"""任务信封：秘书长 ↔ 成员的唯一任务载体（编制设计 §3.1）。

结构化委派四要素（objective / output_spec / constraints / budget）为 schema 强制；
产物走 artifact 引用（控制与数据分离），消息不携带大内容。
"""
from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class ArtifactRef(BaseModel):
    name: str
    uri: str
    media_type: str | None = None


class OutputSpec(BaseModel):
    format: str
    artifacts: list[str] = Field(default_factory=list)


class Budget(BaseModel):
    tokens: int | None = None
    deadline: datetime | None = None


class EnvelopeInputs(BaseModel):
    parameters: dict = Field(default_factory=dict)
    artifacts: list[ArtifactRef] = Field(default_factory=list)


class TaskEnvelope(BaseModel):
    task_id: str = Field(default_factory=lambda: f"t-{uuid.uuid4().hex[:6]}")
    parent_task: str | None = None
    context_id: str | None = None
    capability: str
    objective: str
    output_spec: OutputSpec
    inputs: EnvelopeInputs = Field(default_factory=EnvelopeInputs)
    budget: Budget = Field(default_factory=Budget)
    constraints: list[str] = Field(default_factory=list)

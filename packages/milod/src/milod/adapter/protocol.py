"""主进程 ↔ 成员子进程的 stdio JSON-RPC 协议。

一行一条 JSON。主进程 → 子进程：请求（method/params/id）；
子进程 → 主进程：事件（event=…，流式）与响应（id/result|error）。

设计约束：
- 载荷只传意图与引用，不传大内容（artifact 走文件路径，控制与数据分离）。
- 子进程输出的一切文本都是不可信数据；只有 method/event 字段驱动主进程行为。
"""
from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, Field

Method = Literal["enroll", "assign", "deliver", "resume", "shutdown", "ping"]


class Request(BaseModel):
    id: str
    method: Method
    params: dict[str, Any] = Field(default_factory=dict)


class Response(BaseModel):
    id: str
    result: dict[str, Any] | None = None
    error: str | None = None


class EventFrame(BaseModel):
    """子进程推给主进程的归一化事件（对应 milod.models.MiloEvent 的负载部分）。"""

    event: Literal["status", "escalation", "delivery", "system"]
    task_id: str
    payload: dict[str, Any] = Field(default_factory=dict)


def encode(obj: BaseModel) -> str:
    return json.dumps(obj.model_dump(mode="json"), ensure_ascii=False)


def decode_line(line: str) -> Request | Response | EventFrame | None:
    """解析一行；无法识别的行（子进程的杂散 stdout）一律丢弃，不猜测语义。"""
    line = line.strip()
    if not line or not line.startswith("{"):
        return None
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        return None
    if "event" in data:
        try:
            return EventFrame.model_validate(data)
        except Exception:  # noqa: BLE001
            return None
    if "method" in data:
        try:
            return Request.model_validate(data)
        except Exception:  # noqa: BLE001
            return None
    if "id" in data:
        try:
            return Response.model_validate(data)
        except Exception:  # noqa: BLE001
            return None
    return None

"""SecretaryDesk：秘书实例的生命周期与对话通道（秘书Agent设计 §四）。

一个团队一个秘书：住 orgs/<org>/secretary/，复用成员的全套机制
（子进程隔离、checkpointer 记忆、事件归一化），差异只有三点：
persona 是内置 SecretaryPack、工具是 Milo Tools（本地回环 API）、
事件翻译进特殊任务群 group_id="secretary"（复用 events/WS/渲染零新基建）。
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from milod.adapter.subprocess_adapter import SubprocessAdapter
from milod.config.paths import org_dir
from milod.models import EventType, MiloEvent
from milod.pack.renderer import render

SECRETARY_GROUP = "secretary"
PACK_DIR = Path(__file__).parent / "pack"

#: Milo Tools 白名单（L0 只读 + L1 低危写；L2 提案是 S2）
MILO_TOOLS = [
    {"name": n, "group": "milo", "use": f"milod.secretary.tools:{n}_tool"}
    for n in (
        "team_status", "list_task_groups", "get_task_group", "list_pending_decisions",
        "browse_market", "list_agent_library",
        "create_task_group", "download_template",
    )
]


class SecretaryDesk:
    def __init__(self, org: str, *, api_base: str, emit) -> None:
        self.org = org
        self._api_base = api_base
        self._emit = emit  # office._emit：落库 + 广播
        self._adapter: SubprocessAdapter | None = None
        self._pump_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    async def ensure_started(self, *, model: dict, secrets: dict[str, str]) -> None:
        async with self._lock:
            if self._adapter is not None:
                return
            spec = render(
                org_root=org_dir(self.org),
                pack_dir=PACK_DIR,
                member_name="secretary",
                model=model,
                secrets=secrets,
                extra_tools=MILO_TOOLS,
                workdir=org_dir(self.org) / "secretary",
                # 系统组件的权限固定（readonly/禁网/无 bash），不随本地默认设置走
                snapshot={"permissions": {"network": [], "filesystem": "readonly",
                                          "python_repl": False}},
            )
            # 工具经本地回环调 milod API：权限面恒等于 API 面
            spec.extra_env = {"MILO_API_BASE": self._api_base, "MILO_ORG": self.org}
            adapter = SubprocessAdapter()
            await adapter.enroll(spec)
            self._adapter = adapter
            self._pump_task = asyncio.create_task(self._pump())

    async def chat(self, text: str) -> None:
        """用户发话：落 owner 事件，转给秘书实例（常驻线程，记忆延续）。"""
        assert self._adapter is not None, "secretary not started"
        self._emit(MiloEvent(
            group_id=SECRETARY_GROUP, type=EventType.CHAT, actor="owner",
            payload={"text": text}))
        await self._adapter.chat(text, group_id=SECRETARY_GROUP)

    async def cancel(self) -> None:
        """停止秘书当前回合。"""
        if self._adapter is not None:
            await self._adapter.cancel("chat")

    async def reset(self) -> None:
        """重置秘书对话（清空历史；工具与人设不变）。"""
        if self._adapter is not None:
            await self._adapter.reset("chat")
        self._emit(MiloEvent(
            group_id=SECRETARY_GROUP, type=EventType.SYSTEM, actor="system",
            payload={"msg": "对话已重置", "reset": True}))

    async def close(self) -> None:
        if self._pump_task:
            self._pump_task.cancel()
        if self._adapter:
            await self._adapter.dismiss()
            self._adapter = None

    async def _pump(self) -> None:
        """把秘书实例的归一化事件翻译成对话事件。

        对话语境下的语义映射：交付=一次回复；请示=秘书向用户提问（也是回复，
        对话里没有"任务卡住"概念）；status 原样过（UI 作"正在输入"）。
        """
        assert self._adapter is not None
        async for ev in self._adapter.events():
            if ev.type == EventType.STATUS:
                self._emit(MiloEvent(
                    group_id=SECRETARY_GROUP, type=EventType.STATUS,
                    actor="secretariat", payload=ev.payload))
            elif ev.type in (EventType.DELIVERY, EventType.ESCALATION):
                text = str(ev.payload.get("summary") or ev.payload.get("question") or "").strip()
                if text:
                    self._emit(MiloEvent(
                        group_id=SECRETARY_GROUP, type=EventType.CHAT,
                        actor="secretariat", payload={"text": text}))
            elif ev.type == EventType.SYSTEM and ev.payload.get("aborted"):
                self._emit(MiloEvent(
                    group_id=SECRETARY_GROUP, type=EventType.CHAT, actor="secretariat",
                    payload={"text": "（已停止）", "aborted": True}))
            # 其余 system（用量）不进对话流

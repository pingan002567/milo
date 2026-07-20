"""SubprocessAdapter：每成员一子进程（M1 正式实现）。

为什么不是同进程（SPIKE-02 实测）：harness 的 `_app_config` 是进程级单例，
后构造的 client 会覆盖先前成员的全局配置；`get_paths()` 又按环境变量动态解析。
子进程方案仍属轻量（无 Docker），但拿回独立配置/环境/内存/崩溃域。
"""
from __future__ import annotations

import asyncio
import sys
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

from milod.adapter.base import Delivery, MemberAdapter, MemberSpec
from milod.adapter.protocol import EventFrame, Request, Response, decode_line, encode
from milod.models import ArtifactRef, EventType, MiloEvent, TaskEnvelope

_EVENT_TYPE = {
    "status": EventType.STATUS,
    "escalation": EventType.ESCALATION,
    "delivery": EventType.DELIVERY,
    "system": EventType.SYSTEM,
}


class SubprocessAdapter(MemberAdapter):
    def __init__(self, *, python: str | None = None) -> None:
        self._python = python or sys.executable
        self._proc: asyncio.subprocess.Process | None = None
        self._spec: MemberSpec | None = None
        self._pending: dict[str, asyncio.Future] = {}
        self._events: asyncio.Queue[MiloEvent] = asyncio.Queue()
        self._reader: asyncio.Task | None = None
        self._group_of: dict[str, str] = {}   # task_id -> group_id
        self._expected_artifacts: dict[str, list[str]] = {}  # task_id -> output_spec.artifacts
        self._summaries: dict[str, str] = {}  # task_id -> 最近一次交付摘要
        self._stopped: set[str] = set()       # 已被用户停止的通道（丢弃残余事件）

    # ---- 生命周期 ------------------------------------------------------
    async def enroll(self, spec: MemberSpec) -> None:
        self._spec = spec
        home = spec.workdir / "home"
        env = {
            # 成员私有工作区：每成员一套，绝不共用（DEER_FLOW_HOME 内含 threads/memory）
            "DEER_FLOW_CONFIG_PATH": str(spec.workdir / "config.yaml"),
            "DEER_FLOW_HOME": str(home),
            "PATH": _env_passthrough("PATH"),
            "PYTHONPATH": _env_passthrough("PYTHONPATH"),
            "PYTHONUNBUFFERED": "1",
            # 密钥最小注入：只给该成员档位所需的凭证（编制设计 §3.4 隔离层"密钥"）
            **spec.secrets,
            **spec.extra_env,
        }
        self._proc = await asyncio.create_subprocess_exec(
            self._python, "-m", "milod.adapter.worker",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        self._reader = asyncio.create_task(self._read_loop())
        await self._call("enroll", {"member": spec.name,
                                    "agent_name": spec.runtime_name or spec.name,
                                    "workdir": str(spec.workdir)})

    async def dismiss(self) -> None:
        if self._proc and self._proc.returncode is None:
            try:
                await asyncio.wait_for(self._call("shutdown", {}), timeout=5)
            except (TimeoutError, Exception):  # noqa: BLE001
                self._proc.kill()
        if self._reader:
            self._reader.cancel()
        self._proc = None

    # ---- 合同动作 ------------------------------------------------------
    async def assign(self, envelope: TaskEnvelope) -> str:
        self._group_of[envelope.task_id] = envelope.parent_task or envelope.task_id
        self._expected_artifacts[envelope.task_id] = list(envelope.output_spec.artifacts)
        res = await self._call(
            "assign", {"task_id": envelope.task_id, "prompt": render_envelope(envelope),
                       # artifact 引用授权：worker 把这些文件注入成员输入目录
                       "inputs": [{"name": a.name, "uri": a.uri}
                                  for a in envelope.inputs.artifacts]}
        )
        return str(res.get("thread_id", envelope.task_id))

    async def resume(self, task_id: str, answer: str, *, group_id: str | None = None) -> None:
        """组长答复后恢复被 ask_clarification 中断的任务。

        group_id 必须随 resume 补注册：milod 重启后 _group_of 是空的，
        缺了它事件会回落用 task_id 当群号，在 groups 表里长出幽灵群。
        """
        if group_id:
            self._group_of[task_id] = group_id
        await self._call("resume", {"task_id": task_id, "answer": answer})

    async def chat(self, text: str, *, group_id: str = "secretary",
                   channel: str = "chat", attachments: list[dict] | None = None) -> None:
        self._stopped.discard(channel)   # 新一轮：解除上次停止的拦截
        """自由对话通道（秘书对话 / 成员私聊共用）：每通道一条常驻线程。

        首条消息 assign 建线程，后续 resume 接续——worker 重启后 assign 复用
        同一 thread_id，checkpoint 仍在，对话记忆跨重启延续。
        """
        self._group_of[channel] = group_id
        started: set[str] = getattr(self, "_chat_channels", None) or set()
        self._chat_channels = started
        if channel in started:
            await self._call("resume", {"task_id": channel, "answer": text,
                                        "inputs": attachments or []})
        else:
            started.add(channel)
            await self._call("assign", {"task_id": channel, "prompt": text,
                                        "inputs": attachments or []})

    async def cancel(self, task_id: str) -> None:
        """停止该通道当前回合。

        两层：①给 worker 发 cancel（它在下一次事件迭代时 break——harness 的同步
        生成器卡在网络 I/O 时无法硬中断）；②**适配层立刻拦截**该通道后续事件并
        当场发出 aborted，保证用户看到确定的停止，不必等 harness 醒过来。
        语义诚实：前台立即停止，后台尽力中断（残余 token 会被丢弃）。
        """
        self._stopped.add(task_id)
        await self._events.put(MiloEvent(
            group_id=self._group_of.get(task_id, task_id), task_id=task_id,
            type=EventType.SYSTEM, actor=self._spec.name if self._spec else "member",
            payload={"aborted": True, "msg": "已停止"}))
        try:
            await asyncio.wait_for(self._call("cancel", {"task_id": task_id}), timeout=3)
        except Exception:  # noqa: BLE001 —— worker 忙时收不到也无妨，拦截已生效
            pass

    async def events(self) -> AsyncIterator[MiloEvent]:  # type: ignore[override]
        while True:
            yield await self._events.get()

    async def deliver(self, task_id: str) -> Delivery:
        spec = self._spec
        dest = (spec.workdir.parent.parent / "artifacts" / task_id) if spec else Path("artifacts")
        res = await self._call(
            "deliver",
            {"task_id": task_id, "dest_dir": str(dest), "artifacts": self._expected(task_id)},
        )
        arts = [
            ArtifactRef(name=a["name"], uri=a["uri"], media_type=a.get("media_type"))
            for a in res.get("artifacts", [])
            if a.get("uri")
        ]
        return Delivery(
            task_id=task_id,
            summary=res.get("summary") or self._summaries.get(task_id, ""),
            artifacts=arts,
        )

    # ---- 内部 ----------------------------------------------------------
    def _expected(self, task_id: str) -> list[str]:
        """交付物清单来自任务信封的 output_spec——验收按此校验，不接受成员自定义。"""
        return self._expected_artifacts.get(task_id, [])

    async def _call(self, method: str, params: dict) -> dict:
        assert self._proc and self._proc.stdin
        req = Request(id=uuid.uuid4().hex[:8], method=method, params=params)  # type: ignore[arg-type]
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[req.id] = fut
        self._proc.stdin.write((encode(req) + "\n").encode())
        await self._proc.stdin.drain()
        res: Response = await fut
        if res.error:
            raise RuntimeError(f"member {self._spec.name if self._spec else '?'}: {res.error}")
        return res.result or {}

    async def _read_loop(self) -> None:
        assert self._proc and self._proc.stdout
        async for raw in self._proc.stdout:
            msg = decode_line(raw.decode("utf-8", "replace"))
            if isinstance(msg, Response):
                fut = self._pending.pop(msg.id, None)
                if fut and not fut.done():
                    fut.set_result(msg)
            elif isinstance(msg, EventFrame):
                # 交付摘要只在事件流里出现（worker 的 deliver RPC 只回 artifact 文件），
                # 在此接住供 deliver() 组装 —— 否则验收会误判"既无产物也无交付内容"
                if msg.task_id in self._stopped:
                    # 用户已停止该通道：丢弃残余事件；worker 侧的终局帧解除拦截
                    if msg.event == "system" and msg.payload.get("aborted"):
                        self._stopped.discard(msg.task_id)
                    continue
                if msg.event == "delivery":
                    summary = str(msg.payload.get("summary") or "")
                    if summary:
                        self._summaries[msg.task_id] = summary
                await self._events.put(self._to_milo_event(msg))

    def _to_milo_event(self, frame: EventFrame) -> MiloEvent:
        return MiloEvent(
            group_id=self._group_of.get(frame.task_id, frame.task_id),
            task_id=frame.task_id,
            type=_EVENT_TYPE[frame.event],
            actor=self._spec.name if self._spec else "member",
            payload=frame.payload,
        )


def _env_passthrough(key: str) -> str:
    import os

    return os.environ.get(key, "")


def render_envelope(envelope: TaskEnvelope) -> str:
    """任务信封 → 成员可读指令（结构化委派四要素显式呈现）。"""
    lines = [
        f"# 任务 {envelope.task_id}",
        f"## 目标\n{envelope.objective}",
        f"## 交付要求\n格式：{envelope.output_spec.format}",
    ]
    if envelope.output_spec.artifacts:
        lines.append(
            "产物文件：" + "、".join(envelope.output_spec.artifacts)
            + "\n（用 write_file 工具写到 /mnt/user-data/outputs/ 目录下的同名文件，"
            "正文只写交付摘要——只贴在正文里的内容不算交付，验收会退回）"
        )
    if envelope.constraints:
        lines.append("## 边界\n" + "\n".join(f"- {c}" for c in envelope.constraints))
    if envelope.inputs.artifacts:
        # 成员看到的是自己沙箱内的虚拟路径（授权注入后的位置），不是组织侧的宿主路径
        lines.append(
            "## 输入材料（已放入你的输入目录，用 read_file 读取）\n"
            + "\n".join(f"- /mnt/user-data/uploads/{a.name}" for a in envelope.inputs.artifacts)
        )
    if envelope.budget.tokens:
        lines.append(f"## 预算\n{envelope.budget.tokens} tokens")
    lines.append(
        "\n## 升级约定\n"
        "需要组长决策时（缺信息 / 需求歧义 / 路线二选一 / 危险动作确认），"
        "调用 `ask_clarification` 工具——**在正文里用自然语言提问不会送达任何人**，任务会卡住。"
    )
    return "\n\n".join(lines)

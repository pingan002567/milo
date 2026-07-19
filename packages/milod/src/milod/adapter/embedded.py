"""EmbeddedAdapter：进程内成员（DeerFlowClient）。

依赖 extras 安装：pip install "milod[deerflow]"

SPIKE-01 已验证（见 spikes/01-escalate-events/REPORT.md）：
  · stream(message: str, *, thread_id=None) -> Generator[StreamEvent]（同步）
  · StreamEvent = {type: values|messages-tuple|custom|end, data}
  · values.data = {title, messages, artifacts}；权威输出 = messages[-1]（ai）
  · end.data = {usage: {...}}
  · escalate 无独立事件类型 -> 采用「契约化标记」方案（下方 ESCALATE_MARKER）
  · plan_mode 不产生阻塞审批 -> 计划前置授权由秘书长在 Milo 侧实现，不依赖运行时
"""
from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator, Iterator
from typing import Any

from milod.adapter.base import Delivery, MemberAdapter, MemberSpec
from milod.models import (
    ArtifactRef,
    EscalationPayload,
    EventType,
    MiloEvent,
    StatusPayload,
    TaskEnvelope,
)

try:  # deerflow-harness 为可选依赖
    from deerflow.client import DeerFlowClient  # type: ignore
except ImportError:  # pragma: no cover
    DeerFlowClient = None  # noqa: N816


#: 主升级信号：harness 内置的 ask_clarification 工具（SPIKE-02 验证）。
#: ClarificationMiddleware 拦截该工具调用 -> ToolMessage(name=CLARIFICATION_TOOL,
#: artifact={"human_input": ...}) + Command(goto=END) 中断执行等待用户答复。
#: 由运行时中间件保证，不依赖成员"照人设办事"。
CLARIFICATION_TOOL = "ask_clarification"

#: clarification_type -> Milo 升级策略分类（编制设计 §5.2 四维判定的输入）
CLARIFICATION_POLICY = {
    "risk_confirmation": "risky-action",        # 危险动作 -> block 类
    "approach_choice": "approach-choice",       # 路线二选一 -> escalate
    "ambiguous_requirement": "ambiguous-task",  # 需求歧义 -> escalate
    "missing_info": "missing-info",             # 缺信息 -> escalate
    "suggestion": "suggestion",                 # 建议 -> warn（可静默记录）
}

#: 兼容兜底：成员主动输出的自定义结构化块（SPIKE-02 实测成员不会自发照做，故仅作兜底）。
#: 信任边界不变：正文里的自然语言提问**不触发**升级。
ESCALATE_MARKER = "MILO_ESCALATE"
_ESCALATE_RE = re.compile(
    rf"```(?:json|yaml)?\s*{ESCALATE_MARKER}\s*(?P<body>\{{.*?\}})\s*```",
    re.DOTALL,
)


def parse_escalation(text: str) -> EscalationPayload | None:
    """兜底路径：从成员输出中提取自定义结构化块；无标记返回 None。"""
    m = _ESCALATE_RE.search(text or "")
    if not m:
        return None
    try:
        return EscalationPayload.model_validate(json.loads(m.group("body")))
    except Exception:  # noqa: BLE001 —— 畸形标记按"无升级"处理，绝不猜测意图
        return None


def escalation_from_clarification(args: dict[str, Any]) -> EscalationPayload:
    """主路径：把 ask_clarification 的工具参数映射为 Milo 升级请求（SPIKE-02）。"""
    ctype = str(args.get("clarification_type") or "missing_info")
    return EscalationPayload(
        question=str(args.get("question") or ""),
        policy=CLARIFICATION_POLICY.get(ctype, ctype),
        dimensions={
            "clarification_type": ctype,
            # risk_confirmation 即"不可逆/有副作用"的运行时自陈，交由策略引擎四维判定
            "reversible": ctype != "risk_confirmation",
            "context": args.get("context"),
        },
        alternatives=list(args.get("options") or []),
    )


class EmbeddedAdapter(MemberAdapter):
    """一个成员 = 一个 DeerFlowClient + 一份渲染好的工作区（目录级隔离）。"""

    def __init__(self) -> None:
        if DeerFlowClient is None:
            raise RuntimeError(
                "deerflow-harness 未安装：pip install 'milod[deerflow]'（见 pyproject extras）"
            )
        self._client: Any = None
        self._spec: MemberSpec | None = None
        self._threads: dict[str, str] = {}  # task_id -> thread_id

    # ---- 合同六动作 ----------------------------------------------------
    async def enroll(self, spec: MemberSpec) -> None:
        """构造进程内实例。工作区由 pack 渲染器预先产出（config.yaml/SOUL.md/skills）。

        注意：harness 通过 DEER_FLOW_CONFIG_PATH 或 config_path 定位配置（SPIKE-01 实测）。
        """
        self._spec = spec
        self._client = DeerFlowClient(
            config_path=str(spec.workdir / "config.yaml"),
            agent_name=spec.name,
            # TODO(M1): 传入 SQLite checkpointer——无 checkpointer 时每次调用无状态，
            #           组长在群里补充信息将无法接续上下文（SPIKE-01 结论 3）。
            checkpointer=None,
        )

    async def assign(self, envelope: TaskEnvelope) -> str:
        thread_id = f"{self._spec.name}-{envelope.task_id}" if self._spec else envelope.task_id
        self._threads[envelope.task_id] = thread_id
        return thread_id

    def stream_task(self, envelope: TaskEnvelope) -> Iterator[MiloEvent]:
        """同步事件流：把 StreamEvent 归一化为 Milo 的 7 类消息。

        归一化规则（SPIKE-01）：
          messages-tuple + 含 ESCALATE 标记 -> ESCALATION
          messages-tuple(ai, 无 tool_calls)  -> STATUS（三槽位由秘书长侧补全/降级填充）
          values 末条 ai + artifacts         -> DELIVERY 的素材
          end                                -> 用量落审计（SYSTEM）
        成员正文一律作为不可信数据放入 payload，不参与行为判定。
        """
        thread_id = self._threads.get(envelope.task_id, envelope.task_id)
        group_id = envelope.parent_task or envelope.task_id
        actor = self._spec.name if self._spec else "member"
        prompt = _render_envelope(envelope)

        for ev in self._client.stream(prompt, thread_id=thread_id):
            etype = getattr(ev, "type", None)
            data = getattr(ev, "data", None)

            if not isinstance(data, dict):
                continue

            # 主信号：ask_clarification 工具调用（运行时中间件保证，SPIKE-02）
            clar_args = _find_clarification_args(data)
            if clar_args is not None:
                yield MiloEvent(
                    group_id=group_id, task_id=envelope.task_id,
                    type=EventType.ESCALATION, actor=actor,
                    payload=escalation_from_clarification(clar_args).model_dump(),
                )
                continue

            if etype == "messages-tuple":
                if data.get("type") != "ai":
                    continue
                text = str(data.get("content") or "")
                esc = parse_escalation(text)  # 兜底路径
                if esc:
                    yield MiloEvent(
                        group_id=group_id, task_id=envelope.task_id,
                        type=EventType.ESCALATION, actor=actor,
                        payload=esc.model_dump(),
                    )
                elif text.strip() and not data.get("tool_calls"):
                    yield MiloEvent(
                        group_id=group_id, task_id=envelope.task_id,
                        type=EventType.STATUS, actor=actor,
                        payload=StatusPayload(
                            doing=text[:400], why="(untrusted member text)"
                        ).model_dump(),
                    )

            elif etype == "end":
                yield MiloEvent(
                    group_id=group_id, task_id=envelope.task_id,
                    type=EventType.SYSTEM, actor="system",
                    payload={"usage": data.get("usage", {})},
                )

    def events(self) -> AsyncIterator[MiloEvent]:  # pragma: no cover
        raise NotImplementedError("M1：用 asyncio.to_thread 包装 stream_task 为异步流")

    async def deliver(self, task_id: str) -> Delivery:
        """取交付物。artifacts 走 get_artifact(thread_id, path)（SPIKE-01 确认签名）。"""
        raise NotImplementedError("SPIKE-02：artifact 路径约定与 output_spec 校验")

    async def dismiss(self) -> None:
        self._client = None
        self._threads.clear()


def _find_clarification_args(data: dict[str, Any]) -> dict[str, Any] | None:
    """在事件负载中定位 ask_clarification 的调用参数（三处可能位置，SPIKE-02 实测）。"""
    for tc in data.get("tool_calls") or []:
        if tc.get("name") == CLARIFICATION_TOOL:
            return dict(tc.get("args") or {})
    if data.get("name") == CLARIFICATION_TOOL:
        artifact = data.get("artifact")
        if isinstance(artifact, dict):
            hi = artifact.get("human_input")
            if isinstance(hi, dict):
                return hi
        return {"question": str(data.get("content") or "")}
    for m in data.get("messages") or []:
        if isinstance(m, dict):
            found = _find_clarification_args(m)
            if found is not None:
                return found
    return None


def _render_envelope(envelope: TaskEnvelope) -> str:
    """任务信封 -> 成员可读指令（结构化四要素显式呈现）。"""
    lines = [
        f"# 任务 {envelope.task_id}",
        f"## 目标\n{envelope.objective}",
        f"## 交付要求\n格式：{envelope.output_spec.format}",
    ]
    if envelope.output_spec.artifacts:
        lines.append("产物：" + "、".join(envelope.output_spec.artifacts))
    if envelope.constraints:
        lines.append("## 边界\n" + "\n".join(f"- {c}" for c in envelope.constraints))
    if envelope.inputs.artifacts:
        lines.append(
            "## 输入材料\n"
            + "\n".join(f"- {a.name}: {a.uri}" for a in envelope.inputs.artifacts)
        )
    if envelope.budget.tokens:
        lines.append(f"## 预算\n{envelope.budget.tokens} tokens")
    lines.append(
        "\n## 升级约定\n"
        f"需要组长决策时，调用 `{CLARIFICATION_TOOL}` 工具（缺信息、需求歧义、路线二选一、"
        "危险动作确认）——**在正文里用自然语言提问不会送达任何人**，任务会卡住。"
    )
    return "\n\n".join(lines)

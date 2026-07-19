"""Member Contract：Milo 与成员之间的唯一接口（编制设计 §3.3）。

六动作中的 escalate 不是方法——它是成员经 events() 上行的事件类型
（EventType.ESCALATION），由适配层从运行时原始事件归一化而来。

人事红线：enroll/dismiss 只能由秘书长在"组长已签署的编制"驱动下调用，
适配层自身不得发起。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from pathlib import Path

from pydantic import BaseModel, Field

from milod.models import ArtifactRef, MiloEvent, TaskEnvelope


class MemberSpec(BaseModel):
    """enroll 的输入：渲染器产出的成员工作区描述。

    workdir 是**该成员私有**的目录树（含 config.yaml 与 home/{agents,skills,threads,memory}），
    绝不与其他成员共用——DEER_FLOW_HOME 内含会话历史与长期记忆（编制设计 §3.4）。
    """

    name: str
    #: harness 侧运行名（须匹配 ^[A-Za-z0-9-]+$）；显示名可中文（"小张"），
    #: 二者解耦——名字属于人，slug 属于运行时。空 = 与 name 相同
    runtime_name: str = ""
    pack_ref: str
    workdir: Path
    capabilities: list[str] = Field(default_factory=list)
    model_bindings: dict[str, str] = Field(default_factory=dict)
    #: 密钥最小注入：只含该成员档位所需的凭证（由 keyring 解引用后填入，不落盘）
    secrets: dict[str, str] = Field(default_factory=dict)
    #: 非密钥的附加环境（如秘书的 MILO_API_BASE/MILO_ORG），与 secrets 分开以明语义
    extra_env: dict[str, str] = Field(default_factory=dict)


class Delivery(BaseModel):
    task_id: str
    summary: str
    artifacts: list[ArtifactRef] = Field(default_factory=list)


class MemberAdapter(ABC):
    """合同六动作。实现：EmbeddedAdapter（进程内，首发）/ ContainerAdapter（延后）。"""

    @abstractmethod
    async def enroll(self, spec: MemberSpec) -> None:
        """起实例 + 注入工作区；随后由调用方跑 evals 冒烟（试用期）。"""

    @abstractmethod
    async def assign(self, envelope: TaskEnvelope) -> str:
        """下发任务信封，返回运行时侧的 run/thread 标识。"""

    @abstractmethod
    def events(self) -> AsyncIterator[MiloEvent]:
        """归一化事件流：STATUS / ESCALATION / DELIVERY。

        信任边界在此执行：运行时原始事件里的自由文本只能进 payload
        作为不可信数据；事件 type 只能由结构化信号推导，绝不由文本内容推导。
        """

    @abstractmethod
    async def deliver(self, task_id: str) -> Delivery:
        """取交付物（artifact 引用 + 摘要），交由 acceptance 校验 output_spec。"""

    @abstractmethod
    async def dismiss(self) -> None:
        """释放实例；成果归组织 artifacts/，过程随工作区归档（编制设计 §3.4）。"""

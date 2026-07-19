"""milod：Milo 本地守护进程。

模块布局（milo-技术规划.md §3）：
- models/       7 类消息 + 任务信封 + 状态机（schemas/ 的 Pydantic 对应物）
- adapter/      Member Contract 六动作（EmbeddedAdapter 首发，ContainerAdapter 延后）
- secretariat/  分解(LLM) · 路由 · 调度 · 升级 · 验收 · 调和
- store/        SQLite：events append-only + tasks
- config/       ~/.milo 五文件分层 + keyring
- api/          FastAPI + WS（UI 唯一后端）
"""

__version__ = "0.0.1"

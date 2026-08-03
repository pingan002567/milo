"""milod：Milo 本地守护进程。

模块布局（docs/milo-技术规划.md §3）：
- models/       7 类消息 + 任务信封 + 状态机（schemas/ 的 Pydantic 对应物）
- adapter/      Member Contract 六动作（SubprocessAdapter 主路径；不做 ContainerAdapter/云端）
- secretariat/  分解(LLM) · 路由 · 调度 · 升级 · 验收 · 调和
- store/        SQLite：events append-only + tasks
- config/       ~/.milo 五文件分层 + keyring
- api/          FastAPI + WS（UI 唯一后端）
"""

__version__ = "0.0.1"

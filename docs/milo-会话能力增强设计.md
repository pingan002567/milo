# 会话能力增强设计（深入 DeerFlow 后的补齐清单）

> 2026-07-20。研读 deer-flow harness（`deerflow/client.py`、`tools/`、`sandbox/tools.py`）
> 与官方前端（`components/workspace/*`、`ai-elements/*`）后，梳理秘书会话与成员私聊
> 尚未用上的能力。适用范围：两条自由文本通道（秘书 / 私聊），部分同样适用任务群。

## 一、现状盘点

**已用上**：流式增量、`ask_clarification` 中断契约、checkpointer 常驻记忆、
`values` 快照取交付摘要、`end` 事件用量（落库未展示）、artifact 读写、
官方 message/reasoning 视觉形态。

**关键缺口**：`stream_mode` 是 `["values","messages","custom"]`，而我们的
normalize 只认前两类——**`custom` 通道整个被丢弃**，那正是 TODO 进度、
子代理状态等结构化进展的载体。

## 二、增强项与优先级

| 期 | 能力 | 缺口与价值 |
|---|---|---|
| **P0** | **停止当前回合** | 一旦跑起来只能干等（实测有过 20 万 token 失控会话）；harness 侧生成器可提前 `close()`，UI 发送键在流式中变「停止」 |
| **P0** | **`custom` 事件接入 + TODO 清单** | 注入 `todo_write`，把"一团思考文字"变成可勾选的计划清单（官方 `TodoList` 形态：底部可折叠队列） |
| **P1** | **Token 用量可见** | 每条 AI 消息带 `usage_metadata`、`end` 带整轮 `usage`（我们已落库从不展示）；调教场景成本无感是危险的 |
| **P1** | **附件上传** | 官方输入框支持粘贴/拖拽文件 → `/mnt/user-data/uploads`；私聊"把这份文档给它看"是刚需，返工设计里也预留了字段 |
| **P2** | **引用来源渲染** | 联网成员回答里的 `[citation:…]` 现在是裸噪音，应渲染为可点来源卡（官方 `CitationSourcesPanel`） |
| **P2** | **子代理可见性** | 成员是超级个体，内部会开子代理（`max_total_per_run: 2`），但干了什么完全不可见（官方 `subtask-card`） |
| **P3** | **消息级反馈 👍👎** | 私聊本就是调教场景，逐条打分是最自然的调教信号，可沉淀为成员表现数据 |

## 三、实现要点

### 停止回合（P0）
- worker：记录当前活跃生成器，收到 `cancel` RPC 时 `close()` 并发 `aborted` 事件帧
- adapter/Office：`cancel(channel)` 贯通；对话通道与任务通道都适用
- 事件：新增 `system` 事件 `{aborted: true}`；对话 UI 显示"已停止"
- UI：流式中发送按钮 → 「停止」（官方 `SquareIcon` 语义）

### custom 通道与 TODO（P0）
- normalize 增加 `custom` 分支，识别 TODO 载荷 → `EventFrame(event="todo")`
- 成员/秘书注入 `todo_write` 工具
- 事件落库为 `status` 的 `kind="todo"`（复用现有管道，不新增表）
- UI：会话底部可折叠清单，逐项状态（待办/进行中/完成）

### Token 用量（P1）
- `end` 事件的 usage 已在 payload；对话页头部显示本会话累计，回合末尾显示单轮

### 附件上传（P1）
- 后端：`POST /api/orgs/{org}/uploads`（存组织级 artifacts/uploads/）
- 发消息时带 `attachments`，worker 注入线程 uploads 目录（复用返工的注入通路）
- UI：输入框支持拖拽/粘贴，显示附件 chips

## 四、不做的

- 消息编辑重发 / 分支对话：与 checkpointer 线性记忆模型冲突，代价高收益低
- 语音输入、Canvas、Web 预览：与"组织指挥台"定位无关
- 模型选择器：模型绑定是团队级配置，不该在会话里切

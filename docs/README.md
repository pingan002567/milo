# Milo 设计文档索引

所有路径相对本目录。文档按「总案 → 体系 → 专题」分层：总案定义产品是什么，
体系定义制度与技术底座，专题是某一轮实现前的设计定稿（实现后不再回改，作为决策留痕）。

## 总案

| 文档 | 内容 | 状态 |
|---|---|---|
| [milo-产品方案.md](milo-产品方案.md) | 产品定位、用户与场景、三层模型（模板/库/实例）、§2.5 叙事分层与词表 | 现行基准 |
| [milo-技术规划.md](milo-技术规划.md) | 架构分层、milod 模块布局、里程碑 M0–M4、§7 embedded-first 路线 | 现行基准 |

## 体系

| 文档 | 内容 | 状态 |
|---|---|---|
| [milo-编制体系详细设计.md](milo-编制体系详细设计.md) | org.yaml schema、Member Contract 六动作、§3.4 数据隔离、§3.5 信息交流五通路、§6 配置分层 | 现行基准（通路清单待补私聊） |
| [milo-任务群流程.md](milo-任务群流程.md) | **实现现状**：两套状态机 + 七阶段时序 + 出口清单 + 代码落点 | 跟随代码，与设计文档不符时以它为准 |
| [milo-决策者交互设计.md](milo-决策者交互设计.md) | 决策者视角的指挥交互；对应 `../prototype/console.html` | 用户自有文档 |

## 调研

| 文档 | 调研日期 | 内容 |
|---|---|---|
| [milo-市场调研与创新机会.md](milo-市场调研与创新机会.md) | 2026-07-28 | 全球多智能体平台、中国市场、Agent 分发/AI 员工、桌面 Agent/workflow；识别五个关键缺口；提出五个创新机会 |

## 专题设计（按时间倒序）

| 文档 | 设计日期 | 实现 |
|---|---|---|
| [milo-会话能力增强设计.md](milo-会话能力增强设计.md) | 2026-07-20 | ✅ `36850b4` 停止/TODO/用量/附件/引用/子代理/反馈 |
| [milo-团队管理设计.md](milo-团队管理设计.md) | 2026-07-20 | ◐ P0 已实现 `bebf93c`；P1 删除团队、P2 首次运行向导待做 |
| [milo-验收与返工设计.md](milo-验收与返工设计.md) | 2026-07-20 | ◐ R1 已实现 `ab0d5a6` + `89d014d` 验收与归档分离；R2/R3 待做 |
| [milo-右栏检查器设计.md](milo-右栏检查器设计.md) | 2026-07-20 | ✅ `79398d1` 七屏上下文面板 |
| [milo-秘书Agent设计.md](milo-秘书Agent设计.md) | 2026-07-19 | ◐ S1 已实现 `d5253e3`（对话 + L0/L1 工具）；S2 提案卡待做 |

## 实测报告（不在本目录）

| 报告 | 位置 |
|---|---|
| Spike 01 escalate 事件形态 | `../spikes/01-escalate-events/REPORT.md` |
| Spike 02 enroll 渲染链路 | `../spikes/02-enroll-render/REPORT.md` |
| Spike 03 SubprocessAdapter 端到端 | `../spikes/03-subprocess-adapter/REPORT.md` |
| milod API 层说明 | `../packages/milod/src/milod/api/README.md` |

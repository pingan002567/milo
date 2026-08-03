# Milo 产品方案

> 定位：DeerFlow 生态的 **本机精品货架（分发/验货） + AI 组织指挥台**
> 一句话：下载（招募）或生成调教好的 Agent 成员，组建你的 AI 组织，编辑组织架构，统一指挥干活。
> 市场话术：**你的 AI 团队**——招募 Agent 成员，一个人指挥一支随叫随到的团队（展示层隐喻，领域模型保持通用组织，见 §2.5）。
> 核心抽象：**一个 DeerFlow 实例 = 一个成员**。实例内部的 agent/subagent 编排是成员的"个人工作方法"，不属于本产品范围。
>
> 基于对 bytedance/deer-flow 与 deer-flow/llm-space 的源码级调研（2026-07-17）。

---

## 一、调研结论（产品决策的事实基础)

### 1.1 DeerFlow 的代际断裂

| | v1.x（`main-1.x` 分支，已停止主线开发） | v2.0（当前 `main`，2026-06 发布） |
|---|---|---|
| 定位 | Deep Research 框架 | 通用 SuperAgent harness |
| 架构 | LangGraph 固定图：coordinator → planner → researcher/analyst/coder → reporter | 主 Agent + 动态子 Agent + 中间件链 |
| Agent 定义 | 硬编码三处：`src/graph/builder.py` + `src/config/agents.py` 的 `AGENT_LLM_MAP` + `src/prompts/*.md` | SKILL.md 技能包（`/mnt/skills/custom/<skill>/SKILL.md`） |
| 可分发性 | **不可分发**（新增 agent 必须改源码） | 技能包可 `npx skills add` 安装，含 `allowed-tools` 权限声明与 SkillScan 安全扫描 |
| 运行形态 | FastAPI SSE (`/api/chat/stream`) + Next.js 前端 | 单端口网关 :2026、Python 客户端 `DeerFlowClient`、TUI、Redis stream bridge、IM 渠道（Telegram/Slack/飞书/微信/钉钉）、沙箱（本地/AIO 容器/K8s）、SQLite/Postgres |
| 生态数据 | — | Star 77k / Fork 10.5k，一个版本合并 180 PR，迭代极快 |

**决策 1：产品全部基于 DeerFlow 2.0 构建。** 网上大量教程针对 1.x，不可作为架构参考；1.x 的 agent 模型注定无法支撑"下载别人的 agent"这一核心场景。

### 1.2 llm-space 的真实定位

- **不是市场**，是本地优先的 agent 调试/评估桌面 IDE（TypeScript + Electrobun，仅 macOS）。DeerFlow README 称其为团队"secret weapon"。
- 核心数据模型是 **Thread**（本地 JSON 文件，存于 `~/.llm-space/workspace/`）：
  - `ThreadContext`：systemPrompt、tools（Built-in / Custom Function / MCP 三类）、messages、variables（`{{var}}` 语法）
  - `runHistory: ThreadRunSnapshot[]`：每次运行的完整快照 + token 用量
  - `evaluationRubrics`：2–6 档有序评分标准，支持多次运行对比评分
- 支持导入 OpenAI / Anthropic / Native Thread JSON 格式并自动转换。
- **没有任何分享、发布、下载机制**。调教成果死在本地。
- 闭环开发（只收核心团队 PR），发布节奏极快（两天三个 release），仅 macOS。

**决策 2：不与 llm-space 竞争"调教"环节，而是消费它的产出。** llm-space 是最好的调教工具，我们做它缺失的下游：把 Thread JSON（含 rubric 评分与运行快照）变成 agent 包的"质检报告"。

### 1.3 生态空位图

```
调教 (llm-space)  →  [ 本机分发/验货：空白 ]  →  运行 (DeerFlow 2.0)  →  [ 跨实例编排：空白 ]
                      ↑ Milo 本地精品货架                    ↑ Milo 秘书长
```

字节已做好：运行时、调教工具、包格式雏形（SKILL.md）。缺的两层正是本产品：

1. **本机分发/验货**：不是流量型独立商店，而是带质检的本地货架（发现 → 验货 → 入库 → 聘用）。
2. **编排层**：DeerFlow 2.0 是"一个实例一个超级智能体"；**没有跨实例的多 agent 协同**——不能让多个专业成员组队干活。

---

## 二、产品定义

### 2.1 目标用户

| 画像 | 需求 | 对应功能 |
|---|---|---|
| Agent 作者（开发者/深度玩家） | 调教成果想被使用、署名 | 本地/精品货架发布、版本、质检报告 |
| Agent 使用者（个人/小团队） | 不会调教，想直接用高质量 agent | 本地市场发现、验货、聘用 |
| 小团队 / 自用组织 | 多个专业 agent 协同，数据不出本机 | 组织编排、本地守护进程、审计 |

### 2.2 核心用户旅程

```
获取 Agent                          组建组织                       指挥干活
┌──────────────────────┐    ┌───────────────────────┐    ┌───────────────────────┐
│ A. 本地市场发现         │    │ milo add / 桌面聘用     │    │ 自然语言下达任务         │
│   浏览/验货/入库         │ →  │ 每个 agent 起一个        │ →  │ 秘书长 分解、路由、   │
│ B. 向导生成            │    │ 本地子进程 DeerFlow      │    │ 派单、汇总              │
│ C. llm-space 导入      │    │ 实例（embedded-first）   │    │ 全程 trace 可观测        │
└──────────────────────┘    └───────────────────────┘    └───────────────────────┘
```
（明确不做：流量型独立商店、任务转云端执行。）

### 2.3 与"prompt 市场"类产品的差异化（护城河）

1. **带质检报告的 Agent**：每个包附带 llm-space 评测集（Thread JSON + rubric），上架时平台复跑打分，下载前"验货"。市面上的 prompt/GPTs 市场全靠用户评论，无客观质量信号。
2. **不止于单体 agent**：卖点是"组队"。下载 3 个 agent 不是得到 3 个聊天窗口，而是一个能协同的组织。
3. **吃透 DeerFlow 生态红利**：77k star 的运行时 + 官方 IM 渠道能力（部署好的组织直接接飞书/微信群）。

### 2.4 通用组织定位（不限于企业场景）

Milo 的核心抽象是**组织（Organization）**而非公司：任何需要多个 AI 成员分工协作的场景都适用，企业只是其中一类。组织模板（成建制分发）按场景覆盖：

| 场景 | 组织形态示例 | 典型成员 |
|---|---|---|
| 企业职能 | 尽调团队、合规审查组、客服中心 | 调研 / 财务 / 法务 / 工单成员 |
| 科研 | 课题组 | 文献检索、实验分析、论文写作成员 |
| 内容创作 | 自媒体工作室 | 选题、撰稿、脚本、多平台分发成员 |
| 开源社区 | 维护小组 | issue 分诊、PR 评审、文档、发布成员 |
| 个人 | 多助理工作室 | 日程、调研、写作、学习助理 |

术语相应中性化：成员（member）、部门（按场景可称小组/科室/组）、招募、加入/退出。org.yaml 的 `kind: Organization` 本就是通用抽象，schema 无需为场景分叉——差异全部体现在组织模板层。

### 2.5 叙事分层：前端「团队/成员」×领域「通用组织」（2026-07-19 决策）

面向市场的第一叙事现行为**「团队 + 成员」**（曾短暂采用「一人公司 + 数字员工」，因'员工'绑定雇佣关系、'数字员工'有 RPA 歧义而放弃）：团队隐喻通用、轻盈，覆盖企业/科研/开源/个人全场景。叙事**只存在于展示层与营销话术**：

- **领域模型/后端/协议保持中性术语不动**：member、enroll/dismiss、org.yaml `kind: Organization`、API 字段一律不变。原因：①「数字员工」在国内市场有 RPA/虚拟数字人歧义，且非规范用语，不宜进领域模型；②「员工」绑定雇佣关系，与 §2.4 的通用组织定位（科研课题组、开源社区、个人助理均无"员工"）冲突。
- **展示层做单向映射**（前端文案层完成，后端返回的中性提示不透传）：

| 领域术语（后端/文档） | 展示术语（前端，2026-07-19 现行词表：团队/成员） |
|---|---|
| 组织 | 团队 |
| 成员 | 成员 |
| 组长（用户） | 你（负责人） |
| 编制 | 名册 |
| 招募 | 招募（起名） |
| 待加入 / 加入组织 | 待加入 / 加入 |
| 在岗 | 在岗 |
| 请离 / 移出编制 | 移出 / 撤销招募 |
| 秘书长 | 秘书 |
| 停职 / 复岗 / 任务群 | 不变 |

> 词表演进记录：一人公司/老板/数字员工/招聘/入职/辞退（2026-07-19 上午）→
> 团队/负责人/成员/招募/加入/移出（同日晚，用户定）。切换只改前端字符串与
> 文档表格，领域层零改动——正是本节"叙事分层"机制的设计意图。

- 非企业场景（科研/开源/个人）后续可按组织模板切换展示层词表（同一映射机制，换一张表），领域层零改动——这正是叙事分层的意义。

---

## 三、MiloPack：Agent 包格式设计

这是产品的地基。在 SKILL.md 之上定义完整的 agent 交付单元：

```
my-legal-agent.milopack/
├── manifest.yaml            # 包描述（见下）
├── persona/
│   ├── system.md            # 主 system prompt（Jinja2 变量兼容 {{locale}} 等）
│   └── system.zh_CN.md      # 本地化变体（沿用 DeerFlow 的 locale 回退约定）
├── skills/                  # 标准 DeerFlow 2.0 SKILL.md 技能包，原样透传
│   └── contract-review/
│       └── SKILL.md
├── mcp/
│   └── servers.yaml         # 依赖的 MCP server 声明（transport/command/url/enabled_tools）
├── evals/                   # llm-space 导出的 Thread JSON（评测集 = 质检报告）
│   ├── case-01.thread.json  #   含 rubric、运行快照、token 用量
│   └── rubrics.json
└── assets/                  # 图标、README、示例输出
```

`manifest.yaml` 核心字段：

```yaml
apiVersion: milopack/v1
name: legal-contract-reviewer
version: 1.4.0
author: "@zhangsan"
license: MIT
deerflow:
  minVersion: "2.0.0"        # 运行时兼容声明（应对 DeerFlow 快速迭代）
capabilities:                 # 秘书长 路由的依据
  - contract-review
  - legal-risk-analysis
model_requirements:           # 不绑定具体模型，声明档位（对齐 basic/reasoning/vision/code 四层）
  min_tier: reasoning
  context_window: ">=128k"
mcp_dependencies:
  - name: court-case-search
    required: false
permissions:                  # 继承 SKILL.md 的 allowed-tools 思路，包级收敛
  network: [ "*.court.gov.cn" ]
  filesystem: readonly
  python_repl: false
eval:
  suite: evals/
  min_score: 4.2              # 平台复跑低于此分不予上架
```

设计原则：
- **不发明新运行时概念**：skills/ 就是官方 SKILL.md，mcp/ 就是官方 MCP 声明，MiloPack 只是"聚合 + 元数据 + 质检"。DeerFlow 升级时兼容成本最低。
- **模型解耦**：包声明档位而非具体模型，部署时由用户的 conf 映射到自己的 API key/模型，避免把作者的模型偏好硬编码进包。
- **安全前置**：上架时跑 SkillScan（官方扫描器）+ 平台自有的 prompt 注入检测 + permissions 静态审查。

### 3.5 Agent 模板与实例（2026-07-19 决策）

**概念模型：类 → 库 → 实例，三层分离。**MiloPack 是 **Agent 模板**（定义能力，
不可变、带版本）；**数字员工是模板 new 出来的具名实例**（有自己的名字、工作区、
记忆、履历）。这与第一原则"一个 DeerFlow 实例 = 一个成员"对齐：模板不是成员，
实例才是。

| 层 | 名称 | 落盘 | 归属 | 动作 |
|---|---|---|---|---|
| 发现 | **Agent 市场（本地精品货架）** | 本地包源（`MILO_PACKS` / `~/.milo/packs`） | 本机 | ⭐收藏（记引用）/ 入库 |
| 拥有 | **Agent 库** | `~/.milo/library/<name>@<version>/` | 用户全局（跨团队共享） | 聘用（实例化）/ 移除 |
| 雇佣 | **成员（实例）** | org.yaml + `orgs/<org>/members/<实例名>/` | 某个团队 | 加入/停职/复岗/移出 |

**关键规则：**
- 市场 = **本机发现 + 验货**（质检报告、权限前置声明），**不是**流量型独立商店
  （无评分榜单、无付费分成、无双边撮合）；**不直接产生雇佣**。
  收藏与入库解耦（收藏只记引用，存 `settings/favorites.yaml`）。
- **聘用必须起名**：实例名团队内唯一（默认建议 `模板名-N`）；人事红线不变，
  三层动作全部仅用户可发起。
- org.yaml 成员记录：`{name: 小张, agent: py-dev@0.1.0, enrolled}`——实例
  **pin 模板版本**，模板升级不影响在岗实例。旧格式 `pack: <路径>` 向后兼容可读。
- 同模板多实例天然成立；库中模板被实例引用时禁止移除；**不做实例换模板**。
- **不做**公开 Registry / `milo publish` 流量分发；远端精品货架若未来出现，
  必须以质检报告为门槛，且不得做成铺量商店（见《市场调研》§七）。

**API 形状**：`GET /api/market`（带 downloaded/starred 标记）、
`POST/DELETE /api/library`、`GET /api/library`、`PUT/DELETE /api/favorites/{ref}`、
`POST /api/orgs/{org}/members {agent, name, activate}`。

---

## 四、系统架构

```
┌─ 桌面壳 (Tauri) + milod 本地守护 ──────────────────────────────────────┐
│  市场(本地货架) · 团队 · 秘书私聊 · 任务群 · 设置                           │
│  CLI: milo init / add / run / reply / log / eval / recover               │
│  秘书长：分解(LLM) · 确定性路由 · 派单/重试 · 验收                         │
└───────────────┬────────────────────────────────────────────────────────┘
                │ 子进程 JSON-RPC（Member Contract）
┌───────────────┴──────────────── 执行面（本机）───────────────────────────┐
│  每成员一子进程 · DeerFlowClient + 私有工作区（~/.milo/orgs/.../members） │
│  SQLite 事件/审计 · 本地 artifacts 目录                                   │
│  明确不做：任务转云端执行 / K8s 多租户控制面 / 流量型公开 Registry           │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.1 关键设计决策

**成员抽象：一个 DeerFlow 2.0 实例 = 一个成员（第一设计原则）**
- 成员 = 本机子进程中的 DeerFlow 实例 + 注入的 MiloPack（档案与技能证书）。加入时：解析 MiloPack → 渲染成员工作区（skills / SOUL.md / config）→ 拉起子进程（embedded-first；**不做**任务转云端 / K8s 执行面）。
- **非目标（明确排除）**：实例内部的 Lead Agent、动态 subagent、中间件编排；流量型独立商店；云端执行转型。实例内编排由 DeerFlow 自治，Milo 不感知。
- **Member Contract（Milo 与成员之间的唯一接口，六个动作）**：
  | 动作 | 方向 | 语义 |
  |---|---|---|
  | `enroll` | Milo→成员 | 起实例 + 注入 MiloPack（加入） |
  | `assign` | Milo→成员 | 下发结构化任务信封 |
  | `status` | 成员→Milo | 三槽位状态汇报（在做什么/为什么/置信度与风险） |
  | `escalate` | 成员→Milo | 需要上级决策的事项上抛（实例内 subagent 的问题必须先汇聚到实例 Lead，再以成员身份上抛——打扰路径同样遵守组织层级） |
  | `deliver` | 成员→Milo | 交付 artifact + 摘要 |
  | `dismiss` | Milo→成员 | 销毁实例（退出） |
  合同由 MemberAdapter（SubprocessAdapter）实现；DeerFlow 升级只改适配层。
- Trace 分层：Milo 只存成员级汇报与交付记录；实例内部 trace 可外链 DeerFlow 观测，不复制、不解析。
- 隔离即安全边界：每成员一子进程 + env/工作区隔离 + 密钥钥匙串最小注入 + 秘书工具白名单。

**秘书长 两种协同模式（MVP 先做第一种）**
1. **流水线（DAG）**：任务分解为步骤，按 capabilities 路由到成员，产物经共享对象存储传递（对齐 DeerFlow 的 /mnt/user-data 文件系统习惯）。
2. **竞争/评审**：同一任务派给多个同类 agent，用包内 rubric 由 judge LLM 打分取最优——直接复用 DeerFlow v1 的 `/api/report/evaluate` LLM-judge 思路和 llm-space 的 rubric 格式。

**通信协议**
- 首选官方 **Python SDK（DeerFlowClient）** 实现 Member Contract；Redis stream bridge 作为异步事件回收的备选通道，HTTP API 做管理操作（三者的取舍以 SDK 实际表达力验证结果为准，见第八章 spike）。
- 秘书长 ↔ 成员的任务信封定义为独立 schema（task_id / parent_task / capability / inputs / artifacts / deadline），不依赖 DeerFlow 内部消息格式，降低版本耦合。

**Agent 生成向导（"生成"路径）**
- 问答式收集：角色/目标/工具需求/示例任务 → LLM 生成 manifest + system prompt + 骨架 skill → 自动创建 3–5 个评测 case → 用户在内嵌的轻量 playground（或引导跳转 llm-space）迭代 → 满意后发布。
- 生成的包和下载的包完全同构，不做特殊通道。

### 4.2 与 llm-space 的集成

- **导入**：`milo import ~/.llm-space/workspace/xxx.json` —— 从 Thread 提取 systemPrompt/tools/variables 生成 MiloPack 骨架，runHistory + rubrics 直接落入 evals/。
- **导出**：组织中任一成员的失败 run，可导出为 Native Thread JSON，扔回 llm-space 重放调试——形成"调教 → 发布 → 运行 → 回炉"闭环。
- llm-space 仅 macOS 且闭环开发，不假设能改它的代码；一切通过文件格式对接。

---

## 五、汇报关系与指挥体系设计

> 问题：多 agent 是否应该设计汇报关系来降低使用者心智负担？
> 结论：**应该，且这是行业绝对共识——但汇报层级的价值是有条件的，设计错了反而更糟。** 以下基于对主流框架实践（LangGraph/CrewAI/MetaGPT/AutoGen/Anthropic/Manus/Devin/DeerFlow 2.0）和人因研究（supervisory control、认知负荷、信任校准）的两轮调研。

### 5.1 调研证据摘要

**共识面：所有活下来的生产系统都是"用户只对接一个领队"。** Anthropic Research（lead + 3–5 subagent）、Claude Code（subagent 只回传摘要）、Devin、Manus（Wide Research 后台并行但单一对话入口）、DeerFlow 2.0（单 Lead Agent + 动态子 agent）无一例外。理由：答案归一（群聊里"哪条是最终答案"不清晰）、上下文保护（worker 的中间垃圾不进用户对话）、责任归因、状态一致性。让用户直接面对 N 个 agent 的设计（早期 ChatDev/CamelAI 式）只存活于研究演示。

**条件面：层级不是免费的，量化证据双向。**
- 支持：中心化协调在可并行任务上提升 80–90%（Anthropic 内测 +90.2%；Google 受控实验 +80.9%），错误放大从独立多 agent 的 17.2 倍压到 4.4 倍——领队本质是"验证瓶颈"。
- 反对：强串行任务上所有多 agent 变体劣化 39–70%；token 成本约 15 倍；**纯树形汇报拓扑在协作 benchmark（MultiAgentBench）上垫底**；多层 supervisor-of-supervisors 被社区公认为过度设计。
- 反面教材：CrewAI 的 hierarchical process——只给 LLM 一个"manager 人设"就指望它编排，结果 manager 不委派、抢活干、行为随描述语言漂移（GitHub Issues #4783/#1057/#2054），已被反复证伪。**汇报关系必须靠框架硬约束实现，不能靠 prompt 演戏。**

**认知负担面（人因研究）：**
- 监督幅度：无人机时代单人最优监督 2–4 个；管理学 Graicunas 公式关系数按 n(2^(n-1)-1) 爆炸（6 个下属 = 222 个关系）；业界 LLM 实践收敛在 3–5 个并行 subagent——三条独立证据链指向同一量级。
- 负担大头不是"看着跑"而是**中断**（被打断后平均 23 分钟才能回到原任务）和**验证**（审 agent 产出比自己做更累，且研究表明更好的 trace 界面只提升"信心"不提升找错准确率）。
- 告警稀缺性：医疗 CDSS 低阈值弹窗导致 90% override 率、SOC 67% 告警被忽略——**每一次不必要的打扰都在透支所有告警的可信度**。
- SAT 透明度模型（实验验证）：汇报含"在做什么 + 为什么 + 置信度/风险"三槽位可同时提升信任校准与绩效，且不增加认知负荷；但结构化 ≠ 更多信息，是固定槽位的少量信息。

### 5.2 Milo 的指挥体系设计

> **交互落点（2026-07-18 沉淀）：** 决策者与直属下属的产品交互定为 **「只私聊 秘书长」**——会话列表仅 秘书长 可聊，成员灰显不可私聊；请示卡与进度系统条嵌在同一私聊时间线。完整规范见《milo-决策者交互设计.md》；原型见 `prototype/console.html`。群聊 / 任务频道另案。

**组织拓扑：单领队扁平组织，不做多层汇报。**（被监督对象是"成员"而非 agent——一个成员内部再多 subagent 也只算一个监督对象，监督幅度 ≤5 花在正确的粒度上）

```
用户 ←──唯一对话入口──→ 秘书长（领队 agent）
                          │ 结构化派单（任务信封：objective/输出格式/权限/预算/终止条件）
          ┌───────────┬───┴───────┬───────────┐
        法务 Agent   财务 Agent   研究 Agent   …（默认并行度 ≤ 5）
          └───────────┴───────────┴───────────┘
                产物写入共享对象存储（artifact），只向 秘书长 回传引用+摘要
```

- 秘书长（系统名 Secretariat，原 Conductor）是用户唯一对话对象；成员 agent 对用户不可见（可下钻查看，但不主动出现）。现实身份类比：**办公室主任/幕僚长（Chief of Staff）**——不是经理（无自主方向，权力全部来自用户授权且范围写在制度里）、不是成员（不干具体的活）；除"听懂任务"用 LLM 外全部照章执行，即"制度长了手脚"。职责六项：听懂任务、派单、跟进汇总、挡驾与请示、人事执行（**人事决定权只属于用户**——招募/请离/版本变更一律由用户发起，秘书长仅执行、可建议、禁止自动变动）、验收交付（详见编制设计 4.0 节）。
- **不做 supervisor-of-supervisors**：树形拓扑在协作任务上表现最差，且多层转述放大 telephone game 信息衰减。组织规模需要超过监督幅度时，靠"组织模板分组 + 任务级串行"解决，不加中间管理层。
- 汇报关系是**框架硬约束**而非 prompt：委派走结构化任务信封（吸收 Anthropic 经验：必须含 objective、输出格式、工具边界、资源预算）；路由按 manifest 的 capabilities 匹配由 秘书长 的确定性代码执行，LLM 只做任务分解，不自由决定"要不要委派"。
- **产物走文件不走转述**：成员产出写入对象存储（对齐 DeerFlow 的 /mnt/user-data 习惯），向上只传引用 + 摘要——这是 Anthropic/Manus/MetaGPT 共同验证的抗信息衰减手段。
- 硬护栏（吸收 DeerFlow 2.0 中间件思路）：spawn 数量上限、循环检测、单任务 token 预算、无进展自动重规划（Magentic-One 的 Task/Progress Ledger 双账本模式）。

**汇报协议：双通道 + 三槽位 + 稀缺升级。**

1. **双通道汇报**：
   - 阻塞通道（即时推送）：只有"需要用户做决定"的事项——单条、附上下文、明确说"需要你决定什么"。
   - 进度通道（批量拉取）：常规进展攒批到用户自然断点统一展示，控制台仪表盘拉取式查看，绝不弹窗。
2. **三槽位状态格式**（SAT 模型）：每条成员状态固定为"在做什么 / 为什么 / 置信度与风险"，秘书长 汇总时保持同构。杜绝原始日志流上浮。
3. **升级稀缺化（action guards）**：按"可逆性 × 外部影响 × 置信度 × 成本"四维决定是否打扰用户，判定依据直接来自 MiloPack manifest 的 `permissions` 声明（如 `network`、`filesystem: readonly`）——**包格式与汇报体系在这里咬合**：作者声明的权限越收敛，运行时越少打扰用户。把"用户 override 率"作为产品健康指标监控，逼近高位说明升级体系已失效。
4. **计划前置授权**：长任务先由 秘书长 出可编辑计划，批准即授权到下一个里程碑；执行偏离计划必须重新上报（Devin/Magentic-UI 模式）。
5. **以可验证产物收口**：最终汇报单位是可验证 artifact（报告 + 引用、代码 + 测试结果），trace 仅作出错下钻；同时警惕"信心-能力鸿沟"——正确性靠评测集复跑兜底（复用 MiloPack 的 evals），不靠 UI 展示。
6. **任务群（交互式工作记录）**：秘书长接到任务后按需"拉群"——每任务一群，成员 = 组长 + 秘书长 + 相关组员。组员在群里汇报（结构化事件渲染为聊天气泡，带类型标签、点开还原原文），秘书长收集汇报后在授权范围内直接下指示、超出范围则 @组长 请示；组长也可直接在群里发言乃至 @组员。四条群规：① 组长的直接指令统一经秘书长落为任务信封修订并同步相关组员——单一事实源，防双头指挥；② 群是渲染层：组员侧仍是点对点结构化信封、组员间无直连、组员不消费群消息流（需共享的信息由秘书长以 artifact 定向下发）；③ 群默认免打扰 = 进度通道，@组长 = 阻塞通道；超时升级链：群内 @ → 私聊/系统通知 → 超过预授权时限按策略兜底（暂停该分支或安全默认，其余任务不受影响）；④ 群随任务生命周期，终结即归档为审计记录。

**拓扑自适应（吸收"层级有条件"的证据）：**
- 秘书长 派单前先判断任务结构：可并行分解（调研、对比、多路信息收集）→ 并行派单；强串行/有状态写入（长文档迭代、代码工程）→ 单成员承接 + 其余成员只做只读支援（Cognition/Claude Code 路线）。
- 默认并行度 ≤ 5，用户待批队列长度作为背压信号：队列过长自动降并行、提高成员自主档位。

### 5.3 用户可编辑的编制体系（org.yaml）

> 完整规范见《milo-编制体系详细设计.md》（org.yaml v1 schema、Member Contract 与 DeerFlow 2.0 API 映射、秘书长 调和架构、编辑器与校验设计）。本节保留概要。

> 问题：用户能否编辑 agent 之间的层级汇报关系？
> 答案：能，但**开放的是"策略编辑"而非"拓扑连线"**——自由画汇报线会引入 CrewAI 式失控和树形拓扑的信息衰减，编辑能力必须约束在有证据支持的安全形态内。

**三档编辑能力：**

| 档位 | 面向用户 | 能编辑什么 |
|---|---|---|
| L1 自动 | 普通用户（默认） | 无需编辑，秘书长 按任务结构自动决定并行/串行派单 |
| L2 声明式 | 进阶用户/企业 | `org.yaml` 编制文件 + Console 可视化编辑器：路由规则、DAG 流水线、升级策略、分组与并行度 |
| L3 封装式层级 | 高级用户/包作者 | 部门封装：把一个部门打包为对外的单个成员，通过嵌套获得层级 |

**org.yaml 示意：**

```yaml
apiVersion: miloorg/v1
name: due-diligence-fleet
members:
  - pack: market-researcher@^2.0
  - pack: financial-analyst@^1.4
  - team: legal-review-team        # 部门：内含初审+复核 agent，对外是一个成员
routing:
  - when: capability == "contract-review"
    assign: legal-review-team
pipelines:
  full-report:
    - step: collect
      members: [market-researcher]
      mode: parallel
    - step: analyze
      members: [financial-analyst]
      inputs: artifacts(collect)    # 产物走 artifact 引用，不走消息转述
escalation:                          # 覆盖 action guards 默认阈值
  - on: confidence < 0.6
    action: ask_user
limits:
  max_parallel: 5
```

**设计要点：**

- **编辑的是"组织制度"不是汇报线**：routing/pipeline/escalation 全部编译为 秘书长 的确定性调度代码。用户获得掌控感，但 agent 之间不存在可被 LLM 自由解释的"汇报关系 prompt"（规避 CrewAI 失败模式）。
- **层级靠封装不靠连线**（借鉴 AutoGen SocietyOfMind）：部门对上表现为一个"虚拟成员"，内部过程完全隐藏，只交付 artifact + 摘要。每一层看到的都是 ≤5 成员的扁平结构，多层转述的 telephone game 被 artifact 交接切断。部门可整体打包上架（"整个法务部"作为一个包分发）。
- **部门内协调默认由 Milo 运行时的确定性逻辑执行，不默认设"主管成员"**（LLM 经理已被 CrewAI 案例证伪）。高级选项可指定某成员任主管，但其管理动作被硬约束在任务信封分解与产物验收流程内，不开放自由指挥。
- **硬护栏（不可编辑）**：嵌套深度 ≤2；每层扇出 ≤5（监督幅度证据）；禁止 worker 间自由连线/群聊；编辑器 lint——串行流水线配并行组、路由环路、层级超限直接警告。
- org.yaml 与 MiloPack 同为一等公民：组织编制本身可版本化、可发布、可下载（Phase 3 的"组织模板"即成品编制文件）。

### 5.4 对既有设计的修订

- 系统架构（第四章）中 秘书长 的定位从"调度器"升级为"用户唯一对话入口 + 汇报中枢"，Console 的任务视图按双通道重构：首屏只有"待你决定"和"里程碑摘要"，成员级 trace 折叠为下钻入口。
- MiloPack manifest 的 `permissions` 字段承担双重职责：安全边界 + 升级判定依据（新增设计约束，格式不变）。
- MVP 路线图 Phase 2 的验收标准增加：单任务对用户的平均打扰次数、override 率、待批队列时长。

---

## 六、MVP 路线图

### Phase 1：格式 + CLI —— 本机让 agent 能跑通
- MiloPack v1 规范 + 校验器 + 本地种子包
- `milo init / add / run / reply / log / eval / recover`（子进程注入包）
- 本地市场：扫描包目录、质检报告验货、入库
- **验证指标**：单机闭环完成率；eval 冒烟可复跑；7 日留存（自用）

### Phase 2：秘书长 + 桌面壳 —— 让 agent 能组队
- **小组模式**（你 → 秘书 → 成员 ≤5；全部本机）
- 确定性路由 + 失败重试；桌面 App：本地市场、任务群、trace、分级通知
- 指挥体系：秘书唯一入口、双通道汇报、计划前置授权、验收返工
- **验证指标**：多 agent 任务占比；单任务打扰次数；override 率；待批队列时长

### Phase 3：编制进阶与协同深化（不做流量商店 / 不做上云）
- 编制进阶：自定义路由 + DAG / 部门封装（仍本机）
- 组织模板成建制分发（**精品货架 + 质检门槛**，非评分榜单付费商店）
- IM 渠道接单可复用 DeerFlow 官方能力（任务仍在本机执行）
- **明确砍掉**：评分/评论/榜单、付费分成、公开 Registry、K8s/云端执行面

### 明确不做（与《市场调研》§七对齐）

| 方向 | 理由 |
|---|---|
| 独立流量型 Agent 商店 | GPT Store / 扣子商店双重证伪 |
| 任务转云端执行 | 本地优先是信任卖点；桌面 daemon + 子进程即可 |

---

## 七、风险与对策

| 风险 | 评估 | 对策 |
|---|---|---|
| DeerFlow 2.0 迭代过快，API/skills 格式变动 | 高 | manifest 里 `deerflow.minVersion`；适配层按版本矩阵；MiloPack 只聚合官方概念 |
| 字节官方下场做编排 | 中 | 差异化押"评测质检 + 本机指挥台 + 组织模板" |
| 安全：恶意包 / 供应链 | 高 | SkillScan + 权限静态审查 + 子进程隔离 + 密钥零落盘 |
| llm-space 格式变动 | 中 | 导入层版本适配器；evals 存规范化格式 |
| 冷启动（内容） | 中 | 单边价值：自用编排成立；自营种子包 + eval 验货，不做双边流量市场 |
| 1.x 用户迁移预期 | 低 | 明确只支持 2.0 |

---

## 八、下一步建议

1. **先做技术验证 spike（1–2 周）**：本地起两个 DeerFlow 2.0 实例，用官方 Python SDK（DeerFlowClient）实现最小 MemberAdapter，逐项验证 Member Contract 六动作的可行性——重点是 persona/skills 注入（enroll）、流式事件中区分 escalation、artifact 取回（deliver）。这是全案最大也是唯一的核心技术假设。
2. **MiloPack 格式先行开源**：格式即标准，标准即生态位。哪怕产品未上线，格式被社区采用就赢了一半。
3. 深入读 DeerFlow 2.0 的 `claude-to-deerflow` 技能与 skills 加载源码，确认注入 skills/prompt 的确切扩展点（本次调研到机制层，未到逐行源码层）。

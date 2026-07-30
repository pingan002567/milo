# Milo 市场调研与创新机会分析

> 调研日期：2026-07-28
> 调研范围：全球多智能体编排平台、中国市场 AI 应用产品、Agent 分发与 AI 员工产品、桌面 Agent 与 agentic workflow 工具
> 目的：识别市场空白，为 Milo 的产品方向提供事实依据

---

## 一、市场格局速览

### 1.1 全球红海（已拥挤方向）

| 方向 | 拥挤证据 | 代表玩家 |
|---|---|---|
| 客服/CX agent | 估值最高、并购最密集 | Sierra ($15B)、Decagon ($4.5B)、Fin 被 Salesforce $3.6B 收购、Parloa ($3B) |
| AI 编码 agent | 军备竞赛最惨烈 | Cognition/Devin ($26B)、Claude Code、OpenAI Codex、Google Jules；国内 Trae/Qoder/Comate |
| 通用个人 agent | OpenAI/Anthropic 同周对攻 | ChatGPT Work、Claude Cowork、Manus、Genspark ($2.6B) |
| No-code agent 搭建 | 大厂降维打击 | AgentKit Agent Builder、Gumloop ($50M)、Taskade、扣子/元器/千帆/百炼/Dify |
| 语音 agent | 2026 年密集进场 | OpenAI Presence、Vapi ($500M)、PolyAI |
| C 端超级应用（中国） | 创业公司已无空间 | 豆包 3.8 亿 MAU、千问 1.67 亿、DeepSeek 1.3 亿；春节红包大战瓜分增量 |

### 1.2 中国市场特殊性

- **大厂全面碾压**：C 端 TOP5 全部背靠大厂/明星模型厂，创业公司只剩三条活路——出海变现（Manus ARR $1.25 亿）、开源+私有化做企业地基（Dify/FastGPT）、被收购或上市（智谱/MiniMax IPO）。
- **独立 Agent 商店已被证伪**：扣子技能商店验证了一半——"分发成立、市场机制不成立"（曝光和调用量起来了，但开发者分成/付费订阅未成规模）。中国没有出现 GPT Store 式独立 Agent 市场；分发权 = 超级 App 生态位 + 手机 OS 系统入口。
- **监管成新变量**：Meta $20 亿收购 Manus 被发改委否决（2026-04），确立"AI 应用层核心资产出境"红线。
- **AI 编程被大厂自研替代**：字节/阿里分批禁用 Cursor/Windsurf，推 Trae/Qoder。

### 1.3 关键协议之争

| 协议 | 定位 | 2026 现状 |
|---|---|---|
| **MCP**（Anthropic → AAIF） | Agent ↔ 工具/数据 | 事实标准。SDK 月下载 97M+、10,000+ servers；2026-07 无状态化大改版 |
| **A2A**（Google → Linux Foundation） | Agent ↔ Agent | 发布一年 150+ 组织采用；Microsoft/SAP/Zoom 接入 |
| **AG-UI**（CopilotKit） | Agent ↔ 用户界面 | CopilotKit 获 $27M 融资；已集成进 Microsoft Agent Framework |

行业共识：**MCP 解决工具调用，A2A 解决 agent 协同，下一个问题是传输层**。IETF 2026-07 召开 agentproto BoF，可能产出首份 RFC。

---

## 二、五个关键市场缺口

### 缺口 1：验收缺口（Eval Gap）—— 全行业公认第一大痛

- VB 2026-06 企业调查（n=157）：**50% 企业部署过"内部评测通过、线上出客户可见事故"的 agent**，1/4 出过不止一次。
- **66% 企业已允许无人工审核的生产部署，但仅 5% 完全信任自动化评测。**
- 不信任原因：与真实结果不相关（29%）、偏差不稳定（21%）、不可解释（18%）、数据泄露（17%）。
- 当前"验收"只以**商业条款**形式存在（3 个月 break clause、按 resolution 计费），没有跨厂商技术标准。
- 工程化验收工具刚出现：Sierra 模拟测试、Microsoft Copilot Studio evals、Salesforce Agentforce Command Center——**都是平台自建，互不通用，无独立第三方验收层**。

### 缺口 2：GPT Store 死因 = "三无"

GPT Store 失败的根因：
1. **无质检**：无有效审核 → 垃圾、侵权、作弊工具泛滥，300 万 GPTs 成为负担。
2. **无真分发**：只有简单搜索和榜单，没有推荐、没有社交传播、没有外部流量入口。
3. **无变现**：收入分成始终限美国、邀请制，开发者拿不到钱。
4. **形态太浅**：GPTs 本质是 prompt 包装，护城河为零，被 ChatGPT 原生能力不断吸收。

幸存者的共性：**绑存量入口 + 治理先行 + 真实分账**（Microsoft M365、Salesforce AppExchange、AWS 云采购通道、Poe per-message 分成）。

### 缺口 3：分级通知/移动审批 —— 全行业空白

- "关窗不停工"已被云端派解决（任务上云、桌面/手机当指挥台），但**"按重要程度决定怎么打扰你"没有产品做透**。
- 全调研中仅 ChatGPT（完成时手机推送）、Lindy（重要邮件发短信）做了主动触达。
- 行业主流假设用户会回到指挥台查看待审批项，"分级通知 + 移动端审批"是被低估的差异化方向。

### 缺口 4：人机协同词汇已收敛，但监督范式未产品化

2026 年 HITL 设计已形成标准词汇：
1. **动作前确认**（consequential action confirmation）
2. **审批/拒绝分支节点**（approve/reject）
3. **审阅并编辑后再执行**（review & edit）
4. **接管模式**（takeover）
5. **主动监督强制区**（watch mode）
6. **计划先行审批**（plan-then-act）
7. **异步审批收件箱**（async approval inbox）
8. **案件化 SLA 审批**（case-based SLA）

LangGraph 的 `interrupt()` + checkpointer 是开发者侧事实标准。但产品侧的"统一审批收件箱 + 分级放权"尚无标杆产品。

### 缺口 5：Agent 安全边界 —— 2026-07 集中爆发

2026 年 7 月集中爆发的安全事件：
- **OpenAI AgentForger**：钓鱼链接可在受害者企业工作区伪造并定时运行流氓 agent。
- **Claude Cowork SharedRoot**（CVE-2026-46331）：本地会话利用 Linux 内核缺陷逃逸 VM 沙箱、读取宿主机文件与 SSH 密钥。
- **OpenAI 评测 agent swarm 误伤 Hugging Face**：HF CEO 公开索要 agent traces 与 $100M 算力赔偿。

**"连接外部服务的 agent 让风险半径爆炸"**成为新共识，提示注入与权限最小化工具链远未成熟。

---

## 三、Agent 分发与 AI 员工的关键发现

### 3.1 Agent 市场/分发

- GPT Store 已被战略放弃，替代形态是 Apps SDK + ChatGPT 内嵌能力。
- **成功要素**：绑存量分发入口（M365、微信、AppExchange）远胜独立商店；信任与治理先行；真实变现机制（Poe per-message 最早跑通）。
- **形态升级**：从"prompt bot 商店"转向"有工具/有记忆/有评测的完整 Agent + 应用内嵌分发"。
- **托管/工具链基础设施**成并购主线：ClickHouse←Langfuse、Mintlify←Helicone、Meta←Manus、Celonis←Make。

### 3.2 AI 员工价值验证

- **只打"可量化闭环"场景**：客服（解决率/CSAT/成本每单）是唯一能"开箱证明 ROI"的品类，因此跑出 Sierra/Decagon/Fin 三家头部。
- **验收=商业条款**：3 个月 break clause、按 resolution/回复计费、POC 试点。结果：虚报型玩家（11x：70-80% 流失）爆雷，克制型玩家（Artisan 主动拒售、Sierra/Decagon 死磕解决率）胜出。
- **续费分水岭**：2026 续约季——大量 2025 年"AI 采用不惜代价"签下的合同首次面临续约，软 ROI 产品将迎来流失潮（Bessemer 明确预警）。

### 3.3 Outcome-based Pricing 实践

- **已进入真实合同**：Fin $0.99/解决、HubSpot/Adobe/Atlassian 2026 跟进。
- **同时出现回摆**：Salesforce 应客户要求回到 seat-based（预算可预测性优先）。
- **主流落地形态**：混合定价（底座订阅 + 结果/用量档位）。
- **结构性制约**：AI 毛利天然低 20-30 个点（token 成本 + 人工兜底），纯结果定价把成本波动风险留给厂商。
- **配套生态正在形成**：结果计费基础设施（Paid.ai、Zenskar）、新成功指标（解决率/自主完成率/采纳率）。

---

## 四、桌面 Agent 与 Workflow 关键发现

### 4.1 桌面 Agent

- 桌面端正在变成 **"agent 的指挥台 + 信任边界声明层"**，而非执行层本身。
- "关窗不停工"的胜出方案是 **cloud-run + 桌面/移动双端查看**，而非本地常驻。
- **"分级通知 + 托盘常驻"是全行业共同空白**。仅 Manus（"unlock idle resources"本地常驻）和 Cline cron/headless 接近真正的桌面常驻形态。
- 本地优先并未死，但退守为"隐私叙事 + 成本叙事"（Bionic/Jan/AnythingLLM）。

### 4.2 Agentic Workflow

- **企业侧 workflow 派占上风**：RPA/iPaaS 厂商（UiPath、Automation Anywhere、Make、Zapier、n8n）拥有连接面、权限/审计/治理体系和企业销售通道，把 agent 降为"画布上的一类节点"。
- **个人/团队侧 agent 派占上风**：Claude Cowork、ChatGPT agent、Manus 用"说一句目标就交付成果"的体验碾压拖画布。
- **汇合点已现**：双方终态都是"触发器/定时 + agent 节点 + 审批节点 + 交付物"。

### 4.3 监督界面最佳实践

1. **统一收件箱 > 多窗口**：所有等待审批项进入一个 queue，按"需要你决策"组织。
2. **审批卡片自包含**：目标 + 计划/diff + 关键证据 + 一键 approve/reject/edit。
3. **过程可回放、可断点介入**：Manus replay、ChatGPT narration + takeover。
4. **分层信任下放**：逐步审批 → 计划审批 → 仅高风险动作审批 → 全自动+事后审计。
5. **用 agent 减轻人的监督负担**：Roomote 第二模型复核代码、Braintrust Topics 自动聚类失败模式。

---

## 五、Milo 已有资产与市场缺口的映射

| Milo 已有 | 对应缺口 | 市场稀缺度 |
|---|---|---|
| **验收与返工机制**（交付→review→accepted→归档，output_spec 校验） | 缺口 1（验收缺口） | ★★★★★ 全行业只有商业条款级验收 |
| **MiloPack 带 evals 槽位**（llm-space Thread JSON = 质检报告） | 缺口 1 + GPT Store 死因 | ★★★★★ 直接回应"下载前验货" |
| **分级通知 reach 等级 + 关窗不停工 + 托盘常驻** | 缺口 3（分级通知空白） | ★★★★ 全行业空白，Milo 已实现 |
| **人事红线 + 秘书工具三级白名单 + 子进程隔离 + 密钥零落盘** | 缺口 5（安全边界） | ★★★★ 踩中 2026-07 安全焦虑 |
| **"组织即模板"**（下载 3 个 agent = 一个协同组织） | GPT Store 死因反面 | ★★★ 概念差异化清晰，尚无竞品 |
| LLM 唯一使用点 + 确定性路由 + 事件溯源回放 | 行业共识（harness 差异化） | ★★★ 工程可靠性优势 |

---

## 六、创新机会（按匹配度排序）

### 机会 1：把"验收"做成品类 —— Agent 界的质检局 ★ 最高优先级

**逻辑**：市场第一痛（eval gap）× Milo 最强资产（验收机制 + MiloPack evals）× 不与任何巨头正面冲突。

具体形态：
- **验收标准即协议**：把 output_spec 校验 + 返工轮次 + 验收记录定义成开放 schema，让"验收报告"成为可移植的工件。
- **质检报告即上架门槛**：MiloPack 的 evals 复跑结果公开——每个包带"通过率/重放证据/成本基线"，这是 GPT Store 没有、扣子商店做不了的东西。
- **对内是机制，对外是标准**：Milo 内部的交付验收 → 抽象为"任何 agent 交付物都可过一遍的验收网关"。

### 机会 2：吃透"分级通知 + 指挥台"空白 —— 一人管 N 个 agent 的交互范式定义者

**逻辑**：全行业空白，Milo 是唯一已实现的产品（reach 分级 + 系统通知 + 通知点击直达 + 关窗不停工）。

具体形态：
- 深化为**审批收件箱**设计：所有"等你决策"的事项聚合成 queue，按 reach 分级排序。
- **移动端审批**是终态：桌面 daemon + 手机只做批复。DeerFlow 官方已有 IM 渠道能力（飞书/微信/钉钉）可直接复用。
- 一句话定位：**"你的 AI 团队在干活，只有重要的事才打扰你"**。

### 机会 3：安全边界作为卖点 —— 踩中 2026-07 的时间窗口

**逻辑**：Cowork 沙箱逃逸、AgentForger 之后，"agent 能碰我什么"成为显性焦虑。Milo 的架构恰好是答案。

具体形态：
- 每成员一子进程、env 隔离、密钥最小注入、钥匙串零落盘。
- 人事红线 + L0/L1/L2 工具白名单。
- **显式产品化为"权限边界页"**：每个成员能看什么、能花多少、能动什么，一屏可见——云端 agent 权限大而模糊的反面。

### 机会 4：组织模板市场 —— 卖"团队"而非"agent"

**逻辑**：所有商店卖单体 agent，没人卖"编制好的组织"。Milo 的 org.yaml + MiloPack 天然支持成建制分发。

具体形态：
- "自媒体工作室" = 选题+撰稿+分发 3 成员 + 协作流 + 验收标准。
- 结合机会 1：**组织模板也带质检报告**（跑过什么任务群、验收通过率多少）。
- 避开 GPT Store 陷阱：不做流量市场，做**可验货的精品货架**。

### 机会 5（辅助）：成本账单 —— 每个任务群一张成本单

Uber CTO"烧穿 AI 预算"说明成本可观测是半成品。Milo 已追踪用量，可做：任务群结案时给出 token/时长/折算成本，超预算自动升级 reach。配合"验收"：质检报告里就有成本基线。

---

## 七、明确不做

| 方向 | 不做理由 |
|---|---|
| 通用个人 agent / 全能助手 | ChatGPT Work、Cowork、Manus 在烧钱换量 |
| No-code 可视化编排画布 | AgentKit/Gumloop/n8n/扣子已绞杀成红海 |
| AI 编码 agent | 估值泡沫最烈，DeerFlow 生态位也不在此 |
| 独立流量型 Agent 商店 | GPT Store/扣子商店双重证伪 |
| 云端执行转型 | 本地优先是 Milo 的信任卖点 |

---

## 八、与现有 TODO 的衔接

| 现有 TODO | 对应机会 | 建议 |
|---|---|---|
| 秘书 S2 提案卡 + 重放去重 | 机会 2（审批收件箱） | 提案卡就是审批卡，优先做 |
| 验收返工 R2/R3（轮次分节/归档激活） | 机会 1（验收品类化） | R2 完成后把验收记录导出为 schema 化工件 |
| `milo eval` 真实模型跑通 | 机会 1（质检报告） | **质检故事的起点，优先级应上调**——第一个 MiloPack 真实质检报告 = 品类定义时刻 |
| 执行超时无出口修复 | 机会 2（可靠性叙事） | 已在 P0，不变 |
| Registry v0（M4） | 机会 4（组织模板货架） | 按"精品+验货"而非"铺量"设计，绑定质检报告上架门槛 |

**一句话战略**：不做"又一个 agent 平台"，做 **agent 时代的质检层 + 指挥台**——用"可验收"重新定义 Agent 分发，用"分级打扰"重新定义人机协同。

---

## 附：主要信息来源

### 全球多智能体平台
- LangChain Series B：langchain.com/blog/series-b、siliconangle.com/2025/10/20
- Microsoft Agent Framework：venturebeat.com/orchestration/microsoft-retires-autogen-and-debuts-agent-framework
- OpenAI AgentKit：techcrunch.com/2025/10/06/openai-launches-agentkit
- Google A2A：forbes.com/sites/janakirammsv/2026/05/03、moneycontrol.com/technology/2026/07/07
- MCP：theregister.com/devops/2026/07/23、infoq.com/news/2026/07/mcp-ema-enterprise-auth、aaif.io

### 明星产品
- Cognition/Devin：techcrunch.com/2026/05/27/ai-coding-startup-cognition-raises-1b
- Manus：cnbc.com/2026/06/12、reuters.com/technology/tencent-talks-become-ai-start-up-manus-largest-shareholder
- Genspark：businesswire.com/news/home/20260617758937
- Sierra：techcrunch.com/2026/05/04/sierra-raises-950m
- Decagon：techcrunch.com/2026/03/04/decagon-completes-first-tender-offer-at-4-5b-valuation

### Agent 分发与 AI 员工
- GPT Store 失败分析：techcrunch.com/2024/03/20/openais-chatbot-store-is-filling-up-with-spam、wired.com/story/openais-gpt-store-has-left-some-developers-in-the-lurch
- Poe 分成：techcrunch.com/2024/04/09/poe-introduces-a-price-per-message-revenue-model
- Agent.ai：cxtoday.com/crm/over-2-million-people-are-using-hubspots-unofficial-ai-agent-platform
- Salesforce AgentExchange：diginomica.com/2025/12/03、salesforce.com/news/agentexchange-launch
- 11x 调查：techcrunch.com/2025/03/24/a16z-and-benchmark-backed-11x-has-been-claiming-customers-it-doesnt-have
- Harvey：cnbc.com/2025/08/04、reuters.com/2026/03/25
- Intercom/Fin：techcrunch.com/2026/06/15/salesforce-acquires-ai-customer-service-platform-fin-for-3-6b、bvp.com/atlas/the-ai-pricing-and-monetization-playbook
- Outcome pricing：venturebeat.com/orchestration/enterprise-ai-is-entering-an-evaluation-gap

### 桌面 Agent 与 Workflow
- Claude Cowork：claude.com/product/cowork、techcrunch.com/2026/07/07/the-coding-agent-wars-are-spilling-into-the-rest-of-the-office
- ChatGPT Agent：openai.com/index/introducing-chatgpt-agent
- LM Studio Bionic：lmstudio.ai/blog/introducing-lm-studio-bionic
- n8n：n8n.io
- Gumloop：techcrunch.com/2026/03/12/gumloop-lands-50m-from-benchmark
- LangGraph HITL：docs.langchain.com/oss/python/langgraph/interrupts
- HumanLayer：humanlayer.dev
- Agent 安全事件：thehackernews.com/2026/07/chatgpt-agentforger-flaw、appleinsider.com/articles/26/07/27/claude-cowork-can-escape-its-sandbox

### 中国市场
- QuestMobile 2026 AI 应用半年报：36kr.com/p/3894851032693769
- Meta 收购 Manus 及被否决：news.qq.com/rain/a/20251230A01CIV00
- 钉钉悟空：读创 2026-03-17
- 扣子/元器：infoq.cn/2025/07/28、finance.sina.com.cn/2024-08-15
- Dify：thepaper.cn/2025-04
- Trae/Qoder：aliyun.com/2026-07、csdn.net/2026-07

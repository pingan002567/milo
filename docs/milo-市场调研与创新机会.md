# Milo 市场调研与创新机会分析

> 首轮调研日期：2026-07-28（§一~§八）；补充调研：2026-08-03（§九 垂直/订阅）、2026-08-04（§十 免费版路径）
> 调研范围：全球多智能体编排平台、中国市场 AI 应用产品、Agent 分发与 AI 员工产品、桌面 Agent 与 agentic workflow 工具、垂直 B2B、个人付费订阅、免费/开源路径
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
- 行业常见胜出叙事是 cloud-run + 双端查看；**Milo 明确不走转云端执行**，用本机 daemon + 托盘常驻 + 分级通知差异化。
- **"分级通知 + 托盘常驻"是全行业共同空白**（机会 2）。
- 本地优先对 Milo 是信任卖点，不是退守。

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

### 机会 4：组织模板（精品货架）—— 分发"团队"而非单体 agent

**逻辑**：没人卖「编制好的组织」。Milo 的 org.yaml + MiloPack 支持成建制打包。

具体形态：
- "自媒体工作室" = 选题+撰稿+分发 + 协作流 + 验收标准。
- 结合机会 1：模板带质检报告。
- **形态边界**：本机/可控渠道的精品货架，**不是**独立流量商店（无榜单、无付费分成、无铺量上架）。

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
| 本地市场 + 组织模板 | 机会 4（精品货架） | **不做**流量型独立商店；模板分发仅本机/精品+质检门槛 |

**一句话战略**：不做"又一个 agent 平台"，做 **agent 时代的质检层 + 本机指挥台**——用"可验收"定义分发，用"分级打扰"定义人机协同；**不做流量商店、不做转云端执行**。

---

## 九、垂直领域与个人订阅蓝海调研（2026-08-03）

> 补充调研：垂直 B2B 格局（Harvey/Sierra/Abridge 等）+ 个人付费订阅赛道。目的：确定路径 B（垂直灯塔 + 通用基座）的灯塔场景。

### 9.1 垂直 vs 通用：市场共识

- VC 资金流向（Harvey $11B / Abridge $5.3B / Sierra $15.8B / EvenUp $2B+）说明 **2025-2026「垂直优先」是融资市场事实**；通用层被 OpenAI/Google/微软免费下沉。
- a16z 2026-07《Lighthouse or Landgrab》：先按「买方风险暴露度 × 社交证明传导性」选 GTM，再按「灯塔 → 抢地」顺序演进。**小团队做通用产品的唯一正确姿势 = 垂直灯塔先打透，再抽象回通用层。**
- 垂直关键不是功能深度，而是**数据/渠道/合规等结构性壁垒**（模型层不构成壁垒）。

### 9.2 垂直红海（已确认，勿进）

| 方向 | 证据 |
|---|---|
| 法律合同审查 | Harvey $11B、Spellbook、LegalOn $67M ARR 全线挤压 |
| 医疗临床文书 | Abridge $5.3B、Ambience、Freed $20M ARR、EHR 厂商原生 |
| 机构投研/文档分析 | Hebbia 占 40% 头部资管、Fiscal.ai 绑走 Google Finance/Perplexity |
| 客服 agent | Sierra $15.8B、Decagon $4.5B + Zendesk/Intercom 内置 |
| AI SDR/销售 | 11x 泡沫爆雷、Qualified 被 Salesforce 收购 |
| 国内 C 端问答选股 | 同花顺问财/东财妙想垄断入口 + 投顾牌照红线 |

### 9.3 个人付费订阅蓝海（已验证付费 × 格局未固化）

个人订阅市场结论：**不是没人付钱，而是每个人只给一个 $15–25/月的预算，只给看得见 ROI 的工具。** 蓝海 = 能写进用户账单当"替代品"的产品。

| # | 场景 | 付费证据 | 格局现状 | 定价带 |
|---|---|---|---|---|
| 1 | 个人执业者文书副驾（治疗师/教练/会计/房产经纪） | Freed 验证「$39–119/月换 2–3 小时」：$19M ARR、2 万付费医生 | 医疗已红，其他执业垂直空白 | $29–49/月 |
| 2 | 个人 AI 记忆层（本地优先第二大脑） | Reflect $10、Mem $14.99 都在活 | 混战无赢家 | $8–12/月 |
| 3 | AI 订阅审计/退订管家 | 41% 订阅疲劳、47% 取消率 | Rocket Money 旧式，无 AI 原生头部 | $3–5/月 |
| 4 | 播客/音频创作者再创作管线 | OpusClip $10M ARR、ElevenLabs $500M ARR | Opus 主攻视频，音频→图文无头部 | $19–29/月 |
| 5 | 消费者级合同/文书审查 | LegalZoom/Rocket Lawyer 已教育市场 | 无 AI 原生个人版头部 | $9–15/月 |

**价位带**：$15–25 是个人生产力甜蜜点；$50 是硬天花板（Lindy $49.99 被大量吐槽）；$100+ 仅当产品直接帮用户赚钱/省钱时成立（Freed 医生）。**订阅疲劳显著**（41% 疲劳、47% 取消、53% 旋转式订阅、AI 年订阅留存流失 79%）——个人只愿意高频可见 ROI 的单工具。

**伪蓝海（排除）**：通用个人 agent（Lindy 式，仅 9% 双订阅率）、陪伴/伴侣（337 个 app、Dot/Moxie/Yara 连死三个）、通用会议记录（免费化挤压）、通用生成类（Midjourney Top10→#46 教训）、第二大脑正面打 Notion AI。

### 9.4 结论：灯塔场景 = 个人投研小组

用「多成员协同价值 × 付费验证 × 与自身资产重合」筛选后，**投研工具层是唯一交叉最优解**：

- 付费已验证：理财订阅成熟（Monarch $99/年、Copilot Money $13/月），个人愿为"管钱相关"付费
- 格局未固化：机构端被 Hebbia/Fiscal.ai 围死，但**个人投资者"AI 小组干活"是结构性空白**——同花顺/东财做问答选股，不做多成员交付
- 多成员协同是 Milo 唯一能赢的姿势：财报解读 → 事件跟踪 → 组合复盘，天然是任务群流程
- 合规可绕：只做工具层（解读/复盘/跟踪），不碰荐股建议（投顾牌照红线）
- 定价建议（若收费）：$15–25/月，年付 $99–149 对标 Monarch

---

## 十、免费版路径决策（2026-08-04）

> 决策：**先不做订阅，只做免费版。** 商业化逻辑从"卖订阅"改为"开源/免费积累 → 云层/企业层变现"。
> 本决定替代 §9 的订阅定价计划，§9 的灯塔场景（投研小组）选择不受影响。

### 10.1 免费版格局：机会定位

| 层 | 现状 | 玩家 |
|---|---|---|
| 通用本地客户端 | 红海（6-7 个 4 万+ star） | AnythingLLM 64k、Jan 44k、LM Studio、Cherry Studio 49k |
| Agent 编排框架 | 已被占死 | CrewAI 57k、LangGraph 143k、Dify 151k |
| **本地优先 + 多成员协作** | **空白**——本地产品没协作，协作产品不上本地 | 没人站在正中 |

**定位结论**：通用本地客户端已红海、agent 编排框架已被占死，但「本地优先的多成员协作层」是真空白——AnythingLLM（协作最弱）、Jan/LM Studio（纯单机）、Obsidian（无 AI 编排）、Taskade/Dify（不上本地）都在旁边，**没人在正中**。

### 10.2 免费版四条现实路径（按可复制性排序）

| 路径 | 案例 | 适用性 |
|---|---|---|
| 1. 开源 → 云/托管层收费 | n8n（ARR $7M→$40M，一年 10 倍）、LangGraph Cloud、LM Studio 云 credits、Cline 网关 | **最主流最可复制**：本地永远免费，云上卖托管/协作/模型 credits |
| 2. 开源 → 融资 → 企业版 | Dify（151k star 才 $180M 估值）、CrewAI、Cherry Studio（天使轮） | 需要团队+销售能力，以后的事 |
| 3. 免费 → 小而美生意 | Obsidian（核心免费 + Sync/Publish 增值，0 融资） | 天花板：百万美元级 ARR |
| 4. 开源 → 被收购 | OpenClaw（385k star → 加入 OpenAI） | **彩票，不可作为计划**（本质是 acqui-hire；金额未披露） |

### 10.3 免费版四条红线（实证的坑）

1. **成本红线**：免费必须绑定 **BYO API key**。OpenClaw 月成本 $10–20K 是反面教材；免费托管推理 = 自费补贴用户。→ Milo 成员跑用户自己的 key（钥匙串机制天然符合）
2. **功能红线**：本地单机功能**永久免费**，收费只能落在云/协作/企业层。Chatbox 开源→闭源→再开源的反噬、AnythingLLM 社区敏感度（issue #4362）是前车之鉴
3. **安全红线**：权限模型先于功能。OpenClaw 爆红后 40+ 漏洞危机；Matplotlib 维护者被 AI agent 攻击。→ Milo 子进程隔离 + 密钥零落盘是对应资产，免费版就要当卖点
4. **维护红线**：防 AI 垃圾 PR/issue 洪流（Jazzband 已因此整体关停）——第一天配好过滤规则，早找 co-maintainer 防 burnout

### 10.4 机会窗口

- 2026 年是交叉点：n8n 的 AI 化（ARR 一年 10 倍）+ OpenClaw 本地 agent 热潮 + 多成员协作空白，三条线正好汇合
- **窗口 6–18 个月**：大厂（Codex、Claude Code、Google）正在下压到 agent 桌面场景
- **聪明打法**：挂靠 OpenClaw/ClawHub 生态做差异化层，而非从零发明轮子——「本地 + 多成员 + 质检」正是 ClawHub 生态没有的东西

### 10.5 获客渠道优先级（个人开发者资源有限）

1. GitHub 首发 + 演示 GIF/视频 README（冷启动基本盘）
2. X + 技术 KOL 圈层（OpenClaw/Karpathy/local AI 圈）——最高杠杆
3. Discord 社区（seed 期就开始，决定留存与生态）
4. Reddit（r/LocalLLaMA、r/selfhosted、r/AI_Agents）
5. 中文渠道（B站/小红书/公众号）做第二曲线，不占早期精力

### 10.6 免费版决策要点

- **免费版路线比订阅路线更适合**：订阅要解决付费信任（9% 双订阅率），免费靠「空白定位 + 差异化」冷启动
- Milo 架构资产（子进程隔离、事件溯源、验收机制、本地优先）正好是免费本地协作产品最稀缺的部分
- 不急着变现：先验证「本地多成员协作」品类有没有人用，有留存再走路径 1（云层收费）
- 下一步：① 写「为什么是 Milo」叙事 README（差异化定位）；② 补安全/权限模型文档；③ 跑通 `milo eval` 真实质检（品类定义时刻）

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

### 垂直领域（2026-08-03 补充）
- a16z《Lighthouse or Landgrab》：a16z.com/lighthouse-or-landgrab-how-to-pick-your-ai-sales-strategy
- Harvey：techcrunch.com/2025/12/04/legal-ai-startup-harvey-confirms-8b-valuation、cnbc.com/2026/03/25
- Hebbia/OpenAI：openai.com/index/hebbia
- Abridge：abridge.com/blog/series-d
- Sierra/Decagon/EvenUp/Spellbook/Ambience：sacra.com/c/ 各公司页
- 11x 教训：techcrunch.com/2025/03/24、techcrunch.com/2025/05/05/11x-ceo-hasan-sukkar-steps-down
- 中国合规：gov.cn/zhengce/zhengceku/202307/content_6891752.htm（生成式 AI 办法）、csrc.gov.cn（投顾牌照）

### 个人订阅（2026-08-03 补充）
- a16z State of Consumer AI：a16z.com/state-of-consumer-ai-2025-product-hits-misses-and-whats-next
- Speak $100M ARR：forbes.com/sites/rashishrivastava/2025/11/12
- ElevenLabs：elevenlabs.io/blog/500m-arr-and-new-investors
- OpusClip：getlatka.com/companies/opus.pro
- Freed：sacra.com/research/freed-at-19m-arr、getfreed.ai/pricing
- 陪伴市场：techcrunch.com/2025/08/12/ai-companion-apps-on-track-to-pull-in-120m-in-2025
- 订阅疲劳统计：readless.app/blog/subscription-fatigue-statistics-2026
- Lindy 定价：lindy.ai/pricing
- 失败案例：techstartups.com/2025/12/09/top-ai-startups-that-shut-down-in-2025
- 豆包/Kimi 定价：llmabacus.com/subscriptions

### 免费/开源路径（2026-08-04 补充）
- OpenClaw 复盘：leanware.co/insights/openai-openclaw-acquisition、reuters.com/business/openclaw-founder-steinberger-joins-openai
- Dify 融资：dify.ai/blog/dify-raises-30m
- n8n：sacra.com/c/n8n/、wikipedia.org/wiki/N8n
- LangChain B 轮：techcrunch.com/2025/10/21/open-source-agentic-startup-langchain-hits-1-25b-valuation
- LM Studio 定价：lmstudio.ai/pricing
- AnythingLLM 变现争议：github.com/Mintplex-Labs/anything-llm/issues/4362
- Roo Code 关停：github.com/RooCodeInc/Roo-Code
- AI 垃圾 PR 危机：thenewstack.io/ai-generated-code-crisis、coderabbit.ai/blog/ai-is-burning-out-the-people-who-keep-open-source-alive
- Cherry Studio 融资：163.com/dy/article/KQVV63MC051984TV.html
- Obsidian 免费化争议：reddit.com/r/ObsidianMD/comments/1shm3ym/

# Milo 编制体系详细设计（org.yaml + Member Contract + 秘书长）

> 对应《milo-产品方案.md》第五章的深化。核心抽象：**一个 DeerFlow 实例 = 一个成员**，实例内部的 agent/subagent 编排不属于本设计范围。
> 设计输入：三轮调研——① 多 agent 汇报关系的框架实践与人因证据；② 编排 DSL 先例（CrewAI/AutoGen/Claude Code/A2A/ASL/Argo/GHA/K8s CEL/Dify）；③ DeerFlow 2.0 源码级配置面核实（main@c9b6131）。
> 术语：本文通篇使用领域层中性术语（组织/成员/招募/请离）；前端与市场话术采用「一人公司/数字员工」展示层映射，对照表见《milo-产品方案.md》§2.5（2026-07-19 决策）。
> 更新：2026-07-19

---

## 0. 设计输入的关键结论（决定本设计形态的事实）

**来自 DeerFlow 2.0 源码核实：**
- 外部编排器驱动单实例的路径**完全闭环**：HTTP Gateway 提供 threads/runs/stream（SSE + Last-Event-ID 断点续传）、webhook 完成回调、`GET /api/threads/{id}/artifacts/{path}` 产物下载、`POST /api/agents` 人设 CRUD、`PUT /api/skills/custom/{name}` 技能安装。
- DeerFlow 已内置**实例内静态编制**：per-user agents 目录（`SOUL.md` 人设 + config.yaml）和 `subagents.custom_agents`（等价 Claude Code 的 `.claude/agents`）。**Milo 不重复发明这两层，MiloPack 直接映射到它们**；Milo 只发明 DeerFlow 没有的：实例间组织与路由。
- `DeerFlowClient` 是**进程内嵌入式客户端**（非 HTTP SDK）→ MVP/产品路径为**每成员一子进程**；**不做**容器/K8s 云端执行面（见产品方案「明确不做」）。
- Redis stream bridge 是 Gateway 内部的 SSE 扇出通道（无版本化 schema），**不作为对外集成面**；事件一律走 SSE。
- DeerFlow 单实例多副本尚不完整（issue #3948/#4189）——Milo 每成员一实例，不受影响。

**来自 DSL 先例调研（十条铁律，本设计逐条落实）：**
1. 配置零可执行代码（AutoGen FunctionTool `source_code` 被弃用是最强反面证据）
2. 表达式语言全 DSL 只用一门，选 CEL（K8s KEP-3488 论证：非图灵完备、必然终止、可静态类型检查、可成本预算）
3. 表达式在结构化值层面求值，禁止"先文本替换再解析"（Argo 炸引号、GHA 注入的共同根因）
4. 长 prompt 放 Markdown 正文不放 YAML 字段（Claude Code 模式）
5. 产物双通道：结构化参数值 + 对象存储引用（Argo 模式），大件强制引用传递（ASL 256KB 教训）
6. 封装接口类型化 + 引用强制版本 pin（GHA reusable workflow 模式；Argo 无 pin 是致命缺陷）
7. 子团队与成员同构递归（AutoGen ComponentModel 模式）
8. spec/status 分离 + 控制器调和（K8s CRD 模式）
9. 策略的两个正交维度分开：表达式坏了怎么办（failurePolicy）vs 条件命中做什么（actions），支持先 Warn 灰度
10. 版本化：毕业制 apiVersion + 字段只随版本删 + 无损往返 + 导入兼容分级（K8s + Dify 组合）

**来自可视化编排调研：**汇报关系不画成边（Coze 跳转边"看着确定、实际靠 LLM 猜"是反面教材；Flowise supervisor 画布整体废弃；LangChain 官方拒绝做画布）。org.yaml 用"文件 + 表单 + 只读组织图"呈现。

---

## 1. 概念模型

```
组织 Organization（一份 org.yaml）
 ├── 成员 Employee   = DeerFlow 实例 + MiloPack（档案/技能证书）
 ├── 部门 Department = 若干成员的封装，对上表现为一个"虚拟成员"（类型化接口）
 ├── 秘书长  = 用户唯一对话入口 + 编制调和控制器 + 任务调度器（Milo 运行时，非 LLM 人设）
 └── 制度 Policies   = 路由 / 流水线 / 升级 / 重试 / 限额
```

**非目标（明确排除）：** 实例内部的 Lead Agent、subagent、中间件编排；实例内 trace 的解析与存储（链接到 DeerFlow 自带 Langfuse 观测）；LLM 自由裁量的"经理人设"。

**硬护栏（不随配置开放）：** 部门嵌套深度 ≤2；每层扇出 ≤5；成员之间不存在直接通信通道（一切经 秘书长 路由 + artifact 交接）。

---

## 2. org.yaml v1 规范

### 2.0 分期实施：先做"小组模式"（v0）

> 2026-07-18 范围决策：MVP 只做**小组模式**——单层编制，组长（用户）→ 秘书长 → 组员。

- **v0 小组模式（MVP）**：org.yaml 仅需 `spec.members` + `spec.limits` 两段。路由用内置默认（秘书长 分解任务后按 pack 能力声明自动匹配，无匹配 → 问组长）；升级策略用 MiloPack `permissions` 派生的默认集。**departments / manager / acceptance / replicas / 自定义 routing / pipelines 全部推迟。**

  ```yaml
  apiVersion: milo.dev/v1alpha1
  kind: Organization
  metadata: {name: my-team}
  spec:
    members:
      - {name: lit-scout, pack: ~/.milo/packs/lit-scout@2.1.0}
      - {name: writer,    pack: ~/.milo/packs/cn-writer@3.0.0}
    limits: {maxParallelMembers: 5}
  ```

- **v1**：自定义 `routing` 规则（CEL）+ `pipelines`（DAG）。
- **v2**：`departments`（封装）+ `manager`/`acceptance`（主管成员）+ `replicas`（工位池）+ 组织模板成建制分发。
- 本文其余章节描述完整目标架构，实现按此分期裁剪；schema 从第一天就用完整 apiVersion 演进规则，保证 v0 文件在 v1/v2 无损升级。

### 2.1 顶层结构

```yaml
apiVersion: milo.dev/v1alpha1        # 毕业制：v1alpha1 → v1beta1 → v1
kind: Organization
metadata:
  name: due-diligence-inc
  version: 1.3.0                     # 本编制文件自身的版本（与 schema 版本正交，双轴）
  description: 尽调组织：市场调研 + 财务分析 + 法务审查
spec:
  members: [...]                   # 2.2
  departments: [...]                 # 2.3
  routing: {...}                     # 2.4
  pipelines: [...]                   # 2.5
  escalation: {...}                  # 2.6
  retries: {...}                     # 2.7
  limits: {...}                      # 2.8
status: {...}                        # 仅 秘书长 可写，见 §4
```

YAML 1.2 严格模式（规避 `on:`→true 的 1.1 陷阱）；文件中禁止出现任何 secret 与可执行代码。

### 2.2 成员定义

```yaml
members:
  - name: market-researcher
    pack: ~/.milo/packs/market-researcher@2.4.0   # 本机包源引用，强制 pin 版本（无公开 Registry）
    runtime:
      mode: container                # container | embedded（进程内 DeerFlowClient，本地模式）
      replicas: 1                    # 同岗多实例工位池（扇出场景，如 3 篇文章并行写）；副本共担同一能力声明
      model_bindings:                # MiloPack 声明档位，部署端绑定具体模型（secret 在部署端，不入文件）
        reasoning: deepseek-r1
        basic: doubao-pro
      sandbox: aio                   # 透传 DeerFlow sandbox provider 选择：local|aio|k8s|boxlite|e2b
  - name: financial-analyst
    pack: ./packs/financial-analyst        # 本地路径（开发态）；组织模板分发必须解析为 ~/.milo/packs 引用
```

- 成员的 persona/skills/capabilities/permissions/evals 全部来自 MiloPack，org.yaml 只做**引用与绑定**，不内联 prompt（长文本留在包内的 Markdown，Claude Code 教训）。
- 能力声明沿用 MiloPack manifest 的 `capabilities`，结构借 A2A AgentCard skill：`{id, description, tags[], examples[]}`——路由的依据。

### 2.3 部门（同构递归 + 类型化接口）

```yaml
departments:
  - name: legal
    uses: ~/.milo/team-packs/legal-review@1.2.0   # 成建制引用（本机精品货架），强制 pin 版本
    inputs:                                            # GHA reusable workflow 式类型化接口
      - {name: contract_files, type: artifact, required: true}
    outputs:
      - {name: review_report, type: artifact}
      - {name: risk_level,   type: parameter}          # 结构化 JSON 值
  - name: research               # 也可内联定义（Argo 式轻量复用）
    members: [market-researcher, news-scanner]
    coordination: milo           # milo（默认，确定性调度）| manager: <成员名>（高级，动作被硬约束）
```

- 部门与成员**同构**：任何接受成员的位置（routing.assign、pipeline task）都接受部门（AutoGen ComponentModel 语义）。
- 对上只暴露 inputs/outputs 与聚合后的 capabilities；内部成员、内部失败重试对上不可见，只交付 artifact + 摘要（SocietyOfMind 封装，切断 telephone game）。
- 深度 ≤2、禁环由 lint 静态保证。

**三层组织（用户-部门经理-部门成员）的映射：**

部门内"经理"分两种模式，由 `manager` 字段选择：

```yaml
departments:
  - name: content
    manager: chief-editor            # 可选：指定主管成员；缺省 = Milo 运行时确定性协调
    members: [chief-editor, topic-scout, writer, illustrator]
    inputs:  [{name: brief, type: parameter}]
    outputs: [{name: articles, type: artifact}]
    acceptance:                      # 部门内验收规则（有 manager 时由主管执行）
      rubric: evals/article-rubric.json
      max_rejections: 2              # 退回超限自动升级到 秘书长
```

- **默认模式（无 manager）**：部门内分解/派活/验收全部由 Milo 运行时确定性执行。适合流程标准化的部门。
- **主管成员模式（manager: <成员名>）**：当管理动作本身需要领域判断时（如主编决定稿件过审与修改意见），指定一名成员任主管。其权力被 schema 硬约束为两个动作：① 把部门任务信封分解为成员任务信封（结构化 API，非自由对话）；② 按 `acceptance.rubric` 验收成员产物（通过 / 退回+意见，`max_rejections` 超限自动升级）。主管**不能**改路由、招募/请离、跨部门指挥、直接触达用户；升级仍必须经 秘书长。——既获得经理的领域判断，又规避 LLM 经理失控（CrewAI 反例）。
- 汇报与升级**逐层过滤**：成员 → 部门（主管/协调器聚合为部门级摘要）→ 秘书长 → 用户；每层先消化自己能决定的，到用户面前只剩所有者级决策。
- 三层结构不突破护栏：深度 ≤2 限的是部门嵌套；"用户→秘书长→部门→成员"纵向链路是标准形态，监督幅度在每层独立生效（秘书长 面对的部门+独立成员 ≤5，部门内成员 ≤5）。
- **汇报拓扑 ≠ 执行拓扑（并行不受层级影响）**：层级决定信息上行与决策下行；能否并行由流水线 DAG 的数据依赖决定。四级并行全部保留——① 跨部门/成员并行派单；② 部门内：主管的分解是一次性动作、不在执行路径上，成员并行开工，主管仅在验收检查点被事件唤醒；③ 同岗多实例扇出（`runtime.replicas` 工位池）；④ 流水线逐件流转，不设批处理屏障（第 1 件过审即流入下游，不等全部完成）。真正的串行点只有三个：数据依赖（任务本性）、验收检查点（异步事件驱动缓解，退回只影响单件）、用户决策（block 升级只冻结触发它的任务分支，其余照常）。

### 2.4 路由（节点级 router + 有序 case + 强制 default）

```yaml
routing:
  rules:                                               # 有序匹配，首个命中生效（ASL Choice 语义）
    - match: 'task.capability in ["contract-review", "legal-risk"]'   # CEL，结构化求值
      assign: legal
    - match: 'task.tags.exists(t, t == "finance")'
      assign: financial-analyst
  default: ask_user                                    # 必填：ask_user | reject | <成员名>
```

- 表达式语言**只有 CEL**，可用变量为类型化的 `task`（任务信封）、`org`（编制快照）；保存时做静态类型检查与成本上限校验。
- LLM 只参与 秘书长 的**任务分解**（把用户请求变成带 capability 标签的任务信封）；**信封→成员的匹配是确定性 CEL 求值**——语义理解和路由执行分离，规避 Coze"跳转边靠 LLM 猜"的不可调试性。

### 2.5 流水线（DAG：depends 谓词 + 产物双通道）

```yaml
pipelines:
  - name: full-dd-report
    inputs:
      - {name: target_company, type: parameter, required: true}
    tasks:
      - name: collect
        assign: research
        delegation: assign                   # assign（任务信封，默认）| consult（只读咨询，结果即答复）
      - name: legal-review
        assign: legal
        depends: "collect.Succeeded"         # Argo depends 谓词：Succeeded|Failed|Skipped|AnySucceeded…
        inputs:
          contract_files: "${tasks.collect.outputs.artifacts.contracts}"
      - name: synthesize
        assign: financial-analyst
        depends: "collect.Succeeded && legal-review.Succeeded"
        inputs:
          risk: "${tasks.legal-review.outputs.parameters.risk_level}"
    onExit: report_to_user                   # 成功失败都执行（Argo onExit）
```

- **产物双通道**：`outputs.parameters`（小的结构化 JSON 值，有大小上限）+ `outputs.artifacts`（对象存储引用 + mediaType）。超限参数由运行时强制转 artifact 引用（ASL 256KB 教训的预防性设计）。
- 引用 **Skipped 任务的输出直接报错**，不静默给空值（Argo 教训）。
- 委派语义显式枚举（OpenAI handoff vs as-tool 的区分）：`assign` = 完整任务信封、产物交付；`consult` = 单问单答、不产生交付物。不提供 agent 间自由 handoff。

### 2.6 升级策略（正交双维度 + 灰度）

```yaml
escalation:
  policies:
    - name: external-side-effect
      when: 'action.permissions.network_external == true'
      actions: [block]                # warn（记录不打扰）| escalate（上报用户决策）| block（拦停）
      failurePolicy: Fail             # 表达式求值失败时：Fail（按最严处理）| Ignore
    - name: low-confidence
      when: 'report.confidence < 0.6'
      actions: [escalate]
    - name: budget-80pct
      when: 'usage.tokens > task.budget.tokens * 0.8'
      actions: [warn]                 # 新策略先 warn 灰度观察，再升 escalate/block（K8s validationActions 模式）
```

- 默认策略集来自 MiloPack manifest 的 `permissions` 声明（包作者收敛权限 → 用户少被打扰），org.yaml 只做覆盖与补充。
- 运行指标：override 率、单任务打扰次数——逼近告警疲劳阈值（CDSS 90% override 的反面教材）时在 Console 提示策略需要收敛。

### 2.7 重试与失败（分类错误名 + 表达式条件 + 退避）

```yaml
retries:
  default:
    maxAttempts: 2
    retryOn: [Employee.Timeout, Employee.Transient]    # 错误命名空间：Milo.* 保留，Employee.* 成员侧
    backoff: {duration: 30s, factor: 2, maxDelay: 10m, jitter: full}
  overrides:
    - task: legal-review
      when: 'lastRetry.reason == "Employee.TokenCapped"'   # 表达式条件重试（Argo lastRetry 模式）
      maxAttempts: 1
```

`Milo.Runtime`（引擎级错误）不可被 retryOn 通配捕获（ASL `States.Runtime` 教训）；重试耗尽 → 按 escalation 处理。

### 2.8 限额

```yaml
limits:
  maxParallelMembers: 5        # 上限即默认，可调小不可调大（监督幅度证据）
  maxDepartmentDepth: 2          # 硬上限
  taskTokenBudget: 2000000       # 对齐 DeerFlow subagents.token_budget 的量级
  pendingQueueBackpressure: 3    # 用户待批队列超过 N 时自动降并行
```

### 2.9 版本化与分发

- **schema 演进**（K8s 废弃政策）：字段只随 apiVersion 删除；相邻版本无损往返转换（保证自动迁移工具可行）；废弃字段导入时发 Warning 不静默忽略。
- **导入兼容分级**（Dify 模式）：文件 apiVersion 超前或 major 落后 → 挂起待用户确认；minor 落后 → 带警告导入；解析失败 → 拒绝。
- **组织模板发布**：org.yaml + 所有 pack/department 引用解析为内容寻址 pin，打包上架；导入端重绑 model_bindings 与 secrets（Dify credential 教训：凭据永不随模板走，导入时提供"重绑向导"）。

---

## 3. Member Contract 与 DeerFlow 2.0 映射

### 3.1 任务信封（秘书长 ↔ 成员的唯一任务载体）

```json
{
  "task_id": "t-8f3a", "parent_task": "t-8f00", "context_id": "ctx-a1",
  "capability": "contract-review",
  "objective": "审查 X 组织股权转让协议中的对赌条款风险",
  "output_spec": {"format": "markdown", "artifacts": ["review_report"]},
  "inputs": {"parameters": {...}, "artifacts": [{"name": "contracts", "uri": "s3://…", "mediaType": "…"}]},
  "budget": {"tokens": 500000, "deadline": "2026-07-18T12:00:00Z"},
  "constraints": ["不得访问外部网络", "引用需注明条款编号"]
}
```

结构化委派四要素（objective / 输出格式 / 边界 / 预算）是 Anthropic 多 agent 系统的核心经验，在此为 schema 强制。

### 3.2 任务状态机（借 A2A 9 态裁剪）

```
queued → assigned → working ⇄ input-required(escalate) → delivered → accepted
                              ↘ failed / canceled / rejected（终态不复活）
```

终态任务不复活；后续工作创建新任务，以 `context_id` 关联、`parent_task` 回指（A2A 的 contextId/referenceTaskIds 设计）。

### 3.3 六动作 → DeerFlow 2.0 落点

| 动作 | 子进程成员（SubprocessAdapter，主路径） | 同进程成员（EmbeddedAdapter，开发兜底） |
|---|---|---|
| `enroll` | 渲染成员工作区（config / SOUL.md / skills）→ 拉起子进程 worker → `DeerFlowClient` + 装技能 | 同进程构造 `DeerFlowClient`（弱隔离） |
| `assign` | JSON-RPC 下发信封 → 子进程内 `stream()` | `client.stream()` |
| `status` | 子进程事件流归一化为三槽位 / 进度 | stream 迭代器 |
| `escalate` | `ask_clarification` / 契约标记 → `input-required` | 同左 |
| `deliver` | `get_artifact` + output_spec 校验 → 组织级 artifacts 目录 | 同左 |
| `dismiss` | 终止子进程 + 归档/清理成员工作区 | 释放 client |

- **不做** HTTP Gateway 容器成员 / webhook / Redis stream 集成面 / K8s 执行面。
- MiloPack 中 worker 定义映射到 `subagents.custom_agents`——由 DeerFlow 消费，Milo 写入后不再感知。

---

### 3.4 数据隔离模型

**默认全隔离 + 唯一受控共享通道。** 第三方包不可信；隔离防横向移动，并保障并行正确性与上下文质量。执行面固定为本机子进程（**不做云端容器面**）。

**六层隔离（默认态，成员互不可见）：**

| 层 | 设计 | 实现 |
|---|---|---|
| 计算 | 每成员一实例一子进程 | SubprocessAdapter + 独立崩溃域 |
| 文件系统 | 独立工作区、skills/memory，互不可见 | `orgs/<org>/members/<name>/` 目录隔离 |
| 上下文 | 对话历史只在本实例；群消息流成员不消费 | 实例边界 + hub-and-spoke |
| 数据库 | 实例 checkpoint 各自独立；控制面库只存组织级数据 | 每成员 SQLite + milod 库 |
| 网络 | 出网按 permissions 收敛（工具白名单不装即不可用） | 渲染时不注入高危工具 |
| 密钥 | 按成员最小注入模型/MCP 凭证 | bindings + 钥匙串；不落盘 |

**唯一共享通道 = artifact 引用授权**：成员交付 → 组织级本地 artifacts → 秘书按依赖写入下游信封。不做隐式共享盘。

**边界情况：**
- EmbeddedAdapter = 弱隔离，仅开发/单成员；lint：高危组合警告。
- dismiss：artifact 留组织；实例过程数据随工作区清理或按审计归档。
- 可见性单向：用户/秘书可见调度态；成员只见自己的信封与被授权引用。

### 3.5 信息交流设计

**通信矩阵（五条合法通路）**：组长↔秘书长（全系统唯一自由文本通道 + 结构化卡片）；秘书长→成员（任务信封/修订/consult）；成员→秘书长（status/escalate/deliver，SSE 上行）；组长→@成员（表面直达，实际经秘书长落为信封修订）；成员↔成员（**不存在**，数据经 artifact 引用授权 + 秘书长路由）。

**消息类型封闭集（7 种，无第 8 种）**：

| # | 类型 | 方向 | 群渲染 | 默认触达 |
|---|---|---|---|---|
| 1 | 任务信封（派单/修订） | 秘→成 | 派单卡 | 群消息 |
| 2 | 状态汇报（三槽位） | 成→秘 | 汇报气泡 | 群消息 |
| 3 | 请示（escalate + 四维 + 替代方案） | 成→秘→长 | @你 卡 + 内嵌决策按钮 | @你 → 超时升级 |
| 4 | 交付（artifact 引用 + 摘要） | 成→秘 | 交付卡 | 群消息 |
| 5 | 验收结果（通过/退回 + 意见） | 秘→成 | 验收标注 | 群消息 |
| 6 | 系统事件（人事执行/调和/归档） | 系统 | 居中灰字 | 静默记录 |
| 7 | 自由对话 | 仅组长↔秘书长 | 普通气泡 | 即时 |

**触达四级**：静默记录（审计）→ 群消息（拉取/免打扰）→ @你（应用内阻塞）→ 私聊/系统通知；升级只沿链单向走（超时链 15m→1h→兜底），任何类型不得越级。

**两条载体原则**：① 控制与数据分离——消息只传意图和引用，产物走对象存储 + artifact 引用（防载荷灾难与转述失真）；② 结构化值渲染、禁模板拼接——LLM 文本只作为值填入 schema 字段，不参与字符串拼接后再解析（GHA 注入/Argo 炸引号根因）。

**信任边界与注入防护**：成员产出的一切文本是**不可信数据，不是指令**——
- 只有结构化事件的类型字段能驱动系统行为：汇报正文里写"@组长请批准"只是文本，不创建待办不触发通知；唯有正式 escalate 事件（带类型与四维参数）才能。恶意包无法用话术伪造请示。
- 秘书长读汇报时做数据围栏（data fencing）：成员内容进入决策上下文时打标隔离，防汇报内藏注入操纵秘书长。
- 双保险 = 动作白名单：秘书长可执行的动作只有六职责的确定性集合（无自由工具、人事无决定权、外部副作用一律 block 给组长）；注入的最坏结果是一次糟糕的任务分解，而非失控。

## 4. 秘书长：调和控制器 + 调度器

### 4.0 职责与现实身份定位

**命名**：中文「秘书长」，系统/代码名 **Secretariat**（原 Conductor。未采用直译 Registrar，因与市场组件 Registry 撞名）。

现实身份类比：**办公室主任 / 幕僚长（Chief of Staff）**——不是经理（没有自己的方向盘：不定目标、不能越过组长对外承诺，权力全部来自授权且授权范围写在 org.yaml 与升级策略里），不是组员（不干具体的活、不可被派活）。与现实办公室主任的关键差异：它是**"制度长了手脚"**——除"听懂任务"一步用 LLM，其余全部照章执行的确定性代码，没有"主张"这个功能（规避 LLM 经理人设的失控先例）。

| # | 职责 | 具体做什么 | 实现方式 |
|---|---|---|---|
| 1 | 听懂任务 | 把组长的话变成结构化任务信封（目标/输出要求/边界/预算） | **唯一用 LLM 的环节** |
| 2 | 派单 | 按组员能力声明匹配任务，无人能接则回问组长 | 确定性代码 |
| 3 | 跟进汇总 | 收组员三槽位汇报，聚合为组长视角的进度；细节留档可下钻 | 确定性代码 |
| 4 | 挡驾与请示 | 按升级策略判断哪些事需要组长拍板，其余静默记录 | 确定性代码 |
| 5 | 人事执行（**无决定权**） | 仅执行组长的人事决定——招募/请离/版本变更一律由组长在市场或编制中发起；新成员试用评测不合格时**上报组长**而非自动请离；可基于绩效数据提出人事**建议**，无权自行变动 | 确定性代码 |
| 6 | 验收交付 | 按 output_spec 校验交付物，装配后呈给组长 | 确定性代码 + rubric |

**编制调和（K8s controller 模式）**：`spec` 是期望编制，秘书长 持续调和实际组织——缺员则 enroll、裁撤则 dismiss、pack 版本变更则滚动替换（先 enroll 新、验证 Ready、再 dismiss 旧）。

**人事红线：`spec` 只有组长可写。** 市场招募、请离、pack 版本变更全部是组长动作，秘书长仅把组长已签署的编制落实为实例操作；禁止任何自动人事变动（不自动升级版本、不自动扩编、试用评测不合格不自动请离——一律上报组长决定）。秘书长可基于绩效数据（评测分下滑、交付被退回率）在汇报中提出人事建议，但建议 ≠ 决定。

`status` 仅 秘书长 可写：

```yaml
status:
  observedGeneration: 3            # 对应哪一代 spec（K8s observedGeneration）
  members:
    - name: legal
      conditions:
        - {type: Ready, status: "True", reason: EvalPassed, lastTransitionTime: …}
```

成员加入后先跑 MiloPack 自带 evals（冒烟）才置 Ready——"试用期"语义，复用包内质检报告。

**任务调度**与调和分离：用户请求 → 秘书长 用 LLM 做**任务分解**（产出任务信封）→ CEL 路由确定性匹配成员 → 按 pipeline/依赖派发 → 汇总交付。双通道汇报、三槽位状态、待批队列背压（详见产品方案第五章）。

---

## 5. Console 编辑器设计

**不做连线画布**（调研证据一边倒）。三视图：

1. **组织图（只读）**：自动布局的组织→部门→成员树 + 运行时叠加（谁在忙、待批事项、本期打扰次数）。图用于看，不用于编辑。
2. **表单编辑**：成员增删、model_bindings、路由规则（条件构建器生成 CEL，高级用户直写）、升级策略、限额。节点内配置进表单（Dify Agent 节点模式）。
3. **文件模式**：org.yaml 直接编辑，与表单双向同步；git 友好、可 code review（画布 JSON 不可 diff 的教训）。

**任务群（交互式工作记录）**：每任务一群（组长 + 秘书长 + 相关组员）。组员汇报、秘书长派单/指示/验收均以结构化事件渲染为群消息——派单（任务信封摘要卡）、汇报（三槽位）、升级（标注"已转呈组长"）、交付（artifact 卡 + 验收结果）；气泡带类型标签、点开还原原文、事件驱动生成不可编辑。组长可在群内直接发言乃至 @组员，指令统一经秘书长落为任务信封修订并同步相关组员（单一事实源，防双头指挥）。群默认免打扰（进度通道），@组长 即阻塞通道；超时升级链：群内 @ → 私聊/系统通知 → 按预授权策略兜底（暂停分支或安全默认）。组员侧不消费群消息流，仍只接收秘书长下发的点对点信封（hub-and-spoke，群是给人看的视图）；任务终结群归档为审计记录。**入口**：左侧边栏 = 上半部功能导航 + 下半部任务群列表（支持搜索；@你 未处理的群带角标；已归档群置灰可查）；点击任务群在中间栏展开会话，右栏同步显示该任务上下文。**待办 = 跨群 @你 事项的聚合视图**：点击待办条目跳入对应任务群，在 @你 消息上就地处理（消息内嵌决策按钮）；待办卡片上保留快捷按钮供不进群直接处理，两处操作同源同步。系统通知（私聊升级）点击同样直达对应任务群。

**校验三级：**
- 编辑时 lint（本地 schema）：引用不存在的成员、路由环、部门深度/扇出超限、CEL 类型错误、无 default 的 routing、引用 Skipped 输出、YAML 1.1 布尔字面量。
- 发布 checklist（服务端真实依赖校验，Dify #29629 教训——前端校验会漏）：pack 是否存在且过 SkillScan、能力声明与路由规则的覆盖缺口（有规则路由不到任何成员）、model_bindings 是否绑全、语义警告（全 block 的升级策略=打扰风暴预测、串行流水线配并行）。
- 运行时 guard：escalation 策略求值 + failurePolicy 兜底。

---

## 6. 配置体系

**总原则：按"谁写"分两类。** 用户签署的配置（手写/UI 编辑落盘，git 友好）vs 系统生成的配置（渲染产物，只读、手改会被调和覆盖）——延续人事红线逻辑：spec 用户写，生成物系统写。

**关键拆分：可移植的制度 vs 不可移植的环境绑定。** `org.yaml` 说"要什么"（编制/限额/升级策略/超时链——可发布为组织模板）；`bindings.yaml` 说"用什么资源满足"（档位→模型、密钥引用、沙箱选择——绝不入模板）。模板天生干净，导入端走重绑向导（Dify 密钥难题的结构化解法）。

### 6.1 目录布局与分层

```
~/.milo/
├── settings/                      # ① 应用层（跨组织全局）
│   ├── app.yaml                   #    通知偏好 / 主题 / 语言 / 遥测开关 / 快捷键
│   ├── providers.yaml             #    模型供应商与档位标注（basic/reasoning/vision/code；密钥→钥匙串引用名）
│   └── packs.yaml                  #    本机包源目录列表（默认 ~/.milo/packs；不做公开 Registry）
└── orgs/<org>/                    # ② 组织层（每组织一目录）
    ├── org.yaml                   #    编制：用户可写的唯一组织事实源（可移植）
    ├── bindings.yaml              #    环境绑定：model_bindings 默认 / sandbox / secretariat.model（不可移植）
    └── members/<member>/          # ③ 成员层：渲染产物（只读）
        ├── deerflow-config.yaml   #    由 MiloPack manifest + org.yaml 条目 + bindings 按优先级渲染
        ├── SOUL.md                #    persona 映射产物
        └── skills/
```

- 成员配置优先级：MiloPack manifest 默认 < org.yaml 成员条目 < bindings.yaml。
- ④ 任务层（预算/截止/边界）在任务信封里，属运行时数据，不落配置。
- 制度性参数归 org.yaml（升级超时链 mention 15m→dm 1h→兜底、背压阈值、fallback 策略）；环境性参数归 bindings（秘书长分解任务用哪个模型等）。

### 6.2 四条规则

1. **密钥零落盘**：一切 yaml/包/模板只存引用名（`api_key_ref: deepseek-main`），真实密钥入 OS 钥匙串（macOS Keychain / Windows DPAPI）——桌面端形态的天然优势；团队版换 Vault/KMS，引用制不变。导入模板/包时重绑向导逐项映射档位与凭证。
2. **渲染产物碰不得**：deerflow-config.yaml 是编译结果；成员详情提供"查看生效配置"只读视图。渲染器按 DeerFlow `config_version`（当前 26）维护模板兼容矩阵，不兼容阻断并提示升级 Milo（对应 §7 spike 第 6 项）。
3. **文件是事实源，UI 是编辑器**：设置界面每个操作落盘为上述文件（同编制三视图逻辑），全部可 git 管理；校验沿用三级（编辑 lint / 应用前 checklist：密钥引用可解析 + provider 连通性 + DeerFlow 版本兼容 / 运行时 guard）。
4. **会重启成员实例的配置变更需组长确认**（如换模型绑定）：不属人事变动（pack 身份未变）但影响行为，确认后由秘书长滚动重启调和。

### 6.3 MVP 裁剪

v0 仅需五个文件（app / providers / packs / org / bindings）+ 钥匙串；MCP 凭证管理推至 v1（随自定义路由），团队版密钥后端推至 v2（公开 Registry 已明确不做）。所有用户可写文件带 apiVersion，沿 §2.9 的毕业制与导入兼容分级演进。

## 7. 风险与 spike 清单（更新）

| # | 验证项 | 方式 |
|---|---|---|
| 1 | **escalate 事件形态**：实例内澄清/中断在 SSE 里的确切事件类型，能否可靠归一化为 input-required | spike 第一优先：容器起一实例，构造需澄清任务，抓全事件流 |
| 2 | enroll 全链路：MiloPack → config.yaml 渲染 + POST /api/agents + skills 安装的自动化 | spike |
| 3 | 进程内成员（DeerFlowClient）与容器成员的行为一致性（同一合同双实现） | spike |
| 4 | webhook 可靠性与 deliver 的产物完整性（workspace-changes vs output_spec 校验） | spike |
| 5 | CEL 求值引擎选型：cel-python 仅 Beta、无 cost API → 用 conformance 测试集验收，或 Go sidecar | 技术评估 |
| 6 | DeerFlow config_version 快速演进（当前 26）对 config.yaml 渲染模板的冲击 | 适配层按 config_version 做模板矩阵 |

---

## 附：设计决策溯源速查

| 设计点 | 来源 |
|---|---|
| 实例即成员、不编排内部 | DeerFlow 2.0 已内置实例内编制（custom_agents/SOUL.md）；耦合面收敛 |
| 单领队、扁平、≤5、深度≤2 | Anthropic/Claude Code/Devin/Manus 共识；Cummings 2–4、Graicunas 5–6；MultiAgentBench 树形垫底 |
| 部门=封装、类型化接口、强制 pin | AutoGen SocietyOfMind + GHA reusable workflow；Argo 无 pin 反例 |
| CEL 唯一表达式语言、结构化求值 | K8s KEP-3488；Argo 三套语法反例；GHA 注入反例 |
| 产物双通道、大件引用化 | Argo parameters/artifacts；ASL 256KB 反例 |
| 路由=LLM 分解+确定性匹配 | Coze 跳转边反例；CrewAI manager 人设反例 |
| 升级策略正交双维度+灰度 | K8s failurePolicy/validationActions |
| spec/status、observedGeneration、调和 | K8s CRD/Operator |
| 版本毕业制、导入分级、凭据重绑 | K8s 废弃政策 + Dify DSL |
| 不做画布、文件+表单+只读图 | Flowise V1 废弃、n8n 收敛、LangChain 拒绝画布、Hamel spaghetti 批评 |
| 任务状态机、终态不复活 | A2A Task 生命周期 |
| 结构化委派四要素 | Anthropic 多 agent 系统工程博客 |

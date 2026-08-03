# Milo 技术规划（MVP · 小组模式）

> 承接《milo-产品方案.md》与《milo-编制体系详细设计.md》的全部设计决策。
> 范围：小组模式 MVP——组长 → 秘书长 → 组员（单层，≤5 并行），桌面端 App。
> 2026-07-18

---

## 1. 总体架构

```
┌─ 桌面壳 (Tauri 2 + React/TS) ────────────────────────────┐
│  六屏 UI（秘书/待办/组织/本地市场/编制/设置）+ 任务群会话   │
│  系统通知 · 钥匙串代理 · 文件对话框                        │
└──────────────┬───────────────────────────────────────────┘
               │ localhost HTTP + WebSocket（事件推送）
┌──────────────┴─ milod（Python 3.12 本地守护进程）─────────┐
│  api/          FastAPI + WS：UI 的唯一后端                │
│  secretariat/  分解(LLM) · 路由(确定性) · 调度 · 升级引擎  │
│                · 验收 · 编制调和                          │
│  adapter/      Member Contract：SubprocessAdapter（主）   │
│                EmbeddedAdapter（单成员开发兜底）            │
│  pack/         MiloPack 解析/校验/渲染器                   │
│  config/       五文件分层加载 + keyring 钥匙串             │
│  store/        SQLite：org/task/event(append-only)/audit  │
│  artifacts/    本地对象存储目录                             │
└──────────────┬───────────────────────────────────────────┘
               │ stdio JSON-RPC（每成员一子进程）
┌──────────────┴─ 执行面（本机，不做云端）──────────────────┐
│  每成员一子进程 · DeerFlowClient + 私有工作区              │
│  明确不做：ContainerAdapter / docker-py 执行面 / K8s 上云  │
└──────────────────────────────────────────────────────────┘
```

**为什么这样分**：
- milod 独立于 UI 进程 → 关窗口不断任务，组员后台继续干活，升级走系统通知（桌面产品关键体验）。
- 核心逻辑在 Python → DeerFlowClient（进程内客户端）必须同进程；spike 代码直接演化为 adapter/ 模块，零浪费。
- UI 壳选 Tauri 2（体积小、Rust 侧只做壳），若团队更熟 Electron 可平替，UI 层不感知。

## 2. 技术选型表

| 层 | 选型 | 理由 / 备选 |
|---|---|---|
| 桌面壳 | Tauri 2 | 体积/内存优；备选 Electron（团队熟悉度优先） |
| UI | React 18 + TypeScript + Tailwind | 直接移植原型设计系统（松绿/琥珀 token） |
| 本地后端 | Python 3.12 + FastAPI + Pydantic v2 | 同 DeerFlow 生态；schema 即代码 |
| UI↔后端 | REST + WebSocket | WS 推 7 类事件；REST 做操作 |
| 存储 | SQLite（WAL）+ 本地 artifacts 目录 | 单用户本地优先；事件表 append-only 即审计日志 |
| 密钥 | keyring（Keychain/DPAPI） | 配置体系"密钥零落盘" |
| 成员运行时 | 子进程 + DeerFlowClient | **不做** docker/K8s/云端执行转型 |
| 秘书长 LLM | OpenAI 兼容客户端直连 provider | 复用 providers.yaml；不经 DeerFlow |
| 调度 | asyncio 单进程 | 并行 ≤5，无需消息队列 |
| Schema | JSON Schema 单一来源（packages/schemas） | org.yaml/MiloPack/信封/事件四套，前后端共用生成类型 |
| 包发现 | 本地包目录 + Agent 库 | **不做**流量型独立商店 / 公开 Registry 服务 |

## 3. 模块与接口要点

### 3.1 adapter/（Member Contract，spike 直接演化）
- `MemberAdapter` 抽象基类：`enroll / assign / status_stream / escalate_events / deliver / dismiss`
- `SubprocessAdapter`（主路径）：每成员一子进程，stdio JSON-RPC，env/工作区隔离
- `EmbeddedAdapter`：同进程单成员开发兜底（弱隔离）
- **不做** `ContainerAdapter` / 云端 Gateway 执行面（见产品方案「明确不做」）
- 事件归一化：子进程事件 → Milo 7 类消息（**信任边界在此**：只有结构化字段驱动行为）

### 3.2 secretariat/
- `decompose.py`：唯一用 LLM 的模块——用户输入 + 组员能力清单 → 计划（任务信封数组）；输出走 JSON Schema 强校验
- `route.py`：确定性能力匹配（v0 内置规则：capability 交集 + 空闲优先；无匹配 → ask_user）
- `scheduler.py`：asyncio 派发、依赖等待、并行 ≤5、待批队列背压
- `escalation.py`：策略求值（v0 用 pack permissions 默认集）+ 超时链状态机（@你 15m → 系统通知 1h → 兜底暂停分支）
- `acceptance.py`：output_spec 校验 + 交付装配
- `reconcile.py`：编制调和（org.yaml diff → enroll/dismiss/滚动替换；**人事红线：仅执行已签署的 spec，无自主变动**）

### 3.3 pack/ 与 config/
- MiloPack 校验器（manifest JSON Schema + SkillScan 调用 + 权限静态审查）
- 渲染器：manifest + org.yaml 条目 + bindings → deerflow-config.yaml（**按 config_version 维护模板矩阵**，不兼容即阻断）+ SOUL.md + skills 目录
- config/ 五文件分层加载、监听变更、"重启类变更需组长确认"的调和钩子

### 3.4 store/ 事件模型
- `events` 表：append-only，7 类消息全量落库（group_id, task_id, type, actor, payload, ts）——任务群渲染、审计日志、trace 回放同源
- `tasks`：信封 + A2A 裁剪版状态机（queued/assigned/working/input-required/delivered/accepted/failed/canceled，终态不复活）

## 4. 里程碑

| 里程碑 | 周期 | 内容 | 验收标准 |
|---|---|---|---|
| **M0 Spike** | 2 周 | 六动作逐项验证；密钥最小注入 | spike 报告 + MemberAdapter 雏形 |
| **M1 核心闭环（CLI）** | 3 周 | 子进程全流程；`milo init/add/run/reply/log`；config + keychain + 渲染器 | 终端完成"招募→派单→交付验收" |
| **M2 秘书长 + 任务群** | 4 周 | decompose + 路由 + 调度 + 升级 + 验收；WS 事件流 | 两成员并行 + 计划批准 + escalate |
| **M3 桌面壳** | 4 周 | Tauri + React 六屏 + 分级通知 + 本地市场验货 | 原型交互落在真实数据上 |
| **M4 MiloPack 打磨** | 4 周 | pack 校验器 + llm-space 导入 + `milo eval` 质检报告 | **不做**公开 Registry / publish 商店 |

M3+M4 结束 ≈ 产品方案 Phase 1+2（本机 MVP）。流量商店与云端执行不进里程碑。

## 5. 仓库结构（monorepo）

```
milo/
├── apps/desktop/            # Tauri + React（M3）
├── packages/
│   ├── milod/               # Python 后端（M1 起）
│   │   └── src/milod/{api,secretariat,adapter,pack,config,runtime,store}/
│   ├── schemas/             # JSON Schema 单一来源（M0 起）
│   └── cli/                 # milo 命令（M1）
├── spikes/                  # M0：验证脚本 + 报告（演化进 milod/adapter）
├── prototypes/              # 现有 HTML 原型（设计基准）
└── docs/                    # 产品方案 · 编制设计 · 本文
```

## 6. 技术风险与对策

| 风险 | 对策 |
|---|---|
| escalate 事件形态未知（全案第一风险） | M0 第一项；若 SSE 无结构化澄清事件，绕行方案：以 run 中断态 + goal API 轮询归一化 |
| DeerFlow config_version 漂移（当前 26，迭代快） | 渲染模板按版本矩阵；harness 依赖 pin 官方 tag + `subdirectory=backend/packages/harness`；升级 Milo 才升模板 |
| 多成员内存（每成员一子进程） | 懒启动 + 闲置回收；单机并行硬顶 ≤5 |
| 秘书长 decompose 质量 | JSON Schema 强校验 + 拒绝重试；计划必须过用户批准 |
| 事件风暴（成员刷屏） | adapter 层节流 + 三槽位归一化去重；events 表分页 |

## 7. 轻量化实现路线（embedded-first，先行执行）

> 2026-07-18 决策：embedded-first；2026-07-31 修订：**取消** ContainerAdapter / 云端执行面（明确不做）。

- **形态（SPIKE-02 修正）**：milod 主进程（秘书长）+ **每成员一子进程**，子进程内一个 `DeerFlowClient`。
  修正原因：harness 的 `_app_config` 是进程级单例，后构造的 client 会覆盖先前全局配置；`get_paths()` 按环境变量动态解析——**单进程多成员不是安全隔离**（与编制设计 §3.4 冲突），且 asyncio 并发下无法用环境变量规避。
  子进程方案仍属轻量（无 Docker，纯 Python 子进程），拿回独立全局配置/环境/内存/崩溃域；主子进程间走 stdio JSON-RPC 传信封与归一化事件。`EmbeddedAdapter`（同进程）降级为单成员开发模式。
- **每成员一套私有目录树**：`<org-root>/members/<member>/{config.yaml, home/{agents/<member>/{config.yaml,SOUL.md}, skills/custom/…, threads/, memory.json}}`——`DEER_FLOW_HOME` 含记忆与会话历史，绝不可共用。
- **依赖引入**：DeerFlowClient 非 PyPI 独立包（源码在 `backend/packages/harness/deerflow/`）——pip git 依赖 pin 官方 tag + `subdirectory=backend/packages/harness`；不可安装则 git submodule vendor（spike 首验）。关注官方 `rfc-create-deerflow-agent.md`（纯参数 SDK 工厂）落地后简化。
- **六动作 SDK 映射**（SPIKE-01 已校正，见 `spikes/01-escalate-events/REPORT.md`）：enroll=渲染工作区+构造 `DeerFlowClient(config_path, agent_name, checkpointer)`；assign=`stream(message: str, *, thread_id)`（**同步 Generator**）；status=`messages-tuple` 事件归一化；**escalate=契约化标记 `MILO_ESCALATE` 结构化块**（运行时无独立中断事件——原假设证伪）；deliver=`get_artifact(thread_id, path)`+output_spec 校验；dismiss=释放 client+归档目录。
- **SPIKE-02 修正（重要）**：harness **内置结构化升级机制**——`ask_clarification` 工具（参数：question / clarification_type ∈ {missing_info, ambiguous_requirement, approach_choice, risk_confirmation, suggestion} / context / options）被 `ClarificationMiddleware` 拦截后产出 `ToolMessage(name="ask_clarification", artifact.human_input)` 并 `Command(goto=END)` 中断等待用户。**escalate 主信号改用它**（自定义 `MILO_ESCALATE` 降级为兜底），`clarification_type` 直接映射升级策略分类。信任边界更稳固：由运行时中间件保证，不依赖成员照人设办事。
- **SPIKE-02 其他实测**：`skills.path` 必须显式指向成员工作区（缺省指向"调用方项目根"，技能会静默不可见）；`tools` 是 list，权限收敛的正确实现是**不往列表里放该工具**而非 `enabled: false`。
- **SPIKE-01 推翻的两条原判断**：① `plan_mode=True` 不产生阻塞审批（只是 `write_todos` 自列计划后直接执行）→ **计划前置授权必须由秘书长在 Milo 侧实现**，不依赖运行时；② escalate 无结构化事件 → 三层方案叠加：契约标记（主）+ 秘书长判定（兜底）+ permissions 收敛使高危动作根本不可执行（不依赖成员自觉）。
- **新增 M1 必办项**：传入 SQLite checkpointer——无 checkpointer 时每次 stream 无状态，组长群内补充信息无法接续上下文。
- **明说的妥协**：隔离降级为目录级（同进程共享 env/文件权限，即 §3.4 embedded 弱隔离；密钥 keyring 解出后进程内注入，成员间密钥不隔离，lint 照常警告高危组合）；沙箱用 local provider（allow_host_bash: false）。
- **收益**：无 docker-py/webhook/云端面；**ContainerAdapter 已取消，不作为后续里程碑**（明确不做转云端执行）。
- **spike 增补验证项**：① harness 可安装性；② 多成员子进程并发；③ thread 生命周期；④ escalate 形态；⑤ 内存上限。

## 8. 立即可开始的三件事

1. `spikes/01-escalate-events/`：起官方容器，构造澄清任务，抓全 SSE 事件流（**第一优先**）
2. `packages/schemas/`：冻结四套 JSON Schema（org.yaml v0 / MiloPack manifest v0 / 任务信封 / 7 类事件）
3. `spikes/02-enroll-render/`：最小 MiloPack → 渲染 → /api/agents 注入链路

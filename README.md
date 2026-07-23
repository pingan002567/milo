# Milo

> Agent 市场 + AI 组织指挥台（基于 DeerFlow 2.x）
> MVP：小组模式——你 → 秘书 → 成员（≤5 并行），桌面端，embedded-first。
> 第一设计原则：**一个 DeerFlow 实例 = 一个组织成员**，实例内部的 agent/subagent 编排不在产品范围内。

## 仓库结构

```
├── docs/               # 设计文档（索引见 docs/README.md）
├── packages/
│   ├── schemas/        # 四套 JSON Schema 单一来源：org / milopack / envelope / events
│   ├── milod/          # 本地守护进程（Python 3.12 + FastAPI）：秘书 / adapter / 渲染器 / 事件库
│   └── cli/            # milo 命令行
├── apps/desktop/       # 桌面壳（React 19 + Vite + Tauri 2）
├── packs/              # 仓库自带 Agent 模板（py-dev / web-dev / code-reviewer）
├── spikes/             # 可运行的技术勘探 + 报告
└── prototypes/         # HTML 原型归档
```

设计文档全部在 [`docs/`](docs/README.md)：产品方案、编制体系、技术规划，以及每轮实现前的专题设计定稿。

## 当前状态

核心闭环已跑通，形态在打磨。**任务群七阶段**：下达 → 开群 → 分解（LLM 唯一使用点）→ 计划批准 →
逐步派单（确定性路由）→ 执行落点（升级 / 交付验收 / 超时）→ 用户确认 → 归档。

### 已完成

- **技术勘探** Spike 01/02/03 全部跑通 → 关键结论：harness 内置 `ask_clarification` +
  ClarificationMiddleware 提供结构化升级中断（升级主信号）；`_app_config` 是进程级单例
  → **每成员一子进程**（SubprocessAdapter，stdio JSON-RPC，env 隔离 + 密钥最小注入）
- **M1 CLI 闭环** `milo init / add / run / reply / log / recover`
- **M2 milod API** FastAPI + WS 七类事件（含 reach 触达等级）+ REST（成员 / 任务群 /
  跨群待办聚合 / 下达 / 答复 / 计划批准 / 验收返工）
- **断点续跑四层齐全** 对话 checkpointer · 中断点 resume · 进程崩溃恢复 · WS 断线补发（`?since=seq`）
- **桌面壳** 三栏布局 + Tauri 托盘常驻 + 关窗不停工 + 按 reach 分级系统通知 + 通知点击直达
- **成员生命周期** 市场发现验货 → Agent 库 → 聘用命名（实例化即快照，与模板脱钩）→
  加入 / 停职 / 复岗 / 移出；**人事红线：只能由用户发起，秘书仅执行与建议**
- **验收与返工** 交付 → review 待确认 → accepted 已验收 → 归档；未确认的永远等你，
  只有确认过的才进 24h 清理倒计时
- **秘书 Agent S1** 每团队一实例，Milo Tools 三级白名单（L0 只读 / L1 低危写 / L2 提案卡）
- **成员私聊** 全权调教通道（自改人设与档案），唯一工程约束 = 线程门禁（`-dm` 后缀）
- **会话形态** 代码级复用 DeerFlow 官方 ai-elements（MIT，见 NOTICE）+ 思考链 / TODO 计划 /
  引用来源 / 停止回合 / 附件 / 用量 / 反馈；数据层 react-query

### 待办

按优先级：

1. **执行超时 600s 后任务留 `working` 无出口**（与已修的分解失败死锁同类）
2. 秘书 S2：人事提案卡 + 事件注入转述 + 重放去重
3. 验收返工 R2/R3：轮次分节 UI · 跳过确认开关 · 归档群重新激活
4. 团队管理 P1 删除团队 / P2 首次运行向导
5. `milo eval` 真实模型跑一次（密钥已入钥匙串，条件具备）
6. 长尾：鉴权 · Registry v0（M4）· llm-space Thread JSON 导入 · Tauri 真机验证通知直达

## 启动

```bash
./scripts/dev.sh              # 一键起 milod + 前端 → http://localhost:1420
./scripts/dev.sh --tauri      # 以 Tauri 桌面窗口启动
./scripts/dev.sh --stop       # 停止
```

模型密钥优先从系统钥匙串读取，不落盘：

```bash
security add-generic-password -s milo -a MIMO_API_KEY -w   # 一次性写入
```

也可 `export MIMO_API_KEY=sk-…`（仅经环境注入子进程）。首次运行会自动初始化团队 `demo`
到 `~/.milo` 并放示例包到 `~/.milo/packs`。改用其他模型：设置页「AI 配置」，
或编辑 `~/.milo/orgs/demo/bindings.yaml`（`api_base` / `model` / `secret_env`）。

**首次使用路径**：市场页收藏/下载模板 → 团队页「聘用」起名 → 「加入」热加载实例 →
秘书页下达需求 → 批准计划 → 成员请示时在决策卡就地答复 → 交付后验收确认。

> `kill -9` milod 会遗留 worker 孤儿进程占 `checkpoints.sqlite`，清理需连
> `pkill -f milod.adapter.worker`。

<details><summary>不用脚本，手动起两个进程</summary>

```bash
# 后端
export PYTHONPATH=packages/milod/src MILO_HOME=~/.milo
spikes/01-escalate-events/.venv/bin/python -m uvicorn milod.api.server:app --port 8899

# 前端（另一个终端）
cd apps/desktop && npm install && npm run dev
```

纯命令行也可用（不开界面）：

```bash
export PYTHONPATH=packages/milod/src MILO_HOME=~/.milo
P=spikes/01-escalate-events/.venv/bin/python
$P packages/cli/milo_cli.py init demo
$P packages/cli/milo_cli.py add demo ~/.milo/packs/lit-scout
$P packages/cli/milo_cli.py run demo "整理三条大模型应用场景要点"
$P packages/cli/milo_cli.py log demo               # 任务群列表
$P packages/cli/milo_cli.py reply demo <task> "…"  # 答复请示
```

</details>

## Spike 快速开始

```bash
cd spikes/01-escalate-events
python3.12 -m venv .venv && source .venv/bin/activate
pip install "deerflow-harness @ git+https://github.com/bytedance/deer-flow@main#subdirectory=backend/packages/harness"
export DEEPSEEK_API_KEY=sk-…   # 或按 member-config.template.yaml 里的 $VAR 提供
python spike.py --workdir ./run1
```

依赖较重（langgraph/langchain 全家桶），首次安装耐心等待。

## 归属

会话 UI 部分组件逐字复制自 [bytedance/deer-flow](https://github.com/bytedance/deer-flow)
官方前端（MIT），保留归属头，详见 [NOTICE](NOTICE)。

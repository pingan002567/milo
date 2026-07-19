# Milo

> Agent 应用商店 + AI 组织指挥台（基于 DeerFlow 2.x）
> MVP：小组模式——组长 → 秘书长 → 组员（≤5 并行），桌面端，embedded-first。

## 仓库结构

```
├── milo-产品方案.md / milo-编制体系详细设计.md / milo-技术规划.md   # 设计文档（评审基准）
├── packages/
│   ├── schemas/        # 四套 JSON Schema 单一来源：org / milopack / envelope / events
│   ├── milod/          # 本地守护进程（Python 3.12 + FastAPI）
│   └── cli/            # milo 命令行（M1）
├── spikes/
│   ├── 01-escalate-events/   # escalate 事件形态验证（第一优先，可运行）
│   └── 02-enroll-render/     # enroll 渲染链路验证
└── prototypes/         # HTML 原型归档（桌面端为主线）
```

## 当前状态（M0 起步）

- [x] 设计定稿（产品方案 / 编制体系 / 技术规划）
- [x] harness 可安装性预检：`backend/packages/harness` 含 pyproject（`deerflow-harness` 2.1.0，Python ≥3.12）→ pip git 依赖成立
- [x] **Spike 01：escalate 事件形态 —— 已跑通**（`spikes/01-escalate-events/REPORT.md`）
      · SDK 可安装 ✅ · stream 同步 Generator ✅ · thread_id 调用方自定 ✅
      · escalate 无独立事件类型 ❌ → 改用契约标记 `MILO_ESCALATE`（已回填 EmbeddedAdapter）
      · plan_mode 不阻塞审批 ❌ → 计划前置授权由秘书长侧实现
- [x] **Spike 02：enroll 渲染链路 —— 已跑通**（`spikes/02-enroll-render/REPORT.md`）
      · MiloPack→工作区渲染 ✅ · SOUL.md 人设注入 ✅ · skills 白名单 ✅（`skills.path` 须显式指向工作区）
      · permissions 收敛 ✅（不注入工具即无法越权）
      · **重大发现：官方内置 `ask_clarification` + ClarificationMiddleware 提供结构化升级中断**
        → 取代自定义标记成为主信号，修正 Spike 01 的结论
- [x] **Spike 03：SubprocessAdapter 端到端 —— 已跑通**（`spikes/03-subprocess-adapter/REPORT.md`）
      · 两成员各自子进程、人设不串台 ✅ · 并行 10.7s ✅
      · 结构化升级 ✅ · **中断→答复→resume 接续且保持上下文** ✅ · 汇报节流 ✅
- [x] **M1 CLI 闭环 —— 已完成**
      · `milo init / add / run / reply / log` 五命令真机跑通
      · pack 渲染器 · 事件 append-only 落库 · 秘书长（分解+路由+验收）· SubprocessAdapter
      · 升级就地应答（决策卡按 `input_mode` 渲染，可输编号选择）
      · 顺序执行 + 产物前递（v0 无 DAG，避免下游空手接单）
      · 回归测试：`packages/milod/tests/test_normalize.py`（六场景全绿）

## 已修复的三个真实缺陷（均由实测暴露）

1. **升级 question 为空**：原从流式 `tool_call.args` 重建载荷，增量未拼完即读取。改为优先取
   ToolMessage 的 `artifact.human_input`（harness 的版本化 UI 契约），并对半截载荷做等待 + 兜底上报。
2. **任务状态被覆盖**：`dispatch` 中 `await assign()` 返回时事件流已跑完、状态已是
   `input_required`，其后再写 `WORKING` 覆盖终局 → 等待循环永远不结束。改为 await 前置状态。
3. **选项逐字拆分**：`options` 在流式增量里可能是未解析的 JSON 字符串，直接迭代把一句话
   拆成 80 个选项。改为 `_coerce_options()` 规范化（半截 JSON 宁可无选项也不产乱码）。

- [x] **M2 API 层 —— 已跑通**（`packages/milod/src/milod/api/README.md`）
      · WS 实时事件流（含 reach 等级，桌面端据此决定是否弹系统通知）
      · REST：成员 / 任务群列表（pending 角标）/ 群会话 / **跨群待办聚合** / 下达 / 答复
      · 实测：下达 → WS 收 escalation → 待办聚合 → POST reply → 成员接续产出

- [x] **数据层对齐 DeerFlow 会话实现**：content/metadata 分离 · category 粗分类 ·
      run_id 执行边界 · groups 元数据表（标题/状态自动维护）
- [x] **崩溃恢复**：启动时接续孤儿任务（`milo recover`）——成员凭 checkpoint 续跑而非重跑；
      实测强杀后恢复，attempts+1 / 新 run / stop_reason 留痕
- [x] **断线重连**：WS `?since=<seq>` 补发历史后转实时；实测无缺漏无重复
      → **断点续跑四层能力齐全**（对话状态 / 中断点 / 进程崩溃 / 流断线）

- [x] **计划批准回合**：计划暂存 → `GET /plan` → `approve`（可修订目标与交付要求）/ `reject`；
      修订留痕。顺带修掉「交付摘要丢失导致验收误判」的缺陷

- [x] **桌面壳骨架**（`apps/desktop/`）：React 三栏 + WS 接入，Playwright 实测
      「下达 → 计划卡批准 → 成员请示 → 决策卡就地答复 → 续跑」全链路可用

- [x] **Tauri 壳 + 系统通知**：托盘常驻、关窗不退出（成员继续干活）；
      `reach` 分级触发通知（仅 mention/notify），按 request_id 去重、补发不重复通知

- [x] **产品面补全**：组织切换（多组织隔离，localStorage 记忆）· 市场页（权限声明前置 +
      质检门槛，可一键招募）· 编制页（org.yaml 可视化含护栏说明）

## 下一步

- 点击通知直达任务群 · 招募后热加载 · 鉴权 · evals 冒烟
- 鉴权（官方 harness 无鉴权，控制面必须自带）
- 桌面壳（Tauri + React，按 `prototypes/milo-desktop.html` 实现）
- evals 冒烟（成员加入时的"试用期"）

## 启动

```bash
export MIMO_API_KEY=sk-…      # 模型密钥（不落盘，仅经环境注入子进程）
./scripts/dev.sh              # 一键起 milod + 前端 → http://localhost:1420
./scripts/dev.sh --tauri      # 以 Tauri 桌面窗口启动
./scripts/dev.sh --stop       # 停止
```

首次运行会自动初始化组织 `demo` 到 `~/.milo`，并放一个示例包到 `~/.milo/packs`，
可直接在「市场」页招募。改用其他模型：编辑 `~/.milo/orgs/demo/bindings.yaml`
（`api_base` / `model` / `secret_env`），密钥仍走环境变量或系统钥匙串。

**首次使用路径**：市场页招募 `lit-scout` → 重启 `./scripts/dev.sh` 让成员上岗 →
秘书长页下达需求 → 批准计划 → 成员请示时在决策卡就地答复。

<details><summary>不用脚本，手动起两个进程</summary>

```bash
# 后端
export PYTHONPATH=packages/milod/src MILO_HOME=~/.milo MIMO_API_KEY=sk-…
spikes/01-escalate-events/.venv/bin/python -m uvicorn milod.api.server:app --port 8899

# 前端（另一个终端）
cd apps/desktop && npm install && npm run dev
```

纯命令行也可用（不开界面）：

```bash
export PYTHONPATH=packages/milod/src MILO_HOME=~/.milo MIMO_API_KEY=sk-…
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

依赖较重（langgraph/langchain 全家桶），首次安装耐心等待；跑通后把 `events.jsonl` 与类型直方图记入 spike 报告。

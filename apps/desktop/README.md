# Milo 桌面壳

Tauri 2 + React 19 + TypeScript。UI 只做展示与交互，所有逻辑在 milod 守护进程。
设计 token 取自 `prototypes/milo-desktop.html`（松绿 + 琥珀，深浅双主题）。

## 开发

```bash
# 1) 起后端（另一个终端）
export PYTHONPATH=packages/milod/src MILO_HOME=~/.milo MIMO_API_KEY=…
python -m uvicorn milod.api.server:app --port 8899

# 2) 起前端
cd apps/desktop && npm install && npm run dev   # http://localhost:1420
```

Vite 把 `/api` 与 `/ws` 代理到 `127.0.0.1:8899`，前端只认同源。

## 结构

```
src/
├── lib/api.ts            # REST 客户端 + WS 订阅（断线按 seq 水位自动重连补发）
├── components/GroupView  # 任务群会话：消息流 · 决策卡 · 计划卡
├── App.tsx               # 三栏骨架 + 状态管理
└── styles.css            # 设计 token
```

## 三栏布局

| 栏 | 内容 |
|---|---|
| 左 | 功能导航（秘书长/待办/组织，带角标）+ 可搜索任务群列表（`@你` 角标、归档置灰） |
| 中 | 秘书长对话 / 待办聚合 / 组织架构 / **任务群会话**（计划卡 · 消息流 · 决策卡） |
| 右 | 检查器：任务群元信息、任务状态与执行次数；非会话页显示组员与秘书长说明 |

底部状态栏：WS 连接状态（绿/黄/红）、组员数、任务群数、待决数。

## 决策卡按契约渲染

依据 harness 的 `human_input_request`：

- `input_mode = choice_with_other` → 选项按钮 + "其他"输入框
- `input_mode = free_text` → 纯输入框
- `context` 作为背景单独展示，`policy` 上标于卡头

答复经 `POST /tasks/{id}/reply` 提交，与待办页、系统通知三处同源。

## 实测（2026-07-19，Playwright 驱动）

下达需求 → 计划卡出现（含步骤与产物）→ 批准 → 派单 → 成员请示 →
**决策卡带四个可点选项**渲染 → 就地答复 → 成员续跑。
左栏 `@你` 角标、待办角标、状态栏待决数三处联动。

修掉的两个缺陷：
1. **计划卡不出现**——下达后 1.2 秒即拉计划，而分解要几十秒；改为进群后由事件驱动，
   群转 `waiting` 时再取。
2. **消息显示原始 JSON**——WS 实时帧未带 `content`（只有断线补发路径有）；
   已让 `Store.append` 回填 `MiloEvent.content`，实时帧与补发帧同源。

## Tauri 壳

```bash
npm run tauri dev     # 开发（自动起 Vite）
npm run tauri build   # 打包 .app / .dmg
```

`src-tauri/src/main.rs` 只做系统集成，业务逻辑全在 milod：

- **托盘常驻 + 关窗不退出**：`CloseRequested` 时 `hide()` 并 `prevent_close()`——
  关掉窗口不等于停工，成员仍在 milod 里干活，有请示经系统通知触达。
  托盘菜单「退出（成员将停止）」才真的结束。
- **系统通知**：`tauri-plugin-notification`，权限在 `capabilities/default.json` 声明。

## 通知分级（打扰稀缺性的执行点）

`src/lib/notify.ts` 把事件的 `reach` 翻译成打扰策略：

| reach | 含义 | 行为 |
|---|---|---|
| `silent` | 审计记录 | 不通知 |
| `group` | 进度通道 | 不通知，仅入会话流 |
| `mention` | @你（阻塞） | **系统通知** |
| `notify` | 私聊/超时提醒 | **系统通知（高优先）** |

两条去重规则：
- 按 `request_id` 去重——harness 保证其稳定，成员重试澄清不会重复弹窗
- `replay` 帧（断线补发的历史）不触发通知——否则重连一次就被历史事项轰炸

非 Tauri 环境（浏览器开发）自动退化为 Web Notification。

实测（Playwright 拦截 Notification 构造）：计划阶段 0 条通知 ✅ ·
成员请示触发 1 条 ✅ · 刷新页面走补发路径 0 条重复 ✅。

## 六屏

| 屏 | 内容 |
|---|---|
| 秘书长 | 下达需求入口 |
| 待办 | 跨群 `@你` 聚合，点击直达任务群 |
| 组织 | 成员实时状态（忙/闲） |
| **市场** | 本地包扫描；**权限声明前置展示**（无外网/文件只读/无代码执行）+ 质检门槛徽章，招募前可"验货" |
| **编制** | org.yaml 可视化：成员档案、权限、模型档位要求、限额护栏 |
| 任务群 | 计划卡 · 消息流 · 决策卡 |

**组织切换**在左栏顶部，切换后清空会话状态并重订 WS；选择记在 `localStorage`，
上次选的组织若已不存在则回落到第一个。`●` 表示该组织已开工（成员子进程在跑）。

## 待办

- [ ] 点击通知直达对应任务群（需 Tauri 通知事件回调）
- [ ] 招募后热加载成员（当前需重启 milod）

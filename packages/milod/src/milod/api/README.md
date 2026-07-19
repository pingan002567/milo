# milod API（M2）

桌面端的唯一后端。守护进程独立于窗口存活——关掉界面成员仍在干活。

```bash
export PYTHONPATH=packages/milod/src MILO_HOME=~/.milo MIMO_API_KEY=…
python -m uvicorn milod.api.server:app --port 8899
```

## REST

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/orgs` | 组织列表（扫 `~/.milo/orgs`，标记已开工）→ 顶栏切换 |
| GET | `/api/orgs/{org}/members` | 成员列表（含 capabilities / busy）→ 组织页 |
| POST | `/api/orgs/{org}/members` | **招募**：校验包并写入编制（人事红线：只有组长能发起） |
| GET | `/api/orgs/{org}/roster` | 编制视图：org.yaml 成员档案 + 限额 → 编制页 |
| GET | `/api/market` | 人才市场 v0：扫本地包目录（`MILO_PACKS`，缺省 `~/.milo/packs`） |
| GET | `/api/orgs/{org}/groups` | 任务群列表（pending 角标 / archived 置灰）→ **左边栏** |
| GET | `/api/orgs/{org}/groups/{gid}` | 群会话：events（即聊天流）+ tasks → **中间栏** |
| GET | `/api/orgs/{org}/todos` | **跨群 @你 事项聚合**，每项含 group_id 可直达 → 待办页 |
| POST | `/api/orgs/{org}/runs` | 下达需求，立即返回 group_id，后台执行（`auto_approve=false` 则暂存计划待批） |
| GET | `/api/orgs/{org}/groups/{gid}/plan` | 取待批准的计划 → 计划卡 |
| POST | `/api/orgs/{org}/groups/{gid}/approve` | 批准并执行，可带 `edits` 逐步修订 |
| POST | `/api/orgs/{org}/groups/{gid}/reject` | 不批准（群转 archived） |
| POST | `/api/orgs/{org}/tasks/{tid}/reply` | 答复被中断的任务（决策卡提交入口） |

## WebSocket

`ws://host/ws/{org}` 推 7 类事件，字段与 `MiloEvent` 一致，含 `reach`（silent/group/mention/notify）——
桌面端据此决定：group 静默进会话流，mention/notify 触发系统通知。

**断线重连**：`ws://host/ws/{org}?since=<seq>`
1. 先按序补发 `seq` 之后的历史事件（帧带 `replay: true` 与 `seq`）
2. 发一条 `{"type": "_sync", "replayed": N, "latest_seq": M}` 标记补发结束
3. 转入实时推送（帧带 `replay: false`）

客户端只需记住收到的最大 `seq`（实时帧也带该字段），重连时回传即可。
补发与实时之间可能重叠，按 `event_id` 去重。

实测（2026-07-19）：收 3 条后断开 → 断线 25 秒 → `?since=3` 重连 → 补发 4–6 号事件，
起点正确、两段无重复、序列无缺漏。

## 实测（2026-07-19）

下达"写一句产品宣传语" → WS 实时收到 chat/system/envelope/status/escalation 序列 →
待办聚合出 1 项（`policy=approach-choice`、`input_mode=choice_with_other`）→
POST reply 提交答复 → 成员接续并产出完整分析。三处入口（群消息、待办、通知）指向同一决策，状态同源。

## 计划批准回合（计划前置授权）

`auto_approve=false` 时：分解出计划 → 暂存 → 群转 `waiting` → 等组长批准。
批准即授权执行到里程碑，中途偏离仍会重新上报（编制设计 §5.2）。

`edits` 支持两种写法：

```jsonc
{"edits": {"t-xxx": "新目标"}}                                  // 只改目标
{"edits": {"t-xxx": {"objective": "…", "artifacts": [], "format": "text"}}}  // 连交付要求一起改
```

**改目标通常要一并改 artifacts/format** —— 否则验收仍按旧 `output_spec` 判定。
实测踩过：把"输出 json 文件"的步骤改成"每条一句话"，成员交了文本却被判"缺少产物"。

## 数据层（借鉴 DeerFlow 会话实现）

对照 harness 的 `RunEventRow` / `ThreadMetaRow` 做了四点改造：

| 改造 | 说明 |
|---|---|
| **content / metadata 分离** | 人类可读文本单列（群聊直接渲染，可建 FTS 索引），结构化负载留 JSON 供决策卡用 |
| **category 粗分类** | `message / status / decision / outputs / error / trace`，与细类型并存；UI 可"只看决策""只看错误"，配 `idx_events_group_cat` 复合索引 |
| **run_id** | 一次执行的边界：assign 与每次 resume 各开一个 run；任务表记 `attempts`。可区分尝试次数、只回放最后一次 |
| **groups 元数据表** | 标题 / 状态（active·waiting·archived·failed）/ 时间独立成表，不再从事件表 GROUP BY 推算；标题借鉴 `TitleConfig` 思路自动生成 |

群标题与状态同步下沉到 `Office.start_group()` / `Office.sync_group_status()`，CLI 与 API 共用，避免两处逻辑漂移。

`GET /groups/{gid}` 支持 `?category=` 与 `?run_id=` 过滤；CLI 对应 `milo log <org> <group> --category decision --run <id>`。

## 断点续跑（四个层次）

| 层次 | 机制 | 状态 |
|---|---|---|
| 对话状态 | LangGraph checkpointer（SqliteSaver，按 thread_id 落盘） | ✅ 已用 |
| 中断点续跑 | `ask_clarification` → `Command(goto=END)` → 同 thread 再 stream 答复 | ✅ 已用 |
| **进程崩溃恢复** | 启动时扫 `state IN (assigned, working)` 的孤儿任务并接续 | ✅ **本轮实现** |
| **流断线重连** | WS `?since=<seq>` 补发（自行实现，等价 Gateway 的 Last-Event-ID） | ✅ **本轮实现** |

崩溃恢复的语义是**接续而非重跑**——成员侧 checkpoint 仍在（thread_id 不变），
按最后一条事件决定动作：

- 最后是 `escalation` → 本就在等人，改判 `input_required`，不打扰成员
- 否则 → 重新 assign 同一信封，成员凭 checkpoint 从中断处继续；`attempts+1`、
  开新 `run_id`（与原 run 事件隔离）、写 `stop_reason=recovered_resumed`
- 成员已不在编制 → 标 `failed` + `stop_reason=member_gone`

入口：milod 启动时自动执行（`Hub.office()` 内），或手动 `milo recover <org>`。

实测（2026-07-19）：任务执行中强杀 milod 与成员子进程 → 残留 `working` 孤儿 →
`milo recover` → 成员**直接接着搜集资料并请示细节**（没有重问任务是什么）→
状态 `input_required`、attempts 2→3、群状态自动转 waiting、run 数 1→2。

## 待办

- [ ] 计划批准回合：`auto_approve=false` 时暂存计划，等 UI 批准后再执行（当前直接返回）
- [ ] 断线重连的事件补发（Last-Event-ID 语义）
- [ ] 鉴权（官方 harness 无鉴权，控制面必须自带）

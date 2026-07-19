# Spike 03 报告：SubprocessAdapter 端到端（M1 地基）

**日期** 2026-07-18 · 同前环境（harness 2.1.0 · mimo-v2.5）
**代码** `packages/milod/src/milod/adapter/{protocol,worker,normalize,subprocess_adapter}.py`

---

## 验证结果

| 断言 | 结果 |
|---|---|
| 两成员各自子进程，人设互不串台 | ✅ scout 不提 writer，writer 不提 scout |
| 并行派单真并发 | ✅ 两成员合计 10.7s（串行约 2×） |
| 需澄清任务产出结构化 ESCALATION | ✅ `policy=missing-info`（来自 ask_clarification，非文本猜测） |
| **中断 → 组长答复 → resume 接续** | ✅ 第二轮产出标语且**记得上下文**（提到 Milo） |
| 汇报节流 | ✅ 从 十余条 token 级 status 压到 1 条摘要 |

## 关键实现要点

**1. 协议**（`protocol.py`）：stdio 一行一 JSON。主→子为 Request(method ∈ enroll/assign/resume/deliver/shutdown/ping)，子→主为 EventFrame（流式）与 Response。无法解析的行一律丢弃——子进程的杂散 stdout 不参与语义。

**2. 隔离**（`subprocess_adapter.enroll`）：每成员子进程独立 env——`DEER_FLOW_CONFIG_PATH` / `DEER_FLOW_HOME` 指向该成员私有目录树，`secrets` 按成员最小注入（只给其档位所需凭证）。规避了 harness 进程级全局配置单例问题。

**3. 归一化**（`normalize.py`）：信任边界在此执行——只有 `ask_clarification` 结构化调用能产生 ESCALATION，成员正文一律作为不可信数据入 payload。

**4. 汇报节流**：harness 的 `messages-tuple` 是 **token 级增量**，逐条上抛会让任务群刷屏（实测一句话十余条）。改为累积 ≥120 字符才发一条 status，落实"汇报是给人看的摘要，不是日志流"。

**5. checkpointer 踩坑**：`SqliteSaver.from_conn_string()` 返回上下文管理器，取出 saver 后不保留 CM 引用会被 GC 关闭连接（`Cannot operate on a closed database`）。改为直接持有 `sqlite3.connect(..., check_same_thread=False)` 传入 `SqliteSaver(conn)`。

**6. 中断恢复**：`ask_clarification` → `Command(goto=END)` 结束本轮；`resume(task_id, answer)` 用**同 thread_id** 再次 stream，checkpointer 保证上下文接续——这就是"任务群里回复即恢复执行"的技术实现。

## M1 剩余

- [ ] `milod/pack/`：把 Spike 02 的 render.py 沉淀为正式渲染器（+ manifest schema 校验）
- [ ] `milod/store/`：事件落 SQLite（events append-only 表已就绪）
- [ ] `milod/secretariat/`：分解（LLM）+ 路由（确定性）+ 验收
- [ ] `milo` CLI：`org init / member add / task run / task reply`
- [ ] evals 冒烟（试用期）

# Spike 01 报告：escalate 事件形态（embedded 模式）

**日期** 2026-07-18 · **环境** macOS · Python 3.12（uv venv）· `deerflow-harness` 2.1.0（git main）
**模型** mimo-v2.5（`deerflow.models.patched_mimo:PatchedChatMiMo`，api.xiaomimimo.com/v1）
**数据** `run1/events-ambiguous.jsonl`（62 事件）· `run1/events-plan.jsonl`（770 事件）

---

## 结论速览

| # | 验证项 | 结果 |
|---|---|---|
| 1 | harness 子目录可 pip 安装 | ✅ 成立（`deerflow-harness` 2.1.0），uv 一条命令装完 |
| 2 | stream 同步/异步 | ✅ **同步** `Generator[StreamEvent]`；签名 `stream(message: str, *, thread_id=None, **kwargs)` |
| 3 | thread 生命周期 | ✅ 调用方自定 `thread_id` 字符串即可（多轮需传 `checkpointer`，否则无状态） |
| 4 | **escalate 事件形态** | ❌ **无独立事件类型**——澄清 = 一条普通 `ai` 消息。原设计假设被证伪，改用绕行方案（见下） |
| 5 | plan_mode 计划审批 | ❌ **不产生阻塞中断**——`plan_mode=True` 走 `write_todos` 自列计划并直接执行到底 |

## 事件模型（已确认）

`StreamEvent` 是 dataclass：`{type, data}`，`type ∈ {values, messages-tuple, custom, end}`。实测只出现三类：

- **`values`**：状态快照 `{title, messages, artifacts}`——**无顶层 interrupt/plan/goal 键**
- **`messages-tuple`**：增量消息 `{type: ai|tool, content, id, tool_calls, usage_metadata, additional_kwargs.reasoning_content}`
- **`end`**：`{usage: {input_tokens, output_tokens, total_tokens}}`

权威输出 = 最后一条 `values` 的 `messages[-1]`（ai）。用量统计从 `end` 取。

计数：ambiguous 57 messages-tuple / 4 values / 1 end；plan 748 / 21 / 1。plan 用例工具调用 `write_todos`×6、`web_search`×2，`artifacts` 为空（正文交付）。

## 关键发现与设计影响

### 1. escalate 没有结构化信号 → 采用绕行方案

澄清请求与正常交付在事件层**完全同构**，都是无 tool_calls 的末条 ai 消息。可用的弱信号：ambiguous 末条含问号，plan 末条不含——但这是启发式，不可作为唯一依据。

**决定（三选一叠加）**：
1. **主方案 · 契约化提问**：在成员 persona（SOUL.md）中约定——需要用户决策时，**必须**输出带 `MILO_ESCALATE` 前缀的结构化块（YAML/JSON：question/policy/dimensions/alternatives）。adapter 只认这个标记，**正文里的自然语言提问一律不触发升级**——正好落实"信任边界：只有结构化字段驱动行为"。
2. **兜底 · 秘书长判定**：无标记但疑似提问时，由秘书长（LLM，已在决策路径上）判定是否升级——判定发生在 Milo 侧而非成员侧，成员无法伪造。
3. **权限类升级不依赖成员自觉**：外部副作用由 Milo 在渲染成员配置时用 `permissions` 收敛（网络白名单、sandbox 限制）——成员根本执行不了，无需它开口请示。

### 2. plan_mode ≠ 计划前置授权

`plan_mode=True` 只是让成员先 `write_todos` 再自行执行，不等待批准。**"计划前置授权"必须由 Milo 自己实现**：秘书长在派单前产出计划 → 组长批准 → 才 assign 给成员。原技术规划 §7 中"plan_mode 直接复用为计划前置授权"的判断作废。

### 3. 无 checkpointer = 无状态

多轮对话（同 thread 追加消息）需传 LangGraph checkpointer。M1 需引入（SQLite checkpointer），否则"组长在群里补充信息"无法接续上下文。

## 待办回填

- [x] `EmbeddedAdapter.events()` 归一化规则 → 已按契约化标记方案实现骨架
- [ ] SOUL.md 模板加入 `MILO_ESCALATE` 契约段（Spike 02）
- [ ] 内存占用测量（本轮未采集，M1 前补）
- [ ] 官方 release tag pin（当前依赖 @main）

# Spike 02 报告：enroll 渲染链路 + 原生升级机制

**日期** 2026-07-18 · **环境** 同 Spike 01（harness 2.1.0 · mimo-v2.5）
**产物** `pack/`（真实 MiloPack）· `render.py`（渲染器原型）· `verify.py` / `verify_clarification.py`

---

## 结论速览

| # | 验证项 | 结果 |
|---|---|---|
| 1 | MiloPack manifest 过 schema 校验 | ✅ |
| 2 | persona → SOUL.md 人设注入 | ✅ 成员自称"文献检索成员，负责检索与引用核对，不承担写作与实验分析" |
| 3 | skills 白名单加载 | ✅（**前提：`skills.path` 必须显式指向工作区**，缺省指向"调用方项目根"） |
| 4 | permissions 收敛（禁外网） | ✅ 未注入 web_search，成员如实报告"没有可用外网工具"并给出替代方案 |
| 5 | 自定义 `MILO_ESCALATE` 契约标记 | ❌ 成员未照做（写在 SOUL.md 里的软约束不可靠） |
| 6 | **官方原生 `ask_clarification`** | ✅ **稳定捕获——改用此机制** |

## 关键发现：官方已有结构化升级机制（推翻 Spike 01 的应对方案）

Spike 01 结论"escalate 无结构化信号"**不准确**——当时未触发是因为提示词与配置组合没有诱发工具调用。实际上 harness 内置：

- **工具** `deerflow/tools/builtins/clarification_tool.py::ask_clarification`
  参数即结构化四要素：`question` / `clarification_type`（`missing_info` | `ambiguous_requirement` | `approach_choice` | `risk_confirmation` | `suggestion`）/ `context` / `options[]`
- **中间件** `agents/middlewares/clarification_middleware.py::ClarificationMiddleware`
  拦截该工具调用 → 构造 `ToolMessage(name="ask_clarification", id="clarification:<tool_call_id>", artifact={"human_input": …})` → 返回 `Command(goto=END)` **中断执行**等待用户

**实测捕获**（prompt：「把项目里那个配置文件改一下，改成正确的值。」）：

```json
{"type":"tool","name":"ask_clarification",
 "tool_call_id":"call_03e976f22178478082cfa249",
 "id":"clarification:call_03e976f22178478082cfa249"}
content: "❓ 用户要求修改配置文件，但未指定具体文件和目标值…\n\n请问您指的是哪个配置文件？以及需要改成什么样的值？"
```

三处可捕获：AI 消息的 `tool_calls[].name`、增量 `messages-tuple` 的 `name` 字段、`values` 快照消息里的同名 ToolMessage。

### `human_input_request`：官方给 UI 的结构化契约（2026-07-19 补充）

`ClarificationMiddleware._build_human_input_payload()` 产出的 `artifact.human_input` 是**版本化的 UI 契约**（注释原文 "structured UI payload"）：

```json
{"version": 1, "kind": "human_input_request", "source": "ask_clarification",
 "request_id": "clarification:<tool_call_id>", "tool_call_id": "call_xxx",
 "clarification_type": "risk_confirmation",
 "question": "确认删除生产数据？", "context": "该操作不可逆",
 "input_mode": "choice_with_other",
 "options": [{"id": "option-1", "label": "确认删除", "value": "确认删除"}]}
```

- `input_mode` 是渲染指令：`free_text`（纯输入框）/ `choice_with_other`（选项按钮 + 其他）——直接决定决策卡形态
- `options[]` 已规范化为 `{id,label,value}`，可直接映射按钮
- `request_id` 稳定（重试的澄清**替换而非追加**）→ 用作待办项幂等键
- `ToolMessage.content` 是降级文案，带类型 emoji（❓缺信息 🤔歧义 🔀路线 ⚠️风险 💡建议）

**修复的一个真实 bug**：原实现从**流式 tool_call.args** 重建载荷，增量未拼完时 `question` 为空（实测复现）。改为优先取最终 ToolMessage 的 `artifact.human_input`；见到半截 tool_call 时标记 pending 等完整载荷，若始终等不到则在 `end` 处兜底上报（避免任务静默卡死）。回归测试：`packages/milod/tests/test_normalize.py`（四场景全绿）。

### 设计影响

1. **升级信号改用官方机制**：`EventType.ESCALATION` 的判定依据 = `name == "ask_clarification"`，`clarification_type` 直接映射我们的升级策略分类（`risk_confirmation` → block 类，`ambiguous_requirement` → escalate 类）。自定义 `MILO_ESCALATE` 标记降级为**兼容兜底**（成员若主动输出仍然识别）。
2. **信任边界更稳固**：升级由运行时中间件保证，而非成员"照人设办事"——正文里的自然语言提问依然不触发升级，符合原则。
3. **中断即等待**：`Command(goto=END)` 表示 run 结束并等人回复，正是"任务进入 input-required 状态"的运行时对应物；恢复方式 = 同 thread_id 追加用户答复（需 checkpointer，Spike 01 结论 3）。

## 进程隔离（架构级修正）

**问题**：harness 的配置与路径解析是**进程级全局状态**：

| 全局对象 | 行为（实测） |
|---|---|
| `app_config._app_config` | 单例。`DeerFlowClient.__init__` 调 `reload_app_config()` → **后构造者覆盖先前配置** |
| `config.paths._paths` | 单例，但 `host_base_dir` 按 `DEER_FLOW_HOME` **动态解析** → 取决于调用时刻的环境变量 |
| `DeerFlowClient._app_config` | 每实例私有快照 ✅ |

实测：先后构造成员 A、B 后，`get_app_config().skills.path` 指向 B——A 的全局配置已丢失。
行为测试中人设未串台（`agent_name` 构造期绑定），但任何**调用时刻**从全局读取的配置
（skills 路径、tools 列表、sandbox、模型表）都可能读到别人的；asyncio 并发下
更无法用"调用前设环境变量"规避（无 per-task 环境隔离）。

**结论：单进程内跑 N 个成员不是安全隔离**，与编制设计 §3.4 冲突。

**决定：每成员一子进程（SubprocessAdapter）**——仍属轻量化（无 Docker，纯 Python
子进程），但拿回真实隔离：独立全局配置、独立环境变量、独立内存、崩溃互不影响。
milod 主进程与成员子进程间用 stdio JSON-RPC 传任务信封与归一化事件。
`EmbeddedAdapter`（同进程）降级为**单成员开发模式**专用。

**目录布局同步修正**：每成员一套完整私有目录树（`DEER_FLOW_HOME` 内含
agents/skills/threads/memory.json，共用即打通记忆与会话历史）：

```
<org-root>/members/<member>/
├── config.yaml            # DEER_FLOW_CONFIG_PATH
└── home/                  # DEER_FLOW_HOME（私有）
    ├── agents/<member>/{config.yaml, SOUL.md}
    ├── skills/custom/<skill>/SKILL.md
    ├── threads/           # 运行时生成
    └── memory.json        # 运行时生成
```

## 其他实测要点

- **`skills.path` 必须显式配置**：缺省解析到"调用方项目根"，导致技能静默不可见（成员回答"当前没有任何已安装的技能"）。渲染器已修正为绝对路径。
- **`tools` 是 list 不是 dict**：权限收敛的正确实现 = **不往列表里放该工具**（釜底抽薪），而非写 `enabled: false`。
- 渲染布局（已验证可用）：
  ```
  <workdir>/config.yaml          # DEER_FLOW_CONFIG_PATH
  <workdir>/home/                # DEER_FLOW_HOME
    ├── agents/<name>/{config.yaml, SOUL.md}
    └── skills/custom/<skill>/SKILL.md
  ```

## 待办

- [x] 回填 `EmbeddedAdapter`：`ask_clarification` 为主信号
- [ ] `clarification_type` → 升级策略分类的映射表（M2 escalation.py）
- [ ] 中断后的恢复链路（同 thread + checkpointer）—— M1
- [ ] evals 冒烟（试用期）流程 —— M1

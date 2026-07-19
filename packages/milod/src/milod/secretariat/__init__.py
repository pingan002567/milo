"""秘书长（Secretariat）：办公室主任——除 decompose 外全部确定性代码。

M2 落地模块（技术规划 §3.2）：
- decompose.py   任务分解（唯一用 LLM 的模块；JSON Schema 强校验输出）
- route.py       确定性能力匹配（v0 内置规则：capability 交集 + 空闲优先；无匹配 -> ask_user）
- scheduler.py   asyncio 派发 · 依赖等待 · 并行 <=5 · 待批队列背压
- escalation.py  策略求值 + 超时链状态机（@你 15m -> 系统通知 1h -> 兜底暂停分支）
- acceptance.py  output_spec 校验 + 交付装配
- reconcile.py   编制调和。人事红线：仅执行组长已签署的 spec，禁止任何自主人事变动。
"""

# Spike 01：escalate 事件形态（第一优先）

**回答的问题**：成员（DeerFlowClient）在需要人工决策时（澄清请求 / plan_mode 计划审批 / 权限阻断），
stream 事件流里出现什么**结构化特征**？能否可靠归一化为 `EventType.ESCALATION`，与正文自由文本区分开
（信任边界的技术前提）？

## 准备

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install "deerflow-harness @ git+https://github.com/bytedance/deer-flow@main#subdirectory=backend/packages/harness"
export DEEPSEEK_API_KEY=sk-…        # 与 member-config.template.yaml 的 $VAR 对应
```

预检已确认：子目录含 pyproject（`deerflow-harness` 2.1.0，Python ≥3.12）。依赖重（langgraph/langchain 全家桶）。

## 运行

```bash
python spike.py --workdir ./run1 --case ambiguous     # 模糊任务 → 期待澄清
python spike.py --workdir ./run1 --case plan          # plan_mode=True → 期待计划审批中断
```

产出 `run1/events.jsonl`（全量原始事件）+ 终端事件类型直方图。

## 记录到报告的结论

1. stream 是同步/异步迭代器；事件对象的类型体系（dict? dataclass? LangGraph chunk?）
2. 澄清/中断事件的辨识字段（type/name/tags？）——填入 `EmbeddedAdapter.events()` 的归一化规则
3. plan_mode 中断的恢复方式（如何回传"批准"）
4. thread 的创建/复用方式
5. 单实例内存占用（`ps` RSS），推算单机成员数上限
6. 若无结构化澄清事件 → 启用绕行方案：run 中断态 + get_goal() 轮询（技术规划 §6）

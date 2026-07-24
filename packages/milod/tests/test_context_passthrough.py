"""P0-1 上下文透传回归：秘书在对话里澄清出的约束，随需求存盘、喂给分解、重试也不丢。

覆盖的缺陷：create_task_group 原来只带一个 request 字符串，对话里澄清出的约束
（键、编码、文件名、偏好）在派活那一跳全部蒸发，分解器只能靠猜。

运行：PYTHONPATH=packages/milod/src python packages/milod/tests/test_context_passthrough.py
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from milod.models import EventType, MiloEvent  # noqa: E402
from milod.secretariat.decompose import Roster, build_prompt  # noqa: E402
from milod.store.repo import Store  # noqa: E402

ok = True


def check(label: str, cond: bool) -> None:
    global ok
    print(f"  {label}: {'✅' if cond else '❌'}")
    ok = ok and cond


ROSTER = Roster([("小张", ["python-dev"]), ("rev", ["code-review"])])
CTX = "键用第一列；UTF-8；文件名 dedup.py；别用 pandas"

# --- A：prompt 分列，不拼进 request -----------------------------------------
print("\n【A · context 分列注入 prompt，request 不被污染】")
p_empty = build_prompt("写去重脚本", ROSTER)
p_ctx = build_prompt("写去重脚本", ROSTER, context=CTX)
check("无 context 不加补充块", "补充上下文" not in p_empty)
check("有 context 出现补充块且内容完整",
      "补充上下文" in p_ctx and "dedup.py" in p_ctx and "pandas" in p_ctx)
check("request 段不含 context（分列而非拼接）",
      p_ctx.split("补充上下文")[0].count("dedup.py") == 0)
check("无占位符残留", "{context}" not in p_ctx and "{request}" not in p_ctx)
check("空白 context 视同无", "补充上下文" not in build_prompt("x", ROSTER, context="   "))

# --- B：context 存进 owner chat 事件的 metadata，不进可见气泡 -----------------
print("\n【B · context 落 metadata，text 落 content（气泡不被污染）】")
tmp = Path(tempfile.mkdtemp())
store = Store(tmp / "milo.db")
store.ensure_group("g-1")
store.append(MiloEvent(group_id="g-1", type=EventType.CHAT, actor="owner",
                       payload={"text": "写去重脚本", "context": CTX}))
row = store.group_events("g-1")[0]
check("可见气泡只有 request", row["content"] == "写去重脚本")
check("context 在 metadata 里", row["payload"].get("context") == CTX)

# --- C：重试分解能一并捞回 context（retry_decompose 的恢复逻辑）--------------
print("\n【C · 重试时从 owner 事件捞回 request 与 context】")
events = store.group_events("g-1")
origin = next((e for e in events
               if e["type"] == "chat" and e["actor"] == "owner" and e["content"]), None)
recovered_req = origin["content"]
recovered_ctx = str((origin.get("payload") or {}).get("context") or "")
check("捞回 request", recovered_req == "写去重脚本")
check("捞回 context（重试不丢约束）", recovered_ctx == CTX)

# --- D：无 context 的老路径（CLI / 直接下达）不受影响 ------------------------
print("\n【D · 无 context 向后兼容：不存 context 键，重试捞回空串】")
store.ensure_group("g-2")
store.append(MiloEvent(group_id="g-2", type=EventType.CHAT, actor="owner",
                       payload={"text": "只有需求"}))
o2 = store.group_events("g-2")[0]
check("无 context 键", "context" not in o2["payload"])
check("捞回空串不报错", str((o2.get("payload") or {}).get("context") or "") == "")

print("\n" + ("全部通过" if ok else "有失败用例"))
sys.exit(0 if ok else 1)

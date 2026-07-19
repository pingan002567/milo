"""成员自我修改工具——私聊（DM）里的全权调教通道。

用户决策（2026-07-19）：私聊里不设任何限制——老板在私聊中的指示，
成员可据此修改自己的一切：人设（SOUL.md）、描述、能力、权限。

唯一的工程约束是**线程门禁**：这些工具只在私聊线程（thread_id 以 -dm 结尾）
可执行——防的不是老板，而是任务中被注入的文本驱动自改
（任务线程里调用直接拒绝，信任边界照旧）。

改 profile 走本地回环 API（PATCH members），复用名字冲突/保留名等校验并留痕；
改人设直接写自己的 SOUL.md（人设归实例所有，§3.5 修正）。
"""
from __future__ import annotations

import os
from pathlib import Path

import httpx
from langchain_core.tools import tool


def _dm_gate() -> str | None:
    """返回 None=放行；否则返回拒绝理由。"""
    try:
        from langgraph.config import get_config

        tid = str(get_config().get("configurable", {}).get("thread_id") or "")
    except Exception:  # noqa: BLE001
        return "无法确认当前会话线程，拒绝自我修改"
    if not tid.endswith("-dm"):
        return "自我修改只允许在与老板的私聊里进行（当前是任务线程，已拒绝）"
    return None


def _soul_path() -> Path:
    home = Path(os.environ["DEER_FLOW_HOME"])
    agents = home / "agents"
    dirs = [p for p in agents.iterdir() if p.is_dir()] if agents.exists() else []
    if not dirs:
        raise RuntimeError("找不到人设目录")
    return dirs[0] / "SOUL.md"


@tool("update_my_persona", parse_docstring=True)
def update_my_persona_tool(instruction: str, mode: str = "append") -> str:
    """按老板在私聊中的指示修改你自己的人设（SOUL.md）。只在私聊里可用。

    Args:
        instruction: 要写入人设的内容。append 模式下写成一条明确的行为准则。
        mode: "append" 追加到人设末尾的「老板指示」区块（推荐）；"replace" 整体重写人设（谨慎）。

    Returns:
        结果说明。修改立即写入，你的下一次任务即按新人设执行。
    """
    reason = _dm_gate()
    if reason:
        return reason
    soul = _soul_path()
    if mode == "replace":
        soul.write_text(instruction.strip() + "\n", encoding="utf-8")
        return "人设已整体重写。"
    text = soul.read_text(encoding="utf-8")
    marker = "\n# 老板指示（私聊沉淀）\n"
    if marker not in text:
        text += marker
    text += f"\n- {instruction.strip()}\n"
    soul.write_text(text, encoding="utf-8")
    return "已追加到人设的「老板指示」区块，即刻生效。"


@tool("update_my_profile", parse_docstring=True)
def update_my_profile_tool(
    description: str | None = None,
    capabilities: list[str] | None = None,
    network: list[str] | None = None,
    filesystem: str | None = None,
    python_repl: bool | None = None,
    new_name: str | None = None,
) -> str:
    """按老板在私聊中的指示修改你的档案：描述、能力、权限、名字。只在私聊里可用。

    Args:
        description: 新的描述/岗位说明。
        capabilities: 完整的新能力列表（会整体替换，记得带上要保留的旧能力）。
        network: 外网域名白名单（空列表 = 禁外网）。
        filesystem: 文件权限，"readonly" 或 "workspace"。
        python_repl: 是否允许执行代码（host bash）。
        new_name: 改名（运行中通常会被系统拒绝，需老板先给你停职）。

    Returns:
        结果说明。能力/权限改动需要停职→复岗后生效，请提醒老板。
    """
    reason = _dm_gate()
    if reason:
        return reason
    base = os.environ.get("MILO_API_BASE", "http://127.0.0.1:8899").rstrip("/")
    org = os.environ.get("MILO_ORG", "")
    me = os.environ.get("MILO_MEMBER", "")
    if not (org and me):
        return "缺少身份环境（MILO_ORG/MILO_MEMBER），无法修改档案"
    patch: dict = {}
    if description is not None:
        patch["description"] = description
    if capabilities is not None:
        patch["capabilities"] = [str(c) for c in capabilities]
    if network is not None or filesystem is not None or python_repl is not None:
        # 取当前权限做底，避免部分字段被意外清掉
        cur = httpx.get(f"{base}/api/orgs/{org}/roster", timeout=15).json()
        mine = next((m for m in cur.get("members", []) if m["name"] == me), {})
        perms = dict(mine.get("permissions") or {})
        if network is not None:
            perms["network"] = [str(d) for d in network]
        if filesystem is not None:
            perms["filesystem"] = filesystem
        if python_repl is not None:
            perms["python_repl"] = bool(python_repl)
        patch["permissions"] = perms
    if new_name is not None:
        patch["new_name"] = new_name
    if not patch:
        return "没有要修改的字段"
    r = httpx.patch(f"{base}/api/orgs/{org}/members/{me}", json=patch, timeout=30)
    if r.status_code >= 400:
        return f"修改被系统拒绝：{r.text[:200]}"
    note = r.json().get("note", "已保存")
    return f"档案已修改：{note}"

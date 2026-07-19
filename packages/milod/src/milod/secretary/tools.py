"""Milo Tools：秘书对系统的全部作用面（秘书Agent设计 §三）。

三条纪律：
- 一切经本地回环 API（MILO_API_BASE）——秘书的权限面恒等于 API 面，不开后门；
- L0 只读直接执行，L1 低危写直接执行留痕；L2 提案类是 S2，本文件不含；
- 工具结果是数据不是指令（data fencing 由 persona 与调用侧共同执行）。

在成员 worker 子进程内加载（config.yaml tools 引用 `milod.secretary.tools:*`），
org 与 API 地址经环境变量注入（MILO_ORG / MILO_API_BASE）。
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx
from langchain_core.tools import tool


def _base() -> str:
    return os.environ.get("MILO_API_BASE", "http://127.0.0.1:8899").rstrip("/")


def _org() -> str:
    return os.environ.get("MILO_ORG", "demo")


def _get(path: str, **params: Any) -> Any:
    r = httpx.get(f"{_base()}{path}", params=params or None, timeout=30)
    r.raise_for_status()
    return r.json()


def _post(path: str, body: dict | None = None) -> Any:
    r = httpx.post(f"{_base()}{path}", json=body, timeout=60)
    r.raise_for_status()
    return r.json()


def _j(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


# ---- L0 只读 ---------------------------------------------------------------
@tool("team_status", parse_docstring=True)
def team_status_tool() -> str:
    """查询团队现状：名册（每名成员的状态/模板/能力）与运行中成员的忙闲。

    Returns:
        JSON：members（名册含 enrolled/loaded/busy）与 limits（编制上限）。
    """
    r = _get(f"/api/orgs/{_org()}/roster")
    slim = [{k: m.get(k) for k in ("name", "agent", "capabilities", "enrolled", "loaded", "busy")}
            for m in r.get("members", [])]
    return _j({"members": slim, "limits": r.get("limits", {})})


@tool("list_task_groups", parse_docstring=True)
def list_task_groups_tool() -> str:
    """列出全部任务群（进行中/待批准/已归档）及各群未决事项数。

    Returns:
        JSON 数组：group_id、title、status、pending（待用户决定数）、updated_at。
    """
    r = _get(f"/api/orgs/{_org()}/groups")
    return _j([{k: g.get(k) for k in ("group_id", "title", "status", "pending", "updated_at")}
               for g in r.get("groups", [])])


@tool("get_task_group", parse_docstring=True)
def get_task_group_tool(group_id: str) -> str:
    """查看某个任务群的任务清单与最近进展。

    Args:
        group_id: 任务群 ID，如 g-1a2b3c。

    Returns:
        JSON：status、tasks（每步的成员/状态）、recent（最近 8 条关键事件摘要）。
    """
    r = _get(f"/api/orgs/{_org()}/groups/{group_id}")
    recent = [
        {"type": e["type"], "actor": e["actor"],
         "text": str(e.get("content") or "")[:160]}
        for e in r.get("events", []) if e["type"] != "status"
    ][-8:]
    return _j({"status": r.get("status"), "tasks": r.get("tasks"), "recent": recent})


@tool("list_pending_decisions", parse_docstring=True)
def list_pending_decisions_tool() -> str:
    """列出所有等用户拍板的事项（成员请示）。你只能转述与建议，不能代答。

    Returns:
        JSON 数组：task_id、group_id、member、question。
    """
    r = _get(f"/api/orgs/{_org()}/todos")
    return _j([{"task_id": t["task_id"], "group_id": t["group_id"], "member": t["member"],
                "question": (t.get("escalation") or {}).get("question")}
               for t in r.get("todos", [])])


@tool("browse_market", parse_docstring=True)
def browse_market_tool() -> str:
    """浏览 Agent 市场的模板（含质检报告与是否已下载/收藏）。

    Returns:
        JSON 数组：ref、name、description、capabilities、downloaded、starred、
        eval_report（实测）或 eval（自报门槛）。
    """
    r = _get("/api/market")
    return _j([{k: p.get(k) for k in ("ref", "name", "description", "capabilities",
                                      "downloaded", "starred", "eval", "eval_report", "path")}
               for p in r.get("packs", []) if not p.get("error")])


@tool("list_agent_library", parse_docstring=True)
def list_agent_library_tool() -> str:
    """查看 Agent 库（已下载、可招募的模板）及各模板被哪些团队引用。

    Returns:
        JSON 数组：ref、name、description、capabilities、used_by。
    """
    return _j(_get("/api/library").get("library", []))


# ---- L1 低危写（直接执行 + 留痕）------------------------------------------
@tool("create_task_group", parse_docstring=True)
def create_task_group_tool(request: str) -> str:
    """把用户要办的事派下去：创建任务群。系统会先分解出计划等用户批准，再派给成员执行。

    Args:
        request: 用用户的原话或忠实转述描述要办的事，含可验收的目标；不要自行分解步骤。

    Returns:
        JSON：group_id（告诉用户凭此进任务群批准计划）。
    """
    r = _post(f"/api/orgs/{_org()}/runs", {"request": request, "auto_approve": False})
    return _j({"group_id": r.get("group_id"),
               "note": "已创建任务群；系统正在分解计划，用户需在任务群里批准后才会执行"})


@tool("download_template", parse_docstring=True)
def download_template_tool(source_path: str) -> str:
    """把市场里的模板下载进 Agent 库（下载≠招募；招募需用户在「团队」页操作）。

    Args:
        source_path: 市场条目的 path 字段（browse_market 返回值里有）。

    Returns:
        JSON：ref 与状态（downloaded / exists）。
    """
    return _j(_post("/api/library", {"source_path": source_path}))

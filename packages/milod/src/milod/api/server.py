"""milod HTTP + WebSocket 服务：桌面端的唯一后端。

REST 做操作与查询，WS 推 7 类事件。守护进程独立于窗口存活——
关掉界面成员仍在干活，升级事项经系统通知触达（技术规划 §1）。
"""
from __future__ import annotations

import asyncio
import contextlib
import uuid
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from milod.api.hub import Hub
from milod.models import MiloEvent

app = FastAPI(title="milod", version="0.1.0")
hub = Hub()


# ---- 请求模型 -------------------------------------------------------------
class RunRequest(BaseModel):
    request: str
    auto_approve: bool = False


class ReplyRequest(BaseModel):
    answer: str


class ApproveRequest(BaseModel):
    """批准计划，可带逐步修订，改动落事件留痕。

    edits 两种写法：
      {"t-xxx": "新目标"}                                    —— 只改目标
      {"t-xxx": {"objective": "…", "artifacts": [], "format": "text"}}  —— 连交付要求一起改

    改目标时通常要一并调整 artifacts/format，否则验收仍按旧 output_spec 判定。
    """

    edits: dict[str, Any] | None = None


class RejectRequest(BaseModel):
    reason: str = ""


# ---- 组织 -----------------------------------------------------------------
@app.get("/api/orgs")
async def list_orgs() -> dict[str, Any]:
    """扫描 ~/.milo/orgs 下的组织（有 org.yaml 即算）——供顶栏切换。"""
    from milod.config.paths import milo_home

    root = milo_home() / "orgs"
    orgs = []
    if root.exists():
        for d in sorted(p for p in root.iterdir() if p.is_dir()):
            if not (d / "org.yaml").exists():
                continue
            try:
                doc = yaml.safe_load((d / "org.yaml").read_text(encoding="utf-8")) or {}
                members = (doc.get("spec") or {}).get("members") or []
            except Exception:  # noqa: BLE001 —— 坏文件不该让整个列表挂掉
                members = []
            orgs.append({
                "org": d.name,
                "title": (doc.get("metadata") or {}).get("description") or d.name,
                "members": len(members),
                "open": d.name in hub._offices,  # 已开工（成员子进程在跑）
            })
    return {"orgs": orgs}


# ---- 设置（模型绑定 + 密钥）----------------------------------------------
class BindingsUpdate(BaseModel):
    api_base: str | None = None
    model: str | None = None
    provider: str | None = None
    secret_env: str | None = None


class SecretUpdate(BaseModel):
    value: str


@app.get("/api/orgs/{org}/bindings")
async def get_bindings(org: str) -> dict[str, Any]:
    """AI 配置（设置页）：模型绑定 + 密钥在位状态。密钥值永不回显。"""
    from milod.config.paths import org_dir
    from milod.secretariat.office import _read_secret

    f = org_dir(org) / "bindings.yaml"
    if not f.exists():
        raise HTTPException(404, f"组织 {org} 没有 bindings.yaml")
    m = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("model") or {}
    return {
        "org": org,
        "model": {k: m.get(k) for k in ("name", "provider", "model", "api_base", "secret_env")},
        "secret_present": bool(_read_secret(m.get("secret_env", ""))),
    }


@app.put("/api/orgs/{org}/bindings")
async def update_bindings(org: str, body: BindingsUpdate) -> dict[str, Any]:
    """改模型绑定（bindings.yaml 是环境绑定文件，不入 org.yaml；重启该组织后生效）。"""
    from milod.config.paths import org_dir

    f = org_dir(org) / "bindings.yaml"
    doc = yaml.safe_load(f.read_text(encoding="utf-8")) if f.exists() else {}
    m = doc.setdefault("model", {})
    for k in ("api_base", "model", "provider", "secret_env"):
        v = getattr(body, k)
        if v is not None:
            m[k] = v
    if body.model is not None:
        m["name"] = body.model  # name 跟随模型档位，保持单一事实
    f.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return {"org": org, "model": m, "note": "已保存；对运行中实例需重启组织后生效"}


@app.post("/api/orgs/{org}/bindings/test")
async def test_bindings(org: str) -> dict[str, Any]:
    """测试连接：用当前绑定发一次最小请求，返回 ok/model/latency_ms/error。"""
    import time

    import httpx

    from milod.config.paths import org_dir
    from milod.secretariat.office import _read_secret

    m = (yaml.safe_load((org_dir(org) / "bindings.yaml").read_text(encoding="utf-8"))
         or {}).get("model") or {}
    key = _read_secret(m.get("secret_env", ""))
    if not key:
        return {"ok": False, "error": f"密钥 {m.get('secret_env')} 未配置"}
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(
                f"{str(m.get('api_base', '')).rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={"model": m.get("model"), "max_tokens": 8,
                      "messages": [{"role": "user", "content": "ping"}]},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:  # noqa: BLE001 —— 连接失败原因如实回给设置页
        return {"ok": False, "error": str(e)[:200]}
    return {"ok": True, "model": data.get("model") or m.get("model"),
            "latency_ms": int((time.monotonic() - t0) * 1000)}


class DefaultsUpdate(BaseModel):
    permissions: dict[str, Any]


@app.get("/api/settings/defaults")
async def get_defaults() -> dict[str, Any]:
    """本地默认设置：新招募成员的初始权限（已有成员不受影响）。"""
    from milod.config.defaults import load_default_permissions

    return {"permissions": load_default_permissions()}


@app.put("/api/settings/defaults")
async def put_defaults(body: DefaultsUpdate) -> dict[str, Any]:
    from milod.config.defaults import save_default_permissions

    return {"permissions": save_default_permissions(body.permissions),
            "note": "已保存；只影响之后招募的成员"}


@app.put("/api/secrets/{env_name}")
async def put_secret(env_name: str, body: SecretUpdate) -> dict[str, Any]:
    """密钥入 OS 钥匙串（keyring service=milo）。零落盘、不回显、不入日志。"""
    try:
        import keyring

        keyring.set_password("milo", env_name, body.value)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"钥匙串写入失败：{e}") from e
    return {"name": env_name, "stored": True}


# ---- 成员 -----------------------------------------------------------------
@app.get("/api/orgs/{org}/members")
async def list_members(org: str) -> dict[str, Any]:
    office = await hub.office(org)
    return {
        "members": [
            {"name": n, "capabilities": s.capabilities, "busy": n in office._busy}
            for n, s in office._specs.items()
        ]
    }


# ---- 秘书（对话式操作面）--------------------------------------------------
class SecretaryChatRequest(BaseModel):
    text: str


@app.post("/api/orgs/{org}/secretary/chat")
async def secretary_chat(org: str, body: SecretaryChatRequest) -> dict[str, Any]:
    """给秘书发消息。回复经 WS 推送（group_id=secretary），历史走群接口。"""
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "消息不能为空")
    desk = await hub.secretary(org)
    task = asyncio.create_task(desk.chat(text))
    hub.track(f"secretary-{org}-{uuid.uuid4().hex[:4]}", task)
    return {"status": "ok"}


@app.get("/api/orgs/{org}/members/{name}/tasks")
async def member_tasks(org: str, name: str) -> dict[str, Any]:
    """某成员名下的任务（右栏成员名片用），最近在前。"""
    office = await hub.office(org)
    rows = [t for t in office.store.tasks() if t["member"] == name]
    rows.sort(key=lambda t: t["updated_at"], reverse=True)
    return {"tasks": rows[:20]}


@app.get("/api/orgs/{org}/org-yaml")
async def org_yaml_raw(org: str) -> dict[str, Any]:
    """org.yaml 原文（名册页右栏：文件是事实源，界面只是编辑器）。"""
    from milod.config.paths import org_dir

    f = org_dir(org) / "org.yaml"
    if not f.is_file():
        raise HTTPException(404, f"{org} 没有 org.yaml")
    return {"content": f.read_text(encoding="utf-8")}


@app.get("/api/orgs/{org}/dms")
async def list_dms(org: str) -> dict[str, Any]:
    """私聊会话列表（左栏「私聊」区块）：每名聊过的成员一条。"""
    office = await hub.office(org)
    dms = []
    for g in office.store.groups():
        if not g["group_id"].startswith("dm-"):
            continue
        dms.append({**g, "member": g["group_id"][3:]})
    return {"dms": dms}


# ---- 任务群 ---------------------------------------------------------------
@app.get("/api/orgs/{org}/groups")
async def list_groups(org: str) -> dict[str, Any]:
    """左边栏任务群列表：@你 未处理的带角标（org 审计群与秘书对话群不在其列）。"""
    office = await hub.office(org)
    return {"groups": [g for g in office.store.groups()
                       if g["group_id"] not in ("org", "secretary")
                       and not g["group_id"].startswith("dm-")]}


@app.get("/api/orgs/{org}/groups/{group_id}")
async def group_detail(
    org: str, group_id: str, category: str | None = None, run_id: str | None = None
) -> dict[str, Any]:
    """任务群会话：事件即聊天流（events append-only 表同时是审计日志）。

    category 过滤：message / status / decision / outputs / error / trace
    run_id 过滤：只看某次执行（同一任务的多次 resume 各为一个 run）
    """
    office = await hub.office(org)
    meta = next((g for g in office.store.groups() if g["group_id"] == group_id), None)
    return {
        "group_id": group_id,
        "title": (meta or {}).get("title"),
        "status": (meta or {}).get("status"),
        "events": office.store.group_events(group_id, category=category, run_id=run_id),
        "tasks": office.store.tasks(group_id),
    }


# ---- 产物 -----------------------------------------------------------------
@app.get("/api/orgs/{org}/artifacts/{task_id}/{name}")
async def get_artifact_file(org: str, task_id: str, name: str) -> dict[str, Any]:
    """产物预览：老板在任务群里验货的入口（成果归组织，存组织级 artifacts/）。"""
    from milod.config.paths import artifacts_dir

    # 只取文件名部分，杜绝路径穿越
    p = artifacts_dir(org) / Path(task_id).name / Path(name).name
    if not p.is_file():
        raise HTTPException(404, f"产物不存在：{task_id}/{name}")
    size = p.stat().st_size
    limit = 200_000
    text = p.read_text(encoding="utf-8", errors="replace")[:limit]
    return {"name": p.name, "size": size, "content": text,
            "truncated": size > limit}


# ---- 待办（跨群聚合）------------------------------------------------------
@app.get("/api/orgs/{org}/roster")
async def roster(org: str) -> dict[str, Any]:
    """编制视图：org.yaml 的成员与限额 + 各成员的档案（能力/权限/模型档位）。"""
    from milod.config.paths import org_dir, resolve_member_source
    from milod.pack.renderer import load_manifest

    doc = yaml.safe_load((org_dir(org) / "org.yaml").read_text(encoding="utf-8")) or {}
    spec = doc.get("spec") or {}
    office = hub._offices.get(org)  # 只读取已开的 Office，不为看编制而拉起全部子进程
    members = []
    for m in spec.get("members", []):
        entry = {
            "name": m["name"],
            "pack": str(resolve_member_source(m)),
            "agent": m.get("agent"),  # 模板引用（新格式；旧数据为 None）
            "enrolled": bool(m.get("enrolled", True)),  # False = 待加入或已停职
            "loaded": bool(office and m["name"] in office._specs),  # 实例已在运行
            "busy": bool(office and office.is_busy(m["name"])),
            # 有工作区 = 报到过（区分"待加入"与"停职中"：后者记忆保留可复岗）
            "has_workspace": (org_dir(org) / "members" / m["name"]).exists(),
        }
        try:
            mf = load_manifest(resolve_member_source(m))
        except Exception as e:  # noqa: BLE001 —— 模板缺失时快照兜底（实例已脱钩）
            mf = None
            if "capabilities" not in m:
                entry["error"] = str(e)
        entry |= {
            "version": (mf or {}).get("version"),
            "author": (mf or {}).get("author"),
            # 实例快照优先（可编辑，§3.5 修正）；模板 manifest 只是出厂缺省
            "description": m.get("description") or (mf or {}).get("description"),
            "capabilities": m.get("capabilities")
                or [c["id"] for c in (mf or {}).get("capabilities", [])],
            "permissions": m.get("permissions") or (mf or {}).get("permissions", {}),
            "model_requirements": (mf or {}).get("model_requirements", {}),
        }
        members.append(entry)
    return {
        "org": org,
        "apiVersion": doc.get("apiVersion"),
        "members": members,
        "limits": spec.get("limits", {}),
    }


def _agent_ref(mf: dict) -> str:
    """模板引用 = name@version（§3.5：实例 pin 版本的锚）。"""
    return f"{mf['name']}@{mf.get('version') or '0'}"


def _load_favorites() -> list[dict]:
    from milod.config.paths import favorites_file

    f = favorites_file()
    if not f.exists():
        return []
    return (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("favorites", [])


def _save_favorites(items: list[dict]) -> None:
    from milod.config.paths import favorites_file

    f = favorites_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(yaml.safe_dump({"favorites": items}, allow_unicode=True, sort_keys=False),
                 encoding="utf-8")


def _library_refs() -> set[str]:
    from milod.config.paths import library_dir

    root = library_dir()
    if not root.exists():
        return set()
    return {d.name for d in root.iterdir() if d.is_dir() and (d / "manifest.yaml").exists()}


def _refs_in_use() -> dict[str, list[str]]:
    """哪些模板还被"尚未材料化"的实例依赖（这类实例首次拉起需要模板源）。

    §3.5 修正：实例化即拷贝——已材料化（工作区存在）的实例与模板脱钩，
    不再阻止模板移除；只保护招募后还没加入过的实例。
    """
    from milod.config.paths import milo_home

    used: dict[str, list[str]] = {}
    root = milo_home() / "orgs"
    if not root.exists():
        return used
    for d in root.iterdir():
        f = d / "org.yaml"
        if not f.is_file():
            continue
        try:
            doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        except Exception:  # noqa: BLE001
            continue
        for m in (doc.get("spec") or {}).get("members", []):
            if m.get("agent") and not (d / "members" / m["name"]).exists():
                used.setdefault(str(m["agent"]), []).append(d.name)
    return used


@app.get("/api/market")
async def market() -> dict[str, Any]:
    """Agent 市场 v0：扫描本地源目录（Registry 服务端推迟到 M4）。

    职责收窄为"发现 + 验货"（§3.5）：卡片动作只有 收藏/下载，不直接产生雇佣。
    """
    import os

    from milod.config.paths import milo_home
    from milod.evals.smoke import load_report
    from milod.pack.renderer import load_manifest

    downloaded = _library_refs()
    starred = {f["ref"] for f in _load_favorites()}
    roots = [Path(p).expanduser() for p in
             (os.environ.get("MILO_PACKS") or str(milo_home() / "packs")).split(":") if p]
    packs = []
    for root in roots:
        if not root.exists():
            continue
        for d in sorted(p for p in root.iterdir() if p.is_dir()):
            if not (d / "manifest.yaml").exists():
                continue
            try:
                mf = load_manifest(d)
            except Exception as e:  # noqa: BLE001 —— 坏包标注出来，不静默隐藏
                packs.append({"path": str(d), "name": d.name, "error": str(e)})
                continue
            report = load_report(mf["name"], mf.get("version"))
            ref = _agent_ref(mf)
            packs.append({
                "path": str(d),
                "ref": ref,
                "name": mf["name"],
                "version": mf.get("version"),
                "author": mf.get("author"),
                "description": mf.get("description"),
                "capabilities": [{"id": c["id"], "description": c.get("description", "")}
                                 for c in mf.get("capabilities", [])],
                "model_requirements": mf.get("model_requirements", {}),
                "eval": mf.get("eval", {}),
                "downloaded": ref in downloaded,
                "starred": ref in starred,
                # 自报（manifest.eval）与实测（本机 milo eval 报告）分开呈现——
                # 信任来自复跑，不来自作者声明
                "eval_report": report and {
                    "score": report.get("score"),
                    "cases_total": report.get("cases_total"),
                    "cases_passed": report.get("cases_passed"),
                    "meets_min": report.get("meets_min"),
                    "ran_at": report.get("ran_at"),
                    "model": report.get("model"),
                },
            })
    return {"packs": packs}


# ---- Agent 库（用户全局资产，跨公司共享）----------------------------------
class DownloadRequest(BaseModel):
    source_path: str  # v0：从本地源目录拷入库；Registry 上线后换远端拉取，接口不变


@app.get("/api/library")
async def list_library() -> dict[str, Any]:
    from milod.config.paths import library_dir
    from milod.pack.renderer import load_manifest

    used = _refs_in_use()
    items = []
    root = library_dir()
    if root.exists():
        for d in sorted(p for p in root.iterdir() if p.is_dir()):
            if not (d / "manifest.yaml").exists():
                continue
            try:
                mf = load_manifest(d)
            except Exception as e:  # noqa: BLE001
                items.append({"ref": d.name, "error": str(e)})
                continue
            items.append({
                "ref": d.name,
                "name": mf["name"],
                "version": mf.get("version"),
                "description": mf.get("description"),
                "capabilities": [c["id"] for c in mf.get("capabilities", [])],
                "used_by": used.get(d.name, []),  # 引用它的公司（禁删依据）
            })
    return {"library": items}


@app.post("/api/library")
async def download_to_library(body: DownloadRequest) -> dict[str, Any]:
    """「下载」：把模板拷入 Agent 库，成为可聘用的资产。"""
    import shutil

    from milod.config.paths import library_dir
    from milod.pack.renderer import load_manifest

    src = Path(body.source_path).expanduser().resolve()
    try:
        mf = load_manifest(src)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"MiloPack 无效：{e}") from e
    ref = _agent_ref(mf)
    dest = library_dir() / ref
    if dest.exists():
        return {"ref": ref, "status": "exists"}
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dest)
    return {"ref": ref, "status": "downloaded"}


@app.delete("/api/library/{ref}")
async def remove_from_library(ref: str) -> dict[str, Any]:
    """移除下载。被实例引用的模板禁删——实例重启需要模板源（§3.5）。"""
    import shutil

    from milod.config.paths import library_dir

    used = _refs_in_use().get(ref, [])
    if used:
        raise HTTPException(409, f"模板 {ref} 正被公司 {'、'.join(used)} 的员工引用，不能移除")
    p = library_dir() / Path(ref).name
    if not p.is_dir():
        raise HTTPException(404, f"库中没有 {ref}")
    shutil.rmtree(p)
    return {"ref": ref, "status": "removed"}


# ---- 收藏（只记引用，不占磁盘）--------------------------------------------
@app.get("/api/favorites")
async def list_favorites() -> dict[str, Any]:
    return {"favorites": _load_favorites()}


@app.put("/api/favorites/{ref}")
async def add_favorite(ref: str) -> dict[str, Any]:
    items = _load_favorites()
    if not any(f["ref"] == ref for f in items):
        items.append({"ref": ref})
        _save_favorites(items)
    return {"ref": ref, "starred": True}


@app.delete("/api/favorites/{ref}")
async def remove_favorite(ref: str) -> dict[str, Any]:
    items = [f for f in _load_favorites() if f["ref"] != ref]
    _save_favorites(items)
    return {"ref": ref, "starred": False}


class EnrollRequest(BaseModel):
    """聘用 = 从 Agent 库模板 new 一个具名实例（§3.5）。

    新调用：{agent: "py-dev@0.1.0", name: "小张", activate: true}
    兼容旧调用：{pack: <路径>}（CLI/旧脚本仍可用，名字缺省用包名）。
    """

    agent: str | None = None    # Agent 库模板引用（推荐）
    pack: str | None = None     # 旧式包路径（兼容）
    name: str | None = None     # 实例名：走 agent 引用时必填，公司内唯一
    activate: bool = False      # 立即入职（聘用即拉起实例）


@app.post("/api/orgs/{org}/members")
async def enroll_member(org: str, body: EnrollRequest) -> dict[str, Any]:
    """聘用数字员工（人事红线：只有老板能发起，秘书长只执行）。

    模板（Agent）不可变，实例（member）具名——同模板可聘多个实例，
    各有独立工作区与记忆。activate=false 时停在"待入职"。
    """
    from milod.config.paths import library_dir, org_dir
    from milod.pack.renderer import load_manifest

    if body.agent:
        src = library_dir() / Path(body.agent).name
        if not src.is_dir():
            raise HTTPException(404, f"Agent 库中没有 {body.agent}——先到市场下载")
        record_key = {"agent": Path(body.agent).name}
    elif body.pack:
        src = Path(body.pack).expanduser().resolve()
        record_key = {"pack": str(src)}
    else:
        raise HTTPException(422, "需要 agent（模板引用）或 pack（路径）之一")
    try:
        mf = load_manifest(src)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"MiloPack 无效：{e}") from e

    name = (body.name or mf["name"]).strip()
    if body.agent and not (body.name or "").strip():
        raise HTTPException(422, "聘用必须给实例起名（§3.5：名字属于这个人，不是岗位）")
    if not (1 <= len(name) <= 20):
        raise HTTPException(422, "实例名长度需在 1–20 字符")
    if name.lower() in {"secretary", "secretariat", "system", "owner", "org"} or name == "秘书":
        raise HTTPException(422, f"{name} 是系统保留名，不能用作成员名")

    f = org_dir(org) / "org.yaml"
    doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    members = doc.setdefault("spec", {}).setdefault("members", [])
    if any(m["name"] == name for m in members):
        raise HTTPException(409, f"实例名 {name} 已被占用")
    limit = int((doc["spec"].get("limits") or {}).get("maxParallelMembers", 5))
    if len(members) >= limit:
        raise HTTPException(409, f"已达编制上限 {limit}（监督幅度护栏）")

    # 实例化即拷贝（§3.5 修正）：能力/权限/描述快照进实例记录，从此归实例所有
    # （可编辑），与模板脱钩——模板后续升级/删除都不影响该成员
    from milod.config.defaults import load_default_permissions
    from milod.pack.renderer import derive_slug

    members.append({
        "name": name, **record_key, "enrolled": bool(body.activate),
        "template_name": mf.get("name"),
        "slug": derive_slug(name, str(mf.get("name") or "member")),
        "description": mf.get("description", ""),
        "capabilities": [c["id"] for c in mf.get("capabilities", [])],
        # 权限是本地环境的属性（2026-07-20 决策）：初始值取本地默认设置，
        # 与模板无关；之后在成员详情/私聊里逐个调整
        "permissions": load_default_permissions(),
    })
    f.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")

    if body.activate:
        office = await hub.office(org)
        try:
            await office.enroll_member(name)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(500, f"{name} 实例启动失败：{e}") from e
    return {"name": name, "agent": record_key.get("agent"),
            "capabilities": [c["id"] for c in mf.get("capabilities", [])],
            "status": "active" if body.activate else "pending",
            "note": ("已入职，实例运行中" if body.activate
                     else "已聘用（待入职）；到「公司」页点「入职」后开始工作")}


class MemberPatch(BaseModel):
    """成员编辑（§3.5 修正：实例配置归实例所有）。

    改名仅限实例未运行时（工作区目录随显示名，运行中不搬家）；
    能力/权限/描述即时落 org.yaml，对运行中实例需复岗后生效。
    """

    new_name: str | None = None
    description: str | None = None
    capabilities: list[str] | None = None
    permissions: dict[str, Any] | None = None


@app.patch("/api/orgs/{org}/members/{name}")
async def patch_member(org: str, name: str, body: MemberPatch) -> dict[str, Any]:
    import shutil

    from milod.config.paths import org_dir

    f = org_dir(org) / "org.yaml"
    doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    members = (doc.get("spec") or {}).get("members", [])
    m = next((x for x in members if x["name"] == name), None)
    if m is None:
        raise HTTPException(404, f"成员 {name} 不在名册中")

    office = hub._offices.get(org)
    loaded = bool(office and name in office._specs)
    restart_needed = False

    if body.new_name is not None and body.new_name.strip() != name:
        new = body.new_name.strip()
        if not (1 <= len(new) <= 20):
            raise HTTPException(422, "成员名长度需在 1–20 字符")
        if new.lower() in {"secretary", "secretariat", "system", "owner", "org"} or new == "秘书":
            raise HTTPException(422, f"{new} 是系统保留名")
        if any(x["name"] == new for x in members):
            raise HTTPException(409, f"成员名 {new} 已被占用")
        if loaded:
            raise HTTPException(409, "运行中的成员不能改名——先停职再改")
        old_dir = org_dir(org) / "members" / name
        if old_dir.exists():
            shutil.move(str(old_dir), str(org_dir(org) / "members" / new))
        m["name"] = new

    for k in ("description", "capabilities", "permissions"):
        v = getattr(body, k)
        if v is not None:
            m[k] = v
            restart_needed = True

    f.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return {"name": m["name"],
            "note": ("已保存；成员正在运行，能力/权限改动需停职后复岗生效"
                     if loaded and restart_needed else "已保存")}


@app.post("/api/orgs/{org}/members/{name}/dm")
async def member_dm(org: str, name: str, body: SecretaryChatRequest) -> dict[str, Any]:
    """私聊成员（全权调教通道）：对话历史在群 dm-<name>，回复经 WS 推送。

    成员工作中时消息会排队，等其交付后回复（worker 单线程，人在忙）。
    """
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "消息不能为空")
    office = await hub.office(org)
    if name not in office._adapters:
        raise HTTPException(409, f"成员 {name} 不在运行中——先让其加入")
    task = asyncio.create_task(office.dm(name, text))
    hub.track(f"dm-{org}-{name}-{uuid.uuid4().hex[:4]}", task)
    return {"status": "ok", "group_id": f"dm-{name}"}


@app.post("/api/orgs/{org}/members/{name}/activate")
async def activate_member(org: str, name: str) -> dict[str, Any]:
    """「加入组织」：把待加入成员置为已入组，并热加载实例（无需重启 milod）。"""
    from milod.config.paths import org_dir

    f = org_dir(org) / "org.yaml"
    doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    m = next((x for x in (doc.get("spec") or {}).get("members", [])
              if x["name"] == name), None)
    if m is None:
        raise HTTPException(404, f"成员 {name} 不在编制中")
    if not m.get("enrolled", True):
        m["enrolled"] = True
        f.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False),
                     encoding="utf-8")

    office = await hub.office(org)
    try:
        spec = await office.enroll_member(name)  # 已运行则幂等返回
    except Exception as e:  # noqa: BLE001 —— 包损坏/子进程拉不起来要如实报给组长
        raise HTTPException(500, f"成员 {name} 实例启动失败：{e}") from e
    return {"name": name, "capabilities": spec.capabilities, "status": "active"}


@app.post("/api/orgs/{org}/members/{name}/deactivate")
async def deactivate_member(org: str, name: str) -> dict[str, Any]:
    """「停职」：停掉实例但保留编制条目与工作区（记忆/checkpoint 保留，可复岗）。

    工作中的成员不可停职（避免任务被无谓中断）——先等交付或改用请离（force）。
    """
    from milod.config.paths import org_dir

    f = org_dir(org) / "org.yaml"
    doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    m = next((x for x in (doc.get("spec") or {}).get("members", [])
              if x["name"] == name), None)
    if m is None:
        raise HTTPException(404, f"成员 {name} 不在编制中")

    office = hub._offices.get(org)
    if office and office.is_busy(name):
        raise HTTPException(409, f"成员 {name} 正在执行任务，交付后才能停职")
    if office:
        await office.dismiss_member(name, purge=False)
    m["enrolled"] = False
    f.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return {"name": name, "status": "suspended"}


@app.delete("/api/orgs/{org}/members/{name}")
async def dismiss_member(org: str, name: str, force: bool = False) -> dict[str, Any]:
    """「请离/移出编制」：删编制条目 + 停实例 + 销毁私有工作区。

    成果归组织（artifacts 留在组织目录），过程随实例销毁（编制设计 §3.4）。
    工作中的成员需 force=true 二次确认，名下未终局任务转 failed。
    """
    import shutil

    from milod.config.paths import org_dir

    f = org_dir(org) / "org.yaml"
    doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    members = (doc.get("spec") or {}).get("members", [])
    m = next((x for x in members if x["name"] == name), None)
    if m is None:
        raise HTTPException(404, f"成员 {name} 不在编制中")

    office = hub._offices.get(org)
    if office and office.is_busy(name) and not force:
        raise HTTPException(409, f"成员 {name} 正在执行任务；带 force=true 可强制请离（任务将中断）")
    if office:
        await office.dismiss_member(name, purge=True)
    else:
        shutil.rmtree(org_dir(org) / "members" / name, ignore_errors=True)
    members.remove(m)
    f.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return {"name": name, "status": "dismissed"}


@app.get("/api/orgs/{org}/todos")
async def todos(org: str) -> dict[str, Any]:
    """待办 = 跨群 @你 事项的聚合视图；每条含所属任务群，点击可直达。"""
    office = await hub.office(org)
    items = []
    for t in office.store.tasks():
        if t["state"] != "input_required":
            continue
        esc = _latest_escalation(office, t["group_id"], t["task_id"])
        items.append({
            "task_id": t["task_id"],
            "group_id": t["group_id"],
            "member": t["member"],
            "updated_at": t["updated_at"],
            "escalation": esc,
        })
    items.sort(key=lambda x: x["updated_at"], reverse=True)
    return {"todos": items}


def _latest_escalation(office, group_id: str, task_id: str) -> dict | None:
    for e in reversed(office.store.group_events(group_id)):
        if e["type"] == "escalation" and e["task_id"] == task_id:
            return e["payload"]
    return None


# ---- 下达与答复 -----------------------------------------------------------
@app.post("/api/orgs/{org}/runs")
async def create_run(org: str, body: RunRequest) -> dict[str, Any]:
    """下达需求：立即返回 group_id，执行在后台，进度经 WS 推送。"""
    office = await hub.office(org)
    group_id = f"g-{uuid.uuid4().hex[:6]}"
    task = asyncio.create_task(hub.execute(org, group_id, body.request, body.auto_approve))
    hub.track(group_id, task)
    return {"group_id": group_id, "status": "started"}


@app.get("/api/orgs/{org}/groups/{group_id}/plan")
async def get_plan(org: str, group_id: str) -> dict[str, Any]:
    """取待批准的计划——桌面端渲染计划卡（批准即授权到里程碑）。"""
    envelopes = await hub.pending_plan(org, group_id)
    if envelopes is None:
        raise HTTPException(404, "该任务群没有待批准的计划")
    return {
        "group_id": group_id,
        "steps": [
            {"task_id": e.task_id, "capability": e.capability, "objective": e.objective,
             "format": e.output_spec.format, "artifacts": e.output_spec.artifacts,
             "constraints": e.constraints}
            for e in envelopes
        ],
    }


@app.post("/api/orgs/{org}/groups/{group_id}/retry")
async def retry_group(org: str, group_id: str) -> dict[str, Any]:
    """重试分解（分解失败后的出口）：用原始需求重新分解。"""
    if not await hub.retry_decompose(org, group_id):
        raise HTTPException(404, "该任务群没有可重试的需求")
    return {"group_id": group_id, "status": "retrying"}


@app.post("/api/orgs/{org}/groups/{group_id}/approve")
async def approve_plan(org: str, group_id: str, body: ApproveRequest) -> dict[str, Any]:
    """批准计划并开始执行；可带 edits 微调步骤目标。"""
    if not await hub.approve_plan(org, group_id, edits=body.edits):
        raise HTTPException(404, "该任务群没有待批准的计划")
    return {"group_id": group_id, "status": "approved"}


@app.post("/api/orgs/{org}/groups/{group_id}/reject")
async def reject_plan(org: str, group_id: str, body: RejectRequest) -> dict[str, Any]:
    if not await hub.reject_plan(org, group_id, body.reason):
        raise HTTPException(404, "该任务群没有待批准的计划")
    return {"group_id": group_id, "status": "rejected"}


@app.post("/api/orgs/{org}/tasks/{task_id}/reply")
async def reply(org: str, task_id: str, body: ReplyRequest) -> dict[str, Any]:
    """答复被中断的任务——决策卡的提交入口，与待办、任务群三处同源。"""
    office = await hub.office(org)
    row = next((t for t in office.store.tasks() if t["task_id"] == task_id), None)
    if not row:
        raise HTTPException(404, f"未知任务 {task_id}")
    if row["state"] != "input_required":
        raise HTTPException(409, f"任务当前状态为 {row['state']}，无需答复")
    asyncio.create_task(hub.resume(org, task_id, body.answer))
    return {"task_id": task_id, "status": "resumed"}


# ---- WebSocket ------------------------------------------------------------
@app.websocket("/ws/{org}")
async def ws(websocket: WebSocket, org: str, since: int = 0) -> None:
    """事件流。`?since=<seq>` 断线重连：先补发漏掉的历史事件，再转入实时推送。

    events 表 append-only、seq 单调递增——客户端记住最后收到的 seq 即可无缝续上
    （等价于 Gateway SSE 的 Last-Event-ID 语义，embedded 路线自行实现）。
    """
    await websocket.accept()
    queue: asyncio.Queue[MiloEvent] = asyncio.Queue()
    hub.subscribe(org, queue)
    try:
        office = await hub.office(org)

        # 1) 补发：先把断线期间的事件按序补上，客户端据此对齐状态
        replayed = 0
        if since:
            for row in office.store.events_since(since):
                await websocket.send_json(_row_to_frame(row, replay=True))
                replayed += 1
        await websocket.send_json({
            "type": "_sync", "replayed": replayed,
            "latest_seq": office.store.latest_seq(),
        })

        # 2) 实时：补发与实时之间可能有重叠事件，客户端按 seq/event_id 去重
        while True:
            ev = await queue.get()
            await websocket.send_json({
                "seq": ev.seq,          # 落库时回填，客户端据此推进水位
                "content": ev.content,  # 人类可读文本，UI 直接渲染（与补发帧同源）
                "event_id": ev.event_id,
                "group_id": ev.group_id,
                "task_id": ev.task_id,
                "type": ev.type.value,
                "actor": ev.actor,
                "ts": ev.ts.isoformat(),
                "reach": ev.effective_reach().value,
                "payload": ev.payload,
                "replay": False,
            })
    except WebSocketDisconnect:
        pass
    finally:
        hub.unsubscribe(org, queue)


def _row_to_frame(row: dict, *, replay: bool) -> dict[str, Any]:
    """把落库的事件行还原为 WS 帧（补发路径带 seq，供客户端记录水位）。"""
    return {
        "seq": row["seq"],
        "event_id": row["event_id"],
        "group_id": row["group_id"],
        "task_id": row["task_id"],
        "run_id": row["run_id"],
        "type": row["type"],
        "category": row["category"],
        "actor": row["actor"],
        "ts": row["ts"],
        "reach": row["reach"],
        "content": row["content"],
        "payload": row["metadata"],
        "replay": replay,
    }


@app.on_event("shutdown")
async def _shutdown() -> None:
    with contextlib.suppress(Exception):
        await hub.close_all()

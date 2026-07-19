"""~/.milo 目录布局（编制设计 §6.1）。文件是事实源，UI 是编辑器。"""
from __future__ import annotations

import os
from pathlib import Path


def milo_home() -> Path:
    return Path(os.environ.get("MILO_HOME", Path.home() / ".milo"))


def settings_dir() -> Path:          # 应用层：app.yaml / providers.yaml / registries.yaml
    return milo_home() / "settings"


def org_dir(org: str) -> Path:       # 组织层：org.yaml（可移植）+ bindings.yaml（不可移植）
    return milo_home() / "orgs" / org


def member_dir(org: str, member: str) -> Path:
    """成员层：渲染产物（只读，手改会被调和覆盖）。"""
    return org_dir(org) / "members" / member


def artifacts_dir(org: str) -> Path:  # 组织级对象存储：引用授权，非共享盘
    return org_dir(org) / "artifacts"


def library_dir() -> Path:
    """Agent 库（产品方案 §3.5）：用户全局资产，跨公司共享。

    目录即事实源：`<name>@<version>/` 一个模板一个目录，版本共存。
    """
    return milo_home() / "library"


def favorites_file() -> Path:  # 市场收藏清单：只记引用，不占磁盘
    return settings_dir() / "favorites.yaml"


def resolve_member_source(member: dict) -> Path:
    """把 org.yaml 成员记录解析为模板目录。

    新格式 `agent: name@version` 指向 Agent 库；旧格式 `pack: <路径>` 兼容可读
    （§3.5：新写入一律模板引用，旧数据不迁移也能跑）。
    """
    if member.get("agent"):
        return library_dir() / str(member["agent"])
    return Path(str(member.get("pack", ""))).expanduser()

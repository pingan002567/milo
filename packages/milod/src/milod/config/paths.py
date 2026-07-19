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

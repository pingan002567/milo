"""本地默认设置（2026-07-20 决策：权限是本地环境的属性，不是包的属性）。

模板不再声明权限、市场不再展示权限——所有成员实例化时统一继承这里的
默认权限（快照进实例后仍可逐个编辑）。文件是事实源：settings/defaults.yaml。
"""
from __future__ import annotations

from typing import Any

import yaml

from milod.config.paths import settings_dir

#: 出厂默认：能交付文件（成员基本生存需求）、禁网、不给代码执行（≈总开关须显式开）
FACTORY_PERMISSIONS: dict[str, Any] = {
    "network": [],
    "filesystem": "workspace",
    "python_repl": False,
}


def _file():
    return settings_dir() / "defaults.yaml"


def load_default_permissions() -> dict[str, Any]:
    f = _file()
    doc: dict[str, Any] = {}
    if f.exists():
        try:
            doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        except Exception:  # noqa: BLE001 —— 坏文件回退出厂默认，不阻断招募
            doc = {}
    perms = doc.get("permissions") or {}
    return {**FACTORY_PERMISSIONS, **perms}


def save_default_permissions(perms: dict[str, Any]) -> dict[str, Any]:
    merged = {**load_default_permissions(), **perms}
    f = _file()
    f.parent.mkdir(parents=True, exist_ok=True)
    doc: dict[str, Any] = {}
    if f.exists():
        try:
            doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        except Exception:  # noqa: BLE001
            doc = {}
    doc["permissions"] = merged
    f.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return merged

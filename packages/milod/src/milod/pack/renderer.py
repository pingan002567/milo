"""MiloPack → 成员私有工作区渲染器（Spike 02 沉淀为产品代码）。

每成员一套完整目录树——DEER_FLOW_HOME 内含 threads/memory，绝不共用（编制设计 §3.4）：

  <org_root>/members/<member>/
  ├── config.yaml            # DEER_FLOW_CONFIG_PATH
  └── home/                  # DEER_FLOW_HOME（私有）
      ├── agents/<member>/{config.yaml, SOUL.md}
      ├── skills/custom/<skill>/SKILL.md
      ├── threads/           # 运行时生成
      └── memory.json        # 运行时生成
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

import yaml

from milod.adapter.base import MemberSpec

SCHEMA_DIR = Path(__file__).resolve().parents[4] / "schemas"

#: 模型档位 -> harness 适配器类路径（provider 由 api_base 决定，此表只管类）
PROVIDER_CLASS = {
    "mimo": "deerflow.models.patched_mimo:PatchedChatMiMo",
    "deepseek": "deerflow.models.patched_deepseek:PatchedChatDeepSeek",
    "openai": "deerflow.models.patched_openai:PatchedChatOpenAI",
    "claude": "deerflow.models.claude_provider:ChatClaude",
}


class PackError(RuntimeError):
    pass


def load_manifest(pack_dir: Path) -> dict[str, Any]:
    f = pack_dir / "manifest.yaml"
    if not f.exists():
        raise PackError(f"MiloPack 缺少 manifest.yaml: {pack_dir}")
    manifest = yaml.safe_load(f.read_text(encoding="utf-8"))
    _validate(manifest)
    return manifest


def _validate(manifest: dict) -> None:
    schema_file = SCHEMA_DIR / "milopack.schema.json"
    if not schema_file.exists():  # schema 随仓库分发；缺失时跳过而非阻断
        return
    try:
        from jsonschema import ValidationError, validate
    except ImportError:
        return
    try:
        validate(manifest, json.loads(schema_file.read_text(encoding="utf-8")))
    except ValidationError as e:
        raise PackError(f"manifest 不符合 MiloPack schema: {e.message}") from e


def render(
    *,
    org_root: Path,
    pack_dir: Path,
    member_name: str | None = None,
    model: dict[str, Any],
    secrets: dict[str, str] | None = None,
    extra_tools: list[dict[str, Any]] | None = None,  # 追加工具（秘书的 Milo Tools）
    workdir: Path | None = None,                      # 工作区覆盖（秘书住 orgs/<org>/secretary/）
    snapshot: dict[str, Any] | None = None,           # 实例自持配置（§3.5 修正：实例与模板脱钩）
) -> MemberSpec:
    """渲染一个成员的私有工作区，返回可直接交给 adapter.enroll 的 MemberSpec。

    model: {"name","api_base","provider","model"} —— 来自 bindings.yaml 的档位绑定。
    secrets: 只含该成员所需凭证（最小注入），值不写入任何文件。

    snapshot（§3.5 修正）：实例化即拷贝，生成后实例与模板脱钩——
    capabilities/permissions/description 以 org.yaml 里的实例快照为准（可编辑）；
    工作区已有 SOUL.md/skills 时不再从模板覆盖（保护用户对实例的修改）；
    快照齐全且工作区已材料化时，模板缺失也能照常拉起。
    """
    snapshot = snapshot or {}
    try:
        manifest = load_manifest(pack_dir)
    except Exception:
        # 模板可能已从库中移除——实例自持配置时这不是错误
        if not snapshot:
            raise
        manifest = {"name": snapshot.get("template_name") or (member_name or "member")}
    name = member_name or manifest["name"]
    # slug 在招募时固化进名册（snapshot.slug）——改名不换 slug，
    # harness 目录/人设/记忆全部跟人走；缺失时按旧规则推导（兼容旧数据）
    slug = snapshot.get("slug") or derive_slug(name, str(manifest.get("name") or "member"))
    workdir = workdir or (org_root / "members" / name)
    home = workdir / "home"
    agent_dir = home / "agents" / slug
    skills_root = home / "skills"
    agent_dir.mkdir(parents=True, exist_ok=True)
    (skills_root / "custom").mkdir(parents=True, exist_ok=True)

    # 1) persona -> SOUL.md：只在首次材料化时从模板拷贝——
    # 之后 SOUL.md 归实例所有（用户可改人设），绝不被模板覆盖
    soul = agent_dir / "SOUL.md"
    if not soul.exists():
        persona = pack_dir / "persona" / "system.md"
        if not persona.exists():
            raise PackError(f"MiloPack 缺少 persona/system.md: {pack_dir}")
        soul.write_text(persona.read_text(encoding="utf-8"), encoding="utf-8")

    # 2) skills：同样只做首次拷贝（实例自持）
    skill_names: list[str] = []
    src_skills = pack_dir / "skills" if pack_dir else None
    if src_skills and src_skills.exists():
        for s in sorted(p for p in src_skills.iterdir() if p.is_dir()):
            dst = skills_root / "custom" / s.name
            if not dst.exists():
                shutil.copytree(s, dst)
            skill_names.append(s.name)
    else:  # 模板不在了：以工作区现有 skills 为准
        existing = skills_root / "custom"
        skill_names = sorted(p.name for p in existing.iterdir() if p.is_dir()) \
            if existing.exists() else []

    # 实例快照优先（可编辑），模板 manifest 只是首次的出厂缺省
    description = snapshot.get("description") or manifest.get("description", "")
    capabilities = snapshot.get("capabilities") \
        or [c["id"] for c in manifest.get("capabilities", [])]

    (agent_dir / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "name": slug,  # harness 校验此名；显示名走 MemberSpec.name
                "description": description,
                "model": model["name"],
                "skills": skill_names,  # 白名单；[] = 禁用
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    # 3) 运行时 config.yaml（permissions 收敛在此落地）
    perms = snapshot.get("permissions") or manifest.get("permissions", {}) or {}
    provider = model.get("provider", "openai")
    cfg: dict[str, Any] = {
        "config_version": 26,
        "logging": {"level": "INFO"},
        "models": [
            {
                "name": model["name"],
                "use": PROVIDER_CLASS.get(provider, PROVIDER_CLASS["openai"]),
                "model": model.get("model", model["name"]),
                "api_base": model["api_base"],
                # 密钥只以 $VAR 引用出现；真实值经子进程环境注入（密钥零落盘）
                "api_key": f"${model['secret_env']}",
                "timeout": 600.0,
                "max_retries": 2,
            }
        ],
        "sandbox": {
            "use": "deerflow.sandbox.local:LocalSandboxProvider",
            "allow_host_bash": bool(perms.get("python_repl", False)),
        },
        "subagents": {"max_total_per_run": 2},
        # skills.path 必须显式绝对路径，缺省会指向"调用方项目根"导致技能静默不可见
        "skills": {"path": str(skills_root.resolve()), "deferred_discovery": False},
        # 权限收敛：无网络白名单则不注入检索工具——成员想越权也执行不了
        "tools": _tools_for(perms) + list(extra_tools or []),
    }
    (workdir / "config.yaml").write_text(
        yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )

    return MemberSpec(
        name=name,
        runtime_name=slug,
        pack_ref=str(pack_dir),
        workdir=workdir,
        capabilities=capabilities,
        model_bindings={"default": model["name"]},
        secrets=dict(secrets or {}),
    )


def derive_slug(name: str, template_base: str) -> str:
    """harness agent 名只接受 ^[A-Za-z0-9-]+$；中文显示名 → 确定性 slug。"""
    if re.fullmatch(r"[A-Za-z0-9-]+", name):
        return name
    import hashlib

    return f"{template_base}-{hashlib.md5(name.encode()).hexdigest()[:6]}"


def _tools_for(perms: dict) -> list[dict]:
    tools: list[dict] = []
    if perms.get("network"):
        tools.append(
            {
                "name": "web_search",
                "group": "web",
                "use": "deerflow.community.ddg_search.tools:web_search_tool",
                "max_results": 5,
            }
        )
    # 文件工具按 filesystem 权限注入。这些是 harness 的沙箱路径工具
    # （路径校验锁在 /mnt/user-data 虚拟目录内），不是 host bash——
    # 成员没有它们就无法产出 artifact 文件，交付只能贴正文（验收必退回）
    fs = perms.get("filesystem")
    def _t(name: str) -> dict:
        return {"name": name, "group": "sandbox", "use": f"deerflow.sandbox.tools:{name}_tool"}
    if fs in ("workspace", "readwrite"):
        tools += [_t("ls"), _t("read_file"), _t("write_file"), _t("str_replace")]
    elif fs == "readonly":
        tools += [_t("ls"), _t("read_file")]
    return tools

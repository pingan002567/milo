"""Spike 02：MiloPack → 成员工作区渲染器（milod/pack/ 的原型）。

**每个成员一套完全独立的目录树**（编制设计 §3.4 数据隔离）——
DEER_FLOW_HOME 下含 agents/skills/threads/memory.json/uploads，共用即打通
记忆与会话历史，必须按成员分开：

  <root>/members/<member>/
  ├── config.yaml                       # DEER_FLOW_CONFIG_PATH
  └── home/                             # DEER_FLOW_HOME（该成员私有）
      ├── agents/<member>/{config.yaml, SOUL.md}
      ├── skills/custom/<skill>/SKILL.md
      ├── threads/                      # 会话历史（运行时生成）
      └── memory.json                   # 长期记忆（运行时生成）

⚠️ SPIKE-02 附加发现：harness 的 `_app_config` 是**进程级全局单例**，
后构造的 client 会覆盖先前的全局配置；`get_paths()` 又按环境变量动态解析。
=> 单进程内跑多个成员**不是安全隔离**，正式实现改为「每成员一子进程」
（见 REPORT.md「进程隔离」章 与 技术规划 §7）。
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import yaml

HERE = Path(__file__).parent


def render(root: Path, pack_dir: Path, model_name: str, tier_binding: dict[str, str]) -> Path:
    """把一个 MiloPack 渲染为**该成员私有**的工作区。root 下按成员名分目录。"""
    manifest = yaml.safe_load((pack_dir / "manifest.yaml").read_text(encoding="utf-8"))
    name = manifest["name"]

    workdir = root / "members" / name      # 每成员独立根，互不可见
    home = workdir / "home"
    agent_dir = home / "agents" / name
    skills_dir = home / "skills" / "custom"
    agent_dir.mkdir(parents=True, exist_ok=True)
    skills_dir.mkdir(parents=True, exist_ok=True)

    # 1) 成员 persona：MiloPack persona/system.md -> SOUL.md（原样透传，契约段已在包内）
    soul_src = pack_dir / "persona" / "system.md"
    (agent_dir / "SOUL.md").write_text(soul_src.read_text(encoding="utf-8"), encoding="utf-8")

    # 2) AgentConfig：能力声明降为 description；skills 白名单按包内技能收敛
    skill_names = [p.name for p in (pack_dir / "skills").iterdir() if p.is_dir()] \
        if (pack_dir / "skills").exists() else []
    (agent_dir / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "name": name,
                "description": manifest.get("description", ""),
                "model": model_name,
                "skills": skill_names,   # None=全部，[]=禁用，列表=白名单
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    # 3) 技能：官方 SKILL.md 原样透传
    for s in skill_names:
        dst = skills_dir / s
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(pack_dir / "skills" / s, dst)

    # 4) 运行时 config.yaml：档位绑定 + permissions 收敛（网络白名单 -> 无外网即不给搜索工具）
    perms = manifest.get("permissions", {})
    cfg = {
        "config_version": 26,
        "logging": {"level": "INFO"},
        "models": [
            {
                "name": model_name,
                "use": "deerflow.models.patched_mimo:PatchedChatMiMo",
                "model": model_name,
                "api_base": "https://api.xiaomimimo.com/v1",
                "api_key": "$MIMO_API_KEY",
                "timeout": 600.0,
                "max_retries": 2,
                "supports_thinking": False,
                "supports_vision": False,
            }
        ],
        "sandbox": {
            "use": "deerflow.sandbox.local:LocalSandboxProvider",
            "allow_host_bash": bool(perms.get("python_repl", False)),
        },
        "subagents": {"max_total_per_run": 2},
        # skills.path 缺省指向"调用方项目根"，必须显式指到成员工作区（SPIKE-02 实测）
        "skills": {"path": str((home / "skills").resolve()), "deferred_discovery": False},
    }
    # permissions 收敛的实现方式（已核实 schema：tools 是 list，默认空即无工具）：
    # 有网络白名单才注入检索工具；无授权则列表里根本没有该工具——
    # 成员想越权也执行不了（釜底抽薪，不依赖成员自觉）。
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
    cfg["tools"] = tools

    cfg_path = workdir / "config.yaml"
    cfg_path.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")

    print(f"[✓] 渲染完成 {workdir}")
    print(f"    DEER_FLOW_CONFIG_PATH={cfg_path}")
    print(f"    DEER_FLOW_HOME={home}")
    print(f"    agent={name} skills={skill_names} tier_binding={json.dumps(tier_binding)}")
    return cfg_path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", type=Path, default=HERE / "pack")
    ap.add_argument("--root", type=Path, default=HERE / "run1", help="组织根目录（其下按成员分目录）")
    ap.add_argument("--model", default="mimo-v2.5")
    args = ap.parse_args()
    render(args.root, args.pack, args.model, {"reasoning": args.model})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

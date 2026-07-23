"""秘书人设的读写——「可塑不可换」的落地。

秘书是制度接口不是雇员：不能从市场换、不能辞退、工具面与权限由系统固定；
但**人设可以由你改**——挡驾标准、汇报口径、说话方式本就该按人调。

分两段存：
- **出厂基线**（内置 SecretaryPack 的 persona/system.md）：职责、信任边界、
  不可代答请示等硬规则。每次保存都从模板重新刷一遍——Milo 升级后基线的
  修订才能落到已存在的工作区（渲染器只在首次材料化时拷贝，不会覆盖）。
- **你的指示**：追加在基线之后，用户自己写。

**为什么不给秘书 update_my_persona 工具**（与成员私聊的自改工具不同）：
秘书要读市场描述、成员汇报、产物内容——全是不可信数据。给它自写人设的工具
等于开出「注入 → 持久污染控制面」的路径，比成员严重得多（成员被隔离在信封里，
秘书手里是 Milo Tools）。所以人设只由你在 UI 写入；秘书可以在对话里建议，
执行是你点的。S2 提案卡做好后可升级为「秘书提议 → 你一键确认」。
"""
from __future__ import annotations

from pathlib import Path

from milod.config.paths import org_dir

PACK_DIR = Path(__file__).parent / "pack"
BASELINE_FILE = PACK_DIR / "persona" / "system.md"

#: 用户指示区块的分隔标记（写进 SOUL.md，解析时据此切分）
MARKER = "# 你的指示（负责人设定）"


def baseline() -> str:
    return BASELINE_FILE.read_text(encoding="utf-8").strip()


def soul_path(org: str) -> Path:
    """秘书的 SOUL.md。slug 恒为 "secretary"（ASCII 名直接用作 slug）。"""
    return org_dir(org) / "secretary" / "home" / "agents" / "secretary" / "SOUL.md"


def read(org: str) -> dict[str, str | bool]:
    """返回 {baseline, instructions, customized}。

    工作区还没渲染（秘书从未启动）时也能读——此时 instructions 为空。
    """
    path = soul_path(org)
    instructions = ""
    if path.exists():
        text = path.read_text(encoding="utf-8")
        if MARKER in text:
            instructions = text.split(MARKER, 1)[1].strip()
    return {"baseline": baseline(), "instructions": instructions,
            "customized": bool(instructions)}


def write(org: str, instructions: str) -> Path:
    """基线 + 你的指示 → SOUL.md（整份重写，顺带把基线刷到最新）。

    秘书未启动过也能写：先落盘，渲染器首次材料化时见 SOUL.md 已存在便不再覆盖
    （renderer 的"人设归实例所有"规则），设定不会丢。
    """
    path = soul_path(org)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = baseline()
    text = f"{body}\n" if not instructions.strip() else \
        f"{body}\n\n{MARKER}\n\n{instructions.strip()}\n"
    path.write_text(text, encoding="utf-8")
    return path

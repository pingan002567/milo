#!/usr/bin/env bash
# Milo 开发环境一键启动：milod 守护进程 + 桌面端前端
#
#   ./scripts/dev.sh            启动（前端 http://localhost:1420）
#   ./scripts/dev.sh --tauri    以 Tauri 窗口启动（需 Rust 工具链）
#   ./scripts/dev.sh --stop     停止全部
#
# 首次使用前需设置模型密钥，例如：
#   export MIMO_API_KEY=sk-…
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/spikes/01-escalate-events/.venv/bin/python"
export PYTHONPATH="$ROOT/packages/milod/src"
export MILO_HOME="${MILO_HOME:-$HOME/.milo}"
export MILO_PACKS="${MILO_PACKS:-$MILO_HOME/packs}"
PORT="${MILO_PORT:-8899}"

stop() {
  pkill -f "uvicorn milod.api.server" 2>/dev/null || true
  pkill -f "apps/desktop/node_modules/.bin/vite" 2>/dev/null || true
  echo "已停止 milod 与前端（成员子进程随 milod 一同退出）"
}

[[ "${1:-}" == "--stop" ]] && { stop; exit 0; }

[[ -x "$VENV" ]] || { echo "找不到 Python 环境：$VENV"; exit 1; }

# 1) 首次运行：建默认组织
if [[ ! -f "$MILO_HOME/orgs/demo/org.yaml" ]]; then
  # 注意：全角括号会被 shell 当作变量名的一部分，务必用 ${} 包裹
  echo "▸ 初始化组织 demo (${MILO_HOME})"
  "$VENV" "$ROOT/packages/cli/milo_cli.py" init demo
  mkdir -p "$MILO_PACKS"
  # 附带一个示例包，便于在「市场」里直接招募
  [[ -d "$MILO_PACKS/lit-scout" ]] || cp -r "$ROOT/spikes/02-enroll-render/pack" "$MILO_PACKS/lit-scout"
  echo "  示例包已放入 $MILO_PACKS/lit-scout —— 可在「市场」页招募"
fi

stop
echo "▸ 启动 milod (port ${PORT})"
"$VENV" -m uvicorn milod.api.server:app --port "$PORT" --log-level warning \
  > /tmp/milod.log 2>&1 &
sleep 4

if [[ "${1:-}" == "--tauri" ]]; then
  echo "▸ 启动 Tauri 窗口"
  cd "$ROOT/apps/desktop" && npm run tauri dev
else
  echo "▸ 启动前端 http://localhost:1420"
  cd "$ROOT/apps/desktop" && npm run dev
fi

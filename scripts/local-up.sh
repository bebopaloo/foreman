#!/usr/bin/env bash
# Start the local runtime stack (compose.local.yaml), or rebuild the Usage index
# inside it. Usage: local-up.sh [up|reindex]
#
# FOREMAN_CLAUDE_DIR is the config folder (default ~/.claude-bebopaloo) and
# FOREMAN_DATA_DIR is the Foreman data folder (default ~/.foreman). Compose
# mounts both read-only. LOCAL_PORT sets the web port (default 47100) and
# LOCAL_PROJECT sets the Compose project name (default foreman-local).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

command="${1:-up}"
export FOREMAN_CLAUDE_DIR="${FOREMAN_CLAUDE_DIR:-$HOME/.claude-bebopaloo}"
export FOREMAN_DATA_DIR="${FOREMAN_DATA_DIR:-$HOME/.foreman}"
compose=(docker compose -f compose.local.yaml -p "${LOCAL_PROJECT:-foreman-local}")

case "$command" in
  up)
    claude_dir="${FOREMAN_CLAUDE_DIR%/}"
    if [ "$claude_dir" = "$HOME/.claude" ]; then
      echo "FOREMAN_CLAUDE_DIR must not be ~/.claude." >&2
      exit 1
    fi
    if [ ! -d "$FOREMAN_DATA_DIR" ]; then
      mkdir -p "$(dirname "$FOREMAN_DATA_DIR")"
      mkdir -m 700 "$FOREMAN_DATA_DIR"
    fi
    "${compose[@]}" up --detach --build --wait --wait-timeout 300
    echo "Foreman runs at http://127.0.0.1:${LOCAL_PORT:-47100}"
    ;;
  reindex)
    "${compose[@]}" exec api node apps/api/src/reindex.ts
    ;;
  *)
    echo "usage: $0 [up|reindex]" >&2
    exit 2
    ;;
esac

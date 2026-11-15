#!/usr/bin/env bash
# Start the local runtime stack (compose.local.yaml), or rebuild the Usage index
# inside it. Usage: local-up.sh [up|reindex]
#
# FOREMAN_CLAUDE_DIR is the config folder (default ~/.claude-bebopaloo) and
# FOREMAN_DATA_DIR is the Foreman data folder (default ~/.foreman). Compose
# mounts both read-only. FOREMAN_MARKETPLACE_DIR is optional: the absolute path
# of the folder of one `directory` Marketplace (for example the checkout of the
# factory repo). Compose mounts it read-only at the same path in the API
# container. With no value, Foreman reads no `directory` Marketplace.
# LOCAL_PORT sets the web port (default 47100) and
# LOCAL_PROJECT sets the Compose project name (default foreman-local).
#
# "up" reads one Keychain item for each host and owner in the repo list
# (keychain-tokens.ts) and gives the JSON object to Compose in the variable
# FOREMAN_TOKENS_JSON, for the Compose process only. Compose mounts it as the
# secret foreman_tokens. No other command reads the Keychain.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

command="${1:-up}"
export FOREMAN_CLAUDE_DIR="${FOREMAN_CLAUDE_DIR:-$HOME/.claude-bebopaloo}"
export FOREMAN_DATA_DIR="${FOREMAN_DATA_DIR:-$HOME/.foreman}"
export FOREMAN_MARKETPLACE_DIR="${FOREMAN_MARKETPLACE_DIR:-}"
compose=(docker compose -f compose.local.yaml -p "${LOCAL_PROJECT:-foreman-local}")

case "$command" in
  up)
    claude_dir="${FOREMAN_CLAUDE_DIR%/}"
    if [ "$claude_dir" = "$HOME/.claude" ] || [ "$claude_dir" -ef "$HOME/.claude" ]; then
      echo "FOREMAN_CLAUDE_DIR must not be ~/.claude." >&2
      exit 1
    fi
    if [ -n "$FOREMAN_MARKETPLACE_DIR" ]; then
      case "$FOREMAN_MARKETPLACE_DIR" in
        /*) ;;
        *)
          echo "FOREMAN_MARKETPLACE_DIR must be an absolute path." >&2
          exit 1
          ;;
      esac
      if [ ! -d "$FOREMAN_MARKETPLACE_DIR" ]; then
        echo "FOREMAN_MARKETPLACE_DIR is not a folder." >&2
        exit 1
      fi
    fi
    if [ ! -d "$FOREMAN_DATA_DIR" ]; then
      mkdir -p "$(dirname "$FOREMAN_DATA_DIR")"
      mkdir -m 700 "$FOREMAN_DATA_DIR"
    fi
    tokens="$(node scripts/keychain-tokens.ts || echo '{}')"
    FOREMAN_TOKENS_JSON="$tokens" "${compose[@]}" up --detach --build --wait --wait-timeout 300
    unset tokens
    echo "Foreman runs at http://127.0.0.1:${LOCAL_PORT:-47100}"
    FOREMAN_TOKENS_JSON='{}' "${compose[@]}" exec -T api node apps/api/src/adapter-smoke.ts
    ;;
  reindex)
    FOREMAN_TOKENS_JSON='{}' "${compose[@]}" exec api node apps/api/src/reindex.ts
    ;;
  *)
    echo "usage: $0 [up|reindex]" >&2
    exit 2
    ;;
esac

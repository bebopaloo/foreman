#!/usr/bin/env bash
# Smoke-test Foreman for one environment: dev or production (factory ADR 0015).
#
# Foreman has no hosted environment, so the smoke test builds the
# production-like preview stack (compose.preview.yaml) from the checkout,
# checks that GET /api/health through the web server returns status "ok",
# then removes the stack. SMOKE_PORT sets the local web port (default 47190).
set -euo pipefail

environment="${1:-}"
case "$environment" in
  dev | production) ;;
  *)
    echo "usage: $0 dev|production" >&2
    exit 2
    ;;
esac

port="${SMOKE_PORT:-47190}"
project="foreman-smoke-${environment}"
compose=(docker compose -f compose.preview.yaml -p "$project")

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

PREVIEW_PORT="$port" "${compose[@]}" up --detach --build --wait --wait-timeout 300

body="$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${port}/api/health")"
if ! python3 -c 'import json, sys; sys.exit(0 if json.loads(sys.argv[1]).get("status") == "ok" else 1)' "$body"; then
  echo "Foreman ${environment} smoke test failed: GET /api/health returned ${body}" >&2
  exit 1
fi

line="Foreman ${environment} smoke test passed: GET /api/health returned ${body}"
echo "$line"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "### ${line}" >>"$GITHUB_STEP_SUMMARY"
fi

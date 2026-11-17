#!/usr/bin/env bash
# Deploy Foreman to one environment: dev or production (factory ADR 0015).
#
# Foreman runs only on the Operator's Mac (`pnpm dev`), so no host gets a
# deploy. This script records the commit that the environment now holds, and
# the release tag when the commit has one. On production, the Operator runs
# that tag locally.
set -euo pipefail

environment="${1:-}"
case "$environment" in
  dev | production) ;;
  *)
    echo "usage: $0 dev|production" >&2
    exit 2
    ;;
esac

ref="${DEPLOY_REF:-${GITHUB_SHA:-HEAD}}"
sha="$(git rev-parse --verify "${ref}^{commit}")"
tag="$(git tag --points-at "$sha" --list 'v[0-9]*.[0-9]*.[0-9]*' | sort -V | tail -n 1)"

line="Foreman ${environment} holds ${tag:-$ref} (${sha}). Nothing is deployed: Foreman runs on the Operator's Mac."
echo "$line"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "### ${line}" >>"$GITHUB_STEP_SUMMARY"
fi

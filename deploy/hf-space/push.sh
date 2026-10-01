#!/usr/bin/env bash
# Deploys the backend to a Hugging Face Docker Space.
# Usage (Git Bash):  deploy/hf-space/push.sh <hf-username>/<space-name>
# Needs the Hugging Face CLI, logged in:  pip install -U huggingface_hub && hf auth login
set -euo pipefail

SPACE="${1:?usage: deploy/hf-space/push.sh <hf-username>/<space-name>}"
ROOT="$(git rev-parse --show-toplevel)"
HERE="$ROOT/deploy/hf-space"

if ! git -C "$ROOT" diff --quiet HEAD -- apkh-api apkh-search apkh-storage; then
  echo "warning: uncommitted changes in the backend are NOT deployed (only HEAD is)" >&2
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Committed files only, so .env, node_modules and .venv never leave this machine
git -C "$ROOT" archive HEAD apkh-api apkh-search apkh-storage | tar -x -C "$STAGE"
cp "$HERE/Dockerfile" "$HERE/start.sh" "$HERE/README.md" "$STAGE/"

hf upload "$SPACE" "$STAGE" . --repo-type space --delete "*" \
  --commit-message "Deploy $(git -C "$ROOT" rev-parse --short HEAD)"

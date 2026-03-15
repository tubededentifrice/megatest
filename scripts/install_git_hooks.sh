#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root"
git config core.hooksPath .githooks

echo "Installed git hooks via core.hooksPath=.githooks"
echo "Tip: verify with: git config --get core.hooksPath"

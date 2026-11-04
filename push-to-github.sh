#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone "${1:-https://github.com/CavinHuang/cloudplay.git}" "$tmp/repo"
(cd "$root" && tar --exclude=push-to-github.sh --exclude=push-to-github.ps1 -cf - .) | (cd "$tmp/repo" && tar -xf -)
cd "$tmp/repo"
git add -A
if git diff --cached --quiet; then echo 'No changes'; exit 0; fi
git commit -m 'feat: import reviewed CloudPlay v0.12 source and CI workflows'
git push origin HEAD:main

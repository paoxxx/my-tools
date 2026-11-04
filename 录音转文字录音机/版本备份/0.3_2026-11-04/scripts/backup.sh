#!/bin/bash
# 版本备份：bash scripts/backup.sh 备份名（例如 0.1_2026-11-04）
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
NAME="${1:-$(date +%Y-%m-%d_%H-%M-%S)}"
mkdir -p "$DIR/版本备份/$NAME"
cp -R "$DIR/main.js" "$DIR/preload.js" "$DIR/package.json" "$DIR/src" "$DIR/scripts" "$DIR/开发文档.md" "$DIR/版本备份/$NAME/"
echo "已备份到 版本备份/$NAME"

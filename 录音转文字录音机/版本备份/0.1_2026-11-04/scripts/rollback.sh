#!/bin/bash
# 回滚：bash scripts/rollback.sh 备份名
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
B="$DIR/版本备份/$1"
[ -d "$B" ] || { echo "没有这个备份：$1"; ls "$DIR/版本备份"; exit 1; }
cp -R "$B/main.js" "$B/preload.js" "$B/package.json" "$DIR/"
rm -rf "$DIR/src" && cp -R "$B/src" "$DIR/src"
echo "已回滚到 $1，重新打开软件即可"

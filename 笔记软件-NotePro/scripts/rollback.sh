#!/bin/bash
# 版本回退：bash scripts/rollback.sh 版本备份里的文件夹名（不写就列出所有备份）
# 回退前会先把当前版本另存一份到 版本备份/回退前_时间，随时能再回来
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
BK="$DIR/版本备份"
if [ -z "$1" ]; then echo "已有的版本备份："; ls -1 "$BK"; exit 0; fi
SRC="$BK/$1"
[ -d "$SRC" ] || { echo "没找到备份：$1"; ls -1 "$BK"; exit 1; }
NOW="$BK/回退前_$(date +%Y-%m-%d_%H-%M-%S)"
mkdir -p "$NOW"
cp -R "$DIR/main.js" "$DIR/preload.js" "$DIR/docx.js" "$DIR/package.json" "$DIR/src" "$DIR/scripts" "$DIR/开发文档.md" "$NOW/"
for f in main.js preload.js docx.js package.json 开发文档.md; do [ -f "$SRC/$f" ] && cp "$SRC/$f" "$DIR/$f"; done
rm -rf "$DIR/src" && cp -R "$SRC/src" "$DIR/src"
echo "已回退到 $1（当前版本另存在 $(basename "$NOW")）。回到 Note Pro 按 ⌘R 或重新打开即可。"

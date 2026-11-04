#!/bin/bash
# 链接扒稿器 一键安装：Python 环境 → 界面 → 应用程序 → 语音模型
set -e
APP_DIR="$HOME/链接扒稿器"
APP="/Applications/链接扒稿器.app"
PIP_INDEX="https://pypi.tuna.tsinghua.edu.cn/simple"
cd "$APP_DIR"

say() { printf "\n\033[1;31m%s\033[0m\n" "$1"; }

if [ "$(uname -m)" != "arm64" ]; then
  echo "本地转写需要苹果芯片（M1及以上）的 Mac。"; exit 1
fi

# ---------- ① Python 环境 ----------
say "① 准备 Python 环境（第一次会稍慢）"
find_uv() {
  for c in "$(command -v uv 2>/dev/null)" "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv" "$HOME"/Library/Python/*/bin/uv /opt/homebrew/bin/uv; do
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return; }
  done
}
UV="$(find_uv)"
if [ -z "$UV" ] && command -v python3 >/dev/null 2>&1; then
  python3 -m pip install --user -q -i "$PIP_INDEX" uv >/dev/null 2>&1 || true
  UV="$(find_uv)"
fi
if [ -z "$UV" ]; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  UV="$(find_uv)"
fi
[ -z "$UV" ] && { echo "没装上 uv，请把上面的报错截图发给 Claude。"; exit 1; }

export UV_PYTHON_INSTALL_MIRROR="https://registry.npmmirror.com/-/binary/python-build-standalone"
export UV_INDEX_URL="$PIP_INDEX"
[ -x .venv/bin/python ] || "$UV" venv --python 3.12 .venv
"$UV" pip install --python .venv/bin/python -U -r backend/requirements.txt
FF="$(.venv/bin/python -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')"
ln -sf "$FF" .venv/bin/ffmpeg

# ---------- ② 界面 ----------
say "② 安装窗口界面"
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install --registry=https://registry.npmmirror.com --no-audit --no-fund

# ---------- ③ 放进应用程序 ----------
say "③ 放进“应用程序”文件夹"
rm -rf "$APP"
cp -R node_modules/electron/dist/Electron.app "$APP"
STUB="$APP/Contents/Resources/app"
mkdir -p "$STUB"
cat > "$STUB/package.json" <<'JSON'
{ "name": "link-transcriber", "productName": "链接扒稿器", "version": "1.0.0", "main": "main.js" }
JSON
cat > "$STUB/main.js" <<'JS'
require(require('path').join(require('os').homedir(), '链接扒稿器', 'main.js'));
JS
cp assets/icon.icns "$APP/Contents/Resources/electron.icns"
PL="$APP/Contents/Info.plist"
plutil -replace CFBundleName -string "链接扒稿器" "$PL"
plutil -replace CFBundleDisplayName -string "链接扒稿器" "$PL"
plutil -replace CFBundleIdentifier -string "com.laobob.link-transcriber" "$PL"
xattr -cr "$APP" 2>/dev/null || true
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "（签名跳过，不影响使用）"
touch "$APP"

VAULT="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes"
if [ -d "$VAULT" ]; then mkdir -p "$VAULT/22-博主逐字稿"; else echo "没找到 Obsidian 仓库 Notes，打开软件后点底部“更改”选保存位置。"; fi

# ---------- ④ 语音模型 ----------
say "④ 下载语音模型（约1GB，只需一次；中断了也没关系，第一次扒稿时会自动续上）"
.venv/bin/python backend/extract.py --warmup || echo "模型没下完，第一次扒稿时会自动继续下载。"

say "装好了！在启动台或“应用程序”里打开“链接扒稿器”。"
open "$APP"

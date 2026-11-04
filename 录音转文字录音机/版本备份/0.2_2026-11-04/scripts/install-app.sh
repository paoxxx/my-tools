#!/bin/bash
# 把“录音机”装进应用程序。代码仍然放在本文件夹，以后更新代码不用重装。
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="/Applications/录音机.app"
ZIP="$(ls "$DIR"/build/electron-v*-darwin-arm64.zip 2>/dev/null | head -1)"
SRC_APP="$DIR/node_modules/electron/dist/Electron.app"

if [ ! -d "$DIR/node_modules/ws" ]; then
  echo "缺少 ws 依赖，正在安装……"
  (cd "$DIR" && npm install ws)
fi

echo "正在安装到：$APP"
rm -rf "$APP"
if [ -n "$ZIP" ]; then
  TMPX="$(mktemp -d)"
  ditto -xk "$ZIP" "$TMPX"
  mv "$TMPX/Electron.app" "$APP"
  rm -rf "$TMPX"
elif [ -d "$SRC_APP" ]; then
  cp -R "$SRC_APP" "$APP"
else
  echo "没找到 Electron 运行库，请把这段提示发给 Claude"
  exit 1
fi
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/Recorder"

PL="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
plutil -replace CFBundleExecutable -string "Recorder" "$PL"
plutil -replace CFBundleName -string "录音机" "$PL"
plutil -replace CFBundleDisplayName -string "录音机" "$PL"
$PB -c "Set :CFBundleIdentifier com.laobob.luyinji" "$PL"
$PB -c "Delete :NSMicrophoneUsageDescription" "$PL" 2>/dev/null || true
$PB -c "Add :NSMicrophoneUsageDescription string 用于录音和转写文字" "$PL"

# 启动入口：指向本文件夹的代码
mkdir -p "$APP/Contents/Resources/app"
cat > "$APP/Contents/Resources/app/package.json" <<EOF
{ "name": "luyinji", "productName": "录音机", "main": "boot.js" }
EOF
cat > "$APP/Contents/Resources/app/boot.js" <<EOF
require("$DIR/main.js");
EOF
rm -f "$APP/Contents/Resources/default_app.asar"

# 图标
if [ -f "$DIR/build/icon.png" ]; then
  TMP="$(mktemp -d)/icon.iconset"
  mkdir -p "$TMP"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$DIR/build/icon.png" --out "$TMP/icon_${s}x${s}.png" >/dev/null
    d=$((s*2))
    sips -z $d $d "$DIR/build/icon.png" --out "$TMP/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$TMP" -o "$APP/Contents/Resources/electron.icns"
fi

# 重新签名（Apple 芯片必须有签名才能打开）
codesign --force --deep --sign - "$APP"
xattr -cr "$APP" 2>/dev/null || true
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" 2>/dev/null || true

killall Dock 2>/dev/null || true
echo "装好了！在“应用程序”里双击“录音机”就能打开。第一次录音时系统会问麦克风权限，点“好”。"

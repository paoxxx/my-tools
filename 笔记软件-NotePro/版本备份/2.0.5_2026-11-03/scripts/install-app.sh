#!/bin/bash
# 把 Note Pro（原“笔记软件”）装进“应用程序”。代码仍然放在本文件夹，以后更新代码不用重装。
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="/Applications/Note Pro.app"
OLD="/Applications/笔记软件.app"
ZIP="$(ls "$DIR"/build/electron-v*-darwin-arm64.zip 2>/dev/null | head -1)"
SRC_APP="$DIR/node_modules/electron/dist/Electron.app"

echo "正在安装到：$APP"
rm -rf "$APP"
# 改名前装过的旧版本一并去掉，免得应用程序里出现两个
[ -d "$OLD" ] && rm -rf "$OLD"
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
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/Note Pro"

PL="$APP/Contents/Info.plist"
plutil -replace CFBundleExecutable -string "Note Pro" "$PL"
plutil -replace CFBundleName -string "Note Pro" "$PL"
plutil -replace CFBundleDisplayName -string "Note Pro" "$PL"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.laobob.biji" "$PL"

# 让访达“打开方式”里出现 Note Pro：字体文件、zip 压缩包（只是备选，不改系统默认）
PB=/usr/libexec/PlistBuddy
$PB -c "Delete :CFBundleDocumentTypes" "$PL" 2>/dev/null || true
$PB -c "Add :CFBundleDocumentTypes array" "$PL"
$PB -c "Add :CFBundleDocumentTypes:0 dict" "$PL"
$PB -c "Add :CFBundleDocumentTypes:0:CFBundleTypeName string 字体文件" "$PL"
$PB -c "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer" "$PL"
$PB -c "Add :CFBundleDocumentTypes:0:LSHandlerRank string Alternate" "$PL"
$PB -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes array" "$PL"
i=0
for t in public.font public.truetype-ttf-font public.opentype-font public.truetype-collection-font org.w3.woff org.w3.woff2 com.pkware.zip-archive public.zip-archive; do
  $PB -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:$i string $t" "$PL"
  i=$((i+1))
done

# 启动入口：指向本文件夹的代码
mkdir -p "$APP/Contents/Resources/app"
cat > "$APP/Contents/Resources/app/package.json" <<EOF
{ "name": "biji-ruanjian", "productName": "Note Pro", "main": "boot.js" }
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

# 让程序坞、访达马上换成新图标
killall Dock 2>/dev/null || true
echo "装好了！在“应用程序”里双击“Note Pro”就能打开。"

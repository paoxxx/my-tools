#!/bin/bash
# 把快捷粘贴打包成 Mac 应用，放进“应用程序”文件夹
# 以后改了代码，再跑一次这个脚本就会覆盖成新版本
set -e
cd "$(dirname "$0")"

APP_NAME="快捷粘贴"
OUT="dist/${APP_NAME}-darwin-arm64/${APP_NAME}.app"

# 国内下载 Electron 走镜像，避免卡住
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

echo "① 安装打包工具（首次会慢一点）"
[ -d node_modules/@electron/packager ] || npm install -D @electron/packager

echo "② 打包成 ${APP_NAME}.app"
npx @electron/packager . "$APP_NAME" \
  --platform=darwin --arch=arm64 \
  --out=dist --overwrite \
  --app-bundle-id=com.bob.kuaijieniantie \
  --executable-name=KuaijieNiantie \
  --icon=icon.icns \
  --ignore="^/dist" --ignore="build-app.sh"

echo "③ 本机签名（M1 芯片要求，否则打不开）"
codesign --force --deep -s - "$OUT"

echo "④ 放进“应用程序”"
osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
rm -rf "/Applications/${APP_NAME}.app"
cp -R "$OUT" /Applications/
# 刷新图标缓存，新图标立刻生效
touch "/Applications/${APP_NAME}.app"
killall Dock >/dev/null 2>&1 || true

echo "完成！以后在启动台或“应用程序”里直接点“${APP_NAME}”就行"
open "/Applications/${APP_NAME}.app"

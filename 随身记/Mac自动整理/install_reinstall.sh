#!/bin/bash
# 随身记·每周自动重装（免费签名每7天到期，这个程序帮你自动续上）
# 每天凌晨3点检查一次：周日照常重装；如果周日没装成功，之后每天凌晨3点再试，直到成功
set -e
DEST="$HOME/Library/Application Support/SuiShenJi"
PLIST="$HOME/Library/LaunchAgents/com.laobob.suishenji.reinstall.plist"
mkdir -p "$DEST" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$DEST/reinstall.sh" <<'RUN'
#!/bin/bash
PROJ="$HOME/Projects/随身记"
BUILD="$HOME/Library/Caches/SuiShenJiBuild"
LOG="$HOME/Library/Logs/随身记重装.log"
STATE="$HOME/Library/Application Support/SuiShenJi/reinstall_last_ok"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
notify() { osascript -e "display notification \"$1\" with title \"随身记\"" >/dev/null 2>&1 || true; }

if [ "$1" != "--now" ]; then
  last=$(cat "$STATE" 2>/dev/null || echo 0)
  age=$(( ($(date +%s) - last) / 86400 ))
  dow=$(date +%u)   # 7 = 周日
  if [ "$dow" = "7" ] && [ $age -lt 1 ]; then exit 0; fi
  if [ "$dow" != "7" ] && [ $age -lt 6 ]; then exit 0; fi
fi

cd "$PROJ" 2>/dev/null || { log "找不到项目文件夹：$PROJ"; notify "自动重装失败：找不到项目文件夹"; exit 1; }
log "开始编译"
if ! xcodebuild -quiet -project SuiShenJi.xcodeproj -target SuiShenJi -configuration Debug -sdk iphoneos \
     -allowProvisioningUpdates SYMROOT="$BUILD" build >> "$LOG" 2>&1; then
  log "编译失败"; notify "自动重装失败：编译出错，明天凌晨3点再试"; exit 1
fi
APP="$BUILD/Debug-iphoneos/SuiShenJi.app"

# 找到已配对的iPhone（同一个Wi-Fi下也能找到）
TMP=$(mktemp)
xcrun devicectl list devices --json-output "$TMP" >/dev/null 2>&1
DEV=$(/usr/bin/python3 - "$TMP" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    for x in d.get("result", {}).get("devices", []):
        hw = x.get("hardwareProperties", {})
        cp = x.get("connectionProperties", {})
        if hw.get("deviceType") == "iPhone" and cp.get("pairingState") == "paired":
            print(x.get("identifier", "")); break
except Exception:
    pass
PY
)
rm -f "$TMP"
if [ -z "$DEV" ]; then
  log "没找到iPhone（不在同一个Wi-Fi，或者没打开无线连接）"; notify "自动重装失败：没找到手机，明天凌晨3点再试"; exit 1
fi

if xcrun devicectl device install app --device "$DEV" "$APP" >> "$LOG" 2>&1; then
  date +%s > "$STATE"
  log "重装成功，签名又续了7天"; notify "已自动重新安装，签名又续了7天"
else
  log "安装失败"; notify "自动重装失败：安装出错，明天凌晨3点再试"; exit 1
fi
RUN
chmod +x "$DEST/reinstall.sh"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.laobob.suishenji.reinstall</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$DEST/reinstall.sh</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/随身记重装.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/随身记重装.log</string>
</dict>
</plist>
PL
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "安装完成：每周日凌晨3点自动重装，失败了之后每天凌晨3点再试。"
echo "现在先手动跑一次，测试能不能装上（手机解锁、连同一个Wi-Fi）……"
bash "$DEST/reinstall.sh" --now && echo "测试成功！" || { echo "测试失败，记录如下："; tail -15 "$HOME/Library/Logs/随身记重装.log"; }

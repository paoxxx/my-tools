#!/bin/bash
# 随身记·Mac后台自动整理 安装脚本
# macOS不让后台的命令行程序读iCloud里的文件，所以把整理程序包成一个小App（SuiShenJiOrganizer），
# 由它去运行，你只需给它授权一次。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/SuiShenJi"
APP="$DEST/SuiShenJiOrganizer.app"
PLIST="$HOME/Library/LaunchAgents/com.laobob.suishenji.organizer.plist"
VAULT="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/1.日记和待办/随身记"
mkdir -p "$DEST" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$DIR/organize.py" "$DEST/organize.py"

CLAUDE_BIN="$(command -v claude || true)"
if [ -z "$CLAUDE_BIN" ]; then
  echo "没找到claude命令，请先确认Claude Code已经装好（终端里输入 claude 能打开）。"
  exit 1
fi
CLAUDE_DIR="$(dirname "$CLAUDE_BIN")"

# 1. 生成小App：它只做一件事，运行organize.py
cat > "$DEST/run.sh" <<RUN
#!/bin/bash
export PATH="$CLAUDE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export LANG=zh_CN.UTF-8
exec /usr/bin/python3 "$DEST/organize.py" "\$@" >> "$HOME/Library/Logs/随身记整理-输出.log" 2>&1
RUN
chmod +x "$DEST/run.sh"
rm -rf "$APP"
osacompile -o "$APP" -e "do shell script quoted form of \"$DEST/run.sh\""
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.laobob.suishenji.organizer.app" "$APP/Contents/Info.plist" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.laobob.suishenji.organizer.app" "$APP/Contents/Info.plist"
codesign --force --deep -s - "$APP" 2>/dev/null || true

# 2. 后台定时：开机运行、收件箱有变化马上运行、每分钟兜底
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.laobob.suishenji.organizer</string>
  <key>ProgramArguments</key>
  <array>
    <string>$APP/Contents/MacOS/applet</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>60</integer>
  <key>WatchPaths</key>
  <array>
    <string>$VAULT/.收件箱</string>
  </array>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/随身记整理-输出.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/随身记整理-输出.log</string>
</dict>
</plist>
PL

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo ""
echo "安装完成。接下来要给SuiShenJiOrganizer授权一次："
echo "  如果马上弹窗问能否访问iCloud云盘里的文件，点“允许”。"
echo "  如果没弹窗，就打开：系统设置→隐私与安全性→完全磁盘访问权限，"
echo "  点“＋”，按 Command＋Shift＋G 粘贴下面这个路径，选中SuiShenJiOrganizer，打开开关："
echo "  $DEST"
open -R "$APP"

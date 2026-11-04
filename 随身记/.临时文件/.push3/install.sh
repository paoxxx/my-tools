#!/bin/bash
# 随身记·Mac后台自动整理 安装脚本（只需运行一次）
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/SuiShenJi"
PLIST="$HOME/Library/LaunchAgents/com.laobob.suishenji.organizer.plist"
mkdir -p "$DEST" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/1.日记和待办/随身记/.收件箱"
cp "$DIR/organize.py" "$DEST/organize.py"

CLAUDE_BIN="$(command -v claude || true)"
if [ -z "$CLAUDE_BIN" ]; then
  echo "没找到claude命令，请先确认Claude Code已经装好（终端里输入 claude 能打开）。"
  exit 1
fi
CLAUDE_DIR="$(dirname "$CLAUDE_BIN")"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.laobob.suishenji.organizer</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$DEST/organize.py</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$CLAUDE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>LANG</key><string>zh_CN.UTF-8</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>60</integer>
  <key>WatchPaths</key>
  <array>
    <string>$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/1.日记和待办/随身记/.收件箱</string>
    <string>$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/1.日记和待办/随身记/_收件箱</string>
  </array>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/随身记整理-输出.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/随身记整理-输出.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "安装完成：开机自动运行，手机录音到达后马上合并，每分钟检查一次。"
echo "运行记录在：~/Library/Logs/随身记整理.log"

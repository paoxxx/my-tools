#!/bin/bash
# 链接扒稿器 依赖更新：装新版识别库并下载 SenseVoice 模型
set -e
cd "$HOME/链接扒稿器"
PIP_INDEX="https://pypi.tuna.tsinghua.edu.cn/simple"
say() { printf "\n\033[1;31m%s\033[0m\n" "$1"; }
for c in "$(command -v uv 2>/dev/null)" "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv" "$HOME"/Library/Python/*/bin/uv /opt/homebrew/bin/uv; do
  [ -n "$c" ] && [ -x "$c" ] && { UV="$c"; break; }
done
[ -z "$UV" ] && { echo "没找到 uv，请重新运行一次完整安装命令。"; exit 1; }
say "① 安装新的识别库（几分钟）"
"$UV" pip install --python .venv/bin/python -i "$PIP_INDEX" -U -r backend/requirements.txt
FF="$(.venv/bin/python -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')"
ln -sf "$FF" .venv/bin/ffmpeg
say "② 下载 SenseVoice 语音模型（约1GB，国内源）"
.venv/bin/python backend/extract.py --warmup || echo "模型没下完，第一次扒稿时会自动继续下载。"
say "更新完成，正在重新打开链接扒稿器。"
open -a 链接扒稿器

#!/usr/bin/env python3
"""
ElevenLabs 逐字稿一键配音 · B版（新音色专用，从零重写）

用法：
  复制逐字稿 → 终端输入 ttsb → 回车
  生成后自动弹出访达并选中新文件，按空格就能听。
  输出：~/Downloads/AI配音/ 时间命名的 m4a

B版思路：
  旧版V7是针对旧音色一点点打补丁调出来的，规则很多；B版只保留最核心的一条：
  按标点把停顿“对齐”到目标值，太短就补长，太长就缩短。
  先把停顿调对，再一项一项往上加，不提前堆规则。

只用 Mac 自带的 python3，不需要装任何软件。
"""

import os
import re
import sys
import json
import time
import math
import wave
import array
import random
import base64
import subprocess
import urllib.request
import urllib.error

# ===================== 可调参数（主要改这里） =====================
VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID_B", "eSExYuIWxPiiQtxJNL8c")   # 新音色
MODEL_ID = "eleven_v4"
LANGUAGE_CODE = "zh"
VOICE_SETTINGS = {
    "stability": 0.5,          # v4只认 0 / 0.5 / 1 三档；0.5＝Natural
    "similarity_boost": 0.75,
    "use_speaker_boost": False,
    "speed": 1.0,              # 整体语速；v4可能忽略
}

# 停顿目标（秒）：说完一个字到下一个字开口之间的空档
GAP_PARAGRAPH = 0.85   # 换段（自然段之间）
GAP_PERIOD = 0.70      # 句号、问号、感叹号、分号
GAP_COMMA = 0.35       # 逗号、冒号
GAP_DUNHAO = 0.18      # 顿号
GAP_ENDING = 0.60      # “考生作答完毕”前
GAP_JITTER = 0.08      # 每处停顿随机浮动±8%，避免像机器打拍子

LEAD_RANGE = (0.25, 0.6)   # 开口前的安静时长（秒），每次随机

# 音量
TARGET_LEVEL = -23     # 平均音量（dB）；语音备忘录波形太高就调小（更负）
PEAK_LIMIT = -1.5      # 只防破音，不压缩起伏

OUT_DIR = os.path.expanduser("~/Downloads/AI配音")
SAMPLE_RATE = 24000
# =================================================================

API_KEY = os.environ.get("ELEVENLABS_API_KEY")
PUNCT = set("。！？；!?;，,：:、“”‘’\"'（）()…—《》")
QUIET_DB = 25          # 比说话音量低这么多分贝才算安静，只在安静处剪接
MIN_QUIET_MS = 40      # 至少40毫秒的安静才动刀
FADE_MS = 6


# ---------------- 调用 API ----------------
def generate(text):
    body = {"text": text, "model_id": MODEL_ID, "voice_settings": VOICE_SETTINGS,
            "seed": random.randint(1, 10**6)}
    if LANGUAGE_CODE:
        body["language_code"] = LANGUAGE_CODE
    url = (f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}/with-timestamps"
           f"?output_format=pcm_{SAMPLE_RATE}")
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={"xi-api-key": API_KEY, "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{e.code} {e.read().decode('utf-8', 'ignore')}")
    return base64.b64decode(data["audio_base64"]), data.get("alignment")


# ---------------- 文本 ----------------
def read_text(source_file=None):
    if source_file:
        with open(source_file, encoding="utf-8") as f:
            return f.read()
    try:
        return subprocess.run(["pbpaste"], capture_output=True, check=True).stdout.decode("utf-8")
    except (OSError, subprocess.CalledProcessError):
        sys.exit("读不到剪贴板，请用：ttsb 稿子.txt")


def prepare(raw_text):
    """去空行，自然段合并成一整段送给AI；记下每个自然段的起点，用于换段停顿。"""
    lines = [x.strip() for x in raw_text.splitlines() if x.strip()]
    lines = [re.sub(r"考生[\s，,。]*作答[\s，,。]*完毕", "考生作答完毕", x) for x in lines]
    para_starts, k = set(), 0
    for ln in lines[:-1]:
        k += len(ln)
        para_starts.add(k)
    return "".join(lines), para_starts


def match_alignment(align, text):
    """确认时间戳和原文一一对应；对不上就不修停顿（宁可不改，也不切到字）。"""
    if not align:
        return None
    chars = align.get("characters")
    st = align.get("character_start_times_seconds")
    en = align.get("character_end_times_seconds")
    if not chars or not st or not en or "".join(chars) != text:
        return None
    return st, en


# ---------------- 音频处理 ----------------
def to_samples(raw):
    a = array.array("h")
    a.frombytes(raw[: len(raw) // 2 * 2])
    if sys.byteorder == "big":
        a.byteswap()
    return a


def frame_db(a, f):
    out = []
    for i in range(len(a) // f):
        chunk = a[i * f:(i + 1) * f]
        rms = math.sqrt(sum(x * x for x in chunk) / f) or 1e-9
        out.append(20 * math.log10(rms / 32768))
    return out


def gap_target(text, prev, nxt, para_starts):
    between = text[prev + 1:nxt]
    if text.startswith("考生作答完毕", nxt):
        return GAP_ENDING
    if nxt in para_starts:
        return GAP_PARAGRAPH
    if any(c in "。！？；!?;" for c in between):
        return GAP_PERIOD
    if any(c in "，,：:" for c in between):
        return GAP_COMMA
    if "、" in between:
        return GAP_DUNHAO
    return None   # 字与字之间没有标点：不动


def shape_pauses(raw, text, st, en, para_starts):
    f = SAMPLE_RATE // 100   # 10毫秒一帧
    dbs = frame_db(raw, f)
    if not dbs:
        return raw, 0, 0
    quiet = sorted(dbs)[int(len(dbs) * 0.8)] - QUIET_DB
    min_frames = max(1, MIN_QUIET_MS // 10)
    speech = [k for k, ch in enumerate(text) if ch not in PUNCT and not ch.isspace()]
    edits, longer, shorter = [], 0, 0

    for prev, nxt in zip(speech, speech[1:]):
        target = gap_target(text, prev, nxt, para_starts)
        if target is None:
            continue
        target *= random.uniform(1 - GAP_JITTER, 1 + GAP_JITTER)
        gap = st[nxt] - en[prev]
        if gap <= 0:
            continue
        delta = target - gap
        if abs(delta) < 0.03:
            continue
        # 在两个字之间找最长的一段真安静，只在这里加减时长（前后各让出20毫秒保护字音）
        f0 = max(0, int((en[prev] + 0.02) * 100))
        f1 = min(len(dbs), int((st[nxt] - 0.02) * 100))
        best, begin = None, None
        for k in range(f0, f1 + 1):
            q = k < f1 and dbs[k] < quiet
            if q and begin is None:
                begin = k
            elif not q and begin is not None:
                if k - begin >= min_frames and (best is None or k - begin > best[1] - best[0]):
                    best = (begin, k)
                begin = None
        if not best:
            continue
        s, e = best
        cur = (e - s) * f
        new_len = max(int(MIN_QUIET_MS / 1000 * SAMPLE_RATE), cur + int(delta * SAMPLE_RATE))
        if new_len == cur:
            continue
        edits.append((s * f, e * f, new_len))
        if new_len > cur:
            longer += 1
        else:
            shorter += 1

    fade = int(SAMPLE_RATE * FADE_MS / 1000)
    out, pos = array.array("h"), 0
    for a0, a1, need in sorted(edits):
        if a0 < pos:
            continue
        out.extend(raw[pos:a0])
        seg = array.array("h", raw[a0:a1])
        half = len(seg) // 2
        left, right = seg[:half], seg[half:]
        n = min(fade, len(left), len(right))
        for j in range(n):                       # 切口两边轻淡出淡入，防咔哒声
            left[len(left) - n + j] = int(left[len(left) - n + j] * (1 - (j + 1) / n))
            right[j] = int(right[j] * ((j + 1) / n))
        if need > len(seg):
            left.extend(array.array("h", [0] * (need - len(seg))))
            left.extend(right)
            out.extend(left)
        else:
            keep_l = need // 2
            keep_r = need - keep_l
            out.extend(left[:keep_l])
            out.extend(right[len(right) - keep_r:])
        pos = a1
    out.extend(raw[pos:])
    return out, longer, shorter


def trim_and_pad(a):
    """去掉开头结尾多余静音；开头随机留一点安静，结尾自然淡出。"""
    f = SAMPLE_RATE // 100
    dbs = frame_db(a, f)
    voiced = [i for i, d in enumerate(dbs) if d > -42]
    if not voiced:
        return a
    first, last = voiced[0], voiced[-1]
    body = a[first * f:(last + 1) * f]
    tail = array.array("h", a[(last + 1) * f:(last + 1) * f + int(0.8 * SAMPLE_RATE)])
    n = len(tail)
    for k in range(n):
        tail[k] = int(tail[k] * (1 - k / n) ** 2)
    lead = array.array("h", [0] * int(random.uniform(*LEAD_RANGE) * SAMPLE_RATE))
    end_pad = array.array("h", [0] * max(0, int(1.2 * SAMPLE_RATE) - n))
    return lead + body + tail + end_pad


def normalize(samples):
    voiced = [x for x in samples if abs(x) > 300]
    if not voiced:
        return samples
    rms = math.sqrt(sum(x * x for x in voiced) / len(voiced))
    gain = 32768 * 10 ** (TARGET_LEVEL / 20) / rms
    limit = 32767 * 10 ** (PEAK_LIMIT / 20)
    knee = limit * 0.9
    room = limit - knee
    out = array.array("h")
    for x in samples:
        y = x * gain
        m = abs(y)
        if m > knee:
            m = knee + room * math.tanh((m - knee) / room)
            y = m if y > 0 else -m
        out.append(int(y))
    return out


def save_m4a(samples, stamp):
    os.makedirs(OUT_DIR, exist_ok=True)
    wav_path = os.path.join(OUT_DIR, f"{stamp}.wav")
    m4a_path = os.path.join(OUT_DIR, f"{stamp}.m4a")
    with wave.open(wav_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        data = array.array("h", samples)
        if sys.byteorder == "big":
            data.byteswap()
        w.writeframes(data.tobytes())
    for cmd in (["afconvert", "-f", "m4af", "-d", "aac@44100", "-b", "128000", wav_path, m4a_path],
                ["afconvert", "-f", "m4af", "-d", "aac", wav_path, m4a_path]):
        try:
            subprocess.run(cmd, check=True, capture_output=True)
            if os.path.getsize(m4a_path) > 0:
                os.remove(wav_path)
                return m4a_path
        except (OSError, subprocess.CalledProcessError):
            continue
    print("⚠️ 转m4a失败，暂时保留wav")
    return wav_path


def show_credits():
    try:
        req = urllib.request.Request("https://api.elevenlabs.io/v1/user/subscription",
                                     headers={"xi-api-key": API_KEY})
        with urllib.request.urlopen(req, timeout=15) as r:
            sub = json.loads(r.read())
        used, limit = sub["character_count"], sub["character_limit"]
        print(f"本月额度：已用 {used}，剩余 {limit - used}")
    except Exception:
        pass


# ---------------- 主流程 ----------------
def main():
    if not API_KEY:
        sys.exit("请先设置 ELEVENLABS_API_KEY")
    args = sys.argv[1:]
    text, para_starts = prepare(read_text(args[0] if args else None))
    if not text:
        sys.exit("稿子是空的：先复制逐字稿，再运行 ttsb")
    stamp = time.strftime("%Y-%m-%d_%H-%M-%S")
    print(f"B版｜音色 {VOICE_ID}｜整篇 {len(text)} 字，{len(para_starts) + 1} 个自然段")
    print(f"停顿目标：换段 {GAP_PARAGRAPH}｜句号 {GAP_PERIOD}｜逗号 {GAP_COMMA}｜顿号 {GAP_DUNHAO} 秒")
    try:
        raw_bytes, align = generate(text)
    except Exception as e:
        sys.exit(f"生成失败：{e}")
    raw = to_samples(raw_bytes)
    times = match_alignment(align, text)
    if times:
        raw, longer, shorter = shape_pauses(raw, text, times[0], times[1], para_starts)
        print(f"停顿调整：补长 {longer} 处，缩短 {shorter} 处")
    else:
        print("⚠️ 时间戳和原文对不上，这次没调停顿（音频是AI原样）")
    audio = normalize(trim_and_pad(raw))
    path = save_m4a(audio, stamp)
    print(f"完成：{os.path.basename(path)}（{len(audio) / SAMPLE_RATE:.1f} 秒）")
    show_credits()
    subprocess.run(["open", "-R", path])


if __name__ == "__main__":
    main()

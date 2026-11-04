#!/usr/bin/env python3
"""
ElevenLabs 逐字稿一键配音（老Bob专用）

用法（装好后）：
  复制逐字稿 → 终端输入 tts → 回车
  所有自然段自动合并成一大段，整篇一次生成一版；不满意再运行一次 tts
  输出到 ~/Downloads/AI配音/ 的时间命名 m4a，不弹出访达

停顿处理：
  整段一次生成，保持语气连贯；
  有逐字时间戳时按标点调整停顿，只处理 >=40ms 的安全安静区；
  仅修改送给AI的配音稿，不改正式原文；命令加“预览”可免费查看标签和标点。
不需要安装任何额外软件，只用 Mac 自带的 python3。
"""

import os
import re
import sys
import time
import json
import wave
import math
import array
import urllib.request
import urllib.error
import random
import subprocess
import difflib

# ===================== 可调参数（主要改这里） =====================
LANGUAGE_CODE = "zh"

# 每个方案：方案名、模型、voice_settings
# v4 的 stability 只认 0（Creative）、0.5（Natural）、1（Robust）三档
PRESETS = [
    ("A", "eleven_v4", {          # Natural档：自然讲述（定版）
        "stability": 0.5, "similarity_boost": 0.75,
        "use_speaker_boost": False, "speed": 1.0}),
]

# 停顿（单位：秒）
PAUSE_RATIO = 1.0    # 停顿按比例缩短：0.8＝每处停顿缩到原来的八成；1.0＝不动
MAX_PAUSE = 0.6      # 最长停顿；段落之间也不超过这个，避免听着像答完了

# 随机微调：每次生成在小范围内随机，避免每条视频听起来一模一样；False＝关闭
RANDOM_VARIATION = True
TALK_MODE = False
SPEED_RANGE = (1.0, 1.05)       # 语速（停顿另外控制，语速本身不用太快）
PAUSE_RANGE = (0.5, 0.7)        # 最长停顿（秒）
# 开头随机：开口前留多久，以及开口前随机带一口吸气/呼气声（像真人张嘴前换口气）
LEAD_RANGE = (0.25, 0.8)        # 开口前的安静时长（秒）

# 按标点控制停顿（秒）：有了时间戳就按这里来，比统一压停顿更像真人换气
# 数值参照老Bob真人答题录音（2026-08-28）实测：句中停顿约0.3～0.45秒，句末约0.5～0.7秒，换段约0.8～1.2秒
GAP_PARAGRAPH = 0.85    # 换段（一是、二是、首先、其次……开始前）
GAP_PERIOD = 0.58       # 句号、问号、感叹号、分号：留出换气
GAP_COMMA = 0.33        # 逗号、冒号
GAP_DUNHAO = 0.15       # 顿号
GAP_ORDINAL = 0.2       # 序号后面没有标点时，序号说完轻轻一顿（一是｜要摆正心态）
GAP_ENDING = 0.4        # “考生作答完毕”前面，连贯收尾不拖时间
QUIET_DB = 25           # 比说话平均音量低这么多分贝，才算安静，只在安静处剪接（避免卡顿、杂音）
XFADE_MS = 8            # 剪接处的交叉淡化，消除咔哒声
GAP_JITTER = 0.15       # 每处停顿上下随机浮动的比例，避免机械感
ORDINALS = ["一是", "二是", "三是", "四是", "五是", "首先", "其次", "再次", "之后", "然后", "最后",
            "第一", "第二", "第三", "第四", "一方面", "另一方面"]
OPENING_TAGS = [""]             # 开头不加吸气、呼气声（老Bob反馈有吐气声不自然）
# 讲解语气：命令后面加“交流”时启用，例如 tts 交流（亲和、尊重，像给考官讲解，不是演讲或说书）
TALK_TAG = "[warmly]"

# 考场答题模式：固定音色，轻量语气指导；只修改送给AI的配音文本。
# 可用模式：考场（默认）、交流（原来的warmly）、原版（不加标签/不优化长句）。
DEFAULT_MODE = "考场"
LONG_SENTENCE_CHARS = 68   # 超过此长度，才考虑在安全的语义转折处重划句号
LONG_CLAUSE_CHARS = 40     # 极长无标点分句：仅在明确转折词前补逗号
MAX_TONE_TAGS = 4         # 整篇最多4个，避免一直换腔调
MIN_TAG_DISTANCE = 110    # 标签间至少隔110个字符，避免表演感
EXAM_TAGS = {
    "opening": "[calm, confident, conversational]",
    "thought": "[thoughtful]",
    "example": "[explaining naturally]",
    "conviction": "[with quiet confidence]",
    "closing": "[sincerely]",
}
MIN_PAUSE = 0.12     # 短于这个的停顿不动它（保留自然的小气口）
SILENCE_DB = -42     # 低于这个音量算静音；换气声被剪掉了就调成 -48

# 逐句生成时才用到
COMMA_GAP = 0.20
PERIOD_GAP = 0.45
PER_SENTENCE = False # False：整段一次生成，语气最连贯（推荐）；True：逐句生成

TAKES = 1            # 整篇生成几版；1＝只出一版

# 音量（单位：dB）
TARGET_LEVEL = -23   # 说话时的平均音量；语音备忘录波形太高就调小（更负），太矮就调大
PEAK_LIMIT = -1.5    # 只防破音，不压缩起伏，波形保持有高有低

# 额度提醒
MONTHLY_CREDITS = 40000   # 每月总额度
WARN_RATIO = 0.8          # 用到八成时提醒
RESET_DAY = 28            # 每月28号重置（订阅日是10月28日）

SAMPLE_RATE = 24000
OUT_DIR = os.path.expanduser("~/Downloads/AI配音")      # 音频直接放这里，不建子文件夹
DATA_DIR = os.path.join(OUT_DIR, ".data")              # 单段重做要用的数据（隐藏文件夹）
# ================================================================

API_KEY = os.environ.get("ELEVENLABS_API_KEY")
VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID")
FRAME = SAMPLE_RATE // 100          # 10 毫秒一帧
SENTENCE_END = "。！？!?"


# ---------------- 调用 API ----------------
def _post(body):
    url = (f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
           f"?output_format=pcm_{SAMPLE_RATE}")
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"xi-api-key": API_KEY, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def tts_pcm(text, model_id, settings, seed, prev_text="", next_text=""):
    body = {"text": text, "model_id": model_id,
            "voice_settings": settings, "seed": seed}
    if LANGUAGE_CODE:
        body["language_code"] = LANGUAGE_CODE
    if prev_text:
        body["previous_text"] = prev_text
    if next_text:
        body["next_text"] = next_text
    try:
        return _post(body)
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", "ignore")
        # 模型不支持前后文参数时，去掉再试一次
        if ("previous_text" in body or "next_text" in body) and e.code in (400, 422):
            body.pop("previous_text", None)
            body.pop("next_text", None)
            try:
                return _post(body)
            except urllib.error.HTTPError as e2:
                msg = e2.read().decode("utf-8", "ignore")
                raise RuntimeError(f"{e2.code} {msg}")
        raise RuntimeError(f"{e.code} {msg}")


def tts_with_times(text, model_id, settings, seed, prev_text="", next_text=""):
    """带时间戳生成：返回 (音频字节, 每个字的开始/结束时间)。时间戳用来定位每一段，方便单独重做某一段。"""
    import base64
    body = {"text": text, "model_id": model_id,
            "voice_settings": settings, "seed": seed}
    if LANGUAGE_CODE:
        body["language_code"] = LANGUAGE_CODE
    if prev_text:
        body["previous_text"] = prev_text
    if next_text:
        body["next_text"] = next_text
    url = (f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}/with-timestamps"
           f"?output_format=pcm_{SAMPLE_RATE}")

    def call(b):
        req = urllib.request.Request(
            url, data=json.dumps(b).encode("utf-8"),
            headers={"xi-api-key": API_KEY, "Content-Type": "application/json"},
            method="POST")
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read())

    try:
        data = call(body)
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", "ignore")
        if ("previous_text" in body or "next_text" in body) and e.code in (400, 422):
            body.pop("previous_text", None)
            body.pop("next_text", None)
            try:
                data = call(body)
            except urllib.error.HTTPError as e2:
                raise RuntimeError(f"{e2.code} {e2.read().decode('utf-8', 'ignore')}")
        else:
            # 带时间戳的接口不可用时，退回普通接口（只是不能单段重做）
            return tts_pcm(text, model_id, settings, seed, prev_text, next_text), None
    return base64.b64decode(data["audio_base64"]), data.get("alignment")


# ---------------- 音频处理 ----------------
def to_samples(raw):
    a = array.array("h")
    a.frombytes(raw[: len(raw) // 2 * 2])
    if sys.byteorder == "big":
        a.byteswap()
    return a


def silent_flags(a):
    flags = []
    for i in range(len(a) // FRAME):
        chunk = a[i * FRAME:(i + 1) * FRAME]
        rms = math.sqrt(sum(x * x for x in chunk) / FRAME) or 1e-9
        flags.append(20 * math.log10(rms / 32768) < SILENCE_DB)
    return flags


def split_speech(a, long_gap=None, ratio=None):
    """返回 (开头静音, 压缩后的正文, 结尾静音)。
    正文内的停顿：长于 long_gap 的压到 PERIOD_GAP，其余长于 MIN_PAUSE 的压到 COMMA_GAP。"""
    flags = silent_flags(a)
    speech = [i for i, s in enumerate(flags) if not s]
    if not speech:
        return a, array.array("h"), array.array("h")
    first, last = speech[0], speech[-1]
    lead = a[:first * FRAME]
    tail = a[(last + 1) * FRAME:]
    body = array.array("h")
    i = first
    while i <= last:
        if not flags[i]:
            body.extend(a[i * FRAME:(i + 1) * FRAME])
            i += 1
            continue
        j = i
        while j <= last and flags[j]:
            j += 1
        run = a[i * FRAME:j * FRAME]
        dur = (j - i) / 100
        if dur <= MIN_PAUSE:
            body.extend(run)
        else:
            if ratio is not None:
                target = min(MAX_PAUSE, max(MIN_PAUSE, dur * ratio))
            else:
                target = PERIOD_GAP if (long_gap and dur >= long_gap) else COMMA_GAP
            body.extend(fit_gap(run, target))
        i = j
    return lead, body, tail


def fit_gap(silence, seconds):
    """把一段静音裁到指定长度：保留首尾（衔接更自然），不够长就用它自己的底噪补足。"""
    n = int(seconds * FRAME * 100)   # FRAME 跟着当前音频的采样率走
    if n <= 0:
        return array.array("h")
    if len(silence) >= n:
        half = n // 2
        return silence[:half] + silence[len(silence) - (n - half):]
    if len(silence) == 0:
        return array.array("h", [0] * n)
    out = array.array("h", silence)
    while len(out) < n:
        out.extend(silence[: n - len(out)])
    return out


def normalize(samples, level=None):
    """统一音量：整体等比例放大或缩小，不改变高低起伏；只在接近破音时轻压。"""
    voiced = [x for x in samples if abs(x) > 300]
    if not voiced:
        return samples
    rms = math.sqrt(sum(x * x for x in voiced) / len(voiced))
    level = TARGET_LEVEL if level is None else level
    gain = 32768 * 10 ** (level / 20) / rms
    limit = 32767 * 10 ** (PEAK_LIMIT / 20)
    knee = limit * 0.9                     # 只有快破音的瞬间才轻轻压一下
    room = limit - knee
    out = array.array("h")
    for x in samples:
        y = x * gain
        a = abs(y)
        if a > knee:
            a = knee + room * math.tanh((a - knee) / room)
            y = a if y > 0 else -a
        out.append(int(y))
    return out


def soft_ending(tail, rate, keep=0.8, total=1.2):
    """结尾不突兀：保留最后一个字自然的尾音和余响，慢慢淡出，再留一点安静收尾。"""
    t = array.array("h", tail[: int(keep * rate)])
    n = len(t)
    for k in range(n):
        t[k] = int(t[k] * (1 - k / n) ** 2)
    t.extend(array.array("h", [0] * max(0, int(total * rate) - n)))
    return t


def write_wav(path, samples, rate=SAMPLE_RATE):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        data = array.array("h", samples)
        if sys.byteorder == "big":
            data.byteswap()
        w.writeframes(data.tobytes())


# ---------------- 主流程 ----------------
def split_sentences(text):
    parts = re.findall(rf"[^{SENTENCE_END}]+[{SENTENCE_END}]*", text)
    return [p.strip() for p in parts if p.strip()]


def render_segment(seg, model_id, settings, seed):
    if not PER_SENTENCE:
        raw = tts_pcm(seg, model_id, settings, seed)
        lead, body, tail = split_speech(to_samples(raw), ratio=PAUSE_RATIO)
        return fit_gap(lead, 0.10) + body + soft_ending(tail, FRAME * 100)

    sents = split_sentences(seg)
    pieces = []
    for k, s in enumerate(sents):
        prev_text = "".join(sents[:k])
        next_text = "".join(sents[k + 1:])
        raw = tts_pcm(s, model_id, settings, seed, prev_text, next_text)
        pieces.append(split_speech(to_samples(raw)))
        time.sleep(0.3)

    out = fit_gap(pieces[0][0], 0.10)
    for k, (lead, body, tail) in enumerate(pieces):
        out.extend(body)
        if k + 1 < len(pieces):
            room = tail + pieces[k + 1][0]
            out.extend(fit_gap(room, PERIOD_GAP))
    out.extend(fit_gap(pieces[-1][2], 0.20))
    return out


def save_audio(wav_path, samples):
    """先存 wav，Mac 上用自带的 afconvert 转成 m4a，转好就删掉 wav。"""
    if samples is not None:
        write_wav(wav_path, normalize(samples))
    m4a_path = wav_path[:-4] + ".m4a"
    # 24kHz单声道不支持192k码率（旧版就是因为这个转换失败、留下了wav）
    # 依次尝试：升到44.1kHz再编码 → 默认参数编码
    attempts = [
        ["afconvert", "-f", "m4af", "-d", "aac@44100", "-b", "128000", wav_path, m4a_path],
        ["afconvert", "-f", "m4af", "-d", "aac", wav_path, m4a_path],
    ]
    last_err = ""
    for cmd in attempts:
        try:
            subprocess.run(cmd, check=True, capture_output=True)
            if os.path.exists(m4a_path) and os.path.getsize(m4a_path) > 0:
                os.remove(wav_path)
                return m4a_path
        except FileNotFoundError:
            last_err = "找不到 afconvert（不是 Mac 系统？）"
            break
        except subprocess.CalledProcessError as e:
            last_err = (e.stderr or b"").decode("utf-8", "ignore").strip()
    print(f"⚠️ 转m4a失败，暂时保留wav：{last_err}")
    return wav_path


def read_text(source_file=None):
    """有文件参数就读文件；没有就直接读剪贴板（先复制逐字稿，再敲 tts）。"""
    if source_file:
        with open(source_file, encoding="utf-8") as f:
            return f.read()
    try:
        return subprocess.run(["pbpaste"], capture_output=True, check=True).stdout.decode("utf-8")
    except (OSError, subprocess.CalledProcessError):
        sys.exit("读不到剪贴板，请用：tts 稿子.txt")


def load_latest():
    """找最近一次 tts 生成的原始音频（不含调过音量、停顿的副本），解码成采样。"""
    import glob
    files = [f for f in glob.glob(os.path.join(OUT_DIR, "*.m4a"))
             if "_音量" not in f and "_停顿" not in f]
    if not files:
        sys.exit("还没有生成过音频")
    src = max(files, key=os.path.getmtime)
    tmp = src[:-4] + "_tmp.wav"
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16", src, tmp], check=True)
    with wave.open(tmp, "rb") as w:
        rate, ch = w.getframerate(), w.getnchannels()
        a = to_samples(w.readframes(w.getnframes()))
    os.remove(tmp)
    if ch == 2:
        a = array.array("h", [(a[i] + a[i + 1]) // 2 for i in range(0, len(a) - 1, 2)])
    return src, a, rate


def _tag(x):
    return f"{int(x)}" if x == int(x) else f"{x}"


def relevel(level):
    """不重新生成、不花额度：把最近一次的音频改成指定音量，另存一份。"""
    src, a, rate = load_latest()
    wav_path = src[:-4] + f"_音量{_tag(level)}.wav"
    write_wav(wav_path, normalize(a, level), rate)
    out = save_audio(wav_path, None)
    print(f"已另存：{out}")


def fix_pauses(max_pause):
    """不重新生成、不花额度：把最近一次音频里过长的停顿缩到 max_pause 秒，语气不变。"""
    global FRAME, MAX_PAUSE
    src, a, rate = load_latest()
    FRAME, MAX_PAUSE = rate // 100, max_pause
    lead, body, tail = split_speech(a, ratio=1.0)
    out_samples = lead[: int(0.1 * rate)] + body + soft_ending(tail, rate)
    wav_path = src[:-4] + f"_停顿{_tag(max_pause)}.wav"
    write_wav(wav_path, normalize(out_samples), rate)
    out = save_audio(wav_path, None)
    print(f"已另存：{out}（{len(a) / rate:.1f} 秒 → {len(out_samples) / rate:.1f} 秒）")


def prep_text(text):
    """只改发给AI的标点、不改字数：“为什么这么说呢？”这种自问自答的过渡句，问号改成逗号，避免读成真的提问。"""
    return re.sub(r"(?<=[。！？；，：\s“])([^。！？；，：“”]{1,10}呢)？", r"\1，", "".join(["。", text]))[1:]


# ---------------- 配音稿预处理与考场语气（仅改变API输入，不改正式原稿） ----------------
DISCOURSE_BREAKS = ("但是", "不过", "然而", "与此同时", "因此", "所以", "另外", "另一方面", "我们也要看到", "接下来")
SOFT_BREAKS = ("但是", "不过", "然而", "因此", "所以", "与此同时", "比如", "例如", "另一方面", "另外")


def naturalize_long_sentence(sentence):
    """优先在已存在的逗号+明确转折处改句号；不随机切断中文词组。"""
    text = sentence
    # 太长的句子，只在独立逻辑转折处提升为句号；最多两次。
    for _ in range(2):
        if len(re.sub(r"[，,、\s]", "", text)) <= LONG_SENTENCE_CHARS:
            break
        candidates = []
        for match in re.finditer("[，,]", text):
            k = match.start()
            tail = text[k + 1:].lstrip()
            if k >= 22 and len(tail) >= 15 and any(tail.startswith(w) for w in DISCOURSE_BREAKS):
                # 更偏向将长句分成接近两半的自然短句
                candidates.append((abs(k - len(text) / 2), k))
        if not candidates:
            break
        k = min(candidates)[1]
        text = text[:k] + "。" + text[k + 1:]
        # 已经改出句号，不再继续在同一整句内盲切
        break
    # 很长的无标点分句：只在存在明显语义转折时加逗号。
    if len(text) > LONG_CLAUSE_CHARS:
        chunks = re.split(r"([，。！？；!?;])", text)
        rebuilt = []
        for piece in chunks:
            if len(piece) > LONG_CLAUSE_CHARS:
                options = [m.start() for w in SOFT_BREAKS for m in re.finditer(re.escape(w), piece)
                           if 24 <= m.start() <= len(piece) - 10]
                if options:
                    k = min(options, key=lambda x: abs(x - len(piece) / 2))
                    piece = piece[:k] + "，" + piece[k:]
            rebuilt.append(piece)
        text = "".join(rebuilt)
    return text


def build_voice_lines(original_lines, mode):
    """正式文本保持原样；得到带可选标点优化的配音段落。"""
    if mode in ("原版", "交流"):
        # 交流模式尽量保持旧版行为，方便与考场模式做真正的A/B对比。
        return [prep_text(x) for x in original_lines]
    result = []
    for line in original_lines:
        line = prep_text(line)
        # 句号/问号/分号保留，在各完整句子内部寻找安全的长句切点
        segments = re.findall(r"[^。！？!?；;]+[。！？!?；;]*", line)
        result.append("".join(naturalize_long_sentence(x) for x in segments) if segments else line)
    return result


def classify_delivery(text):
    """按语义角色选择标签，而不是每个标点都变化音色。"""
    t = text.lstrip(" ，。！？;；:：")
    if t.startswith(("但是", "不过", "然而", "实际上", "我们也要看到", "另一方面")):
        return EXAM_TAGS["thought"]
    if t.startswith(("比如", "例如", "就拿", "以", "在实际工作中")):
        return EXAM_TAGS["example"]
    if t.startswith(("我认为", "在我看来", "最重要的是", "因此")):
        return EXAM_TAGS["conviction"]
    return EXAM_TAGS["thought"]


def propose_tone_events(lines, mode):
    """返回 (在配音文字中的字符偏移,标签)。所有偏移基于不含标签的配音文本。"""
    if mode == "原版":
        return []
    if mode == "交流":
        return [(0, TALK_TAG)]
    full = "".join(lines)
    if not full:
        return []
    events = [(0, EXAM_TAGS["opening"])]
    starts = []
    pos = 0
    for line in lines:
        starts.append(pos)
        pos += len(line)
    # 优先选开头、正文思考切换、结束三种场景；不是每段都变腔调。
    final_offset = None
    for idx in range(len(lines) - 1, 0, -1):
        if lines[idx].lstrip().startswith(("最后", "总之", "综上", "各位考官", "考生作答完毕")):
            final_offset = starts[idx]
            break
    for idx in range(1, len(lines)):
        where = starts[idx]
        if where == final_offset or len(events) >= MAX_TONE_TAGS - (1 if final_offset is not None else 0):
            continue
        if where - events[-1][0] < MIN_TAG_DISTANCE:
            continue
        events.append((where, classify_delivery(lines[idx])))
    # 一段非常长时，也可在已有句号/逗号后的逻辑转折处改变一次表达状态。
    # 只在正文跨越很长距离，且不超过标签上限的情况下插入。
    for m in re.finditer(r"(?<=[。！？；，])(?:但是|不过|然而|比如|例如|我认为|最后)", full):
        k = m.start()
        if len(events) >= MAX_TONE_TAGS - (1 if final_offset is not None and final_offset not in [e[0] for e in events] else 0):
            break
        if any(abs(k - p) < MIN_TAG_DISTANCE for p, _ in events):
            continue
        if final_offset is not None and k >= final_offset:
            continue
        events.append((k, classify_delivery(full[k:])))
    if final_offset is not None and final_offset - events[0][0] >= MIN_TAG_DISTANCE:
        events = [(p, t) for p, t in events if p != final_offset]
        # 留一个名额给真实收尾；必要时移走最后一个正文标签。
        if len(events) >= MAX_TONE_TAGS:
            events = sorted(events)[:MAX_TONE_TAGS - 1]
        events.append((final_offset, EXAM_TAGS["closing"]))
    return sorted(events)[:MAX_TONE_TAGS]


def inject_tone_tags(voice_text, events):
    """给API的文本插入标签；返回稿子本身与标签字符位置不会混淆。"""
    event_dict = {int(p): t for p, t in events if 0 <= int(p) < len(voice_text)}
    chunks = []
    for k, ch in enumerate(voice_text):
        if k in event_dict:
            chunks.append(event_dict[k] + " ")
        chunks.append(ch)
    return "".join(chunks)


def align_for_voice_text(align, model_text, voice_text):
    """从API时间戳中仅提取真正要朗读的字符，忽略任意位置的标签。

    如果服务端对文本做了不可预测的改写，宁可不使用时间戳，也不让偏移量错位导致切字。
    """
    if not align:
        return None
    needed = ("characters", "character_start_times_seconds", "character_end_times_seconds")
    if any(key not in align for key in needed):
        return None
    chars = align["characters"]
    st = align["character_start_times_seconds"]
    en = align["character_end_times_seconds"]
    if not (len(chars) == len(st) == len(en)):
        return None
    rendered = "".join(chars)
    if rendered == voice_text:
        idx = list(range(len(voice_text)))
    else:
        matcher = difflib.SequenceMatcher(None, voice_text, rendered, autojunk=False)
        idx = [None] * len(voice_text)
        for block in matcher.get_matching_blocks():
            for t in range(block.size):
                idx[block.a + t] = block.b + t
        if any(i is None for i in idx):
            return None
    result = {"characters": list(voice_text),
              "character_start_times_seconds": [st[i] for i in idx],
              "character_end_times_seconds": [en[i] for i in idx]}
    if not all(result["character_start_times_seconds"][i] <= result["character_end_times_seconds"][i]
               for i in range(len(voice_text))):
        return None
    return result


def show_preview(original_lines, voice_lines, events, mode):
    a = "".join(original_lines)
    b = "".join(voice_lines)
    print(f"模式：{mode}；原稿 {len(a)} 字符；配音稿 {len(b)} 字符；语气标签 {len(events)} 处")
    for op, i, j, k, l in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op != "equal":
            print(f"配音专用修改：原文 {a[max(0,i-15):min(len(a),j+15)]!r} -> {b[max(0,k-15):min(len(b),l+15)]!r}")
    print("\n--- 实际发送给ElevenLabs的文本（仅预览，不调用API） ---")
    model = inject_tone_tags(b, events)
    print(model)
    print(f"\n预计送入 API 的字符数：{len(model)}（仅估算，实际计费以ElevenLabs为准）")


PUNCT = set("。！？；!?;，,：:、“”‘’\"'（）()…—")


def _frame_db(a, f):
    out = []
    for k in range(len(a) // f):
        c = a[k * f:(k + 1) * f]
        r = math.sqrt(sum(x * x for x in c) / f) or 1e-9
        out.append(20 * math.log10(r / 32768))
    return out


def _xfade_join(out, piece, n):
    """把 piece 接到 out 后面，接口处做 n 个采样的交叉淡化。"""
    n = min(n, len(out), len(piece))
    if n <= 0:
        out.extend(piece)
        return
    tail = out[len(out) - n:]
    del out[len(out) - n:]
    for k in range(n):
        w = k / n
        out.append(int(tail[k] * (1 - w) + piece[k] * w))
    out.extend(piece[n:])


def shape_pauses(raw, text, align, para_starts):
    """按标点调整停顿，但只在 >=40ms 的真正安静片段上编辑。

    没有安全切点就原样保留声音；顿号和序号只缩短，不强行补长。
    填充使用静音+短淡化，绝不循环复制任意 10ms 的发声波形。
    """
    st, en = align["character_start_times_seconds"], align["character_end_times_seconds"]
    F = SAMPLE_RATE // 100
    dbs = _frame_db(raw, F)
    if not dbs:
        return raw
    loud = sorted(dbs)[int(len(dbs) * 0.8)]
    quiet = loud - QUIET_DB
    min_quiet_frames = 4  # 10ms/帧，连续至少40ms才允许切割
    speech = [k for k, ch in enumerate(text) if ch not in PUNCT]

    edits = []
    for a_idx, b_idx in zip(speech, speech[1:]):
        between = text[a_idx + 1:b_idx]
        target = None
        shorten_only = False
        if b_idx in para_starts:
            target = GAP_PARAGRAPH
        elif text.startswith("考生作答完毕", b_idx):
            target = GAP_ENDING
        elif any(c in "。！？；!?;" for c in between):
            target = GAP_PERIOD
        elif any(c in "，,：:" for c in between):
            target = GAP_COMMA
        elif "、" in between:
            target = GAP_DUNHAO
            shorten_only = True
        elif not between and any(text.startswith(o, max(0, a_idx + 1 - len(o))) for o in ORDINALS):
            target = GAP_ORDINAL
            shorten_only = True
        if target is None:
            continue
        if RANDOM_VARIATION:
            target *= random.uniform(1 - GAP_JITTER, 1 + GAP_JITTER)

        f0 = max(0, int((en[a_idx] - 0.12) * 100))
        f1 = min(len(dbs), int((st[b_idx] + 0.12) * 100) + 1)
        if f1 <= f0:
            continue

        # 只认连续安静区；严格禁止「找不到静音就选最安静的一帧」的回退逻辑。
        best = None
        run_s = None
        for k in range(f0, f1 + 1):
            is_quiet = k < f1 and dbs[k] < quiet
            if is_quiet and run_s is None:
                run_s = k
            elif not is_quiet and run_s is not None:
                if k - run_s >= min_quiet_frames:
                    if best is None or k - run_s > best[1] - best[0]:
                        best = (run_s, k)
                run_s = None
        if best is None:
            continue
        s0, s1 = best
        if shorten_only and (s1 - s0) * F <= int(target * SAMPLE_RATE):
            continue
        if edits and s0 < edits[-1][1]:
            continue
        edits.append((s0, s1, target))

    xf = int(SAMPLE_RATE * XFADE_MS / 1000)
    out = array.array("h")
    pos = 0
    for s0, s1, target in edits:
        a0, a1 = s0 * F, s1 * F
        if a0 < pos:
            continue
        out.extend(raw[pos:a0])
        gap = raw[a0:a1]
        need = int(target * SAMPLE_RATE)
        if len(gap) > need:
            # 缩短：只在安静区中央衔接，避免影响两端的尾音/气口。
            half = need // 2
            new_gap = array.array("h", gap[:half])
            _xfade_join(new_gap, gap[len(gap) - (need - half):], xf)
        elif len(gap) < need:
            # 补长：只增加真正的零静音，而不是把底噪/语音帧循环十几遍。
            # 静音连接点两侧做 8ms 淡化，避免新增咔哒声。
            mid = len(gap) // 2
            left = array.array("h", gap[:mid])
            right = array.array("h", gap[mid:])
            fade = min(xf, len(left), len(right))
            if fade:
                for k in range(fade):
                    left[len(left) - fade + k] = int(left[len(left) - fade + k] * (fade - k - 1) / fade)
                    right[k] = int(right[k] * (k + 1) / fade)
            new_gap = left + array.array("h", [0] * (need - len(gap))) + right
        else:
            new_gap = gap
        out.extend(new_gap)
        pos = a1
    out.extend(raw[pos:])
    return out

def process(raw_samples, lines=None, align=None):
    """按标点调整停顿，替换开头静音，保留结尾余音。"""
    global FRAME
    FRAME = SAMPLE_RATE // 100
    shaped = False
    if lines and align:
        text = prep_text("".join(lines))
        starts = align.get("character_start_times_seconds", [])
        ends = align.get("character_end_times_seconds", [])
        if len(starts) == len(ends) == len(text):
            para_starts, k = set(), 0
            for ln in lines[:-1]:
                k += len(ln)
                para_starts.add(k)
            raw_samples = shape_pauses(raw_samples, text, align, para_starts)
            shaped = True

    if shaped:
        # 已按标点塑造过的停顿不再做第二次全局裁切：保留换段0.85秒等设置。
        flags = silent_flags(raw_samples)
        speech = [i for i, flag in enumerate(flags) if not flag]
        if speech:
            first, last = speech[0], speech[-1]
            body = raw_samples[first * FRAME:(last + 1) * FRAME]
            tail = raw_samples[(last + 1) * FRAME:]
        else:
            body, tail = raw_samples, array.array("h")
    else:
        _lead, body, tail = split_speech(raw_samples, ratio=PAUSE_RATIO)
    lead_len = round(random.uniform(*LEAD_RANGE), 2) if RANDOM_VARIATION else 0.10
    head = array.array("h", [0] * int(lead_len * SAMPLE_RATE))
    return head + body + soft_ending(tail, SAMPLE_RATE)

def trim_align(lines, align):
    """开头加过标签时，时间戳里会多出标签那几个字符，去掉它们。"""
    full = "".join(lines)
    if align and len(align["characters"]) > len(full):
        extra = len(align["characters"]) - len(full)
        align = {k: v[extra:] for k, v in align.items()}
    return align


def save_project(out_dir, lines, raw, align, original_lines=None, mode="原版", tone_events=None):
    """保存实际配音稿及可靠时间戳；正式稿与语气元数据只放隐藏项目目录。"""
    with open(os.path.join(out_dir, ".raw.pcm"), "wb") as f:
        f.write(raw.tobytes())
    meta = {"lines": lines, "align": align, "mode": mode,
            "original_lines": original_lines if original_lines is not None else lines,
            "tone_events": tone_events if tone_events is not None else []}
    with open(os.path.join(out_dir, ".align.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)


def redo(n):
    """只重新生成第 n 段，前后文一起传给模型保持语气，然后替换回整篇（只花这一段的额度）。"""
    import glob
    projects = glob.glob(os.path.join(DATA_DIR, "*", ".align.json"))
    if not projects:
        sys.exit("最近的音频没有时间戳，没法单段重做：请先用新版 tts 重新生成一次")
    meta_path = max(projects, key=os.path.getmtime)
    out_dir = os.path.dirname(meta_path)
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    lines, align = meta["lines"], meta["align"]
    mode = meta.get("mode", "原版")
    original_lines = meta.get("original_lines", lines)
    tone_events = meta.get("tone_events", [])
    if not align:
        sys.exit("这次生成没有拿到时间戳，没法单段重做")
    if not 1 <= n <= len(lines):
        sys.exit(f"这篇一共 {len(lines)} 段，请输入 1 到 {len(lines)}")
    with open(os.path.join(out_dir, ".raw.pcm"), "rb") as f:
        raw = to_samples(f.read())

    starts, ends = align["character_start_times_seconds"], align["character_end_times_seconds"]
    full = "".join(lines)
    if len(starts) != len(full):
        sys.exit("时间戳和稿子对不上，没法单段重做，请整篇重新生成")
    a = sum(len(x) for x in lines[: n - 1])          # 这一段第一个字的位置
    b = a + len(lines[n - 1])                       # 下一段第一个字的位置
    t0 = 0.0 if n == 1 else (ends[a - 1] + starts[a]) / 2
    t1 = len(raw) / SAMPLE_RATE if n == len(lines) else (ends[b - 1] + starts[b]) / 2

    print(f"重做第 {n} 段（{len(lines[n - 1])} 字），前后文一起传给模型保持语气……")
    name, model_id, settings = PRESETS[0]
    # 延用整篇生成时选定的语气标签，避免单段重做时风格飘移。
    local_events = [(int(p) - a, tag) for p, tag in tone_events if a <= int(p) < b]
    if mode == "交流" and not local_events:
        local_events = [(0, TALK_TAG)]
    elif mode == "考场" and not local_events:
        local_events = [(0, EXAM_TAGS["thought"])]
    segment_text = lines[n - 1]
    segment_model_text = inject_tone_tags(segment_text, local_events)
    new_bytes, returned_align = tts_with_times(
        segment_model_text, model_id, settings, random.randint(1, 10**6),
        prev_text="".join(lines[: n - 1]), next_text="".join(lines[n:]))
    new_align = align_for_voice_text(returned_align, segment_model_text, segment_text)
    if new_align is None:
        print("⚠️ 新片段无可靠逐字时间戳：本次可听，但不能安全推算后续单段重做的位置")
    new = to_samples(new_bytes)

    # 去掉新片段首尾多余的静音，段落间原有的停顿保留在旧音频里
    flags = silent_flags(new)
    speech = [k for k, x in enumerate(flags) if not x] or [0]
    cut0 = max(0, speech[0] - 3) * FRAME
    cut1 = min(len(new), (speech[-1] + 1 + (3 if n < len(lines) else 60)) * FRAME)
    piece = new[cut0:cut1]

    i0, i1 = int(t0 * SAMPLE_RATE), int(t1 * SAMPLE_RATE)
    merged = raw[:i0] + piece + raw[i1:]

    # 更新时间戳，方便接着重做别的段
    shift_new = t0 - cut0 / SAMPLE_RATE
    delta = len(piece) / SAMPLE_RATE - (t1 - t0)
    if new_align and len(new_align["character_start_times_seconds"]) == b - a:
        ns = [x + shift_new for x in new_align["character_start_times_seconds"]]
        ne = [x + shift_new for x in new_align["character_end_times_seconds"]]
    else:   # 拿不到新时间戳就按比例估算
        span = len(piece) / SAMPLE_RATE
        ns = [t0 + span * k / (b - a) for k in range(b - a)]
        ne = [t0 + span * (k + 1) / (b - a) for k in range(b - a)]
    align["character_start_times_seconds"] = starts[:a] + ns + [x + delta for x in starts[b:]]
    align["character_end_times_seconds"] = ends[:a] + ne + [x + delta for x in ends[b:]]
    # 旧项目的原始音频保留不变；只把合并结果存为新项目。
    stamp = time.strftime("%Y-%m-%d_%H-%M-%S")
    os.makedirs(os.path.join(DATA_DIR, stamp), exist_ok=True)
    save_project(os.path.join(DATA_DIR, stamp), lines, merged, align,
                 original_lines=original_lines, mode=mode, tone_events=tone_events)
    out = save_audio(os.path.join(OUT_DIR, f"{stamp}.wav"), process(merged, lines, align))
    print(f"已生成新的整篇：{out}")
    record_usage(len(lines[n - 1]))


def repair_latest(source_stamp=None):
    """免费重处理原始PCM（可指定旧文件的时间戳），不重新请求API。"""
    import glob
    if source_stamp:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}", source_stamp):
            sys.exit("时间格式不对，示例：修复 2026-10-29_12-58-58")
        meta_path = os.path.join(DATA_DIR, source_stamp, ".align.json")
        if not os.path.exists(meta_path):
            sys.exit(f"找不到项目：{source_stamp}，请检查隐藏文件夹 .data")
    else:
        projects = glob.glob(os.path.join(DATA_DIR, "*", ".align.json"))
        projects = [p for p in projects if os.path.exists(os.path.join(os.path.dirname(p), ".raw.pcm"))]
        if not projects:
            sys.exit("找不到原始PCM和时间戳：请确认 ~/Downloads/AI配音/.data/ 里有旧项目")
        meta_path = max(projects, key=os.path.getmtime)
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    raw_path = os.path.join(os.path.dirname(meta_path), ".raw.pcm")
    if not os.path.exists(raw_path):
        sys.exit("找到时间戳，但缺少原始PCM，无法免费重新后处理")
    with open(raw_path, "rb") as f:
        raw = to_samples(f.read())
    lines, align = meta["lines"], meta["align"]
    stamp = time.strftime("%Y-%m-%d_%H-%M-%S")
    wav_path = os.path.join(OUT_DIR, f"{stamp}.wav")
    # 避免与同秒钟已有文件冲突。
    if os.path.exists(wav_path) or os.path.exists(wav_path[:-4] + ".m4a"):
        sys.exit("当前时间已有同名文件，请稍后重试，避免覆盖原有音频")
    audio = process(raw, lines, align)
    out = save_audio(wav_path, audio)
    print(f"本地修复完成：{os.path.basename(out)}（{len(audio) / SAMPLE_RATE:.1f} 秒）")
    print("未请求ElevenLabs API，不消耗字符额度；原音频与原始数据保持不变")


def record_usage(chars):
    """记录本月用量，并提醒剩余额度。能连上账户接口就用官方数字，否则用本地记录估算。"""
    path = os.path.expanduser("~/.tts/usage.json")
    today = time.localtime()
    y, m = today.tm_year, today.tm_mon
    if today.tm_mday < RESET_DAY:
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    period = f"{y}-{m:02d}"
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    if data.get("period") != period:
        data = {"period": period, "used": 0}
    data["used"] += chars
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except OSError:
        pass

    used, limit, source = data["used"], MONTHLY_CREDITS, "本地估算，不含网页上的使用"
    try:
        req = urllib.request.Request("https://api.elevenlabs.io/v1/user/subscription",
                                     headers={"xi-api-key": API_KEY})
        with urllib.request.urlopen(req, timeout=15) as r:
            sub = json.loads(r.read())
        used, limit, source = sub["character_count"], sub["character_limit"], "官方数据"
    except Exception:
        pass

    left = limit - used
    print(f"本月额度：已用 {used}，剩余 {left}（{source}）")
    if used >= limit * WARN_RATIO:
        print(f"⚠️ 额度已用到 {used * 100 // limit}%，剩下大约还能生成 {max(left, 0) // 700} 篇700字的稿子")


def main():
    # 本地修复和预览都不调用 ElevenLabs API。
    if len(sys.argv) >= 2 and sys.argv[1] == "修复":
        repair_latest(sys.argv[2] if len(sys.argv) >= 3 else None)
        return

    args = sys.argv[1:]
    if args and args[0] in ("音量", "停顿", "重做"):
        if not API_KEY or not VOICE_ID:
            sys.exit("请先设置 ELEVENLABS_API_KEY 和 ELEVENLABS_VOICE_ID")
        if args[0] == "音量" and len(args) >= 2:
            relevel(float(args[1]))
        elif args[0] == "停顿":
            fix_pauses(float(args[1]) if len(args) >= 2 else 0.6)
        elif args[0] == "重做":
            redo(int(args[1]) if len(args) >= 2 else 0)
        return
    preview = "预览" in args
    if preview:
        args.remove("预览")
    mode = DEFAULT_MODE
    for candidate in ("考场", "交流", "原版"):
        if candidate in args:
            mode = candidate
            args.remove(candidate)
            break
    if len(args) > 1:
        sys.exit("参数过多：可用 tts / tts 交流 / tts 原版 / tts 预览 / tts 考场 稿子.txt")

    if not preview:
        if not API_KEY or not VOICE_ID:
            sys.exit("请先设置 ELEVENLABS_API_KEY 和 ELEVENLABS_VOICE_ID")

    original = read_text(args[0] if args else None)
    original_lines = [x.strip() for x in original.splitlines() if x.strip()]
    if not original_lines:
        sys.exit("稿子是空的：先复制逐字稿，再运行 tts")
    lines = build_voice_lines(original_lines, mode)
    events = propose_tone_events(lines, mode)
    spoken = "".join(lines)
    model_text = inject_tone_tags(spoken, events)

    if preview:
        show_preview(original_lines, lines, events, mode)
        return

    stamp = time.strftime("%Y-%m-%d_%H-%M-%S")
    out_dir = os.path.join(DATA_DIR, stamp)
    if os.path.exists(os.path.join(OUT_DIR, f"{stamp}.m4a")) or os.path.exists(out_dir):
        sys.exit("当前秒钟已存在同名项目：为避免覆盖，请稍后重试")
    os.makedirs(out_dir, exist_ok=False)
    print(f"整篇 {len(spoken)} 字，共 {len(lines)} 段，模式 {mode}，标签 {len(events)} 处，预计输入 {len(model_text)} 字符")
    _name, model_id, settings = PRESETS[0]
    try:
        settings = dict(settings)
        if RANDOM_VARIATION:
            global MAX_PAUSE
            settings["speed"] = round(random.uniform(*SPEED_RANGE), 2)
            MAX_PAUSE = round(random.uniform(*PAUSE_RANGE), 2)
            print(f"本次随机微调：语速设置 {settings['speed']}（v4可能忽略），最长停顿 {MAX_PAUSE} 秒")
        raw_bytes, returned_align = tts_with_times(model_text, model_id, settings, random.randint(1, 10**6))
    except RuntimeError as e:
        sys.exit(f"生成失败：{e}")
    raw = to_samples(raw_bytes)
    align = align_for_voice_text(returned_align, model_text, spoken)
    if align is None:
        print("⚠️ API逐字时间戳无法安全匹配（可能受标签/文本规范化影响），跳过按标点修整；本篇也不支持单段重做。")
    save_project(out_dir, lines, raw, align, original_lines=original_lines, mode=mode, tone_events=events)
    audio = process(raw, lines, align)
    path = save_audio(os.path.join(OUT_DIR, f"{stamp}.wav"), audio)
    print(f"完成：{os.path.basename(path)}（{len(audio) / SAMPLE_RATE:.1f} 秒）")
    record_usage(len(model_text))
    if align:
        print(f"哪一段不满意，可以用 tts-redo 段号 单独重做，比如 tts-redo {len(lines)}")


if __name__ == "__main__":
    main()

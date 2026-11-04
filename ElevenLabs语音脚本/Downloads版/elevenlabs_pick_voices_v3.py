#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ElevenLabs 音色筛选 V3（参考“平台标签＋客观测量＋语音识别回环”的思路）
用法：python3 elevenlabs_pick_voices_v3.py [你的真实答题录音路径（可选）]
1. 中文＋男性粗筛，温柔关键词打分，再加官方“相似音色”（有参照录音时）
2. 10个候选各生成同一段示范作答
3. 每段测：语速、音高中位数、音高起伏、停顿比例；再做语音识别回环测吐字
4. 按“考场答题合适度”＋“和你的距离”综合排序，前4名放主文件夹，其余放“备选”
只用 Python 自带库（装了 numpy 会更快），音频转换用 macOS 自带 afconvert。
"""
import os, sys, json, time, math, getpass, shutil, subprocess, tempfile, datetime, pathlib, uuid, wave, struct, difflib, re
import urllib.request, urllib.parse, urllib.error

try:
    import numpy as np
except Exception:
    np = None

API = "https://api.elevenlabs.io"
OUT = pathlib.Path.home() / "Downloads" / "AI配音" / "音色筛选V3"
POOL_N, PICK_N = 10, 4
TMP = pathlib.Path(tempfile.mkdtemp(prefix="bobvoice_"))

DEMO_TEXT = (
    "各位考官，这道题呢，我想先说说自己的第一反应。群众来窗口办事，跑了好几趟还没办成，"
    "心里着急是很正常的。那作为工作人员，我首先要做的，不是急着解释政策，而是先把群众的情绪安顿好，"
    "请他坐下来，倒一杯水，把事情一件一件听清楚。接下来呢，我会当场帮他梳理还差哪些材料，"
    "能线上办的就线上办，这样可以让群众少跑一趟路。考生作答完毕。"
)
HANZI = lambda s: "".join(re.findall(r"[一-鿿]", s))

KEY = os.environ.get("ELEVENLABS_API_KEY") or getpass.getpass("粘贴你的 ElevenLabs API Key（输入时不显示，粘贴后回车）：").strip()


# ================= 网络 =================
def call(method, path, params=None, body=None, headers=None, raw=False):
    url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
    h = {"xi-api-key": KEY}
    data = None
    if isinstance(body, (dict, list)):
        data = json.dumps(body).encode(); h["Content-Type"] = "application/json"
    elif isinstance(body, bytes):
        data = body
    if headers:
        h.update(headers)
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h, method=method), timeout=180) as r:
        c = r.read()
    return c if raw else json.loads(c or b"{}")


def multipart(fields, files):
    b = "----bob" + uuid.uuid4().hex
    out = b""
    for k, v in fields.items():
        out += f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for k, (fn, content, ct) in files.items():
        out += f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fn}\"\r\nContent-Type: {ct}\r\n\r\n".encode() + content + b"\r\n"
    out += f"--{b}--\r\n".encode()
    return out, {"Content-Type": f"multipart/form-data; boundary={b}"}


def pick_model():
    if os.environ.get("MODEL"):
        return os.environ["MODEL"]
    try:
        ids = [m["model_id"] for m in call("GET", "/v1/models") if m.get("can_do_text_to_speech", True)]
    except Exception:
        ids = []
    for p in ["eleven_v4", "eleven_v3", "eleven_multilingual_v2"]:
        if p in ids:
            return p
    return "eleven_multilingual_v2"


# ================= 粗筛 =================
EXCLUDE = ["cantonese", "粤", "taiwan", "台湾", "hong kong", "香港", "hokkien", "闽南", "四川", "sichuan",
           "zh-tw", "zh-hk", "anime", "动漫", "cartoon", "child", "kid", "儿童"]
GOOD = {"gentle": 3, "soft": 3, "calm": 3, "warm": 3, "soothing": 2, "relaxed": 2, "friendly": 2,
        "温柔": 4, "温和": 3, "亲和": 3, "平和": 2, "沉稳": 2, "知性": 2, "温暖": 3, "磁性": 1,
        "conversational": 2, "podcast": 1, "播客": 1, "讲解": 1, "narrat": 1, "natural": 1, "自然": 1}
BAD = {"excited": -3, "energetic": -2, "angry": -5, "funny": -3, "搞笑": -3, "character": -2, "game": -2,
       "游戏": -2, "advertis": -1, "广告": -1, "old": -2, "老年": -2, "whisper": -2, "asmr": -3}


def txt(v):
    return " ".join(str(v.get(k) or "") for k in ["name", "accent", "locale", "description", "descriptive", "use_case", "age"]).lower()


def ok(v):
    return (v.get("gender") or "").lower() == "male" and not any(x in txt(v) for x in EXCLUDE)


def kw_score(v):
    t = txt(v)
    s = sum(w for k, w in GOOD.items() if k in t) + sum(w for k, w in BAD.items() if k in t)
    return s + math.log10((v.get("cloned_by_count") or 0) + 1)


def search_library():
    pool = {}
    for q in ["", "温柔", "温和", "亲和", "沉稳", "gentle", "calm", "soft", "warm"]:
        p = {"page_size": 100, "language": "zh", "gender": "male"}
        if q:
            p["search"] = q
        try:
            for v in call("GET", "/v1/shared-voices", p).get("voices", []):
                pool.setdefault(v["voice_id"], v)
        except urllib.error.HTTPError as e:
            print("  搜索出错：", q, e.code)
    return [v for v in pool.values() if ok(v)]


def search_similar(ref_mp3):
    if not ref_mp3:
        return []
    try:
        body, h = multipart({"top_k": "60"}, {"audio_file": ("ref.wav", ref_mp3, "audio/wav")})
        res = call("POST", "/v1/similar-voices", body=body, headers=h).get("voices", [])
    except urllib.error.HTTPError as e:
        print("  相似音色接口出错：", e.code, e.read()[:200])
        return []
    return [v for v in res if ok(v) and "zh" in (str(v.get("language")) + str(v.get("locale"))).lower()]


# ================= 音频处理 =================
def to_wav(src, dst, seconds=None):
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@8000", "-c", "1", str(src), str(dst)],
                   check=True, capture_output=True)
    with wave.open(str(dst)) as w:
        n = w.getnframes() if not seconds else min(w.getnframes(), seconds * 8000)
        x = struct.unpack(f"<{n}h", w.readframes(n))
    return [s / 32768 for s in x]


def to_m4a(src, dst):
    ff = shutil.which("ffmpeg") or ("/opt/homebrew/bin/ffmpeg" if os.path.exists("/opt/homebrew/bin/ffmpeg") else None)
    if ff:
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(src), "-af", "loudnorm=I=-23:TP=-2:LRA=11",
                        "-c:a", "aac", "-b:a", "192k", str(dst)], check=True)
    else:
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "192000", str(src), str(dst)], check=True)


def analyze(x, sr=8000):
    """返回：时长、有声跨度、停顿比例、音高中位数Hz、音高起伏（半音标准差）"""
    frame, hop = 320, 160
    lo, hi = sr // 300, sr // 65
    frames = range(0, max(0, len(x) - frame), hop)
    rms = []
    for i in frames:
        seg = x[i:i + frame]
        rms.append(math.sqrt(sum(s * s for s in seg) / frame))
    if not rms:
        return None
    thr = max(rms) * 0.06
    voiced_idx = [k for k, r in enumerate(rms) if r > thr]
    a, b = voiced_idx[0], voiced_idx[-1]
    span = (b - a + 1) * hop / sr
    silent = sum(1 for k in range(a, b + 1) if rms[k] <= thr)
    pause_ratio = silent / max(1, b - a + 1)

    f0s = []
    for k in range(a, b + 1):
        if rms[k] <= thr * 2:
            continue
        i = k * hop
        seg = x[i:i + frame]
        if np is not None:
            s = np.asarray(seg)
            e = float(np.dot(s, s)) or 1e-9
            best, bl = 0, 0
            for lag in range(lo, hi):
                r = float(np.dot(s[:-lag], s[lag:])) / e
                if r > best:
                    best, bl = r, lag
        else:
            e = sum(v * v for v in seg) or 1e-9
            best, bl = 0, 0
            for lag in range(lo, hi):
                r = sum(seg[j] * seg[j + lag] for j in range(frame - lag)) / e
                if r > best:
                    best, bl = r, lag
        if best > 0.45 and lo < bl < hi - 1:
            def ac(L):
                return (float(np.dot(np.asarray(seg[:-L]), np.asarray(seg[L:]))) if np is not None
                        else sum(seg[j] * seg[j + L] for j in range(frame - L))) / e
            y0, y1, y2 = ac(bl - 1), best, ac(bl + 1)
            den = y0 - 2 * y1 + y2
            frac = 0.5 * (y0 - y2) / den if den else 0
            f0s.append(sr / (bl + max(-0.5, min(0.5, frac))))
    if len(f0s) < 10:
        return None
    f0s.sort()
    med = f0s[len(f0s) // 2]
    st = [12 * math.log2(f / med) for f in f0s if 0.5 * med < f < 2 * med]
    mean = sum(st) / len(st)
    std = math.sqrt(sum((s - mean) ** 2 for s in st) / len(st))
    return {"dur": len(x) / sr, "span": span, "pause": pause_ratio, "f0": med, "st": std}


def asr_accuracy(mp3):
    for mid in ["scribe_v2", "scribe_v1"]:
        try:
            body, h = multipart({"model_id": mid, "language_code": "zh"}, {"file": ("a.mp3", mp3, "audio/mpeg")})
            t = call("POST", "/v1/speech-to-text", body=body, headers=h).get("text", "")
            return difflib.SequenceMatcher(None, HANZI(DEMO_TEXT), HANZI(t)).ratio()
        except urllib.error.HTTPError:
            continue
    return None


# ================= 打分与描述 =================
def rate_of(m):
    return len(HANZI(DEMO_TEXT)) / m["span"]


def fit_score(m):
    """考场答题合适度：语速4.3~5.0字/秒、起伏2~3.5半音、停顿比例0.15~0.30、男声音高90~150Hz"""
    def band(v, lo, hi, w):
        return 0 if lo <= v <= hi else -w * (min(abs(v - lo), abs(v - hi)))
    r = rate_of(m)
    return (band(r, 4.3, 5.0, 4) + band(m["st"], 2.0, 3.5, 2) + band(m["pause"], 0.15, 0.30, 15)
            + band(m["f0"], 90, 150, 0.05))


def dist_to_you(m, me):
    if not me:
        return None
    return math.sqrt((12 * math.log2(m["f0"] / me["f0"]) / 3) ** 2 + ((m["st"] - me["st"]) / 1) ** 2
                     + ((rate_of(m) - me["rate"]) / 0.5) ** 2 + ((m["pause"] - me["pause"]) / 0.08) ** 2)


def describe(m):
    r = rate_of(m)
    p = []
    p.append("音高偏低、沉稳有厚度" if m["f0"] < 105 else "音高适中、听感温和" if m["f0"] < 135 else "音高偏高、偏年轻明亮")
    p.append("语调很平，可能有念稿感" if m["st"] < 1.8 else "起伏适中，像在讲述" if m["st"] <= 3.5 else "起伏偏大，可能有说书感")
    p.append("语速偏慢" if r < 4.3 else "语速适中偏快，贴近考场" if r <= 5.0 else "语速偏快，可能赶")
    p.append("停顿少，换气感弱" if m["pause"] < 0.15 else "停顿自然有换气" if m["pause"] <= 0.30 else "停顿偏多，有点拖")
    return "；".join(p)


# ================= 主流程 =================
def tts(v, model):
    args = ({"output_format": "mp3_44100_128"}, {"text": DEMO_TEXT, "model_id": model})
    try:
        return call("POST", f"/v1/text-to-speech/{v['voice_id']}", *args, raw=True)
    except urllib.error.HTTPError:
        added = call("POST", f"/v1/voices/add/{v['public_owner_id']}/{v['voice_id']}",
                     body={"new_name": "试听-" + v["name"][:40]})
        return call("POST", f"/v1/text-to-speech/{added.get('voice_id', v['voice_id'])}", *args, raw=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "备选").mkdir(exist_ok=True)
    model = pick_model()
    print(f"使用模型：{model}\n")

    me, ref_mp3 = None, None
    if len(sys.argv) > 1:
        p = pathlib.Path(sys.argv[1].strip().strip("'\"")).expanduser()
        if p.exists():
            print("⓪ 测量你的真实录音……")
            x = to_wav(p, TMP / "me.wav", seconds=60)
            me = analyze(x)
            if me:
                me["rate"] = None
                print(f"  你：音高中位数{me['f0']:.0f}Hz，起伏{me['st']:.1f}半音，停顿比例{me['pause']:.0%}")
            subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@22050", "-c", "1", str(p), str(TMP / "ref.wav")],
                           check=True, capture_output=True)
            with wave.open(str(TMP / "ref.wav")) as w:          # 只取前60秒
                params, frames = w.getparams(), w.readframes(60 * 22050)
            with wave.open(str(TMP / "ref60.wav"), "wb") as w:
                w.setparams(params); w.writeframes(frames)
            ref_mp3 = (TMP / "ref60.wav").read_bytes()
        else:
            print("  找不到参照录音：", p)

    print("① 粗筛：中文＋男性＋温柔关键词……")
    lib = search_library()
    sim = search_similar(ref_mp3) if ref_mp3 else []
    print(f"  音色库符合 {len(lib)} 个，和你相似且符合 {len(sim)} 个\n")

    pool, seen = [], set()
    for v in sim:
        if len(pool) >= POOL_N // 2:
            break
        if kw_score(v) >= -1 and v["voice_id"] not in seen:
            v["_src"] = "官方相似"; pool.append(v); seen.add(v["voice_id"])
    for v in sorted(lib, key=kw_score, reverse=True):
        if len(pool) >= POOL_N:
            break
        if v["voice_id"] not in seen:
            v["_src"] = "温柔关键词"; pool.append(v); seen.add(v["voice_id"])

    print(f"② 生成并测量 {len(pool)} 个候选（每个约半分钟）……")
    results = []
    for i, v in enumerate(pool, 1):
        try:
            mp3 = tts(v, model)
            f = TMP / f"{i}.mp3"; f.write_bytes(mp3)
            m = analyze(to_wav(f, TMP / f"{i}.wav"))
            if not m:
                raise RuntimeError("测不出音高")
            m["asr"] = asr_accuracy(mp3)
            v["_m"], v["_mp3"] = m, f
            results.append(v)
            print(f"  [{i}/{len(pool)}] {v['name']}：{rate_of(m):.2f}字/秒，{m['f0']:.0f}Hz，起伏{m['st']:.1f}，停顿{m['pause']:.0%}")
        except Exception as e:
            print(f"  [{i}/{len(pool)}] {v['name']} 失败：{e}")

    if me and results:  # 你的语速没法从录音直接算，就用候选的中位数代替，只比音高、起伏、停顿
        rs = sorted(rate_of(v["_m"]) for v in results)
        me["rate"] = rs[len(rs) // 2]

    for v in results:
        m = v["_m"]
        d = dist_to_you(m, me)
        v["_d"] = d
        asr_pen = 0 if (m["asr"] is None or m["asr"] >= 0.95) else -20 * (0.95 - m["asr"])
        v["_total"] = fit_score(m) + asr_pen - (0.6 * d if d is not None else 0)
    results.sort(key=lambda v: v["_total"], reverse=True)

    print("\n③ 结果（前4名在主文件夹，其余在“备选”）：\n")
    lines = ["# 音色筛选V3结果", "", f"模型：{model}", ""]
    if me:
        lines.append(f"你的录音：音高{me['f0']:.0f}Hz，起伏{me['st']:.1f}半音，停顿{me['pause']:.0%}\n")
    for i, v in enumerate(results, 1):
        time.sleep(1.1)
        fname = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S") + ".m4a"
        dst = (OUT if i <= PICK_N else OUT / "备选") / fname
        to_m4a(v["_mp3"], dst)
        m = v["_m"]
        asr = f"{m['asr']:.0%}" if m["asr"] is not None else "未测"
        d = f"{v['_d']:.1f}" if v["_d"] is not None else "无参照"
        info = (f"【{i}】{v['name']}  ｜来源：{v['_src']}  ｜{'推荐' if i <= PICK_N else '备选'}\n"
                f"  文件：{dst.relative_to(OUT)}\n"
                f"  实测：{rate_of(m):.2f}字/秒，音高{m['f0']:.0f}Hz，起伏{m['st']:.1f}半音，停顿{m['pause']:.0%}，吐字准确率{asr}，和你的距离{d}\n"
                f"  听感推断：{describe(m)}\n"
                f"  平台标签：{v.get('accent')}｜{v.get('age')}｜{v.get('descriptive')}｜{v.get('use_case')}｜被克隆{v.get('cloned_by_count')}次\n"
                f"  简介：{(v.get('description') or '').strip()[:200]}\n"
                f"  voice_id：{v['voice_id']}\n")
        print(info)
        lines.append(info)
    (OUT / "音色说明.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"完成！文件在：{OUT}\n把上面【1】到【{len(results)}】整段复制发给 Claude。")
    subprocess.run(["open", str(OUT)])


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        print("接口出错：", e.code, e.read()[:500])

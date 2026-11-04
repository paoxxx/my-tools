#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ElevenLabs 音色筛选：中文（简体普通话）＋男性＋温柔，挑4个，各生成一段示范作答音频。
另外会用你自己的克隆音色生成一小段样音，去官方“相似音色”接口里找和你像的。
只用 Python 自带库，不需要装任何东西。
"""
import os, sys, json, time, math, getpass, shutil, subprocess, tempfile, datetime, pathlib, uuid
import urllib.request, urllib.parse, urllib.error

API = "https://api.elevenlabs.io"
OUT = pathlib.Path.home() / "Downloads" / "AI配音" / "音色筛选"
PICK_N = 4

DEMO_TEXT = (
    "各位考官，这道题呢，我想先说说自己的第一反应。群众来窗口办事，跑了好几趟还没办成，"
    "心里着急是很正常的。那作为工作人员，我首先要做的，不是急着解释政策，而是先把群众的情绪安顿好，"
    "请他坐下来，倒一杯水，把事情一件一件听清楚。接下来呢，我会当场帮他梳理还差哪些材料，"
    "能线上办的就线上办，这样可以让群众少跑一趟路。考生作答完毕。"
)

KEY = os.environ.get("ELEVENLABS_API_KEY") or getpass.getpass("粘贴你的 ElevenLabs API Key（输入时不显示，粘贴后回车）：").strip()


def call(method, path, params=None, body=None, headers=None, raw=False):
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    h = {"xi-api-key": KEY}
    data = None
    if isinstance(body, (dict, list)):
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    elif isinstance(body, bytes):
        data = body
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=120) as r:
        content = r.read()
    return content if raw else json.loads(content or b"{}")


def multipart(fields, files):
    b = "----bob" + uuid.uuid4().hex
    out = b""
    for k, v in fields.items():
        out += f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for k, (fname, content, ctype) in files.items():
        out += (f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fname}\"\r\n"
                f"Content-Type: {ctype}\r\n\r\n").encode() + content + b"\r\n"
    out += f"--{b}--\r\n".encode()
    return out, {"Content-Type": f"multipart/form-data; boundary={b}"}


# ---------- 1. 选模型 ----------
def pick_model():
    if os.environ.get("MODEL"):
        return os.environ["MODEL"]
    try:
        ids = [m["model_id"] for m in call("GET", "/v1/models") if m.get("can_do_text_to_speech", True)]
    except Exception:
        ids = []
    for pref in ["eleven_v4", "eleven_v3", "eleven_multilingual_v2"]:
        if pref in ids:
            return pref
    return "eleven_multilingual_v2"


# ---------- 2. 打分规则 ----------
EXCLUDE = ["cantonese", "粤", "taiwan", "台湾", "hong kong", "香港", "hokkien", "闽南", "四川", "sichuan",
           "zh-tw", "zh-hk", "anime", "动漫", "cartoon", "child", "kid", "儿童"]
GOOD = {"gentle": 3, "soft": 3, "calm": 3, "warm": 3, "soothing": 2, "relaxed": 2, "friendly": 2,
        "温柔": 4, "温和": 3, "亲和": 3, "平和": 2, "沉稳": 2, "知性": 2, "温暖": 3, "磁性": 1,
        "conversational": 2, "podcast": 1, "播客": 1, "讲解": 1, "narrat": 1, "natural": 1, "自然": 1}
BAD = {"excited": -3, "energetic": -2, "angry": -5, "funny": -3, "搞笑": -3, "character": -2,
       "game": -2, "游戏": -2, "advertis": -1, "广告": -1, "old": -2, "老年": -2, "whisper": -2, "asmr": -3}


def text_of(v):
    return " ".join(str(v.get(k) or "") for k in
                    ["name", "accent", "locale", "description", "descriptive", "use_case", "age"]).lower()


def ok(v):
    t = text_of(v)
    return (v.get("gender") or "").lower() == "male" and not any(x in t for x in EXCLUDE)


def score(v):
    t = text_of(v)
    s = sum(w for k, w in GOOD.items() if k in t) + sum(w for k, w in BAD.items() if k in t)
    s += math.log10((v.get("cloned_by_count") or 0) + 1)
    if (v.get("use_case") or "") in ("conversational", "narrative_story", "informative_educational"):
        s += 1
    return s


# ---------- 3. 音色库搜索 ----------
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
            print("  搜索出错：", q, e.code, e.read()[:200])
    return [v for v in pool.values() if ok(v)]


# ---------- 4. 和你像的音色 ----------
def search_similar(model):
    try:
        mine = [v for v in call("GET", "/v1/voices").get("voices", [])
                if v.get("category") in ("professional", "cloned")]
    except Exception as e:
        print("  读取你的音色失败：", e)
        return [], None
    if not mine:
        print("  账号里没找到你的克隆音色，跳过“相似音色”。")
        return [], None
    mine.sort(key=lambda v: v.get("category") != "professional")
    me = mine[0]
    print(f"  用你的克隆音色“{me['name']}”生成样音，去找相似音色……")
    try:
        sample = call("POST", f"/v1/text-to-speech/{me['voice_id']}",
                      {"output_format": "mp3_44100_128"},
                      {"text": DEMO_TEXT, "model_id": model}, raw=True)
        body, h = multipart({"top_k": "40"}, {"audio_file": ("me.mp3", sample, "audio/mpeg")})
        res = call("POST", "/v1/similar-voices", body=body, headers=h).get("voices", [])
    except urllib.error.HTTPError as e:
        print("  相似音色接口出错：", e.code, e.read()[:300])
        return [], me["name"]
    res = [v for v in res if ok(v) and "zh" in (str(v.get("language") or "") + str(v.get("locale") or "")).lower()]
    return res, me["name"]


# ---------- 5. 生成音频 ----------
def tts(v, model):
    vid = v["voice_id"]
    args = ({"output_format": "mp3_44100_128"}, {"text": DEMO_TEXT, "model_id": model})
    try:
        return call("POST", f"/v1/text-to-speech/{vid}", *args, raw=True)
    except urllib.error.HTTPError:
        # 共享音色需要先加入“我的音色”
        added = call("POST", f"/v1/voices/add/{v['public_owner_id']}/{vid}",
                     body={"new_name": "试听-" + v["name"][:40]})
        return call("POST", f"/v1/text-to-speech/{added.get('voice_id', vid)}", *args, raw=True)


def to_m4a(mp3_bytes, dst):
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(mp3_bytes)
        src = f.name
    ff = shutil.which("ffmpeg") or ("/opt/homebrew/bin/ffmpeg" if os.path.exists("/opt/homebrew/bin/ffmpeg") else None)
    if ff:
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", src, "-af", "loudnorm=I=-23:TP=-2:LRA=11",
                        "-c:a", "aac", "-b:a", "192k", str(dst)], check=True)
    else:
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "192000", src, str(dst)], check=True)
    os.remove(src)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    model = pick_model()
    print(f"使用模型：{model}\n")

    print("① 在音色库里搜：中文＋男性＋温柔……")
    lib = search_library()
    print(f"  符合条件的有 {len(lib)} 个\n")

    print("② 找和你自己声音相似的……")
    sim, my_name = search_similar(model)
    print(f"  相似且符合条件的有 {len(sim)} 个\n")

    picks, seen = [], set()
    for v in sim:                      # 相似音色里挑最多2个，且不能太“不温柔”
        if len(picks) >= 2:
            break
        if score(v) >= 0 and v["voice_id"] not in seen:
            v["_tag"] = "和你相似"
            picks.append(v); seen.add(v["voice_id"])
    for v in sorted(lib, key=score, reverse=True):
        if len(picks) >= PICK_N:
            break
        if v["voice_id"] not in seen:
            v["_tag"] = "温柔关键词"
            picks.append(v); seen.add(v["voice_id"])

    if not picks:
        print("没找到合适音色，把上面的输出发给 Claude。")
        return

    print("③ 生成示范音频……\n")
    lines = ["# 音色筛选结果", "", f"模型：{model}", f"相似参照：{my_name or '无'}", ""]
    for i, v in enumerate(picks, 1):
        time.sleep(1.1)
        fname = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S") + ".m4a"
        try:
            to_m4a(tts(v, model), OUT / fname)
            status = fname
        except Exception as e:
            status = f"生成失败：{e}"
        info = (f"【{i}】{v['name']}  ｜来源：{v['_tag']}\n"
                f"  文件：{status}\n"
                f"  口音：{v.get('accent')}  地区：{v.get('locale')}  年龄：{v.get('age')}\n"
                f"  风格标签：{v.get('descriptive')}  用途：{v.get('use_case')}  被克隆次数：{v.get('cloned_by_count')}\n"
                f"  简介：{(v.get('description') or '').strip()[:300]}\n"
                f"  voice_id：{v['voice_id']}\n")
        print(info)
        lines.append(info)

    (OUT / "音色说明.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"完成！文件在：{OUT}")
    subprocess.run(["open", str(OUT)])


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        print("接口出错：", e.code, e.read()[:500])

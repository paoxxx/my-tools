#!/usr/bin/env python3
"""链接扒稿器 后端：链接/文件 → 音频 → 本地转写 → Obsidian 笔记。
每一步通过 stdout 输出一行 JSON，供界面显示进度。"""
import argparse
import datetime
import gzip
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zlib

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("MODELSCOPE_LOG_LEVEL", "40")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ["PATH"] = os.path.dirname(sys.executable) + os.pathsep + os.environ.get("PATH", "")

MODEL = "mlx-community/whisper-large-v3-turbo"
PROMPT = "以下是普通话的公务员结构化面试讲解，各位考官，综合分析，人际关系，组织管理，应急应变。"
MOBILE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
             "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")
DESKTOP_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")


def emit(**kw):
    print(json.dumps(kw, ensure_ascii=False), flush=True)


def step(text):
    emit(type="step", text=text)


# ---------------- 链接识别 ----------------
URL_RE = re.compile(r"https?://[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+")


def pick_url(text):
    urls = URL_RE.findall(text or "")
    if not urls:
        return None
    for u in urls:
        if platform_of(u) != "其他":
            return u.rstrip(".,)")
    return urls[0].rstrip(".,)")


def platform_of(url):
    u = url.lower()
    if "douyin.com" in u or "iesdouyin.com" in u:
        return "抖音"
    if "xiaohongshu.com" in u or "xhslink" in u:
        return "小红书"
    if "bilibili.com" in u or "b23.tv" in u:
        return "B站"
    return "其他"


# ---------------- 网络小工具 ----------------
COOKIE_FILE = None


def cookie_header(url):
    """从 Netscape 格式 Cookie 文件里取出属于该网址的 Cookie。"""
    if not COOKIE_FILE or not os.path.exists(COOKIE_FILE):
        return ""
    host = urllib.parse.urlparse(url).hostname or ""
    pairs = []
    for line in open(COOKIE_FILE, encoding="utf-8", errors="ignore"):
        if line.startswith("#") or line.count("\t") < 6:
            continue
        dom, _, _, _, _, name, value = line.rstrip("\n").split("\t")[:7]
        dom = dom.lstrip(".")
        if host == dom or host.endswith("." + dom):
            pairs.append(f"{name}={value}")
    return "; ".join(pairs)


def http_get(url, ua=MOBILE_UA, referer=None):
    headers = {"User-Agent": ua, "Accept-Language": "zh-CN,zh;q=0.9",
               "Accept-Encoding": "gzip, deflate"}
    if referer:
        headers["Referer"] = referer
    ck = cookie_header(url)
    if ck:
        headers["Cookie"] = ck
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        enc = r.headers.get("Content-Encoding", "")
        if enc == "gzip":
            raw = gzip.decompress(raw)
        elif enc == "deflate":
            raw = zlib.decompress(raw)
        return r.geturl(), raw.decode("utf-8", "ignore")


def http_download(url, dest, ua=MOBILE_UA, referer=None):
    headers = {"User-Agent": ua}
    if referer:
        headers["Referer"] = referer
    ck = cookie_header(url)
    if ck:
        headers["Cookie"] = ck
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    if os.path.getsize(dest) < 10_000:
        raise RuntimeError("下载到的文件太小，可能被平台拦截")
    return dest


def find_key(obj, key):
    """在嵌套 JSON 里找第一个名为 key 的值。"""
    if isinstance(obj, dict):
        if key in obj and obj[key]:
            return obj[key]
        for v in obj.values():
            r = find_key(v, key)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = find_key(v, key)
            if r:
                return r
    return None


# ---------------- 各平台信息整理 ----------------
def split_title(desc):
    lines = [l.strip() for l in (desc or "").splitlines() if l.strip()]
    for l in lines:
        t = re.sub(r"#\S+", "", l).strip(" ，,。")
        if t:
            return t
    return ""


def clean_desc(desc):
    return re.sub(r"[ \t]*#\S+", "", desc or "").strip()


def ts_date(ts):
    try:
        ts = int(ts)
        if ts > 10**11:
            ts //= 1000
        return datetime.date.fromtimestamp(ts).isoformat() if ts else ""
    except Exception:  # noqa: BLE001
        return ""


def douyin_meta(item):
    """抖音视频详情（网页接口、分享页通用）→ 笔记信息。"""
    a = item.get("author") or item.get("authorInfo") or {}
    st = item.get("statistics") or item.get("stats") or {}
    v = item.get("video") or {}
    desc = item.get("desc") or ""
    topics = [x.get("hashtag_name") or x.get("hashtagName") for x in (item.get("text_extra") or item.get("textExtra") or [])]
    topics = [t for t in topics if t] or re.findall(r"#([^\s#]+)", desc)
    sec = a.get("sec_uid") or a.get("secUid")
    aid = item.get("aweme_id") or item.get("awemeId")
    d = v.get("duration") or 0
    return {
        "title": item.get("item_title") or split_title(desc),
        "author": a.get("nickname") or "",
        "author_url": f"https://www.douyin.com/user/{sec}" if sec else "",
        "date": ts_date(item.get("create_time") or item.get("createTime")),
        "desc": desc,
        "url": f"https://www.douyin.com/video/{aid}" if aid else "",
        "topics": list(dict.fromkeys(topics)),
        "stats": {
            "点赞": st.get("digg_count", st.get("diggCount")),
            "评论": st.get("comment_count", st.get("commentCount")),
            "收藏": st.get("collect_count", st.get("collectCount")),
            "分享": st.get("share_count", st.get("shareCount")),
        },
        "expect": d / 1000 if d > 1000 else d,
    }


def douyin_urls(item):
    v = item.get("video") or {}
    urls = []
    pa = v.get("play_addr") or {}
    urls += pa.get("url_list") or []
    for br in v.get("bit_rate") or []:
        urls += (br.get("play_addr") or {}).get("url_list") or []
    for x in v.get("playAddr") or []:
        urls.append(x.get("src"))
    for br in v.get("bitRateList") or []:
        for x in br.get("playAddr") or []:
            urls.append(x.get("src"))
    return [_abs(u).replace("playwm", "play") for u in urls if u]


def douyin_direct(url, tmp):
    final, _ = http_get(url)
    m = re.search(r"/(?:video|note|share/video)/(\d+)", final) or re.search(r"modal_id=(\d+)", final)
    if not m:
        raise RuntimeError("没找到抖音视频编号")
    vid = m.group(1)
    _, page = http_get(f"https://www.iesdouyin.com/share/video/{vid}/")
    m = re.search(r"window\._ROUTER_DATA\s*=\s*(\{.*?\})\s*</script>", page, re.S)
    if not m:
        raise RuntimeError("抖音页面结构变了")
    item_list = find_key(json.loads(m.group(1)), "item_list")
    if not item_list:
        raise RuntimeError("抖音页面里没有视频信息")
    item = item_list[0]
    meta = douyin_meta(item)
    meta["url"] = meta["url"] or f"https://www.douyin.com/video/{vid}"
    dest = os.path.join(tmp, "media.mp4")
    http_download(douyin_urls(item)[0], dest, referer="https://www.douyin.com/")
    return dest, meta


def xhs_direct(url, tmp):
    final, page = http_get(url, ua=DESKTOP_UA)
    m = re.search(r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*</script>", page, re.S)
    if not m:
        raise RuntimeError("小红书页面结构变了，或需要登录")
    data = json.loads(re.sub(r"\bundefined\b", "null", m.group(1)))
    note = find_key(data, "noteDetailMap")
    note = next(iter(note.values()))["note"] if isinstance(note, dict) and note else find_key(data, "note") or {}
    master = find_key(note, "masterUrl") or find_key(data, "masterUrl")
    if not master:
        raise RuntimeError("这条小红书不是视频笔记，或没解析到视频地址")
    dest = os.path.join(tmp, "media.mp4")
    http_download(master, dest, ua=DESKTOP_UA, referer="https://www.xiaohongshu.com/")
    user = note.get("user") or {}
    ii = note.get("interactInfo") or {}
    return dest, {
        "title": note.get("title") or split_title(note.get("desc")),
        "author": user.get("nickname") or "",
        "author_url": f"https://www.xiaohongshu.com/user/profile/{user['userId']}" if user.get("userId") else "",
        "date": ts_date(note.get("time")),
        "desc": note.get("desc") or "",
        "url": final.split("?")[0],
        "topics": [t.get("name") for t in note.get("tagList") or [] if t.get("name")],
        "stats": {"点赞": ii.get("likedCount"), "评论": ii.get("commentCount"),
                  "收藏": ii.get("collectedCount"), "分享": ii.get("shareCount")},
    }


def via_ytdlp(url, tmp):
    import yt_dlp
    opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(tmp, "media.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "noprogress": True,
        "http_headers": {"User-Agent": DESKTOP_UA},
    }
    if COOKIE_FILE and os.path.exists(COOKIE_FILE):
        opts["cookiefile"] = COOKIE_FILE
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        path = ydl.prepare_filename(info)
    if not os.path.exists(path):
        files = [os.path.join(tmp, f) for f in os.listdir(tmp) if f.startswith("media.")]
        if not files:
            raise RuntimeError("下载完成但没找到文件")
        path = files[0]
    d = info.get("upload_date") or ""
    return path, {
        "title": info.get("title") or "",
        "author": info.get("uploader") or info.get("channel") or "",
        "author_url": info.get("uploader_url") or info.get("channel_url") or "",
        "date": f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) == 8 else ts_date(info.get("timestamp")),
        "desc": info.get("description") or "",
        "url": info.get("webpage_url") or url,
        "topics": info.get("tags") or [],
        "stats": {"播放": info.get("view_count"), "点赞": info.get("like_count"),
                  "评论": info.get("comment_count"), "分享": info.get("repost_count")},
    }


PAGE = {}


def media_info(path):
    """返回（时长秒数，是否有声音）。"""
    import subprocess
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", out)
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0
    return dur, bool(re.search(r"Stream #.*Audio:", out))


def check_media(path, expect=0):
    dur, has_audio = media_info(path)
    if not has_audio:
        raise RuntimeError("下载到的文件只有画面没有声音")
    if dur < 4 or (expect and dur < expect * 0.6):
        raise RuntimeError(f"下载到的只是{dur:.0f}秒的片段")


def _abs(u):
    return "https:" + u if u and u.startswith("//") else u


def via_douyin_page(url, tmp):
    """用软件后台打开抖音网页时拿到的视频详情和音视频地址下载。"""
    meta = {"title": split_title(PAGE.get("title")), "author": PAGE.get("author") or "",
            "date": "", "desc": PAGE.get("title") or "", "url": url}
    m = re.search(r"/video/(\d+)|modal_id=(\d+)", PAGE.get("finalUrl") or "")
    if m:
        meta["url"] = f"https://www.douyin.com/video/{m.group(1) or m.group(2)}"
    cands, item = [], None
    for raw, key in ((PAGE.get("detail"), "aweme_detail"), (PAGE.get("render"), "awemeDetail")):
        if item or not raw:
            continue
        try:
            item = find_key(json.loads(raw), key)
        except Exception:  # noqa: BLE001
            item = None
    if item:
        got = douyin_meta(item)
        meta.update({k: v for k, v in got.items() if v})
        cands += douyin_urls(item)
    expect = meta.pop("expect", 0) or 0
    media = PAGE.get("media") or []
    is_audio = lambda u: re.search(r"media-audio|mime_type=audio|audio_mp4|\.m4a", u or "", re.I)
    cands += [u for u in media if is_audio(u)] + list(PAGE.get("srcs") or []) + [u for u in media if not is_audio(u)]
    seen, errs = set(), []
    for i, u in enumerate(c for c in cands if c):
        key = u.split("?")[0]
        if key in seen:
            continue
        seen.add(key)
        dest = os.path.join(tmp, f"page_{i}.mp4")
        try:
            http_download(u, dest, ua=DESKTOP_UA, referer="https://www.douyin.com/")
            check_media(dest, expect)
            return dest, meta
        except Exception as e:  # noqa: BLE001
            errs.append(str(e)[:60])
            if os.path.exists(dest):
                os.remove(dest)
        if len(seen) >= 8:
            break
    raise RuntimeError("网页里没找到带声音的完整视频" + (f"（{errs[-1]}）" if errs else ""))


def find_obj(obj, pred, depth=0):
    """在嵌套 JSON 里找第一个满足条件的字典。"""
    if depth > 40:
        return None
    if isinstance(obj, dict):
        if pred(obj):
            return obj
        vals = obj.values()
    elif isinstance(obj, list):
        vals = obj
    else:
        return None
    for v in vals:
        r = find_obj(v, pred, depth + 1)
        if r is not None:
            return r
    return None


def via_xhs_page(url, tmp):
    """用软件后台打开小红书分享页时拿到的笔记数据和视频地址下载。"""
    if "/login" in (PAGE.get("finalUrl") or ""):
        raise RuntimeError("小红书要求登录")
    meta = {"title": split_title(PAGE.get("title")), "author": "", "date": "", "desc": "", "url": url}
    cands = []
    note = None
    if PAGE.get("state"):
        try:
            data = json.loads(PAGE["state"])
            note = find_obj(data, lambda d: isinstance(d.get("video"), dict) and ("desc" in d or "title" in d)) \
                or find_obj(data, lambda d: "interactInfo" in d and ("desc" in d or "title" in d))
        except Exception:  # noqa: BLE001
            note = None
    if note:
        user = note.get("user") or {}
        ii = note.get("interactInfo") or {}
        uid = user.get("userId") or user.get("userid") or ""
        nid = note.get("noteId") or note.get("id") or ""
        meta.update({
            "title": note.get("title") or split_title(note.get("desc")),
            "author": user.get("nickname") or user.get("nickName") or "",
            "author_url": f"https://www.xiaohongshu.com/user/profile/{uid}" if uid else "",
            "date": ts_date(note.get("time")),
            "desc": note.get("desc") or "",
            "url": PAGE.get("finalUrl") if "xsec_token" in (PAGE.get("finalUrl") or "") else
                   (f"https://www.xiaohongshu.com/explore/{nid}" if nid else url),
            "topics": [t.get("name") for t in note.get("tagList") or [] if isinstance(t, dict) and t.get("name")],
            "stats": {"点赞": ii.get("likedCount"), "评论": ii.get("commentCount"),
                      "收藏": ii.get("collectedCount"), "分享": ii.get("shareCount")},
        })
        for key in ("masterUrl", "backupUrls"):
            v = find_key(note.get("video") or {}, key)
            cands += v if isinstance(v, list) else [v]
    cands += list(PAGE.get("srcs") or []) + list(PAGE.get("media") or [])
    seen, errs = set(), []
    for i, u in enumerate(_abs(c) for c in cands if c):
        key = u.split("?")[0]
        if key in seen:
            continue
        seen.add(key)
        dest = os.path.join(tmp, f"xhs_{i}.mp4")
        try:
            http_download(u, dest, ua=DESKTOP_UA, referer="https://www.xiaohongshu.com/")
            check_media(dest)
            return dest, meta
        except Exception as e:  # noqa: BLE001
            errs.append(str(e)[:60])
            if os.path.exists(dest):
                os.remove(dest)
        if len(seen) >= 8:
            break
    if not note and not cands:
        raise RuntimeError("网页里没读到笔记内容，可能需要登录小红书")
    raise RuntimeError("网页里没找到带声音的视频" + (f"（{errs[-1]}）" if errs else ""))


def fetch_media(url, tmp):
    plat = platform_of(url)
    if plat == "抖音":
        order = [via_douyin_page, via_ytdlp, douyin_direct]
    elif plat == "小红书":
        order = [via_xhs_page, via_ytdlp, xhs_direct]
    else:
        order = [via_ytdlp]
    errors = []
    for fn in order:
        try:
            path, meta = fn(url, tmp)
            check_media(path)
            meta.pop("expect", None)
            return path, meta
        except Exception as e:  # noqa: BLE001
            msg = str(e).replace("ERROR: ", "")
            errors.append(f"· {msg[:110]}")
            for f in os.listdir(tmp):
                os.remove(os.path.join(tmp, f))
    head = "下载失败。"
    if plat == "小红书" and any("登录" in e or "login" in e for e in errors):
        head = "小红书要求登录：点窗口底部“设置”里的“登录小红书”，扫码一次后再扒。"
    raise RuntimeError(head + "\n" + "\n".join(errors[:3]))


# ---------------- 转写与整理 ----------------
SENSEVOICE = "iic/SenseVoiceSmall"
HOTWORDS, FIXES = [], []


def load_wordbook(path):
    """读取 Obsidian 里的“公考热词库”：## 热词 一行一个；## 纠错 写成“错 → 对”。"""
    if not path or not os.path.exists(path):
        return
    section = ""
    for raw in open(path, encoding="utf-8"):
        line = raw.strip()
        if line.startswith("#"):
            section = "热词" if "热词" in line else "纠错" if "纠错" in line else ""
            continue
        line = re.sub(r"^[-*+]\s*|^\d+[.、]\s*", "", line).strip()
        if not line or line.startswith(">") or line.startswith("示例"):
            continue
        if section == "热词":
            for w in re.split(r"[、，,；;\s]+", line):
                if w and w not in HOTWORDS:
                    HOTWORDS.append(w)
        elif section == "纠错":
            m = re.split(r"\s*(?:→|->|=>|＝>|＞)\s*", line, maxsplit=1)
            if len(m) == 2 and m[0] and m[1]:
                FIXES.append((m[0], m[1]))


def apply_fixes(text):
    for wrong, right in sorted(FIXES, key=lambda x: -len(x[0])):
        text = text.replace(wrong, right)
    return text


def to_audio(src, tmp, fmt="wav"):
    """统一转成 16k 单声道音频，识别更稳，也方便上传。"""
    import subprocess
    dest = os.path.join(tmp, f"audio.{fmt}")
    args = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000"]
    args += ["-b:a", "48k", dest] if fmt == "mp3" else [dest]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(dest):
        raise RuntimeError("音频转换失败：" + (r.stderr.strip().splitlines() or ["未知原因"])[-1])
    return dest


_sv = None


def sensevoice_ready():
    return os.path.isdir(os.path.expanduser(f"~/.cache/modelscope/hub/models/{SENSEVOICE}")) or \
        os.path.isdir(os.path.expanduser(f"~/.cache/modelscope/hub/{SENSEVOICE}"))


def transcribe_sensevoice(path, tmp):
    global _sv
    wav = to_audio(path, tmp, "wav")
    try:
        if _sv is None:
            import logging
            logging.disable(logging.WARNING)
            from funasr import AutoModel
            _sv = AutoModel(model=SENSEVOICE, vad_model="fsmn-vad",
                            vad_kwargs={"max_single_segment_time": 30000},
                            device="cpu", disable_update=True, disable_pbar=True, log_level="ERROR")
        res = _sv.generate(input=wav, language="zh", use_itn=True, batch_size_s=60,
                           merge_vad=True, merge_length_s=15)
    except Exception as e:  # noqa: BLE001
        tail = [l for l in str(e).splitlines() if l.strip()]
        raise RuntimeError("转写失败：" + (tail[-1] if tail else "未知原因"))
    text = "".join(r.get("text", "") for r in res)
    text = re.sub(r"<\|[^|]*\|>", "", text)
    text = re.sub(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]", "", text)  # 去掉情绪、背景音标记
    return [text]


DOUBAO_BASE = "https://openspeech.bytedance.com/api/v3/auc/bigmodel"


def _doubao_post(url, payload, rid, resource, app_id, token):
    r = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json", "X-Api-App-Key": app_id, "X-Api-Access-Key": token,
                 "X-Api-Resource-Id": resource, "X-Api-Request-Id": rid, "X-Api-Sequence": "-1"})
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            return resp.headers.get("X-Api-Status-Code", ""), resp.headers.get("X-Api-Message", ""), resp.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return e.headers.get("X-Api-Status-Code", str(e.code)), e.headers.get("X-Api-Message", ""), e.read().decode("utf-8", "ignore")


def _doubao_error(code, msg, raw):
    hint = msg or raw[:120] or code
    if "not granted" in hint or code in ("401", "403"):
        return "not_granted", hint
    if code == "20000003":
        return "silence", "没识别到人声"
    return "other", hint


def _doubao_text(raw):
    data = json.loads(raw or "{}")
    result = data.get("result") or {}
    if isinstance(result, list):
        result = result[0] if result else {}
    utts = [u.get("text", "") for u in result.get("utterances") or [] if u.get("text")]
    return utts or ([result["text"]] if result.get("text") else [])


def transcribe_doubao(path, tmp):
    """豆包录音文件识别：优先用 2.0 标准版（提交后轮询结果），没开通再试极速版。"""
    import base64
    import time
    import uuid
    app_id = os.environ.get("VOLC_APP_ID", "").strip()
    token = os.environ.get("VOLC_TOKEN", "").strip()
    if not app_id or not token:
        raise RuntimeError("还没填豆包的 App ID 和 Access Token")
    mp3 = to_audio(path, tmp, "mp3")
    if os.path.getsize(mp3) > 90 * 1024 * 1024:
        raise RuntimeError("视频太长，超过豆包单次上传的上限")
    audio_b64 = base64.b64encode(open(mp3, "rb").read()).decode()

    def build(with_words):
        req = {"model_name": "bigmodel", "enable_itn": True, "enable_punc": True, "show_utterances": True}
        if with_words and HOTWORDS:
            req["corpus"] = {"context": json.dumps({"hotwords": [{"word": w} for w in HOTWORDS[:500]]}, ensure_ascii=False)}
        return {"user": {"uid": "link-transcriber"},
                "audio": {"data": audio_b64, "format": "mp3", "language": "zh-CN"},
                "request": req}

    errors = []
    # ① 2.0 标准版：提交 → 轮询
    for with_words in (True, False):
        rid = str(uuid.uuid4())
        code, msg, raw = _doubao_post(DOUBAO_BASE + "/submit", build(with_words), rid, "volc.seedasr.auc", app_id, token)
        if code == "20000000":
            deadline = time.time() + 1200
            while time.time() < deadline:
                time.sleep(2)
                code, msg, raw = _doubao_post(DOUBAO_BASE + "/query", {}, rid, "volc.seedasr.auc", app_id, token)
                try:
                    body_code = str((json.loads(raw or "{}").get("header") or {}).get("code") or "")
                except Exception:  # noqa: BLE001
                    body_code = ""
                code = body_code or code
                if code in ("20000001", "20000002"):
                    continue
                if code == "20000000":
                    texts = _doubao_text(raw)
                    if texts:
                        return texts
                    continue
                kind, hint = _doubao_error(code, msg, raw)
                if kind == "silence":
                    raise RuntimeError("豆包识别失败：没识别到人声")
                errors.append(hint)
                break
            else:
                raise RuntimeError("豆包识别超时")
            break
        kind, hint = _doubao_error(code, msg, raw)
        if kind == "silence":
            raise RuntimeError("豆包识别失败：没识别到人声")
        errors.append(hint)
        if kind == "not_granted" or not with_words or not HOTWORDS:
            break  # 没开通就不用再试；带热词失败时去掉热词再试一次

    # ② 极速版（一次返回）
    code, msg, raw = _doubao_post(DOUBAO_BASE + "/recognize/flash", build(True), str(uuid.uuid4()), "volc.bigasr.auc_turbo", app_id, token)
    if code == "20000000":
        return _doubao_text(raw)
    kind, hint = _doubao_error(code, msg, raw)
    if kind == "silence":
        raise RuntimeError("豆包识别失败：没识别到人声")
    errors.append(hint)
    if all("not granted" in e for e in errors):
        raise RuntimeError("豆包识别失败：火山引擎里还没开通“豆包录音文件识别模型2.0”，或密钥填错了")
    raise RuntimeError("豆包识别失败：" + errors[0][:150])


def transcribe(path, tmp, engine):
    if engine == "doubao":
        try:
            return transcribe_doubao(path, tmp), "豆包"
        except Exception as e:  # noqa: BLE001
            step(f"{str(e)[:80]}，改用免费的本地识别……")
    return transcribe_sensevoice(path, tmp), "SenseVoice"


_cc = None


def to_simplified(t):
    global _cc
    try:
        if _cc is None:
            from opencc import OpenCC
            _cc = OpenCC("t2s")
        return _cc.convert(t)
    except Exception:  # noqa: BLE001
        return t


CJK = r"一-鿿"
END_PUNCT = "。！？，、；：…”’）》」』"


def tidy(segments):
    parts = []
    for s in segments:
        s = to_simplified(s.strip())
        if not s:
            continue
        s = s.replace(",", "，").replace("?", "？").replace("!", "！").replace(";", "；")
        s = re.sub(rf"(?<=[{CJK}]):", "：", s)
        s = re.sub(rf"(?<=[{CJK}])\s+(?=[{CJK}])", "，", s)
        s = re.sub(rf"(?<=[{CJK}，。！？])\s+(?=[0-9A-Za-z])|(?<=[0-9A-Za-z])\s+(?=[{CJK}])", "", s)
        if s[-1] not in END_PUNCT:
            s += "，"
        parts.append(s)
    text = "".join(parts)
    text = re.sub(r"，+", "，", text)
    text = re.sub(r"([。！？])，", r"\1", text)

    # 按句号断成段，每段约 180 字
    sentences = re.findall(r"[^。！？]+[。！？]?", text)
    paras, buf = [], ""
    for sen in sentences:
        buf += sen
        if len(buf) >= 180 and buf[-1] in "。！？":
            paras.append(buf)
            buf = ""
        elif len(buf) >= 320:  # 长时间没有句号，在逗号处硬断
            cut = buf.rfind("，")
            if cut > 100:
                paras.append(buf[:cut] + "。")
                buf = buf[cut + 1:]
    if buf:
        paras.append(buf)
    paras = [p[:-1] + "。" if p and p[-1] == "，" else p for p in paras]
    return "\n\n".join(p.strip() for p in paras if p.strip())


# ---------------- 写入 Obsidian ----------------
def safe_name(s, limit=50):
    s = re.sub(r"#\S+", "", s or "")  # 去掉话题标签
    s = re.sub(r"[\\/:*?\"<>|#^\[\]\r\n\t]", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" .")
    return s[:limit].strip() or ""


def yaml_str(s):
    return json.dumps(s or "", ensure_ascii=False)


def write_note(out_root, meta, body, platform, duration):
    author = safe_name(meta.get("author"), 30) or "未知博主"
    title = safe_name(meta.get("title")) or f"{platform}视频_{datetime.datetime.now():%Y-%m-%d_%H-%M-%S}"
    folder = os.path.join(out_root, author)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, title + ".md")
    n = 2
    while os.path.exists(path):
        path = os.path.join(folder, f"{title}（{n}）.md")
        n += 1
    mins, secs = divmod(int(duration or 0), 60)
    lines = [
        "---",
        f"标题: {yaml_str(meta.get('title') or title)}",
        f"博主: {yaml_str(meta.get('author') or '未知博主')}",
    ]
    if meta.get("author_url"):
        lines.append(f"博主主页: {yaml_str(meta['author_url'])}")
    lines += [
        f"平台: {platform}",
        f"链接: {yaml_str(meta.get('url'))}",
        f"发布日期: {meta.get('date') or ''}",
        f"时长: {mins}分{secs}秒" if duration else "时长: ",
    ]
    for k, v in (meta.get("stats") or {}).items():
        if v is None or v == "":
            continue
        lines.append(f"{k}: {v}" if isinstance(v, int) else f"{k}: {yaml_str(str(v))}")
    topics = [t for t in (meta.get("topics") or []) if t]
    if topics:
        lines.append("话题:")
        lines += [f"  - {yaml_str(t)}" for t in topics[:15]]
    lines += [
        f"提取日期: {datetime.date.today().isoformat()}",
        f"识别引擎: {meta.get('engine') or ''}",
        "tags:",
        "  - 博主逐字稿",
        "---",
        "",
    ]
    desc = clean_desc(meta.get("desc"))
    if desc and safe_name(desc, 999) != safe_name(meta.get("title"), 999):
        lines += ["## 简介", "", desc, ""]
    lines += ["## 逐字稿", "", body, "", "## 亮点笔记", "", ""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return path, title, author


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", help="分享链接或分享文案")
    ap.add_argument("--file", help="本地视频或音频文件")
    ap.add_argument("--out", help="笔记保存的根文件夹")
    ap.add_argument("--warmup", action="store_true", help="只下载语音模型")
    ap.add_argument("--cookies", help="浏览器 Cookie 文件")
    ap.add_argument("--page", help="后台打开网页时保存的页面数据")
    ap.add_argument("--engine", default="sensevoice", choices=["sensevoice", "doubao"])
    ap.add_argument("--wordbook", help="公考热词库笔记路径")
    ap.add_argument("--test-doubao", action="store_true", help="测试豆包密钥和服务是否可用")
    a = ap.parse_args()
    if a.test_doubao:
        import subprocess
        tmp = tempfile.mkdtemp(prefix="bagao_")
        try:
            src = os.path.join(tmp, "beep.wav")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", src], check=True)
            try:
                transcribe_doubao(src, tmp)
                emit(type="done", text="连接成功，豆包可以用了。")
            except RuntimeError as e:
                if "没识别到人声" in str(e):
                    emit(type="done", text="连接成功，豆包可以用了。")
                else:
                    emit(type="error", text=str(e))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        return
    global COOKIE_FILE
    COOKIE_FILE = a.cookies
    if a.page and os.path.exists(a.page):
        try:
            PAGE.update(json.load(open(a.page, encoding="utf-8")))
        except Exception:  # noqa: BLE001
            pass

    if a.warmup:
        from modelscope import snapshot_download
        print("正在下载 SenseVoice 语音模型（约1GB，只需一次）……", flush=True)
        for m in (SENSEVOICE, "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch"):
            snapshot_download(m)
        print("语音模型已就绪。", flush=True)
        return

    load_wordbook(a.wordbook)
    tmp = tempfile.mkdtemp(prefix="bagao_")
    try:
        if a.file:
            platform = "本地文件"
            media = a.file
            meta = {"title": os.path.splitext(os.path.basename(a.file))[0], "author": "本地文件",
                    "url": "", "date": "", "desc": ""}
        else:
            url = pick_url(a.input)
            if not url:
                raise RuntimeError("没识别到链接，请粘贴完整的分享链接或分享文案")
            platform = platform_of(url)
            step(f"识别到{platform}链接，正在下载……")
            media, meta = fetch_media(url, tmp)
            emit(type="meta", title=safe_name(meta.get("title")), author=meta.get("author"), platform=platform)

        duration = int(media_info(media)[0])
        if a.engine == "sensevoice" and not sensevoice_ready():
            step("首次使用，正在下载语音模型（约1GB，只需一次）……")
        tip = f"（视频约{duration // 60}分{duration % 60}秒）" if duration else ""
        step(f"正在用{'豆包' if a.engine == 'doubao' else '本地模型'}转写{tip}……")
        segs, used = transcribe(media, tmp, a.engine)
        body = apply_fixes(tidy(segs))
        if not body:
            raise RuntimeError("没识别到人声内容")
        meta["engine"] = used
        step("正在写入 Obsidian……")
        path, title, author = write_note(a.out, meta, body, platform, duration)
        emit(type="done", path=path, title=title, author=author, platform=platform,
             chars=len(re.sub(r"\s", "", body)), text=body, engine=used)
    except Exception as e:  # noqa: BLE001
        emit(type="error", text=str(e)[:500])
        sys.exit(1)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()

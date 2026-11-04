#!/usr/bin/env python3
"""随身记·Mac后台自动整理

每5分钟由macOS后台运行一次：
1. 检查最近14天的随身记笔记，找出还没整理的录音；
2. 等你停止说话3分钟后，调用Claude Code重新整理当天全部原文；
3. 把整理结果写进笔记上方“整理版”区域，原文一个字不动。
Mac关机期间没整理的，开机后会自动补上。

手动立刻整理（不等3分钟）：python3 organize.py --now
"""
import datetime
import fcntl
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

FOLDER = os.path.expanduser(
    "~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/1.日记和待办/随身记")
PROXY = "http://127.0.0.1:7897"  # Clash Verge的混合代理端口；Claude Code要走代理才能用
IDLE_SECONDS = 20 * 60      # 停止记录20分钟后整理
MAX_WAIT_SECONDS = 60 * 60  # 一直在记的话，最早一条没整理的录音满1小时也会整理
DAYS_BACK = 14
LOG = os.path.expanduser("~/Library/Logs/随身记整理.log")
LOCK = os.path.expanduser("~/Library/Caches/suishenji-organizer.lock")

FRONT = "---\ncssclasses: suishenji\n---\n"
START = "<!-- 整理版开始 -->"
END = "<!-- 整理版结束 -->"
MARK_RE = re.compile(r"<!-- 已整理到第(\d+)条 -->")
ENTRY_RE = re.compile(r"^### (\d+)\. (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*$", re.M)
WEEK = "一二三四五六日"


def allow_icloud_download():
    """后台程序默认不允许触发iCloud下载（读文件会报Resource deadlock avoided），这里给本进程打开"""
    try:
        import ctypes
        libc = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
        # IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES=3, IOPOL_SCOPE_PROCESS=0, IOPOL_MATERIALIZE_DATALESS_FILES_ON=2
        libc.setiopolicy_np(3, 0, 2)
    except Exception:
        pass


def log(msg):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def find_claude():
    extra = [
        os.path.expanduser("~/.local/bin"),
        os.path.expanduser("~/.claude/local"),
        os.path.expanduser("~/.npm-global/bin"),
        "/opt/homebrew/bin", "/usr/local/bin",
    ] + sorted(glob.glob(os.path.expanduser("~/.nvm/versions/node/*/bin")), reverse=True)
    path = os.environ.get("PATH", "") + ":" + ":".join(extra)
    os.environ["PATH"] = path
    return shutil.which("claude", path=path)


def read_glossary():
    p = os.path.join(FOLDER, "词库.md")
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def build_prompt(day, raw, glossary):
    d = datetime.date.fromisoformat(day)
    return f"""你是Bob的随身记整理助手。下面是他在{day}（星期{WEEK[d.weekday()]}）用手机语音转文字记下的原文，每段有编号和时间。请整理成“整理版”。

要求：
1. 整理成一份像待办清单一样的分类清单。类别按内容判断，比如“待办”“课程想法”“内容选题”“生活琐事”“灵感”等，每个类别用“#### 类别名”做小标题，没有内容的类别不写。“待办”有的话放最前面。
2. 实在判断不了归哪一类的，统一放进最后的“#### 待分类”，不要硬塞进别的类别。
3. 每一条都写成复选框：“- [ ] 要点内容（原文3 · 12:51）”，括号里标来源原文编号和时间（只写时和分）。一段原文说了好几件事，就拆成几条，分别归类。
4. 参考下面的词库，修正语音识别错的词，特别是中英文混杂的词；修正明显的同音错字；把不通顺的句子理顺，去掉“这个”“然后”之类的口头语。但不改变Bob的原意，不添加原文没有的内容，不替他做判断。
5. 原文里的图片和视频写成“![[文件名]]”（.jpg是图片，.mp4是视频）。同一条原文里的图片、视频和文字是捆绑在一起的（文字是Bob对它们的说明）。图片你看不到内容，就根据同一条原文的文字判断它属于哪一类，要点内容写说明的意思；把“![[文件名]]”原样放在对应那条要点的下一行（前面缩进两个空格），只有图片或视频、没有文字的，放进“待分类”并写“- [ ] 图片记录（原文N · 时:分）”或“- [ ] 视频记录（原文N · 时:分）”。
6. 原文里说到“明天”“下周三”“11月11日之前”这类时间，要保留，并在后面括号里换算出具体日期，比如“明天（11月5日）”；有截止时间的待办，把截止时间写在最前面。
7. 标点全部用中文全角，不用破折号。
8. 最前面用一句话写“今日一句话”，概括这一天记录的主要内容。直接写“今天主要……”，不要用“Bob”或第三人称。
9. 只输出整理版正文，不要开场白，不要解释，不要用代码块包起来，不要再输出原文。

【词库】
{glossary or "（暂无）"}

【原文】
{raw}
"""


def call_claude(claude, prompt):
    env = dict(os.environ)
    if PROXY:
        env.setdefault("HTTPS_PROXY", PROXY)
        env.setdefault("HTTP_PROXY", PROXY)
    with tempfile.TemporaryDirectory() as cwd:
        r = subprocess.run([claude, "-p", "--output-format", "text"],
                           input=prompt, capture_output=True, text=True,
                           timeout=600, cwd=cwd, env=env)
    if r.returncode != 0:
        msg = (r.stderr or r.stdout).strip()[:500]
        if "403" in msg or "onnect" in msg:
            msg += "（请确认Clash Verge开着）"
        raise RuntimeError(msg)
    out = r.stdout.strip()
    out = re.sub(r"^```[a-zA-Z]*\n", "", out)
    out = re.sub(r"\n```$", "", out)
    return out.strip()


def ensure_block(content, day):
    if START in content and END in content:
        return content
    block = f"## 整理版\n{START}\n（等待Mac整理）\n{END}\n\n"
    i = content.find("## 原文")
    if i >= 0:
        return content[:i] + block + content[i:]
    if content.startswith(FRONT):
        return FRONT + block + content[len(FRONT):]
    return block + content


INBOXES = [os.path.join(FOLDER, ".收件箱"), os.path.join(FOLDER, "_收件箱")]  # 新版用隐藏文件夹，旧版的也一并处理
UPDATE_RE = re.compile(r"^update: (caption|delete|replace)\s*$", re.M)
IMAGES_RE = re.compile(r"^images: (.+)$", re.M)
TIME_RE = re.compile(r"^time: (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\s*$", re.M)


def day_path(day):
    """每天的笔记放在 随身记/年/年-月/ 里，长期用也好找；旧的平铺文件会自动挪进去"""
    folder = os.path.join(FOLDER, day[:4], day[:7])
    path = os.path.join(folder, f"{day}.md")
    old = os.path.join(FOLDER, f"{day}.md")
    if os.path.exists(old) and not os.path.exists(path):
        os.makedirs(folder, exist_ok=True)
        os.replace(old, path)
    return path


def replace_entry(day, stamp, text):
    """手机上手动改过的文字：替换这一条的文字，图片视频保留，并让当天重新整理"""
    path = day_path(day)
    if not os.path.exists(path):
        return append_entry(day, stamp, text)
    with open(path, encoding="utf-8") as f:
        content = f.read()
    m = re.search(rf"^### \d+\. {re.escape(stamp)}\s*$", content, re.M)
    if not m:
        return append_entry(day, stamp, text)
    nxt = content.find("\n### ", m.end())
    end = len(content) if nxt < 0 else nxt
    old = content[m.end():end]
    embeds = [l for l in old.splitlines() if l.strip().startswith("![[")]
    body = text.strip()
    if embeds:
        body = (body + "\n\n" + "\n".join(embeds)).strip()
    content = content[:m.end()].rstrip("\n") + "\n\n" + body + "\n" + content[end:]
    content = MARK_RE.sub("", content)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)
    return True


def delete_entry(day, stamp):
    """手机上删掉的记录，从原文里删掉，并让当天重新整理"""
    path = day_path(day)
    if not os.path.exists(path):
        return False
    with open(path, encoding="utf-8") as f:
        content = f.read()
    m = re.search(rf"^### \d+\. {re.escape(stamp)}\s*$", content, re.M)
    if not m:
        return False
    nxt = content.find("\n### ", m.end())
    end = len(content) if nxt < 0 else nxt + 1
    content = content[:m.start()] + content[end:]
    content = MARK_RE.sub("", content)  # 去掉“已整理到”标记，整天重新整理
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)
    return True


def append_entry(day, stamp, text):
    """把一条录音追加到当天笔记“原文”末尾；同一时间已存在就跳过（去重）"""
    path = day_path(day)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            content = f.read()
    else:
        content = f"{FRONT}## 整理版\n{START}\n（等待Mac整理）\n{END}\n\n## 原文\n"
    if not content.startswith("---"):
        content = FRONT + content  # 让随身记笔记里的图片视频按小尺寸显示
    if f". {stamp}\n" in content:
        return False
    i = content.find("## 原文")
    raw = content[i:] if i >= 0 else content
    nums = [int(m.group(1)) for m in ENTRY_RE.finditer(raw)]
    n = max(nums) + 1 if nums else 1
    if not content.endswith("\n"):
        content += "\n"
    content += f"\n### {n}. {stamp}\n\n{text.strip()}\n"
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)
    return True


def add_caption(day, stamp, text):
    """给已经在笔记里的那条（通常是图片）补上语音说明，并让当天重新整理"""
    path = day_path(day)
    if not os.path.exists(path):
        return append_entry(day, stamp, text)
    with open(path, encoding="utf-8") as f:
        content = f.read()
    m = re.search(rf"^### (\d+)\. {re.escape(stamp)}\s*$", content, re.M)
    if not m:
        return append_entry(day, stamp, text)
    n = int(m.group(1))
    nxt = content.find("\n### ", m.end())
    end = len(content) if nxt < 0 else nxt
    block = content[m.end():end].rstrip("\n")
    content = content[:m.end()] + block + f"\n\n{text.strip()}\n" + content[end:]
    mk = MARK_RE.search(content)
    if mk and int(mk.group(1)) >= n:
        content = content[:mk.start()] + f"<!-- 已整理到第{n - 1}条 -->" + content[mk.end():]
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)
    return True


def merge_inbox():
    """把手机放进收件箱的录音按时间顺序合并进当天笔记，合并后删掉小文件"""
    items = []
    for inbox in INBOXES:
        if not os.path.isdir(inbox):
            continue
        try:
            names = os.listdir(inbox)
        except PermissionError:
            log("没有权限读取iCloud里的收件箱：请在“系统设置→隐私与安全性→完全磁盘访问权限”里打开SuiShenJiOrganizer")
            continue
        for name in names:
            full = os.path.join(inbox, name)
            if name.endswith(".icloud"):
                subprocess.run(["brctl", "download", os.path.join(inbox, name[1:-7])], capture_output=True)
                continue
            if not name.endswith(".md") or name.startswith("."):
                continue
            try:
                with open(full, encoding="utf-8") as f:
                    body = f.read()
            except OSError as ex:
                # 文件还在iCloud云端没下载下来：请求下载，下一分钟再读
                subprocess.run(["brctl", "download", full], capture_output=True)
                log(f"{name}：还在从iCloud下载（{ex.strerror}），下次再合并")
                continue
            m = TIME_RE.search(body)
            if not m:
                log(f"收件箱文件格式不对，跳过：{name}")
                continue
            rest = body[m.end():]
            um = UPDATE_RE.search(rest)
            kind = {"caption": 1, "delete": 2, "replace": 3}.get(um.group(1), 0) if um else 0
            rest = UPDATE_RE.sub("", rest)
            im = IMAGES_RE.search(rest)
            text = rest[:im.start()] + rest[im.end():] if im else rest
            text = text.strip()
            if im:
                embeds = "\n".join(f"![[{n.strip()}]]" for n in im.group(1).split(",") if n.strip())
                text = (text + "\n\n" + embeds).strip()
            items.append((f"{m.group(1)} {m.group(2)}", kind, m.group(1), text, full))
    # 同一时间的记录排在它的补充说明前面
    for stamp, kind, day, text, full in sorted(items):
        try:
            if kind == 3:
                added = replace_entry(day, stamp, text)
            elif kind == 2:
                added = delete_entry(day, stamp)
            elif kind == 1:
                added = add_caption(day, stamp, text) if text else False
            else:
                added = append_entry(day, stamp, text) if text else False
            os.remove(full)
            what = {0: "收到录音", 1: "补充说明", 2: "删除记录", 3: "修改文字"}[kind]
            log(f"{day}：{what} {stamp[11:]}" + ("" if added else "（没有变化）"))
        except Exception as ex:
            log(f"合并收件箱失败：{os.path.basename(full)}：{ex}")
    old = INBOXES[1]
    if os.path.isdir(old):
        try:
            os.rmdir(old)  # 旧收件箱清空后删掉，不在Obsidian里占地方
        except OSError:
            pass


def process(path, claude, force):
    day = os.path.basename(path)[:-3]
    with open(path, encoding="utf-8") as f:
        content = f.read()
    nums = [int(m.group(1)) for m in ENTRY_RE.finditer(content)]
    if not nums:
        return
    total = max(nums)
    m = MARK_RE.search(content)
    done = int(m.group(1)) if m else 0
    if total <= done:
        return
    idle = time.time() - os.path.getmtime(path)
    pending = [m.group(2) for m in ENTRY_RE.finditer(content) if int(m.group(1)) > done]
    try:
        oldest = min(datetime.datetime.strptime(t, "%Y-%m-%d %H:%M:%S") for t in pending)
        waited = (datetime.datetime.now() - oldest).total_seconds()
    except ValueError:
        waited = 0
    if not force and idle < IDLE_SECONDS and waited < MAX_WAIT_SECONDS:
        return

    i = content.find("## 原文")
    raw = content[i + len("## 原文"):].strip() if i >= 0 else content
    log(f"{day}：开始整理（共{total}条，之前整理到第{done}条）")
    result = call_claude(claude, build_prompt(day, raw, read_glossary()))
    if not result:
        raise RuntimeError("Claude没有返回内容")

    # 写回前重新读一次，避免覆盖手机刚追加的原文
    with open(path, encoding="utf-8") as f:
        content = ensure_block(f.read(), day)
    s = content.index(START) + len(START)
    e = content.index(END)
    stamp = f"{datetime.datetime.now():%Y-%m-%d %H:%M}"
    new_block = f"\n<!-- 已整理到第{total}条 -->\n> 自动整理于{stamp}，共{total}条原文\n\n{result}\n"
    content = content[:s] + new_block + content[e:]
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)
    log(f"{day}：整理完成")


def main():
    allow_icloud_download()
    force = "--now" in sys.argv
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return  # 上一次还在跑
    if not os.path.isdir(FOLDER):
        log(f"找不到文件夹：{FOLDER}")
        return
    merge_inbox()
    claude = find_claude()
    if not claude:
        log("找不到claude命令，请确认Claude Code已安装")
        return

    today = datetime.date.today()
    for k in range(DAYS_BACK):
        day = (today - datetime.timedelta(days=k)).isoformat()
        path = day_path(day)
        placeholder = os.path.join(os.path.dirname(path), f".{day}.md.icloud")
        if not os.path.exists(path):
            if os.path.exists(placeholder):
                subprocess.run(["brctl", "download", path], capture_output=True)
                log(f"{day}：文件还在iCloud云端，已请求下载，下次再整理")
            continue
        try:
            process(path, claude, force)
        except Exception as ex:  # 单个文件失败不影响其他天
            log(f"{day}：整理失败：{ex}")


if __name__ == "__main__":
    main()

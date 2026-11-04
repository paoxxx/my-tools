#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""人民时评批量抓取：人民网栏目页 -> Obsidian Markdown（标题、日期、正文）
只用 Python 自带库。可重复运行，已存在的文章自动跳过。
按“年份＋月份”分文件夹；去掉作者、编者、笔者、执笔、报纸版次等信息。
"""
import os, re, time, urllib.request
from html.parser import HTMLParser
from html import unescape

LIST_URL = "http://opinion.people.com.cn/GB/8213/49160/49219/index{}.html"
OUT_DIR = os.path.expanduser(
    "~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/21-公考素材库/人民日报/人民时评")
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"}
DELAY = 1.5


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
    m = re.search(rb'charset=["\']?([\w-]+)', raw[:3000], re.I)
    enc = m.group(1).decode().lower() if m else "utf-8"
    if enc in ("gb2312", "gbk"):
        enc = "gb18030"
    try:
        return raw.decode(enc)
    except Exception:
        return raw.decode("gb18030", errors="ignore")


LINK_RE = re.compile(
    r'<a[^>]+href=["\']([^"\']*/n1/(\d{4})/(\d{2})(\d{2})/c\d+-\d+\.html)["\'][^>]*>(.*?)</a>', re.S)


def list_articles():
    arts, seen, n = [], set(), 1
    while n <= 60:
        url = LIST_URL.format("" if n == 1 else n)
        try:
            html = fetch(url)
        except Exception as e:
            print(f"列表第{n}页读取结束（{e}）")
            break
        # 只取文章列表区域：分页信息“第xx条”之前，避开侧栏排行榜
        m = re.search(r"第\s*\d+\s*条", html)
        region = html[:m.start()] if m else html
        new = 0
        for href, y, mo, d, title in LINK_RE.findall(region):
            link = href if href.startswith("http") else "http://opinion.people.com.cn" + href
            title = unescape(re.sub(r"<[^>]+>", "", title)).strip()
            if not title or link in seen:
                continue
            seen.add(link)
            arts.append((f"{y}-{mo}-{d}", title, link))
            new += 1
        print(f"列表第{n}页：{new}篇")
        if new == 0 or "下一页" not in html:
            break
        n += 1
        time.sleep(1)
    return arts


class BodyParser(HTMLParser):
    TARGETS = ("rm_txt_con", "rwb_zw", "box_con", "show_text", "artDet")

    def __init__(self):
        super().__init__()
        self.depth = 0
        self.in_p = False
        self.buf, self.paras = [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "div":
            if self.depth:
                self.depth += 1
            elif any(t in (a.get("class") or "") or t == a.get("id") for t in self.TARGETS):
                self.depth = 1
        elif tag == "p" and self.depth:
            self.in_p, self.buf = True, []
        elif tag == "br" and self.in_p:
            self.buf.append("\n")

    def handle_endtag(self, tag):
        if tag == "div" and self.depth:
            self.depth -= 1
        elif tag == "p" and self.in_p:
            self.in_p = False
            for t in "".join(self.buf).split("\n"):
                t = re.sub(r"[\s　\xa0]+", " ", t).strip()
                if t:
                    self.paras.append(t)

    def handle_data(self, data):
        if self.in_p:
            self.buf.append(data)


# 整段删除：作者、编者、执笔、责编、来源、报纸版次等
JUNK = re.compile(
    r"^[（(【\[]?\s*(责编|责任编辑|编辑|来源|作者|执笔|笔者|编者按|编者|本报评论员|本文来源|图片来源|"
    r"分享让更多人看到|《\s*人民日报\s*》)")
# 段内删除：（执笔：xx）（作者为xx）等
INLINE = re.compile(r"\s*[（(]\s*(执笔|作者|编辑|责编|笔者)[：:为][^）)]{0,60}[）)]")


def get_body(html):
    p = BodyParser()
    p.feed(html)
    out = []
    for t in p.paras:
        t = INLINE.sub("", t).strip()
        if not t or JUNK.match(t):
            continue
        out.append(t)
    # 开头或结尾单独一行的短署名（如“张三”“李四 王五”），去掉
    while out and len(re.sub(r"\s", "", out[0])) <= 8 and not re.search(r"[，。！？；：]", out[0]):
        out.pop(0)
    while out and len(re.sub(r"\s", "", out[-1])) <= 8 and not re.search(r"[，。！？；：]", out[-1]):
        out.pop()
    return out


def clean_title(t):
    t = re.sub(r"^​*人民时评[：:]\s*", "", t)
    t = re.sub(r"^【人民时评】\s*", "", t)
    t = re.sub(r"\s*[（(]人民时评[）)]\s*$", "", t)
    return t.strip()


def safe_name(s):
    return re.sub(r'[\\/:*?"<>|\n\r]', "_", s)[:80]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    arts = list_articles()
    seen, merged = set(), []
    for date, title, link in arts:
        key = (date[:7], clean_title(title))
        if key not in seen:
            seen.add(key)
            merged.append((date, title, link))
    arts = merged
    print(f"共找到 {len(arts)} 篇（已存在的会自动跳过），开始下载正文……\n")
    ok, skip, fail = 0, 0, []
    for i, (date, title, link) in enumerate(arts, 1):
        t = clean_title(title)
        month_dir = os.path.join(OUT_DIR, f"{date[:4]}年{date[5:7]}月")
        path = os.path.join(month_dir, f"{safe_name(t)}.md")
        if os.path.exists(path):
            skip += 1
            continue
        try:
            body = get_body(fetch(link))
            if not body:
                raise ValueError("没有识别到正文")
            os.makedirs(month_dir, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(f"# {t}\n\n日期：{date}\n\n" + "\n\n".join(body) + "\n")
            ok += 1
            print(f"[{i}/{len(arts)}] ✓ {date} {t}")
        except Exception as e:
            fail.append((date, title, link, str(e)))
            print(f"[{i}/{len(arts)}] ✗ {date} {t}（{e}）")
        time.sleep(DELAY)
    print(f"\n完成：新增 {ok} 篇，跳过已有 {skip} 篇，失败 {len(fail)} 篇")
    print(f"保存位置：{OUT_DIR}")
    if fail:
        with open(os.path.join(OUT_DIR, "_失败清单.txt"), "w", encoding="utf-8") as f:
            for row in fail:
                f.write("\t".join(row) + "\n")
        print("失败的文章已列在“_失败清单.txt”，重新运行一次脚本会自动补抓")


if __name__ == "__main__":
    main()

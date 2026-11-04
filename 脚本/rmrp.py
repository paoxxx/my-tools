#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""人民锐评批量抓取：人民网栏目页 -> Obsidian Markdown（标题、日期、正文）
只用 Python 自带库，无需安装任何东西。可重复运行，已存在的文章会自动跳过。
"""
import os, re, sys, time, urllib.request
from html.parser import HTMLParser
from html import unescape

LIST_URL = "http://opinion.people.com.cn/GB/436867/index{}.html"
OUT_DIR = os.path.expanduser(
    "~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/21-公考素材库/人民日报/人民锐评")
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"}
DELAY = 1.5  # 每篇间隔秒数，避免请求太快


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


def list_articles():
    arts, seen, n = [], set(), 1
    while True:
        url = LIST_URL.format("" if n == 1 else n)
        try:
            html = fetch(url)
        except Exception as e:
            print(f"列表第{n}页读取结束（{e}）")
            break
        found = re.findall(
            r'<a[^>]+href=["\']([^"\']*/n1/(\d{4})/(\d{2})(\d{2})/c\d+-\d+\.html)["\'][^>]*>(.*?)</a>',
            html, re.S)
        new = 0
        for href, y, mo, d, title in found:
            link = href if href.startswith("http") else "http://opinion.people.com.cn" + href
            title = unescape(re.sub(r"<[^>]+>", "", title)).strip()
            if not title or link in seen or "锐评" not in title:
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


SEARCH_API = "http://search.people.cn/search-platform/front/search"


def search_articles(max_pages=60):
    """人民网站内搜索“人民锐评”，补抓栏目页之外的更早文章"""
    import json
    arts, page = [], 1
    while page <= max_pages:
        payload = {"key": "人民锐评", "page": page, "limit": 10, "hasTitle": True,
                   "hasContent": False, "isFuzzy": False, "type": 0, "sortType": 2,
                   "startTime": 0, "endTime": 0}
        req = urllib.request.Request(
            SEARCH_API, data=json.dumps(payload).encode("utf-8"),
            headers={**UA, "Content-Type": "application/json;charset=UTF-8",
                     "Referer": "http://search.people.cn/s/?keyword=%E4%BA%BA%E6%B0%91%E9%94%90%E8%AF%84",
                     "Origin": "http://search.people.cn"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read().decode("utf-8"))
            recs = (data.get("data") or {}).get("records") or []
        except Exception as e:
            print(f"搜索第{page}页读取失败（{e}），停止搜索")
            break
        if not recs:
            if page == 1:
                print("搜索没有返回结果，原始返回：", json.dumps(data, ensure_ascii=False)[:300])
            break
        new = 0
        for rec in recs:
            title = unescape(re.sub(r"<[^>]+>", "", rec.get("title") or "")).strip()
            link = rec.get("url") or ""
            if "人民锐评" not in title or "people.com.cn" not in link:
                continue
            m = re.search(r"/(\d{4})/(\d{2})(\d{2})/", link)
            if m:
                date = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
            else:
                ts = rec.get("displayTime") or rec.get("inputTime") or 0
                date = time.strftime("%Y-%m-%d", time.localtime(int(ts) / 1000)) if ts else ""
            if date:
                arts.append((date, title, link))
                new += 1
        print(f"搜索第{page}页：{new}篇")
        page += 1
        time.sleep(1)
    return arts


class BodyParser(HTMLParser):
    TARGETS = ("rm_txt_con", "rwb_zw", "box_con", "show_text", "artDet")

    def __init__(self):
        super().__init__()
        self.depth = 0       # >0 表示在正文 div 内
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


JUNK = re.compile(r"^[（(]?\s*(责编|责任编辑|编辑|来源|作者|本文来源|图片来源|分享让更多人看到)")


def get_body(html):
    p = BodyParser()
    p.feed(html)
    return [t for t in p.paras if not JUNK.match(t)]


def clean_title(t):
    t = re.sub(r"^人民锐评[：:]\s*", "", t)
    t = re.sub(r"[（(]人民锐评[）)]$", "", t)
    return t.strip()


def safe_name(s):
    return re.sub(r'[\\/:*?"<>|\n\r]', "_", s)[:80]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    arts = list_articles() + search_articles()
    seen, merged = set(), []
    for date, title, link in arts:
        key = (date[:7], clean_title(title))
        if key in seen:
            continue
        seen.add(key)
        merged.append((date, title, link))
    arts = merged
    print(f"共找到 {len(arts)} 篇（已存在的会自动跳过），开始下载正文……\n")
    ok, skip, fail = 0, 0, []
    for i, (date, title, link) in enumerate(arts, 1):
        t = clean_title(title)
        month_dir = os.path.join(OUT_DIR, f"{date[:4]}年{date[5:7]}月")
        os.makedirs(month_dir, exist_ok=True)
        path = os.path.join(month_dir, f"{safe_name(t)}.md")
        if os.path.exists(path):
            skip += 1
            continue
        try:
            body = get_body(fetch(link))
            if not body:
                raise ValueError("没有识别到正文")
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
        print("失败的文章已列在文件夹里的“_失败清单.txt”，重新运行一次脚本会自动补抓")


if __name__ == "__main__":
    main()

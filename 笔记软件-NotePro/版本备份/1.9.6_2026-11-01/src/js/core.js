/* 笔记软件 核心：常量、排版、墨迹几何、共用渲染（编辑器和导出共用） */
(function () {
  const MM = 96 / 25.4;
  // 页面：A4 竖版，页边距按 WPS“普通”：上下 2.54cm，左右 3.18cm
  const PAGE = { w: 210 * MM, h: 297 * MM, mx: 31.8 * MM, my: 25.4 * MM };
  // 页边距预设（同 WPS）：普通、适中、窄
  const MARGINS = {
    normal: { name: '普通', x: 31.8, y: 25.4 },
    moderate: { name: '适中', x: 19.1, y: 25.4 },
    narrow: { name: '窄', x: 12.7, y: 12.7 },
  };
  function setMargin(key) {
    const m = MARGINS[key] || MARGINS.narrow;
    PAGE.mx = m.x * MM;
    PAGE.my = m.y * MM;
    PAGE.cw = PAGE.w - 2 * PAGE.mx;
    PAGE.ch = PAGE.h - 2 * PAGE.my;
    PAGE.margin = MARGINS[key] ? key : 'narrow';
  }
  setMargin('normal');

  const FONTS = {
    sans: { name: '思源黑体', css: "'Noto Sans SC'" },
    serif: { name: '思源宋体', css: "'Noto Serif SC'" },
    kai: { name: '霞鹜文楷', css: "'LXGW WenKai'" },
    smiley: { name: '得意黑', css: "'Smiley Sans'" },
    qingsong: { name: '清松手写体', css: "'Qingsong Shouxie'" },
    longcang: { name: '龙藏体', css: "'Long Cang'" },
    zhimang: { name: '志莽行书', css: "'Zhi Mang Xing'" },
  };
  const HAS_BOLD = { sans: 1, serif: 1, kai: 1 };
  // 我的字体：从软件字体库按需加载，只在本软件里用
  const customLoaded = {};
  let customLoader = null;
  function setCustomFonts(list, loader) {
    customLoader = loader;
    Object.keys(FONTS).forEach((k) => { if (FONTS[k].custom) delete FONTS[k]; });
    (list || []).forEach((f) => { FONTS['u:' + f.id] = { name: f.name, css: `'BJU-${f.id}'`, custom: f.id }; });
  }
  function loadCustomFont(key) {
    const f = FONTS[key];
    if (!f || !f.custom || !customLoader) return Promise.resolve();
    if (!customLoaded[key]) {
      customLoaded[key] = (async () => {
        const buf = await customLoader(f.custom);
        if (!buf) return;
        const ff = new FontFace('BJU-' + f.custom, buf);
        await ff.load();
        document.fonts.add(ff);
      })().catch(() => {});
    }
    return customLoaded[key];
  }
  const ROW_H = 1.4;   // 行框高度 = 字号 × 1.4
  const ROW_GAP = 0.4; // 默认行间小距离 = 字号 × 0.4（批注带的起始高度）

  // 标准色预设（参照 Office 荧光笔和标准色），不用马卡龙色
  const HL_COLORS = ['#FFFF00', '#00FF00', '#00FFFF', '#FF00FF', '#FF9900', '#FF0000', '#0099FF', '#9933FF'];
  const PEN_COLORS = ['#000000', '#FF0000', '#0066FF', '#00A651', '#FF9900', '#9933FF', '#FF00FF', '#808080'];
  const HL_LEVELS = [1, 0.6, 0.35]; // 强度三档：浓、中、淡
  function hexA(c, a) {
    c = String(c).slice(0, 7);
    if (a == null || a >= 1) return c.toUpperCase();
    return (c + Math.round(a * 255).toString(16).padStart(2, '0')).toUpperCase();
  }
  const PEN_WIDTHS = [1.8, 3, 5];
  const HL_WIDTHS = [12, 18, 26];

  const NO_START = new Set(Array.from('，。、；：？！）》」』”’〉】〕…—～·%,.;:?!)]}>'));
  const NO_END = new Set(Array.from('（《「『“‘〈【〔([{<'));
  const isWordChar = (c) => /[A-Za-z0-9]/.test(c);

  function fontCss(font, size, bold) {
    return `${bold ? 700 : 400} ${size}px ${(FONTS[font] || FONTS.sans).css}, sans-serif`;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  const r2 = (v) => Math.round(v * 100) / 100;

  // 字数：所有非空白字符各算 1 个（标点算，空格、全角空格、换行不算）
  function countChars(str) {
    const m = String(str || '').match(/\S/gu);
    return m ? m.length : 0;
  }

  let _mctx = null;
  function measureCtx() {
    if (!_mctx) _mctx = document.createElement('canvas').getContext('2d');
    return _mctx;
  }

  function normalizeText(t) {
    return String(t || '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/ /g, ' ');
  }

  async function ensureFont(font, size, text) {
    if (FONTS[font] && FONTS[font].custom) { await loadCustomFont(font); return; }
    if (!document.fonts || !document.fonts.load) return;
    const sample = text && text.length ? text : '字';
    try {
      await document.fonts.load(fontCss(font, size, false), sample);
      if (HAS_BOLD[font]) await document.fonts.load(fontCss(font, size, true), sample);
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 字符样式：一段文字里可以有不同字号、加粗、颜色 ----------
     编辑态存 runs：[{n, s, b, c}]（n 个字符同一样式），锁定后存 pal（样式表）+ cst（每个字用第几个样式） */
  function baseStyle(it) { return { s: it.size || 16, b: it.bold ? 1 : 0, c: null }; }
  function charStyles(it) {
    const n = Array.from(normalizeText(it.text)).length;
    const out = [];
    if (it.runs && it.runs.length) {
      for (const r of it.runs) for (let i = 0; i < r.n && out.length < n; i++) out.push({ s: r.s, b: r.b ? 1 : 0, c: r.c || null });
    }
    const last = out.length ? out[out.length - 1] : baseStyle(it);
    while (out.length < n) out.push(Object.assign({}, last));
    return out;
  }
  const sameStyle = (a, b) => a.s === b.s && (a.b ? 1 : 0) === (b.b ? 1 : 0) && (a.c || null) === (b.c || null);
  function stylesToRuns(arr) {
    const runs = [];
    for (const st of arr) {
      const l = runs[runs.length - 1];
      if (l && sameStyle(l, st)) l.n++;
      else runs.push({ n: 1, s: st.s, b: st.b ? 1 : 0, c: st.c || null });
    }
    return runs;
  }
  function lockedStyle(it, i) {
    if (it.pal && it.cst) return it.pal[it.cst[i]] || it.pal[0];
    return { s: it.size, b: it.bold ? 1 : 0, c: null };
  }
  function lineSize(it, k) {
    const L = it.lines[k];
    return (L && L.sz) || it.size;
  }

  /* 把文字排成固定的字块：每个字、标点、字母、数字各占一块
     返回 chars / xs / ws / lines（每行记下最大字号 sz），锁定时写进文档，之后不再变化 */
  function layoutChars(text, font, styles, width) {
    const chars = Array.from(normalizeText(text));
    const ctx = measureCtx();
    const cache = {};
    const ws = chars.map((c, i) => {
      if (c === '\n') return 0;
      const st = styles[i];
      const key = st.s + '|' + st.b + '|' + c;
      if (cache[key] == null) { ctx.font = fontCss(font, st.s, !!st.b); cache[key] = r2(ctx.measureText(c).width); }
      return cache[key];
    });
    const paras = [];
    let start = 0;
    for (let k = 0; k <= chars.length; k++) {
      if (k === chars.length || chars[k] === '\n') { paras.push([start, k]); start = k + 1; }
    }
    const lines = [];
    paras.forEach(([s, e], pi) => {
      if (s === e) { lines.push({ s, e, p: pi, last: true }); return; }
      let ls = s;
      while (ls < e) {
        let w = 0, k = ls;
        while (k < e && w + ws[k] <= width + 0.01) { w += ws[k]; k++; }
        if (k === ls) k = ls + 1;
        if (k < e) {
          while (k < e && chars[k] === ' ') k++;
          if (k < e) {
            if (isWordChar(chars[k]) && isWordChar(chars[k - 1])) {
              let b = k;
              while (b > ls && isWordChar(chars[b - 1])) b--;
              if (b > ls) k = b;
            }
            let guard = 0;
            while (k - 1 > ls && NO_START.has(chars[k]) && guard++ < 3) k--;
            while (k - 1 > ls && NO_END.has(chars[k - 1])) k--;
          }
        }
        lines.push({ s: ls, e: k, p: pi, last: k >= e });
        ls = k;
      }
    });
    const xs = new Array(chars.length).fill(0);
    for (const L of lines) {
      let sz = 0;
      for (let k = L.s; k < L.e; k++) sz = Math.max(sz, styles[k].s);
      if (!sz) sz = (styles[L.s] || styles[L.s - 1] || { s: 16 }).s;
      L.sz = sz;
      const cnt = L.e - L.s;
      let natural = 0;
      for (let k = L.s; k < L.e; k++) natural += ws[k];
      let extra = 0;
      if (!L.last && cnt > 1) {
        const slack = width - natural;
        if (slack > 0 && slack < sz * 4) extra = slack / (cnt - 1);
      }
      let x = 0;
      for (let k = L.s; k < L.e; k++) { xs[k] = r2(x); x += ws[k] + extra; }
    }
    return { chars, xs, ws, lines };
  }

  function lockBlockData(block) {
    const styles = charStyles(block);
    const d = layoutChars(block.text, block.font, styles, PAGE.cw);
    const pal = [], idx = {};
    block.cst = styles.map((st) => {
      const key = st.s + '|' + st.b + '|' + (st.c || '');
      if (idx[key] == null) { idx[key] = pal.length; pal.push({ s: st.s, b: st.b, c: st.c || null }); }
      return idx[key];
    });
    block.pal = pal.length ? pal : [baseStyle(block)];
    block.chars = d.chars;
    block.xs = d.xs;
    block.ws = d.ws;
    block.lines = d.lines;
    block.marks = block.marks || {};
    block.rowGaps = block.rowGaps || {};
    block.locked = true;
    return block;
  }

  // 行距：ls 是行与行的间距倍数（行高 = 字号 × ls）；旧笔记没有 ls，按原来的 1.8
  function lsOf(block) { return block.ls || 1.8; }
  function rowGap(block, k) {
    const extra = (block.rowGaps && block.rowGaps[k]) || 0;
    if (block.grid) return block.grid.cell * GRID_GAP + extra;
    return lineSize(block, k) * (lsOf(block) - ROW_H) + extra;
  }

  /* ---------- 格子纸皮肤（申论答题纸）：锁定后的文字块可以换成格子 ----------
     每个字、标点各占一格，字母和数字两个一格；每行 cols 格（默认 25），换段另起一行；
     格子之间的空隙照样是批注分栏，标记、橡皮擦都和普通文字一样（xs/ws 换成格子位置）。
     原来的排版存在 block.plain 里，取消格子就还原 */
  const GRID_COLOR = '#E8336D';
  const GRID_GAP = 0.42; // 行与行之间的空隙 = 格子边长 × 0.42
  const isHalfCell = (c) => /[A-Za-z0-9]/.test(c);
  function gridLayout(block, cols) {
    const cell = r2(PAGE.cw / cols);
    const chars = block.chars || [];
    const xs = new Array(chars.length).fill(0), ws = new Array(chars.length).fill(0);
    const lines = [];
    const sz = r2(cell / ROW_H);
    let s = 0, col = 0, half = false, p = 0;
    const close = (e, last) => { lines.push({ s, e, p, last, sz }); };
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (c === '\n') { close(i, true); p++; s = i + 1; col = 0; half = false; continue; }
      if (half && isHalfCell(c)) { xs[i] = r2((col - 1) * cell + cell / 2); ws[i] = r2(cell / 2); half = false; continue; }
      // 行满了又遇到句号逗号这类不能放行首的标点：和上一行最后一个字挤在同一格（答题纸的写法）
      if (col >= cols && NO_START.has(c) && i > s) { xs[i] = r2(cols * cell - cell * 0.42); ws[i] = r2(cell * 0.42); half = false; continue; }
      if (col >= cols) { close(i, false); s = i; col = 0; }
      xs[i] = r2(col * cell);
      if (isHalfCell(c)) { ws[i] = r2(cell / 2); half = true; } else { ws[i] = cell; half = false; }
      col++;
    }
    close(chars.length, true);
    // 落单的字母或数字（后面没有配对的）占满一格，居中
    for (let i = 0; i < chars.length; i++) {
      const onEdge = (x) => Math.abs(x / cell - Math.round(x / cell)) < 0.01;
      if (isHalfCell(chars[i]) && ws[i] < cell && onEdge(xs[i]) && !(i + 1 < chars.length && isHalfCell(chars[i + 1]) && Math.abs(xs[i + 1] - xs[i] - cell / 2) < 0.05)) ws[i] = cell;
    }
    return { xs, ws, lines, cell };
  }
  function applyGrid(block, cols) {
    cols = cols || 25;
    if (!block.locked) return block;
    if (!block.plain) block.plain = { xs: block.xs, ws: block.ws, lines: block.lines };
    const g = gridLayout(block, cols);
    block.xs = g.xs; block.ws = g.ws; block.lines = g.lines;
    block.grid = { cols, cell: g.cell };
    return block;
  }
  function removeGrid(block) {
    if (block.plain) { block.xs = block.plain.xs; block.ws = block.plain.ws; block.lines = block.plain.lines; }
    delete block.plain; delete block.grid;
    return block;
  }
  function renderGridBlock(it, L, container, opt) {
    const offY = opt.offsetY || 0;
    const marks = opt.marks || it.marks || {};
    const g = it.grid, cell = g.cell, cols = g.cols, W = r2(cell * cols);
    const gs = r2(cell * 0.66);
    const frag = document.createDocumentFragment();
    const gridLayer = document.createElement('div');
    gridLayer.className = 'grid-layer';
    gridLayer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
    const bgLayer = document.createElement('div');
    bgLayer.className = 'mk-layer';
    const txLayer = document.createElement('div');
    txLayer.className = 'tx-layer';
    txLayer.style.fontFamily = (FONTS[it.font] || FONTS.sans).css + ', sans-serif';
    const add = (layer, css) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;box-sizing:border-box;' + css; layer.appendChild(d); return d; };
    const rows = L.rows.filter((r) => opt.page == null || Math.floor(r.y / PAGE.h) === opt.page);
    // 黑色总外框：每一页上的格子各框一个
    const pages = new Map();
    for (const r of rows) { const pg = Math.floor(r.y / PAGE.h); const v = pages.get(pg) || [Infinity, -Infinity]; v[0] = Math.min(v[0], r.y); v[1] = Math.max(v[1], r.y + r.h); pages.set(pg, v); }
    const pad = r2(cell * 0.5);
    for (const [, [t, b]] of pages) {
      add(gridLayer, `left:${PAGE.mx - pad}px;top:${t + offY - pad}px;width:${W + pad * 2}px;height:${b - t + pad * 2 + cell * 0.3}px;border:1px solid #222`);
    }
    for (const r of rows) {
      const top = r.y + offY;
      const line = it.lines[r.k];
      // 一行格子：外边一圈加竖线
      add(gridLayer, `left:${PAGE.mx}px;top:${top}px;width:${W}px;height:${cell}px;border:1px solid ${GRID_COLOR};` +
        `background-image:linear-gradient(to right, transparent calc(100% - 1px), ${GRID_COLOR} calc(100% - 1px));background-size:${cell}px 100%;background-origin:border-box;background-repeat:repeat-x`);
      // 每满 100 格标一次（整块累计）
      const cum = (r.k + 1) * cols;
      if (cum % 100 === 0) {
        const lb = add(gridLayer, `left:${PAGE.mx + W - 60}px;top:${top + cell + 1}px;width:60px;text-align:right;font-size:${Math.max(8, r2(cell * 0.34))}px;line-height:1.2;color:#333;font-family:-apple-system,'PingFang SC',sans-serif`);
        lb.textContent = cum + '字';
      }
      // 高亮：整格涂色
      let k = line.s;
      while (k < line.e) {
        const m = marks[k];
        if (m && m.bg) {
          let j = k;
          while (j + 1 < line.e && marks[j + 1] && marks[j + 1].bg === m.bg) j++;
          const el = document.createElement('div');
          el.className = 'mk';
          el.style.left = (PAGE.mx + it.xs[k] + 1.5) + 'px';
          el.style.width = (it.xs[j] + it.ws[j] - it.xs[k] - 3) + 'px';
          el.style.top = (top + 1.5) + 'px';
          el.style.height = (cell - 3) + 'px';
          el.style.background = m.bg;
          el.style.borderRadius = '2px';
          bgLayer.appendChild(el);
          k = j + 1;
        } else k++;
      }
      // 下划线
      k = line.s;
      while (k < line.e) {
        const m = marks[k];
        if (m && m.u) {
          let j = k;
          while (j + 1 < line.e && marks[j + 1] && marks[j + 1].u) j++;
          const el = document.createElement('div');
          el.className = 'ul';
          el.style.left = (PAGE.mx + it.xs[k] + 2) + 'px';
          el.style.width = (it.xs[j] + it.ws[j] - it.xs[k] - 4) + 'px';
          el.style.top = (top + cell - cell * 0.14) + 'px';
          el.style.height = Math.max(1.4, cell * 0.06) + 'px';
          txLayer.appendChild(el);
          k = j + 1;
        } else k++;
      }
      // 字：在格子里居中
      for (let i = line.s; i < line.e; i++) {
        const c = it.chars[i];
        if (/\s/.test(c)) continue;
        const st = lockedStyle(it, i);
        const sp = document.createElement('span');
        sp.className = 'ch' + ((marks[i] && marks[i].b) || st.b ? ' b' : '');
        sp.textContent = c;
        sp.style.left = (PAGE.mx + it.xs[i]) + 'px';
        sp.style.top = (top + (cell - gs * ROW_H) / 2) + 'px';
        sp.style.width = it.ws[i] + 'px';
        sp.style.fontSize = (isHalfCell(c) ? r2(gs * 0.92) : gs) + 'px';
        sp.style.lineHeight = gs * ROW_H + 'px';
        if (st.c) sp.style.color = st.c;
        txLayer.appendChild(sp);
      }
    }
    frag.appendChild(gridLayer);
    frag.appendChild(bgLayer);
    frag.appendChild(txLayer);
    container.appendChild(frag);
  }

  /* 整体排版：文字块按顺序往下排，每一行不跨页；输出所有“锚点”（墨迹挂靠用） */
  function computeLayout(doc, opts) {
    opts = opts || {};
    const pageH = PAGE.h;
    const anchors = [{ key: 'top', y: 0 }];
    const items = {};
    const fit = (y, h) => {
      let pg = Math.floor(y / pageH);
      let top = pg * pageH + PAGE.my;
      let bot = pg * pageH + pageH - PAGE.my;
      if (y < top) y = top;
      if (y + h > bot + 0.01 && h <= PAGE.ch) { pg++; y = pg * pageH + PAGE.my; }
      return y;
    };
    let prevBottom = PAGE.my;
    for (const it of doc.items) {
      if (it.type === 'mind') {
        const m = mindLayout(it);
        const h = (it.h || 420) + 8;
        const yy = fit(prevBottom + (it.spaceBefore || 0), Math.min(h, PAGE.ch));
        anchors.push({ key: 'i:' + it.id, y: yy });
        items[it.id] = { top: yy, bottom: yy + h, rows: null, h, prevBottom, mind: m };
        prevBottom = yy + h;
        continue;
      }
      if (it.type !== 'text') continue;
      const top = prevBottom + (it.spaceBefore || 0);
      const rowH = it.size * ROW_H;
      if (it.locked) {
        const rowHk = (k) => lineSize(it, k) * ROW_H;
        const rows = [];
        let yy = fit(top, rowHk(0));
        const blockTop = yy;
        anchors.push({ key: 'i:' + it.id, y: yy });
        it.lines.forEach((L, k) => {
          const rh = rowHk(k);
          yy = fit(yy, rh);
          rows.push({ y: yy, h: rh, k });
          anchors.push({ key: `r:${it.id}:${k}`, y: yy });
          yy += rh + rowGap(it, k);
        });
        items[it.id] = { top: blockTop, bottom: yy, rows, prevBottom };
        prevBottom = yy;
      } else {
        const h = Math.max(rowH, opts.editHeight ? opts.editHeight(it) : it.size * lsOf(it) * Math.max(1, it.text.split('\n').length));
        const yy = fit(top, Math.min(h, PAGE.ch));
        anchors.push({ key: 'i:' + it.id, y: yy });
        items[it.id] = { top: yy, bottom: yy + h, rows: null, h, prevBottom };
        prevBottom = yy + h;
      }
    }
    anchors.sort((a, b) => a.y - b.y);
    const amap = new Map();
    anchors.forEach((a) => amap.set(a.key, a.y));
    return { anchors, amap, items, contentBottom: prevBottom };
  }

  function findAnchor(layout, y) {
    const A = layout.anchors;
    let lo = 0, hi = A.length - 1, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (A[mid].y <= y) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return A[best];
  }

  function strokeAnchorY(layout, s) {
    const y = layout.amap.get(s.a);
    return y == null ? (s.ay || 0) : y;
  }

  // 把墨迹从绝对坐标挂到它中心所在的那一行
  function anchorStroke(layout, s, absPts) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of absPts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    const a = findAnchor(layout, (minY + maxY) / 2);
    s.a = a.key;
    s.ay = r2(a.y);
    s.pts = absPts.map((p) => [r2(p[0]), r2(p[1] - a.y), r2(p[2])]);
    return s;
  }

  function absPoints(layout, s) {
    const ay = strokeAnchorY(layout, s);
    return s.pts.map((p) => [p[0], p[1] + ay, p[2]]);
  }

  // 图片也挂在行上：按中心找锚点，存相对位置
  function anchorImage(layout, img, absTop) {
    const a = findAnchor(layout, absTop + img.h / 2);
    img.a = a.key;
    img.ay = r2(a.y);
    img.dy = r2(absTop - a.y);
    return img;
  }
  function imageTop(layout, img) {
    const y = layout.amap.get(img.a);
    return (y == null ? (img.ay || 0) : y) + img.dy;
  }

  // 批注文字框：同样挂在行上，跟着行走
  function anchorNote(layout, n, absTop) {
    const a = findAnchor(layout, absTop + n.s * 0.65);
    n.a = a.key;
    n.ay = r2(a.y);
    n.dy = r2(absTop - a.y);
    return n;
  }
  function noteTop(layout, n) {
    const y = layout.amap.get(n.a);
    return (y == null ? (n.ay || 0) : y) + n.dy;
  }
  function renderNote(n, container, top) {
    const d = document.createElement('div');
    d.className = 'pnote';
    d.dataset.id = n.id;
    d.style.left = n.x + 'px';
    d.style.top = top + 'px';
    d.style.fontSize = n.s + 'px';
    d.style.color = n.c;
    d.style.fontFamily = (FONTS[n.f] || FONTS.qingsong).css + ', sans-serif';
    d.textContent = n.text;
    container.appendChild(d);
    return d;
  }

  // 锚点消失（比如文字块被删）的墨迹，按原位置重新挂靠
  function repairAnchors(doc, layout) {
    for (const n of doc.notes || []) {
      if (!layout.amap.has(n.a)) anchorNote(layout, n, (n.ay || 0) + n.dy);
      else n.ay = r2(layout.amap.get(n.a));
    }
    for (const im of doc.images || []) {
      if (!layout.amap.has(im.a)) anchorImage(layout, im, (im.ay || 0) + im.dy);
      else im.ay = r2(layout.amap.get(im.a));
    }
    for (const s of doc.strokes) {
      if (!layout.amap.has(s.a)) {
        const abs = s.pts.map((p) => [p[0], p[1] + (s.ay || 0), p[2]]);
        anchorStroke(layout, s, abs);
      } else {
        s.ay = r2(layout.amap.get(s.a));
      }
    }
  }

  function strokeOptions(s, last) {
    if (s.t === 'hl') {
      return { size: s.w, thinning: 0, smoothing: 0.5, streamline: 0.35, simulatePressure: false, last };
    }
    return { size: s.w, thinning: 0.62, smoothing: 0.5, streamline: 0.32, simulatePressure: !!s.sim, last,
      easing: (t) => t };
  }

  const avg = (a, b) => (a + b) / 2;
  function outlineToPath(points) {
    const len = points.length;
    if (len < 4) return '';
    let a = points[0], b = points[1];
    const c = points[2];
    let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${avg(b[0], c[0]).toFixed(2)},${avg(b[1], c[1]).toFixed(2)} T`;
    for (let i = 2, max = len - 1; i < max; i++) {
      a = points[i]; b = points[i + 1];
      d += `${avg(a[0], b[0]).toFixed(2)},${avg(a[1], b[1]).toFixed(2)} `;
    }
    return d + 'Z';
  }

  function pressureCurve(p) {
    p = Math.max(0.04, Math.min(1, p));
    return Math.pow(p, 0.85);
  }

  function strokePathD(s, pts, last) {
    const input = pts.map((p) => [p[0], p[1], s.sim ? 0.5 : pressureCurve(p[2])]);
    if (input.length === 1) input.push([input[0][0] + 0.1, input[0][1] + 0.1, input[0][2]]);
    return outlineToPath(window.PF.getStroke(input, strokeOptions(s, last !== false)));
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function makeStrokeEl(s, d) {
    const el = document.createElementNS(SVGNS, 'path');
    el.setAttribute('d', d);
    el.setAttribute('fill', s.c);
    if (s.t === 'hl') {
      el.setAttribute('fill-opacity', String(s.o != null ? s.o : 0.55));
      el.style.mixBlendMode = 'multiply';
    }
    return el;
  }

  function pagesNeeded(doc, layout) {
    let maxY = layout.contentBottom;
    for (const s of doc.strokes) {
      const ay = strokeAnchorY(layout, s);
      for (const p of s.pts) if (p[1] + ay > maxY) maxY = p[1] + ay;
    }
    for (const im of doc.images || []) maxY = Math.max(maxY, imageTop(layout, im) + im.h);
    for (const n of doc.notes || []) maxY = Math.max(maxY, noteTop(layout, n) + n.s * 1.3 * Math.max(1, String(n.text).split('\n').length));
    return Math.max(doc.minPages || 1, Math.ceil((maxY + 1) / PAGE.h));
  }

  /* 渲染一个锁定文字块（或其中某一页的行）
     opt.offsetY：整体纵向偏移；opt.page：只画这一页；opt.preview：临时 marks */
  function renderLockedBlock(it, L, container, opt) {
    opt = opt || {};
    if (it.grid) return renderGridBlock(it, L, container, opt);
    const offY = opt.offsetY || 0;
    const marks = opt.marks || it.marks || {};
    const frag = document.createDocumentFragment();
    const bgLayer = document.createElement('div');
    bgLayer.className = 'mk-layer';
    const txLayer = document.createElement('div');
    txLayer.className = 'tx-layer';
    txLayer.style.fontFamily = (FONTS[it.font] || FONTS.sans).css + ', sans-serif';
    for (const r of L.rows) {
      if (opt.page != null && Math.floor(r.y / PAGE.h) !== opt.page) continue;
      const line = it.lines[r.k];
      const top = r.y + offY;
      const rowH = r.h;
      const lsz = rowH / ROW_H;
      const cTop = (i) => top + rowH - lockedStyle(it, i).s * ROW_H; // 同一行不同字号底部对齐
      // 高亮底色
      let k = line.s;
      while (k < line.e) {
        const m = marks[k];
        if (m && m.bg) {
          let j = k;
          while (j + 1 < line.e && marks[j + 1] && marks[j + 1].bg === m.bg) j++;
          let ms = 0;
          for (let q = k; q <= j; q++) ms = Math.max(ms, lockedStyle(it, q).s);
          const pad = Math.max(1.5, ms * 0.12);
          const el = document.createElement('div');
          el.className = 'mk';
          el.style.left = (PAGE.mx + it.xs[k] - pad) + 'px';
          el.style.width = (it.xs[j] + it.ws[j] - it.xs[k] + pad * 2) + 'px';
          el.style.top = (top + rowH - ms * ROW_H + ms * 0.08) + 'px';
          el.style.height = (ms * ROW_H - ms * 0.16) + 'px';
          el.style.background = m.bg;
          el.style.borderRadius = Math.max(2, ms * 0.22) + 'px';
          bgLayer.appendChild(el);
          k = j + 1;
        } else k++;
      }
      // 下划线
      k = line.s;
      while (k < line.e) {
        const m = marks[k];
        if (m && m.u) {
          let j = k;
          while (j + 1 < line.e && marks[j + 1] && marks[j + 1].u) j++;
          const el = document.createElement('div');
          el.className = 'ul';
          el.style.left = (PAGE.mx + it.xs[k]) + 'px';
          el.style.width = (it.xs[j] + it.ws[j] - it.xs[k]) + 'px';
          el.style.top = (top + rowH - lsz * ROW_H * 0.1) + 'px';
          el.style.height = Math.max(1.4, lsz * 0.08) + 'px';
          txLayer.appendChild(el);
          k = j + 1;
        } else k++;
      }
      // 字块
      for (let i = line.s; i < line.e; i++) {
        const c = it.chars[i];
        if (/\s/.test(c)) continue;
        const st = lockedStyle(it, i);
        const sp = document.createElement('span');
        sp.className = 'ch' + ((marks[i] && marks[i].b) || st.b ? ' b' : '');
        sp.textContent = c;
        sp.style.left = (PAGE.mx + it.xs[i]) + 'px';
        sp.style.top = cTop(i) + 'px';
        sp.style.width = it.ws[i] + 'px';
        sp.style.fontSize = st.s + 'px';
        sp.style.lineHeight = st.s * ROW_H + 'px';
        if (st.c) sp.style.color = st.c;
        txLayer.appendChild(sp);
      }
    }
    frag.appendChild(bgLayer);
    frag.appendChild(txLayer);
    container.appendChild(frag);
  }

  // 图片：外框 w×h，内部按裁剪区域放大
  function layoutImageBox(box, img, offsetY) {
    const c = img.crop || { l: 0, t: 0, r: 0, b: 0 };
    box.style.left = img.x + 'px';
    box.style.top = (img._top + (offsetY || 0)) + 'px';
    box.style.width = img.w + 'px';
    box.style.height = img.h + 'px';
    const el = box.firstChild;
    const fw = img.w / (1 - c.l - c.r), fh = img.h / (1 - c.t - c.b);
    el.style.width = fw + 'px';
    el.style.height = fh + 'px';
    el.style.left = -c.l * fw + 'px';
    el.style.top = -c.t * fh + 'px';
  }
  function renderImage(img, src, container, offsetY) {
    const box = document.createElement('div');
    box.className = 'img';
    box.dataset.id = img.id;
    const el = document.createElement('img');
    el.draggable = false;
    if (src) el.src = src;
    box.appendChild(el);
    layoutImageBox(box, img, offsetY);
    container.appendChild(box);
    return box;
  }


  /* ---------- 思维导图（逻辑图，从左往右展开） ---------- */
  const MIND_SKINS = {
    vital: { name: '活力', root: '#2541D9', rootText: '#FFFFFF', l1: '#111111', l1Text: '#FFFFFF', line: '#2541D9', strip: ['#FFFFFF', '#E6E6E6', '#E8332A', '#F2B705', '#2541D9', '#111111'] },
    dawn: { name: '晨曦', root: '#3A3A3A', rootText: '#FFFFFF', branches: ['#F76B6B', '#F9A06B', '#7FCBB0', '#5FCFCB', '#4FB8EC', '#D987E3'], l1Text: '#FFFFFF', strip: ['#F76B6B', '#F9A06B', '#97D3B9', '#7DD9D5', '#60C4F1', '#DB89E5'] },
    rainbow: { name: '彩虹', root: '#222222', rootText: '#FFFFFF', branches: ['#E8453C', '#F5A300', '#7CB342', '#1E88E5', '#8E24AA', '#00ACC1'], l1Text: '#FFFFFF', strip: ['#E8453C', '#F5A300', '#7CB342', '#1E88E5', '#8E24AA', '#00ACC1'] },
    dance: { name: '舞动', root: '#4E5BE0', rootText: '#FFFFFF', branches: ['#E84A5F', '#A3122A', '#4E5BE0', '#3B2F2A'], l1Text: '#FFFFFF', strip: ['#4E5BE0', '#E84A5F', '#FFFFFF', '#FBF5E1', '#A3122A', '#3B2F2A'] },
    code: { name: '代码', root: '#2A2D34', rootText: '#FFFFFF', branches: ['#F7EBA6', '#C3F5B0', '#D99AF0', '#8BB8F5'], l1Text: '#2A2D34', strip: ['#F8EBA9', '#C3F5B0', '#FFFFFF', '#D99AF0', '#8BB8F5', '#2A2D34'] },
    wafu: { name: '和风', root: '#1E1F6B', rootText: '#FFFFFF', branches: ['#F2A0A0', '#F27A2B', '#8FB0F5', '#4C55D9'], l1Text: '#FFFFFF', strip: ['#FFFFFF', '#F7A8A8', '#F68B3C', '#8FB3F5', '#4C55D9', '#1E1F6B'] },
    island: { name: '岛屿', root: '#6C7158', rootText: '#FFFFFF', branches: ['#C99A80', '#A9A688', '#D9B9A2', '#8D917A'], l1Text: '#FFFFFF', strip: ['#FDE3D3', '#DDB9A2', '#C99A80', '#B9B7A2', '#A0A088', '#6C7158'] },
    rose: { name: '玫瑰', root: '#A0153E', rootText: '#FFFFFF', branches: ['#E85A7E', '#C71E50', '#F49BB3', '#A0153E'], l1Text: '#FFFFFF', strip: ['#FDECEF', '#F9C6D1', '#F49BB3', '#E85A7E', '#C71E50', '#A0153E'] },
    mint: { name: '薄荷', root: '#0A6A63', rootText: '#FFFFFF', branches: ['#14B3A6', '#5FD0C8', '#0A8F86', '#0A6A63'], l1Text: '#FFFFFF', strip: ['#FFFFFF', '#B9F3EF', '#97E3E0', '#5FD0C8', '#14B3A6', '#0A6A63'] },
    greentea: { name: '绿茶', root: '#1F3A26', rootText: '#FFFFFF', branches: ['#5A9367', '#6B7347', '#256C3A', '#B5AE88'], l1Text: '#FFFFFF', strip: ['#D9D9C5', '#B5AE88', '#5A9367', '#6B7347', '#256C3A', '#1F3A26'] },
    classic: { name: '经典', root: '#FFFFFF', rootText: '#111111', rootBorder: '#111111', l1: '#FFFFFF', l1Text: '#111111', l1Border: '#111111', line: '#111111', strip: ['#FFFFFF', '#FFFFFF', '#111111', '#FFFFFF', '#111111', '#111111'] },
  };
  const MIND_LV = [
    { size: 22, bold: 1, px: 18, py: 11, r: 8 },
    { size: 16, bold: 1, px: 14, py: 8, r: 6 },
    { size: 14, bold: 0, px: 6, py: 4, r: 6 },
  ];
  function mindLvStyle(level) { return MIND_LV[Math.min(level, 2)]; }
  const mindCache = new Map();
  function mindLayout(it) {
    const key = JSON.stringify([it.root, it.skin, it.font, PAGE.cw]);
    const hit = mindCache.get(it.id);
    if (hit && hit.key === key) return hit.m;
    const skin = MIND_SKINS[it.skin] || MIND_SKINS.vital;
    const ctx = measureCtx();
    const boxes = [], links = [];
    const measure = (node, level) => {
      const st = mindLvStyle(level);
      ctx.font = fontCss(it.font || 'sans', st.size, !!st.bold);
      const lines = String(node.text || ' ').split('\n');
      const tw = Math.max(st.size, ...lines.map((l) => ctx.measureText(l || ' ').width));
      const lh = st.size * 1.35;
      return { w: Math.ceil(tw + st.px * 2), h: Math.ceil(lines.length * lh + st.py * 2), st, lh };
    };
    const place = (node, level, x, yTop, color) => {
      const m = measure(node, level);
      const kids = node.collapsed ? [] : (node.children || []);
      const vgap = level === 0 ? 18 : level === 1 ? 12 : 8;
      const hgap = level === 0 ? 48 : 34;
      // 先量子树高度
      const sub = kids.map((c, i) => subtreeH(c, level + 1));
      const subH = sub.reduce((a, b) => a + b, 0) + Math.max(0, kids.length - 1) * vgap;
      const blockH = Math.max(m.h, subH);
      const y = yTop + (blockH - m.h) / 2;
      const box = { id: node.id, text: node.text, level, x, y, w: m.w, h: m.h, st: m.st, lh: m.lh, color };
      boxes.push(box);
      let cy = yTop + (blockH - subH) / 2;
      kids.forEach((c, i) => {
        const cc = level === 0 && skin.branches ? skin.branches[i % skin.branches.length] : color;
        const cb = place(c, level + 1, x + m.w + hgap, cy, cc);
        links.push({ from: box, to: cb, color: level === 0 && skin.branches ? cc : (skin.branches ? color : skin.line) });
        cy += sub[i] + vgap;
      });
      return box;
    };
    const hcache = new Map();
    const subtreeH = (node, level) => {
      if (hcache.has(node)) return hcache.get(node);
      const m = measure(node, level);
      const kids = node.collapsed ? [] : (node.children || []);
      const vgap = level === 0 ? 18 : level === 1 ? 12 : 8;
      const subH = kids.reduce((a, c) => a + subtreeH(c, level + 1), 0) + Math.max(0, kids.length - 1) * vgap;
      const h = Math.max(m.h, subH);
      hcache.set(node, h);
      return h;
    };
    place(it.root, 0, 0, 0, skin.line || '#333');
    let w = 0, h = 0;
    for (const b of boxes) { w = Math.max(w, b.x + b.w); h = Math.max(h, b.y + b.h); }
    const m = { boxes, links, w, h, scale: 1, skin };
    mindCache.set(it.id, { key, m });
    return m;
  }
  // 视角：没设过就按“适应”放到中间
  // 新导图第一次显示：最大只放到 0.75 倍，给以后加主题留出空间；“适应”按钮最大 1.2 倍
  function mindFitView(it, m, maxZ) {
    const W = PAGE.cw, H = it.h || 420, pad = 24;
    const z = Math.max(0.2, Math.min(maxZ || 1.2, (W - pad * 2) / Math.max(1, m.w), (H - pad * 2) / Math.max(1, m.h)));
    return { x: Math.round((W - m.w * z) / 2), y: Math.round((H - m.h * z) / 2), z: Math.round(z * 1000) / 1000 };
  }
  function mindView(it, m) {
    if (!it.view) it.view = mindFitView(it, m, 0.75);
    return it.view;
  }
  // 连线：中心到分支用平滑曲线；分支往下用圆角括号线；粗细统一、两端贴住节点中线
  function mindLinkPath(a, b) {
    const sx = a.x + a.w, sy = a.y + a.h / 2, ex = b.x, ey = b.y + b.h / 2;
    if (a.level === 0) {
      const mx = sx + (ex - sx) * 0.45;
      return `M${sx},${sy} C${mx},${sy} ${mx},${ey} ${ex},${ey}`;
    }
    const spx = sx + 12;
    const dy = ey - sy;
    if (Math.abs(dy) < 1) return `M${sx},${sy} H${ex}`;
    const r = Math.min(7, Math.abs(dy) / 2, (ex - spx) / 2);
    const sg = dy > 0 ? 1 : -1;
    return `M${sx},${sy} H${spx} V${ey - sg * r} Q${spx},${ey} ${spx + r},${ey} H${ex}`;
  }
  function renderMind(it, L, container, top, opt) {
    opt = opt || {};
    const m = L.mind || mindLayout(it);
    const skin = m.skin;
    const v = mindView(it, m);
    const wrap = document.createElement('div');
    wrap.className = 'mind';
    wrap.dataset.id = it.id;
    wrap.style.left = PAGE.mx + 'px';
    wrap.style.top = top + 'px';
    wrap.style.width = PAGE.cw + 'px';
    wrap.style.height = (it.h || 420) + 'px';
    wrap.style.overflow = 'hidden';
    const inner = document.createElement('div');
    inner.className = 'mind-in';
    inner.style.width = m.w + 'px';
    inner.style.height = m.h + 'px';
    inner.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    inner.style.fontFamily = (FONTS[it.font] || FONTS.sans).css + ', sans-serif';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', Math.max(1, m.w));
    svg.setAttribute('height', Math.max(1, m.h));
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.overflow = 'visible';
    for (const l of m.links) {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', mindLinkPath(l.from, l.to));
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', l.color);
      p.setAttribute('stroke-width', 2);
      p.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(p);
    }
    inner.appendChild(svg);
    for (const b of m.boxes) {
      const d = document.createElement('div');
      d.className = 'mn lv' + Math.min(b.level, 2) + (opt.sel === b.id ? ' sel' : '');
      d.dataset.nid = b.id;
      d.style.left = b.x + 'px';
      d.style.top = b.y + 'px';
      d.style.minWidth = b.w + 'px';
      d.style.height = b.h + 'px';
      d.style.padding = `${b.st.py}px ${b.st.px}px`;
      d.style.fontSize = b.st.size + 'px';
      d.style.lineHeight = b.lh + 'px';
      d.style.fontWeight = b.st.bold ? 700 : 400;
      d.style.borderRadius = b.st.r + 'px';
      if (b.level === 0) {
        d.style.background = skin.root; d.style.color = skin.rootText;
        if (skin.rootBorder) d.style.boxShadow = `inset 0 0 0 2px ${skin.rootBorder}`;
      } else if (b.level === 1) {
        d.style.background = skin.branches ? b.color : skin.l1; d.style.color = skin.l1Text;
        if (skin.l1Border) d.style.boxShadow = `inset 0 0 0 1.5px ${skin.l1Border}`;
      } else {
        d.style.color = '#222';
      }
      d.textContent = b.text;
      inner.appendChild(d);
    }
    wrap.appendChild(inner);
    container.appendChild(wrap);
    return wrap;
  }
  /* Markdown → 导图层级：# 标题按级别，- * + 1. 列表按缩进，普通段落挂在当前标题下 */
  function mdToTree(md) {
    const clean = (t) => t.replace(/\*\*|__|`/g, '').replace(/^\[([ xX])\]\s*/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
    const root = { id: uid(), text: '', children: [], d: -1 };
    const stack = [root];
    let headDepth = -1;
    for (const raw of normalizeText(md).split('\n')) {
      if (!raw.trim()) continue;
      let m, depth, text;
      if ((m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(raw))) { depth = m[1].length - 1; headDepth = depth; text = m[2].replace(/\s#+\s*$/, ''); }
      else if ((m = /^(\s*)([-*+]|\d+[.、)])\s+(.*)$/.exec(raw))) {
        const ind = m[1].replace(/\t/g, '    ').length;
        depth = headDepth + 1 + Math.floor(ind / 2);
        text = m[3];
      } else { depth = headDepth + 1; text = raw.trim(); }
      text = clean(text);
      if (!text) continue;
      while (stack.length > 1 && stack[stack.length - 1].d >= depth) stack.pop();
      const parent = stack[stack.length - 1];
      const node = { id: uid(), text, children: [], d: Math.max(depth, parent.d + 1) };
      parent.children.push(node);
      stack.push(node);
    }
    const strip = (n) => { delete n.d; n.children.forEach(strip); return n; };
    let top = root.children;
    if (!top.length) return null;
    if (top.length === 1) return strip(top[0]);
    root.text = '中心主题';
    return strip(root);
  }
  function looksLikeMarkdown(t) {
    const lines = normalizeText(t).split('\n').filter((l) => l.trim());
    if (lines.length < 2) return false;
    const heads = lines.filter((l) => /^\s{0,3}#{1,6}\s+\S/.test(l)).length;
    const items = lines.filter((l) => /^\s*([-*+]|\d+\.)\s+\S/.test(l)).length;
    const nested = lines.some((l) => /^\s{2,}([-*+]|\d+\.)\s+\S/.test(l));
    return heads >= 1 && heads + items >= 2 || (items >= 3 && nested);
  }
  function newMind() {
    const nid = () => uid();
    return { id: uid(), type: 'mind', skin: 'vital', font: 'sans', spaceBefore: 24, h: 420,
      root: { id: nid(), text: '中心主题', children: [1, 2, 3, 4].map((i) => ({ id: nid(), text: '分支主题 ' + i, children: [] })) } };
  }

  function newTitle(existing) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const base = `笔记 ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const set = new Set(existing || []);
    if (!set.has(base)) return base;
    let i = 1;
    while (set.has(`${base}（${i}）`)) i++;
    return `${base}（${i}）`;
  }
  function newDoc(existingTitles, margin) {
    return { format: 1, id: uid(), title: newTitle(existingTitles), created: Date.now(), modified: Date.now(), minPages: 1, margin: margin || 'narrow', items: [], strokes: [], images: [], notes: [] };
  }

  window.Core = {
    MM, PAGE, FONTS, ROW_H, ROW_GAP, applyGrid, removeGrid, GRID_COLOR, HL_COLORS, PEN_COLORS, PEN_WIDTHS, HL_WIDTHS, HL_LEVELS, hexA,
    fontCss, uid, r2, countChars, normalizeText, ensureFont, layoutChars, lockBlockData, rowGap, lsOf,
    charStyles, stylesToRuns, lockedStyle, lineSize, baseStyle,
    computeLayout, findAnchor, strokeAnchorY, anchorStroke, absPoints, repairAnchors,
    strokePathD, makeStrokeEl, pagesNeeded, renderLockedBlock, newDoc, SVGNS,
    setCustomFonts, loadCustomFont, MIND_SKINS, mindLayout, renderMind, newMind, mindFitView, mindView, mdToTree, looksLikeMarkdown,
    MARGINS, setMargin, anchorImage, imageTop, renderImage, layoutImageBox, anchorNote, noteTop, renderNote,
  };
})();

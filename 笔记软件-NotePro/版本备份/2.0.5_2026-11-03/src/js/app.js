/* 笔记软件 编辑器 */
(function () {
  const C = window.Core;
  const { PAGE } = C;
  const $ = (s) => document.querySelector(s);
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  const scroller = $('#scroller'), sizer = $('#sizer'), paper = $('#paper'), pagesEl = $('#pages');
  const textLayer = $('#textlayer'), ink = $('#inklayer'), overlay = $('#overlay'), ui = $('#uilayer');

  // 工具顺序参照 Notability：钢笔1、钢笔2、钢笔3、标记笔、镭射、导航、橡皮、文本，套索放最后
  const TOOLS = [
    { id: 'pen1', key: '1', name: '钢笔1', icon: 'ti-ballpen' },
    { id: 'pen2', key: '2', name: '钢笔2', icon: 'ti-ballpen' },
    { id: 'note', key: '3', name: '批注', icon: 'ti-text-plus' },
    { id: 'hl', key: '4', name: '标记笔', icon: 'ti-highlight' },
    { id: 'laser', key: '5', name: '镭射', icon: 'ti-point' },
    { id: 'hand', key: '6', name: '导航', icon: 'ti-hand-finger' },
    { id: 'eraser', key: '7', name: '橡皮擦', icon: 'ti-eraser' },
    { id: 'text', key: '8', name: '文本', icon: 'ti-typography' },
    { id: 'anno', key: '9', name: '标注', icon: 'ti-scribble' },
  ];
  // 标注的五种：直线、波浪线、着重号（落在锁定文字上按字块吸附）、画圈、方框
  const ANNO_MODES = [['line', 'ti-underline', '直线'], ['wave', 'ti-wave-sine', '波浪线'], ['dot', null, '着重号'], ['circle', 'ti-oval', '画圈'], ['rect', 'ti-rectangle', '方框'], ['arrow', 'ti-arrow-up-right', '箭头'], ['text', 'ti-letter-t', '文字']];
  const ANNO_LINE_W = [2, 3, 4.5];
  const ANNO_TEXT_SIZES = [18, 24, 32]; // 标注文字：小、中、大
  const PEN_TOOLS = ['pen1', 'pen2'];
  const NOTE_SIZES = [13, 17, 23];
  const DEFAULT_CFG = {
    pen1: { c: '#000000', w: 0 },
    pen2: { c: '#FF0000', w: 0 },
    note: { c: '#FF0000', si: 0, s: 1, f: 'qingsong' },
    hl: { c: '#FFFF00', a: 0, w: 1, mode: 'bg' },
    text: { font: 'sans', size: 16 },
    anno: { c: '#FF1E1E', w: 1, m: 'line' },
  };

  const S = {
    doc: null, layout: null, tool: 'pen1', lastTool: 'pen1', zoom: 1, autoFit: true,
    history: [], future: [], cfg: JSON.parse(JSON.stringify(DEFAULT_CFG)),
    showCount: false, editH: {}, edEls: {}, blockSig: {}, chips: {}, inkEls: new Map(), bbox: new Map(),
    sel: null, pageCount: 0, totalH: PAGE.h, saveTimer: null, notes: [],
    slots: Object.assign({ pen: C.PEN_COLORS.slice(), hl: C.HL_COLORS.slice(), text: ['#000000', '#FF0000', '#0066FF', '#00A651', '#FF9900', '#9933FF', '#FF00FF', '#808080'], note: ['#FF0000', '#0066FF', '#00A651', '#FF9900', '#9933FF', '#FF00FF', '#000000', '#808080'], anno: ['#FF1E1E', '#0A6CFF', '#00B050', '#FF8A00', '#9B30FF', '#FF2DA6', '#000000', '#FFC800'] }, Store.pref('slots') || {}),
  };
  const savedCfg = Store.pref('toolcfg2');
  if (savedCfg) Object.keys(DEFAULT_CFG).forEach((k) => { if (savedCfg[k]) S.cfg[k] = Object.assign({}, DEFAULT_CFG[k], savedCfg[k]); });
  S.showCount = !!Store.pref('showCount');
  S.settings = Object.assign({ autoEraser: true, margin: 'narrow' }, Store.pref('settings') || {});
  if (!C.MARGINS[S.settings.margin]) S.settings.margin = 'narrow';
  S.assets = {};
  S.imgSel = null;
  S.lastTap = null;
  const saveSettings = () => Store.pref('settings', S.settings);

  const isEditor = (x) => !!(x && x.classList && x.classList.contains('ced'));
  const activeEditor = () => (isEditor(document.activeElement) ? document.activeElement : null);

  /* ---------- 撤销 / 保存 ---------- */
  const snap = () => JSON.stringify(S.doc);
  function commit(before) {
    if (before != null) {
      S.history.push(before);
      if (S.history.length > 80) S.history.shift();
      S.future = [];
    }
    touch();
    updateUndoBtns();
    S.lastSnap = snap();
  }
  function touch() {
    S.doc.modified = Date.now();
    scheduleSave();
  }
  // 自动保存：第一次改动后 0.5 秒内一定落盘（连续操作也不会一直往后拖）
  function scheduleSave() {
    if (S.saveTimer) return;
    S.saveTimer = setTimeout(saveNow, 500);
  }
  async function saveNow() {
    clearTimeout(S.saveTimer);
    S.saveTimer = null;
    if (!S.doc) return;
    await Store.save(S.doc);
    const n = S.notes.find((x) => x.id === S.doc.id);
    if (n) { n.title = S.doc.title; n.modified = S.doc.modified; } else S.notes.unshift({ id: S.doc.id, title: S.doc.title, modified: S.doc.modified });
    renderNoteList();
  }
  function undo() {
    if (S.editNote) finishNoteEdit();
    if (S.mind && S.mind.editing) finishMindEdit();
    const ed = activeEditor();
    if (ed) flushTyping();
    if (!S.history.length) return;
    S.future.push(snap());
    S.doc = JSON.parse(S.history.pop());
    afterHistory();
  }
  function redo() {
    if (S.editNote) finishNoteEdit();
    const ed = activeEditor();
    if (ed) flushTyping();
    if (!S.future.length) return;
    S.history.push(snap());
    S.doc = JSON.parse(S.future.pop());
    afterHistory();
  }
  function afterHistory() {
    const ed = activeEditor();
    const keepId = ed ? ed.dataset.id : null;
    renderAll();
    if (keepId && S.edEls[keepId]) focusEnd(S.edEls[keepId].ce);
    touch();
    updateUndoBtns();
  }
  function updateUndoBtns() {
    $('#btn-undo').disabled = !S.history.length;
    $('#btn-redo').disabled = !S.future.length;
  }

  /* ---------- 提示、弹窗 ---------- */
  let toastT = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), ms || 2200);
  }

  /* ---------- 工具栏 ---------- */
  function saveCfg() { Store.pref('toolcfg2', S.cfg); }
  const hlColor = () => C.hexA(S.cfg.hl.c, C.HL_LEVELS[S.cfg.hl.a || 0]);
  function setTool(id) {
    if (!TOOLS.find((t) => t.id === id)) return;
    if (id !== S.tool) { S.lastTool = S.tool; S.tool = id; }
    if (id !== 'text') S.textSession = null;
    document.body.className = document.body.className.replace(/\btool-\S+/g, '').trim() + ' tool-' + id;
    if (id !== 'lasso') clearSel();
    if (id !== 'note' && S.editNote) finishNoteEdit();
    if (id !== 'note' && typeof hideDivider === 'function') hideDivider();
    Laser.active(id === 'laser');
    renderTools();
    Store.pref('tool', id);
  }
  function renderTools() {
    const tools = $('#tools');
    tools.innerHTML = '';
    for (const t of TOOLS) {
      const b = el('button', 'tool' + (S.tool === t.id ? ' on' : ''), `<i class="ti ${t.icon}"></i><span class="kbd">${toolKbd(t.id)}</span>`);
      b.title = `${t.name}  ⌘${t.key}`;
      const cfg = S.cfg[t.id];
      if (cfg && cfg.c) {
        const bar = el('span', 'bar');
        bar.style.background = t.id === 'hl' ? hlColor() : cfg.c;
        b.appendChild(bar);
      }
      if (t.id === 'laser') b.querySelector('i').style.color = '#FF1E1E';
      b.onclick = () => setTool(t.id);
      tools.appendChild(b);
    }
    const col = el('button', 'tool collapse', '<i class="ti ti-chevron-up"></i>');
    col.title = '收起工具栏（专注模式） ⌘F';
    col.onclick = () => setZen(true);
    tools.appendChild(col);
    renderOptions();
    if (document.body.classList.contains('zen')) renderZenBtn();
  }
  // 颜色：8 个颜色槽，点选中的那个槽可以改它的颜色（系统调色盘）
  const lightColor = (c) => {
    const h = String(c).replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 170;
  };
  function saveSlots() { Store.pref('slots', S.slots); }
  function slotButton(kind, i, isOn, onPick) {
    const c = S.slots[kind][i];
    const b = el('button', 'sw' + (isOn ? ' on' : ''));
    b.style.background = c;
    b.title = isOn ? '再点一次修改这个颜色' : c;
    if (isOn) {
      b.innerHTML = `<i class="ti ti-pencil" style="color:${lightColor(c) ? '#333' : '#fff'}"></i>`;
      const inp = el('input');
      inp.type = 'color';
      inp.className = 'colorinput';
      inp.value = c.slice(0, 7).toLowerCase();
      b.appendChild(inp);
      inp.addEventListener('input', () => { S.slots[kind][i] = inp.value.toUpperCase(); b.style.background = inp.value; onPick(inp.value.toUpperCase(), true); });
      inp.addEventListener('change', () => { S.slots[kind][i] = inp.value.toUpperCase(); saveSlots(); onPick(inp.value.toUpperCase(), false); });
    }
    b.onclick = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (isOn) { const inp = b.querySelector('input'); if (inp) inp.click(); }
      else onPick(c, false, i);
    };
    return b;
  }
  function colorRow(o, kind, cfg, onPick) {
    S.slots[kind].forEach((c, i) => {
      const isOn = cfg.si != null ? cfg.si === i : c.toUpperCase() === String(cfg.c).toUpperCase();
      o.appendChild(slotButton(kind, i, isOn, (cc, live, idx) => { if (idx != null) cfg.si = idx; else if (cfg.si == null) cfg.si = i; onPick(cc, live); }));
    });
  }
  function renderOptions() {
    const o = $('#options');
    o.innerHTML = '';
    const t = S.tool;
    if (t === 'note') {
      // 批注：颜色、字号（小中大）、字体；正在写的批注会跟着改
      const cfg = S.cfg.note;
      const applyToEditing = () => {
        const n = S.editNote && noteById(S.editNote.id);
        if (n) { n.c = cfg.c; n.s = NOTE_SIZES[cfg.s]; n.f = cfg.f; renderNotes(); }
      };
      colorRow(o, 'note', cfg, (c, live) => { cfg.c = c; saveCfg(); applyToEditing(); if (!live) renderTools(); });
      o.appendChild(el('span', 'sep'));
      ['小', '中', '大'].forEach((nm, i) => {
        const b = el('button', 'mbtn' + (cfg.s === i ? ' on' : ''), `<span style="font-size:${12 + i * 2}px">${nm}</span>`);
        b.onclick = () => { cfg.s = i; saveCfg(); applyToEditing(); renderOptions(); };
        o.appendChild(b);
      });
      o.appendChild(el('span', 'sep'));
      const fb = el('button', 'fontbtn');
      setFontBtn(fb, cfg.f);
      fb.onclick = () => openFontPicker(fb, cfg.f, (k) => { cfg.f = k; saveCfg(); C.ensureFont(k, 16, '批注').then(() => { applyToEditing(); setFontBtn(fb, k); }); });
      o.appendChild(fb);
      o.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
      return;
    }
    if (t === 'anno') {
      const cfg = S.cfg.anno;
      ANNO_MODES.forEach(([m, ic, nm]) => {
        const b = el('button', 'mbtn' + (cfg.m === m ? ' on' : ''), ic ? `<i class="ti ${ic}"></i>` : '<span class="dotonly"></span>');
        b.title = nm + (['line', 'wave', 'dot'].includes(m) ? '（落在锁定文字上按字吸附）' : m === 'text' ? '（点一下写字，拖右下角改框宽，拖顶上把手挪位置）' : '');
        b.onclick = () => { cfg.m = m; saveCfg(); renderOptions(); };
        o.appendChild(b);
      });
      o.appendChild(el('span', 'sep'));
      colorRow(o, 'anno', cfg, (c, live) => {
        cfg.c = c; saveCfg();
        if (live) { const bar = $('#tools .tool.on .bar'); if (bar) bar.style.background = c; } else renderTools();
      });
      o.appendChild(el('span', 'sep'));
      if (cfg.m === 'text') {
        // 文字：小中大三档，正在写的那个也跟着变
        const cur = cfg.tsz == null ? 1 : cfg.tsz;
        ['小', '中', '大'].forEach((nm, i) => {
          const b = el('button', 'mbtn' + (cur === i ? ' on' : ''), `<span style="font-size:${12 + i * 2}px">${nm}</span>`);
          b.onclick = () => {
            cfg.tsz = i; saveCfg();
            const n = S.editNote && noteById(S.editNote.id);
            if (n) { n.s = ANNO_TEXT_SIZES[i]; renderNotes(); const d = noteEls.get(n.id); if (d) d.focus(); }
            renderOptions();
          };
          b.addEventListener('mousedown', (e) => e.preventDefault());
          o.appendChild(b);
        });
        return;
      }
      [0, 1, 2].forEach((i) => {
        const b = el('button', 'wbtn' + (cfg.w === i ? ' on' : ''));
        const dot = el('span');
        dot.style.width = dot.style.height = [4, 7, 11][i] + 'px';
        b.appendChild(dot);
        b.title = ['细', '中', '粗'][i];
        b.onclick = () => { cfg.w = i; saveCfg(); renderOptions(); };
        o.appendChild(b);
      });
      return;
    }
    if (PEN_TOOLS.includes(t) || t === 'hl') {
      const cfg = S.cfg[t];
      const isHl = t === 'hl';
      colorRow(o, isHl ? 'hl' : 'pen', cfg, (c, live) => {
        cfg.c = c;
        if (isHl && cfg.mode !== 'bg') cfg.mode = 'bg';
        saveCfg();
        if (live) { const bar = $('#tools .tool.on .bar'); if (bar) bar.style.background = isHl ? hlColor() : c; } else renderTools();
      });
      o.appendChild(el('span', 'sep'));
      if (isHl) {
        C.HL_LEVELS.forEach((lv, i) => {
          const b = el('button', 'lvbtn' + ((cfg.a || 0) === i ? ' on' : ''));
          const sw = el('span');
          sw.style.background = C.hexA(cfg.c, lv);
          b.appendChild(sw);
          b.title = ['浓', '中', '淡'][i];
          b.onclick = () => { cfg.a = i; saveCfg(); renderTools(); };
          o.appendChild(b);
        });
        o.appendChild(el('span', 'sep'));
      }
      [0, 1, 2].forEach((i) => {
        const b = el('button', 'wbtn' + (cfg.w === i ? ' on' : ''));
        const dot = el('span');
        const d = isHl ? [8, 12, 16][i] : [4, 7, 11][i];
        dot.style.width = dot.style.height = d + 'px';
        if (isHl) dot.style.borderRadius = '3px';
        b.appendChild(dot);
        b.title = ['细', '中', '粗'][i];
        b.onclick = () => { cfg.w = i; saveCfg(); renderOptions(); };
        o.appendChild(b);
      });
      if (isHl) {
        o.appendChild(el('span', 'sep'));
        [['b', 'ti-bold', '加粗'], ['u', 'ti-underline', '下划线'], ['clear', 'ti-clear-formatting', '清除']].forEach(([m, ic, nm]) => {
          const b = el('button', 'mbtn' + (cfg.mode === m ? ' on' : ''), `<i class="ti ${ic}"></i>`);
          b.title = nm + '（只对锁定的文字块）';
          b.onclick = () => { cfg.mode = cfg.mode === m ? 'bg' : m; saveCfg(); renderOptions(); };
          o.appendChild(b);
        });
      }
    }
  }

  /* ---------- 缩放 ---------- */
  function applyZoom() {
    const z = S.zoom;
    sizer.style.width = PAGE.w * z + 'px';
    sizer.style.height = S.totalH * z + 'px';
    paper.style.width = PAGE.w + 'px';
    paper.style.height = S.totalH + 'px';
    paper.style.transform = `scale(${z})`;
    ink.setAttribute('width', PAGE.w);
    ink.setAttribute('height', S.totalH);
  }
  function fitZoom() {
    const w = scroller.clientWidth - 64;
    S.zoom = Math.max(0.5, Math.min(1.8, w / PAGE.w));
    S.autoFit = true;
    applyZoom();
    if (S.doc) drawImgSel();
    saveView();
  }
  // 记住缩放（适合宽度还是固定倍数）和每篇笔记看到的位置，下次打开还是这样
  let viewT = 0;
  function saveView() {
    clearTimeout(viewT);
    viewT = setTimeout(() => {
      Store.pref('view', { autoFit: S.autoFit, zoom: Math.round(S.zoom * 1000) / 1000 });
      if (S.doc) Store.pref('scroll', { id: S.doc.id, top: Math.round(scroller.scrollTop), left: Math.round(scroller.scrollLeft) });
    }, 300);
  }
  function restoreView() {
    const v = Store.pref('view');
    if (v && v.zoom > 0) { S.zoom = Math.max(0.3, Math.min(6, v.zoom)); S.autoFit = false; applyZoom(); if (S.doc) drawImgSel(); }
    else fitZoom();
    const sp = Store.pref('scroll');
    if (sp && S.doc && sp.id === S.doc.id) { scroller.scrollTop = sp.top || 0; scroller.scrollLeft = sp.left || 0; }
  }
  scroller.addEventListener('scroll', () => saveView(), { passive: true });
  function setZoom(z, cx, cy) {
    z = Math.max(0.3, Math.min(6, z));
    const r = scroller.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    const pr = paper.getBoundingClientRect();
    const px = (cx - pr.left) / S.zoom, py = (cy - pr.top) / S.zoom;
    S.zoom = z;
    S.autoFit = false;
    applyZoom();
    const pr2 = paper.getBoundingClientRect();
    scroller.scrollLeft += pr2.left + px * z - cx;
    scroller.scrollTop += pr2.top + py * z - cy;
    drawImgSel();
    saveView();
  }
  // 捏合缩放：每帧最多缩放一次；缩放过程中先按位图放大，停下 0.2 秒后再清晰重绘
  let zTarget = null, zAt = null, zRaf = 0, zIdle = 0;
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zTarget = Math.max(0.3, Math.min(6, (zTarget || S.zoom) * Math.exp(-e.deltaY * 0.012)));
    zAt = [e.clientX, e.clientY];
    paper.classList.add('zooming');
    if (!zRaf) zRaf = requestAnimationFrame(() => { zRaf = 0; if (zTarget) setZoom(zTarget, zAt[0], zAt[1]); zTarget = null; });
    clearTimeout(zIdle);
    zIdle = setTimeout(() => paper.classList.remove('zooming'), 200);
  }, { passive: false });
  // 窗口大小和画布缩放是两回事：拉窗口不改缩放，缩放只用 ⌘＋／⌘－、捏合或“适合宽度”自己调

  function toPaper(e) {
    const r = paper.getBoundingClientRect();
    return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom };
  }

  /* ---------- 渲染 ---------- */
  function measureEdit(it) {
    const E = S.edEls[it.id];
    if (!E) return;
    const h = Math.max(E.ce.offsetHeight, it.size * C.lsOf(it));
    S.editH[it.id] = h;
  }
  function renderAll() {
    textLayer.innerHTML = '';
    ink.innerHTML = '';
    Object.values(S.edEls).forEach((E) => E.bar.remove());
    Object.values(S.chips).forEach((c) => c.remove());
    S.edEls = {}; S.blockSig = {}; S.chips = {};
    S.inkEls = new Map(); S.bbox = new Map();
    clearSel();
    closeMenu();
    C.setMargin(S.doc.margin);
    if (S.imgSel && !imgById(S.imgSel.id)) S.imgSel = null;
    for (const it of S.doc.items) if (it.type !== 'mind' && !it.locked) createEditEl(it);
    for (const it of S.doc.items) if (it.type !== 'mind' && !it.locked) measureEdit(it);
    relayout();
    renderTitle();
    updateUndoBtns();
  }
  function relayout() {
    const doc = S.doc;
    S.layout = C.computeLayout(doc, { editHeight: (it) => S.editH[it.id] || it.size * C.lsOf(it) });
    C.repairAnchors(doc, S.layout);
    const n = C.pagesNeeded(doc, S.layout);
    if (n !== S.pageCount) renderPages(n);
    S.pageCount = n;
    S.totalH = n * PAGE.h;
    applyZoom();
    const live = new Set();
    for (const it of doc.items) {
      live.add(it.id);
      if (it.type === 'mind') continue;
      if (it.locked) {
        const li = S.layout.items[it.id];
        const sig = li.rows.map((r) => r.y.toFixed(1)).join(',') + '|' + it.size + '|' + (it.grid ? 'g' + it.grid.cols + ':' + it.grid.cell : '');
        if (S.blockSig[it.id] !== sig) { renderLocked(it); S.blockSig[it.id] = sig; }
      } else positionEdit(it);
    }
    textLayer.querySelectorAll('.lblock').forEach((b) => { if (!live.has(b.dataset.id)) b.remove(); });
    syncInk();
    renderImages();
    renderNotes();
    renderMinds();
    renderChrome();
    updateCount();
    if (S.sel) drawSel();
  }
  function renderPages(n) {
    pagesEl.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const p = el('div', 'page');
      p.style.top = i * PAGE.h + 'px';
      p.style.width = PAGE.w + 'px';
      p.style.height = PAGE.h + 'px';
      if (i > 0) p.style.borderTop = '1px solid #e4e4de';
      p.appendChild(el('div', 'page-no', `${i + 1} / ${n}`));
      pagesEl.appendChild(p);
    }
  }
  function renderLocked(it, marks) {
    let host = textLayer.querySelector(`.lblock[data-id="${it.id}"]`);
    if (!host) { host = el('div', 'lblock'); host.dataset.id = it.id; textLayer.appendChild(host); }
    host.innerHTML = '';
    C.renderLockedBlock(it, S.layout.items[it.id], host, { marks });
  }
  function syncInk() {
    const seen = new Set();
    for (const s of S.doc.strokes) {
      seen.add(s.id);
      let e = S.inkEls.get(s.id);
      if (!e) {
        e = C.makeStrokeEl(s, C.strokePathD(s, s.pts));
        e.dataset.id = s.id;
        ink.appendChild(e);
        S.inkEls.set(s.id, e);
      }
      const ay = C.strokeAnchorY(S.layout, s);
      if (e._ay !== ay) { e.setAttribute('transform', `translate(0 ${ay})`); e._ay = ay; S.bbox.delete(s.id); }
    }
    for (const [id, e] of S.inkEls) if (!seen.has(id)) { e.remove(); S.inkEls.delete(id); S.bbox.delete(id); }
  }
  function refreshStroke(s) {
    const e = S.inkEls.get(s.id);
    if (e) { e.remove(); S.inkEls.delete(s.id); }
    S.bbox.delete(s.id);
  }

  /* ---------- 编辑中的文字块 ---------- */
  /* 编辑态：富文本（只允许纯文字输入，样式由工具条控制），可以选中一部分单独设字号、加粗、颜色 */
  const rgbHex = (c) => {
    if (!c) return null;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    if (!m) return c.toUpperCase();
    return '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  function buildEditorDOM(ce, it) {
    const chars = Array.from(C.normalizeText(it.text));
    const styles = C.charStyles(it);
    ce.innerHTML = '';
    let i = 0;
    for (const r of C.stylesToRuns(styles)) {
      const sp = document.createElement('span');
      sp.style.fontSize = r.s + 'px';
      if (r.b) sp.style.fontWeight = '700';
      if (r.c) sp.style.color = r.c;
      sp.textContent = chars.slice(i, i + r.n).join('');
      i += r.n;
      ce.appendChild(sp);
    }
    if (!chars.length) {
      const sp = document.createElement('span');
      const b = C.baseStyle(it);
      sp.style.fontSize = b.s + 'px';
      if (b.b) sp.style.fontWeight = '700';
      ce.appendChild(sp);
    }
    if (chars[chars.length - 1] === '\n') ce.lastChild.textContent += '\n'; // 末尾换行的占位
  }
  function readEditor(ce, it) {
    const chars = [], styles = [];
    let cur = C.baseStyle(it);
    const walk = (node, st) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          for (const ch of Array.from(n.nodeValue)) { chars.push(ch); styles.push(st); }
        } else if (n.nodeType === 1) {
          if (n.tagName === 'BR') { chars.push('\n'); styles.push(st); continue; }
          // 浏览器偶尔把行包成 div／p：按换行处理
          if ((n.tagName === 'DIV' || n.tagName === 'P') && chars.length && chars[chars.length - 1] !== '\n') { chars.push('\n'); styles.push(st); }
          const ns = Object.assign({}, st);
          if (n.style.fontSize) ns.s = Math.round(parseFloat(n.style.fontSize) * 10) / 10;
          if (n.style.fontWeight) ns.b = (n.style.fontWeight === '700' || n.style.fontWeight === 'bold') ? 1 : 0;
          if (n.style.color) ns.c = rgbHex(n.style.color);
          walk(n, ns);
        }
      }
    };
    walk(ce, cur);
    if (chars[chars.length - 1] === '\n') { chars.pop(); styles.pop(); }
    return { text: chars.join(''), styles };
  }
  // 在光标处插入纯文字（沿用光标前一个字的样式）
  function insertPlain(it, E, text, bold) {
    flushTyping();
    const before = snap();
    syncFromEditor(it, E);
    const chars = Array.from(it.text || '');
    const styles = C.charStyles(it);
    const r = getSelOffsets(E.ce) || { a: chars.length, b: chars.length };
    const st = styles[r.a - 1] || styles[r.a] || C.baseStyle(it);
    const add = Array.from(text);
    chars.splice(r.a, r.b - r.a, ...add);
    styles.splice(r.a, r.b - r.a, ...add.map((ch, i) => (bold && bold[i] ? Object.assign({}, st, { b: 1 }) : st)));
    it.text = chars.join('');
    it.runs = C.stylesToRuns(styles);
    buildEditorDOM(E.ce, it);
    E.ce.focus();
    setSelOffsets(E.ce, r.a + add.length, r.a + add.length);
    measureEdit(it);
    relayout();
    commit(before);
  }
  function syncFromEditor(it, E) {
    const r = readEditor(E.ce, it);
    it.text = r.text;
    it.runs = C.stylesToRuns(r.styles);
    if (r.styles.length) { it.size = r.styles[0].s; }
  }
  function cpOffset(root, node, off) {
    const r = document.createRange();
    r.setStart(root, 0);
    try { r.setEnd(node, off); } catch (e) { return 0; }
    return Array.from(r.toString()).length;
  }
  function getSelOffsets(ce) {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const rg = sel.getRangeAt(0);
    if (!ce.contains(rg.startContainer)) return null;
    const a = cpOffset(ce, rg.startContainer, rg.startOffset), b = cpOffset(ce, rg.endContainer, rg.endOffset);
    return { a: Math.min(a, b), b: Math.max(a, b) };
  }
  function setSelOffsets(ce, a, b) {
    const find = (off) => {
      const tw = document.createTreeWalker(ce, NodeFilter.SHOW_TEXT);
      let n, left = off;
      while ((n = tw.nextNode())) {
        const cps = Array.from(n.nodeValue);
        if (left <= cps.length) return [n, cps.slice(0, left).join('').length];
        left -= cps.length;
      }
      return [ce, ce.childNodes.length];
    };
    const [sn, so] = find(a), [en, eo] = find(b);
    const r = document.createRange();
    r.setStart(sn, so);
    r.setEnd(en, eo);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  function focusEnd(ce) {
    ce.focus();
    const r = document.createRange();
    r.selectNodeContents(ce);
    r.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  // 打字的撤销：停顿 0.7 秒记一次
  let typing = null;
  function flushTyping() {
    if (!typing) return;
    clearTimeout(typing.t);
    const tp = typing;
    typing = null;
    if (snap() !== tp.before) commit(tp.before);
  }
  function applyEditStyle(it, E) {
    E.ce.style.fontFamily = (C.FONTS[it.font] || C.FONTS.sans).css + ', sans-serif';
    E.ce.style.lineHeight = String(C.lsOf(it));
    if (E.lsBtn) E.lsBtn.querySelector('span').textContent = C.lsOf(it);
    setFontBtn(E.fontBtn, it.font);
    refreshEditBar(it, E);
  }
  function refreshEditBar(it, E) {
    const styles = C.charStyles(it);
    const range = E.lastSel && E.lastSel.b > E.lastSel.a ? E.lastSel : null;
    const st = (range ? styles[range.a] : styles[0]) || C.baseStyle(it);
    if (document.activeElement !== E.sz) E.sz.value = st.s;
    const part = range ? styles.slice(range.a, range.b) : styles;
    E.bold.classList.toggle('on', part.length > 0 && part.every((x) => x.b));
    E.colorBar.style.background = st.c || '#1a1a1a';
  }
  function createEditEl(it) {
    const wrap = el('div', 'eblock');
    wrap.dataset.id = it.id;
    wrap.style.left = PAGE.mx + 'px';
    wrap.style.width = PAGE.cw + 'px';
    const ce = el('div', 'ced');
    ce.dataset.id = it.id;
    ce.contentEditable = 'plaintext-only';
    ce.spellcheck = false;
    wrap.appendChild(ce);
    textLayer.appendChild(wrap);
    buildEditorDOM(ce, it);
    const bar = el('div', 'ebar');
    bar.innerHTML = `
      <button class="grip" title="按住上下拖动，调整位置"><i class="ti ti-grip-horizontal"></i></button>
      <button class="fontbtn" title="字体"></button>
      <button class="dec" title="字号减小（先选中文字就只改选中的）"><i class="ti ti-minus"></i></button>
      <input class="szin" type="number" min="8" max="160" step="1" title="字号（可直接输入）">
      <button class="inc" title="字号增大"><i class="ti ti-plus"></i></button>
      <button class="boldbtn" title="加粗"><i class="ti ti-bold"></i></button>
      <button class="colorbtn" title="文字颜色"><i class="ti ti-letter-a"></i><span class="cbar"></span></button>
      <button class="lsbtn" title="行距"><i class="ti ti-line-height"></i><span></span></button>
      <button class="danger del" title="删除文字块"><i class="ti ti-trash"></i></button>`;
    ui.appendChild(bar);
    const E = { wrap, ce, bar, sz: bar.querySelector('.szin'), fontBtn: bar.querySelector('.fontbtn'), lsBtn: bar.querySelector('.lsbtn'), bold: bar.querySelector('.boldbtn'), colorBar: bar.querySelector('.cbar'), lastSel: null };
    S.edEls[it.id] = E;
    applyEditStyle(it, E);
    // 工具条按钮不抢输入框的焦点和选区
    bar.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    ce.addEventListener('focus', () => { if (!typing) S.lastSnap = snap(); S.textSession = it.id; });
    ce.addEventListener('blur', () => { flushTyping(); });
    ce.addEventListener('focusout', (e) => {
      if (!(e.relatedTarget && bar.contains(e.relatedTarget)) && !E.keepSel) E.lastSel = null;
    });
    ce.addEventListener('input', () => {
      if (!typing) typing = { before: S.lastSnap || snap(), t: 0 };
      syncFromEditor(it, E);
      const old = S.editH[it.id];
      measureEdit(it);
      if (old !== S.editH[it.id]) relayout(); else updateCount();
      clearTimeout(typing.t);
      typing.t = setTimeout(flushTyping, 700);
      touch();
    });
    ce.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      // 带加粗的（Claude 对话、Obsidian 的 **加粗**）：按加粗插进去
      const rich = cd && richFromClipboard(cd);
      if (rich && rich.text) { e.preventDefault(); insertPlain(it, E, rich.text, rich.bold); return; }
      const text = cd && cd.getData('text/plain');
      if (text) return; // 纯文字照常粘贴，沿用光标处的样式
      e.preventDefault();
      const ins = (t) => insertPlain(it, E, C.normalizeText(t));
      const html = cd && cd.getData('text/html');
      const ht = html && htmlToText(html);
      if (ht && ht.trim()) { ins(ht); return; }
      const file = cd && Array.from(cd.items || []).filter((x) => x.kind === 'file' && /^image\//.test(x.type)).map((x) => x.getAsFile())[0];
      clipRichText().then((rt) => {
        if (rt && rt.trim()) ins(rt);
        else if (file) fileToDataURL(file).then((u) => insertImage(u));
      });
    });
    // 改样式：有选中文字就只改选中的，没选就改整块
    const restyle = (fn) => {
      flushTyping();
      const b = snap();
      let styles = C.charStyles(it);
      const range = E.lastSel && E.lastSel.b > E.lastSel.a ? E.lastSel : null;
      if (!styles.length) {
        // 空文字块：改的是以后输入文字的默认样式
        const base = [C.baseStyle(it)];
        fn(base, 0, 1);
        it.size = base[0].s; it.bold = !!base[0].b;
      } else {
        const lo = range ? range.a : 0, hi = range ? range.b : styles.length;
        fn(styles, lo, hi);
        it.runs = C.stylesToRuns(styles);
        it.size = styles[0].s;
        if (!range) it.bold = !!styles[0].b;
      }
      buildEditorDOM(ce, it);
      if (range) { ce.focus(); setSelOffsets(ce, range.a, range.b); E.lastSel = range; }
      applyEditStyle(it, E);
      measureEdit(it);
      relayout();
      commit(b);
      if (!range && it.size <= 40 && !it.bold) rememberText(it);
    };
    const setSize = (fnSize) => restyle((st, lo, hi) => { for (let i = lo; i < hi; i++) st[i] = Object.assign({}, st[i], { s: Math.max(8, Math.min(160, fnSize(st[i].s))) }); });
    E.fontBtn.onclick = () => openFontPicker(E.fontBtn, it.font, async (k) => {
      await C.ensureFont(k, it.size, it.text);
      const b = snap(); it.font = k; applyEditStyle(it, E); measureEdit(it); relayout(); commit(b);
      rememberText(it);
    });
    bar.querySelector('.dec').onclick = () => setSize((v) => v - 1);
    bar.querySelector('.inc').onclick = () => setSize((v) => v + 1);
    E.sz.addEventListener('focus', () => { E.keepSel = true; });
    const applySize = () => {
      const v = Math.round(parseFloat(E.sz.value));
      E.keepSel = false;
      if (!v) { refreshEditBar(it, E); return; }
      setSize(() => v);
    };
    E.sz.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); applySize(); } if (ev.key === 'Escape') { E.keepSel = false; refreshEditBar(it, E); E.sz.blur(); } });
    E.sz.addEventListener('blur', () => { E.keepSel = false; });
    E.bold.onclick = () => restyle((st, lo, hi) => {
      const all = st.slice(lo, hi).every((x) => x.b);
      for (let i = lo; i < hi; i++) st[i] = Object.assign({}, st[i], { b: all ? 0 : 1 });
    });
    bar.querySelector('.colorbtn').onclick = (e) => openColorPop(bar.querySelector('.colorbtn'), E, (c) => restyle((st, lo, hi) => {
      for (let i = lo; i < hi; i++) st[i] = Object.assign({}, st[i], { c: c === '#000000' || c === '#1A1A1A' ? null : c });
    }));
    bar.querySelector('.del').onclick = () => deleteBlock(it);
    E.lsBtn.onclick = () => openLsPop(E.lsBtn, it, () => { applyEditStyle(it, E); measureEdit(it); relayout(); });
    bindSpaceDrag(bar.querySelector('.grip'), it, null);
  }
  // 文字颜色弹层：8 个颜色槽，点一下给文字上色，再点同一个就修改这个槽的颜色
  let colorPop = null;
  function closeColorPop() { if (colorPop) { colorPop.remove(); colorPop = null; } }
  function openColorPop(anchor, E, onPick) {
    if (colorPop) { closeColorPop(); return; }
    colorPop = el('div', 'colorpop');
    colorPop.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
    let cur = E.textSlot != null ? E.textSlot : -1;
    const draw = () => {
      colorPop.innerHTML = '';
      S.slots.text.forEach((c, i) => {
        colorPop.appendChild(slotButton('text', i, i === cur, (cc, live) => {
          if (i !== cur) { cur = i; E.textSlot = i; draw(); }
          if (!live) { E.keepSel = false; onPick(cc); }
        }));
      });
      const inp = colorPop.querySelector('input');
      if (inp) inp.addEventListener('click', () => { E.keepSel = true; });
    };
    draw();
    const r = anchor.getBoundingClientRect();
    colorPop.style.left = r.left + 'px';
    colorPop.style.top = (r.bottom + 6) + 'px';
    document.body.appendChild(colorPop);
  }
  document.addEventListener('pointerdown', (e) => { if (colorPop && !colorPop.contains(e.target) && !e.target.closest('.colorbtn')) closeColorPop(); }, true);
  document.addEventListener('selectionchange', () => {
    const ce = activeEditor();
    if (!ce) return;
    const E = S.edEls[ce.dataset.id];
    const it = S.doc.items.find((x) => x.id === ce.dataset.id);
    if (!E || !it) return;
    E.lastSel = getSelOffsets(ce);
    refreshEditBar(it, E);
  });
  function positionEdit(it) {
    const E = S.edEls[it.id];
    if (!E) return;
    const li = S.layout.items[it.id];
    E.wrap.style.left = PAGE.mx + 'px';
    E.wrap.style.top = li.top + 'px';
    E.wrap.style.width = PAGE.cw + 'px';
    E.bar.style.left = PAGE.mx + 'px';
    E.bar.style.top = (li.top - 42) + 'px';
  }
  async function lockBlock(it) {
    if (it.locked || !it.text.trim()) return;
    const ae = activeEditor();
    if (ae) { const E0 = S.edEls[ae.dataset.id]; if (E0) syncFromEditor(S.doc.items.find((x) => x.id === ae.dataset.id) || it, E0); ae.blur(); }
    await C.ensureFont(it.font, it.size, it.text);
    const before = snap();
    C.lockBlockData(it);
    commit(before);
    renderAll();
    textDone();
  }
  function deleteBlock(it) {
    const before = snap();
    const doc = S.doc;
    const idx = doc.items.indexOf(it);
    const li = S.layout.items[it.id];
    const next = doc.items[idx + 1];
    if (next && li) {
      const nl = S.layout.items[next.id];
      if (nl) next.spaceBefore = Math.max(0, nl.top - li.prevBottom);
    }
    doc.items.splice(idx, 1);
    delete S.editH[it.id];
    commit(before);
    renderAll();
  }
  // 拖动调整文字块和上一块之间的空白
  function bindSpaceDrag(handle, it, onClick) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const y0 = e.clientY, sb0 = it.spaceBefore || 0;
      const before = snap();
      let moved = false, raf = 0;
      const mv = (ev) => {
        const dy = (ev.clientY - y0) / S.zoom;
        if (Math.abs(dy) > 3) moved = true;
        if (!moved) return;
        it.spaceBefore = Math.max(0, sb0 + dy);
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; relayout(); });
      };
      const up = () => {
        handle.removeEventListener('pointermove', mv);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        if (moved) { relayout(); commit(before); } else if (onClick) onClick();
      };
      handle.addEventListener('pointermove', mv);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }
  // 文字块习惯：最后一次整块设置的字体、字号、行距，新文字块沿用（跨笔记）
  function rememberText(it) {
    const o = Object.assign({}, S.cfg.text, { font: it.font, ls: C.lsOf(it) });
    if (it.size <= 40) o.size = it.size;
    S.cfg.text = o; saveCfg();
  }
  function createBlockAt(y, text, focus, bold) {
    const doc = S.doc, L = S.layout;
    const before = snap();
    let idx = 0, prevBottom = PAGE.my;
    doc.items.forEach((it, i) => {
      const li = L.items[it.id];
      if (li && li.top < y) { idx = i + 1; prevBottom = li.bottom; }
    });
    const cfg = S.cfg.text;
    const it = { id: C.uid(), type: 'text', locked: false, text: C.normalizeText(text || ''), font: C.FONTS[cfg.font] ? cfg.font : 'sans', size: cfg.size || 16, bold: !!cfg.bold, ls: cfg.ls || 1.5, spaceBefore: Math.max(0, y - prevBottom), marks: {}, rowGaps: {} };
    if (bold && bold.some(Boolean)) it.runs = C.stylesToRuns(Array.from(it.text).map((ch, i) => ({ s: it.size, b: bold[i] || it.bold ? 1 : 0, c: null })));
    const next = doc.items[idx];
    if (next) {
      const nl = L.items[next.id];
      const estH = it.size * C.lsOf(it) * Math.max(1, it.text.split('\n').length);
      next.spaceBefore = Math.max(16, nl.top - (y + estH));
    }
    doc.items.splice(idx, 0, it);
    commit(before);
    renderAll();
    if (focus !== false) {
      const E = S.edEls[it.id];
      if (E) focusEnd(E.ce);
    }
    return it;
  }
  function pasteAsBlock(text, bold) {
    text = C.normalizeText(text).replace(/\s+$/, '');
    if (!text.trim()) return;
    const L = S.layout;
    let y = PAGE.my;
    if (S.doc.items.length) y = L.contentBottom + 28;
    const it = createBlockAt(y, text, true, bold);
    setTool('text');
    const li = S.layout.items[it.id];
    if (li) scroller.scrollTop = Math.max(0, li.top * S.zoom - 120);
  }
  document.addEventListener('paste', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
    const cd = e.clipboardData;
    if (!cd) return;
    let text = cd.getData('text/plain');
    if (!text || !text.trim()) { const html = cd.getData('text/html'); if (html) text = htmlToText(html); }
    // 选中导图时粘贴：Markdown／多行文字按层级插到选中的主题下面
    if (S.mind && !S.mind.editing && text && text.trim()) { e.preventDefault(); pasteIntoMind(text); return; }
    // 页面上粘贴一律是文字块（要导图就先插入导图、选中后再粘贴）；带加粗的保留加粗
    const rich = richFromClipboard(cd);
    if (rich && rich.text.trim()) { e.preventDefault(); pasteAsBlock(rich.text, rich.bold); return; }
    if (text && text.trim()) { e.preventDefault(); pasteAsBlock(text); return; }
    const file = Array.from(cd.items || []).filter((x) => x.kind === 'file' && /^image\//.test(x.type)).map((x) => x.getAsFile())[0];
    e.preventDefault();
    clipRichText().then((rt) => {
      if (rt && rt.trim()) pasteAsBlock(rt);
      else if (file) fileToDataURL(file).then((u) => insertImage(u));
    });
  });
  /* 剪贴板里的加粗：返回 { text, bold: [每个字是否加粗] }，没有加粗就返回 null
     1）纯文字里的 Markdown：**加粗**、# 标题（Obsidian 编辑模式、Claude 的复制按钮）
     2）网页格式里的加粗：<strong>、<b>、标题、粗体样式（Claude 对话里选中复制、Obsidian 阅读模式） */
  function richFromClipboard(cd) {
    const plain = cd.getData('text/plain') || '';
    const html = cd.getData('text/html') || '';
    if (/\*\*[^*\n]+\*\*/.test(plain) || /^#{1,6}\s/m.test(plain)) return mdBold(plain);
    if (html && /<(b|strong|h[1-6])[\s>]|font-weight\s*:\s*(bold|[6-9]00)/i.test(html)) {
      const r = htmlBold(html);
      if (r && r.bold.some(Boolean)) return r;
    }
    return null;
  }
  function segsToRich(segs) {
    const text = [], bold = [];
    for (const [t, b] of segs) for (const ch of Array.from(C.normalizeText(t))) { text.push(ch); bold.push(!!b); }
    while (text.length && /\s/.test(text[text.length - 1])) { text.pop(); bold.pop(); }
    while (text.length && text[0] === '\n') { text.shift(); bold.shift(); }
    return { text: text.join(''), bold };
  }
  function mdBold(src) {
    const segs = [];
    for (let line of C.normalizeText(src).split('\n')) {
      let head = false;
      const hm = /^(#{1,6})\s+/.exec(line);
      if (hm) { line = line.slice(hm[0].length); head = true; }
      const re = /\*\*([^*\n]+?)\*\*/g;
      let last = 0, m;
      while ((m = re.exec(line))) {
        if (m.index > last) segs.push([line.slice(last, m.index), head]);
        segs.push([m[1], true]);
        last = m.index + m[0].length;
      }
      if (last < line.length) segs.push([line.slice(last), head]);
      segs.push(['\n', false]);
    }
    return segsToRich(segs);
  }
  function htmlBold(html) {
    try {
      const d = new DOMParser().parseFromString(html, 'text/html');
      d.querySelectorAll('style,script,head').forEach((n) => n.remove());
      const segs = [];
      const endsNL = () => { for (let i = segs.length - 1; i >= 0; i--) { if (segs[i][0]) return segs[i][0].endsWith('\n'); } return true; };
      const BLOCK = /^(P|DIV|LI|H[1-6]|TR|BLOCKQUOTE|PRE|SECTION|ARTICLE|TABLE|UL|OL)$/;
      const isBold = (n, inherit) => {
        if (/^(B|STRONG|H[1-6])$/.test(n.tagName)) inherit = true;
        const fw = n.style && n.style.fontWeight;
        if (fw) { if (/bold|bolder/.test(fw) || parseInt(fw, 10) >= 600) inherit = true; else if (/normal|lighter/.test(fw) || parseInt(fw, 10) < 600) inherit = false; }
        return inherit;
      };
      const walk = (n, b) => {
        let idx = 0;
        for (const c of n.childNodes) {
          if (c.nodeType === 3) segs.push([c.nodeValue.replace(/[\r\n]+/g, '').replace(/\u00a0/g, ' '), b]);
          else if (c.nodeType === 1) {
            if (c.tagName === 'BR') { segs.push(['\n', false]); continue; }
            const blk = BLOCK.test(c.tagName);
            if (blk && !endsNL()) segs.push(['\n', false]);
            if (c.tagName === 'LI') { idx++; segs.push([n.tagName === 'OL' ? idx + '. ' : '· ', false]); }
            walk(c, isBold(c, b));
            if (blk && !endsNL()) segs.push(['\n', false]);
          }
        }
      };
      walk(d.body, false);
      return segsToRich(segs);
    } catch (err) { return null; }
  }
  // 网页格式转纯文字：段落、换行、列表各占一行
  function htmlToText(html) {
    try {
      const d = new DOMParser().parseFromString(html, 'text/html');
      d.querySelectorAll('style,script,head').forEach((n) => n.remove());
      let out = '';
      const BLOCK = /^(P|DIV|LI|H[1-6]|TR|BLOCKQUOTE|PRE|SECTION|ARTICLE|TABLE|UL|OL)$/;
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) out += c.nodeValue.replace(/[\r\n]+/g, '');
          else if (c.nodeType === 1) {
            if (c.tagName === 'BR') { out += '\n'; continue; }
            const blk = BLOCK.test(c.tagName);
            if (blk && out && !out.endsWith('\n')) out += '\n';
            walk(c);
            if (blk && out && !out.endsWith('\n')) out += '\n';
          }
        }
      };
      walk(d.body);
      return out.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '');
    } catch (err) { return ''; }
  }
  // 剪贴板里只有 RTF（WPS、Pages 等）时，让主进程转成纯文字
  async function clipRichText() {
    try { return (window.api && window.api.clipText) ? await window.api.clipText() : ''; } catch (err) { return ''; }
  }
  textLayer.addEventListener('pointerdown', (e) => {
    if (S.tool !== 'text') return;
    if (e.target.closest('.eblock')) return;
    const pt = toPaper(e);
    const hdv = DIV_TOOLS.has(S.tool) && hitDivider(pt);
    if (hdv) {
      e.preventDefault();
      textLayer.setPointerCapture(e.pointerId);
      act = startDividerDrag(hdv, pt, () => {});
      act.pid = e.pointerId;
      return;
    }
    const him = hitImage(pt);
    if (him) { e.preventDefault(); selectImage(him.id); return; }
    if (S.imgSel) { selectImage(null); e.preventDefault(); return; }
    const hm = hitMind(pt);
    if (hm) { e.preventDefault(); activateMind(hm.it.id, hm.node); return; }
    const ae = activeEditor();
    if (ae || (S.textSession && S.doc.items.some((x) => x.id === S.textSession))) { e.preventDefault(); if (ae) ae.blur(); textDone(); return; }
    for (const it of S.doc.items) {
      const li = S.layout.items[it.id];
      if (li && pt.y >= li.top - 6 && pt.y <= li.bottom) return;
    }
    e.preventDefault();
    const size = S.cfg.text.size || 16;
    createBlockAt(pt.y - size * 0.9, '', true);
  });
  // 文本工具是一次性的：一个文字框写完（点外面、Esc、锁定）就回到上一个工具，空文字框直接消失
  function textDone() {
    S.textSession = null;
    cleanEmptyBlocks();
    if (S.tool === 'text' && S.lastTool && S.lastTool !== 'text') setTool(S.lastTool);
  }
  function cleanEmptyBlocks() {
    const ae = activeEditor();
    const empty = S.doc.items.filter((x) => x.type === 'text' && !x.locked && !(x.text || '').trim() && !(ae && ae.dataset.id === x.id));
    if (!empty.length) return;
    S.doc.items = S.doc.items.filter((x) => !empty.includes(x));
    empty.forEach((x) => delete S.editH[x.id]);
    renderAll();
  }

  /* 行距：编辑中和已锁定的文字块都能调（锁定后只改上下间距，不改每行的字） */
  const LS_OPTIONS = [1.2, 1.35, 1.5, 1.65, 1.8, 2, 2.5];
  let lsPop = null;
  function closeLsPop() { if (lsPop) { lsPop.remove(); lsPop = null; } }
  function openLsPop(anchor, it, after) {
    if (lsPop) { closeLsPop(); return; }
    lsPop = el('div', 'lspop');
    lsPop.addEventListener('mousedown', (e) => e.preventDefault());
    LS_OPTIONS.forEach((v) => {
      const b = el('button', C.lsOf(it) === v ? 'on' : '', String(v));
      b.onclick = () => {
        const before = snap();
        it.ls = v;
        S.cfg.text = Object.assign({}, S.cfg.text, { ls: v }); saveCfg();
        closeLsPop();
        if (after) after(); else relayout();
        commit(before);
      };
      lsPop.appendChild(b);
    });
    const r = anchor.getBoundingClientRect();
    lsPop.style.left = r.left + 'px';
    lsPop.style.top = (r.bottom + 6) + 'px';
    document.body.appendChild(lsPop);
  }
  document.addEventListener('pointerdown', (e) => { if (lsPop && !lsPop.contains(e.target) && !(e.target.closest && e.target.closest('.lsbtn'))) closeLsPop(); }, true);

  /* ---------- 锁头、段落字数 ---------- */
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function openBlockMenu(it, x, y) {
    closeMenu();
    menuEl = el('div', 'menu');
    menuEl.style.left = x + 'px';
    menuEl.style.top = y + 'px';
    menuEl.innerHTML = `<button class="gridbtn${it.grid ? ' on' : ''}"><i class="gridico"></i>格子纸${it.grid ? '<i class="ti ti-check gchk"></i>' : ''}</button>` +
      (it.grid ? '' : `<button class="lsbtn"><i class="ti ti-line-height"></i>行距 ${C.lsOf(it)}</button>`) +
      `<button class="danger del"><i class="ti ti-trash"></i>删除文字块</button>`;
    menuEl.querySelector('.del').onclick = () => { closeMenu(); deleteBlock(it); };
    // 格子纸：申论答题纸的样子，再点一次还原
    menuEl.querySelector('.gridbtn').onclick = () => {
      const before = snap();
      if (it.grid) C.removeGrid(it); else C.applyGrid(it, 25);
      closeMenu();
      relayout();
      commit(before);
    };
    const lb = menuEl.querySelector('.lsbtn');
    if (lb) lb.onclick = () => openLsPop(lb, it, () => { closeMenu(); relayout(); });
    ui.appendChild(menuEl);
  }
  document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target) && !(e.target.closest && (e.target.closest('.lockchip') || e.target.closest('.lspop')))) closeMenu(); }, true);

  function renderChrome() {
    const live = new Set();
    ui.querySelectorAll('.bcount').forEach((p) => p.remove());
    for (const it of S.doc.items) {
      const li = S.layout.items[it.id];
      if (it.type === 'mind') {
        const key = it.id + ':M';
        live.add(key);
        let chip = S.chips[key];
        if (!chip) {
          chip = el('div', 'lockchip locked', '<i class="ti ti-sitemap"></i>');
          chip.title = '思维导图（拖动调位置，点击编辑）';
          S.chips[key] = chip;
          ui.appendChild(chip);
          bindSpaceDrag(chip, it, () => activateMind(it.id));
        }
        chip.style.left = (PAGE.mx - 40) + 'px';
        chip.style.top = (li.top + 4) + 'px';
        continue;
      }
      const key = it.id + (it.locked ? ':L' : ':E');
      live.add(key);
      let chip = S.chips[key];
      if (!chip) {
        chip = el('div', 'lockchip' + (it.locked ? ' locked' : ''), `<i class="ti ${it.locked ? 'ti-lock' : 'ti-lock-open'}"></i>`);
        chip.title = it.locked ? '已锁定（拖动调位置，点击打开菜单）' : '未锁定（点击锁定，⌘L）';
        S.chips[key] = chip;
        ui.appendChild(chip);
        bindSpaceDrag(chip, it, () => {
          if (!it.locked) { lockBlock(it); return; }
          const r = S.layout.items[it.id];
          openBlockMenu(it, PAGE.mx - 36, r.top + 30);
        });
      }
      const rowH = it.locked && li.rows && li.rows[0] ? li.rows[0].h : it.size * C.ROW_H;
      chip.style.left = (PAGE.mx - 40) + 'px';
      chip.style.top = (li.top + (it.locked ? (rowH - 26) / 2 : (it.size * C.lsOf(it) - 26) / 2)) + 'px';
      if (S.showCount) {
        // 字数只统计整个文字块，显示在文字块右下角
        const p = el('div', 'bcount', `${C.countChars(it.text)} 字`);
        p.dataset.id = it.id;
        p.style.left = (PAGE.w - PAGE.mx) + 'px';
        const bottom = it.locked ? li.rows[li.rows.length - 1].y + rowH : li.bottom;
        // 格子纸：放到黑色外框下面，不和“100字”标记重叠
        p.style.top = (it.grid ? bottom + it.grid.cell * 0.8 + 8 : bottom + 4) + 'px';
        ui.appendChild(p);
      }
    }
    Object.keys(S.chips).forEach((id) => { if (!live.has(id)) { S.chips[id].remove(); delete S.chips[id]; } });
  }
  function updateCount() {
    if (!S.showCount) return;
    ui.querySelectorAll('.bcount').forEach((p) => {
      const it = S.doc.items.find((x) => x.id === p.dataset.id);
      if (it) p.textContent = `${C.countChars(it.text)} 字`;
    });
  }

  /* 鼠标靠近未锁定文字块的左右边缘时，边上出现跟随的锁头，点一下锁定 */
  const hoverLock = el('div', 'lockchip hover', '<i class="ti ti-lock-open"></i>');
  hoverLock.title = '锁定这个文字块（⌘L）';
  hoverLock.style.display = 'none';
  let hoverIt = null;
  hoverLock.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
  hoverLock.addEventListener('click', () => { const it = hoverIt && S.doc.items.find((x) => x.id === hoverIt.id); hoverLock.style.display = 'none'; if (it) lockBlock(it); });
  scroller.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    if (!hoverLock.parentNode) ui.appendChild(hoverLock);
    if (e.target === hoverLock || hoverLock.contains(e.target)) return;
    const pt = toPaper(e);
    let found = null, side = 0;
    for (const it of S.doc.items) {
      if (it.locked || it.type === 'mind') continue;
      const li = S.layout.items[it.id];
      if (!li || pt.y < li.top - 6 || pt.y > li.bottom + 6) continue;
      if (pt.x > PAGE.mx - 46 && pt.x < PAGE.mx + 36) { found = it; side = -1; break; }
      if (pt.x > PAGE.mx + PAGE.cw - 36 && pt.x < PAGE.mx + PAGE.cw + 46) { found = it; side = 1; break; }
    }
    if (!found) { hoverLock.style.display = 'none'; hoverIt = null; return; }
    const li = S.layout.items[found.id];
    hoverIt = found;
    hoverLock.style.display = 'flex';
    hoverLock.style.left = (side < 0 ? PAGE.mx - 40 : PAGE.mx + PAGE.cw + 12) + 'px';
    hoverLock.style.top = Math.max(li.top, Math.min(li.bottom - 26, pt.y - 13)) + 'px';
  });

  /* ---------- 墨迹工具 ---------- */
  let act = null;
  overlay.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    closeMenu();
    if (activeEditor() && S.tool !== 'text') {
      // 在文字框外落笔：保持输入框内容，结束编辑
      document.activeElement.blur();
    }
    let tool = S.tool;
    const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32));
    if (penEraser) tool = 'eraser';
    const pt = toPaper(e);
    e.preventDefault();
    // 图片：点空白处取消选中；导航工具单击选中；任何工具双击选中
    const him = hitImage(pt);
    const hmd = him ? null : hitMind(pt);
    if (S.imgSel) { selectImage(null); return; }
    // 图片、思维导图：导航工具单击选中，其他工具双击选中（第一下点出的小墨点会撤掉）
    const tgt = him ? { k: 'img', id: him.id } : hmd ? { k: 'mind', id: hmd.it.id, node: hmd.node } : null;
    if (tgt) {
      const now = performance.now();
      const pick = () => { if (tgt.k === 'img') selectImage(tgt.id); else activateMind(tgt.id, tgt.node); };
      if (tool === 'hand') { pick(); return; }
      if (S.lastTap && S.lastTap.img === tgt.id && now - S.lastTap.t < 450) {
        if (S.lastTap.stroke) {
          S.doc.strokes = S.doc.strokes.filter((x) => x.id !== S.lastTap.stroke);
          S.history.pop();
          relayout();
          updateUndoBtns();
        }
        S.lastTap = null;
        pick();
        return;
      }
      S.lastTap = { img: tgt.id, t: now, stroke: null };
    } else S.lastTap = null;
    overlay.setPointerCapture(e.pointerId);
    const toolAct = () => {
      if (PEN_TOOLS.includes(tool)) return startInk(e, pt, tool);
      if (tool === 'hl') {
        // 标记笔：落在锁定文字上就按字块标记，落在空白处就是普通荧光笔
        const h = hitChar(pt);
        if (h) return startMark(h);
        if (S.cfg.hl.mode === 'bg') return startInk(e, pt, 'hl');
        return null;
      }
      if (tool === 'eraser') return startErase(pt, !penEraser);
      if (tool === 'note') return startNote(pt);
      if (tool === 'laser') return Laser.press();
      if (tool === 'hand') return startPan(e);
      if (tool === 'anno') {
        const cfg = S.cfg.anno;
        const hs = hitShape(pt);
        if (hs) return startShapeDrag(hs, pt);
        // 文字（像微信截图里的）：点文字就改字（顶上出现拖动把手、右下角出现改框宽的把手）；点空白处新建，正在写的时候点空白处就是写完
        const hn = hitNote(pt);
        if (hn) { if (!(S.editNote && S.editNote.id === hn.id)) editNote(hn.id); return null; }
        if (cfg.m === 'text') {
          if (S.editNote) { finishNoteEdit(); return null; }
          createNote(pt, { c: cfg.c, s: ANNO_TEXT_SIZES[cfg.tsz == null ? 1 : cfg.tsz], f: 'sans', b: 1 });
          return null;
        }
        if (S.editNote) finishNoteEdit();
        if (cfg.m === 'circle' || cfg.m === 'rect' || cfg.m === 'arrow') return startShape(pt, cfg.m);
        // 直线、波浪线、着重号：落在锁定文字上按字块吸附，别处正常手绘
        const h = hitChar(pt);
        if (h) return startMark(h, { mode: 'ln', ln: cfg.m, c: cfg.c, w: cfg.w });
        return startInk(e, pt, 'anno');
      }
      return null;
    };
    // 隐藏分栏：除橡皮擦、镭射外任何工具都能按住上下拖（横着划出去就还是原来的工具）
    const hd = DIV_TOOLS.has(tool) && tool !== 'note' && !hitNote(pt) && hitDivider(pt);
    act = hd ? startDividerOr(hd, pt, toolAct) : toolAct();
    if (act) act.pid = e.pointerId;
  });
  // 分栏只在批注工具（⌘3）下能拖，其他工具不碰分栏，避免写字时误触
  const DIV_TOOLS = new Set(['note']);
  function startDividerOr(hd, pt, fallback) {
    const dd = startDividerDrag(hd, pt, () => {});
    let inner = null;
    return {
      move(evs) {
        if (!inner) {
          const p = toPaper(evs[evs.length - 1]);
          const dx = Math.abs(p.x - pt.x), dy = Math.abs(p.y - pt.y);
          if (Math.max(dx, dy) < 3) return;
          if (dx > dy * 1.3) { dd.cancel(); inner = fallback() || { move() {}, end() {} }; } else inner = dd;
        }
        inner.move(evs);
      },
      end() { (inner || dd).end(); },
    };
  }
  overlay.addEventListener('pointermove', (e) => {
    if (!act || e.pointerId !== act.pid) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    act.move(evs.length ? evs : [e]);
  });
  const endAct = (e) => {
    if (!act || e.pointerId !== act.pid) return;
    const a = act;
    act = null;
    a.end();
    if (pendingBack) { const b = pendingBack; pendingBack = null; setTool(b); }
  };
  overlay.addEventListener('pointerup', endAct);
  overlay.addEventListener('pointercancel', endAct);
  textLayer.addEventListener('pointermove', (e) => { if (act && e.pointerId === act.pid) act.move([e]); });
  textLayer.addEventListener('pointerup', endAct);
  textLayer.addEventListener('pointercancel', endAct);

  function startInk(e, pt, tool) {
    const cfg = S.cfg[tool];
    const isHl = tool === 'hl';
    const s = { id: C.uid(), t: isHl ? 'hl' : 'pen', c: cfg.c, w: (isHl ? C.HL_WIDTHS : C.PEN_WIDTHS)[cfg.w], sim: e.pointerType === 'pen' ? 0 : 1, pts: [] };
    if (isHl) s.o = C.HL_LEVELS[cfg.a || 0];
    const pts = [];
    const pathEl = C.makeStrokeEl(s, '');
    ink.appendChild(pathEl);
    let raf = 0;
    const add = (ev) => {
      const p = toPaper(ev);
      const pr = s.sim ? 0.5 : (ev.pressure || 0.5);
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p.x - last[0], p.y - last[1]) < 0.35 / S.zoom) { last[2] = Math.max(last[2], pr); return; }
      pts.push([p.x, p.y, pr]);
    };
    const draw = () => { raf = 0; pathEl.setAttribute('d', C.strokePathD(s, pts, false)); };
    add(e);
    draw();
    return {
      move(evs) { evs.forEach(add); if (!raf) raf = requestAnimationFrame(draw); },
      end() {
        cancelAnimationFrame(raf);
        pathEl.remove();
        if (!pts.length) return;
        const before = snap();
        C.anchorStroke(S.layout, s, pts);
        S.doc.strokes.push(s);
        relayout();
        commit(before);
        if (S.lastTap && !S.lastTap.stroke && performance.now() - S.lastTap.t < 450) {
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (const q of pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
          if (x1 - x0 < 6 && y1 - y0 < 6) S.lastTap.stroke = s.id;
        }
      },
    };
  }

  /* 画圈、方框：按住拖出来（从一角拖到对角），边拖边看到形状；和墨迹一样挂在行上，能擦能撤销 */
  function shapePts(kind, x0, y0, x1, y1) {
    if (kind === 'arrow') return [[C.r2(x0), C.r2(y0), 0.5], [C.r2(x1), C.r2(y1), 0.5]]; // 箭头：起点到终点
    const L = Math.min(x0, x1), R = Math.max(x0, x1), T = Math.min(y0, y1), B = Math.max(y0, y1);
    if (kind === 'rect') return [[L, T, 0.5], [R, T, 0.5], [R, B, 0.5], [L, B, 0.5], [L, T, 0.5]];
    const cx = (L + R) / 2, cy = (T + B) / 2, rx = (R - L) / 2, ry = (B - T) / 2;
    const out = [];
    for (let i = 0; i <= 72; i++) { const a = (i / 72) * Math.PI * 2; out.push([C.r2(cx + rx * Math.cos(a)), C.r2(cy + ry * Math.sin(a)), 0.5]); }
    return out;
  }
  function hitShape(pt) {
    const lim0 = 7 / Math.min(1.5, S.zoom);
    for (let n = S.doc.strokes.length - 1; n >= 0; n--) {
      const s = S.doc.strokes[n];
      if (s.t !== 'mk') continue;
      const b = strokeBBox(s);
      if (pt.x < b.x0 - lim0 || pt.x > b.x1 + lim0 || pt.y < b.y0 - lim0 || pt.y > b.y1 + lim0) continue;
      const ay = C.strokeAnchorY(S.layout, s), lim = lim0 + s.w / 2;
      for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1], c = s.pts[i];
        if (segDist(pt.x, pt.y, a[0], a[1] + ay, c[0], c[1] + ay) < lim) return s;
      }
    }
    return null;
  }
  function startShapeDrag(s, pt) {
    const before = snap();
    const ay = C.strokeAnchorY(S.layout, s);
    const abs = s.pts.map((q) => [q[0], q[1] + ay, q[2]]);
    const e = S.inkEls.get(s.id);
    let dx = 0, dy = 0, moved = false;
    document.body.classList.add('dragging-shape');
    return {
      move(evs) {
        const p = toPaper(evs[evs.length - 1]);
        dx = p.x - pt.x; dy = p.y - pt.y;
        if (!moved && Math.hypot(dx, dy) < 2) return;
        moved = true;
        if (e) e.setAttribute('transform', `translate(${dx} ${ay + dy})`);
      },
      end() {
        document.body.classList.remove('dragging-shape');
        if (!moved) return;
        C.anchorStroke(S.layout, s, abs.map((q) => [q[0] + dx, q[1] + dy, q[2]]));
        S.bbox.delete(s.id);
        if (e) e._ay = null;
        refreshStroke(s);
        relayout();
        commit(before);
      },
    };
  }
  function startShape(pt, kind) {
    const cfg = S.cfg.anno;
    const s = { id: C.uid(), t: 'mk', shape: kind === 'circle' ? 'ellipse' : kind, c: cfg.c, w: ANNO_LINE_W[cfg.w] || 3, pts: [] };
    const draft = C.makeStrokeEl(s, '');
    draft.setAttribute(kind === 'arrow' ? 'fill-opacity' : 'stroke-opacity', '0.75');
    ink.appendChild(draft);
    const trail = [[pt.x, pt.y]];
    let last = pt;
    const draw = () => draft.setAttribute('d', C.strokePathD(s, shapePts(kind, pt.x, pt.y, last.x, last.y)));
    return {
      move(evs) {
        for (const ev of evs) { const p = toPaper(ev); last = p; trail.push([p.x, p.y]); }
        draw();
      },
      end() {
        draft.remove();
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        x0 = Math.min(pt.x, last.x); x1 = Math.max(pt.x, last.x); y0 = Math.min(pt.y, last.y); y1 = Math.max(pt.y, last.y);
        if (x1 - x0 < 6 && y1 - y0 < 6) return; // 只点了一下：不画
        const before = snap();
        C.anchorStroke(S.layout, s, kind === 'arrow' ? shapePts('arrow', pt.x, pt.y, last.x, last.y) : shapePts(kind, x0, y0, x1, y1));
        S.doc.strokes.push(s);
        relayout();
        commit(before);
      },
    };
  }
  function strokeBBox(s) {
    let b = S.bbox.get(s.id);
    if (b) return b;
    const ay = C.strokeAnchorY(S.layout, s);
    b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const p of s.pts) {
      if (p[0] < b.x0) b.x0 = p[0]; if (p[0] > b.x1) b.x1 = p[0];
      if (p[1] + ay < b.y0) b.y0 = p[1] + ay; if (p[1] + ay > b.y1) b.y1 = p[1] + ay;
    }
    const pad = s.w / 2 + 1;
    b.x0 -= pad; b.y0 -= pad; b.x1 += pad; b.y1 += pad;
    S.bbox.set(s.id, b);
    return b;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function startErase(pt, auto) {
    const before = snap();
    const removed = new Set();
    const R = 7 / Math.min(1.5, S.zoom);
    const test = (p) => {
      for (const s of S.doc.strokes) {
        if (removed.has(s.id)) continue;
        const b = strokeBBox(s);
        if (p.x < b.x0 - R || p.x > b.x1 + R || p.y < b.y0 - R || p.y > b.y1 + R) continue;
        const ay = C.strokeAnchorY(S.layout, s);
        const lim = R + s.w / 2;
        let hit = false;
        if (s.pts.length === 1) hit = Math.hypot(p.x - s.pts[0][0], p.y - s.pts[0][1] - ay) < lim;
        for (let i = 1; i < s.pts.length && !hit; i++) {
          const a = s.pts[i - 1], c = s.pts[i];
          if (segDist(p.x, p.y, a[0], a[1] + ay, c[0], c[1] + ay) < lim) hit = true;
        }
        if (hit) {
          removed.add(s.id);
          const e = S.inkEls.get(s.id);
          if (e) e.style.display = 'none';
        }
      }
      // 被标记笔标过的字块：橡皮擦碰到就把标记（高亮、下划线、加粗）擦掉
      const hc = hitChar(p);
      if (hc && hc.it.marks && hc.it.marks[hc.idx]) {
        delete hc.it.marks[hc.idx];
        markTouched.add(hc.it);
        renderLocked(hc.it);
      }
      for (const n of S.doc.notes) {
        if (removedNotes.has(n.id)) continue;
        const r = noteRect(n);
        if (p.x >= r.x0 - R && p.x <= r.x1 + R && p.y >= r.y0 - R && p.y <= r.y1 + R) {
          removedNotes.add(n.id);
          const d = noteEls.get(n.id);
          if (d) d.style.display = 'none';
        }
      }
    };
    const removedNotes = new Set();
    const markTouched = new Set();
    test(pt);
    return {
      move(evs) { evs.forEach((ev) => test(toPaper(ev))); },
      end() {
        // 擦除后自动切回上一个工具（设置里可关）；快捷键还按着就继续保持
        if (auto) springAfterUse('eraser');
        if (!removed.size && !removedNotes.size && !markTouched.size) return;
        S.doc.strokes = S.doc.strokes.filter((s) => !removed.has(s.id));
        S.doc.notes = S.doc.notes.filter((n) => !removedNotes.has(n.id));
        relayout();
        commit(before);
      },
    };
  }

  /* 套索 */
  let lassoSvg = null;
  function clearSel() {
    S.sel = null;
    ui.querySelectorAll('.selbox,.selbar').forEach((x) => x.remove());
  }
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function selBBox() {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const s of S.doc.strokes) {
      if (!S.sel.ids.has(s.id)) continue;
      const bb = strokeBBox(s);
      b.x0 = Math.min(b.x0, bb.x0); b.y0 = Math.min(b.y0, bb.y0); b.x1 = Math.max(b.x1, bb.x1); b.y1 = Math.max(b.y1, bb.y1);
    }
    return b;
  }
  function drawSel(dx, dy) {
    ui.querySelectorAll('.selbox,.selbar').forEach((x) => x.remove());
    if (!S.sel) return;
    const b = selBBox();
    if (!isFinite(b.x0)) { S.sel = null; return; }
    dx = dx || 0; dy = dy || 0;
    const box = el('div', 'selbox');
    box.style.left = (b.x0 - 6 + dx) + 'px';
    box.style.top = (b.y0 - 6 + dy) + 'px';
    box.style.width = (b.x1 - b.x0 + 12) + 'px';
    box.style.height = (b.y1 - b.y0 + 12) + 'px';
    box.style.pointerEvents = 'none';
    ui.appendChild(box);
    const bar = el('div', 'selbar', `<button class="del"><i class="ti ti-trash"></i>删除</button>`);
    bar.style.left = (b.x0 - 6 + dx) + 'px';
    bar.style.top = (b.y0 - 44 + dy) + 'px';
    bar.querySelector('.del').onclick = deleteSel;
    ui.appendChild(bar);
    S.sel.box = b;
  }
  function deleteSel() {
    if (!S.sel) return;
    const before = snap();
    const ids = S.sel.ids;
    S.doc.strokes = S.doc.strokes.filter((s) => !ids.has(s.id));
    clearSel();
    relayout();
    commit(before);
  }
  function startLasso(pt) {
    if (S.sel && S.sel.box) {
      const b = S.sel.box;
      if (pt.x >= b.x0 - 6 && pt.x <= b.x1 + 6 && pt.y >= b.y0 - 6 && pt.y <= b.y1 + 6) return startMoveSel(pt);
    }
    clearSel();
    const poly = [[pt.x, pt.y]];
    if (!lassoSvg) {
      lassoSvg = document.createElementNS(C.SVGNS, 'svg');
      lassoSvg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none';
      lassoSvg.setAttribute('width', '1');
      lassoSvg.setAttribute('height', '1');
    }
    ui.appendChild(lassoSvg);
    lassoSvg.innerHTML = '';
    const line = document.createElementNS(C.SVGNS, 'polygon');
    line.setAttribute('class', 'lasso-line');
    lassoSvg.appendChild(line);
    const draw = () => line.setAttribute('points', poly.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '));
    return {
      move(evs) { evs.forEach((ev) => { const p = toPaper(ev); poly.push([p.x, p.y]); }); draw(); },
      end() {
        lassoSvg.remove();
        if (poly.length < 3) return;
        const ids = new Set();
        for (const s of S.doc.strokes) {
          const ay = C.strokeAnchorY(S.layout, s);
          let inside = 0, total = 0;
          const step = Math.max(1, Math.floor(s.pts.length / 40));
          for (let i = 0; i < s.pts.length; i += step) { total++; if (pointInPoly(s.pts[i][0], s.pts[i][1] + ay, poly)) inside++; }
          if (total && inside / total >= 0.5) ids.add(s.id);
        }
        if (ids.size) { S.sel = { ids }; drawSel(); }
      },
    };
  }
  function startMoveSel(pt) {
    const before = snap();
    const ids = S.sel.ids;
    let dx = 0, dy = 0;
    return {
      move(evs) {
        const p = toPaper(evs[evs.length - 1]);
        dx = p.x - pt.x; dy = p.y - pt.y;
        for (const id of ids) {
          const e = S.inkEls.get(id);
          if (e) e.setAttribute('transform', `translate(${dx} ${e._ay + dy})`);
        }
        drawSel(dx, dy);
      },
      end() {
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) { drawSel(); return; }
        for (const s of S.doc.strokes) {
          if (!ids.has(s.id)) continue;
          const abs = C.absPoints(S.layout, s).map((p) => [p[0] + dx, p[1] + dy, p[2]]);
          C.anchorStroke(S.layout, s, abs);
          refreshStroke(s);
        }
        relayout();
        commit(before);
        drawSel();
      },
    };
  }

  /* 字块高亮：点击或按住滑动 */
  function hitChar(pt, onlyIt) {
    const L = S.layout;
    for (const it of S.doc.items) {
      if (!it.locked) continue;
      if (onlyIt && it !== onlyIt) continue;
      const li = L.items[it.id];
      if (!li || !li.rows.length) continue;
      const clamp = !!onlyIt;
      if (!clamp && (pt.y < li.top - 2 || pt.y > li.bottom)) continue;
      const gap = it.size * C.ROW_GAP;
      let row = null, bestD = Infinity;
      for (const r of li.rows) {
        if (pt.y >= r.y - gap / 2 && pt.y <= r.y + r.h + gap / 2) { row = r; bestD = 0; break; }
        const d = Math.abs(pt.y - (r.y + r.h / 2));
        if (d < bestD) { bestD = d; row = r; }
      }
      if (!row || (!clamp && bestD > 0)) continue;
      const line = it.lines[row.k];
      if (line.e === line.s) { if (clamp) return { it, idx: line.s }; continue; }
      const x = pt.x - PAGE.mx;
      const endX = it.xs[line.e - 1] + it.ws[line.e - 1];
      if (!clamp && (x < -8 || x > endX + 8)) continue;
      let idx = line.s;
      for (let k = line.s; k < line.e; k++) {
        const prevEnd = k > line.s ? it.xs[k - 1] + it.ws[k - 1] : it.xs[k];
        const boundary = (prevEnd + it.xs[k]) / 2;
        if (x >= boundary) idx = k;
      }
      return { it, idx };
    }
    return null;
  }
  function applyMarks(it, base, a, b, cfg) {
    const m = JSON.parse(JSON.stringify(base || {}));
    let lo = Math.min(a, b), hi = Math.max(a, b);
    // 滑动起点、终点落在空格上时不算进去（比如段首缩进）
    const blank = (k) => /\s/.test(it.chars[k] || '');
    while (lo < hi && blank(lo)) lo++;
    while (hi > lo && blank(hi)) hi--;
    const anchor = (base && base[a]) || {};
    let remove = false;
    if (cfg.mode === 'bg') remove = anchor.bg === cfg.c;
    else if (cfg.mode === 'b') remove = !!anchor.b;
    else if (cfg.mode === 'u') remove = !!anchor.u;
    else if (cfg.mode === 'ln') remove = anchor.ln === cfg.ln && anchor.lc === cfg.c;
    for (let k = lo; k <= hi; k++) {
      const c = it.chars[k];
      if (c === '\n' || c == null) continue;
      if (cfg.mode === 'clear') { delete m[k]; continue; }
      const cur = Object.assign({}, m[k] || {});
      if (cfg.mode === 'bg') { if (remove) delete cur.bg; else cur.bg = cfg.c; }
      if (cfg.mode === 'b') { if (remove) delete cur.b; else cur.b = 1; }
      if (cfg.mode === 'u') { if (remove) delete cur.u; else cur.u = 1; }
      if (cfg.mode === 'ln') { if (remove) { delete cur.ln; delete cur.lc; delete cur.lw; } else { cur.ln = cfg.ln; cur.lc = cfg.c; cur.lw = cfg.w; } }
      if (Object.keys(cur).length) m[k] = cur; else delete m[k];
    }
    return m;
  }
  function startMark(h, annoCfg) {
    const it = h.it;
    const base = it.marks || {};
    const cfg = annoCfg || { mode: S.cfg.hl.mode || 'bg', c: hlColor() };
    let cur = h.idx;
    let m = applyMarks(it, base, h.idx, cur, cfg);
    renderLocked(it, m);
    return {
      move(evs) {
        const p = toPaper(evs[evs.length - 1]);
        const hh = hitChar(p, it);
        if (!hh || hh.idx === cur) return;
        cur = hh.idx;
        m = applyMarks(it, base, h.idx, cur, cfg);
        renderLocked(it, m);
      },
      end() {
        const before = snap();
        it.marks = m;
        renderLocked(it);
        commit(before);
      },
    };
  }

  // 导航：拖一下移动画布，抬笔后自动回到上一个工具（像 PS 里按住空格拖动）
  function startPan(e) {
    const x0 = e.clientX, y0 = e.clientY, sl = scroller.scrollLeft, st = scroller.scrollTop;
    document.body.style.cursor = 'grabbing';
    return {
      move(evs) { const ev = evs[evs.length - 1]; scroller.scrollLeft = sl - (ev.clientX - x0); scroller.scrollTop = st - (ev.clientY - y0); },
      end() {
        document.body.style.cursor = '';
        if (!spacePan) springAfterUse('hand');
      },
    };
  }
  let spacePan = null;
  /* 弹簧工具：用快捷键（比如笔上的按键）切到橡皮擦或导航时，
     按键还按着 → 抬笔后继续保持；按键松开 → 回到上一个工具。
     如果只是点了一下快捷键，就用完一次自动切回。 */
  let spring = null;
  function springAfterUse(tool) {
    if (S.tool !== tool || S.lastTool === tool) return;
    if (spring && spring.tool === tool && spring.held) { spring.used = true; return; }
    if (S.settings.autoEraser) setTool(S.lastTool);
  }
  function springKeyUp(e) {
    if (!spring || !spring.held) return;
    if (e.code !== spring.code && e.key !== 'Meta' && e.key !== 'Control') return;
    spring.held = false;
    if (spring.used && S.tool === spring.tool && S.lastTool !== spring.tool) {
      if (act) pendingBack = S.lastTool; else setTool(S.lastTool);
    }
    spring = null;
  }
  document.addEventListener('keyup', springKeyUp);
  window.addEventListener('blur', () => { if (spring) spring.held = false; });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    if (!spacePan && S.tool !== 'hand') { spacePan = S.tool; setTool('hand'); }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || !spacePan) return;
    const back = spacePan;
    spacePan = null;
    if (act) return void (pendingBack = back);
    setTool(back);
  });
  let pendingBack = null;


  /* ---------- 镭射：悬空只有光点，按下时才有尾迹；不写进笔记 ---------- */
  const Laser = (() => {
    const cv = document.createElement('canvas');
    cv.id = 'laser';
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    let on = false, down = false, raf = 0, cur = null, dpr = 1;
    let pts = [];
    const LIFE = 450;
    function resize() {
      dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(innerWidth * dpr);
      cv.height = Math.round(innerHeight * dpr);
    }
    resize();
    window.addEventListener('resize', resize);
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
    // 一整条平滑路径一次画完，避免分段叠加出现小圆点
    function tailPath(list) {
      ctx.beginPath();
      ctx.moveTo(list[0].x, list[0].y);
      for (let i = 1; i < list.length - 1; i++) {
        const mx = (list[i].x + list[i + 1].x) / 2, my = (list[i].y + list[i + 1].y) / 2;
        ctx.quadraticCurveTo(list[i].x, list[i].y, mx, my);
      }
      const l = list[list.length - 1];
      ctx.lineTo(l.x, l.y);
    }
    function frame() {
      raf = 0;
      const now = performance.now();
      pts = pts.filter((p) => now - p.t < LIFE);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (pts.length > 1) {
        const passes = [[0, 2.5, 0.28], [0.45, 4, 0.55], [0.75, 5.5, 0.95]];
        for (const [from, w, al] of passes) {
          const list = pts.filter((p) => (now - p.t) / LIFE <= 1 - from);
          if (list.length < 2) continue;
          ctx.save();
          if (al > 0.9) { ctx.shadowColor = 'rgba(255,0,0,0.8)'; ctx.shadowBlur = 10; }
          ctx.strokeStyle = `rgba(255,30,30,${al})`;
          ctx.lineWidth = w;
          tailPath(list);
          ctx.stroke();
          ctx.restore();
        }
      }
      if (cur) {
        ctx.save();
        ctx.shadowColor = 'rgba(255,0,0,0.95)';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#FF1E1E';
        ctx.beginPath();
        ctx.arc(cur.x, cur.y, down ? 6.5 : 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,225,225,0.95)';
        ctx.beginPath();
        ctx.arc(cur.x, cur.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (pts.length) kick();
    }
    const evName = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';
    scroller.addEventListener(evName, (e) => {
      if (!on) return;
      const evs = e.getCoalescedEvents && e.getCoalescedEvents().length ? e.getCoalescedEvents() : [e];
      const now = performance.now();
      if (down) for (const ev of evs) pts.push({ x: ev.clientX, y: ev.clientY, t: now });
      const last = evs[evs.length - 1];
      cur = { x: last.clientX, y: last.clientY };
      kick();
    });
    scroller.addEventListener('pointerleave', () => { cur = null; kick(); });
    return {
      active(v) {
        on = v;
        if (!v) { pts = []; cur = null; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); }
      },
      press() {
        down = true;
        if (cur) pts.push({ x: cur.x, y: cur.y, t: performance.now() });
        kick();
        return { move() {}, end() { down = false; kick(); } };
      },
    };
  })();

  /* ---------- 图片 ---------- */
  const imgLayer = $('#imglayer');
  function imgById(id) { return (S.doc.images || []).find((x) => x.id === id); }
  function fileToDataURL(file) {
    return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(file); });
  }
  const imgEls = new Map();
  function renderImages() {
    const list = S.doc.images || [];
    const live = new Set();
    list.forEach((im) => {
      live.add(im.id);
      im._top = C.imageTop(S.layout, im);
      let box = imgEls.get(im.id);
      if (!box || box._ref !== im.ref) {
        if (box) box.remove();
        box = C.renderImage(im, S.assets[im.ref], imgLayer);
        box._ref = im.ref;
        imgEls.set(im.id, box);
      } else C.layoutImageBox(box, im);
      imgLayer.appendChild(box); // 保持图层顺序
    });
    for (const [id, box] of imgEls) if (!live.has(id)) { box.remove(); imgEls.delete(id); }
    drawImgSel();
  }
  function hitImage(pt) {
    const list = S.doc.images || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const im = list[i];
      const top = C.imageTop(S.layout, im);
      if (pt.x >= im.x && pt.x <= im.x + im.w && pt.y >= top && pt.y <= top + im.h) return im;
    }
    return null;
  }
  function viewCenter() {
    const r = scroller.getBoundingClientRect(), pr = paper.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - pr.left) / S.zoom, y: (r.top + r.height / 2 - pr.top) / S.zoom };
  }
  async function insertImage(url, at) {
    const dim = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => resolve(null); i.src = url; });
    if (!dim || !dim.w) return;
    const ref = C.uid();
    S.assets[ref] = url;
    await Store.saveAsset(ref, url);
    let w = dim.w >= 600 ? dim.w / 2 : dim.w; // Retina 截图按一半尺寸放
    w = Math.min(w, PAGE.cw);
    const h = w * dim.h / dim.w;
    const c = at || viewCenter();
    const x = Math.max(0, Math.min(PAGE.w - w, c.x - w / 2));
    const top = Math.max(0, c.y - h / 2);
    const im = { id: C.uid(), ref, nw: dim.w, nh: dim.h, x: C.r2(x), w: C.r2(w), h: C.r2(h), crop: { l: 0, t: 0, r: 0, b: 0 } };
    const before = snap();
    C.anchorImage(S.layout, im, top);
    S.doc.images.push(im);
    relayout();
    commit(before);
    selectImage(im.id);
  }
  function selectImage(id, crop) {
    if (S.imgSel && S.imgSel.id) S.lastSelId = S.imgSel.id;
    S.imgSel = id ? { id, crop: !!crop } : null;
    selKey = '#';
    drawImgSel();
  }
  let selKey = null, selEls = null;
  const HPOS = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
  function drawImgSel() {
    const im = S.imgSel ? imgById(S.imgSel.id) : null;
    if (S.imgSel && !im) S.imgSel = null;
    const crop = !!(im && S.imgSel.crop && !im.locked);
    const key = im ? [im.id, crop, !!im.locked, S.zoom].join('|') : null;
    if (key !== selKey) {
      if (selEls) selEls.all.forEach((x) => x.remove());
      selEls = null;
      selKey = key;
      if (!im) return;
      selEls = buildSel(im, crop);
    }
    if (selEls) positionSel(im, crop);
  }
  function buildSel(im, crop) {
    const z = S.zoom;
    const E = { all: [], hs: {} };
    const add = (x) => { ui.appendChild(x); E.all.push(x); return x; };
    if (crop) E.ghost = add(el('div', 'ighost', `<img src="${S.assets[im.ref] || ''}">`));
    E.frame = add(el('div', 'imgsel' + (im.locked ? ' locked' : '') + (crop ? ' crop' : '')));
    E.frame.style.borderWidth = (1.5 / z) + 'px';
    if (!im.locked) {
      bindImgDrag(E.frame, im, 'move');
      E.grip = add(el('div', 'igrip', '<i class="ti ti-grip-horizontal"></i>'));
      E.grip.style.transform = `translate(-50%,-100%) scale(${1 / z})`;
      E.grip.style.transformOrigin = '50% 100%';
      bindImgDrag(E.grip, im, 'move');
      for (const k of crop ? Object.keys(HPOS) : ['nw', 'ne', 'se', 'sw']) {
        const hd = add(el('div', 'ih ' + k));
        hd.style.transform = `translate(-50%,-50%) scale(${1 / z})`;
        bindImgDrag(hd, im, (crop ? 'crop-' : 'size-') + k);
        E.hs[k] = hd;
      }
    }
    const bar = add(el('div', 'ibar'));
    const btns = crop ? [['done', 'ti-check', '完成裁剪']] : [
      ['crop', 'ti-crop', '裁剪'], ['dup', 'ti-copy-plus', '复制一份'], ['cut', 'ti-cut', '剪切'],
      ['lock', im.locked ? 'ti-lock' : 'ti-lock-open', im.locked ? '解锁' : '锁定'],
      ['up', 'ti-stack-pop', '上移一层'], ['down', 'ti-stack-push', '下移一层'], ['del', 'ti-trash', '删除'],
    ];
    for (const [k, ic, nm] of btns) {
      const b = el('button', k === 'del' ? 'danger' : '', `<i class="ti ${ic}"></i>`);
      b.title = nm;
      if (im.locked && (k === 'crop' || k === 'cut')) b.disabled = true;
      b.onpointerdown = (ev) => ev.stopPropagation();
      b.onclick = () => imgAction(k, im);
      bar.appendChild(b);
    }
    bar.style.transform = `translate(-50%,-100%) scale(${1 / z})`;
    bar.style.transformOrigin = '50% 100%';
    E.bar = bar;
    return E;
  }
  function positionSel(im, crop) {
    const E = selEls, z = S.zoom;
    const top = C.imageTop(S.layout, im);
    const box = (x, l, t, w, h) => { x.style.left = l + 'px'; x.style.top = t + 'px'; if (w != null) { x.style.width = w + 'px'; x.style.height = h + 'px'; } };
    if (E.ghost) {
      const c = im.crop, fw = im.w / (1 - c.l - c.r), fh = im.h / (1 - c.t - c.b);
      box(E.ghost, im.x - c.l * fw, top - c.t * fh, fw, fh);
    }
    box(E.frame, im.x, top, im.w, im.h);
    if (E.grip) box(E.grip, im.x + im.w / 2, top);
    for (const k in E.hs) box(E.hs[k], im.x + HPOS[k][0] * im.w, top + HPOS[k][1] * im.h);
    box(E.bar, im.x + im.w / 2, top - (im.locked ? 12 : 30) / z);
  }
  function bindImgDrag(handle, im, mode) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const p0 = toPaper(e);
      const before = snap();
      const top0 = C.imageTop(S.layout, im);
      const g = { x: im.x, top: top0, w: im.w, h: im.h, crop: Object.assign({}, im.crop) };
      const aspect = g.w / g.h;
      let moved = false, raf = 0, cur = null;
      const apply = () => {
        raf = 0;
        const p = cur, dx = p.x - p0.x, dy = p.y - p0.y;
        let x = g.x, top = g.top, w = g.w, h = g.h;
        const c = Object.assign({}, g.crop);
        if (mode === 'move') { x += dx; top += dy; }
        else if (mode.startsWith('size-')) {
          const k = mode.slice(5);
          const sx = k.includes('e') ? 1 : -1, sy = k.includes('s') ? 1 : -1;
          const fx = sx > 0 ? g.x : g.x + g.w, fy = sy > 0 ? g.top : g.top + g.h;
          w = Math.max(24, sx * (p.x - fx), sy * (p.y - fy) * aspect);
          h = w / aspect;
          x = sx > 0 ? fx : fx - w;
          top = sy > 0 ? fy : fy - h;
        } else if (mode.startsWith('crop-')) {
          const k = mode.slice(5);
          const fw = g.w / (1 - g.crop.l - g.crop.r), fh = g.h / (1 - g.crop.t - g.crop.b);
          const L0 = g.x - g.crop.l * fw, T0 = g.top - g.crop.t * fh;
          let left = g.x, right = g.x + g.w, tp = g.top, bt = g.top + g.h;
          if (k.includes('w')) left = Math.max(L0, Math.min(right - 20, g.x + dx));
          if (k.includes('e')) right = Math.min(L0 + fw, Math.max(left + 20, g.x + g.w + dx));
          if (k.includes('n')) tp = Math.max(T0, Math.min(bt - 20, g.top + dy));
          if (k.includes('s')) bt = Math.min(T0 + fh, Math.max(tp + 20, g.top + g.h + dy));
          x = left; w = right - left; top = tp; h = bt - tp;
          c.l = (left - L0) / fw; c.r = (L0 + fw - right) / fw; c.t = (tp - T0) / fh; c.b = (T0 + fh - bt) / fh;
        }
        im.x = C.r2(x); im.w = C.r2(w); im.h = C.r2(h); im.crop = c;
        C.anchorImage(S.layout, im, top);
        renderImages();
      };
      const mv = (ev) => {
        cur = toPaper(ev);
        if (!moved && Math.hypot(cur.x - p0.x, cur.y - p0.y) < 2) return;
        moved = true;
        if (!raf) raf = requestAnimationFrame(apply);
      };
      const up = () => {
        handle.removeEventListener('pointermove', mv);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        if (raf) { cancelAnimationFrame(raf); apply(); }
        if (moved) { relayout(); commit(before); }
      };
      handle.addEventListener('pointermove', mv);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }
  function croppedDataURL(im) {
    return new Promise((resolve) => {
      const i = new Image();
      i.onload = () => {
        const c = im.crop;
        const sw = i.naturalWidth * (1 - c.l - c.r), sh = i.naturalHeight * (1 - c.t - c.b);
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(sw)); cv.height = Math.max(1, Math.round(sh));
        cv.getContext('2d').drawImage(i, i.naturalWidth * c.l, i.naturalHeight * c.t, sw, sh, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/png'));
      };
      i.src = S.assets[im.ref];
    });
  }
  async function copyImage(im) {
    const url = await croppedDataURL(im);
    if (window.api && window.api.copyImage) window.api.copyImage(url);
    else {
      try { const blob = await (await fetch(url)).blob(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch (e) { /* 忽略 */ }
    }
  }
  async function imgAction(k, im) {
    const list = S.doc.images;
    const i = list.indexOf(im);
    const before = snap();
    if (k === 'crop') { selectImage(im.id, true); return; }
    if (k === 'done') { selectImage(im.id, false); return; }
    if (k === 'dup') {
      const top = C.imageTop(S.layout, im);
      const cp = JSON.parse(JSON.stringify(im));
      cp.id = C.uid(); cp.x = Math.min(PAGE.w - cp.w, cp.x + 20); cp.locked = false;
      C.anchorImage(S.layout, cp, top + 20);
      list.splice(i + 1, 0, cp);
      relayout(); commit(before); selectImage(cp.id); return;
    }
    if (k === 'cut') { await copyImage(im); list.splice(i, 1); S.imgSel = null; relayout(); commit(before); return; }
    if (k === 'lock') { im.locked = !im.locked; }
    if (k === 'up' && i < list.length - 1) { list.splice(i, 1); list.splice(i + 1, 0, im); }
    if (k === 'down' && i > 0) { list.splice(i, 1); list.splice(i - 1, 0, im); }
    if (k === 'del') { list.splice(i, 1); S.imgSel = null; }
    relayout();
    commit(before);
  }
  paper.addEventListener('dragover', (e) => { e.preventDefault(); });
  paper.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []).filter((f) => /^image\//.test(f.type));
    const pt = toPaper(e);
    files.forEach((f, k) => fileToDataURL(f).then((u) => insertImage(u, { x: pt.x + k * 20, y: pt.y + k * 20 })));
  });


  /* ---------- 批注：行间分栏 + 插入彩色文字（像微信图片编辑里加文字） ---------- */
  const noteLayer = $('#notelayer');
  const noteEls = new Map();
  S.editNote = null;
  function noteById(id) { return (S.doc.notes || []).find((x) => x.id === id); }
  function styleNoteEl(d, n, top) {
    d.style.left = n.x + 'px';
    d.style.top = top + 'px';
    d.style.fontSize = n.s + 'px';
    d.style.color = n.c;
    d.style.fontWeight = n.b ? 700 : '';
    d.style.width = n.w ? n.w + 'px' : '';
    d.style.minHeight = n.h ? n.h + 'px' : '';
    d.style.whiteSpace = n.w ? 'pre-wrap' : '';
    d.style.wordBreak = n.w ? 'break-all' : '';
    d.style.fontFamily = (C.FONTS[n.f] || C.FONTS.qingsong).css + ', sans-serif';
  }
  /* 标注文字正在写的时候：顶上一个把手拖动位置（和图片一样），右下角小方块拖宽窄（字自动换成两三行）；写完就都不显示 */
  const sizeGrip = el('div', 'tgrip');
  const moveGrip = el('div', 'igrip tmove', '<i class="ti ti-grip-horizontal"></i>');
  sizeGrip.style.display = moveGrip.style.display = 'none';
  function placeGrip() {
    const ed = S.editNote && noteById(S.editNote.id);
    if (!ed || S.tool !== 'anno') { sizeGrip.style.display = moveGrip.style.display = 'none'; return; }
    if (!sizeGrip.parentNode) { ui.appendChild(sizeGrip); ui.appendChild(moveGrip); }
    const r = noteRect(ed);
    sizeGrip.style.display = moveGrip.style.display = '';
    sizeGrip.style.left = (r.x1 + 3) + 'px';
    sizeGrip.style.top = (r.y1 + 3) + 'px';
    moveGrip.style.left = ((r.x0 + r.x1) / 2) + 'px';
    moveGrip.style.top = (r.y0 - 4) + 'px';
  }
  const gripDrag = (grip, onMove) => grip.addEventListener('pointerdown', (e) => {
    const n = S.editNote && noteById(S.editNote.id);
    if (!n) return;
    e.preventDefault(); e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    const p0 = toPaper(e), r0 = noteRect(n), x0 = n.x;
    let top = r0.y0;
    const mv = (ev) => {
      const p = toPaper(ev);
      top = onMove(n, p, p0, r0, x0);
      const d = noteEls.get(n.id);
      if (d) styleNoteEl(d, n, top);
      placeGrip();
    };
    const up = () => {
      grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up);
      C.anchorNote(S.layout, n, top);
      relayout();
      const d = noteEls.get(n.id);
      if (d) d.focus();
    };
    grip.addEventListener('pointermove', mv);
    grip.addEventListener('pointerup', up);
  });
  // 右下角：横着拖改宽度、竖着拖改高度，字号不变；框窄了字自动折行，窄到一个字宽就是竖排
  gripDrag(sizeGrip, (n, p, p0, r0) => {
    n.w = C.r2(Math.max(n.s * 1.08, p.x - r0.x0 - 2));
    const d = noteEls.get(n.id);
    if (d) { d.style.width = n.w + 'px'; d.style.whiteSpace = 'pre-wrap'; d.style.wordBreak = 'break-all'; d.style.minHeight = ''; }
    const need = d ? d.scrollHeight : n.s * 1.3;           // 这个宽度下文字本身要多高
    const want = p.y - r0.y0 - 2;
    n.h = want > need + 2 ? C.r2(want) : 0;                  // 拖得比文字高才留出空白，否则贴着文字
    return r0.y0;
  });
  // 顶上把手：拖动位置
  gripDrag(moveGrip, (n, p, p0, r0, x0) => { n.x = C.r2(x0 + p.x - p0.x); return r0.y0 + p.y - p0.y; });
  function renderNotes() {
    const live = new Set();
    for (const n of S.doc.notes || []) {
      live.add(n.id);
      const top = C.noteTop(S.layout, n);
      let d = noteEls.get(n.id);
      if (!d) { d = C.renderNote(n, noteLayer, top); noteEls.set(n.id, d); }
      else {
        styleNoteEl(d, n, top);
        if (!(S.editNote && S.editNote.id === n.id) && d.textContent !== n.text) d.textContent = n.text;
        d.style.display = '';
      }
    }
    for (const [id, d] of noteEls) if (!live.has(id)) { d.remove(); noteEls.delete(id); }
    placeGrip();
  }
  function noteRect(n) {
    const d = noteEls.get(n.id);
    const top = C.noteTop(S.layout, n);
    const w = d ? d.offsetWidth : n.s, h = d ? d.offsetHeight : n.s * 1.3;
    return { x0: n.x, y0: top, x1: n.x + Math.max(w, n.s * 0.6), y1: top + Math.max(h, n.s * 1.3) };
  }
  function hitNote(pt) {
    const list = S.doc.notes || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const r = noteRect(list[i]);
      if (pt.x >= r.x0 - 4 && pt.x <= r.x1 + 4 && pt.y >= r.y0 - 4 && pt.y <= r.y1 + 4) return list[i];
    }
    return null;
  }
  // 隐藏分栏：每一行下方空隙的底边（紧挨下一行的上方）
  function hitDivider(pt) {
    if (pt.x < PAGE.mx - 14 || pt.x > PAGE.mx + PAGE.cw + 14) return null;
    for (const it of S.doc.items) {
      if (!it.locked) continue;
      const li = S.layout.items[it.id];
      if (!li || pt.y < li.top || pt.y > li.bottom + 6) continue;
      for (const r of li.rows) {
        const gb = r.y + r.h + C.rowGap(it, r.k);
        if (pt.y >= gb - 7 && pt.y <= gb + 3) return { it, k: r.k, y: gb };
      }
    }
    return null;
  }
  function readNoteText(d) {
    let t = '';
    const walk = (node) => { for (const c of node.childNodes) { if (c.nodeType === 3) t += c.nodeValue; else if (c.tagName === 'BR') t += '\n'; else walk(c); } };
    walk(d);
    return t.replace(/\n$/, '');
  }
  function editNote(id, before) {
    if (S.editNote && S.editNote.id !== id) finishNoteEdit();
    const n = noteById(id), d = noteEls.get(id);
    if (!n || !d) return;
    S.editNote = { id, before: before || snap(), json: before ? '' : JSON.stringify(n) };
    d.contentEditable = 'plaintext-only';
    d.classList.add('editing');
    d.focus();
    const r = document.createRange();
    r.selectNodeContents(d);
    r.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    placeGrip();
    if (!d._bound) {
      d._bound = true;
      d.addEventListener('input', () => { const nn = noteById(d.dataset.id); if (nn) { nn.text = readNoteText(d); touch(); placeGrip(); } });
      d.addEventListener('blur', () => { if (S.editNote && S.editNote.id === d.dataset.id) finishNoteEdit(); });
      d.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); d.blur(); } });
    }
  }
  function finishNoteEdit() {
    const ed = S.editNote;
    if (!ed) return;
    S.editNote = null;
    placeGrip();
    const n = noteById(ed.id), d = noteEls.get(ed.id);
    if (d) { d.contentEditable = 'false'; d.classList.remove('editing'); if (document.activeElement === d) d.blur(); }
    if (!n) return;
    n.text = (d ? readNoteText(d) : n.text).replace(/\s+$/, '');
    if (!n.text.trim()) {
      S.doc.notes = S.doc.notes.filter((x) => x !== n);
      relayout();
      if (!ed.json) return; // 新建后什么都没写，直接消失，不进撤销记录
      commit(ed.before);
      return;
    }
    if (JSON.stringify(n) !== ed.json) { relayout(); commit(ed.before); }
  }
  function createNote(pt, opt) {
    const before = snap();
    const cfg = S.cfg.note;
    const n = opt ? Object.assign({ id: C.uid(), x: C.r2(pt.x), text: '' }, opt) : { id: C.uid(), x: C.r2(pt.x), text: '', c: cfg.c, s: NOTE_SIZES[cfg.s] || 17, f: cfg.f || 'qingsong' };
    C.anchorNote(S.layout, n, pt.y - n.s * 0.65);
    S.doc.notes.push(n);
    renderNotes();
    editNote(n.id, before);
  }
  function startNote(pt) {
    const hn = hitNote(pt);
    if (hn) return startNoteDrag(hn, pt);
    const hd = hitDivider(pt);
    if (hd) return startDividerDrag(hd, pt);
    if (S.editNote) { finishNoteEdit(); return null; }
    createNote(pt);
    return null;
  }
  function startNoteDrag(n, pt) {
    const before = snap();
    const top0 = C.noteTop(S.layout, n), x0 = n.x;
    let moved = false;
    return {
      move(evs) {
        const p = toPaper(evs[evs.length - 1]);
        if (!moved && Math.hypot(p.x - pt.x, p.y - pt.y) < 3) return;
        moved = true;
        n.x = C.r2(x0 + p.x - pt.x);
        C.anchorNote(S.layout, n, top0 + p.y - pt.y);
        const d = noteEls.get(n.id);
        if (d) styleNoteEl(d, n, C.noteTop(S.layout, n));
      },
      end() {
        if (moved) {
          relayout();
          if (S.editNote && S.editNote.id === n.id) return;
          commit(before);
        } else editNote(n.id);
      },
    };
  }
  // 拖分栏：撑开这一行下面的空间，下面所有行整体下沉，墨迹、批注、图片跟着走
  function startDividerDrag(hd, pt, onTap) {
    const it = hd.it, k = hd.k;
    it.rowGaps = it.rowGaps || {};
    const g0 = it.rowGaps[k] || 0;
    const before = snap();
    let moved = false, raf = 0, last = pt;
    showDivider(hd.y);
    return {
      move(evs) {
        last = toPaper(evs[evs.length - 1]);
        if (!moved && Math.abs(last.y - pt.y) < 3) return;
        moved = true;
        it.rowGaps[k] = Math.max(0, C.r2(g0 + last.y - pt.y));
        if (!raf) raf = requestAnimationFrame(() => {
          raf = 0;
          relayout();
          const li = S.layout.items[it.id], r = li.rows[k];
          showDivider(r.y + r.h + C.rowGap(it, k));
        });
      },
      cancel() { if (raf) cancelAnimationFrame(raf); hideDivider(); },
      end() {
        if (raf) { cancelAnimationFrame(raf); relayout(); }
        hideDivider();
        if (moved) { if (!it.rowGaps[k]) delete it.rowGaps[k]; commit(before); return; }
        if (onTap) { onTap(); return; }
        if (S.editNote) { finishNoteEdit(); return; }
        createNote(pt);
      },
    };
  }
  const divLine = el('div', 'rowdiv');
  divLine.style.display = 'none';
  // 分栏不画线，只把鼠标变成上下箭头
  function showDivider() { document.body.classList.add('on-divider'); }
  function hideDivider() { divLine.style.display = 'none'; document.body.classList.remove('on-divider'); }
  scroller.addEventListener('pointermove', (e) => {
    if (S.tool === 'anno' && !e.buttons) document.body.classList.toggle('on-shape', !!hitShape(toPaper(e)));
    if (!DIV_TOOLS.has(S.tool) || e.buttons) { if (!e.buttons) hideDivider(); return; }
    const pt = toPaper(e);
    const hd = !hitNote(pt) && hitDivider(pt);
    if (hd) { showDivider(hd.y); document.body.classList.add('on-divider'); }
    else hideDivider();
  });


  /* ---------- 字体选择（带预览）和我的字体 ---------- */
  function setFontBtn(b, key) {
    const f = C.FONTS[key] || C.FONTS.sans;
    b.innerHTML = `<span style="font-family:${f.css}, sans-serif">${f.name}</span><i class="ti ti-chevron-down"></i>`;
    if (f.custom) C.loadCustomFont(key);
  }
  let fontPop = null;
  function closeFontPicker() { if (fontPop) { fontPop.remove(); fontPop = null; } }
  function openFontPicker(anchor, cur, onPick) {
    if (fontPop) { closeFontPicker(); return; }
    fontPop = el('div', 'fontpop');
    fontPop.addEventListener('mousedown', (e) => e.preventDefault());
    const draw = () => {
      fontPop.innerHTML = '';
      const builtIn = Object.entries(C.FONTS).filter(([, f]) => !f.custom);
      const mine = Object.entries(C.FONTS).filter(([, f]) => f.custom);
      const item = (k, f) => {
        const r = el('div', 'fitem' + (k === cur ? ' on' : ''));
        r.innerHTML = `<span class="fname" style="font-family:${f.css}, sans-serif">${f.name}</span>` + (f.custom ? '<button class="fdel" title="从软件里删除这个字体"><i class="ti ti-x"></i></button>' : '');
        r.onclick = (e) => { if (e.target.closest('.fdel')) return; closeFontPicker(); onPick(k); };
        const del = r.querySelector('.fdel');
        if (del) del.onclick = async () => { await window.api.fontRemove(f.custom); await refreshFonts(); draw(); };
        if (f.custom) C.loadCustomFont(k);
        fontPop.appendChild(r);
      };
      builtIn.forEach(([k, f]) => item(k, f));
      fontPop.appendChild(el('div', 'fhead', '我的字体'));
      mine.forEach(([k, f]) => item(k, f));
      const imp = el('div', 'fitem fimport', '<i class="ti ti-plus"></i> 导入字体…');
      imp.onclick = async () => { const added = await importFonts(); if (added && added.length) draw(); };
      fontPop.appendChild(imp);
    };
    draw();
    const r = anchor.getBoundingClientRect();
    fontPop.style.left = r.left + 'px';
    fontPop.style.top = (r.bottom + 6) + 'px';
    document.body.appendChild(fontPop);
  }
  document.addEventListener('pointerdown', (e) => { if (fontPop && !fontPop.contains(e.target) && !e.target.closest('.fontbtn')) closeFontPicker(); }, true);
  async function refreshFonts() {
    if (!window.api || !window.api.fontList) return;
    C.setCustomFonts(await window.api.fontList(), (id) => window.api.fontData(id));
  }
  async function importFonts(paths) {
    if (!window.api || !window.api.fontImport) return [];
    const added = await window.api.fontImport(paths || []);
    await refreshFonts();
    if (added && added.length) toastFonts(added);
    return added;
  }
  function toastFonts(added) {
    // 导入成功不弹窗，只在字体菜单里出现；导入失败才提示
    if (!added.length) toast('没有在文件里找到字体');
  }
  if (window.api && window.api.onFontsChanged) window.api.onFontsChanged(async () => { await refreshFonts(); });
  // 字体文件或压缩包直接拖进窗口也能导入
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    const fonts = files.filter((f) => /\.(ttf|otf|ttc|woff2?|zip)$/i.test(f.name));
    if (!fonts.length) return;
    e.preventDefault();
    e.stopPropagation();
    const paths = fonts.map((f) => (window.api && window.api.pathForFile ? window.api.pathForFile(f) : '')).filter(Boolean);
    if (paths.length) importFonts(paths);
  }, true);
  async function ensureDocFonts(doc) {
    const keys = new Set();
    doc.items.forEach((it) => keys.add(it.font));
    (doc.notes || []).forEach((n) => keys.add(n.f));
    await Promise.all(Array.from(keys).filter((k) => C.FONTS[k] && C.FONTS[k].custom).map((k) => C.loadCustomFont(k)));
  }
  if (document.fonts) document.fonts.addEventListener('loadingdone', () => {
    if (!S.doc) return;
    let changed = false;
    for (const it of S.doc.items) if (!it.locked && S.edEls[it.id]) { const o = S.editH[it.id]; measureEdit(it); if (o !== S.editH[it.id]) changed = true; }
    if (changed) relayout(); else renderNotes();
  });


  /* ---------- 思维导图块：XMind 的快捷键，从左往右展开 ---------- */
  const mindLayer = $('#mindlayer');
  S.mind = null; // { id, sel, editing }
  const mindSigs = {};
  const mindRootPos = new Map();
  function mindById(id) { return S.doc.items.find((x) => x.id === id && x.type === 'mind'); }
  function findNode(root, id, parent) {
    if (root.id === id) return { node: root, parent };
    for (const c of root.children || []) { const r = findNode(c, id, root); if (r) return r; }
    return null;
  }
  function renderMinds() {
    const live = new Set();
    for (const it of S.doc.items) {
      if (it.type !== 'mind') continue;
      live.add(it.id);
      const li = S.layout.items[it.id];
      const act = S.mind && S.mind.id === it.id;
      const sig = JSON.stringify([it.root, it.skin, it.font, li.top, act && S.mind.sel, act, PAGE.cw, it.view, it.h]);
      if (mindSigs[it.id] === sig && mindLayer.querySelector(`.mind[data-id="${it.id}"]`)) continue;
      if (act && S.mind.editing) continue; // 正在打字时不重画
      mindSigs[it.id] = sig;
      // 加减主题时让中心主题在画面里不动（和 XMind 一样）
      const rb = li.mind && li.mind.boxes[0];
      const prev = mindRootPos.get(it.id);
      if (rb && prev && it.view && (prev.x !== rb.x || prev.y !== rb.y)) {
        it.view.x = Math.round(it.view.x - (rb.x - prev.x) * it.view.z);
        it.view.y = Math.round(it.view.y - (rb.y - prev.y) * it.view.z);
      }
      if (rb) mindRootPos.set(it.id, { x: rb.x, y: rb.y });
      const old = mindLayer.querySelector(`.mind[data-id="${it.id}"]`);
      if (old) old.remove();
      const w = C.renderMind(it, li, mindLayer, li.top, { sel: act ? S.mind.sel : null });
      if (act) w.classList.add('active');
    }
    mindLayer.querySelectorAll('.mind').forEach((w) => { if (!live.has(w.dataset.id)) { w.remove(); delete mindSigs[w.dataset.id]; } });
    if (S.mind && !mindById(S.mind.id)) deactivateMind();
    drawMindBar();
    armSelected();
  }
  function hitMind(pt) {
    for (const it of S.doc.items) {
      if (it.type !== 'mind') continue;
      const li = S.layout.items[it.id];
      const m = li.mind;
      if (!m || pt.y < li.top || pt.y > li.top + (it.h || 420) || pt.x < PAGE.mx || pt.x > PAGE.mx + PAGE.cw) continue;
      const v = C.mindView(it, m);
      const ix = (pt.x - PAGE.mx - v.x) / v.z, iy = (pt.y - li.top - v.y) / v.z;
      const b = m.boxes.find((bx) => ix >= bx.x - 4 && ix <= bx.x + bx.w + 4 && iy >= bx.y - 4 && iy <= bx.y + bx.h + 4);
      return { it, node: b ? b.id : null };
    }
    return null;
  }
  function activateMind(id, nodeId) {
    const it = mindById(id);
    if (!it) return;
    if (S.mind && S.mind.editing) finishMindEdit();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    S.mind = { id, sel: nodeId || it.root.id, editing: false };
    document.body.classList.add('mind-active');
    renderMinds();
  }
  function deactivateMind() {
    if (!S.mind) return;
    if (S.mind.editing) finishMindEdit();
    S.mind = null;
    document.body.classList.remove('mind-active');
    closeSkinPop();
    renderMinds();
  }
  function selectMindNode(nid) { if (!S.mind) return; S.mind.sel = nid; renderMinds(); }
  function mindNodeEl(nid) { return mindLayer.querySelector(`.mind.active .mn[data-nid="${nid}"]`); }
  /* 选中主题时就进入“待输入”状态（像 XMind）：直接打字＝整个替换；空格＝接着原文字往后改 */
  function editMindNode(nid, before, selectAll, armed) {
    const it = mindById(S.mind.id);
    const d = mindNodeEl(nid);
    if (!it || !d) return;
    S.mind.sel = nid;
    S.mind.editing = { nid, before: before || snap(), armed: !!armed };
    d.classList.add('sel', armed ? 'armed' : 'editing');
    if (!armed) d.style.height = 'auto';
    d.contentEditable = 'plaintext-only';
    d.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(d);
    if (!selectAll) r.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    if (d._mindBound) return;
    d._mindBound = true;
    const toEditing = (collapse) => {
      const ed = S.mind && S.mind.editing;
      if (!ed || !ed.armed) return;
      ed.armed = false;
      d.classList.remove('armed');
      d.classList.add('editing');
      d.style.height = 'auto';
      if (collapse) {
        const rr = document.createRange();
        rr.selectNodeContents(d);
        rr.collapse(false);
        const ss = getSelection();
        ss.removeAllRanges();
        ss.addRange(rr);
      }
    };
    d.addEventListener('compositionstart', () => toEditing(false));
    d.addEventListener('input', () => toEditing(false));
    d.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      const ed = S.mind && S.mind.editing;
      if (!ed || ed.nid !== d.dataset.nid) return;
      if (ed.armed) {
        if (e.metaKey || e.ctrlKey) return;
        const k = e.key;
        if (k === ' ' || k === 'F2') { e.preventDefault(); toEditing(true); return; }
        if (k === 'Enter') { e.preventDefault(); cancelArm(); mindAction(e.shiftKey ? 'before' : 'after'); return; }
        if (k === 'Tab') { e.preventDefault(); cancelArm(); mindAction('child'); return; }
        if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); cancelArm(); mindAction('delete'); return; }
        if (k.startsWith('Arrow')) { e.preventDefault(); cancelArm(); mindNav(k); return; }
        if (k === 'Escape') { e.preventDefault(); cancelArm(); deactivateMind(); return; }
        return; // 其他键：直接打字，替换整个主题
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishMindEdit(); }
      else if (e.key === 'Tab') { e.preventDefault(); finishMindEdit(); mindAction('child'); }
      else if (e.key === 'Escape') { e.preventDefault(); finishMindEdit(); }
    });
    d.addEventListener('blur', () => {
      const ed = S.mind && S.mind.editing;
      if (!ed || ed.nid !== d.dataset.nid) return;
      if (ed.armed) cancelArm(); else finishMindEdit();
    });
  }
  function cancelArm() {
    const ed = S.mind && S.mind.editing;
    if (!ed || !ed.armed) return;
    S.mind.editing = false;
    const d = mindNodeEl(ed.nid);
    if (d) { d.contentEditable = 'false'; d.classList.remove('armed'); }
  }
  function armSelected() {
    if (!S.mind || S.mind.editing) return;
    const d = mindNodeEl(S.mind.sel);
    if (d) editMindNode(S.mind.sel, null, true, true);
  }
  function finishMindEdit() {
    if (!S.mind || !S.mind.editing) return;
    if (S.mind.editing.armed) { cancelArm(); return; }
    const ed = S.mind.editing;
    S.mind.editing = false;
    const it = mindById(S.mind.id);
    const d = mindNodeEl(ed.nid);
    if (it && d) {
      const f = findNode(it.root, ed.nid);
      if (f) f.node.text = readNoteText(d).replace(/\s+$/, '');
    }
    relayout();
    if (snap() !== ed.before) commit(ed.before);
  }
  function mindAction(a) {
    if (!S.mind) return;
    const it = mindById(S.mind.id);
    if (!it) return;
    const f = findNode(it.root, S.mind.sel);
    if (!f) return;
    const before = snap();
    const depthOf = (id) => { let d = 0, cur = findNode(it.root, id); while (cur && cur.parent) { d++; cur = findNode(it.root, cur.parent.id); } return d; };
    const mk = (lvl) => ({ id: C.uid(), text: lvl <= 1 ? '分支主题' : '子主题', children: [] });
    if (a === 'child') {
      const n = mk(depthOf(f.node.id) + 1);
      (f.node.children = f.node.children || []).push(n);
      f.node.collapsed = false;
      relayout();
      editMindNode(n.id, before, true);
      return;
    }
    if (a === 'after' || a === 'before') {
      if (!f.parent) return mindAction('child');
      const n = mk(depthOf(f.node.id));
      const arr = f.parent.children;
      arr.splice(arr.indexOf(f.node) + (a === 'after' ? 1 : 0), 0, n);
      relayout();
      editMindNode(n.id, before, true);
      return;
    }
    if (a === 'delete') {
      if (!f.parent) { const idx = S.doc.items.indexOf(it); deactivateMind(); S.doc.items.splice(idx, 1); renderAll(); commit(before); return; }
      const arr = f.parent.children, i = arr.indexOf(f.node);
      arr.splice(i, 1);
      S.mind.sel = (arr[i] || arr[i - 1] || f.parent).id;
      relayout();
      commit(before);
    }
  }
  function mindNav(key) {
    const it = mindById(S.mind.id);
    const f = findNode(it.root, S.mind.sel);
    if (!f) return;
    if (key === 'ArrowLeft' && f.parent) selectMindNode(f.parent.id);
    else if (key === 'ArrowRight' && f.node.children && f.node.children.length) selectMindNode(f.node.children[Math.floor((f.node.children.length - 1) / 2)].id);
    else if (key === 'ArrowUp' || key === 'ArrowDown') {
      // 和 XMind 一样按画面位置走：跨主题也能移到上面／下面最近的那个
      const boxes = C.mindLayout(it).boxes;
      const cur = boxes.find((b) => b.id === f.node.id);
      if (!cur) return;
      const up = key === 'ArrowUp', cy = cur.y + cur.h / 2;
      let best = null, bestScore = Infinity;
      for (const b of boxes) {
        if (b.id === cur.id) continue;
        const by = b.y + b.h / 2;
        const dy = up ? cy - by : by - cy;
        if (dy <= 1) continue;
        const dx = Math.max(0, Math.max(b.x, cur.x) - Math.min(b.x + b.w, cur.x + cur.w)); // 左右不重叠时的间隔
        const score = dy + dx * 0.6 + Math.abs(b.level - cur.level) * 4;
        if (score < bestScore) { bestScore = score; best = b; }
      }
      if (best) selectMindNode(best.id);
    }
  }
  // 节点上点一下选中，双击编辑
  // 导图内部视角：触控板捏合缩放、双指滑动平移、在空白处按住拖动平移
  function setMindView(it, v, w) {
    it.view = { x: Math.round(v.x), y: Math.round(v.y), z: Math.round(Math.max(0.15, Math.min(4, v.z)) * 1000) / 1000 };
    const inner = w && w.querySelector('.mind-in');
    if (inner) inner.style.transform = `translate(${it.view.x}px, ${it.view.y}px) scale(${it.view.z})`;
    const li = S.layout.items[it.id];
    mindSigs[it.id] = JSON.stringify([it.root, it.skin, it.font, li.top, S.mind && S.mind.sel, !!S.mind, PAGE.cw, it.view, it.h]);
    touch();
  }
  mindLayer.addEventListener('wheel', (e) => {
    const w = e.target.closest('.mind.active');
    if (!w) return;
    e.preventDefault();
    e.stopPropagation();
    const it = mindById(w.dataset.id);
    const li = S.layout.items[it.id];
    const v = C.mindView(it, li.mind);
    if (e.ctrlKey) {
      const r = w.getBoundingClientRect();
      const px = (e.clientX - r.left) / S.zoom, py = (e.clientY - r.top) / S.zoom;
      const nz = Math.max(0.15, Math.min(4, v.z * Math.exp(-e.deltaY * 0.012)));
      setMindView(it, { x: px - (px - v.x) * nz / v.z, y: py - (py - v.y) * nz / v.z, z: nz }, w);
    } else {
      setMindView(it, { x: v.x - e.deltaX / S.zoom, y: v.y - e.deltaY / S.zoom, z: v.z }, w);
    }
  }, { passive: false });
  mindLayer.addEventListener('pointerdown', (e) => {
    const w = e.target.closest('.mind.active');
    if (!w) return;
    const n = e.target.closest('.mn');
    if (!n) {
      if (e.target.closest('.mindgrip')) return;
      e.preventDefault();
      if (S.mind.editing) finishMindEdit();
      const it = mindById(w.dataset.id);
      const v0 = Object.assign({}, C.mindView(it, S.layout.items[it.id].mind));
      const x0 = e.clientX, y0 = e.clientY;
      w.setPointerCapture(e.pointerId);
      w.classList.add('panning');
      let moved = false;
      const mv = (ev) => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        moved = true;
        setMindView(it, { x: v0.x + (ev.clientX - x0) / S.zoom, y: v0.y + (ev.clientY - y0) / S.zoom, z: v0.z }, w);
      };
      const up = () => {
        w.removeEventListener('pointermove', mv); w.removeEventListener('pointerup', up); w.classList.remove('panning');
        // 点一下空白处：取消选中主题（导图仍在编辑状态，方向键重新从中心主题开始）
        if (!moved && S.mind && S.mind.sel) { cancelArm(); if (document.activeElement && document.activeElement.classList.contains('mn')) document.activeElement.blur(); S.mind.sel = null; renderMinds(); }
      };
      w.addEventListener('pointermove', mv);
      w.addEventListener('pointerup', up);
      return;
    }
    if (n.classList.contains('editing') || n.classList.contains('armed')) return;
    e.preventDefault();
    if (S.mind.editing) finishMindEdit();
    selectMindNode(n.dataset.nid);
  });
  mindLayer.addEventListener('dblclick', (e) => {
    const n = e.target.closest('.mind.active .mn');
    if (!n || !S.mind) return;
    if (S.mind.editing && S.mind.editing.armed && S.mind.editing.nid === n.dataset.nid) {
      // 双击：接着原文字往后改
      const ed = S.mind.editing;
      ed.armed = false;
      n.classList.remove('armed'); n.classList.add('editing'); n.style.height = 'auto';
      const rr = document.createRange(); rr.selectNodeContents(n); rr.collapse(false);
      const ss = getSelection(); ss.removeAllRanges(); ss.addRange(rr);
    } else if (!S.mind.editing) editMindNode(n.dataset.nid, null, false);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!S.mind) return;
    const t = e.target && e.target.closest ? e.target : null;
    if (t && (t.closest('.mind.active') || t.closest('.mindbar') || t.closest('.mindgrip') || t.closest('.skinpop') || t.closest('.lockchip') || t.closest('.ctxmenu'))) return;
    deactivateMind(); // 点导图外面：退出导图，这一下照常生效（画笔、批注、拖分栏都不受影响）
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!S.mind || S.mind.editing || e.isComposing) return;
    if (e.target && e.target.classList && e.target.classList.contains('mn')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t.isContentEditable && !t.classList.contains('mn')))) return;
    if (e.metaKey || e.ctrlKey) return;
    if (!S.mind.sel) {
      // 没有选中主题：方向键选中心主题，Esc 退出，其他键不动导图
      const it0 = mindById(S.mind.id);
      if (e.key.startsWith('Arrow') && it0) { e.preventDefault(); e.stopImmediatePropagation(); selectMindNode(it0.root.id); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); deactivateMind(); }
      else if (['Tab', 'Enter', ' ', 'F2', 'Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    let used = true;
    if (e.key === 'Tab') mindAction('child');
    else if (e.key === 'Enter') mindAction(e.shiftKey ? 'before' : 'after');
    else if (e.key === ' ' || e.key === 'F2') editMindNode(S.mind.sel, null, true);
    else if (e.key === 'Delete' || e.key === 'Backspace') mindAction('delete');
    else if (e.key.startsWith('Arrow')) mindNav(e.key);
    else if (e.key === 'Escape') deactivateMind();
    else used = false;
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  // 选中导图时上方的小工具条：皮肤、删除
  let mindBar = null, skinPop = null;
  function closeSkinPop() { if (skinPop) { skinPop.remove(); skinPop = null; } }
  function drawMindBar() {
    if (mindBar) { if (mindBar._grip) mindBar._grip.remove(); mindBar.remove(); mindBar = null; }
    if (!S.mind) return;
    const it = mindById(S.mind.id);
    const li = it && S.layout.items[it.id];
    if (!li) return;
    const sk = C.MIND_SKINS[it.skin] || C.MIND_SKINS.vital;
    mindBar = el('div', 'mindbar');
    mindBar.innerHTML = `<button class="skinbtn" title="皮肤"><span class="strip">${sk.strip.map((c) => `<i style="background:${c}"></i>`).join('')}</span>${sk.name}</button><button class="mfit" title="适应：整张导图放到中间"><i class="ti ti-arrows-maximize"></i>适应</button><button class="mdel" title="删除导图"><i class="ti ti-trash"></i></button>`;
    mindBar.style.left = PAGE.mx + 'px';
    mindBar.style.top = (li.top - 46) + 'px';
    mindBar.style.transform = `scale(${1 / Math.max(0.6, S.zoom)})`;
    mindBar.style.transformOrigin = 'left bottom';
    mindBar.querySelector('.skinbtn').onclick = () => openSkinPop(it, mindBar.querySelector('.skinbtn'));
    mindBar.querySelector('.mdel').onclick = () => { S.mind.sel = it.root.id; mindAction('delete'); };
    mindBar.querySelector('.mfit').onclick = () => { setMindView(it, C.mindFitView(it, li.mind), mindLayer.querySelector(`.mind[data-id="${it.id}"]`)); };
    ui.appendChild(mindBar);
    // 底边拖动：调整导图块高度
    const grip = el('div', 'mindgrip');
    grip.style.left = (PAGE.mx + PAGE.cw / 2) + 'px';
    grip.style.top = (li.top + (it.h || 420)) + 'px';
    grip.title = '上下拖动调整导图高度';
    mindBar._grip = grip;
    ui.appendChild(grip);
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      const y0 = e.clientY, h0 = it.h || 420, before = snap();
      let raf = 0;
      const mv = (ev) => { it.h = Math.max(140, Math.round(h0 + (ev.clientY - y0) / S.zoom)); if (!raf) raf = requestAnimationFrame(() => { raf = 0; relayout(); }); };
      const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); relayout(); commit(before); };
      grip.addEventListener('pointermove', mv);
      grip.addEventListener('pointerup', up);
    });
  }
  function openSkinPop(it, anchor) {
    if (skinPop) { closeSkinPop(); return; }
    skinPop = el('div', 'skinpop');
    for (const [k, sk] of Object.entries(C.MIND_SKINS)) {
      const b = el('button', 'skin' + (it.skin === k ? ' on' : ''), `<div class="sname">${sk.name}</div><div class="strip">${sk.strip.map((c) => `<i style="background:${c}"></i>`).join('')}</div>`);
      b.onclick = () => { const before = snap(); it.skin = k; closeSkinPop(); relayout(); commit(before); };
      skinPop.appendChild(b);
    }
    const r = anchor.getBoundingClientRect();
    skinPop.style.left = r.left + 'px';
    skinPop.style.top = (r.bottom + 6) + 'px';
    document.body.appendChild(skinPop);
  }
  function insertMind(atY, tree) {
    const c = viewCenter();
    const y0 = atY != null ? atY : c.y - 120;
    const doc = S.doc, L = S.layout;
    const before = snap();
    const it = C.newMind();
    if (tree) it.root = tree;
    let idx = 0, prevBottom = PAGE.my;
    doc.items.forEach((x, i) => { const li = L.items[x.id]; if (li && li.top < y0) { idx = i + 1; prevBottom = li.bottom; } });
    it.spaceBefore = Math.max(16, y0 - prevBottom);
    const next = doc.items[idx];
    doc.items.splice(idx, 0, it);
    relayout();
    if (next) { const nl = S.layout.items[next.id]; const ml = S.layout.items[it.id]; if (nl && ml) next.spaceBefore = Math.max(16, (next.spaceBefore || 0)); }
    renderAll();
    commit(before);
    activateMind(it.id);
  }


  function pasteIntoMind(text) {
    const it = mindById(S.mind.id);
    if (!it) return;
    const tree = C.mdToTree(text);
    if (!tree) return;
    const before = snap();
    const f = findNode(it.root, S.mind.sel) || { node: it.root };
    const isDefault = it.root.text === '中心主题' && (it.root.children || []).every((c) => /^分支主题 \d$/.test(c.text) && !(c.children || []).length);
    if (f.node === it.root && isDefault) { it.root = tree; it.view = null; } // 新建的空导图：整张换成粘贴的内容
    else (f.node.children = f.node.children || []).push(...(tree.text === '中心主题' && tree.children.length ? tree.children : [tree]));
    relayout();
    commit(before);
    S.mind.sel = it.root.id;
    renderMinds();
  }
  // 右键菜单：插入思维导图（专注模式下也能用）
  let ctxEl = null;
  function closeCtx() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
  scroller.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.ced') || e.target.closest('.pnote.editing') || e.target.closest('.mn.editing')) return;
    e.preventDefault();
    closeCtx();
    const pt = toPaper(e);
    ctxEl = el('div', 'menu ctxmenu');
    ctxEl.innerHTML = `<button class="im"><i class="ti ti-sitemap"></i>插入思维导图</button>`;
    ctxEl.querySelector('.im').onclick = () => { closeCtx(); insertMind(pt.y); };
    ctxEl.style.position = 'fixed';
    ctxEl.style.left = e.clientX + 'px';
    ctxEl.style.top = e.clientY + 'px';
    document.body.appendChild(ctxEl);
  });
  document.addEventListener('pointerdown', (e) => { if (ctxEl && !ctxEl.contains(e.target)) closeCtx(); }, true);

  /* ---------- 笔记列表 ---------- */
  function fmtDate(t) {
    const d = new Date(t), pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function renderNoteList() {
    if (S.renaming) return; // 正在改名：不重画列表，免得输入框被冲掉
    const box = $('#notelist');
    box.innerHTML = '';
    S.notes.sort((a, b) => b.modified - a.modified);
    for (const n of S.notes) {
      const d = el('div', 'note' + (S.doc && n.id === S.doc.id ? ' on' : ''));
      d.innerHTML = `<div class="t"></div><div class="d">${fmtDate(n.modified)}</div><button class="del" title="删除笔记"><i class="ti ti-trash"></i></button>`;
      d.querySelector('.t').textContent = n.title;
      d.dataset.id = n.id;
      // 单击打开；双击笔记名进入改名（打开会重画列表，所以按两次点击的间隔判断）
      d.onclick = (e) => {
        if (e.target.closest('.del') || e.target.closest('.rn')) return;
        const now = performance.now(), lc = S.lastNoteClick;
        S.lastNoteClick = { id: n.id, t: now };
        if (lc && lc.id === n.id && now - lc.t < 450 && e.target.closest('.t')) { S.lastNoteClick = null; startRename(n.id); return; }
        if (!S.doc || S.doc.id !== n.id) openNote(n.id);
      };
      d.querySelector('.del').onclick = async () => {
        await Store.remove(n.id);
        S.notes = S.notes.filter((x) => x.id !== n.id);
        if (S.doc && S.doc.id === n.id) {
          if (S.notes.length) await openNote(S.notes[0].id, true); else await newNote();
        }
        renderNoteList();
      };
      box.appendChild(d);
    }
  }
  // 侧栏改名：输入框＋对号（确定）＋叉（取消）；回车＝对号，Esc 或点别处＝叉
  function startRename(id) {
    const row = $('#notelist').querySelector(`.note[data-id="${id}"]`);
    const n = S.notes.find((x) => x.id === id);
    if (!row || !n) return;
    S.renaming = id;
    const t = row.querySelector('.t');
    t.classList.add('renaming');
    t.innerHTML = '<div class="rn"><input><button class="ok" title="确定（回车）"><i class="ti ti-check"></i></button><button class="no" title="取消（Esc）"><i class="ti ti-x"></i></button></div>';
    const inp = t.querySelector('input');
    inp.value = n.title;
    inp.focus(); inp.select();
    let finished = false;
    const finish = async (ok) => {
      if (finished) return;
      finished = true;
      const v = inp.value.replace(/\s+/g, ' ').trim();
      S.renaming = null;
      if (ok && v && v !== n.title) await renameNote(id, v);
      renderNoteList();
    };
    t.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    t.querySelector('.ok').onclick = (e) => { e.stopPropagation(); finish(true); };
    t.querySelector('.no').onclick = (e) => { e.stopPropagation(); finish(false); };
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', () => setTimeout(() => finish(false), 0));
  }
  // 改名：改笔记里的标题并存盘（文件名跟着变），修改时间不变，列表顺序不跳
  async function renameNote(id, title) {
    if (S.doc && S.doc.id === id) {
      S.doc.title = title;
      renderTitle();
      clearTimeout(S.saveTimer); S.saveTimer = null;
      await Store.save(S.doc);
    } else {
      const d = await Store.load(id);
      if (!d) return;
      d.title = title;
      await Store.save(d);
    }
    const n = S.notes.find((x) => x.id === id);
    if (n) n.title = title;
  }
  function migrate(doc) {
    doc.items = doc.items || [];
    doc.strokes = doc.strokes || [];
    doc.minPages = doc.minPages || 1;
    doc.images = doc.images || [];
    // 页边距：最早的笔记（标题带秒，1.2 之前）按普通；其他缺了的（1.8.5 的 bug 把它弄丢了）恢复成窄
    if (!C.MARGINS[doc.margin]) doc.margin = /\d:\d\d:\d\d/.test(doc.title || '') ? 'normal' : 'narrow';
    doc.notes = doc.notes || [];
    return doc;
  }
  async function loadAssets(doc) {
    for (const im of doc.images) {
      if (!S.assets[im.ref]) { const u = await Store.loadAsset(im.ref); if (u) S.assets[im.ref] = u; }
    }
  }
  async function openNote(id, skipSave) {
    if (!skipSave && S.saveTimer) await saveNow();
    const d = await Store.load(id);
    if (!d) return;
    S.doc = migrate(d);
    await loadAssets(S.doc);
    await ensureDocFonts(S.doc);
    S.history = []; S.future = []; S.editH = {}; S.imgSel = null;
    renderAll();
    scroller.scrollTop = 0;
    renderNoteList();
    Store.pref('lastNote', id);
  }
  async function newNote() {
    if (S.saveTimer) await saveNow();
    S.doc = C.newDoc(S.notes.map((n) => n.title), S.settings.margin);
    S.history = []; S.future = []; S.editH = {}; S.imgSel = null;
    renderAll();
    await saveNow();
    scroller.scrollTop = 0;
    Store.pref('lastNote', S.doc.id);
  }
  function renderTitle() {
    const t = $('#title');
    t.textContent = S.doc.title;
    document.title = 'Note Pro · ' + S.doc.title;
  }
  $('#title').addEventListener('dblclick', () => {
    const t = $('#title');
    const inp = el('input');
    inp.value = S.doc.title;
    t.innerHTML = '';
    t.appendChild(inp);
    inp.focus();
    inp.select();
    const done = (save) => {
      if (save && inp.value.trim() && inp.value.trim() !== S.doc.title) { S.doc.title = inp.value.trim(); touch(); }
      renderTitle();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { inp.value = S.doc.title; inp.blur(); } });
    inp.addEventListener('blur', () => done(true));
  });

  /* ---------- 导出 ---------- */
  async function exportPDF(mode) {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    await saveNow();
    try {
      const assets = {};
      for (const im of S.doc.images || []) if (S.assets[im.ref]) assets[im.ref] = S.assets[im.ref];
      const r = await Store.exportPDF(S.doc, assets, mode || 'dialog', S.exportOpts);
      if (r && !r.ok && !r.canceled) toast((r && r.msg) || '导出失败');
    } catch (err) {
      toast('导出失败：' + err.message, 4000);
    }
  }

  /* ---------- 按钮、快捷键 ---------- */
  $('#btn-sidebar').onclick = () => { $('#sidebar').classList.toggle('open'); Store.pref('sidebar', $('#sidebar').classList.contains('open')); };
  $('#btn-new').onclick = () => newNote();
  $('#btn-undo').onclick = undo;
  $('#btn-redo').onclick = redo;
  function toggleCount() { S.showCount = !S.showCount; Store.pref('showCount', S.showCount); renderChrome(); }
  window.addEventListener('resize', () => { if (setEl && setEl._onResize) setEl._onResize(); });
  // 设置菜单：擦除后切回、字数统计、页边距
  let setEl = null;
  function closeSettings() { if (setEl) { setEl.remove(); setEl = null; } }
  function openSettings() {
    if (setEl) { closeSettings(); return; }
    setEl = el('div', 'setmenu');
    const sw = (on) => `<button class="switch${on ? ' on' : ''}"></button>`;
    setEl.innerHTML = `
      <div class="row">橡皮擦、导航用完自动切回上一个工具 ${sw(S.settings.autoEraser)}</div>
      <div class="row">字数统计 ${sw(S.showCount)}</div>
      <div class="row">页边距 <div class="seg mg">${Object.entries(C.MARGINS).map(([k, m]) => `<button data-m="${k}" class="${S.doc.margin === k ? 'on' : ''}">${m.name}</button>`).join('')}</div></div>
      <div class="sub">页边距对新排的文字生效，已锁定的文字块保持原样</div>
      <div class="row">平板模式 ${sw(false)}</div>
      <div class="sepline"></div>
      <button class="row act keysbtn"><span><i class="ti ti-keyboard"></i> 快捷键设置</span><span class="kb"></span></button>
      <button class="row act relaunch"><span><i class="ti ti-refresh"></i> 重启软件</span><span class="kb">${comboLabel(keyOf('relaunch'))}</span></button>`;
    setEl.querySelector('.relaunch').onclick = relaunchApp;
    const ratioSw = setEl.querySelectorAll('.switch')[2];
    if (ratioSw && window.api && window.api.winRatio) {
      window.api.winRatio(null).then((on) => ratioSw.classList.toggle('on', !!on)).catch(() => {});
      ratioSw.onclick = async () => {
        const on = !ratioSw.classList.contains('on');
        try { await window.api.winRatio(on); ratioSw.classList.toggle('on', on); }
        catch (err) { relaunchApp(); } // 主进程还是旧的：先整个重启
      };
    }
    setEl.querySelector('.keysbtn').onclick = () => openKeys();
    const [a, b] = setEl.querySelectorAll('.switch');
    a.onclick = () => { S.settings.autoEraser = !S.settings.autoEraser; saveSettings(); a.classList.toggle('on', S.settings.autoEraser); };
    b.onclick = () => { toggleCount(); b.classList.toggle('on', S.showCount); };
    setEl.querySelectorAll('.seg.mg button').forEach((bt) => {
      bt.onclick = () => {
        const m = bt.dataset.m;
        if (!C.MARGINS[m]) return;
        S.settings.margin = m; saveSettings();
        if (S.doc.margin !== m) { const before = snap(); S.doc.margin = m; renderAll(); commit(before); }
        setEl.querySelectorAll('.seg.mg button').forEach((x) => x.classList.toggle('on', x === bt));
      };
    });
    $('#topbar').appendChild(setEl);
  }
  $('#btn-more').onclick = (e) => { e.stopPropagation(); openSettings(); };
  // 重启软件：先把当前笔记存好，再整个退出、自动重新打开（改了代码后用）
  function relaunchApp() {
    try { if (S.mind && S.mind.editing) finishMindEdit(); } catch (err) { /* 忽略 */ }
    try { if (S.editNote) finishNoteEdit(); } catch (err) { /* 忽略 */ }
    try { if (window.api && window.api.saveSync) window.api.saveSync(S.doc); } catch (err) { /* 忽略 */ }
    if (window.api && window.api.relaunch) {
      window.api.relaunch();
      // 2 秒后还在：说明后台是很旧的版本，不认识重启，只能手动退出一次
      setTimeout(() => toast('请按 ⌘Q 退出后重新打开一次（后台还是旧版本，自动重启不了）', 6000), 2000);
    } else location.reload();
  }
  document.addEventListener('pointerdown', (e) => { if (setEl && !setEl.contains(e.target) && !e.target.closest('#btn-more')) closeSettings(); }, true);

  // 专注模式：收起顶栏，留一个可拖动的悬浮按钮
  const zenBtn = $('#zenbtn');
  function renderZenBtn() {
    const t = TOOLS.find((x) => x.id === S.tool) || TOOLS[0];
    const cfg = S.cfg[t.id];
    zenBtn.innerHTML = `<i class="ti ${t.icon}"></i>` + (cfg && cfg.c ? `<span class="bar" style="background:${t.id === 'hl' ? hlColor() : cfg.c}"></span>` : '');
    const pos = Store.pref('zenPos') || { x: innerWidth - 80, y: 24 };
    zenBtn.style.left = Math.max(4, Math.min(innerWidth - 50, pos.x)) + 'px';
    zenBtn.style.top = Math.max(4, Math.min(innerHeight - 50, pos.y)) + 'px';
  }
  function setZen(on) {
    document.body.classList.toggle('zen', on);
    Store.pref('zen', on);
    closeSettings();
    if (on) renderZenBtn();
  }
  zenBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    zenBtn.setPointerCapture(e.pointerId);
    const r = zenBtn.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top, x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const mv = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      zenBtn.style.left = Math.max(4, Math.min(innerWidth - 50, ev.clientX - ox)) + 'px';
      zenBtn.style.top = Math.max(4, Math.min(innerHeight - 50, ev.clientY - oy)) + 'px';
    };
    const up = () => {
      zenBtn.removeEventListener('pointermove', mv);
      zenBtn.removeEventListener('pointerup', up);
      if (moved) Store.pref('zenPos', { x: parseFloat(zenBtn.style.left), y: parseFloat(zenBtn.style.top) });
      else setZen(false);
    };
    zenBtn.addEventListener('pointermove', mv);
    zenBtn.addEventListener('pointerup', up);
  });
  // 导出面板：格式、页面、水印；设置会记住，⌘P 和分享都按这个设置
  S.exportOpts = Object.assign({ format: 'pdf', ratio: 'a4' }, Store.pref('exportOpts') || {});
  S.exportOpts.wm = Object.assign({ on: false, text: '真实面试·老Bob', style: 'corner' }, S.exportOpts.wm || {});
  const saveExportOpts = () => Store.pref('exportOpts', S.exportOpts);
  let expEl = null;
  function closeExport() { if (expEl) { expEl.remove(); expEl = null; } }
  function openExport() {
    if (expEl) { closeExport(); return; }
    closeSettings();
    expEl = el('div', 'setmenu exppop');
    const draw = () => {
      const o = S.exportOpts;
      const seg = (name, items, cur) => `<div class="seg" data-k="${name}">${items.map(([v, t]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
      const word = o.format === 'docx';
      expEl.innerHTML = `
        <div class="row">格式 ${seg('format', [['pdf', 'PDF'], ['png', '图片'], ['docx', 'Word']], o.format)}</div>
        ${word ? '<div class="sub">Word 只导出文字（保留字号、颜色、高亮、加粗、下划线），批注变成 Word 批注</div>' : `
        <div class="row">页面 ${seg('ratio', [['a4', 'A4'], ['34', '3:4']], o.ratio)}</div>
        <div class="row">水印 <button class="switch${o.wm.on ? ' on' : ''}"></button></div>
        ${o.wm.on ? `<div class="row wmrow"><input class="wmtext" value="${String(o.wm.text).replace(/"/g, '&quot;')}" placeholder="水印文字">${seg('wmstyle', [['corner', '角标'], ['tile', '平铺']], o.wm.style)}</div>` : ''}`}
        <div class="row"><span></span><button class="expgo"><i class="ti ti-file-export"></i> 导出</button></div>`;
      expEl.querySelectorAll('.seg').forEach((sg) => sg.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          const k = sg.dataset.k, v = b.dataset.v;
          if (k === 'wmstyle') o.wm.style = v; else o[k] = v;
          saveExportOpts(); draw();
        };
      }));
      const sw = expEl.querySelector('.switch');
      if (sw) sw.onclick = () => { o.wm.on = !o.wm.on; saveExportOpts(); draw(); };
      const tx = expEl.querySelector('.wmtext');
      if (tx) tx.oninput = () => { o.wm.text = tx.value; saveExportOpts(); };
      expEl.querySelector('.expgo').onclick = () => { closeExport(); exportPDF('dialog'); };
    };
    draw();
    $('#topbar').appendChild(expEl);
  }
  document.addEventListener('pointerdown', (e) => { if (expEl && !expEl.contains(e.target) && !e.target.closest('#btn-export')) closeExport(); }, true);
  $('#btn-export').onclick = (e) => { e.stopPropagation(); openExport(); };
  $('#btn-wechat').onclick = () => exportPDF('wechat');
  $('#btn-addpage').onclick = () => {
    const before = snap();
    S.doc.minPages = Math.max(S.doc.minPages || 1, S.pageCount) + 1;
    relayout();
    commit(before);
    scroller.scrollTop = scroller.scrollHeight;
  };


  /* ---------- 快捷键：一张表管所有常用快捷键，可在“快捷键设置”里改 ---------- */
  var SHORTCUTS = [
    { g: '工具', id: 'tool:pen1', label: '钢笔1', def: 'Mod+1' },
    { g: '工具', id: 'tool:pen2', label: '钢笔2', def: 'Mod+2' },
    { g: '工具', id: 'tool:note', label: '批注', def: 'Mod+3' },
    { g: '工具', id: 'tool:hl', label: '标记笔', def: 'Mod+4' },
    { g: '工具', id: 'tool:laser', label: '镭射', def: 'Mod+5' },
    { g: '工具', id: 'tool:hand', label: '导航', def: 'Mod+6' },
    { g: '工具', id: 'tool:eraser', label: '橡皮擦', def: 'Mod+7' },
    { g: '工具', id: 'tool:text', label: '文本', def: 'Mod+8' },
    { g: '工具', id: 'tool:anno', label: '标注', def: 'Mod+9' },
    { g: '工具', id: 'lastTool', label: '上一个工具', def: 'Mod+0' },
    { g: '笔记', id: 'newNote', label: '新建笔记', def: 'Mod+N' },
    { g: '笔记', id: 'sendWechat', label: '分享到微信', def: 'Mod+P' },
    { g: '笔记', id: 'exportPDF', label: '导出（按上次的设置）', def: 'Shift+Mod+P' },
    { g: '笔记', id: 'insertMind', label: '插入思维导图', def: 'Shift+Mod+M' },
    { g: '笔记', id: 'lockBlock', label: '锁定文字块', def: 'Mod+L' },
    { g: '笔记', id: 'undo', label: '撤销', def: 'Mod+Z' },
    { g: '笔记', id: 'redo', label: '重做', def: 'Shift+Mod+Z' },
    { g: '显示', id: 'zoomIn', label: '放大', def: 'Mod+=' },
    { g: '显示', id: 'zoomOut', label: '缩小', def: 'Mod+-' },
    { g: '显示', id: 'zoomFit', label: '适合宽度', def: 'Alt+Mod+0' },
    { g: '显示', id: 'toggleZen', label: '专注模式', def: 'Mod+F' },
    { g: '显示', id: 'toggleCount', label: '字数统计', def: 'Shift+Mod+C' },
    { g: '显示', id: 'toggleSidebar', label: '笔记列表', def: 'Alt+Mod+S' },
    { g: '软件', id: 'relaunch', label: '重启软件', def: 'Mod+R' },
    { g: '软件', id: 'reload', label: '刷新页面', def: 'Shift+Mod+R' },
  ];
  // 系统和编辑常用的，不让占用
  var RESERVED = new Set(['Mod+C', 'Mod+V', 'Mod+X', 'Mod+A', 'Mod+Q', 'Mod+W', 'Mod+H', 'Mod+M', 'Alt+Mod+H', 'Mod+,', 'Mod+`', 'Shift+Mod+V']);
  var KEYS = {}; // id → 组合（空字符串表示不用快捷键）
  const keyOf = (id) => (id in KEYS ? KEYS[id] : (SHORTCUTS.find((x) => x.id === id) || {}).def || '');
  function loadKeys() { KEYS = Object.assign({}, Store.pref('keys') || {}); }
  function saveKeys() { Store.pref('keys', KEYS); syncKeys(); }
  var CODE_KEY = { Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`' };
  function codeKey(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
    if (/^F([1-9]|1[0-2])$/.test(code)) return code;
    return CODE_KEY[code] || null;
  }
  function comboOf(e) {
    const k = codeKey(e.code);
    if (!k) return null;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod && !e.altKey && !/^F\d/.test(k)) return null; // 单个字母不当快捷键，免得打字时误触
    return (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + (mod ? 'Mod+' : '') + k;
  }
  // 显示成 Mac 的写法：⌥⇧⌘P
  function comboLabel(c) {
    if (!c) return '';
    const p = c.split('+'), k = p.pop();
    return (p.includes('Alt') ? '⌥' : '') + (p.includes('Shift') ? '⇧' : '') + (p.includes('Mod') ? '⌘' : '') + k;
  }
  // 给菜单用的写法（Electron accelerator）
  const comboAccel = (c) => c ? c.replace('Mod', 'CmdOrCtrl') : '';
  function syncKeys() {
    if (window.api && window.api.setKeys) window.api.setKeys(Object.fromEntries(SHORTCUTS.map((x) => [x.id, comboAccel(keyOf(x.id))])));
    if (typeof renderTools === 'function') renderTools();
  }
  // 工具栏图标右上角的小字：⌘＋单键只显示那个键
  function toolKbd(id) {
    try {
      const c = keyOf('tool:' + id);
      if (!c) return '';
      return /^Mod\+[^+]+$/.test(c) ? c.slice(4) : comboLabel(c).replace('⌘', '');
    } catch (err) { return (TOOLS.find((t) => t.id === id) || {}).key || ''; }
  }
  function findShortcut(combo) {
    if (!combo) return null;
    return SHORTCUTS.find((x) => keyOf(x.id) === combo) || null;
  }
  function runShortcut(sc) {
    if (sc.id.startsWith('tool:')) doAction('tool', sc.id.slice(5));
    else doAction(sc.id);
  }
  loadKeys();
  syncKeys();

  // 快捷键设置面板：点右边的按键框，按下新的组合就改好；同一个组合原来的主人自动清空
  let keysEl = null, recording = null;
  function closeKeys() { if (keysEl) { keysEl.remove(); keysEl = null; recording = null; } }
  function openKeys() {
    closeSettings();
    if (keysEl) { closeKeys(); return; }
    keysEl = el('div', 'keyspanel');
    const draw = () => {
      const groups = [...new Set(SHORTCUTS.map((x) => x.g))];
      keysEl.innerHTML = `<div class="kp-head"><b>快捷键</b><span class="kp-tip">点右边的按键框，再按新的组合；Delete 清空，Esc 取消</span><button class="kp-x" title="关闭"><i class="ti ti-x"></i></button></div>
        <div class="kp-body">${groups.map((g) => `<div class="kp-g">${g}</div>` + SHORTCUTS.filter((x) => x.g === g).map((x) => {
          const c = keyOf(x.id), changed = c !== x.def;
          return `<div class="kp-row"><span>${x.label}</span><span class="kp-r">${changed ? `<button class="kp-reset" data-id="${x.id}" title="恢复默认 ${comboLabel(x.def)}"><i class="ti ti-arrow-back-up"></i></button>` : ''}<button class="kp-key${recording === x.id ? ' rec' : ''}${c ? '' : ' none'}" data-id="${x.id}">${recording === x.id ? '按下新快捷键…' : (comboLabel(c) || '无')}</button></span></div>`;
        }).join('')).join('')}</div>
        <div class="kp-foot"><button class="kp-all">全部恢复默认</button></div>`;
      keysEl.querySelector('.kp-x').onclick = closeKeys;
      keysEl.querySelectorAll('.kp-key').forEach((b) => { b.onclick = () => { recording = recording === b.dataset.id ? null : b.dataset.id; draw(); }; });
      keysEl.querySelectorAll('.kp-reset').forEach((b) => { b.onclick = () => { const sc = SHORTCUTS.find((x) => x.id === b.dataset.id); setKey(sc.id, sc.def); draw(); }; });
      keysEl.querySelector('.kp-all').onclick = () => { KEYS = {}; recording = null; saveKeys(); draw(); };
    };
    keysEl._draw = draw;
    draw();
    document.body.appendChild(keysEl);
  }
  function setKey(id, combo) {
    // 同一个组合只能给一个功能：原来用它的那个清空
    if (combo) SHORTCUTS.forEach((x) => { if (x.id !== id && keyOf(x.id) === combo) KEYS[x.id] = ''; });
    const sc = SHORTCUTS.find((x) => x.id === id);
    if (sc && combo === sc.def) delete KEYS[id]; else KEYS[id] = combo;
    saveKeys();
  }
  // 录新快捷键（捕获阶段，抢在其他快捷键前面）
  document.addEventListener('keydown', (e) => {
    if (!keysEl || !recording) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.key === 'Escape') { recording = null; keysEl._draw(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { setKey(recording, ''); recording = null; keysEl._draw(); return; }
    const c = comboOf(e);
    if (!c) return; // 只按了修饰键，或者是不带 ⌘／⌥ 的普通键：继续等
    const btn = keysEl.querySelector('.kp-key.rec');
    if (RESERVED.has(c)) { if (btn) { btn.classList.add('bad'); btn.textContent = comboLabel(c) + ' 是系统常用键'; } return; }
    setKey(recording, c); recording = null; keysEl._draw();
  }, true);
  document.addEventListener('pointerdown', (e) => { if (keysEl && !keysEl.contains(e.target) && !e.target.closest('#btn-more') && !e.target.closest('.setmenu')) closeKeys(); }, true);

  function doAction(a, arg) {
    switch (a) {
      case 'tool': setTool(arg); break;
      case 'lastTool': setTool(S.lastTool); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'zoomIn': setZoom(S.zoom * 1.15); break;
      case 'zoomOut': setZoom(S.zoom / 1.15); break;
      case 'zoomFit': fitZoom(); break;
      case 'newNote': newNote(); break;
      case 'exportPDF': exportPDF('dialog'); break;
      case 'sendWechat': exportPDF('wechat'); break;
      case 'toggleCount': toggleCount(); break;
      case 'importFonts': importFonts(); break;
      case 'insertMind': insertMind(); break;
      case 'toggleZen': setZen(!document.body.classList.contains('zen')); break;
      case 'relaunch': relaunchApp(); break;
      case 'reload': location.reload(); break;
      case 'keys': openKeys(); break;
      case 'toggleSidebar': $('#btn-sidebar').click(); break;
      case 'lockBlock': {
        const ae = document.activeElement;
        const blk = ae && ae.closest && ae.closest('.eblock');
        const it = blk ? S.doc.items.find((x) => x.id === blk.dataset.id) : S.doc.items.filter((x) => !x.locked && x.type !== 'mind').pop();
        if (it) lockBlock(it);
        break;
      }
    }
  }
  if (window.api && window.api.onMenu) window.api.onMenu((a, arg) => doAction(a, arg));

  document.addEventListener('keydown', (e) => {
    const typing = e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.isContentEditable) && !(e.target.classList && e.target.classList.contains('armed'));
    if (e.key === 'Escape' && expEl) { closeExport(); return; }
    if (e.key === 'Escape') {
      if (typing) { const wasBlock = e.target.classList && e.target.classList.contains('ced'); e.target.blur(); if (wasBlock) textDone(); }
      clearSel();
      closeMenu();
      closeSettings();
      closeKeys();
      if (S.imgSel) selectImage(S.imgSel.crop ? S.imgSel.id : null);
      return;
    }
    if (e.key === 'Enter' && S.imgSel && S.imgSel.crop && !typing) { e.preventDefault(); selectImage(S.imgSel.id); return; }
    const mod = e.metaKey || e.ctrlKey;
    const sc = findShortcut(comboOf(e));
    if (sc) {
      // 在普通输入框里打字时，撤销／重做交给输入框自己
      if ((sc.id === 'undo' || sc.id === 'redo') && typing && !activeEditor()) return;
      e.preventDefault();
      if (e.repeat && (sc.id.startsWith('tool:') || sc.id === 'lastTool')) return;
      runShortcut(sc);
      // 橡皮擦、导航：按住快捷键就一直保持，松开回到上一个工具
      if (sc.id === 'tool:eraser' || sc.id === 'tool:hand') spring = { tool: sc.id.slice(5), code: e.code, held: true, used: false };
      else if (sc.id.startsWith('tool:')) spring = null;
      return;
    }
    if (typing) return;
    if (mod && e.key === '+' && keyOf('zoomIn') === 'Mod+=') { e.preventDefault(); doAction('zoomIn'); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.imgSel) { e.preventDefault(); const im = imgById(S.imgSel.id); if (im) imgAction('del', im); return; }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'c' && S.imgSel) { e.preventDefault(); const im = imgById(S.imgSel.id); if (im) copyImage(im); return; }
  });
  window.addEventListener('beforeunload', () => { if (S.saveTimer && window.api && window.api.saveSync) window.api.saveSync(S.doc); });
  // 标题最宽到工具栏左边为止（工具栏随工具变宽变窄）
  (() => {
    const pill = document.getElementById('toolpill'), tt = document.getElementById('title');
    if (!pill || !tt) return;
    const fit = () => { const l = pill.getBoundingClientRect().left, tl = tt.getBoundingClientRect().left || 54; if (l > 0) tt.style.maxWidth = Math.max(80, l - tl - 12) + 'px'; };
    if (window.ResizeObserver) new ResizeObserver(fit).observe(pill);
    window.addEventListener('resize', fit);
    fit();
  })();

  /* ---------- 启动 ---------- */
  async function boot() {
    if (document.fonts && document.fonts.load) {
      try { await Promise.all(['sans', 'serif', 'kai', 'smiley', 'qingsong'].map((f) => C.ensureFont(f, 16, '字'))); } catch (e) { /* 忽略 */ }
    }
    if (Store.pref('sidebar')) $('#sidebar').classList.add('open');
    await refreshFonts();
    setTool(TOOLS.find((t) => t.id === Store.pref('tool')) ? Store.pref('tool') : 'pen1');
    S.notes = await Store.list();
    const last = Store.pref('lastNote');
    if (last && S.notes.find((n) => n.id === last)) await openNote(last, true);
    else if (S.notes.length) await openNote(S.notes[0].id, true);
    else await newNote();
    if (Store.pref('zen')) setZen(true);
    restoreView();
    // 主进程代码更新过（只刷新了页面）：自动整个重启一次，免得新功能用不了
    try {
      const stale = window.api && window.api.isStale ? await window.api.isStale() : false;
      if (stale) { relaunchApp(); return; }
    } catch (err) { if (window.api && window.api.relaunch) { relaunchApp(); return; } }
    const pw = Store.pref('pendingWin');
    if (pw && window.api && window.api.setWinSize) { Store.pref('pendingWin', null); try { await window.api.setWinSize(pw[0], pw[1]); } catch (err) { /* 忽略 */ } }
    renderNoteList();
  }
  window.App = { S, Laser, insertMind, activateMind, mindAction, insertImage, selectImage, imgAction, setZen, setTool, pasteAsBlock, createBlockAt, lockBlock, relayout, renderAll, undo, redo, exportPDF, saveNow, doAction };
  boot();
})();

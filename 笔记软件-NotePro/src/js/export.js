/* 导出：把文档按页排好（不带锁头、页码、字数这些界面元素） */
(function () {
  const C = window.Core;
  const { PAGE } = C;

  // 水印：角标（右下角一行字）或平铺（斜着铺满整页，很淡）
  function addWatermark(page, wm, pageH) {
    if (!wm || !wm.on || !wm.text) return;
    const box = document.createElement('div');
    box.className = 'wm ' + (wm.style === 'tile' ? 'tile' : 'corner');
    if (wm.style === 'tile') {
      // 按坐标逐个摆放，保证整页（包括四个角）都铺满
      const W = PAGE.w, H = pageH, sx = 230, sy = 120;
      let row = 0;
      for (let y = -40; y < H + 60; y += sy, row++) {
        for (let x = -160 + (row % 2) * (sx / 2); x < W + 60; x += sx) {
          const t = document.createElement('span');
          t.textContent = wm.text;
          t.style.left = x + 'px';
          t.style.top = y + 'px';
          box.appendChild(t);
        }
      }
    } else box.textContent = wm.text;
    page.appendChild(box);
  }
  async function renderForExport(doc, assets, opts) {
    doc = JSON.parse(JSON.stringify(doc));
    assets = assets || {};
    opts = opts || {};
    C.setMargin(doc.margin || 'normal');
    // 页面比例：A4 或 3:4（宽度不变，高度 280mm）
    C.PAGE.h = (opts.ratio === '34' ? 280 : 297) * C.MM;
    C.PAGE.ch = C.PAGE.h - 2 * C.PAGE.my;
    let st = document.getElementById('pagesize');
    if (!st) { st = document.createElement('style'); st.id = 'pagesize'; document.head.appendChild(st); }
    const hmm = opts.ratio === '34' ? 280 : 297;
    st.textContent = `@page { size: 210mm ${hmm}mm; margin: 0; } .page { height: ${hmm}mm !important; }`;
    if (window.api && window.api.fontList) C.setCustomFonts(await window.api.fontList(), (id) => window.api.fontData(id));
    doc.images = doc.images || [];
    const root = document.getElementById('root');
    root.innerHTML = '';
    // 没锁定的文字块按锁定后的样子临时排版
    for (const n of doc.notes || []) await C.ensureFont(n.f || 'qingsong', n.s, n.text);
    for (const it of doc.items) {
      if (it.type === 'mind') { await C.ensureFont(it.font || 'sans', 16, JSON.stringify(it.root)); continue; }
      await C.ensureFont(it.font, it.size, it.text);
      if (!it.locked) C.lockBlockData(it);
    }
    const layout = C.computeLayout(doc, {});
    C.repairAnchors(doc, layout);
    const n = C.pagesNeeded(doc, layout);
    const strokes = doc.strokes.map((s) => {
      const ay = C.strokeAnchorY(layout, s);
      let y0 = Infinity, y1 = -Infinity;
      for (const p of s.pts) { y0 = Math.min(y0, p[1] + ay); y1 = Math.max(y1, p[1] + ay); }
      return { s, ay, y0: y0 - s.w, y1: y1 + s.w, d: C.strokePathD(s, s.pts) };
    });
    for (let p = 0; p < n; p++) {
      const page = document.createElement('div');
      page.className = 'page';
      for (const it of doc.items) {
        const li = layout.items[it.id];
        if (it.type === 'mind') {
          if (li.top > (p + 1) * PAGE.h || li.bottom < p * PAGE.h) continue;
          C.renderMind(it, li, page, li.top - p * PAGE.h);
          continue;
        }
        const host = document.createElement('div');
        host.className = 'lblock';
        C.renderLockedBlock(it, li, host, { offsetY: -p * PAGE.h, page: p });
        page.appendChild(host);
      }
      const top = p * PAGE.h;
      for (const im of doc.images) {
        im._top = C.imageTop(layout, im);
        if (im._top + im.h < top || im._top > top + PAGE.h) continue;
        C.renderImage(im, assets[im.ref], page, -top);
      }
      const svg = document.createElementNS(C.SVGNS, 'svg');
      svg.setAttribute('width', PAGE.w);
      svg.setAttribute('height', PAGE.h);
      svg.setAttribute('viewBox', `0 ${top} ${PAGE.w} ${PAGE.h}`);
      for (const o of strokes) {
        if (o.y1 < top || o.y0 > top + PAGE.h) continue;
        const e = C.makeStrokeEl(o.s, o.d);
        e.setAttribute('transform', `translate(0 ${o.ay})`);
        svg.appendChild(e);
      }
      page.appendChild(svg);
      for (const n of doc.notes || []) {
        const nt = C.noteTop(layout, n);
        if (nt > top + PAGE.h || nt + n.s * 1.3 * (String(n.text).split('\n').length) < top) continue;
        C.renderNote(n, page, nt - top);
      }
      addWatermark(page, opts.wm, PAGE.h);
      root.appendChild(page);
    }
    await Promise.all(Array.from(root.querySelectorAll('img')).map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { pages: n };
  }

  // 导出图片时一页一页地显示，主进程逐页截图
  window.showPage = (i, zoom) => {
    document.body.classList.add('shot');
    document.body.style.zoom = zoom || 1;
    document.querySelectorAll('.page').forEach((p, k) => { p.style.display = k === i ? '' : 'none'; });
    window.scrollTo(0, 0);
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
  };
  window.renderForExport = renderForExport;
  if (window.api && window.api.onExportDoc) {
    window.api.onExportDoc(async (doc, assets, opts) => {
      const info = await renderForExport(doc, assets, opts);
      window.api.exportReady(info);
    });
  }
})();

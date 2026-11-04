// 预览里的表情包／视频素材：显示（裁切、旋转、形状、翻转）、拖动缩放旋转、悬浮菜单、裁切模式、右侧面板
// 数据：crop {x,y,w,h}（占原图的比例，默认整张）、rot（度，顺时针）、shape 'rect'|'circle'、radius（圆角，占短边的百分比0到50）、flip（水平翻转）
//      视频：sound（是否带声音，默认静音）、volume（音量，1＝100%）、hasAudio

const FULL = { x: 0, y: 0, w: 1, h: 1 };
const cropOf = s => s.crop || FULL;
// 显示尺寸（成片像素）：裁切后的部分 × 缩放
function dispSize(s) { const c = cropOf(s); return { w: s.w * c.w * s.scale, h: s.h * c.h * s.scale }; }
const evenPx = n => Math.max(2, Math.round(n / 2) * 2);
const shapeRadius = (s, w, h) => (s.shape === 'circle' ? null : ((s.radius || 0) / 100) * Math.min(w, h));
const stkMedia = id => { const el = stkEls.get(id); return el && el.firstChild; };

/* ---------- 视频素材：预览代理和播放位置 ---------- */
// 视频里对应的时间：从入点（剪掉的开头）算起；片段比视频长时从头循环
function videoLocal(s, t) {
  let l = (s.inPt || 0) + (t - s.start);
  if (s.srcDur > 0 && l >= s.srcDur - 0.02) l = l % s.srcDur;
  return Math.max(0, l);
}
// 预览代理：后台生成720P的小文件，好了以后自动换上（导出仍然用原文件）
const proxyURL = new Map();
function requestProxy(s) {
  if (s.type !== 'video' || !S.dir) return;
  const key = S.dir + '|' + s.file;
  if (proxyURL.has(key)) return;
  proxyURL.set(key, null);
  const dir = S.dir;
  window.api.makeProxy({ dir, file: s.file }).then(p => {
    if (!p || S.dir !== dir) return;
    const url = fileURL(p);
    proxyURL.set(key, url);
    for (const x of S.project.stickers) {
      if (x.file !== s.file || x.type !== 'video') continue;
      const m = stkMedia(x.id);
      if (m && m.src !== url) { const t = m.currentTime, play = !m.paused; m.src = url; m.currentTime = t; if (play) m.play().catch(() => {}); }
    }
  });
}
// 插入视频的波形（缓存在项目的proxies里），好了以后画到时间轴片段里
const assetPeaks = new Map();
function requestPeaks(s) {
  if (s.type !== 'video' || !S.dir) return;
  const key = S.dir + '|' + s.file;
  if (assetPeaks.has(key)) return;
  assetPeaks.set(key, null);
  window.api.assetPeaks({ dir: S.dir, file: s.file }).then(a => { assetPeaks.set(key, Uint8Array.from(a || [])); drawClipWaves(); });
}
const mediaURL = s => (s.type === 'video' && proxyURL.get(S.dir + '|' + s.file)) || assetURL(s.file);

/* ---------- 预览里的元素 ---------- */
function syncPreviewEls() {
  const ids = new Set(S.project.stickers.map(s => s.id));
  for (const [id, el] of stkEls) if (!ids.has(id)) { el.remove(); stkEls.delete(id); }
  S.project.stickers.forEach((s, i) => {
    let el = stkEls.get(s.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'stk';
      el.dataset.id = s.id;
      let m;
      if (s.type === 'text') {
        m = document.createElement('canvas');
      } else if (s.type === 'video') {
        m = document.createElement('video');
        m.loop = true; m.playsInline = true; m.preload = 'auto';
      } else {
        m = document.createElement('img');
        m.draggable = false;
      }
      m.className = 'm';
      if (s.type !== 'text') m.src = mediaURL(s);
      if (s.type === 'video') { requestProxy(s); requestPeaks(s); }
      el.appendChild(m);
      el.style.display = 'none';
      stkLayer.appendChild(el);
      stkEls.set(s.id, el);
    }
    const m = el.firstChild;
    if (s.type === 'video') { const tr = trackOf(s); m.muted = !s.sound || !!(tr && tr.muted); m.volume = Math.min(1, s.volume ?? 1); }
    if (s.type === 'text' && m._key !== JSON.stringify([s.text, s.ts])) refreshText(s);
    el.style.zIndex = (s.layer || 0) * 1000 + i + 1;
  });
  layoutStickers();
}

function layoutStickers() {
  if (!S.project) return;
  const k = stageScale();
  for (const s of S.project.stickers) {
    const el = stkEls.get(s.id);
    if (!el) continue;
    if (isTier(s)) { tierPlace(s, el, k); continue; }
    const m = el.firstChild;
    const fw = s.w * s.scale * k, fh = s.h * s.scale * k; // 整张原图的显示大小
    if (S.cropping && S.cropping.id === s.id) {
      // 裁切模式：显示整张原图，不旋转，方便框选
      const f = S.cropping.full;
      Object.assign(el.style, { left: f.x * k + 'px', top: f.y * k + 'px', width: fw + 'px', height: fh + 'px', transform: 'none', borderRadius: '0', overflow: 'visible' });
      Object.assign(m.style, { left: '0', top: '0', width: fw + 'px', height: fh + 'px', transform: s.flip ? 'scaleX(-1)' : '' });
      continue;
    }
    const c = cropOf(s);
    const d = dispSize(s);
    const w = d.w * k, h = d.h * k;
    const r = shapeRadius(s, w, h);
    Object.assign(el.style, {
      left: s.x * k - w / 2 + 'px', top: s.y * k - h / 2 + 'px', width: w + 'px', height: h + 'px',
      transform: s.rot ? `rotate(${s.rot}deg)` : '', borderRadius: r === null ? '50%' : r + 'px', overflow: 'hidden',
    });
    // 翻转时，裁切框按翻转后的画面算
    const cx = s.flip ? 1 - c.x - c.w : c.x;
    Object.assign(m.style, { left: -cx * fw + 'px', top: -c.y * fh + 'px', width: fw + 'px', height: fh + 'px', transform: s.flip ? 'scaleX(-1)' : '' });
  }
  placeBox();
}

// 根据播放头显示／隐藏；GIF每次出现都从第一帧开始，视频跟着播放头走
function updateStickers(force) {
  if (!S.project) return;
  const t = S.t, playing = !video.paused;
  for (const s of S.project.stickers) {
    const el = stkEls.get(s.id);
    if (!el) continue;
    const tr = trackOf(s);
    const on = (t >= s.start - 1e-6 && t < s.end - 1e-6 && !(tr && tr.hidden)) || (S.cropping && S.cropping.id === s.id);
    const was = el.style.display !== 'none';
    if (on !== was || force) el.style.display = on ? 'block' : 'none';
    const m = el.firstChild;
    if (s.type === 'gif' && on && !was) { const src = m.src; m.src = ''; m.src = src; }
    if (on && isTier(s)) tierPlace(s, el, stageScale()); // 从夯到拉：位置跟着时间走
    if (s.type === 'video') {
      if (!on) { if (!m.paused) m.pause(); continue; }
      const local = videoLocal(s, t);
      const now = performance.now();
      if (!playing) {
        // 停着：画面跟着播放头走（上一次定位还没完成就先不重复定位）
        if (!m.paused) m.pause();
        if (!m.seeking && Math.abs(m.currentTime - local) > 0.02) { try { m.currentTime = local; } catch {} }
      } else if (m.paused) {
        // 开始播：先对准位置再播
        try { m.currentTime = local; } catch {}
        m._sync = now;
        m.play().catch(() => {});
      } else if (!m.seeking && Math.abs(m.currentTime - local) > 0.5 && now - (m._sync || 0) > 1500) {
        // 播着：偏差大了才校正一次，不要每帧都定位（定位太频繁视频会卡住不动）
        try { m.currentTime = local; } catch {}
        m._sync = now;
      }
    }
  }
  placeBox();
}
video.addEventListener('pause', () => updateStickers());
video.addEventListener('play', () => updateStickers());

/* ---------- 选中框和悬浮菜单 ---------- */
const stkMenu = $('#stk-menu');
function placeBox() {
  const s = S.selStk && getStk(S.selStk);
  const el = s && stkEls.get(s.id);
  if (!s || !el || el.style.display === 'none' || S.cropping) { stkBox.hidden = true; stkMenu.hidden = true; return; }
  stkBox.hidden = false;
  Object.assign(stkBox.style, { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height, transform: el.style.transform, borderRadius: el.style.borderRadius });
  const locked = trackOf(s) && trackOf(s).locked;
  stkBox.classList.toggle('locked', !!locked);
  stkBox.classList.toggle('tier', isTier(s));
  // 菜单放在选中框外接矩形的上方，太靠上就放下方
  stkMenu.hidden = false;
  const k = stageScale();
  const d = dispSize(s);
  const a = ((s.rot || 0) * Math.PI) / 180;
  const bh = (Math.abs(d.w * Math.sin(a)) + Math.abs(d.h * Math.cos(a))) * k;
  const cx = s.x * k, cy = s.y * k;
  const mh = stkMenu.offsetHeight || 34, mw = stkMenu.offsetWidth || 260;
  let top = cy - bh / 2 - mh - 14;
  if (top < 4) top = Math.min(stage.clientHeight - mh - 4, cy + bh / 2 + 14);
  stkMenu.style.top = top + 'px';
  stkMenu.style.left = Math.min(Math.max(4, cx - mw / 2), stage.clientWidth - mw - 4) + 'px';
  stkMenu.querySelector('[data-m="sound"]').hidden = s.type !== 'video';
  stkMenu.querySelector('[data-m="edit"]').hidden = s.type !== 'text';
  stkMenu.querySelector('[data-m="crop"]').hidden = s.type === 'text' || isTier(s);
  stkMenu.querySelector('[data-m="circle"]').hidden = s.type === 'text' || isTier(s);
  stkMenu.querySelector('[data-m="rot"]').hidden = isTier(s);
  stkMenu.querySelector('[data-m="flip"]').hidden = isTier(s);
  stkMenu.querySelector('[data-m="sound"]').textContent = s.sound ? '🔊' : '🔇';
  stkMenu.querySelector('[data-m="tier"]').hidden = s.type === 'video' || s.type === 'text';
  stkMenu.querySelector('[data-m="tier"]').classList.toggle('on', isTier(s));
  stkMenu.querySelector('[data-m="circle"]').classList.toggle('on', s.shape === 'circle');
}
stkMenu.addEventListener('mousedown', e => e.stopPropagation());
stkMenu.addEventListener('click', e => {
  const b = e.target.closest('[data-m]');
  const s = S.selStk && getStk(S.selStk);
  if (!b || !s) return;
  b.blur();
  if (lockedMsg(s)) return;
  const m = b.dataset.m;
  if (m === 'edit') { switchTab('stk'); const t = $('#txt-text'); t.focus(); t.select(); return; }
  if (m === 'tier') return isTier(s) ? tierToNormal(s) : tierMake(s);
  if (m === 'crop') return cropStart(s);
  if (m === 'rot') return editStk(x => { x.rot = norm180((x.rot || 0) + 90); }, true);
  if (m === 'flip') return editStk(x => { x.flip = !x.flip; }, true);
  if (m === 'circle') return editStk(x => {
    if (x.shape === 'circle') { x.shape = 'rect'; return; }
    // 变圆形：先裁成正方形（取中间）
    squareCrop(x);
    x.shape = 'circle';
  }, true);
  if (m === 'sound') return toggleSound(s);
  if (m === 'del') return deleteSelectedStk();
});
const norm180 = d => { d = ((d % 360) + 360) % 360; return d > 180 ? d - 360 : d; };
function lockedMsg(s) {
  const t = trackOf(s);
  if (t && t.locked) { toast('这条轨道锁住了，点轨道头的锁可以解锁', true); return true; }
  return false;
}
// 当前裁切区域里取中间最大的正方形
function squareCrop(x) {
  const c = { ...cropOf(x) };
  const pw = c.w * x.w, ph = c.h * x.h, side = Math.min(pw, ph);
  c.x += (pw - side) / 2 / x.w; c.y += (ph - side) / 2 / x.h;
  c.w = side / x.w; c.h = side / x.h;
  x.crop = c;
}

/* ---------- 预览里拖动、缩放、旋转 ---------- */
stage.addEventListener('mousedown', e => {
  if (!S.project || e.button !== 0) return;
  // 裁切模式：裁切框和比例条自己处理；点到框外面＝完成裁切
  if (S.cropping) { if (!e.target.closest('#crop-box, #crop-bar')) cropDone(); return; }
  const hd = e.target.closest('.hd');
  const rh = e.target.closest('.rot-hd');
  const el = e.target.closest('.stk');
  if (!hd && !rh && !el) { selectStk(null); return; }
  e.preventDefault();
  video.pause();
  const s = (hd || rh) ? getStk(S.selStk) : getStk(el.dataset.id);
  if (!s) return;
  if (s.id !== S.selStk) selectStk(s.id);
  if (trackOf(s) && trackOf(s).locked) return;
  const k = stageScale();
  const { w: W, h: H } = S.project.canvas;
  const rect = stage.getBoundingClientRect();
  const o = { x: s.x, y: s.y, scale: s.scale, rot: s.rot || 0 };
  const cx = rect.left + s.x * k, cy = rect.top + s.y * k;
  const d0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
  const a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
  const snap = snapshot();
  let moved = false;
  const gv = $('#guide-v'), gh = $('#guide-h');
  const move = ev => {
    moved = true;
    if (rh) {
      // 旋转：靠近0°、90°、180°、270°会吸住；按住Shift每15°一档
      let deg = o.rot + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      else { const near = Math.round(deg / 90) * 90; if (Math.abs(deg - near) < 4) deg = near; }
      s.rot = Math.round(norm180(deg) * 10) / 10;
    } else if (hd) {
      const d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
      s.scale = Math.max(20 / Math.max(1, s.w * cropOf(s).w), o.scale * d / d0);
    } else {
      let x = o.x + (ev.clientX - e.clientX) / k;
      let y = o.y + (ev.clientY - e.clientY) / k;
      const dd = dispSize(s), hw = dd.w / 2, hh = dd.h / 2;
      const th = SNAP_PX / k;
      let sv = false, sh = false;
      if (!ev.metaKey) {
        if (Math.abs(x - W / 2) < th) { x = W / 2; sv = true; }
        else if (!s.rot && Math.abs(x - hw) < th) x = hw;
        else if (!s.rot && Math.abs(x + hw - W) < th) x = W - hw;
        if (Math.abs(y - H / 2) < th) { y = H / 2; sh = true; }
        else if (!s.rot && Math.abs(y - hh) < th) y = hh;
        else if (!s.rot && Math.abs(y + hh - H) < th) y = H - hh;
      }
      gv.hidden = !sv; gh.hidden = !sh;
      s.x = x; s.y = y;
    }
    layoutStickers();
    syncStkPanel();
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    gv.hidden = true; gh.hidden = true;
    if (moved && (s.x !== o.x || s.y !== o.y || s.scale !== o.scale || (s.rot || 0) !== o.rot)) { pushUndo(snap); saveSoon(); }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});
// 双击预览里的文本：直接改字（图片、视频双击不做别的，裁切只能点“裁切”按钮进入）
stage.addEventListener('dblclick', e => {
  const el = e.target.closest('.stk');
  const s = el && getStk(el.dataset.id);
  if (isText(s) && !S.cropping) { switchTab('stk'); const t = $('#txt-text'); t.focus(); t.select(); }
});

/* ---------- 裁切模式 ---------- */
const cropBox = $('#crop-box'), cropBar = $('#crop-bar');
const RATIOS = { free: null, orig: 'orig', '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, '3:4': 3 / 4, circle: 1 };
function cropStart(s) {
  if (isText(s)) return;
  if (S.cropping) cropCancel();
  video.pause();
  // 裁切框在“看到的画面”上选：翻转过的素材，框的左右也要翻过来
  const c0 = cropOf(s);
  const c = s.flip ? { ...c0, x: 1 - c0.x - c0.w } : { ...c0 };
  const fw = s.w * s.scale, fh = s.h * s.scale;
  // 整张原图在成片上的位置：让现在裁出来的那块保持在原位
  const full = { x: s.x - (c.x + c.w / 2) * fw, y: s.y - (c.y + c.h / 2) * fh, w: fw, h: fh };
  S.cropping = { id: s.id, full, crop: { ...c }, ratio: s.shape === 'circle' ? 'circle' : 'free', snap: snapshot(), rot: s.rot || 0 };
  if (S.t < s.start || S.t >= s.end) setTime(s.start);
  cropBar.hidden = false;
  cropBox.hidden = false;
  syncCropBar();
  layoutStickers();
  updateStickers(true);
  placeCropBox();
}
function placeCropBox() {
  const C = S.cropping;
  if (!C) return;
  const k = stageScale(), f = C.full, c = C.crop;
  Object.assign(cropBox.style, {
    left: (f.x + c.x * f.w) * k + 'px', top: (f.y + c.y * f.h) * k + 'px',
    width: c.w * f.w * k + 'px', height: c.h * f.h * k + 'px',
    borderRadius: C.ratio === 'circle' ? '50%' : '0',
  });
}
function syncCropBar() {
  cropBar.querySelectorAll('[data-r]').forEach(b => b.classList.toggle('on', b.dataset.r === S.cropping.ratio));
}
// 选比例：在原图里取这个比例最大的框，尽量以现在框的中心为中心
function setRatio(key) {
  const C = S.cropping, s = getStk(C.id);
  C.ratio = key;
  const r = key === 'orig' ? s.w / s.h : RATIOS[key];
  if (r) {
    const c = C.crop;
    const pcx = (c.x + c.w / 2) * s.w, pcy = (c.y + c.h / 2) * s.h; // 原图像素
    let w = s.w, h = w / r;
    if (h > s.h) { h = s.h; w = h * r; }
    let x = Math.min(Math.max(0, pcx - w / 2), s.w - w), y = Math.min(Math.max(0, pcy - h / 2), s.h - h);
    C.crop = { x: x / s.w, y: y / s.h, w: w / s.w, h: h / s.h };
  }
  syncCropBar();
  placeCropBox();
}
cropBar.addEventListener('mousedown', e => e.stopPropagation());
cropBar.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !S.cropping) return;
  b.blur();
  if (b.dataset.r) return setRatio(b.dataset.r);
  if (b.dataset.c === 'reset') { S.cropping.crop = { ...FULL }; S.cropping.ratio = 'free'; syncCropBar(); placeCropBox(); return; }
  if (b.dataset.c === 'cancel') return cropCancel();
  if (b.dataset.c === 'ok') return cropDone();
});
// 拖动裁切框：中间移动，四角和四边调大小；选了比例时按比例
cropBox.addEventListener('mousedown', e => {
  if (!S.cropping || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const C = S.cropping, s = getStk(C.id);
  const k = stageScale();
  const ed = e.target.dataset.e || 'move';
  const o = { ...C.crop };
  const x0 = e.clientX, y0 = e.clientY;
  const r = C.ratio === 'free' ? null : C.ratio === 'orig' ? s.w / s.h : RATIOS[C.ratio];
  const MINW = 16 / s.w, MINH = 16 / s.h;
  const move = ev => {
    const dx = (ev.clientX - x0) / k / C.full.w, dy = (ev.clientY - y0) / k / C.full.h; // 占原图比例
    let { x, y, w, h } = o;
    if (ed === 'move') {
      x = Math.min(Math.max(0, o.x + dx), 1 - o.w);
      y = Math.min(Math.max(0, o.y + dy), 1 - o.h);
    } else {
      let L = o.x, T = o.y, R = o.x + o.w, B = o.y + o.h;
      if (ed.includes('w')) L = Math.min(Math.max(0, o.x + dx), R - MINW);
      if (ed.includes('e')) R = Math.max(Math.min(1, R + dx), L + MINW);
      if (ed.includes('n')) T = Math.min(Math.max(0, o.y + dy), B - MINH);
      if (ed.includes('s')) B = Math.max(Math.min(1, B + dy), T + MINH);
      x = L; y = T; w = R - L; h = B - T;
      if (r) {
        // 按比例：以拖动的那条边为准，另一边跟着变；超出原图就缩回来
        const ar = r * s.h / s.w; // 比例换算成“占原图比例”的宽高比
        const horiz = ed === 'e' || ed === 'w' || (ed.length === 2 && Math.abs(dx) >= Math.abs(dy) * ar);
        if (horiz) h = w / ar; else w = h * ar;
        if (ed.includes('n')) y = B - h;
        if (ed.includes('w')) x = R - w;
        if (ed === 'e' || ed === 'w') y = o.y + (o.h - h) / 2;
        if (ed === 'n' || ed === 's') x = o.x + (o.w - w) / 2;
        if (x < 0 || y < 0 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9) return;
      }
    }
    C.crop = { x, y, w, h };
    placeCropBox();
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});
function cropDone() {
  const C = S.cropping;
  if (!C) return;
  const s = getStk(C.id);
  const c = C.crop;
  const full = c.x < 1e-4 && c.y < 1e-4 && c.w > 0.9999 && c.h > 0.9999;
  s.crop = full ? undefined : { ...c };
  // 裁出来的那块保持在原位
  s.x = C.full.x + (c.x + c.w / 2) * C.full.w;
  s.y = C.full.y + (c.y + c.h / 2) * C.full.h;
  if (C.ratio === 'circle') s.shape = 'circle';
  else if (s.shape === 'circle') s.shape = 'rect';
  if (s.flip && s.crop) s.crop.x = 1 - s.crop.x - s.crop.w; // 裁切框是在翻转后的画面上选的
  S.cropping = null;
  cropBar.hidden = true; cropBox.hidden = true;
  pushUndo(C.snap);
  saveSoon();
  layoutStickers();
  updateStickers(true);
  syncStkPanel();
  toast('✓ 已裁切', false, 1000);
}
function cropCancel() {
  if (!S.cropping) return;
  S.cropping = null;
  cropBar.hidden = true; cropBox.hidden = true;
  layoutStickers();
  updateStickers(true);
}
document.addEventListener('keydown', e => {
  if (!S.cropping) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cropCancel(); }
  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); cropDone(); }
}, true);

/* ---------- 声音（视频素材） ---------- */
async function toggleSound(s) {
  if (s.type !== 'video') return;
  if (!s.sound && s.hasAudio === undefined) {
    try { const info = await window.api.probe(S.dir + '/assets/' + s.file); s.hasAudio = !!info.audioCodec; } catch { s.hasAudio = false; }
  }
  if (!s.sound && !s.hasAudio) return toast('这个视频本身没有声音', true);
  editStk(x => { x.sound = !x.sound; if (x.volume === undefined) x.volume = 1; }, true);
  syncPreviewEls();
  renderStickers();
  toast(s.sound ? '已打开这个视频的声音' : '已静音', false, 1200);
}

/* ---------- 右侧面板 ---------- */
function syncStkPanel() {
  const s = S.selStk && getStk(S.selStk);
  $('#stk-empty').hidden = !!s;
  $('#stk-props').hidden = !s;
  if (!s) return;
  const { w: W, h: H } = S.project.canvas;
  const d = dispSize(s);
  const pct = Math.round((d.w * 100) / W);
  $('#stk-name').textContent = s.type === 'text' ? '文本' : (s.type === 'video' ? '视频：' : s.type === 'gif' ? 'GIF：' : '图片：') + s.name;
  syncTxtPanel();
  syncTierPanel();
  $('#stk-size').value = Math.min(150, pct);
  $('#v-stk-size').textContent = pct + '%';
  if (document.activeElement !== $('#stk-x')) $('#stk-x').value = Math.round(s.x - W / 2);
  if (document.activeElement !== $('#stk-y')) $('#stk-y').value = Math.round(s.y - H / 2);
  $('#stk-rot').value = s.rot || 0;
  if (document.activeElement !== $('#stk-rot-n')) $('#stk-rot-n').value = s.rot || 0;
  const shape = s.shape === 'circle' ? 'circle' : s.radius ? 'round' : 'rect';
  document.querySelectorAll('#stk-shape button').forEach(b => b.classList.toggle('on', b.dataset.v === shape));
  $('#stk-radius-row').hidden = shape !== 'round';
  $('#stk-radius').value = s.radius || 0;
  $('#v-stk-radius').textContent = (s.radius || 0) + '%';
  $('#v-stk-crop').textContent = s.crop ? `已裁切（保留${Math.round(s.crop.w * 100)}%×${Math.round(s.crop.h * 100)}%）` : '未裁切';
  $('#stk-sound-box').hidden = s.type !== 'video';
  if (s.type === 'video') {
    $('#stk-sound').checked = !!s.sound;
    $('#stk-vol').value = Math.round((s.volume ?? 1) * 100);
    $('#v-stk-vol').textContent = Math.round((s.volume ?? 1) * 100) + '%';
    $('#stk-vol-row').classList.toggle('off', !s.sound);
  }
  $('#v-stk-time').textContent = `${fmt(s.start)} – ${fmt(s.end)}`;
  $('#v-stk-layer').textContent = `第${(s.layer || 0) + 1}条轨道`;
}

let stkPending = null;
function editStk(fn, commit) {
  const s = S.selStk && getStk(S.selStk);
  if (!s) return;
  if (!stkPending) stkPending = snapshot();
  fn(s);
  if (commit) { pushUndo(stkPending); stkPending = null; saveSoon(); }
  layoutStickers();
  renderStickersSoon();
  syncStkPanel();
}
let rsTimer;
function renderStickersSoon() { clearTimeout(rsTimer); rsTimer = setTimeout(renderStickers, 50); }

const sizeTo = (s, v) => { s.scale = (v / 100) * S.project.canvas.w / (s.w * cropOf(s).w); };
$('#stk-size').oninput = e => editStk(s => sizeTo(s, Number(e.target.value)), false);
$('#stk-size').onchange = e => editStk(s => sizeTo(s, Number(e.target.value)), true);
$('#stk-x').onchange = e => editStk(s => { s.x = S.project.canvas.w / 2 + Number(e.target.value || 0); }, true);
$('#stk-y').onchange = e => editStk(s => { s.y = S.project.canvas.h / 2 + Number(e.target.value || 0); }, true);
$('#stk-rot').oninput = e => editStk(s => { s.rot = Number(e.target.value); }, false);
$('#stk-rot').onchange = e => editStk(s => { s.rot = Number(e.target.value); }, true);
$('#stk-rot-n').onchange = e => editStk(s => { s.rot = norm180(Number(e.target.value) || 0); }, true);
$('#stk-radius').oninput = e => editStk(s => { s.radius = Number(e.target.value); }, false);
$('#stk-radius').onchange = e => editStk(s => { s.radius = Number(e.target.value); }, true);
document.querySelectorAll('#stk-shape button').forEach(b => {
  b.onclick = () => editStk(s => {
    if (b.dataset.v === 'circle') { if (s.shape !== 'circle') squareCrop(s); s.shape = 'circle'; }
    else { s.shape = 'rect'; s.radius = b.dataset.v === 'round' ? (s.radius || 12) : 0; }
  }, true);
});
$('#stk-sound').onchange = () => { const s = getStk(S.selStk); if (s && !!s.sound !== $('#stk-sound').checked) toggleSound(s); };
$('#stk-vol').oninput = e => { editStk(s => { s.volume = Number(e.target.value) / 100; }, false); syncPreviewEls(); };
$('#stk-vol').onchange = e => { editStk(s => { s.volume = Number(e.target.value) / 100; }, true); syncPreviewEls(); };

document.querySelectorAll('#stk-props [data-act]').forEach(b => {
  b.onclick = () => {
    const act = b.dataset.act;
    const s = getStk(S.selStk);
    if (!s) return;
    const { w: W, h: H } = S.project.canvas;
    if (act === 'delete') { deleteSelectedStk(); return; }
    if (lockedMsg(s)) return;
    if (act === 'crop') return cropStart(s);
    if (act === 'uncrop') return editStk(x => { x.crop = undefined; if (x.shape === 'circle') x.shape = 'rect'; }, true);
    if (act === 'flip') return editStk(x => { x.flip = !x.flip; }, true);
    if (act === 'rot0') return editStk(x => { x.rot = 0; }, true);
    editStk(x => {
      const d = dispSize(x);
      if (act === 'center') { x.x = W / 2; x.y = H / 2; }
      if (act === 'hcenter') x.x = W / 2;
      if (act === 'vcenter') x.y = H / 2;
      if (act === 'fit') { x.scale = Math.min((W * 0.6) / (d.w / x.scale), (H * 0.45) / (d.h / x.scale), 3); x.x = W / 2; x.y = H / 2; }
      if (act === 'orig') x.scale = 1;
      if (act === 'fill') { x.scale = H / (d.h / x.scale); x.y = H / 2; }
      const idx = trackIdx(x.track), n = tracks().length;
      if (act === 'up') moveToTrack(x, idx + 1, idx + 1 >= n);
      if (act === 'down') moveToTrack(x, idx > 0 ? idx - 1 : 0, idx === 0);
      // 置顶／置底：最上（最下）那条放得下就放进去，放不下就新建一条
      if (act === 'top' && idx !== n - 1) { const t = tracks()[n - 1]; moveToTrack(x, trackFree(t, x) && !t.locked ? n - 1 : n, !(trackFree(t, x) && !t.locked)); }
      if (act === 'bottom' && idx !== 0) { const t = tracks()[0]; moveToTrack(x, 0, !(trackFree(t, x) && !t.locked)); }
      if (act === 'tosub') {
        const sub = subAt(S.t);
        if (!sub) { toast('播放头不在任何一句字幕上'); return; }
        x.start = sub.start; x.end = sub.end;
      }
      if (act === 'fromhead') {
        const len = x.end - x.start;
        x.start = S.t; x.end = x.type === 'video' ? S.t + len : Math.min(duration(), S.t + len); // 视频保留完整长度
      }
    }, true);
    if (['tosub', 'fromhead', 'up', 'down', 'top', 'bottom'].includes(act)) { renderStickers(); updateStickers(); syncStkPanel(); }
  };
});

/* ---------- 封面、导出共用：在canvas上按裁切／旋转／形状画一个表情包 ---------- */
function stkClipPath(ctx, s, w, h) {
  ctx.beginPath();
  if (s.shape === 'circle') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else { const r = shapeRadius(s, w, h); if (r > 0) ctx.roundRect(-w / 2, -h / 2, w, h, r); else ctx.rect(-w / 2, -h / 2, w, h); }
}
function drawStkCanvas(ctx, s, media) {
  const d = dispSize(s), c = cropOf(s);
  const nw = media.videoWidth || media.naturalWidth || s.w, nh = media.videoHeight || media.naturalHeight || s.h;
  ctx.save();
  ctx.translate(s.x, s.y);
  if (s.rot) ctx.rotate((s.rot * Math.PI) / 180);
  stkClipPath(ctx, s, d.w, d.h);
  ctx.clip();
  if (s.flip) ctx.scale(-1, 1);
  try { ctx.drawImage(media, c.x * nw, c.y * nh, c.w * nw, c.h * nh, -d.w / 2, -d.h / 2, d.w, d.h); } catch {}
  ctx.restore();
}
// 圆形／圆角的遮罩：黑底白形状，和导出时缩放后的尺寸一样
function stkMaskPNG(s) {
  if (s.shape !== 'circle' && !(s.radius > 0)) return null;
  const d = dispSize(s);
  const w = evenPx(d.w), h = evenPx(d.h);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  stkClipPath(ctx, s, w, h);
  ctx.fillStyle = '#fff'; ctx.fill();
  return new Promise(r => cv.toBlob(b => b.arrayBuffer().then(a => r(new Uint8Array(a))), 'image/png'));
}

// 背景：背景段放在数字轨道上（和视频、表情包同一套轨道），预览实时绘制，导出前生成无缝循环视频
const bgCv = $('#bg-cv');
S.selBg = null;
loadSubFont('noto-black').then(() => { drawBgPreview(true); drawBgPresets(); });

const getBg = id => S.project.backgrounds.find(b => b.id === id);
const bgLabel = b => (b.type === 'solid' ? `纯色 ${b.color}` : b.type === 'text' ? `滚动文字：${b.text}` : BG_TYPES[b.type]);
// 播放头这里看得见的背景：好几条轨道上都有时，取最上面那条（背景是整幅画面，下面的反正被盖住）
function bgAt(t) {
  if (!S.project) return null;
  let best = null;
  for (const b of S.project.backgrounds) {
    if (t < b.start - 1e-6 || t >= b.end - 1e-6) continue;
    const tr = window.trackOf && trackOf(b);
    if (tr && tr.hidden) continue;
    if (!best || (b.layer || 0) > (best.layer || 0)) best = b;
  }
  return best;
}

/* ---------- 预览 ---------- */
function sizeBgCanvas(w, h) {
  const dpr = window.devicePixelRatio || 1;
  bgCv.width = Math.round(w * dpr);
  bgCv.height = Math.round(h * dpr);
  drawBgPreview(true);
}
let bgLastKey = '';
function drawBgPreview(force) {
  if (!S.project) return;
  const seg = bgAt(S.t);
  const moving = seg && seg.type !== 'solid';
  const key = seg ? seg.id + JSON.stringify(seg) : 'none';
  if (!force && !moving && key === bgLastKey) return; // 静止的背景不用每帧重画
  bgLastKey = key;
  const ctx = bgCv.getContext('2d');
  const { w: W, h: H } = S.project.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bgCv.width, bgCv.height);
  if (!seg) return;
  bgCv.style.zIndex = (seg.layer || 0) * 1000; // 按轨道顺序叠
  ctx.setTransform(bgCv.width / W, 0, 0, bgCv.height / H, 0, 0);
  drawBackground(ctx, seg, S.t - seg.start, W, H);
}
function updateBg() { drawBgPreview(false); }

/* ---------- 时间轴：背景段画在数字轨道上（stickers.js统一画） ---------- */
function renderBgs() { if (S.project && window.renderStickers) renderStickers(); }

function selectBg(id) {
  S.selBg = id;
  if (id) {
    if (S.selSub) selectSub(null);
    if (S.selStk) selectStk(null);
    switchTab('bg');
  }
  rowStk.querySelectorAll('.clip.bgc').forEach(el => el.classList.toggle('selected', el.dataset.id === id));
  syncBgPanel();
}
function deleteSelectedBg() {
  const i = S.project.backgrounds.findIndex(b => b.id === S.selBg);
  if (i < 0) return false;
  const tr = trackOf(S.project.backgrounds[i]);
  if (tr && tr.locked) { toast('这条轨道锁住了，先解锁再删除', true); return true; }
  pushUndo(snapshot());
  S.project.backgrounds.splice(i, 1);
  S.selBg = null;
  bgChanged();
  return true;
}
function bgChanged() {
  S.project.backgrounds.sort((a, b) => a.start - b.start);
  renderBgs();
  syncBgPanel();
  drawBgPreview(true);
  saveSoon();
}

/* ---------- 右侧面板 ---------- */
/* ---------- 素材面板：内置背景＋我的背景 ---------- */
// 我的背景存在设置里，所有项目通用：[{name, bg}]
let MY_BGS = [];
window.api.settingsGet().then(st => { MY_BGS = Array.isArray(st.myBgs) ? st.myBgs : []; drawBgPresets(); fillStartBg(); });
const saveMyBgs = () => { window.api.settingsSet({ myBgs: MY_BGS }); fillStartBg(); };
const cleanBg = b => { const o = JSON.parse(JSON.stringify(b)); delete o.id; delete o.start; delete o.end; return o; };

function bgThumb(d, bg) {
  const c = S.project ? S.project.canvas : { w: 1920, h: 1080 };
  const cv = d.querySelector('canvas');
  const scale = 240 / c.w;
  cv.width = 240; cv.height = Math.round(c.h * scale);
  const ctx = cv.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawBackground(ctx, bg, 0.7, c.w, c.h);
}
function bgTile2(name, bg, onApply) {
  const d = document.createElement('div');
  d.className = 'bg-pre';
  d.innerHTML = '<canvas></canvas><span></span>';
  d.querySelector('span').textContent = name;
  d.onclick = onApply;
  bgThumb(d, bg);
  return d;
}
function drawBgPresets() {
  const box = $('#bg-presets'), mine = $('#bg-mine');
  const c = S.project ? S.project.canvas : { w: 1920, h: 1080 };
  const cols = c.h > c.w ? 'repeat(3, 1fr)' : '1fr 1fr';
  box.style.gridTemplateColumns = mine.style.gridTemplateColumns = cols;
  box.replaceChildren(...BG_PRESETS.map(p => bgTile2(p.name, p.bg, () => applyPreset(p.bg))));
  mine.replaceChildren(...MY_BGS.map((p, k) => {
    const d = bgTile2(p.name, p.bg, () => applyPreset(p.bg));
    const x = document.createElement('button');
    x.className = 'bg-del';
    x.title = '删除这个背景';
    x.textContent = '×';
    x.onclick = e => {
      e.stopPropagation();
      if (x.classList.contains('sure')) { MY_BGS.splice(k, 1); saveMyBgs(); drawBgPresets(); toast('已删除'); }
      else { x.classList.add('sure'); x.textContent = '删除？'; setTimeout(() => { x.classList.remove('sure'); x.textContent = '×'; }, 2500); }
    };
    d.appendChild(x);
    // 双击名字改名
    const sp = d.querySelector('span');
    sp.title = '双击改名';
    sp.ondblclick = e => {
      e.stopPropagation();
      const inp = document.createElement('input');
      inp.className = 'bg-rename';
      inp.value = p.name;
      sp.replaceWith(inp);
      inp.focus(); inp.select();
      const done = ok => { if (ok && inp.value.trim()) { p.name = inp.value.trim(); saveMyBgs(); } drawBgPresets(); };
      inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
      inp.onblur = () => done(true);
      inp.onclick = ev => ev.stopPropagation();
    };
    return d;
  }));
  $('#bg-mine-empty').hidden = MY_BGS.length > 0;
}
$('#bg-save-my').onclick = () => {
  // 选中了哪段就存哪段；没选中就存播放头所在的那段
  const b = (S.selBg && getBg(S.selBg)) || (S.project && bgAt(S.t));
  if (!b) return toast('播放头这里没有背景，先加一段背景再存', true);
  const base = b.type === 'text' ? (b.text || '滚动文字') : BG_TYPES[b.type];
  let n = 1;
  while (MY_BGS.some(m => m.name === `${base} ${n}`)) n++;
  MY_BGS.push({ name: `${base} ${n}`, bg: cleanBg(b) });
  saveMyBgs();
  drawBgPresets();
  toast(`✓ 已存为“${base} ${n}”，所有项目都能用，双击名字可以改名`);
};

// 开始页的背景下拉框：内置＋我的背景
function fillStartBg() {
  const sel = $('#start-bg');
  let v = '';
  try { v = localStorage.getItem('tietu-start-bg') || ''; } catch {}
  if (/^\d+$/.test(v)) v = 'b:' + v; // 兼容旧的存法
  sel.replaceChildren();
  const g1 = document.createElement('optgroup'); g1.label = '内置';
  BG_PRESETS.forEach((p, i) => g1.appendChild(new Option(p.name, 'b:' + i)));
  sel.appendChild(g1);
  if (MY_BGS.length) {
    const g2 = document.createElement('optgroup'); g2.label = '我的背景';
    MY_BGS.forEach((p, i) => g2.appendChild(new Option(p.name, 'm:' + i)));
    sel.appendChild(g2);
  }
  sel.value = v;
  if (!sel.value) sel.value = 'b:0';
}
fillStartBg();
function startBgChoice() {
  const [t, i] = ($('#start-bg').value || 'b:0').split(':');
  const p = (t === 'm' ? MY_BGS : BG_PRESETS)[Number(i)] || BG_PRESETS[0];
  return JSON.parse(JSON.stringify(p.bg));
}

function applyPreset(bgIn) {
  if (!S.project) return;
  const preset = JSON.parse(JSON.stringify(bgIn));
  pushUndo(snapshot());
  const sel = S.selBg && getBg(S.selBg);
  if (sel) {
    for (const key of Object.keys(sel)) if (!['id', 'start', 'end'].includes(key)) delete sel[key];
    Object.assign(sel, preset);
  } else {
    // 从播放头开始，填到同一条轨道上的下一段背景或片尾；放在已有背景的那条轨道上，没有就在最下面新建一条
    const all = S.project.backgrounds;
    const cur = bgAt(S.t);
    let trackId = cur ? cur.track : (all[0] && all[0].track);
    if (!trackId || !tracks().some(t => t.id === trackId)) { const nt = newTrack(); nt.h = 30; tracks().unshift(nt); trackId = nt.id; }
    const list = all.filter(b => b.track === trackId);
    let start = S.t, end = duration();
    const next = list.filter(b => b.start > S.t + 1e-6).sort((a, b) => a.start - b.start)[0];
    if (next) end = next.start;
    const here = list.find(b => S.t >= b.start - 1e-6 && S.t < b.end - 1e-6);
    if (here) here.end = S.t;
    if (!list.length) start = 0;
    const nb = { id: 'g' + Date.now().toString(36), start, end, track: trackId, ...preset };
    all.push(nb);
    S.project.backgrounds = all.filter(b => b.end - b.start > 0.05);
    // 这条轨道上有表情包挡着：背景换到新的一条
    if (!trackFree(trackOf(nb), nb)) moveToTrack(nb, trackIdx(nb.track), true);
    S.selBg = nb.id;
  }
  bgChanged();
  selectBg(S.selBg);
}

// 每种背景能调的参数
const BG_FIELDS = {
  solid: [['color', '颜色', 'color']],
  text: [['text', '文字', 'text'], ['color', '文字颜色', 'color'], ['bgColor', '底色', 'color'], ['opacity', '文字透明度', 'range', 0.03, 1, 0.01], ['size', '字号', 'range', 30, 240, 1], ['tilt', '倾斜角度', 'range', -45, 45, 1], ['dir', '滚动方向', 'dir'], ['speed', '速度', 'speed']],
  grid: [['color', '线条颜色', 'color'], ['bgColor', '底色', 'color'], ['opacity', '线条透明度', 'range', 0.03, 1, 0.01], ['cell', '格子大小', 'range', 20, 240, 1], ['line', '线条粗细', 'range', 0.5, 6, 0.5], ['dir', '移动方向', 'dir'], ['speed', '速度', 'speed']],
  dots: [['color', '点的颜色', 'color'], ['bgColor', '底色', 'color'], ['opacity', '透明度', 'range', 0.05, 1, 0.01], ['gap', '间距', 'range', 12, 160, 1], ['radius', '点的大小', 'range', 0.5, 12, 0.1], ['wave', '波浪起伏', 'range', 0, 60, 1], ['dir', '移动方向', 'dir'], ['speed', '速度', 'speed']],
  cross: [['color', '符号颜色', 'color'], ['bgColor', '底色', 'color'], ['opacity', '透明度', 'range', 0.05, 1, 0.01], ['gap', '间距', 'range', 20, 200, 1], ['radius', '符号大小', 'range', 2, 40, 1], ['wave', '波浪起伏', 'range', 0, 60, 1], ['dir', '移动方向', 'dir'], ['speed', '速度', 'speed']],
};

let bgPending = null;
function editBg(fn, commit) {
  const b = S.selBg && getBg(S.selBg);
  if (!b) return;
  if (!bgPending) bgPending = snapshot();
  fn(b);
  if (commit) { pushUndo(bgPending); bgPending = null; saveSoon(); renderBgs(); }
  drawBgPreview(true);
}

function syncBgPanel() {
  const b = S.selBg && S.project && getBg(S.selBg);
  $('#bg-props').hidden = !b;
  $('#bg-hint').hidden = !!b;
  if (!b) return;
  $('#v-bg-time').textContent = `${fmt(b.start)} – ${fmt(b.end)}`;
  const box = $('#bg-fields');
  box.replaceChildren();
  if (b.type === 'tier') return renderTierEditor(box, b); // 从夯到拉表格有自己的编辑面板（tier.js）
  for (const [key, label, kind, min, max, step] of BG_FIELDS[b.type] || []) {
    const lab = document.createElement('div');
    lab.className = 'f-label';
    lab.innerHTML = `${label} <b></b>`;
    const val = lab.querySelector('b');
    box.appendChild(lab);
    let input;
    if (kind === 'text') {
      input = document.createElement('input');
      input.type = 'text';
      input.value = b[key];
      input.oninput = () => editBg(x => { x[key] = input.value; }, false);
      input.onchange = () => editBg(x => { x[key] = input.value; }, true);
    } else if (kind === 'color') {
      input = document.createElement('div');
      input.className = 'color-row';
      input.innerHTML = '<input type="color"><span></span>';
      const c = input.querySelector('input');
      c.value = b[key].toLowerCase();
      input.querySelector('span').textContent = b[key];
      c.oninput = () => { input.querySelector('span').textContent = c.value.toUpperCase(); editBg(x => { x[key] = c.value.toUpperCase(); }, false); };
      c.onchange = () => editBg(x => { x[key] = c.value.toUpperCase(); }, true);
    } else if (kind === 'speed') {
      // 四档速度，点一下就换
      input = document.createElement('div');
      input.className = 'seg spd';
      const cur = bgSnapSpeed(b[key]);
      for (const [v, name] of BG_SPEEDS) {
        const bt = document.createElement('button');
        bt.textContent = name;
        bt.title = `每秒${v}像素`;
        bt.classList.toggle('on', v === cur);
        bt.onclick = () => {
          input.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === bt));
          editBg(x => { x[key] = v; }, true);
        };
        input.appendChild(bt);
      }
    } else if (kind === 'dir') {
      input = document.createElement('select');
      for (const [k, d] of Object.entries(BG_DIRS)) input.add(new Option(d[2], k));
      input.value = b[key];
      input.onchange = () => editBg(x => { x[key] = input.value; }, true);
    } else {
      input = document.createElement('input');
      input.type = 'range';
      Object.assign(input, { min, max, step });
      input.value = b[key];
      const show = v => {
        val.textContent = key === 'opacity' ? Math.round(v * 100) + '%' : key === 'tilt' ? v + '°' : String(v);
      };
      show(b[key]);
      input.oninput = () => { show(Number(input.value)); editBg(x => { x[key] = Number(input.value); }, false); };
      input.onchange = () => editBg(x => { x[key] = Number(input.value); }, true);
    }
    box.appendChild(input);
  }
}

document.querySelectorAll('[data-bgact]').forEach(btn => {
  btn.onclick = () => {
    const b = S.selBg && getBg(S.selBg);
    if (!b) return;
    const act = btn.dataset.bgact;
    if (act === 'delete') return deleteSelectedBg();
    pushUndo(snapshot());
    if (act === 'full') {
      S.project.backgrounds = [b];
      b.start = 0; b.end = duration();
    }
    if (act === 'fromhead') {
      const list = S.project.backgrounds, i = list.indexOf(b);
      const nextStart = i < list.length - 1 ? list[i + 1].start : duration();
      if (S.t < nextStart - 0.2) { if (i > 0 && list[i - 1].end > S.t) list[i - 1].end = S.t; b.start = S.t; }
    }
    bgChanged();
  };
});

/* ---------- 导出前：把每段背景生成好（同样的背景只生成一次） ---------- */
// 估算和导出可能同时要同一段背景：同一个背景同时只生成一次，其余的等它生成完直接用
const bgGenPending = new Map();
const BG_CACHE_VER = 'v3'; // 改版本号会让旧缓存（之前可能生成坏了的）作废
async function ensureBgLoops(range, onStatus) {
  const { w: W, h: H } = S.project.canvas;
  await loadSubFont('noto-black');
  // 隐藏的轨道上的背景不导出
  const segs = S.project.backgrounds.filter(b => b.end > range.start && b.start < range.end && !(trackOf(b) && trackOf(b).hidden));
  const out = [];
  const mctx = document.createElement('canvas').getContext('2d');
  for (let k = 0; k < segs.length; k++) {
    const b = segs[k];
    const L = b.type === 'solid' || b.type === 'tier' ? 0 : bgMotion(b, mctx).L;
    const key = bgKey(b, W, H) + '|L=' + L + '|' + BG_CACHE_VER;
    if (!bgGenPending.has(key)) {
      const job = genBgLoop(b, L, key, W, H, (f, n) => onStatus && onStatus(`正在生成背景 ${k + 1}/${segs.length}… ${Math.round((f / n) * 100)}%`));
      bgGenPending.set(key, job);
      job.finally(() => bgGenPending.delete(key)).catch(() => {});
    } else if (onStatus) onStatus(`正在生成背景 ${k + 1}/${segs.length}…`);
    const file = await bgGenPending.get(key);
    out.push({ file, start: b.start, end: b.end, L, layer: b.layer || 0 });
  }
  return out;
}

async function genBgLoop(b, L, key, W, H, onFrame) {
  const c = await window.api.bgCache({ dir: S.dir, key, ext: L ? 'mp4' : 'png' });
  if (c.exists) return c.file;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const toPNGb = () => new Promise(r => cv.toBlob(bl => bl.arrayBuffer().then(a => r(new Uint8Array(a))), 'image/png'));
  if (!L) {
    if (b.type === 'tier') { for (const r of b.rows) await loadSubFont(r.fontId || 'noto-black'); await document.fonts.ready; }
    drawBackground(ctx, b, 0, W, H);
    await window.api.bgStill({ file: c.file, bytes: await toPNGb() });
    return c.file;
  }
  const frames = Math.round(L * BG_FPS);
  await window.api.bgBegin({ file: c.file, fps: BG_FPS });
  try {
    for (let f = 0; f < frames; f++) {
      drawBackground(ctx, b, f / BG_FPS, W, H);
      await window.api.bgFrame({ file: c.file, bytes: await toPNGb() });
      if (f % 10 === 0) onFrame(f, frames);
    }
  } catch (e) {
    window.api.bgEnd({ file: c.file, abort: true }).catch(() => {});
    throw e;
  }
  await window.api.bgEnd({ file: c.file });
  return c.file;
}

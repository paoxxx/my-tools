// 文本：和表情包一样是轨道上的一个片段（type: 'text'），可以拖动、缩放、旋转、换轨道
// 文字先画到一张透明画布上（预览直接显示这张画布，导出时存成PNG叠上去），所以预览和成片完全一样
// 数据：s.text 文字（可以多行）；s.ts 样式（见 TEXT_DEFAULT）；s.w、s.h 是画布大小，s.scale 是缩放
const TEXT_DEFAULT = {
  fontId: 'noto-bold', size: 96, color: '#FFFFFF', bold: false, italic: false, align: 'center',
  spacing: 0, lineH: 1.25,
  stroke: 0, strokeColor: '#000000',
  bg: false, bgColor: '#000000', bgOpacity: 0.6,
  glow: 0, glowColor: '#FFE14D',
};
const TEXT_PRESETS = [
  { name: '白字', ts: { color: '#FFFFFF', stroke: 0, bg: false, glow: 0 } },
  { name: '白字黑边', ts: { color: '#FFFFFF', stroke: 8, strokeColor: '#000000', bg: false, glow: 0 } },
  { name: '黄字黑边', ts: { color: '#FFE14D', stroke: 8, strokeColor: '#000000', bg: false, glow: 0 } },
  { name: '红字白边', ts: { color: '#FF3B3B', stroke: 8, strokeColor: '#FFFFFF', bg: false, glow: 0 } },
  { name: '黑字白边', ts: { color: '#141414', stroke: 8, strokeColor: '#FFFFFF', bg: false, glow: 0 } },
  { name: '白字黑底', ts: { color: '#FFFFFF', stroke: 0, bg: true, bgColor: '#000000', bgOpacity: 0.7, glow: 0 } },
  { name: '黑字黄底', ts: { color: '#141414', stroke: 0, bg: true, bgColor: '#FFE14D', bgOpacity: 1, glow: 0 } },
  { name: '白字红底', ts: { color: '#FFFFFF', stroke: 0, bg: true, bgColor: '#E8262B', bgOpacity: 1, glow: 0 } },
  { name: '霓虹粉', ts: { color: '#FFFFFF', stroke: 0, bg: false, glow: 28, glowColor: '#FF4FD8' } },
  { name: '霓虹蓝', ts: { color: '#FFFFFF', stroke: 0, bg: false, glow: 28, glowColor: '#36CFFF' } },
  { name: '金色发光', ts: { color: '#FFE14D', stroke: 4, strokeColor: '#7A4A00', bg: false, glow: 22, glowColor: '#FFB800' } },
  { name: '蓝字白边', ts: { color: '#2F7BFF', stroke: 8, strokeColor: '#FFFFFF', bg: false, glow: 0 } },
];
const TXT_COLORS = {
  color: ['#FFFFFF', '#141414', '#FFE14D', '#FF3B3B', '#FF9C3D', '#36CFC9', '#2F7BFF', '#FF85C0', '#95DE64'],
  strokeColor: ['#000000', '#FFFFFF', '#E8262B', '#1F3A8A', '#7A4A00'],
  bgColor: ['#000000', '#FFFFFF', '#FFE14D', '#E8262B', '#2F7BFF', '#3C3C3C'],
  glowColor: ['#FFE14D', '#FF4FD8', '#36CFFF', '#95DE64', '#FFFFFF', '#FF3B3B'],
};
const txtStyle = s => ({ ...TEXT_DEFAULT, ...(s.ts || {}) });
const isText = s => s && s.type === 'text';

// 把一段文字画到画布上，返回画布大小（成片像素）
function renderTextCanvas(s, cv) {
  const st = txtStyle(s);
  const ctx = cv.getContext('2d');
  const font = `${st.italic ? 'italic ' : ''}${st.bold ? 'bold ' : ''}${st.size}px "${fontFamily(st.fontId)}", "PingFang SC", sans-serif`;
  const lines = String(s.text || ' ').split('\n');
  ctx.font = font;
  ctx.letterSpacing = st.spacing + 'px';
  const widths = lines.map(l => ctx.measureText(l || ' ').width);
  const maxW = Math.max(1, ...widths);
  const lh = st.size * st.lineH;
  const padX = Math.ceil(st.stroke + st.glow * 1.2 + (st.bg ? st.size * 0.4 : st.size * 0.12));
  const padY = Math.ceil(st.stroke + st.glow * 1.2 + (st.bg ? st.size * 0.22 : st.size * 0.08));
  const W = Math.max(8, Math.ceil(maxW + padX * 2)), H = Math.max(8, Math.ceil(lh * lines.length + padY * 2));
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  ctx.clearRect(0, 0, W, H);
  ctx.font = font;
  ctx.letterSpacing = st.spacing + 'px';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (st.bg) {
    ctx.fillStyle = hexToRgba(st.bgColor, st.bgOpacity);
    const ins = st.glow * 1.2 + st.stroke;
    ctx.beginPath();
    ctx.roundRect(ins, ins, W - ins * 2, H - ins * 2, st.size * 0.22);
    ctx.fill();
  }
  lines.forEach((l, i) => {
    const w = widths[i];
    const x = st.align === 'left' ? padX : st.align === 'right' ? W - padX - w : (W - w) / 2;
    const y = padY + lh * (i + 0.5) + st.size * 0.04;
    if (st.stroke > 0) {
      ctx.lineJoin = 'round'; ctx.miterLimit = 2;
      ctx.lineWidth = st.stroke * 2;
      ctx.strokeStyle = st.strokeColor;
      ctx.strokeText(l, x, y);
    }
    if (st.glow > 0) {
      // 发光：同一行字带阴影多画两遍
      ctx.save();
      ctx.shadowColor = st.glowColor;
      ctx.shadowBlur = st.glow;
      ctx.fillStyle = st.color;
      ctx.fillText(l, x, y);
      ctx.fillText(l, x, y);
      ctx.restore();
    }
    ctx.fillStyle = st.color;
    ctx.fillText(l, x, y);
  });
  return { w: W, h: H };
}
// 文字或样式变了：重画画布，更新大小（中心位置不动）
function refreshText(s) {
  const el = stkEls.get(s.id);
  const cv = (el && el.firstChild) || document.createElement('canvas');
  const d = renderTextCanvas(s, cv);
  s.w = d.w; s.h = d.h;
  cv._key = JSON.stringify([s.text, s.ts]);
  // 字体还没加载好：加载完再画一遍
  loadSubFont(txtStyle(s).fontId).then(ok => {
    if (!ok || !getStk(s.id)) return;
    const d2 = renderTextCanvas(s, cv);
    if (d2.w !== s.w || d2.h !== s.h) { s.w = d2.w; s.h = d2.h; }
    layoutStickers();
  });
}

/* ---------- 加文本 ---------- */
function addText() {
  if (!S.project) return toast('先导入一个视频');
  video.pause();
  pushUndo(snapshot());
  const { w: W, h: H } = S.project.canvas;
  const { start, end } = placeTime(S.t);
  const s = {
    id: 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    type: 'text', name: '文本', file: '', src: '',
    text: '默认文本', ts: { ...TEXT_DEFAULT, size: Math.round(Math.min(W, H) * 0.09), stroke: 8 },
    w: 10, h: 10, start, end, x: W / 2, y: H * 0.42, scale: 1,
  };
  s.track = freeTrack(start, end, s.id);
  S.project.stickers.push(s);
  renderStickers();
  refreshText(s);
  layoutStickers();
  selectStk(s.id);
  saveSoon();
  setTimeout(() => { const t = $('#txt-text'); t.focus(); t.select(); }, 50);
  toast('已加一段文本，直接打字改内容', false, 1400);
}
$('#btn-text').onclick = addText;

/* ---------- 面板 ---------- */
let txtPending = null;
function editTxt(fn, commit) {
  const s = S.selStk && getStk(S.selStk);
  if (!isText(s)) return;
  if (!txtPending) txtPending = snapshot();
  fn(s);
  refreshText(s);
  if (commit) { pushUndo(txtPending); txtPending = null; saveSoon(); }
  layoutStickers();
  renderStickersSoon();
  syncTxtPanel();
}
const setTs = (patch, commit) => editTxt(s => { s.ts = { ...txtStyle(s), ...patch }; }, commit);

// 预设：小方块上画“文”字的样子
function drawTxtPresets() {
  $('#txt-presets').replaceChildren(...TEXT_PRESETS.map(p => {
    const b = document.createElement('button');
    b.className = 'kwp';
    b.title = p.name;
    const cv = document.createElement('canvas');
    const ts = { ...TEXT_DEFAULT, fontId: 'noto-black', size: 34, ...p.ts, stroke: p.ts.stroke ? 4 : 0, glow: p.ts.glow ? 10 : 0 };
    renderTextCanvas({ text: '文字', ts }, cv);
    b.appendChild(cv);
    b.appendChild(Object.assign(document.createElement('span'), { textContent: p.name }));
    b.onclick = () => setTs({ ...p.ts }, true);
    return b;
  }));
}
SUB_FONTS.forEach(f => $('#txt-font').add(new Option(f.name, f.id)));
$('#txt-font').onchange = e => setTs({ fontId: e.target.value }, true);
$('#txt-text').addEventListener('input', e => editTxt(s => { s.text = e.target.value || ' '; s.name = (e.target.value || '文本').split('\n')[0].slice(0, 20); }, false));
$('#txt-text').addEventListener('change', () => { if (txtPending) { pushUndo(txtPending); txtPending = null; saveSoon(); renderStickers(); } });
$('#txt-text').addEventListener('keydown', e => e.stopPropagation());
const rng = (id, key, f = v => v) => {
  $(id).oninput = e => setTs({ [key]: f(Number(e.target.value)) }, false);
  $(id).onchange = e => setTs({ [key]: f(Number(e.target.value)) }, true);
};
rng('#txt-size', 'size');
rng('#txt-stroke', 'stroke');
rng('#txt-glow', 'glow');
rng('#txt-sp', 'spacing');
rng('#txt-lh', 'lineH', v => v / 100);
rng('#txt-bgop', 'bgOpacity', v => v / 100);
$('#txt-stroke-on').onchange = e => setTs({ stroke: e.target.checked ? 8 : 0 }, true);
$('#txt-bg-on').onchange = e => setTs({ bg: e.target.checked }, true);
$('#txt-glow-on').onchange = e => setTs({ glow: e.target.checked ? 24 : 0 }, true);
document.querySelectorAll('#txt-fx button').forEach(b => (b.onclick = () => { const s = getStk(S.selStk); setTs({ [b.dataset.k]: !txtStyle(s)[b.dataset.k] }, true); }));
document.querySelectorAll('#txt-align button').forEach(b => (b.onclick = () => setTs({ align: b.dataset.v }, true)));
document.querySelectorAll('.txsw').forEach(box => {
  const key = box.dataset.tx;
  TXT_COLORS[key].forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'sw'; sw.style.background = c; sw.dataset.c = c; sw.title = c;
    sw.onclick = () => setTs({ [key]: c }, true);
    box.appendChild(sw);
  });
  const custom = document.createElement('label');
  custom.className = 'sw custom';
  custom.title = '自定义颜色';
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.oninput = () => setTs({ [key]: inp.value.toUpperCase() }, false);
  inp.onchange = () => setTs({ [key]: inp.value.toUpperCase() }, true);
  custom.appendChild(inp);
  box.appendChild(custom);
});

function syncTxtPanel() {
  const s = S.selStk && getStk(S.selStk);
  const on = isText(s);
  $('#txt-box').hidden = !on;
  $('#stk-media-opts').hidden = on;
  if (!on) return;
  const st = txtStyle(s);
  if (document.activeElement !== $('#txt-text')) $('#txt-text').value = s.text;
  $('#txt-font').value = st.fontId;
  $('#txt-size').value = st.size; $('#v-txt-size').textContent = st.size;
  document.querySelectorAll('#txt-fx button').forEach(b => b.classList.toggle('on', !!st[b.dataset.k]));
  document.querySelectorAll('#txt-align button').forEach(b => b.classList.toggle('on', b.dataset.v === st.align));
  $('#txt-stroke-on').checked = st.stroke > 0; $('#txt-stroke-opts').classList.toggle('off', !(st.stroke > 0)); $('#txt-stroke').value = st.stroke || 8;
  $('#txt-bg-on').checked = !!st.bg; $('#txt-bg-opts').classList.toggle('off', !st.bg);
  $('#txt-bgop').value = Math.round(st.bgOpacity * 100); $('#v-txt-bgop').textContent = Math.round(st.bgOpacity * 100) + '%';
  $('#txt-glow-on').checked = st.glow > 0; $('#txt-glow-opts').classList.toggle('off', !(st.glow > 0)); $('#txt-glow').value = st.glow || 24;
  $('#txt-sp').value = st.spacing; $('#v-txt-sp').textContent = st.spacing;
  $('#txt-lh').value = Math.round(st.lineH * 100); $('#v-txt-lh').textContent = st.lineH.toFixed(2);
  document.querySelectorAll('.txsw').forEach(box => {
    const v = (st[box.dataset.tx] || '').toUpperCase();
    let hit = false;
    box.querySelectorAll('.sw[data-c]').forEach(sw => { const o = sw.dataset.c.toUpperCase() === v; sw.classList.toggle('on', o); hit = hit || o; });
    const cu = box.querySelector('.sw.custom');
    cu.classList.toggle('on', !hit);
    cu.querySelector('input').value = /^#[0-9A-F]{6}$/i.test(v) ? v.toLowerCase() : '#ffffff';
  });
  document.querySelectorAll('#txt-presets .kwp').forEach((b, i) => {
    const p = TEXT_PRESETS[i].ts;
    b.classList.toggle('on', Object.keys(p).every(k => String(p[k]) === String(st[k])));
  });
}
loadSubFont('noto-black').then(drawTxtPresets);
drawTxtPresets();

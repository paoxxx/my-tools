// 表情包和视频素材：粘贴／拖入、多轨道、时间轴上拖动吸附（预览里的显示和编辑在stkedit.js）
const stkLayer = $('#stk-layer');
const stkBox = $('#stk-box');
const rowStk = $('#row-stk');
const stage = $('#stage');
const stkEls = new Map(); // id -> 预览里的元素
const SNAP_PX = 16; // 吸附范围（屏幕像素）
S.selStk = null;

const assetURL = f => fileURL(S.dir + '/assets/' + f);
const stageScale = () => stage.clientWidth / S.project.canvas.w;
const getStk = id => S.project.stickers.find(s => s.id === id);

/* ---------- 吸附（字幕、表情包共用） ---------- */
const snapLine = document.createElement('div');
snapLine.id = 'snap-line';
tlBody.appendChild(snapLine);
function snapPoints(excludeId) {
  const pts = [{ t: S.t, kind: 'head' }, { t: 0 }, { t: duration() }];
  for (const x of S.project.subtitles) if (x.id !== excludeId) pts.push({ t: x.start, kind: 'sub', id: x.id }, { t: x.end, kind: 'sub', id: x.id });
  for (const x of S.project.stickers) if (x.id !== excludeId) pts.push({ t: x.start, kind: 'stk', id: x.id }, { t: x.end, kind: 'stk', id: x.id });
  for (const x of S.project.backgrounds || []) if (x.id !== excludeId) pts.push({ t: x.start, kind: 'bg' }, { t: x.end, kind: 'bg' });
  return pts;
}
// 找最近的吸附点；没有就返回null
// edge='start'：表情包开头，优先吸“字幕开头”；edge='end'：表情包结尾，优先吸“字幕结尾”
function nearestSnap(t, excludeId, edge) {
  const pick = (list, range) => {
    let best = null, bd = range / S.pps;
    for (const p of list) { const d = Math.abs(p.t - t); if (d < bd) { bd = d; best = p; } }
    return best;
  };
  if (edge) {
    const subs = S.project.subtitles;
    const main = subs.map(x => ({ t: edge === 'start' ? x.start : x.end, kind: 'sub', id: x.id }));
    const hit = pick(main, SNAP_PX * 1.6); // 字幕边界吸得更远、更优先
    if (hit) return hit;
    const others = [{ t: S.t, kind: 'head' }, { t: 0 }, { t: duration() }];
    for (const x of S.project.stickers) if (x.id !== excludeId) others.push({ t: x.start, kind: 'stk' }, { t: x.end, kind: 'stk' });
    return pick(others, SNAP_PX);
  }
  return pick(snapPoints(excludeId), SNAP_PX);
}
// 返回吸附后的时间；按住Cmd时不吸附，只对齐到帧
function snapTime(t, excludeId, noSnap) {
  if (!noSnap) {
    const best = nearestSnap(t, excludeId);
    if (best) { showSnapLine(best.t); return best.t; }
  }
  return Math.round(t * FPS) / FPS;
}
function showSnapLine(t) {
  snapLine.style.display = 'block';
  snapLine.style.left = t * S.pps - tlScroll.scrollLeft + 'px';
  snapLine.style.height = tlScroll.clientHeight + 'px';
  clearTimeout(showSnapLine.tm);
  showSnapLine.tm = setTimeout(() => (snapLine.style.display = 'none'), 600);
}

/* ---------- 添加表情包 ---------- */
function fitScale(info) {
  const { w: W, h: H } = S.project.canvas;
  return Math.min((W * 0.6) / info.w, (H * 0.45) / info.h, 3);
}
const DEFAULT_LEN = 2.5; // 播放头不在字幕上时的默认时长（秒）

// 从播放头开始；播放头在某句字幕上（亮着的那句）时，就持续到这句字幕结束，否则默认2.5秒
function placeTime(t) {
  const dur = duration();
  const sub = subAt(t);
  let start = t, end = sub && sub.end - t >= 0.3 ? sub.end : Math.min(dur, t + DEFAULT_LEN);
  if (end - start < 0.3) { start = Math.max(0, dur - DEFAULT_LEN); end = dur; }
  return { start, end };
}
function addStickers(infos, at) {
  const ok = infos.filter(i => !i.error && !i.empty);
  infos.filter(i => i.error).forEach(i => toast(`${i.name} 导入失败：${i.error}`, true));
  if (!ok.length) return;
  video.pause();
  pushUndo(snapshot());
  const { w: W, h: H } = S.project.canvas;
  let t = at ?? S.t, last = null;
  for (const info of ok) {
    let { start, end } = placeTime(t);
    // 视频：默认用视频本身的长度（放不下就到片尾）；图片、GIF按字幕规则
    // 视频片段永远保留完整长度：超出时间线的尾巴只是不播放、不导出，往前挪时会完整显示
    if (info.type === 'video' && info.duration > 0.1) { start = Math.min(t, Math.max(0, duration() - 0.3)); end = start + info.duration; }
    last = {
      id: 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      file: info.file, name: info.name, type: info.type, src: info.src || '',
      w: info.w, h: info.h, srcDur: info.duration || 0, ...(info.type === 'video' ? { hasAudio: !!info.hasAudio, sound: false, volume: 1 } : {}),
      start, end, x: W / 2, y: H / 2, scale: fitScale(info),
    };
    last.track = freeTrack(last.start, last.end, last.id);
    S.project.stickers.push(last);
    t = end; // 一次拖进多个时，依次往后排
  }
  renderStickers();
  selectStk(last.id);
  saveSoon();
  if (window.refreshLibUsed) refreshLibUsed();
  const kinds = { video: '视频', gif: 'GIF', image: '图片' };
  const names = [...new Set(ok.map(i => kinds[i.type] || '素材'))];
  toast(ok.length > 1 ? `已添加${ok.length}个素材（${names.join('、')}）` : `已添加${names[0]}` + (ok[0].type === 'video' ? `，${ok[0].duration.toFixed(1)}秒，左右拖边缘可以剪短` : ''), false, 1600);
}

// Cmd＋V：优先用粘贴事件里的数据（访达复制的文件、截图、GIF），拿不到再直接读系统剪贴板
const MEDIA_RE = /\.(png|jpe?g|webp|bmp|heic|gif|mp4|mov|m4v|webm|mkv|avi)$/i;
let pasting = false;
async function pasteFrom(cd) {
  if (!S.project || $('#editor').hidden || pasting) return;
  pasting = true;
  try {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const files = cd ? [...cd.files] : [];
    // 1. 复制的文件：有路径就直接导入，GIF和视频都能保留
    const paths = files.map(f => window.api.pathForFile(f)).filter(p => p && MEDIA_RE.test(p));
    if (paths.length) return addStickers(await window.api.importAssets({ dir: S.dir, files: paths }));
    // 2. 剪贴板里的图片数据（截图、网页复制的图），有GIF先用GIF
    const imgs = cd ? [...cd.items].filter(it => it.kind === 'file' && /^image\//.test(it.type)) : [];
    imgs.sort((a, b) => (b.type === 'image/gif') - (a.type === 'image/gif'));
    if (imgs.length) {
      const f = imgs[0].getAsFile();
      const ext = { 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[imgs[0].type] || 'png';
      const name = f && f.name && MEDIA_RE.test(f.name) ? f.name : `粘贴-${stamp}.${ext}`;
      const bytes = new Uint8Array(await f.arrayBuffer());
      return addStickers([await window.api.saveAssetBytes({ dir: S.dir, name, bytes })]);
    }
    // 3. 兜底
    const r = await window.api.pasteAsset({ dir: S.dir });
    if (r.empty) return toast('剪贴板里没有图片。截图、复制图片文件或从剪贴板存图里复制都可以', true);
    addStickers([r]);
  } catch (e) {
    toast('粘贴失败：' + errMsg(e), true);
  } finally {
    pasting = false;
  }
}
document.addEventListener('paste', e => {
  if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
  e.preventDefault();
  pasteFrom(e.clipboardData);
});
const pasteSticker = () => pasteFrom(null); // 测试用

// 拖入
const dropHint = document.createElement('div');
dropHint.id = 'drop-hint';
dropHint.hidden = true;
dropHint.textContent = '松开鼠标，素材会从播放头这一帧开始';
document.body.appendChild(dropHint);
let dragDepth = 0;
const editorEl = $('#editor');
const LIB_TYPE = 'application/x-tietu-path';
editorEl.addEventListener('dragenter', e => {
  const t = e.dataTransfer.types;
  if (t.includes('Files') || t.includes(LIB_TYPE)) { dragDepth++; dropHint.hidden = false; }
});
editorEl.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropHint.hidden = true; } });
// 落在时间轴上：就近对齐。靠近播放头就从播放头开始；落在某句字幕上就从这句开头开始；
// 落在两句之间的空白处，就吸到最近那句的开头（1.5秒以内）
function dropTarget(clientX) {
  const t = Math.min(Math.max(0, (clientX - tlScroll.getBoundingClientRect().left + tlScroll.scrollLeft) / S.pps), duration());
  if (Math.abs(t - S.t) * S.pps < 20) return { t: S.t };
  const subs = S.project.subtitles;
  const inSub = subs.find(x => t >= x.start && t < x.end);
  if (inSub) return { t: inSub.start, sub: inSub };
  let best = null, bd = 1.5;
  for (const x of subs) { const d = Math.abs(x.start - t); if (d < bd) { bd = d; best = x; } }
  if (best) return { t: best.start, sub: best };
  return { t: Math.round(t * FPS) / FPS };
}
function overTimeline(ev) {
  const r = tlBody.getBoundingClientRect();
  return ev.clientY >= r.top && ev.clientY <= r.bottom && ev.clientX >= r.left;
}
function dropTime(ev) {
  if (!ev || !overTimeline(ev)) return undefined;
  return dropTarget(ev.clientX).t;
}
// 拖着素材经过时间轴时，提前显示会落在哪里
let dropGhostOn = false;
tlBody.addEventListener('dragover', e => {
  const t = e.dataTransfer.types;
  if (!S.project || !(t.includes('Files') || t.includes(LIB_TYPE))) return;
  e.preventDefault();
  const tg = dropTarget(e.clientX);
  const r = placeTime(tg.t);
  // 影子放在它会落到的那条轨道上（最低的空轨道；都满了就是最上面新的一条）
  const probe = { id: '_drop', start: r.start, end: r.end };
  const { filler, lanes } = trackGeom();
  const minI = baseTop() + 1;
  const ln = lanes.slice().reverse().find(l => l.idx >= minI && !l.t.locked && trackFree(l.t, probe));
  const gh = ln ? ln.h : TRACK_H;
  ghost.style.top = (ln ? ln.top : Math.max(0, filler - gh)) + 2 + 'px';
  ghost.style.height = gh - 4 + 'px';
  ghost.style.left = r.start * S.pps + 'px';
  ghost.style.width = Math.max(4, (r.end - r.start) * S.pps) + 'px';
  if (!ghost.parentNode) rowStk.appendChild(ghost);
  hiSub(tg.sub && tg.sub.id);
  showSnapLine(tg.t);
  dropGhostOn = true;
});
function clearDropGhost() {
  if (!dropGhostOn) return;
  dropGhostOn = false;
  ghost.remove();
  hiSub(null);
  snapLine.style.display = 'none';
}
tlBody.addEventListener('dragleave', e => { if (!tlBody.contains(e.relatedTarget)) clearDropGhost(); });
window.addEventListener('drop', clearDropGhost, true);
window.addEventListener('dragend', clearDropGhost, true);

async function addFromPaths(paths, at) {
  busy('正在导入素材…');
  try { addStickers(await window.api.importAssets({ dir: S.dir, files: paths }), at); }
  catch (e) { toast('导入失败：' + errMsg(e), true); }
  finally { unbusy(); }
}
async function dropFiles(files, ev) {
  dragDepth = 0;
  dropHint.hidden = true;
  const libPath = ev && ev.dataTransfer.getData(LIB_TYPE);
  if (libPath) return addFromPaths([libPath], dropTime(ev));
  const srt = files.find(f => /\.srt$/i.test(f.name));
  if (srt) return loadSrt(window.api.pathForFile(srt), true);
  const paths = files.map(f => window.api.pathForFile(f)).filter(p => /\.(png|jpe?g|webp|bmp|heic|gif|mp4|mov|m4v|webm|mkv|avi)$/i.test(p));
  if (!paths.length) return toast('只能拖入图片、GIF、视频或SRT字幕', true);
  return addFromPaths(paths, dropTime(ev));
}

/* ---------- 统一的数字轨道（剪映式）：视频、背景、表情包都在轨道上，数组里越靠后越靠上（盖住下面的） ---------- */
// S.project.tracks：[{id, hidden, locked, h}]；每个片段（表情包、背景段、原视频）用 .track 记在哪条轨道上，.layer＝轨道序号
// 只有字幕和音频（波形）是固定的两行
const overlaps = (a, b) => a.start < b.end - 1e-6 && b.start < a.end - 1e-6;
const TRACK_H = 36, TRACK_MIN = 22, TRACK_MAX = 140, TOP_MIN = 14;
const newTrack = () => ({ id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), hidden: false, locked: false, h: TRACK_H });
const tracks = () => S.project.tracks || (S.project.tracks = []);
const trackOf = s => tracks().find(t => t.id === s.track);
const trackIdx = id => tracks().findIndex(t => t.id === id);
const hasPic = () => S.project.video.kind !== 'audio';
// 轨道上的全部片段：表情包＋背景段＋原视频（录音项目没有画面，不算）
// 母体（视频或录音）也是轨道上的一个片段：视频有画面＋声音，录音只有声音
// 视频项目：画面（p.video）和声音（p.audio）是分开的两个片段，各占一条轨道，可以分别隐藏／静音／删除
// noPic＝画面删掉了；audio.removed＝声音删掉了（都能撤销）
function mainItems() {
  const p = S.project, a = [];
  if (!hasPic()) return [p.video];
  if (!p.video.noPic) a.push(p.video);
  if (p.audio && !p.audio.removed) a.push(p.audio);
  return a;
}
const isMainSound = x => x === S.project.audio || (x === S.project.video && !hasPic());
const allItems = () => [...S.project.stickers, ...(S.project.backgrounds || []), ...mainItems()];
const trackFree = (t, s) => !allItems().some(x => x !== s && x.id !== s.id && x.track === t.id && overlaps(x, s));
const itemKind = x => (x === S.project.video ? 'vid' : x === S.project.audio ? 'aud' : (S.project.backgrounds || []).includes(x) ? 'bg' : 'stk');
// 视频和背景所在的最高那条轨道：新表情包要放在它上面，免得被盖住
function baseTop() {
  let m = -1;
  for (const x of allItems()) if (itemKind(x) !== 'stk') m = Math.max(m, trackIdx(x.track));
  return m;
}

// 老项目：背景放最下面一条，原视频放在背景上面，表情包按原来的层往上排；空轨道收掉；再把layer同步成轨道序号
function normalizeTracks() {
  const p = S.project;
  if (!Array.isArray(p.tracks)) p.tracks = [];
  if (!Array.isArray(p.backgrounds)) p.backgrounds = [];
  const h = p.hidden || {};
  let ids = new Set(p.tracks.map(t => t.id));
  // 背景
  const bgOrph = p.backgrounds.filter(b => !ids.has(b.track));
  if (bgOrph.length) {
    let t = p.tracks.find(t => p.backgrounds.some(b => b.track === t.id));
    if (!t) { t = newTrack(); t.h = 30; if (h.bg) t.hidden = true; p.tracks.unshift(t); }
    bgOrph.forEach(b => { b.track = t.id; });
  }
  // 原视频（录音项目也一样占一条轨道，只是没有画面）
  {
    Object.assign(p.video, { id: 'video', start: 0, end: p.video.duration });
    ids = new Set(p.tracks.map(t => t.id));
    if (!ids.has(p.video.track) && !(hasPic() && p.video.noPic)) {
      const t = newTrack(); t.h = 34; if (h.vid) t.hidden = true;
      const above = Math.max(-1, ...p.backgrounds.map(b => p.tracks.findIndex(x => x.id === b.track)));
      p.tracks.splice(above + 1, 0, t);
      p.video.track = t.id;
    }
  }
  // 视频的声音：单独一个片段，放在最下面一条轨道（像剪映的音频轨）
  if (hasPic()) {
    if (!p.audio) p.audio = { id: 'audio' };
    Object.assign(p.audio, { id: 'audio', start: 0, end: p.video.duration });
    ids = new Set(p.tracks.map(t => t.id));
    if (!p.audio.removed && !ids.has(p.audio.track)) {
      const t = newTrack(); t.h = 34;
      p.tracks.unshift(t);
      p.audio.track = t.id;
      // 老项目：以前视频轨道的喇叭关着，就把静音挪到声音轨道上
      const vt = p.tracks.find(x => x.id === p.video.track);
      if (vt && vt.muted) { vt.muted = false; t.muted = true; }
    }
  }
  // 表情包
  ids = new Set(p.tracks.map(t => t.id));
  const orphans = p.stickers.filter(x => !ids.has(x.track));
  if (orphans.length) {
    const byLayer = new Map();
    for (const x of orphans) {
      const k = typeof x.layer === 'number' ? x.layer : -1;
      if (!byLayer.has(k)) byLayer.set(k, []);
      byLayer.get(k).push(x);
    }
    for (const k of [...byLayer.keys()].sort((a, b) => a - b)) {
      for (const x of byLayer.get(k)) {
        if (k >= 0) {
          let t = p.tracks[p.tracks.length - 1];
          if (!t || t._fromLayer !== k || !trackFree(t, x)) { t = newTrack(); t._fromLayer = k; if (h.stk) t.hidden = true; p.tracks.push(t); }
          x.track = t.id;
        } else x.track = freeTrack(x.start, x.end, x.id);
      }
    }
    p.tracks.forEach(t => delete t._fromLayer);
  }
  // 以前“视频／背景／表情包”整行的眼睛，已经换成每条轨道自己的眼睛
  if (h.vid || h.bg || h.stk) p.hidden = { sub: !!h.sub };
  const items = allItems();
  p.tracks = p.tracks.filter(t => items.some(x => x.track === t.id));
  items.forEach(x => { x.layer = trackIdx(x.track); });
}
// 找能放下[start,end]的最低一条轨道（在视频和背景上面）；都放不下就在最上面新建一条
function freeTrack(start, end, exceptId) {
  const probe = { id: exceptId, start, end };
  const min = baseTop() + 1;
  const t = tracks().find((t, i) => i >= min && !t.locked && trackFree(t, probe));
  if (t) return t.id;
  const nt = newTrack();
  tracks().push(nt);
  return nt.id;
}
// 把片段挪到第idx条轨道；那条放不下（或锁住）就在idx位置插一条新轨道，原来的往上挪
function moveToTrack(s, idx, forceNew) {
  const tr = tracks();
  const t = tr[idx];
  if (!forceNew && t && !t.locked && (t.id === s.track || trackFree(t, s))) { s.track = t.id; return; }
  const nt = newTrack();
  if (itemKind(s) === 'vid' || itemKind(s) === 'aud') nt.h = 34;
  if (itemKind(s) === 'bg') nt.h = 30;
  tr.splice(Math.max(0, Math.min(idx, tr.length)), 0, nt);
  s.track = nt.id;
}
function layerCount() { return tracks().length; }

/* ---------- 轨道的位置和高度 ---------- */
const stkHeads = $('#stk-heads');
const stkTop = $('#stk-top');
// 返回 {filler, lanes:[{t, idx, top, h}]}：最上面留一块空白（拖到这里就是新建一条轨道），下面从高层到低层排
function trackGeom() {
  const tr = tracks();
  const avail = rowStk.clientHeight || 120;
  const sum = tr.reduce((a, t) => a + (t.h || TRACK_H), 0);
  const f = sum > 0 ? Math.min(1, Math.max(0, avail - TOP_MIN) / sum) : 1;
  const hs = tr.map(t => Math.max(16, Math.floor((t.h || TRACK_H) * f)));
  const used = hs.reduce((a, b) => a + b, 0);
  const filler = Math.max(0, avail - used);
  const lanes = [];
  let y = filler;
  for (let i = tr.length - 1; i >= 0; i--) { lanes.push({ t: tr[i], idx: i, top: y, h: hs[i] }); y += hs[i]; }
  return { filler, lanes };
}
// 鼠标的y落在哪条轨道上；在最上面空白处返回 {top:true}
function laneAtY(clientY) {
  const { filler, lanes } = trackGeom();
  const y = clientY - rowStk.getBoundingClientRect().top;
  if (y < filler || !lanes.length) return { top: true, lane: null };
  for (const l of lanes) if (y < l.top + l.h) return { lane: l };
  return { lane: lanes[lanes.length - 1] };
}

/* ---------- 时间轴上的表情包 ---------- */
function renderStickers() {
  if (!S.project) return;
  normalizeTracks();
  const { filler, lanes } = trackGeom();
  const byId = new Map(lanes.map(l => [l.t.id, l]));
  const frag = document.createDocumentFragment();
  // 轨道底纹（隐藏的变暗，锁住的带斜纹）
  for (const l of lanes) {
    const d = document.createElement('div');
    d.className = 'lane' + (l.t.hidden ? ' off' : '') + (l.t.locked ? ' locked' : '');
    d.style.top = l.top + 'px';
    d.style.height = l.h + 'px';
    frag.appendChild(d);
  }
  // 原视频：一整条，不能左右拖，可以上下换轨道（录音项目显示成录音）
  for (const v of mainItems()) {
    const l = byId.get(v.track);
    if (!l) continue;
    const aud = v === S.project.audio;
    const el = document.createElement('div');
    el.className = 'clip vidc' + (aud ? ' audc' : '') + (S.selMain === v.id ? ' selected' : '') + (l.t.hidden ? ' off' : '') + (l.t.locked ? ' locked' : '');
    el.dataset.id = v.id;
    el.title = aud ? '原视频的声音：点一下选中，按Delete删掉声音；轨道头的喇叭可以静音；上下拖换轨道'
      : hasPic() ? '原视频的画面：点一下选中，按Delete删掉画面（声音还在）；眼睛可以隐藏；上下拖换轨道' : '录音：上下拖可以换轨道';
    el.innerHTML = `<span></span><span class="dur">${fmt(S.project.video.duration)}</span>`;
    const name = S.project.video.path.split('/').pop();
    el.firstChild.textContent = aud ? '🎵 声音 · ' + name : (hasPic() ? '🎬 画面 · ' : '🎙 ') + name;
    el.style.top = l.top + 2 + 'px';
    el.style.height = l.h - 4 + 'px';
    placeClip(el, { start: 0, end: duration() });
    frag.appendChild(el);
  }
  // 背景段
  for (const b of S.project.backgrounds || []) {
    const l = byId.get(b.track);
    if (!l) continue;
    const el = document.createElement('div');
    el.className = 'clip bgc' + (b.id === S.selBg ? ' selected' : '') + (l.t.hidden ? ' off' : '') + (l.t.locked ? ' locked' : '');
    el.dataset.id = b.id;
    el.title = bgLabel(b);
    el.innerHTML = '<div class="h h-l"></div><span></span><div class="h h-r"></div>';
    el.querySelector('span').textContent = bgLabel(b);
    const sw = b.type === 'solid' ? b.color : b.bgColor;
    el.style.background = `linear-gradient(90deg, ${sw} 0 14px, #4a3d74 14px)`;
    el.style.top = l.top + 2 + 'px';
    el.style.height = l.h - 4 + 'px';
    el.style.bottom = 'auto';
    placeClip(el, b);
    frag.appendChild(el);
  }
  for (const s of S.project.stickers) {
    const l = byId.get(s.track);
    if (!l) continue;
    const el = document.createElement('div');
    el.className = 'clip stk' + (s.id === S.selStk ? ' selected' : '') + (l.t.hidden ? ' off' : '') + (l.t.locked ? ' locked' : '');
    el.dataset.id = s.id;
    el.title = s.name;
    el.innerHTML = '<div class="h h-l"></div><img><span></span><div class="h h-r"></div>';
    if (s.type === 'video' || s.type === 'text') el.querySelector('img').remove();
    else el.querySelector('img').src = assetURL(s.file);
    if (s.type === 'text') el.classList.add('txt');
    if (s.type === 'video') { el.classList.add('vid'); el.insertBefore(Object.assign(document.createElement('span'), { className: 'dur', textContent: fmt(s.end - s.start) }), el.querySelector('.h-r')); }
    el.querySelector('span').textContent = s.type === 'text' ? 'T ' + String(s.text || '').replace(/\n/g, ' ') : (s.type === 'video' ? (s.sound ? '🔊 ' : '▶ ') : s.type === 'gif' ? 'GIF ' : '') + s.name;
    if (s.tier) {
      // 从夯到拉：片段上的小菱形＝飞到档位的时间，颜色就是那一档的颜色
      el.classList.add('tierc');
      const b = tierBoardFor(s), r = b && b.rows.find(x => x.id === s.tier.row);
      if (r && s.tier.moveAt != null) {
        const mk = document.createElement('div');
        mk.className = 'mv';
        mk.title = `${fmt(s.tier.moveAt)} 飞到“${r.text}”，左右拖可以改（会吸附字幕开头）`;
        mk.style.left = Math.max(0, s.tier.moveAt - s.start) * S.pps - 6 + 'px';
        mk.style.setProperty('--c', r.color);
        el.appendChild(mk);
        el.querySelector('span').textContent = `🏷 ${r.text} ← ${s.name}`;
      } else el.querySelector('span').textContent = '🏷 待分配 ' + s.name;
    }
    el.style.top = l.top + 2 + 'px';
    el.style.height = l.h - 4 + 'px';
    el.style.bottom = 'auto';
    placeClip(el, s);
    frag.appendChild(el);
  }
  rowStk.replaceChildren(frag);
  renderTrackHeads(filler, lanes);
  applyLayerZ();
  syncPreviewEls();
  updateStickers(true);
  if (window.drawBgPreview) drawBgPreview(true);
  drawClipWaves();
}

/* ---------- 视频片段里的波形：声音和画面连在一起 ---------- */
// 母体视频用 S.peaks，插入的视频用各自的波形；全部用同一个刻度，同样的声音波形一样大
// 关了声音（片段静音或整条轨道静音）的波形变灰
const waveCvEl = $('#wave-cv');
function drawClipWaves(dragItem, dragTop) {
  if (!S.project || !S.project.tracks) return;
  const { ctx, w, h } = sizeCanvas(waveCvEl);
  const sl = tlScroll.scrollLeft, pps = S.pps;
  const ref = Math.max(30, S.peakMax || 0);
  const { lanes } = trackGeom();
  const laneOf = new Map(lanes.map(l => [l.t.id, l]));
  const items = [];
  const ms = mainItems().find(isMainSound); // 母体的波形画在“声音”片段里
  if (ms && S.peaks && S.peaks.length) items.push({ x: ms, P: S.peaks, local: t => t, on: true });
  for (const s of S.project.stickers) {
    if (s.type !== 'video') continue;
    const P = typeof assetPeaks !== 'undefined' && assetPeaks.get(S.dir + '|' + s.file);
    if (P && P.length) items.push({ x: s, P, local: t => videoLocal(s, t), on: !!s.sound });
  }
  for (const it of items) {
    const l = laneOf.get(it.x.track);
    if (!l) continue;
    const muted = !it.on || l.t.muted;
    const top = (it.x === dragItem ? dragTop : l.top + 2);
    const ch = l.h - 4;
    if (ch < 10) continue;
    // 片段高度够的话，上面留一行写名字，下面画波形
    const y0 = top + (ch >= 28 ? 16 : 1), y1 = top + ch - 2, mid = (y0 + y1) / 2, half = (y1 - y0) / 2;
    const isM = it.x === S.project.video || it.x === S.project.audio;
    const start = isM ? 0 : it.x.start, end = isM ? duration() : it.x.end;
    const xa = Math.max(0, Math.floor(start * pps - sl)), xb = Math.min(w, Math.ceil(end * pps - sl));
    ctx.fillStyle = muted ? 'rgba(255,255,255,0.22)' : 'rgba(80,230,215,0.9)';
    for (let x = xa; x < xb; x++) {
      const t0 = (sl + x) / pps, t1 = (sl + x + 1) / pps;
      const a = it.local(t0), b = Math.max(a + 0.01, it.local(t1));
      const i0 = Math.floor(a * PEAKS_PER_SEC), i1 = Math.max(i0 + 1, Math.floor(b * PEAKS_PER_SEC));
      if (i0 >= it.P.length || i0 < 0) continue;
      let m = 0;
      for (let i = i0; i < i1 && i < it.P.length; i++) if (it.P[i] > m) m = it.P[i];
      const amp = Math.max(0.5, Math.min(1, m / ref) * half);
      ctx.fillRect(x, mid - amp, 1, amp * 2);
    }
  }
}
// 预览里原视频和背景也按轨道顺序叠（和导出一致）
function applyLayerZ() {
  const p = S.project;
  const t = trackOf(p.video);
  // 母体的声音：视频项目看“声音”片段（删了、静音、隐藏都没声音），录音项目看它自己那条轨道的喇叭
  if (hasPic()) { const ta = p.audio && !p.audio.removed && trackOf(p.audio); video.muted = !ta || !!ta.muted || !!ta.hidden; }
  else video.muted = !!(t && t.muted);
  if (hasPic()) {
    video.style.zIndex = (p.video.layer || 0) * 1000;
    video.style.opacity = p.video.noPic || (t && t.hidden) ? 0 : 1;
  } else { video.style.opacity = 0; video.style.zIndex = 0; }
}

const EYE_SVG = '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/><line class="slash" x1="3" y1="21" x2="21" y2="3" stroke="currentColor" stroke-width="2.2"/></svg>';
const SPK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path class="wave1" d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="wave2" d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const LOCK_SVG = '<svg viewBox="0 0 24 24" width="12" height="12"><rect x="4" y="10" width="16" height="11" rx="2" fill="currentColor"/><path class="shackle" d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>';
function renderTrackHeads(filler, lanes) {
  stkTop.style.height = filler + 'px';
  const frag = document.createDocumentFragment();
  for (const l of lanes) {
    const d = document.createElement('div');
    d.className = 'trh' + (l.t.hidden ? ' off' : '') + (l.t.locked ? ' locked' : '');
    d.dataset.idx = l.idx;
    d.style.height = l.h + 'px';
    d.title = '按住上下拖动可以换轨道顺序（上面的盖住下面的）；拖下边线调高度';
    d.innerHTML = `<span class="grip">⋮⋮</span><span class="tn">${l.idx + 1}</span>` +
      `<button class="teye${l.t.hidden ? ' off' : ''}" title="显示／隐藏这条轨道">${EYE_SVG}</button>` +
      `<button class="tlock${l.t.locked ? ' on' : ''}" title="锁定这条轨道（锁住后不能拖动和修改）">${LOCK_SVG}</button>` +
      (allItems().some(x => x.track === l.t.id && (isMainSound(x) || x.type === 'video'))
        ? `<button class="tmute${l.t.muted ? ' off' : ''}" title="这条轨道的声音：点一下静音／打开">${SPK_SVG}</button>` : '') +
      '<div class="th-split"></div>';
    frag.appendChild(d);
  }
  stkHeads.replaceChildren(frag);
}

// 轨道头：眼睛、锁、拖动换顺序、拖下边线调高度
stkHeads.addEventListener('mousedown', e => {
  const th = e.target.closest('.trh');
  if (!th || e.button !== 0) return;
  const t = tracks()[Number(th.dataset.idx)];
  if (!t) return;
  if (e.target.closest('.teye')) {
    pushUndo(snapshot()); t.hidden = !t.hidden; afterTrackChange();
    toast(t.hidden ? `已隐藏第${Number(th.dataset.idx) + 1}条轨道，导出时也不会出现` : '已显示这条轨道', false, 1400);
    return;
  }
  if (e.target.closest('.tmute')) {
    pushUndo(snapshot()); t.muted = !t.muted; afterTrackChange();
    toast(t.muted ? `第${Number(th.dataset.idx) + 1}条轨道已静音，导出时也没有这条的声音` : '已打开这条轨道的声音', false, 1500);
    return;
  }
  if (e.target.closest('.tlock')) {
    pushUndo(snapshot()); t.locked = !t.locked; afterTrackChange();
    toast(t.locked ? '已锁定这条轨道' : '已解锁', false, 1200);
    return;
  }
  e.preventDefault();
  if (e.target.closest('.th-split')) return resizeTrack(e, t);
  reorderTrack(e, t, th);
});
function afterTrackChange() {
  renderStickers();
  if (S.selStk) { const s = getStk(S.selStk); if (s && trackOf(s) && trackOf(s).hidden) selectStk(null); }
  saveSoon();
}
function resizeTrack(e, t) {
  const y0 = e.clientY, h0 = t.h || TRACK_H, snap = snapshot();
  document.body.style.cursor = 'row-resize';
  const move = ev => { t.h = Math.round(Math.min(TRACK_MAX, Math.max(TRACK_MIN, h0 + ev.clientY - y0))); renderStickers(); };
  const up = () => {
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (t.h !== h0) { pushUndo(snap); saveSoon(); }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}
// 上下拖动轨道头换顺序：拖的时候显示插入线
const insLine = document.createElement('div');
insLine.className = 'track-ins';
function reorderTrack(e, t, th) {
  const y0 = e.clientY, snap = snapshot();
  let moved = false, to = null;
  const move = ev => {
    if (!moved && Math.abs(ev.clientY - y0) < 4) return;
    moved = true;
    th.classList.add('dragging');
    const { lanes } = trackGeom();
    const y = ev.clientY - rowStk.getBoundingClientRect().top;
    // 插入位置：在哪两条之间（lanes从上往下排）
    let pos = lanes.length;
    for (let i = 0; i < lanes.length; i++) if (y < lanes[i].top + lanes[i].h / 2) { pos = i; break; }
    to = lanes.length - pos; // 换算成轨道数组里的位置（插在这个序号之前）
    const lineY = pos < lanes.length ? lanes[pos].top : lanes[lanes.length - 1].top + lanes[lanes.length - 1].h;
    insLine.style.top = lineY - 1 + 'px';
    if (!insLine.parentNode) rowStk.appendChild(insLine);
    const hl = insLine.cloneNode();
    stkHeads.querySelectorAll('.track-ins').forEach(x => x.remove());
    hl.style.top = lineY - 1 + 'px';
    stkHeads.appendChild(hl);
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    insLine.remove();
    stkHeads.querySelectorAll('.track-ins').forEach(x => x.remove());
    th.classList.remove('dragging');
    if (!moved || to === null) return;
    const tr = tracks();
    const from = tr.indexOf(t);
    let dest = to > from ? to - 1 : to;
    if (dest === from) return;
    tr.splice(from, 1);
    tr.splice(dest, 0, t);
    pushUndo(snap);
    renderStickers();
    saveSoon();
    toast(`已移到第${dest + 1}条轨道`, false, 1200);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

/* ---------- 选中 ---------- */
// 选中的原视频画面／声音片段：Delete删掉（能撤销）
function clearSelMain() {
  if (!S.selMain) return;
  S.selMain = null;
  rowStk.querySelectorAll('.clip.vidc.selected').forEach(c => c.classList.remove('selected'));
}
function deleteSelectedMain() {
  if (!S.selMain || !S.project || !hasPic()) return false;
  const v = S.selMain === 'audio' ? S.project.audio : S.project.video;
  S.selMain = null;
  if (!v) return false;
  if (trackOf(v) && trackOf(v).locked) { toast('这条轨道锁住了，点轨道头的锁可以解锁', false, 1500); return true; }
  pushUndo(snapshot());
  if (v === S.project.audio) v.removed = true; else v.noPic = true;
  renderStickers();
  saveSoon();
  toast(v === S.project.audio ? '已删掉原视频的声音（画面还在），⌘Z可以恢复' : '已删掉原视频的画面（声音还在），⌘Z可以恢复', false, 2200);
  return true;
}
function selectStk(id) {
  if (id) clearSelMain();
  S.selStk = id;
  if (id) { if (S.selSub) selectSub(null); if (S.selBg) selectBg(null); switchTab('stk'); }
  if (S.cropping && S.cropping.id !== id) cropCancel();
  rowStk.querySelectorAll('.clip.stk').forEach(el => el.classList.toggle('selected', el.dataset.id === id));
  placeBox();
  syncStkPanel();
}
function deleteSelectedStk() {
  const i = S.project.stickers.findIndex(s => s.id === S.selStk);
  if (i < 0) return false;
  const t = trackOf(S.project.stickers[i]);
  if (t && t.locked) { toast('这条轨道锁住了，先解锁再删除', true); return true; }
  if (S.cropping) cropCancel();
  pushUndo(snapshot());
  S.project.stickers.splice(i, 1);
  S.selStk = null;
  renderStickers();
  syncStkPanel();
  saveSoon();
  if (window.refreshLibUsed) refreshLibUsed();
  return true;
}

/* ---------- 时间轴上拖动 ---------- */
// 片段跟着鼠标走；进入吸附范围时显示“影子”和被对齐的字幕，松手后落到影子的位置
// 往上拖到字幕轨的某一句上：松手后起止时间对齐这一整句；上下拖到别的轨道就换轨道
const ghost = document.createElement('div');
ghost.className = 'snap-ghost';
function hiSub(id) {
  rowSub.querySelectorAll('.snap-target').forEach(el => el.classList.remove('snap-target'));
  if (id) { const el = rowSub.querySelector(`[data-id="${id}"]`); if (el) el.classList.add('snap-target'); }
}
// 上下拖片段时：算出鼠标在哪条轨道（或最上面的空白＝新建），把片段画到那一行
function laneDragTop(ev) {
  const { filler, lanes } = trackGeom();
  const hit = laneAtY(ev.clientY);
  const dest = hit.top ? { top: true } : { idx: hit.lane.idx };
  const top = hit.top ? Math.max(2, filler - (lanes[0] ? lanes[0].h : TRACK_H) + 2) : hit.lane.top + 2;
  return { dest, top };
}
function applyDest(x, dest, oTrack) {
  if (!dest) return;
  if (dest.top) moveToTrack(x, tracks().length, true);
  else if (tracks()[dest.idx] && tracks()[dest.idx].id !== oTrack) moveToTrack(x, dest.idx);
}
// 背景段：左右拖改时间（不能和同一条轨道上别的片段重叠），上下拖换轨道
function bgDrag(e, el) {
  const b = getBg(el.dataset.id);
  if (!b) return;
  const t0 = trackOf(b);
  if (t0 && t0.locked) { selectBg(b.id); toast('这条轨道锁住了，点轨道头的锁可以解锁', false, 1500); return; }
  const same = allItems().filter(x => x !== b && x.track === b.track).sort((a, c) => a.start - c.start);
  const prevEnd = Math.max(0, ...same.filter(x => x.end <= b.start + 1e-6).map(x => x.end));
  const nextStart = Math.min(duration(), ...same.filter(x => x.start >= b.end - 1e-6).map(x => x.start));
  const mode = e.target.classList.contains('h-l') ? 'l' : e.target.classList.contains('h-r') ? 'r' : 'body';
  const x0 = e.clientX, y0 = e.clientY, o = { start: b.start, end: b.end, track: b.track }, snap = snapshot(), len = o.end - o.start;
  let moved = false, dest = null;
  const move = ev => {
    const dx = ev.clientX - x0;
    if (!moved && Math.abs(dx) < 3 && Math.abs(ev.clientY - y0) < 4) return;
    moved = true;
    const dt = dx / S.pps, ns = ev.metaKey;
    if (mode === 'l') b.start = Math.min(Math.max(prevEnd, snapTime(o.start + dt, b.id, ns)), b.end - 0.2);
    else if (mode === 'r') b.end = Math.max(Math.min(nextStart, snapTime(o.end + dt, b.id, ns)), b.start + 0.2);
    else {
      const ld = laneDragTop(ev);
      dest = ld.dest;
      el.style.top = ld.top + 'px';
      // 换到别的轨道时不受原轨道邻居限制
      const free = dest.top || (tracks()[dest.idx] && tracks()[dest.idx].id !== o.track);
      const lo = free ? 0 : prevEnd, hi = free ? duration() : nextStart;
      const st = Math.min(Math.max(lo, snapTime(o.start + dt, b.id, ns)), hi - len);
      b.start = st; b.end = st + len;
    }
    placeClip(el, b);
    drawBgPreview(true);
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (moved) {
      applyDest(b, dest, o.track);
      if (!trackFree(trackOf(b), b)) moveToTrack(b, trackIdx(b.track) + 1, true);
      if (b.start !== o.start || b.end !== o.end || b.track !== o.track) { pushUndo(snap); bgChanged(); }
      else renderStickers();
    }
    selectBg(b.id);
    if (!moved && (S.t < b.start || S.t >= b.end)) { setTime(b.start); keepPlayheadVisible(); }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}
// 原视频：只能上下换轨道
function vidDrag(e, el) {
  const v = el.dataset.id === 'audio' ? S.project.audio : S.project.video, t0 = trackOf(v);
  // 点一下＝选中（按Delete可以删掉画面或声音）
  if (S.selStk) selectStk(null);
  if (S.selBg) selectBg(null);
  if (S.selSub) selectSub(null);
  S.selMain = v.id;
  rowStk.querySelectorAll('.clip.vidc').forEach(c => c.classList.toggle('selected', c.dataset.id === v.id));
  if (t0 && t0.locked) { toast('这条轨道锁住了，点轨道头的锁可以解锁', false, 1500); return; }
  const y0 = e.clientY, oTrack = v.track, snap = snapshot();
  let moved = false, dest = null;
  const move = ev => {
    if (!moved && Math.abs(ev.clientY - y0) < 4) return;
    moved = true;
    const ld = laneDragTop(ev);
    dest = ld.dest;
    el.style.top = ld.top + 'px';
    drawClipWaves(v, ld.top);
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (!moved) return;
    applyDest(v, dest, oTrack);
    if (v.track !== oTrack) { pushUndo(snap); saveSoon(); toast((v === S.project.audio ? '声音' : '原视频') + '换到了第' + (trackIdx(v.track) + 1) + '条轨道', false, 1200); }
    renderStickers();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

rowStk.addEventListener('mousedown', e => {
  const el = e.target.closest('.clip');
  if (!el || e.button !== 0) return;
  e.preventDefault();
  video.pause();
  if (el.classList.contains('vidc')) return vidDrag(e, el);
  clearSelMain();
  if (el.classList.contains('bgc')) return bgDrag(e, el);
  const s = getStk(el.dataset.id);
  if (!s) return;
  if (S.selSub) selectSub(null);
  const t0 = trackOf(s);
  if (t0 && t0.locked) {
    selectStk(s.id);
    if (S.t < s.start || S.t >= s.end) { setTime(s.start); keepPlayheadVisible(); }
    toast('这条轨道锁住了，点轨道头的锁可以解锁', false, 1500);
    return;
  }
  const mode = e.target.classList.contains('h-l') ? 'l' : e.target.classList.contains('h-r') ? 'r' : 'body';
  const x0 = e.clientX, y0 = e.clientY, o = { start: s.start, end: s.end, track: s.track, inPt: s.inPt || 0 }, snap = snapshot();
  const isVid = s.type === 'video';
  const dur = duration(), MIN = 0.1, len = o.end - o.start;
  let moved = false, target = null, dest = null; // target：松手后的时间；dest：松手后的轨道
  ghost.style.top = el.style.top;
  ghost.style.height = el.style.height;
  const showGhost = tg => {
    if (!tg) { ghost.remove(); snapLine.style.display = 'none'; return; }
    ghost.style.left = tg.start * S.pps + 'px';
    ghost.style.width = Math.max(2, (tg.end - tg.start) * S.pps) + 'px';
    if (!ghost.parentNode) rowStk.appendChild(ghost);
  };
  const move = ev => {
    const dx = ev.clientX - x0;
    if (!moved && Math.abs(dx) < 3 && Math.abs(ev.clientY - y0) < 4) return;
    moved = true;
    const dt = dx / S.pps;
    // 1. 拖到字幕轨上：整句对齐
    const rs = rowSub.getBoundingClientRect();
    if (mode === 'body' && ev.clientY >= rs.top && ev.clientY <= rs.bottom) {
      const tAt = (ev.clientX - tlScroll.getBoundingClientRect().left + tlScroll.scrollLeft) / S.pps;
      const sub = S.project.subtitles.find(x => tAt >= x.start && tAt < x.end);
      hiSub(sub && sub.id);
      target = sub ? { start: sub.start, end: sub.end } : null;
      s.start = Math.min(Math.max(0, o.start + dt), dur - len); s.end = s.start + len;
      placeClip(el, s);
      showGhost(target);
      if (target) showSnapLine(target.start);
      return;
    }
    // 2. 普通拖动：片段跟手，算出吸附位置
    let raw, sn = null;
    // 视频：左边缘最多拉到视频开头（剪掉的部分能拉回来），右边缘最多到视频结尾
    const minStart = isVid ? Math.max(0, o.start - (o.inPt || 0)) : 0;
    const maxEnd = isVid && s.srcDur > 0 ? o.start + s.srcDur - (o.inPt || 0) : dur;
    if (mode === 'l') {
      raw = { start: Math.min(Math.max(minStart, o.start + dt), o.end - MIN), end: o.end };
      if (!ev.metaKey) { const p = nearestSnap(raw.start, s.id, 'start'); if (p && p.t < o.end - MIN && p.t >= minStart - 1e-6) sn = { pos: { start: p.t, end: o.end }, p }; }
    } else if (mode === 'r') {
      raw = { start: o.start, end: Math.max(Math.min(maxEnd, o.end + dt), o.start + MIN) };
      if (!ev.metaKey) { const p = nearestSnap(raw.end, s.id, 'end'); if (p && p.t > o.start + MIN && p.t <= maxEnd + 1e-6) sn = { pos: { start: o.start, end: p.t }, p }; }
    } else {
      // 视频可以拖到尾巴超出时间线（超出部分不播放）；图片、GIF不能超出
      const maxSt = isVid ? Math.max(0, dur - 0.1) : dur - len;
      const st = Math.min(Math.max(0, o.start + dt), maxSt);
      raw = { start: st, end: st + len };
      if (!ev.metaKey) {
        const a = nearestSnap(st, s.id, 'start');
        if (a) sn = { pos: { start: a.t, end: a.t + len }, p: a };
        if (sn && (sn.pos.start < 0 || sn.pos.start > maxSt + 1e-6)) sn = null;
      }
    }
    s.start = raw.start; s.end = raw.end;
    if (isVid && mode === 'l') s.inPt = Math.max(0, o.inPt + ((sn ? sn.pos.start : s.start) - o.start));
    placeClip(el, s);
    if (mode === 'body') {
      // 上下拖：换轨道（拖到最上面的空白处＝新建一条轨道）
      const { filler, lanes } = trackGeom();
      const hit = laneAtY(ev.clientY);
      dest = hit.top ? { top: true } : { idx: hit.lane.idx };
      const top = hit.top ? Math.max(2, filler - (lanes[0] ? lanes[0].h : TRACK_H) + 2) : hit.lane.top + 2;
      el.style.top = top + 'px';
      ghost.style.top = el.style.top;
    }
    target = sn ? sn.pos : null;
    showGhost(target);
    hiSub(sn && sn.p.kind === 'sub' ? sn.p.id : null);
    if (sn) { clearTimeout(showSnapLine.tm); showSnapLine(sn.p.t); clearTimeout(showSnapLine.tm); }
    updateStickers();
    syncStkPanel();
    drawClipWaves();
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    ghost.remove();
    hiSub(null);
    snapLine.style.display = 'none';
    if (moved) {
      const fin = target || { start: Math.round(s.start * FPS) / FPS, end: Math.round(s.end * FPS) / FPS };
      s.start = fin.start; s.end = fin.end;
      if (isVid && mode === 'l') s.inPt = Math.max(0, o.inPt + (s.start - o.start));
      if (dest) {
        if (dest.top) moveToTrack(s, tracks().length, true);
        else if (tracks()[dest.idx] && tracks()[dest.idx].id !== o.track) moveToTrack(s, dest.idx);
        else if (!trackFree(trackOf(s), s)) moveToTrack(s, trackIdx(s.track) + 1); // 原轨道上撞到别的了：往上挪一条
      }
      if (s.start !== o.start || s.end !== o.end || s.track !== o.track) { pushUndo(snap); saveSoon(); }
      renderStickers();
      selectStk(s.id);
      updateStickers();
    } else {
      selectStk(s.id);
      if (S.t < s.start || S.t >= s.end) { setTime(s.start); keepPlayheadVisible(); }
    }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

/* ---------- 右侧面板切换 ---------- */
function switchTab(tab) {
  const subWasHidden = $('#tab-sub').hidden;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#tab-sub').hidden = tab !== 'sub';
  $('#tab-stk').hidden = tab !== 'stk';
  $('#tab-bg').hidden = tab !== 'bg';
  if (tab === 'bg' && window.drawBgPresets) drawBgPresets();
  if (tab === 'sub' && subWasHidden && window.kwRender) kwRender();
}
document.querySelectorAll('.tab').forEach(b => (b.onclick = () => switchTab(b.dataset.tab)));

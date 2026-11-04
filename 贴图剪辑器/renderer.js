// 贴图剪辑器 渲染进程
const $ = s => document.querySelector(s);
const FPS = 60;
const PEAKS_PER_SEC = 100;
const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mp3|m4a|wav|aac|flac|ogg|aiff?)$/i;

const S = {
  dir: null,          // 项目文件夹
  project: null,      // project.json内容
  peaks: new Uint8Array(0),
  pps: 100,           // 时间轴每秒多少像素
  t: 0,               // 当前时间（秒）
  canvasChoice: 'h',
  saveTimer: null,
  scrubbing: false,
  selSub: null,       // 选中的字幕id
  undo: [], redo: [],
};

const video = $('#video');
const tlScroll = $('#tl-scroll');
const tlContent = $('#tl-content');
const tlBody = $('#tl-body');
const rulerCv = $('#ruler-cv');
const waveCv = $('#wave-cv');

/* ---------- 小工具 ---------- */
const pad = n => String(n).padStart(2, '0');
function fmt(t) {
  t = Math.max(0, t);
  const fr = Math.round(t * FPS);
  const sec = Math.floor(fr / FPS);
  return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}.${pad(fr % FPS)}`;
}
function fileURL(p) {
  return 'file://' + p.split('/').map(encodeURIComponent).join('/');
}
let toastTimer;
function toast(msg, isErr = false, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isErr ? 6000 : ms);
}
function busy(text) { $('#busy-text').textContent = text; $('#busy').hidden = false; }
function unbusy() { $('#busy').hidden = true; $('#busy-bar').hidden = true; $('#busy-cancel').hidden = true; }
function errMsg(e) {
  // 去掉Electron给IPC错误加的前缀
  return String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function saveSoon() {
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => {
    if (S.dir && S.project) window.api.saveProject({ dir: S.dir, data: S.project }).catch(e => toast('自动保存失败：' + errMsg(e), true));
  }, 400);
}

/* ---------- 开始页 ---------- */
document.querySelectorAll('.choice').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.choice').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    S.canvasChoice = btn.dataset.v;
  };
});

window.api.toolsStatus().then(st => {
  const tip = $('#tool-tip');
  if (st.ffmpeg.includes('ffmpeg-full')) tip.textContent = '工具已就绪：FFmpeg完整版';
  else { tip.textContent = '提示：没找到FFmpeg完整版，导出时字幕可能无法烧录'; tip.classList.add('warn'); }
});

// 阻止拖文件进窗口时被浏览器直接打开
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

// 导入选项：隐藏原画面＋默认背景（都记住上次的选择）；背景下拉框的选项由background.js填
$('#start-bg').onchange = e => { try { localStorage.setItem('tietu-start-bg', e.target.value); } catch {} };
try { $('#start-hide').checked = localStorage.getItem('tietu-start-hide') === '1'; } catch {}
$('#start-hide').onchange = e => { try { localStorage.setItem('tietu-start-hide', e.target.checked ? '1' : '0'); } catch {} };
const importOpts = () => ({ voiceOnly: $('#start-hide').checked });
const dz = $('#dropzone');
dz.addEventListener('dragenter', () => dz.classList.add('over'));
dz.addEventListener('dragleave', e => { if (!dz.contains(e.relatedTarget)) dz.classList.remove('over'); });
dz.addEventListener('click', async () => {
  const p = await window.api.pickVideo();
  if (p) importVideo(p, null, importOpts());
});
dz.addEventListener('drop', e => {
  dz.classList.remove('over');
  const files = [...e.dataTransfer.files];
  const f = files.find(f => VIDEO_EXT.test(f.name));
  if (!f) return toast('请拖入剪映导出的视频（MP4、MOV等）', true);
  const s = files.find(f => /\.srt$/i.test(f.name));
  importVideo(window.api.pathForFile(f), s ? window.api.pathForFile(s) : null, importOpts());
});

// 编辑页拖入：表情包功能在M3加入
$('#editor').addEventListener('drop', e => {
  e.preventDefault();
  dropFiles([...e.dataTransfer.files], e);
});

// voiceOnly：勾了“隐藏原画面”。拖进来的如果是视频（剪映粗剪、画面是纯色占位），只用它的声音和字幕，画面隐藏，用背景
async function importVideo(path, srtPath, { voiceOnly = false } = {}) {
  try {
    busy('正在读取视频信息…');
    const info = await window.api.probe(path);
    if (!info.duration) throw new Error('读不到视频时长，文件可能损坏');
    const dir = await window.api.createProject(path);
    busy('正在抽取音频、计算波形…');
    const peaks = await window.api.extractAudio({ videoPath: path, dir });
    const canvas = S.canvasChoice === 'v' ? { w: 1080, h: 1920, fps: 60 } : S.canvasChoice === 'p' ? { w: 1080, h: 1440, fps: 60 } : { w: 1920, h: 1080, fps: 60 };
    S.dir = dir;
    S.project = {
      version: 1,
      createdAt: new Date().toISOString(),
      canvas,
      video: { path, ...info },
      subtitles: [],
      stickers: [],
      // 录音项目：用开始页选的背景铺满全片；视频项目默认没有背景
      backgrounds: info.kind === 'audio' || voiceOnly ? [{ id: 'g' + Date.now().toString(36), start: 0, end: info.duration, ...startBgChoice() }] : [],
      hidden: voiceOnly && info.kind !== 'audio' ? { vid: true } : {},
    };
    S.peaks = Uint8Array.from(peaks);
    await window.api.saveProject({ dir, data: S.project });
    unbusy();
    enterEditor();
    if (voiceOnly && info.kind !== 'audio') toast('已按杂谈处理：画面和声音已分开，画面轨道隐藏了（不需要可以选中按Delete删掉），声音在最下面单独一条', false, 4500);
    else if (info.kind !== 'audio' && info.fps && Math.abs(info.fps - 60) > 0.5) toast(`提示：原视频是${Math.round(info.fps)}帧，导出时会统一成60帧`);
    // 有剪映字幕就直接用，没有再自动识别
    const srt = srtPath || (await window.api.findSrt(path));
    if (srt) loadSrt(srt, false);
    else runASR(false);
  } catch (e) {
    unbusy();
    toast('导入失败：' + errMsg(e), true);
  }
}

$('#btn-open').onclick = async () => {
  try {
    busy('正在打开项目…');
    const r = await window.api.openProject();
    unbusy();
    if (!r) return;
    S.dir = r.dir;
    S.project = r.data;
    S.peaks = Uint8Array.from(r.peaks);
    enterEditor();
  } catch (e) {
    unbusy();
    toast('打开失败：' + errMsg(e), true);
  }
};

$('#btn-new').onclick = () => {
  if (!confirm('回到新建页面？当前项目已自动保存，之后可以用“打开项目”继续。')) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
  S.dir = null; S.project = null;
  $('#editor').hidden = true;
  $('#start').hidden = false;
  $('#btn-new').hidden = true;
  $('#btn-export').disabled = true;
  $('#canvas-label').hidden = true;
  $('#proj-name').textContent = '';
};

/* ---------- 编辑页 ---------- */
function enterEditor() {
  const p = S.project;
  $('#start').hidden = true;
  $('#editor').hidden = false;
  $('#btn-new').hidden = false;
  $('#canvas-label').hidden = false;
  $('#btn-export').disabled = false;
  $('#canvas-label').textContent = `${p.canvas.w > p.canvas.h ? '横版' : '竖版'} ${p.canvas.w}×${p.canvas.h} · 60帧${p.video.kind === 'audio' ? ' · 录音' : ''}`;
  $('#proj-name').textContent = S.dir.split('/').pop();
  $('#dur').textContent = fmt(p.video.duration);
  p.subStyle = normalizeSubStyle(p.subStyle, p.canvas);
  syncStylePanel();
  loadSubFont(p.subStyle.fontId).then(() => drawSubPreview(true));
  S.undo = []; S.redo = []; S.selSub = null; S.selStk = null; S.cropping = null;
  $('#crop-bar').hidden = true; $('#crop-box').hidden = true;
  if (!Array.isArray(p.stickers)) p.stickers = [];
  if (!Array.isArray(p.backgrounds)) p.backgrounds = [];
  if (!p.hidden) p.hidden = {};
  p.backgrounds.forEach(b => { if (b.speed) b.speed = bgSnapSpeed(b.speed); }); // 旧项目的速度归到四档
  if (!p.kwStyle) p.kwStyle = { ...KW_DEFAULT };
  if (S.kwPick) S.kwPick.clear();
  setTimeout(() => { if (window.kwSync) { kwSync(); kwRender(); } }, 0);
  applyTrackVis();
  S.selBg = null;
  S.selMain = null;
  const isAudio = p.video.kind === 'audio';
  applyTrackVis();
  if (window.renderBgs) { renderBgs(); syncBgPanel(); drawBgPresets(); }
  for (const el of stkEls.values()) el.remove();
  stkEls.clear();
  syncStkPanel();
  if (window.refreshLibUsed) refreshLibUsed();
  video.src = fileURL(p.video.path);
  let pm = 1;
  for (const v of S.peaks) if (v > pm) pm = v;
  S.peakMax = pm * 0.9; // 按本视频最大音量归一化，波形更饱满
  S.t = 0;
  requestAnimationFrame(() => {
    if (window.applyLayout) applyLayout();
    layoutStage();
    setPps(S.pps, 0);
    tlScroll.scrollLeft = 0;
    refreshTimeline();
  });
}

function layoutStage() {
  if (!S.project) return;
  const wrap = $('#preview-wrap');
  const W = wrap.clientWidth - 28, H = wrap.clientHeight - 28;
  const ar = S.project.canvas.w / S.project.canvas.h;
  let w = W, h = W / ar;
  if (h > H) { h = H; w = H * ar; }
  const st = $('#stage');
  st.style.width = Math.floor(w) + 'px';
  st.style.height = Math.floor(h) + 'px';
  sizeSubCanvas(Math.floor(w), Math.floor(h));
  if (window.layoutStickers) layoutStickers();
  if (window.sizeBgCanvas) sizeBgCanvas(Math.floor(w), Math.floor(h));
}
new ResizeObserver(() => { layoutStage(); refreshTimeline(); }).observe(document.body);

/* ---------- 播放与时间 ---------- */
function duration() { return S.project ? S.project.video.duration : 0; }

function setTime(t, fromVideo = false) {
  t = Math.min(Math.max(0, t), duration());
  if (!fromVideo) {
    t = Math.round(t * FPS) / FPS;      // 对齐到帧
    video.currentTime = t + 0.0001;     // 极小偏移，避免显示成上一帧
  }
  S.t = t;
  $('#time').textContent = fmt(t);
  drawPlayhead();
  updateSubPreview();
  if (window.updateStickers) updateStickers();
  if (window.updateBg) updateBg();
}

function togglePlay() {
  if (!S.project) return;
  if (video.paused) {
    if (S.t >= duration() - 1 / FPS) setTime(0);
    video.play();
  } else video.pause();
}
$('#btn-play').onclick = togglePlay;

video.addEventListener('play', () => { $('#btn-play').textContent = '❚❚'; requestAnimationFrame(tick); });
video.addEventListener('pause', () => { $('#btn-play').textContent = '▶'; setTime(video.currentTime); });
video.addEventListener('ended', () => { $('#btn-play').textContent = '▶'; });
video.addEventListener('error', () => toast('视频播放出错，可能是编码格式不支持，建议剪映导出时选H.264', true));

function tick() {
  if (video.paused) return;
  setTime(video.currentTime, true);
  // 播放头快出右侧时自动翻页
  const x = S.t * S.pps - tlScroll.scrollLeft;
  const w = tlScroll.clientWidth;
  if (x > w * 0.85 || x < 0) { tlScroll.scrollLeft = S.t * S.pps - w * 0.15; }
  requestAnimationFrame(tick);
}

document.addEventListener('keydown', e => {
  if (!S.project || $('#editor').hidden) return;
  if (e.target.closest && e.target.closest('input, select, textarea, [contenteditable]')) return;
  if (!$('#busy').hidden || !$('#exp').hidden || !$('#set').hidden) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (!deleteSelectedMain() && !deleteSelectedStk() && !deleteSelectedBg()) deleteSelectedSub(); return; }
  if (e.key === 'Escape') { selectSub(null); selectStk(null); selectBg(null); return; }
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    video.pause();
    const list = e.shiftKey ? S.project.stickers : S.project.subtitles;
    const starts = [...new Set(list.map(x => Math.round(x.start * FPS) / FPS))].sort((a, b) => a - b);
    const cur = Math.round(S.t * FPS) / FPS;
    const t = e.key === 'ArrowDown' ? starts.find(x => x > cur + 1e-6) : [...starts].reverse().find(x => x < cur - 1e-6);
    if (t !== undefined) { setTime(t); keepPlayheadVisible(); }
  }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    video.pause();
    const step = e.shiftKey ? 1 : 1 / FPS;
    setTime(S.t + (e.key === 'ArrowRight' ? step : -step));
    keepPlayheadVisible();
  }
  else if (e.key === 'Home') { setTime(0); keepPlayheadVisible(); }
  else if (e.key === 'End') { setTime(duration()); keepPlayheadVisible(); }
});

function keepPlayheadVisible() {
  const x = S.t * S.pps - tlScroll.scrollLeft, w = tlScroll.clientWidth;
  if (x < 20 || x > w - 20) tlScroll.scrollLeft = S.t * S.pps - w / 2;
}

/* ---------- 时间轴 ---------- */
// 缩放滑块：0到100映射到每秒5到400像素（对数）
const sliderToPps = v => 5 * Math.pow(80, v / 100);
const ppsToSlider = p => (100 * Math.log(p / 5)) / Math.log(80);

function setPps(pps, anchorX) {
  pps = Math.min(400, Math.max(5, pps));
  const tAnchor = (tlScroll.scrollLeft + anchorX) / S.pps;
  S.pps = pps;
  const dur = duration();
  // 视频片段可能比时间线长（尾巴超出部分不导出），时间轴宽度也要放得下
  const far = Math.max(dur, ...S.project.stickers.map(x => x.end || 0));
  tlContent.style.width = Math.ceil(far * pps + tlScroll.clientWidth * 0.5) + 'px';
  tlScroll.scrollLeft = tAnchor * pps - anchorX;
  $('#zoom').value = ppsToSlider(pps);
  renderSubs();
  if (window.renderStickers) renderStickers();
  if (window.renderBgs) renderBgs();
  refreshTimeline();
}

$('#zoom').oninput = e => {
  const ph = S.t * S.pps - tlScroll.scrollLeft;
  const anchor = ph >= 0 && ph <= tlScroll.clientWidth ? ph : tlScroll.clientWidth / 2;
  setPps(sliderToPps(Number(e.target.value)), anchor);
};

tlBody.addEventListener('wheel', e => {
  if (!S.project) return;
  if (e.ctrlKey || e.metaKey) {
    // Cmd＋滚轮或触控板双指捏合：缩放
    e.preventDefault();
    const x = e.clientX - tlScroll.getBoundingClientRect().left;
    setPps(S.pps * Math.exp(-e.deltaY * 0.01), x);
  } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    e.preventDefault();
    tlScroll.scrollLeft += e.deltaY;
  }
}, { passive: false });

tlScroll.addEventListener('scroll', refreshTimeline);

// 在时间轴上点击或拖动：定位播放头
tlBody.addEventListener('mousedown', e => {
  if (!S.project || e.button !== 0) return;
  const r = tlScroll.getBoundingClientRect();
  if (e.clientY - r.top > tlScroll.clientHeight) return; // 点在滚动条上
  if (e.target.closest('.clip')) return;                  // 以后点在字幕块、表情包上另作处理
  S.scrubbing = true;
  video.pause();
  const seek = ev => setTime((ev.clientX - r.left + tlScroll.scrollLeft) / S.pps);
  seek(e);
  const move = ev => seek(ev);
  const up = () => { S.scrubbing = false; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

function sizeCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = tlScroll.clientWidth, h = cv.clientHeight;
  cv.style.width = w + 'px';
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function refreshTimeline() {
  if (!S.project || $('#editor').hidden) return;
  drawRuler();
  drawWave();
  drawPlayhead();
}

const STEPS = [1 / 60 * 6, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
function drawRuler() {
  const { ctx, w, h } = sizeCanvas(rulerCv);
  const sl = tlScroll.scrollLeft, pps = S.pps;
  const step = STEPS.find(s => s * pps >= 70) || 600;
  const minor = step / 5;
  const t0 = Math.floor(sl / pps / minor) * minor;
  const dur = duration();
  ctx.font = '11px -apple-system, "PingFang SC"';
  ctx.textBaseline = 'top';
  for (let t = t0; t * pps - sl < w && t <= dur + 1e-6; t += minor) {
    const x = Math.round(t * pps - sl) + 0.5;
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    ctx.strokeStyle = major ? '#6a6a75' : '#3a3a43';
    ctx.beginPath();
    ctx.moveTo(x, major ? h - 12 : h - 6);
    ctx.lineTo(x, h);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = '#8b8b96';
      ctx.fillText(rulerLabel(t, step), x + 3, 4);
    }
  }
}
function rulerLabel(t, step) {
  const sec = Math.floor(t + 1e-6);
  const base = `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
  if (step >= 1) return base;
  return `${base}.${pad(Math.round((t - sec) * FPS))}f`;
}

// 波形画在每段视频片段里面（stickers.js 的 drawClipWaves）
function drawWave() { if (window.drawClipWaves && S.project && S.project.tracks) drawClipWaves(); }

function drawPlayhead() {
  const ph = $('#playhead');
  const x = S.t * S.pps - tlScroll.scrollLeft;
  ph.style.display = x < -2 || x > tlScroll.clientWidth + 2 ? 'none' : 'block';
  ph.style.left = x + 'px';
}

/* ---------- 字幕 ---------- */
let activeSubId = null;
function subAt(t) {
  const subs = S.project ? S.project.subtitles : [];
  for (const s of subs) {
    if (s.start <= t + 1e-6 && t < s.end - 1e-6) return s;
    if (s.start > t) break;
  }
  return null;
}
function updateSubPreview() {
  const cur = subAt(S.t);
  drawSubPreview(false, cur);
  const id = cur ? cur.id : null;
  if (id !== activeSubId) {
    const old = activeSubId && rowSub.querySelector(`[data-id="${activeSubId}"]`);
    if (old) old.classList.remove('active');
    const now = id && rowSub.querySelector(`[data-id="${id}"]`);
    if (now) now.classList.add('active');
    activeSubId = id;
    if (window.kwPlaying) kwPlaying(id);
  }
}

const rowSub = $('#row-sub');
function renderSubs() {
  if (!S.project) return;
  const frag = document.createDocumentFragment();
  for (const s of S.project.subtitles) {
    const el = document.createElement('div');
    el.className = 'clip sub' + (s.id === S.selSub ? ' selected' : '') + (s.id === activeSubId ? ' active' : '') + (s.style ? ' own' : '') + (s.marks && s.marks.length ? ' kw' : '');
    if (s.style) el.title = s.text + '（这句单独设置了样式）';
    el.dataset.id = s.id;
    el.title = s.text;
    el.innerHTML = '<div class="h h-l"></div><span></span><div class="h h-r"></div>';
    el.querySelector('span').textContent = s.text;
    placeClip(el, s);
    frag.appendChild(el);
  }
  rowSub.replaceChildren(frag);
  if (window.kwRenderSoon) kwRenderSoon();
}
function placeClip(el, s) {
  el.style.left = s.start * S.pps + 'px';
  el.style.width = Math.max(2, (s.end - s.start) * S.pps) + 'px';
}

function selectSub(id) {
  S.selSub = id;
  if (id && window.selectStk && S.selStk) selectStk(null);
  if (id && window.selectBg && S.selBg) selectBg(null);
  if (id && window.switchTab) switchTab('sub');
  rowSub.querySelectorAll('.clip').forEach(el => el.classList.toggle('selected', el.dataset.id === id));
  syncStylePanel();
  drawSubPreview(true);
  if (window.kwOnSelectSub) kwOnSelectSub(id);
}

/* 撤销／重做 */
function snapshot() { return JSON.stringify({ subtitles: S.project.subtitles, stickers: S.project.stickers, tracks: S.project.tracks, vtrack: S.project.video.track, noPic: !!S.project.video.noPic, audio: S.project.audio || null, subStyle: S.project.subStyle, kwStyle: S.project.kwStyle, backgrounds: S.project.backgrounds }); }
function pushUndo(snap) {
  S.undo.push(snap);
  if (S.undo.length > 100) S.undo.shift();
  S.redo = [];
}
function restore(snap) {
  const d = JSON.parse(snap);
  S.project.subtitles = d.subtitles;
  S.project.stickers = d.stickers;
  if (d.tracks) S.project.tracks = d.tracks;
  if (d.vtrack) S.project.video.track = d.vtrack;
  if ('noPic' in d) S.project.video.noPic = d.noPic;
  if ('audio' in d) S.project.audio = d.audio || undefined;
  S.selMain = null;
  if (d.kwStyle) { S.project.kwStyle = d.kwStyle; if (window.kwSync) kwSync(); }
  if (S.cropping && window.cropCancel) cropCancel();
  if (d.subStyle) { S.project.subStyle = d.subStyle; syncStylePanel(); loadSubFont(d.subStyle.fontId).then(() => drawSubPreview(true)); }
  if (!d.subtitles.some(s => s.id === S.selSub)) S.selSub = null;
  activeSubId = null;
  if (!d.stickers.some(s => s.id === S.selStk)) S.selStk = null;
  if (d.backgrounds) { S.project.backgrounds = d.backgrounds; if (!d.backgrounds.some(b => b.id === S.selBg)) S.selBg = null; renderBgs(); syncBgPanel(); drawBgPreview(true); }
  renderSubs();
  renderStickers();
  syncStkPanel();
  syncStylePanel();
  drawSubPreview(true);
  updateSubPreview();
  saveSoon();
  if (window.refreshLibUsed) refreshLibUsed();
}
function undo() {
  if (!S.undo.length) return toast('没有可以撤销的操作');
  S.redo.push(snapshot());
  restore(S.undo.pop());
}
function redo() {
  if (!S.redo.length) return;
  S.undo.push(snapshot());
  restore(S.redo.pop());
}

function deleteSelectedSub() {
  if (!S.selSub) return;
  const i = S.project.subtitles.findIndex(s => s.id === S.selSub);
  if (i < 0) return;
  pushUndo(snapshot());
  S.project.subtitles.splice(i, 1);
  S.selSub = null;
  renderSubs();
  updateSubPreview();
  saveSoon();
}

// 点空白处取消选中
tlBody.addEventListener('mousedown', e => { if (!e.target.closest('.clip')) { selectSub(null); selectStk(null); selectBg(null); } }, true);

// 拖动字幕：拖两端改起止时间，拖中间整体平移；单击选中并跳到这句开头
rowSub.addEventListener('mousedown', e => {
  const el = e.target.closest('.clip');
  if (!el || e.button !== 0) return;
  e.preventDefault();
  video.pause();
  const subs = S.project.subtitles;
  const i = subs.findIndex(s => s.id === el.dataset.id);
  const sub = subs[i];
  const prevEnd = i > 0 ? subs[i - 1].end : 0;
  const nextStart = i < subs.length - 1 ? subs[i + 1].start : duration();
  const mode = e.target.classList.contains('h-l') ? 'l' : e.target.classList.contains('h-r') ? 'r' : 'body';
  const x0 = e.clientX, o = { start: sub.start, end: sub.end }, snap = snapshot();
  let moved = false;
  const MIN = 0.1;
  let noSnap = false;
  const snapT = t => snapTime(t, sub.id, noSnap); // 吸附播放头、其他字幕和表情包的边缘
  const move = ev => {
    noSnap = ev.metaKey;
    const dx = ev.clientX - x0;
    if (!moved && Math.abs(dx) < 3) return;
    moved = true;
    const dt = dx / S.pps;
    if (mode === 'l') sub.start = Math.min(Math.max(snapT(o.start + dt), prevEnd), sub.end - MIN);
    else if (mode === 'r') sub.end = Math.max(Math.min(snapT(o.end + dt), nextStart), sub.start + MIN);
    else {
      const len = o.end - o.start;
      let ns = snapT(o.start + dt);
      const ne = snapT(o.end + dt);
      if (ne === S.t && ns !== S.t) ns = S.t - len; // 结尾吸附播放头
      ns = Math.min(Math.max(ns, prevEnd), nextStart - len);
      sub.start = ns; sub.end = ns + len;
    }
    placeClip(el, sub);
    updateSubPreview();
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (moved) {
      if (sub.start !== o.start || sub.end !== o.end) { pushUndo(snap); saveSoon(); }
      selectSub(sub.id);
    } else {
      selectSub(sub.id);
      setTime(sub.start);
      keepPlayheadVisible();
    }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// 双击改字
rowSub.addEventListener('dblclick', e => {
  const el = e.target.closest('.clip');
  if (el) editSub(el.dataset.id);
});

function editSub(id) {
  const sub = S.project.subtitles.find(s => s.id === id);
  if (!sub) return;
  video.pause();
  $('#sub-edit')?.remove();
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.id = 'sub-edit';
  inp.value = sub.text;
  const w = Math.max(280, Math.min(560, sub.text.length * 16 + 40));
  const left = Math.min(Math.max(0, sub.start * S.pps - tlScroll.scrollLeft), tlBody.clientWidth - w - 8);
  inp.style.left = left + 'px';
  inp.style.top = '0px';
  inp.style.width = w + 'px';
  tlBody.appendChild(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    inp.remove();
    if (!save || v === sub.text) return;
    pushUndo(snapshot());
    if (!v) S.project.subtitles = S.project.subtitles.filter(s => s.id !== id);
    else { sub.marks = remapMarks(sub.text, v, sub.marks); if (!sub.marks) delete sub.marks; sub.text = v; }
    renderSubs();
    updateSubPreview();
    saveSoon();
  };
  inp.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.isComposing || ev.keyCode === 229) return; // 输入法选字时的回车不算
    if (ev.key === 'Enter') finish(true);
    if (ev.key === 'Escape') finish(false);
  });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('mousedown', ev => ev.stopPropagation());
}

/* 识别字幕 */
window.api.onTranscribeProgress(p => {
  $('#busy-text').textContent = `正在识别字幕… ${p}%`;
  $('#busy-bar div').style.width = p + '%';
});
$('#busy-cancel').onclick = () => window.api.cancelTranscribe();
$('#btn-asr').onclick = () => runASR(true);

async function runASR(ask) {
  if (!S.project) return;
  if (ask && S.project.subtitles.length && !confirm('重新识别会替换现在的全部字幕（之后可以Cmd＋Z撤销），继续吗？')) return;
  video.pause();
  busy('正在加载识别模型…（第一次会慢一点）');
  $('#busy-bar').hidden = false;
  $('#busy-bar div').style.width = '0%';
  $('#busy-cancel').hidden = false;
  try {
    const t0 = Date.now();
    const { cues, mode } = await window.api.transcribe({ dir: S.dir, duration: duration() });
    pushUndo(snapshot());
    S.project.subtitles = cues;
    S.selSub = null;
    activeSubId = null;
    renderSubs();
    updateSubPreview();
    saveSoon();
    unbusy();
    const how = mode.dtw && mode.vad ? '精确对轨＋人声检测' : mode.dtw ? '精确对轨' : mode.vad ? '人声检测' : '基础模式';
    toast(`识别完成：${cues.length}句字幕，用时${Math.round((Date.now() - t0) / 1000)}秒（${how}）`, false, 4000);
  } catch (e) {
    unbusy();
    const m = errMsg(e);
    if (m.includes('已取消')) toast('已取消识别');
    else toast('字幕识别失败：' + m, true);
  }
}

window.api.toolsStatus().then(st => {
  const tip = $('#tool-tip');
  if (!st.whisper || !st.model) {
    tip.textContent = !st.whisper ? '提示：没找到whisper-cli，字幕识别用不了' : '提示：没找到识别模型，字幕识别用不了';
    tip.classList.add('warn');
  }
});


/* ---------- 预览字幕（canvas，和导出同一套画法） ---------- */
const subCv = $('#sub-cv');
let lastSubKey = '';
function sizeSubCanvas(w, h) {
  const dpr = window.devicePixelRatio || 1;
  subCv.width = Math.round(w * dpr);
  subCv.height = Math.round(h * dpr);
  drawSubPreview(true);
}
function drawSubPreview(force, cur) {
  if (!S.project) return;
  if (cur === undefined) cur = subAt(S.t);
  let text = cur ? cur.text : '';
  let st = effStyle(cur);
  if (!text && S.styleHover) { text = '这是一句字幕的样式预览'; st = effStyle(scopeSub()); }
  const key = text + '|' + subCv.width + '|' + JSON.stringify(st);
  if (!force && key === lastSubKey) return;
  lastSubKey = key;
  const ctx = subCv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, subCv.width, subCv.height);
  const { w: W, h: H } = S.project.canvas;
  ctx.setTransform(subCv.width / W, 0, 0, subCv.height / H, 0, 0);
  drawSubtitle(ctx, text, st, W, H, cur && cur.text === text ? cur.marks : null, S.project.kwStyle);
}

/* ---------- 字幕样式面板 ---------- */
const COLORS = {
  color: ['#FFFFFF', '#141414', '#FFE14D', '#FF4D4F', '#FF9C3D', '#36CFC9', '#4096FF', '#95DE64', '#FF85C0'],
  outlineColor: ['#000000', '#FFFFFF', '#3A2A1A', '#1F3A8A'],
  boxColor: ['#000000', '#3C3C3C', '#FFFFFF', '#1F3A8A', '#7A3B2E'],
};
const panel = $('#side');
let pendingSnap = null; // 拖动滑块时，整段拖动只记一次撤销

// 单句样式：选中一句字幕、并且选了“只改选中这句”时，改动只记在这一句的style里（覆盖全片统一样式）
S.subScope = 'all';
const scopeSub = () => (S.subScope === 'one' && S.selSub ? S.project.subtitles.find(x => x.id === S.selSub) : null);
const effStyle = sub => (sub && sub.style ? { ...S.project.subStyle, ...sub.style } : S.project.subStyle);
function setStyle(patch, commit) {
  if (!pendingSnap) pendingSnap = snapshot();
  const one = scopeSub();
  if (one) one.style = { ...(one.style || {}), ...patch };
  else Object.assign(S.project.subStyle, patch);
  if (commit) { pushUndo(pendingSnap); pendingSnap = null; if (one) renderSubs(); }
  syncStylePanel();
  const st = effStyle(one);
  loadSubFont(st.fontId).then(() => drawSubPreview(true));
  drawSubPreview(true);
  saveSoon();
}
document.querySelectorAll('#sub-scope button').forEach(b => {
  b.onclick = () => { S.subScope = b.dataset.v; syncStylePanel(); drawSubPreview(true); };
});

// 预设按钮
SUB_PRESETS.forEach(p => {
  const b = document.createElement('button');
  b.className = 'preset';
  b.textContent = p.name;
  b.style.color = p.st.color;
  if (p.st.box) b.style.background = hexToRgba(p.st.boxColor, Math.max(0.6, p.st.boxOpacity));
  else if (p.st.color === '#141414') b.style.background = '#9aa3b2';
  if (p.st.outline) b.style.webkitTextStroke = `1px ${p.st.outlineColor}`;
  b.style.paintOrder = 'stroke fill';
  b.onclick = () => setStyle({ ...p.st }, true);
  $('#st-presets').appendChild(b);
});

// 字体
SUB_FONTS.forEach(f => {
  const o = document.createElement('option');
  o.value = f.id;
  o.textContent = f.name;
  $('#st-font').appendChild(o);
});
$('#st-font').onchange = e => setStyle({ fontId: e.target.value }, true);

// 色块
document.querySelectorAll('.swatches[data-key]').forEach(box => {
  const key = box.dataset.key;
  COLORS[key].forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'sw';
    sw.style.background = c;
    sw.dataset.c = c;
    sw.title = c;
    sw.onclick = () => setStyle({ [key]: c }, true);
    box.appendChild(sw);
  });
  const custom = document.createElement('label');
  custom.className = 'sw custom';
  custom.title = '自定义颜色';
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.oninput = () => setStyle({ [key]: inp.value.toUpperCase() }, false);
  inp.onchange = () => setStyle({ [key]: inp.value.toUpperCase() }, true);
  custom.appendChild(inp);
  box.appendChild(custom);
});

// 滑块
const sliders = [
  ['#st-size', 'size', v => v],
  ['#st-outline', 'outline', v => v],
  ['#st-boxop', 'boxOpacity', v => v / 100],
  ['#st-margin', 'marginV', v => v],
];
sliders.forEach(([sel, key, fn]) => {
  const el = $(sel);
  el.oninput = () => setStyle({ [key]: fn(Number(el.value)) }, false);
  el.onchange = () => setStyle({ [key]: fn(Number(el.value)) }, true);
});
$('#st-box').onchange = e => setStyle({ box: e.target.checked }, true);
$('#st-reset').onclick = () => {
  const one = scopeSub();
  if (one) {
    // 这一句恢复成统一样式
    if (!one.style) return;
    pushUndo(snapshot());
    delete one.style;
    renderSubs(); syncStylePanel(); drawSubPreview(true); saveSoon();
    return toast('这一句已恢复成统一样式', false, 1200);
  }
  setStyle(defaultSubStyle(S.project.canvas), true);
};

function syncStylePanel() {
  if (!S.project) return;
  const one = scopeSub();
  const st = effStyle(one);
  // 选中了一句字幕时，才出现“改全部／只改这句”的选择
  const sel = S.selSub && S.project.subtitles.find(x => x.id === S.selSub);
  $('#sub-scope-box').hidden = !sel;
  document.querySelectorAll('#sub-scope button').forEach(b => b.classList.toggle('on', b.dataset.v === S.subScope));
  if (sel) $('#sub-scope-tip').textContent = S.subScope === 'one'
    ? `正在单独改：“${sel.text.slice(0, 12)}${sel.text.length > 12 ? '…' : ''}”${sel.style ? '（已单独设置，点最下面“恢复默认”可以改回统一样式）' : ''}`
    : '现在改的是全部字幕；单独设置过的句子会保留自己的改动';
  $('#st-reset').textContent = one ? '这句恢复统一样式' : '恢复默认';
  $('#st-font').value = st.fontId;
  $('#st-size').value = st.size; $('#v-size').textContent = st.size;
  $('#st-outline').value = st.outline; $('#v-outline').textContent = st.outline ? st.outline : '无';
  $('#st-box').checked = st.box;
  $('#box-opts').classList.toggle('off', !st.box);
  $('#st-boxop').value = Math.round(st.boxOpacity * 100); $('#v-boxop').textContent = Math.round(st.boxOpacity * 100) + '%';
  $('#st-margin').max = Math.round(S.project.canvas.h * 0.6);
  $('#st-margin').value = st.marginV; $('#v-margin').textContent = st.marginV;
  document.querySelectorAll('.swatches[data-key]').forEach(box => {
    const v = (st[box.dataset.key] || '').toUpperCase();
    let hit = false;
    box.querySelectorAll('.sw[data-c]').forEach(sw => { const on = sw.dataset.c.toUpperCase() === v; sw.classList.toggle('on', on); hit = hit || on; });
    const cu = box.querySelector('.sw.custom');
    cu.classList.toggle('on', !hit);
    cu.querySelector('input').value = /^#[0-9A-F]{6}$/i.test(v) ? v.toLowerCase() : '#ffffff';
  });
}

// 鼠标在面板上时，没字幕的地方也显示一句示例，方便看效果
panel.addEventListener('mouseenter', () => { S.styleHover = true; drawSubPreview(true); });
panel.addEventListener('mouseleave', () => { S.styleHover = false; drawSubPreview(true); });

// 点完面板上的按钮把焦点还给页面，避免空格误触按钮
document.addEventListener('click', e => { if (e.target.closest('#side button, #player button, #topbar button, #lib button')) e.target.closest('button').blur(); });

/* 全部字幕整体平移 */
function shiftAll(d) {
  if (!S.project || !S.project.subtitles.length) return;
  pushUndo(snapshot());
  const dur = duration();
  for (const c of S.project.subtitles) {
    const len = c.end - c.start;
    c.start = Math.min(Math.max(0, c.start + d), dur - len);
    c.end = c.start + len;
  }
  renderSubs();
  updateSubPreview();
  saveSoon();
  toast(d > 0 ? '全部字幕推后了0.1秒' : '全部字幕提前了0.1秒', false, 1200);
}
$('#btn-shift-l').onclick = () => shiftAll(-0.1);
$('#btn-shift-r').onclick = () => shiftAll(0.1);

/* 导入剪映导出的SRT字幕 */
async function loadSrt(file, ask) {
  if (!S.project) return;
  if (ask && S.project.subtitles.length && !confirm('导入会替换现在的全部字幕（之后可以Cmd＋Z撤销），继续吗？')) return;
  try {
    const cues = await window.api.loadSrt({ file, duration: duration() });
    pushUndo(snapshot());
    S.project.subtitles = cues;
    S.selSub = null;
    activeSubId = null;
    renderSubs();
    updateSubPreview();
    saveSoon();
    toast(`已导入剪映字幕：${cues.length}句`);
  } catch (e) {
    toast('导入字幕失败：' + errMsg(e), true);
  }
}
$('#btn-srt').onclick = async () => {
  const f = await window.api.pickSrt();
  if (f) loadSrt(f, true);
};

/* 字幕这一行的眼睛：隐藏后预览和导出都不出现（视频、背景、表情包在数字轨道上，各条轨道有自己的眼睛） */
function applyTrackVis() {
  if (!S.project) return;
  const h = S.project.hidden || {};
  document.querySelectorAll('.eye[data-track="sub"]').forEach(b => b.classList.toggle('off', !!h.sub));
  document.querySelector('.r-sub').classList.toggle('track-off', !!h.sub);
  $('#sub-cv').style.visibility = h.sub ? 'hidden' : '';
  if (window.applyLayerZ && S.project.tracks) applyLayerZ();
}
document.querySelectorAll('.eye[data-track="sub"]').forEach(b => {
  b.addEventListener('mousedown', e => e.stopPropagation());
  b.onclick = () => {
    if (!S.project) return;
    S.project.hidden = { ...(S.project.hidden || {}), sub: !(S.project.hidden || {}).sub };
    applyTrackVis();
    saveSoon();
    toast(S.project.hidden.sub ? '已隐藏字幕，导出时也不会出现' : '已显示字幕', false, 1500);
  };
});

/* Cmd＋S：立刻保存，并提示保存成功（自动保存照常进行） */
async function saveNow() {
  if (!S.dir || !S.project) return;
  clearTimeout(S.saveTimer);
  try {
    await window.api.saveProject({ dir: S.dir, data: S.project });
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    toast(`✓ 保存成功　${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`, false, 1500);
  } catch (e) {
    toast('保存失败：' + errMsg(e), true);
  }
}
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); }
}, true);

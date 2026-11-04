// 导出窗口（参考剪映：左边封面，右边设置，底部显示时长、大小、用时）
const EX = { range: 'all', quality: 'h264', folder: '', title: '', running: false, t0: 0, lastOut: '', estToken: 0 };
const expEl = $('#exp');
const fmtSec = s => (s >= 60 ? `${Math.floor(s / 60)}分${Math.round(s % 60)}秒` : `${Math.max(1, Math.round(s))}秒`);
const fmtSize = b => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? Math.round(b / 1e6) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');

function expMode(part) {
  $('#exp-form').hidden = part !== 'form';
  $('#exp-run').hidden = part !== 'run';
  $('#exp-done').hidden = part !== 'done';
  $('#exp-btns-form').hidden = part !== 'form';
  $('#exp-btns-run').hidden = part !== 'run';
  $('#exp-btns-done').hidden = part !== 'done';
}
const expRange = () => {
  const pv = EX.range === 'preview';
  return pv ? { start: S.t, end: Math.min(duration(), S.t + 5) } : { start: 0, end: duration() };
};

function expSync() {
  document.querySelectorAll('#exp [data-key]').forEach(g => {
    g.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === EX[g.dataset.key]));
  });
  const c = S.project.canvas;
  $('#exp-res').textContent = `${c.w}×${c.h}（${c.w > c.h ? '横版' : '竖版'}）`;
  $('#exp-fps').textContent = `${c.fps || 60}帧`;
  $('#exp-folder').textContent = EX.folder.replace(/^\/Users\/[^/]+/, '~');
  $('#exp-folder').title = EX.folder;
  const pv = EX.range === 'preview';
  // 写清楚导出的是哪一段，以及这段里有几张表情包，免得以为漏了
  const r = expRange();
  const hid = S.project.hidden || {};
  const nStk = hid.stk ? 0 : S.project.stickers.filter(s => s.end > r.start && s.start < r.end).length;
  $('#exp-range-tip').innerHTML = `导出 <b>${fmt(r.start)} – ${fmt(r.end)}</b>　这段里有 <b>${nStk}</b> 张表情包${pv ? '（试看从播放头开始，想看别的位置先把播放头拖过去）' : ''}`;
  $('#exp-title').disabled = pv;
  $('#exp-go').textContent = pv ? '导出试看' : '导出';
  expEstimate();
}

// 封面：把当前画面（视频＋表情包＋字幕）画出来
function drawCover() {
  const cv = $('#exp-cover');
  const { w: W, h: H } = S.project.canvas;
  const scale = 640 / Math.max(W, H);
  cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
  const ctx = cv.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const hid = S.project.hidden || {};
  const t = S.t;
  const vis = x => !(trackOf(x) && trackOf(x).hidden);
  // 按轨道从下往上画：背景段、原视频、表情包（和导出一样）
  const items = [];
  S.project.backgrounds.filter(b => t >= b.start && t < b.end && vis(b)).forEach(b => items.push({ layer: b.layer || 0, k: 0, draw: () => drawBackground(ctx, b, t - b.start, W, H) }));
  if (S.project.video.kind !== 'audio' && !S.project.video.noPic && vis(S.project.video)) items.push({ layer: S.project.video.layer || 0, k: 1, draw: () => {
    try {
      const vr = video.videoWidth / video.videoHeight, cr = W / H;
      const dw = vr > cr ? W : H * vr, dh = vr > cr ? W / vr : H;
      ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } catch {}
  } });
  S.project.stickers.forEach((s, i) => {
    if (t >= s.start && t < s.end && vis(s)) items.push({ layer: s.layer || 0, k: 2 + i / 1e6, draw: () => { const m = stkMedia(s.id); if (m) (isTier(s) ? drawTierCanvas(ctx, s, m, t) : drawStkCanvas(ctx, s, m)); } });
  });
  items.sort((a, b) => a.layer - b.layer || a.k - b.k).forEach(x => x.draw());
  const sub = !hid.sub && subAt(t);
  if (sub) drawSubtitle(ctx, sub.text, effStyle(sub), W, H, sub.marks, S.project.kwStyle);
  // 竖版封面不要太高
  cv.style.maxHeight = '420px';
  cv.style.objectFit = 'contain';
}

// 导出用的项目：隐藏的轨道不导出
function exportProject() {
  const p = JSON.parse(JSON.stringify(S.project));
  const h = p.hidden || {};
  // 每条轨道自己的眼睛：隐藏的轨道上的表情包、背景、原视频都不导出；layer＝轨道序号
  // 从夯到拉：每张图的起点、终点、时间算好交给导出（和预览用同一套算法）
  p.stickers.forEach(s => { if (s.tier) { const live = getStk(s.id); const A = live && tierAnimFor(live); if (A) s.tierAnim = A; else delete s.tier; } });
  const hidTracks = new Set((p.tracks || []).filter(t => t.hidden).map(t => t.id));
  p.stickers = p.stickers.filter(s => !hidTracks.has(s.track));
  p.backgrounds = (p.backgrounds || []).filter(b => !hidTracks.has(b.track));
  const isVid = p.video.kind !== 'audio';
  if (hidTracks.has(p.video.track) || (isVid && p.video.noPic)) p.hideVideo = true;
  // 喇叭关掉的轨道：母体视频没有声音、插入视频也不出声
  const muteTracks = new Set((p.tracks || []).filter(t => t.muted).map(t => t.id));
  // 视频项目的声音是单独的片段：删了、静音、隐藏都不要原声；录音项目看它自己那条轨道
  if (isVid ? (!p.audio || p.audio.removed || muteTracks.has(p.audio.track) || hidTracks.has(p.audio.track)) : muteTracks.has(p.video.track)) p.muteMain = true;
  p.stickers.forEach(s => { if (muteTracks.has(s.track)) s.sound = false; });
  if (h.sub) p.subtitles = [];
  return p;
}
const loopsFor = (r, cb) => ensureBgLoops(r, cb);

// 底部信息：时长｜大小（估计）｜预计用时
async function expEstimate() {
  const r = expRange();
  const D = r.end - r.start;
  const token = ++EX.estToken;
  $('#exp-info').textContent = `时长：${fmtSec(D)}　|　大小：估算中…　|　预计用时：估算中…`;
  try {
    const bgLoops = await loopsFor(r, msg => { if (token === EX.estToken) $('#exp-info').textContent = `时长：${fmtSec(D)}　|　${msg}`; });
    if (token !== EX.estToken) return;
    $('#exp-info').textContent = `时长：${fmtSec(D)}　|　大小：估算中…　|　预计用时：估算中…`;
    const est = await window.api.exportEstimate({ dir: S.dir, project: exportProject(), quality: EX.quality, range: r, bgLoops });
    if (token !== EX.estToken) return;
    $('#exp-info').textContent = `时长：${fmtSec(D)}　|　大小：约${fmtSize(est.size)}　|　预计用时：约${fmtSec(est.time)}`;
  } catch {
    if (token === EX.estToken) $('#exp-info').textContent = `时长：${fmtSec(D)}`;
  }
}

async function openExport() {
  if (!S.project || EX.running) return;
  video.pause();
  const d = await window.api.exportDefaults();
  EX.folder = d.folder;
  EX.title = d.title;
  EX.quality = d.quality;
  $('#exp-title').value = EX.title;
  expMode('form');
  expEl.hidden = false;
  $('.exp-card').style.transform = '';
  drawCover();
  expSync();
}
$('#btn-export').onclick = openExport;

// 快捷键快速导出：不用点设置，直接用上次的编码和文件夹，导出整段
async function quickExport() {
  if (!S.project || EX.running) return;
  video.pause();
  const d = await window.api.exportDefaults();
  Object.assign(EX, { folder: d.folder, title: d.title, quality: d.quality, range: 'all' });
  $('#exp-title').value = EX.title;
  expEl.hidden = false;
  $('.exp-card').style.transform = '';
  drawCover();
  $('#exp-info').textContent = `快速导出：${$('#exp [data-v="' + EX.quality + '"] b').textContent}，存到 ${EX.folder.replace(/^\/Users\/[^/]+/, '~')}`;
  startExport();
}
document.querySelectorAll('#exp [data-key] button').forEach(b => {
  b.onclick = () => { EX[b.closest('[data-key]').dataset.key] = b.dataset.v; expSync(); };
});
$('#exp-title').oninput = e => { EX.title = e.target.value; };
$('#exp-title').addEventListener('keydown', e => e.stopPropagation());
$('#exp-change').onclick = async () => {
  const f = await window.api.exportPickFolder({ folder: EX.folder });
  if (f) { EX.folder = f; expSync(); }
};
const closeExp = () => { expEl.hidden = true; EX.estToken++; };
$('#exp-close').onclick = closeExp;
$('#exp-ok').onclick = closeExp;
$('#exp-reveal').onclick = () => window.api.showInFolder(EX.lastOut);
$('#exp-play').onclick = () => window.api.openFile(EX.lastOut);
$('#exp-cancel').onclick = () => window.api.exportCancel();

// 窗口可以按住标题栏拖动
$('#exp-head').addEventListener('mousedown', e => {
  const card = $('.exp-card');
  const m = (card.style.transform.match(/-?\d+(\.\d+)?/g) || [0, 0]).map(Number);
  const x0 = e.clientX - m[0], y0 = e.clientY - m[1];
  const move = ev => { card.style.transform = `translate(${ev.clientX - x0}px, ${ev.clientY - y0}px)`; };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// 把每句字幕画成整幅透明PNG（和预览同一套画法）
const toPNG = cv => new Promise(r => cv.toBlob(b => b.arrayBuffer().then(a => r(new Uint8Array(a))), 'image/png'));
async function renderSubPNGs(T0, T1) {
  const { w: W, h: H } = S.project.canvas;
  const st = S.project.subStyle;
  await loadSubFont(st.fontId);
  // 单独设置过字体的句子，字体也要先加载
  for (const f of new Set(S.project.subtitles.filter(x => x.style && x.style.fontId).map(x => x.style.fontId))) await loadSubFont(f);
  await document.fonts.ready;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const blank = await toPNG(cv);
  const list = (S.project.hidden || {}).sub ? [] : S.project.subtitles.filter(s => s.end > T0 && s.start < T1);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawSubtitle(ctx, s.text, effStyle(s), W, H, s.marks, S.project.kwStyle);
    out.push({ bytes: await toPNG(cv), start: Math.max(0, s.start - T0), end: Math.min(T1, s.end) - T0 });
    if (i % 10 === 0) $('#exp-status').textContent = `正在准备字幕… ${i + 1}/${list.length}`;
  }
  return { subs: out, blank };
}

window.api.onExportProgress(p => {
  const pct = Math.round(p * 100);
  $('#exp-bar').style.width = pct + '%';
  $('#exp-status').textContent = `正在导出… ${pct}%`;
  const el = (Date.now() - EX.t0) / 1000;
  if (p > 0.02) $('#exp-eta').textContent = `已用${fmtSec(el)}，预计还要${fmtSec(Math.max(0, el / p - el))}`;
});

$('#exp-go').onclick = () => startExport();
async function startExport() {
  const preview = EX.range === 'preview';
  const r = expRange();
  if (r.end - r.start < 0.2) return toast('播放头太靠后了，往前挪一点再试看', true);
  EX.estToken++;
  EX.running = true;
  expMode('run');
  $('#exp-bar').style.width = '0%';
  $('#exp-eta').textContent = '';
  $('#exp-status').textContent = '正在准备字幕…';
  try {
    const bgLoops = await loopsFor(r, msg => { $('#exp-status').textContent = msg; });
    const { subs, blank } = await renderSubPNGs(r.start, r.end);
    // 圆形、圆角素材的遮罩
    const proj = exportProject();
    const masks = [];
    for (const s of proj.stickers.filter(x => x.end > r.start && x.start < r.end)) {
      const b = await stkMaskPNG(s);
      if (b) masks.push({ id: s.id, bytes: b });
    }
    // 文本：把预览里那张画布存成PNG
    const texts = [];
    for (const s of proj.stickers.filter(x => x.type === 'text' && x.end > r.start && x.start < r.end)) {
      const live = getStk(s.id);
      if (live) refreshText(live);
      const cv = stkMedia(s.id);
      if (cv) texts.push({ id: s.id, bytes: await new Promise(res => cv.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), 'image/png')) });
    }
    EX.t0 = Date.now();
    $('#exp-status').textContent = '正在导出… 0%';
    const res = await window.api.exportStart({
      dir: S.dir,
      project: proj,
      quality: EX.quality,
      range: r, subs, blank, preview, masks, texts,
      folder: EX.folder, title: EX.title, bgLoops,
    });
    EX.lastOut = res.out;
    const used = fmtSec((Date.now() - EX.t0) / 1000);
    $('#exp-done-path').textContent = res.out;
    $('#exp-done-info').textContent = `大小 ${fmtSize(res.size)}　用时 ${used}`;
    $('#exp-info').textContent = '';
    $('.exp-ok').textContent = preview ? '✓ 试看已导出，已经帮你打开播放' : '✓ 导出完成，已经帮你打开播放';
    expMode('done');
  } catch (e) {
    const m = errMsg(e);
    toast(m.includes('已取消') ? '已取消导出' : '导出失败：' + m, !m.includes('已取消'));
    expMode('form');
    expEstimate();
  } finally {
    EX.running = false;
  }
}

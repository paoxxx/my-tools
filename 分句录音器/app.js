'use strict';
// 分句录音器 渲染进程：提词、分句录音、时间线拖动裁剪、交叉渐变、增益、导出
const $ = (s) => document.querySelector(s);
const bridge = window.api;

// ====================== 状态 ======================
// state.sentences: [{id, text}]
// state.clips:     [{sid, take, start, offset, dur, gainDb}]  一句最多一个片段（重录覆盖）
let state = null;
const takes = new Map();          // takeId -> {data: Float32Array, sr, peaks, saved}
let selSid = null;                // 选中的片段（句子id）
let playhead = 0;                 // 播放头（秒）
const view = { x0: 0 };           // 时间线左边缘对应的时间（秒）
let undoStack = [], redoStack = [];

const PREFS_KEY = 'fenju-prefs';
const DEFAULT_PREFS = { fontSize: 30, scrollMode: 'follow', scrollSpeed: 40, gap: 0.3, ripple: true, autoTrim: true,
  waveZoom: 1, pxPerSec: 120, lufsTarget: -14, fadeIn: 0.08, fadeOut: 0.2, roomTone: true, denoise: 0, limiter: true, leveler: true, deviceId: '', prompterWidth: 420 };
let prefs = loadPrefs();
if (!localStorage.getItem('fenju-v12')) { prefs.waveZoom = 1; prefs.fadeIn = 0.08; prefs.fadeOut = 0.2; prefs.roomTone = true; savePrefs(); localStorage.setItem('fenju-v12', '1'); }

function loadPrefs() { try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch (e) { return { ...DEFAULT_PREFS }; } }
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }

const PALETTE = ['#ff5c8a', '#ffb020', '#3ddc97', '#4fb3ff', '#b388ff', '#ff7a45', '#2ee6d6', '#f5e14b'];
const segColor = (i) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad = (n) => String(n).padStart(2, '0');
function newProjectName() { const d = new Date(); return `工程 ${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}${pad(d.getMinutes())}`; }
if (prefs.breathProfile && !prefs.breathSamples) { prefs.breathSamples = [{ shape: prefs.breathProfile.shape, rel: prefs.breathProfile.relDb }]; }
const freshBreath = () => ({ on: !!(prefs.breathSamples && prefs.breathSamples.length), amountDb: prefs.breathDb || 12, mode: prefs.breathMode || 'mute' });
const bp = () => (prefs.breathSamples && prefs.breathSamples.length ? prefs.breathSamples : null);   // 吸气样本是全局的：录音环境和麦克风固定，标一次以后每个工程都能用
function freshState() { return { name: newProjectName(), sentences: [], clips: [], cur: 0, masterGainDb: 0, breath: freshBreath(), marks: {} }; }

const clipOf = (sid) => state.clips.find((c) => c.sid === sid);
const sIndex = (sid) => state.sentences.findIndex((s) => s.id === sid);
const clipEnd = (c) => c.start + c.dur;
const sortedClips = () => [...state.clips].sort((a, b) => a.start - b.start);
const dbToLin = (db) => Math.pow(10, db / 20);
const takeLen = (c) => { const t = takes.get(c.take); return t.data.length / t.sr; };

function fmtTime(t) { const m = Math.floor(t / 60); const s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; }
function setStatus(msg, cls) { const el = $('#status'); el.textContent = msg; el.className = cls || ''; }

// ====================== 撤销 ======================
function snapshot() { return JSON.stringify({ sentences: state.sentences, clips: state.clips, cur: state.cur, masterGainDb: state.masterGainDb, marks: state.marks }); }
function liveMarks() { const o = {}; for (const c of state.clips) if (state.marks[c.take] && state.marks[c.take].length) o[c.take] = state.marks[c.take]; return o; }
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 150) undoStack.shift(); redoStack = []; }
function undo() { if (!undoStack.length) return setStatus('没有可撤销的操作'); redoStack.push(snapshot()); restore(undoStack.pop()); setStatus('已撤销'); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); setStatus('已重做'); }
function restore(s) {
  const o = JSON.parse(s);
  Object.assign(state, { marks: {} }, o);
  if (selSid && !clipOf(selSid)) selSid = null;
  renderPrompter(); syncMasterUI(); changed();
}

// ====================== 保存 / 读取 ======================
let saveTimer = null;
function changed() { draw(); updateSelUI(); renderFoot(); clearTimeout(saveTimer); saveTimer = setTimeout(saveProject, 700); }

async function saveProject() {
  if (!state || (!state.sentences.length && !state.clips.length)) return;
  const files = [];
  for (const [id, t] of takes) {
    if (!t.saved && state.clips.some((c) => c.take === id)) files.push({ name: id + '.wav', bytes: encodeWav(t.data, t.sr, 'float') });
  }
  const json = JSON.stringify({ version: 1, name: state.name, sentences: state.sentences, clips: state.clips, cur: state.cur, masterGainDb: state.masterGainDb, breath: state.breath, marks: liveMarks() }, null, 1);
  try {
    await bridge.saveProject(state.name, json, files);
    { const d = new Date(); $('#savedAt').textContent = `已自动保存 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
    files.forEach((f) => { const t = takes.get(f.name.replace(/\.wav$/, '')); if (t) t.saved = true; });
    localStorage.setItem('fenju-last', state.name);
  } catch (e) { setStatus('自动保存失败：' + e.message, 'err'); }
}

async function loadProject(name) {
  const r = await bridge.loadProject(name);
  const o = JSON.parse(r.json);
  takes.clear();
  for (const [fn, bytes] of Object.entries(r.files)) {
    const w = decodeWav(bytes);
    if (!w.data) continue;
    const data = await resampleHQ(w.data, w.sr, actx.sampleRate);
    takes.set(fn.replace(/\.wav$/, ''), { data, sr: actx.sampleRate, peaks: null, saved: w.sr === actx.sampleRate });
  }
  state = { name, sentences: o.sentences || [], clips: (o.clips || []).filter((c) => takes.has(c.take)), cur: o.cur || 0, masterGainDb: o.masterGainDb || 0, breath: { ...freshBreath(), on: !!(o.breath && o.breath.on), amountDb: (o.breath && o.breath.amountDb) || 12, mode: (o.breath && o.breath.mode) || prefs.breathMode || 'mute' } };
  if (o.breath && o.breath.profile && !bp()) { prefs.breathSamples = [{ shape: o.breath.profile.shape, rel: o.breath.profile.relDb }]; savePrefs(); }
  state.marks = o.marks || {};
  undoStack = []; redoStack = []; selSid = null; playhead = 0; view.x0 = 0;
  localStorage.setItem('fenju-last', name);
  afterProjectSwitch();
  setStatus(`已打开：${name}`);
}

function showProjName() { $('#projTitle').textContent = state.name; document.title = `分句录音器 · ${state.name}`; }
function afterProjectSwitch() {
  showProjName(); $('#savedAt').textContent = '';
  $('#projName').value = state.name;
  rangeSel = null;
  syncMasterUI(); syncBreathUI();
  setEditing(state.sentences.length === 0);
  renderPrompter(); changed();
}

async function newProject() {
  if (recording) return;
  stopPlay();
  clearTimeout(saveTimer); await saveProject();
  takes.clear();
  state = freshState();
  { const base = state.name; let k = 2; while (await bridge.projectExists(state.name)) state.name = `${base} (${k++})`; }   // 同一分钟内新建也不会重名覆盖
  undoStack = []; redoStack = []; selSid = null; playhead = 0; view.x0 = 0; markHistory.length = 0;
  afterProjectSwitch();
  setStatus('新建了工程：' + state.name + '（自动保存，录第一段后就会出现在“打开”列表里）');
}

async function showOpenDialog() {
  const list = await bridge.listProjects();
  const box = $('#projList'); box.innerHTML = '';
  if (!list.length) box.innerHTML = '<div style="color:#888;padding:10px">还没有工程</div>';
  list.forEach((p) => {
    const d = new Date(p.mtime);
    const el = document.createElement('div'); el.className = 'proj-item';
    el.innerHTML = `<div></div><span>${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}</span>`;
    el.firstChild.textContent = p.name;
    el.onclick = async () => { $('#modal').classList.add('hidden'); stopPlay(); clearTimeout(saveTimer); await saveProject(); await loadProject(p.name); };
    box.appendChild(el);
  });
  $('#modal').classList.remove('hidden');
}

async function renameProject(newName) {
  newName = newName.trim().replace(/[\/:\\]/g, '-');
  if (!newName || newName === state.name) { $('#projName').value = state.name; return; }
  clearTimeout(saveTimer);
  const r = await bridge.renameProject(state.name, newName);
  if (!r.ok) { setStatus(r.error, 'warn'); $('#projName').value = state.name; return; }
  state.name = newName; $('#projName').value = newName; showProjName();
  await saveProject();
  setStatus('工程已改名：' + newName);
}

// ====================== WAV 编解码 ======================
function encodeWav(data, sr, fmt) {
  const bps = fmt === 'float' ? 4 : 2;
  const len = data.length * bps;
  const buf = new ArrayBuffer(44 + len);
  const v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + len, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, fmt === 'float' ? 3 : 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * bps, true); v.setUint16(32, bps, true); v.setUint16(34, bps * 8, true);
  ws(36, 'data'); v.setUint32(40, len, true);
  if (fmt === 'float') new Float32Array(buf, 44, data.length).set(data);
  else for (let i = 0, o = 44; i < data.length; i++, o += 2) { const s = Math.max(-1, Math.min(1, data[i])); v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true); }
  return new Uint8Array(buf);
}

function decodeWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 12, fmt = 1, ch = 1, sr = 48000, bits = 16, data = null;
  while (p + 8 <= v.byteLength) {
    const id = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
    const sz = v.getUint32(p + 4, true), b = p + 8;
    if (id === 'fmt ') { fmt = v.getUint16(b, true); ch = v.getUint16(b + 2, true); sr = v.getUint32(b + 4, true); bits = v.getUint16(b + 14, true); }
    else if (id === 'data') {
      const bpsmp = bits / 8, n = Math.floor(Math.min(sz, v.byteLength - b) / bpsmp / ch);
      data = new Float32Array(n);
      for (let i = 0; i < n; i++) { const o = b + i * ch * bpsmp; data[i] = fmt === 3 ? v.getFloat32(o, true) : v.getInt16(o, true) / 32768; }
    }
    p = b + sz + (sz & 1);
  }
  return { data, sr };
}

function resample(d, from, to) {
  const n = Math.round(d.length * to / from), out = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) { const x = i * r, i0 = Math.floor(x), f = x - i0; out[i] = (d[i0] || 0) * (1 - f) + (d[i0 + 1] || 0) * f; }
  return out;
}

// ====================== 音频引擎 ======================
let actx = null, micStream = null, micSource = null, recNode = null;
const PREROLL = 0.3;              // 按R之前预先保留0.3秒，防止吃掉第一个字
let ring = [], ringLen = 0;
let recording = false, recChunks = [], recLen = 0, recPreroll = 0, recPeaks = [];
let meterPeak = 0, meterShown = 0;

async function ensureAudio() {
  if (actx) return;
  actx = new AudioContext({ latencyHint: 'interactive' });
  const code = "class R extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true;}}registerProcessor('rec',R);";
  await actx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
}

// 采集：优先用 MediaStreamTrackProcessor 直接从麦克风读数据，按麦克风自己的时钟走，
// 不经过 AudioContext（输出设备时钟和无线麦时钟对不上时，会出现“啪啪”的爆点）
let micReader = null, micRate = 48000, lastChunkLen = 480, captureMode = '', dropCount = 0, lastTs = null;

async function openMic() {
  await ensureAudio();
  if (micReader) { try { micReader.cancel(); } catch (e) {} micReader = null; }
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); if (micSource) micSource.disconnect(); micStream = null; }
  const c = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
  if (prefs.deviceId) c.deviceId = { exact: prefs.deviceId };
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: c }); }
  catch (e) {
    if (prefs.deviceId) { prefs.deviceId = ''; savePrefs(); return openMic(); }
    setStatus('麦克风打不开：请到 系统设置 → 隐私与安全性 → 麦克风 里允许本程序（或终端）', 'err');
    return;
  }
  ring = []; ringLen = 0;
  const track = micStream.getAudioTracks()[0];
  if (typeof MediaStreamTrackProcessor === 'function') {
    captureMode = 'direct';
    const proc = new MediaStreamTrackProcessor({ track, maxBufferSize: 500 });
    const reader = proc.readable.getReader();
    micReader = reader;
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done || micReader !== reader) { if (value) value.close(); break; }
          const buf = audioDataToMono(value);
          const rate = value.sampleRate, ts = value.timestamp;
          if (lastTs != null && recording) { const expect = lastTs + lastChunkLen / micRate * 1e6; if (ts - expect > 3000) dropCount++; }
          lastTs = ts; micRate = rate; lastChunkLen = buf.length;
          value.close();
          pushChunk(buf);
        }
      } catch (e) { if (micReader === reader) setStatus('录音数据读取中断：' + e.message, 'err'); }
    })();
  } else {
    captureMode = 'worklet';
    micRate = actx.sampleRate;
    micSource = actx.createMediaStreamSource(micStream);
    if (!recNode) {
      recNode = new AudioWorkletNode(actx, 'rec');
      recNode.port.onmessage = (e) => { lastChunkLen = e.data.length; pushChunk(e.data); };
      const z = actx.createGain(); z.gain.value = 0;
      recNode.connect(z).connect(actx.destination);
    }
    micSource.connect(recNode);
  }
  if (actx.state === 'suspended') actx.resume();
  listDevices();
}

function audioDataToMono(ad) {
  const n = ad.numberOfFrames;
  const out = new Float32Array(n);
  try { ad.copyTo(out, { planeIndex: 0, format: 'f32-planar' }); return out; } catch (e) {}
  const ch = ad.numberOfChannels, fmt = ad.format || '';
  if (fmt.startsWith('f32')) {
    const tmp = new Float32Array(fmt === 'f32' ? n * ch : n); ad.copyTo(tmp, { planeIndex: 0 });
    for (let i = 0; i < n; i++) out[i] = fmt === 'f32' ? tmp[i * ch] : tmp[i];
  } else if (fmt.startsWith('s16')) {
    const tmp = new Int16Array(fmt === 's16' ? n * ch : n); ad.copyTo(tmp, { planeIndex: 0 });
    for (let i = 0; i < n; i++) out[i] = (fmt === 's16' ? tmp[i * ch] : tmp[i]) / 32768;
  } else if (fmt.startsWith('s32')) {
    const tmp = new Int32Array(fmt === 's32' ? n * ch : n); ad.copyTo(tmp, { planeIndex: 0 });
    for (let i = 0; i < n; i++) out[i] = (fmt === 's32' ? tmp[i * ch] : tmp[i]) / 2147483648;
  }
  return out;
}

function pushChunk(c) {
  let pk = 0;
  for (let i = 0; i < c.length; i++) { const a = c[i] < 0 ? -c[i] : c[i]; if (a > pk) pk = a; }
  if (pk > meterPeak) meterPeak = pk;
  if (recording) { recChunks.push(c); recLen += c.length; recPeaks.push(pk); }
  else {
    ring.push(c); ringLen += c.length;
    const max = PREROLL * micRate;
    while (ring.length > 1 && ringLen - ring[0].length >= max) ringLen -= ring.shift().length;
  }
}

// 高质量重采样（麦克风和播放采样率不一致时用）
async function resampleHQ(d, from, to) {
  if (from === to) return d;
  const oac = new OfflineAudioContext(1, Math.ceil(d.length * to / from), to);
  const b = oac.createBuffer(1, d.length, from); b.copyToChannel(d, 0);
  const src = oac.createBufferSource(); src.buffer = b; src.connect(oac.destination); src.start();
  const r = await oac.startRendering();
  return r.getChannelData(0).slice();
}

async function listDevices() {
  const ds = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const sel = $('#device'); sel.innerHTML = '';
  ds.forEach((d) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || '麦克风'; sel.appendChild(o); });
  const curId = micStream && micStream.getAudioTracks()[0] && micStream.getAudioTracks()[0].getSettings().deviceId;
  sel.value = prefs.deviceId || curId || (ds[0] && ds[0].deviceId) || '';
}

// ====================== 录音 ======================
function startRec() {
  if (!micStream) { setStatus('麦克风还没打开', 'err'); return; }
  if (editing) setEditing(false);
  stopPlay();
  if (!state.sentences.length) { state.sentences.push({ id: uid('s'), text: '（没有稿子的自由录音）' }); state.cur = 0; }
  if (state.cur >= state.sentences.length) state.cur = state.sentences.length - 1;
  recording = true; dropCount = 0; lastTs = null;
  recChunks = ring; recLen = ringLen; recPreroll = ringLen; ring = []; ringLen = 0; recPeaks = [];
  document.body.classList.add('recording'); $('#recLabel').textContent = '停止';
  renderPrompter();
  if (prefs.scrollMode === 'scroll') startAutoScroll();
  setStatus(`正在录第 ${state.cur + 1} 段…再按 R 结束，Esc 取消`);
}

async function stopRec(cancel) {
  if (!recording) return;
  recording = false;
  document.body.classList.remove('recording'); $('#recLabel').textContent = '录音';
  if (prefs.scrollMode === 'scroll') stopAutoScroll();
  const chunks = recChunks, len = recLen, pre = recPreroll;
  recChunks = []; recLen = 0;
  if (cancel) { setStatus('已取消这次录音'); renderPrompter(); return; }
  if (len - pre < micRate * 0.3) { setStatus('录得太短，已忽略', 'warn'); renderPrompter(); return; }
  const data = new Float32Array(len);
  let o = 0; for (const c of chunks) { data.set(c, o); o += c.length; }
  const drops = dropCount;
  const fixed = await resampleHQ(data, micRate, actx.sampleRate);
  commitTake(fixed, actx.sampleRate, pre / micRate);
  if (drops > 0) setStatus(`注意：这一段录音过程中检测到 ${drops} 处数据中断，可能有爆点，建议听一下，不行就重录`, 'warn');
}

function commitTake(data, sr, preSec) {
  const s = state.sentences[state.cur]; if (!s) return;
  pushUndo();
  const id = uid('t');
  takes.set(id, { data, sr, peaks: null, saved: false });
  const total = data.length / sr;
  let offset = Math.max(0, preSec - 0.1), dur = total - offset - 0.08;   // 不去静音时也去掉大部分预录和结尾按键声
  if (prefs.autoTrim) { const t = detectSpeech(data, sr); if (t) { offset = t[0]; dur = t[1] - t[0]; } }
  dur = Math.max(0.1, dur);

  const old = clipOf(s.id);
  let start;
  if (old) {
    start = old.start;
    const delta = dur - old.dur;
    state.clips = state.clips.filter((c) => c !== old);
    if (prefs.ripple) state.clips.forEach((c) => { if (c.start > old.start) c.start = Math.max(0, c.start + delta); });
  } else {
    const i = state.cur;
    let prev = null;
    for (let k = i - 1; k >= 0; k--) { const c = clipOf(state.sentences[k].id); if (c) { prev = c; break; } }
    start = prev ? clipEnd(prev) + prefs.gap : 0;
  }
  const clip = { sid: s.id, take: id, start, offset, dur, gainDb: old ? old.gainDb : (state.defaultGainDb || 0) };
  state.clips.push(clip);
  // 后面的句子要是被压住了，整体往后推，保证至少留出默认间隙
  const after = state.clips.filter((c) => c !== clip && sIndex(c.sid) > state.cur).sort((a, b) => a.start - b.start);
  if (after.length) { const need = clipEnd(clip) + prefs.gap - after[0].start; if (need > 0) after.forEach((c) => { c.start += need; }); }

  selSid = s.id;
  playhead = clip.start;          // 录完播放头回到这一段开头，按空格就是回放
  const n = state.cur + 1;
  if (state.cur < state.sentences.length - 1) state.cur++;
  revealTime(clip.start, clipEnd(clip));
  renderPrompter(); changed();
  const full = n >= state.sentences.length;
  setStatus(`第 ${n} 段录好了，${dur.toFixed(2)} 秒${full ? '。最后一段也录完了，空格从头听一遍吧' : '，按空格回放，没问题就按 R 录下一段'}`);
}

// 找出说话的起止：10ms窗口算能量，要求持续60ms才算开口，躲开按键的“咔哒”声
function detectSpeech(d, sr) {
  const win = Math.round(sr * 0.01), n = Math.floor(d.length / win);
  if (n < 20) return null;
  const rms = new Float32Array(n); let peak = 0;
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * win, e = j + win; j < e; j++) s += d[j] * d[j]; rms[i] = Math.sqrt(s / win); if (rms[i] > peak) peak = rms[i]; }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const floor = sorted[Math.floor(n * 0.1)];
  const thr = Math.max(floor * 4, peak * 0.07, 0.003);
  const SUS = 6, tail = 12;
  const okFwd = (i) => { if (rms[i] <= thr) return false; let c = 0; for (let k = i; k < Math.min(n, i + SUS); k++) if (rms[k] > thr * 0.5) c++; return c >= SUS * 0.7; };
  const okBack = (i) => { if (rms[i] <= thr) return false; let c = 0; for (let k = i; k > Math.max(-1, i - SUS); k--) if (rms[k] > thr * 0.5) c++; return c >= SUS * 0.7; };
  let a = -1, b = -1;
  for (let i = 0; i < n - tail; i++) if (okFwd(i)) { a = i; break; }
  for (let i = n - 1 - tail; i > a; i--) if (okBack(i)) { b = i; break; }
  if (a < 0 || b < 0) return null;
  const total = d.length / sr;
  const start = Math.max(0, a * 0.01 - 0.2);
  const end = Math.min(total - 0.06, (b + 1) * 0.01 + 0.35);
  return end - start > 0.1 ? [start, end] : null;
}


// ====================== 处理吸气声 ======================
// 每 512 个采样点做一次频谱分析，跟你标记的吸气样本比“频谱形状”，像的、又比说话轻的就判定为吸气，压低若干 dB
const FFT_N = 1024, FFT_HOP = 512, NB = 24;
let fftTables = null, rangeSel = null;
function fftInit() {
  const n = FFT_N, bits = Math.log2(n), rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2), win = new Float32Array(n);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = -Math.sin(2 * Math.PI * i / n); }
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  fftTables = { rev, cos, sin, win };
}
function fftPower(frame, re, im, out) {
  const { rev, cos, sin, win } = fftTables, n = FFT_N;
  for (let i = 0; i < n; i++) { re[rev[i]] = frame[i] * win[i]; im[rev[i]] = 0; }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) for (let j = 0; j < half; j++) {
      const k = j * step, a = i + j, b = a + half;
      const tr = re[b] * cos[k] - im[b] * sin[k], ti = re[b] * sin[k] + im[b] * cos[k];
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
  for (let k = 0; k < n / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
}
function analyzeTake(t) {
  if (t.analysis) return t.analysis;
  if (!fftTables) fftInit();
  const d = t.data, sr = t.sr, n = Math.max(0, Math.floor((d.length - FFT_N) / FFT_HOP) + 1), binHz = sr / FFT_N;
  const edges = []; for (let b = 0; b <= NB; b++) edges.push(Math.max(1, Math.round(80 * Math.pow(12000 / 80, b / NB) / binHz)));
  const re = new Float32Array(FFT_N), im = new Float32Array(FFT_N), P = new Float32Array(FFT_N / 2), frame = new Float32Array(FFT_N);
  const rmsDb = new Float32Array(n), shapes = new Float32Array(n * NB), flat = new Float32Array(n), low = new Float32Array(n), cent = new Float32Array(n);
  const k80 = Math.max(1, Math.round(80 / binHz)), k200 = Math.round(200 / binHz), k400 = Math.round(400 / binHz), k8k = Math.min(FFT_N / 2 - 1, Math.round(8000 / binHz));
  for (let f = 0; f < n; f++) {
    const s0 = f * FFT_HOP; let ss = 0;
    for (let i = 0; i < FFT_N; i++) { const v = d[s0 + i]; frame[i] = v; ss += v * v; }
    rmsDb[f] = 10 * Math.log10(ss / FFT_N + 1e-12);
    fftPower(frame, re, im, P);
    let mean = 0;
    for (let b = 0; b < NB; b++) { let e = 0; for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) e += P[k]; const v = Math.log10(e + 1e-12); shapes[f * NB + b] = v; mean += v; }
    mean /= NB; for (let b = 0; b < NB; b++) shapes[f * NB + b] -= mean;
    let ls = 0, sm = 0; for (let k = k200; k <= k8k; k++) { ls += Math.log(P[k] + 1e-20); sm += P[k]; }
    const nk = k8k - k200 + 1; flat[f] = Math.exp(ls / nk) / (sm / nk + 1e-20);
    let tot = 0, lo = 0, cw = 0; for (let k = k80; k <= k8k; k++) { tot += P[k]; cw += P[k] * k * binHz; if (k <= k400) lo += P[k]; }
    low[f] = lo / (tot + 1e-20); cent[f] = cw / (tot + 1e-20);
  }
  const sorted = Array.from(rmsDb).sort((a, b) => a - b), p90 = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : -30;
  const floor = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : -90;   // 房间底噪的响度
  return (t.analysis = { n, sr, rmsDb, shapes, flat, low, cent, p90, floor });
}
function breathKey() { const S = bp(); return S ? 's' + S.length + '|' + (prefs.breathSamplesVer || 0) : 'auto'; }
// 自动识别：跟样本库里每一个样本分别比，像其中任意一个就算
function autoRegions(t) {
  const key = breathKey();
  if (t.breath && t.breath.key === key) return t.breath.regions;
  const an = analyzeTake(t), n = an.n, flag = new Uint8Array(n), S = bp();
  for (let f = 0; f < n; f++) {
    const rel = an.rmsDb[f] - an.p90;
    if (rel > -4 || rel < -58 || an.rmsDb[f] < an.floor + 8) continue;   // 比底噪响不到8dB的不算，避免把安静处当成吸气
    if (S) {
      let na = 0; for (let b = 0; b < NB; b++) { const x = an.shapes[f * NB + b]; na += x * x; }
      for (const ex of S) {
        if (rel < ex.rel - 10 || rel > Math.min(ex.rel + 8, -9)) continue;
        let dot = 0, nb = 0;
        for (let b = 0; b < NB; b++) { const y = ex.shape[b]; dot += an.shapes[f * NB + b] * y; nb += y * y; }
        if (dot / Math.sqrt(na * nb + 1e-12) >= 0.78) { flag[f] = 1; break; }
      }
    } else if (rel >= -40 && rel <= -12 && an.flat[f] > 0.1 && an.low[f] < 0.2 && an.cent[f] > 700 && an.cent[f] < 5000) flag[f] = 1;
  }
  const total = d_len(t), PAD = 0.04;
  const regions = flagsToRegions(flag, FFT_HOP / an.sr, 0.08, 1.5, FFT_N / an.sr).map(([a, b]) => [Math.max(0, a - PAD), Math.min(total, b + PAD)]);
  t.breath = { key, regions };
  return regions;
}
const d_len = (t) => t.data.length / t.sr;
function flagsToRegions(flag, fs, minDur, maxDur, tail) {
  const hole = Math.round(0.05 / fs), regions = [];
  let a = -1, lastOn = -1;
  for (let f = 0; f <= flag.length; f++) {
    if (f < flag.length && flag[f]) { if (a < 0) a = f; lastOn = f; continue; }
    if (a >= 0 && (f === flag.length || f - lastOn > hole)) {
      const st = a * fs, en = lastOn * fs + tail;
      if (en - st >= minDur && en - st <= maxDur) regions.push([st, en]);
      a = -1;
    }
  }
  return regions;
}
// 最终的吸气区 = 自动识别 + 你手动标的“吸气” − 你标的“不是吸气”（后标的优先）
function breathRegions(id) {
  const t = takes.get(id), marks = state.marks[id] || [];
  const key = breathKey() + '|' + JSON.stringify(marks);
  if (t.final && t.final.key === key) return t.final.regions;
  let regions = autoRegions(t);
  if (marks.length) {
    const fs = 0.005, n = Math.ceil(t.data.length / t.sr / fs) + 1, flag = new Uint8Array(n);
    for (const [a, b] of regions) for (let f = Math.floor(a / fs); f < Math.min(n, Math.ceil(b / fs)); f++) flag[f] = 1;
    for (const m of marks) for (let f = Math.max(0, Math.floor(m.a / fs)); f < Math.min(n, Math.ceil(m.b / fs)); f++) flag[f] = m.k === 'b' ? 1 : 0;
    regions = flagsToRegions(flag, fs, 0.02, 60, fs);
  }
  t.final = { key, regions };
  return regions;
}
function breathGain(id) {
  const t = takes.get(id);
  const key = breathKey() + '|' + JSON.stringify(state.marks[id] || []) + '|' + state.breath.mode + state.breath.amountDb;
  if (t.breathGain && t.breathGain.key === key) return t.breathGain.arr;
  const regs = breathRegions(id);
  let arr = null;
  if (regs.length) {
    arr = new Float32Array(t.data.length).fill(1);
    const att = state.breath.mode === 'mute' ? 0 : dbToLin(-state.breath.amountDb), ramp = Math.round(0.02 * t.sr);
    for (const [a, b] of regs) {
      const s0 = Math.round(a * t.sr), s1 = Math.min(arr.length, Math.round(b * t.sr));
      for (let i = Math.max(0, s0 - ramp); i < Math.min(arr.length, s1 + ramp); i++) {
        const gk = i < s0 ? 1 - (1 - att) * ((i - (s0 - ramp)) / ramp) : i >= s1 ? 1 - (1 - att) * (1 - (i - s1) / ramp) : att;
        if (gk < arr[i]) arr[i] = gk;
      }
    }
  }
  t.breathGain = { key, arr };
  return arr;
}
function countBreaths() {
  let n = 0;
  state.clips.forEach((c) => { breathRegions(c.take).forEach(([a, b]) => { if (b > c.offset && a < c.offset + c.dur) n++; }); });
  return n;
}
// 每次标记都记下来，“撤回标记”按钮一次退一步（连同它记下的样本一起删掉）
const markHistory = [];
function undoLastMark() {
  const h = markHistory.pop();
  if (!h) { setStatus('没有可以撤回的标记了'); return; }
  const list = state.marks[h.take] || [];
  const i = list.indexOf(h.mark); if (i >= 0) list.splice(i, 1);
  if (h.sampleId && bp()) {
    prefs.breathSamples = bp().filter((x) => x.id !== h.sampleId);
    prefs.breathSamplesVer = (prefs.breathSamplesVer || 0) + 1; savePrefs();
  }
  syncBreathUI(); changed();
  setStatus(`已撤回上一次“${h.mark.k === 'b' ? '标记吸气' : '不是吸气'}”${h.sampleId ? '，它记下的样本也删了' : ''}，现在一共 ${countBreaths()} 处${markHistory.length ? `（还能再撤回 ${markHistory.length} 次）` : ''}`);
}

// 选区落在哪一段上，换算成那段录音自己的时间
function selOnClip() {
  if (!rangeSel) { setStatus('先按住 Shift，在波形上拖出一段，再点按钮', 'warn'); return null; }
  const mid = (rangeSel.a + rangeSel.b) / 2, c = state.clips.find((k) => mid >= k.start && mid < clipEnd(k));
  if (!c) { setStatus('选区要落在某一段录音上', 'warn'); return null; }
  const ta = Math.max(c.offset, rangeSel.a - c.start + c.offset), tb = Math.min(c.offset + c.dur, rangeSel.b - c.start + c.offset);
  if (tb - ta < 0.03) { setStatus('选区太短了', 'warn'); return null; }
  return { c, ta, tb };
}
function addBreathSample() {
  const r = selOnClip(); if (!r) return;
  const { c, ta, tb } = r, t = takes.get(c.take), an = analyzeTake(t);
  pushUndo();
  // 1. 这一处直接标成吸气，一定会被压低
  const mark = { a: ta, b: tb, k: 'b' }, hist = { take: c.take, mark, sampleId: null };
  (state.marks[c.take] = state.marks[c.take] || []).push(mark);
  markHistory.push(hist);
  // 2. 选区里只挑“吸气那部分”的帧当样本（去掉前后的静音和说话声），存进样本库，以后自动认
  const f0 = Math.max(0, Math.floor(ta * t.sr / FFT_HOP)), f1 = Math.min(an.n, Math.floor((tb * t.sr - FFT_N) / FFT_HOP) + 1);
  let learned = false;
  if (f1 - f0 >= 2) {
    const fr = []; for (let f = f0; f < f1; f++) { const rel = an.rmsDb[f] - an.p90; if (rel <= -4 && rel >= -58 && an.rmsDb[f] >= an.floor + 8) fr.push([f, rel]); }
    if (fr.length) {
      const top = Math.max(...fr.map((x) => x[1]));
      const use = fr.filter((x) => x[1] >= top - 12);
      const meanRel = use.reduce((a, x) => a + x[1], 0) / Math.max(1, use.length);
      if (use.length >= 2 && meanRel <= -12) {   // 太响的多半是说话声，只标这一处，不学成样本，免得把正常说话也当吸气
        const shape = new Array(NB).fill(0); let rel = 0;
        for (const [f, rl] of use) { for (let b = 0; b < NB; b++) shape[b] += an.shapes[f * NB + b]; rel += rl; }
        for (let b = 0; b < NB; b++) shape[b] /= use.length;
        hist.sampleId = uid('bs');
        prefs.breathSamples = [...(bp() || []), { id: hist.sampleId, shape, rel: rel / use.length }].slice(-80);
        prefs.breathSamplesVer = (prefs.breathSamplesVer || 0) + 1;
        savePrefs(); learned = true;
      }
    }
  }
  state.breath.on = true;
  rangeSel = null;
  syncBreathUI(); changed();
  setStatus(`已标成吸气（紫色）${learned ? `，并记成第 ${bp().length} 个样本，所有录音里像它的都会自动标出来` : '（这一处太轻、太短或太像说话声，只标了这里，没记成样本）'}，现在一共 ${countBreaths()} 处`);
}
function markNotBreath() {
  const r = selOnClip(); if (!r) return;
  pushUndo();
  const mark = { a: r.ta, b: r.tb, k: 'k' };
  (state.marks[r.c.take] = state.marks[r.c.take] || []).push(mark);
  markHistory.push({ take: r.c.take, mark, sampleId: null });
  rangeSel = null;
  changed();
  setStatus(`这一处不再当成吸气，现在一共 ${countBreaths()} 处`);
}
function clearBreathSample() {
  if (!bp()) { setStatus('现在没有吸气样本'); return; }
  if (!confirm(`清除全部 ${bp().length} 个吸气样本？清除后所有工程都改回自动识别（你手动标的位置还在）。`)) return;
  prefs.breathSamples = null; prefs.breathProfile = null; prefs.breathSamplesVer = (prefs.breathSamplesVer || 0) + 1; savePrefs();
  syncBreathUI(); changed();
  setStatus(state.breath.on ? `已清除样本，改为自动识别，认出 ${countBreaths()} 处吸气` : '已清除吸气样本');
}
function syncBreathUI() {
  const B = state.breath;
  $('#breathOn').checked = B.on; $('#breathDb').value = B.amountDb; $('#breathMode').value = B.mode || 'mute';
  $('#breathDbWrap').style.display = B.mode === 'duck' ? '' : 'none';
  $('#breathInfo').textContent = bp() ? `样本×${bp().length}` : '自动识别';
}

// ====================== 降噪 ======================
// 找每段录音里最安静的10%当成“噪声样本”，逐个频率把噪声那部分减掉；强度越大减得越多
function fftC(re, im, inv) {
  if (!fftTables) fftInit();
  const { rev, cos, sin } = fftTables, n = FFT_N, sg = inv ? -1 : 1;
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) for (let j = 0; j < half; j++) {
      const k = j * step, a = i + j, b = a + half, wr = cos[k], wi = sin[k] * sg;
      const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function dataFor(t) {
  const st = prefs.denoise || 0;
  if (!st) return t.data;
  if (t.dn && t.dn.st === st) return t.dn.data;
  if (!fftTables) fftInit();
  const d = t.data, N = FFT_N, H = N / 4, win = fftTables.win, half = N / 2 + 1;
  const nF = Math.max(1, Math.floor((d.length - N) / H) + 1);
  // 噪声谱：最安静的10%帧
  const en = new Float32Array(nF);
  for (let f = 0; f < nF; f++) { let s = 0; for (let i = 0; i < N; i += 4) { const v = d[f * H + i]; s += v * v; } en[f] = s; }
  const order = Array.from(en.keys()).sort((a, b) => en[a] - en[b]).slice(0, Math.max(3, Math.floor(nF * 0.1)));
  const noise = new Float32Array(half), re = new Float32Array(N), im = new Float32Array(N);
  for (const f of order) { for (let i = 0; i < N; i++) { re[i] = d[f * H + i] * win[i]; im[i] = 0; } fftC(re, im, false); for (let k = 0; k < half; k++) noise[k] += re[k] * re[k] + im[k] * im[k]; }
  for (let k = 0; k < half; k++) noise[k] /= order.length;
  const over = 1 + st / 50, floor = dbToLin(-6 - st * 0.18);   // 强度100：过减3倍，最多压低24dB
  const out = new Float32Array(d.length), norm = new Float32Array(d.length), gPrev = new Float32Array(half).fill(1);
  for (let f = 0; f < nF; f++) {
    const s0 = f * H;
    for (let i = 0; i < N; i++) { re[i] = d[s0 + i] * win[i]; im[i] = 0; }
    fftC(re, im, false);
    for (let k = 0; k < half; k++) {
      const P = re[k] * re[k] + im[k] * im[k];
      let gk = Math.max(floor, 1 - over * noise[k] / (P + 1e-20));
      gk = gk < gPrev[k] ? 0.6 * gPrev[k] + 0.4 * gk : gk;   // 往下压时平滑一点，避免“水声”
      gPrev[k] = gk;
      re[k] *= gk; im[k] *= gk;
      if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    fftC(re, im, true);
    for (let i = 0; i < N; i++) { out[s0 + i] += re[i] * win[i]; norm[s0 + i] += win[i] * win[i]; }
  }
  for (let i = 0; i < d.length; i++) out[i] = norm[i] > 1e-3 ? out[i] / norm[i] : d[i];
  t.dn = { st, data: out };
  return out;
}

// ====================== 压峰值：动态均衡 + 限幅 ======================
function dynamics(out, sr) {
  if (prefs.leveler) {   // 动态均衡：超过“正常说话音量”的部分按 3:1 压下去
    const win = Math.round(sr * 0.02), vals = [];
    for (let i = 0; i + win <= out.length; i += win) { let s = 0; for (let j = i; j < i + win; j++) s += out[j] * out[j]; vals.push(s / win); }
    vals.sort((a, b) => b - a);
    const loud = vals.length ? 10 * Math.log10(vals[Math.floor(vals.length * 0.15)] + 1e-12) : -20;
    const T = loud + 2, R = 3, att = Math.exp(-1 / (0.005 * sr)), rel = Math.exp(-1 / (0.15 * sr));
    let env = 0;
    for (let i = 0; i < out.length; i++) {
      const a = Math.abs(out[i]); env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a;
      const eDb = 20 * Math.log10(env * 0.707 + 1e-9);
      if (eDb > T) out[i] *= Math.pow(10, ((T + (eDb - T) / R) - eDb) / 20);
    }
  }
  if (prefs.limiter) {   // 限幅：任何地方都不超过 -1dB，提前 5ms 看到峰值，平滑压下去
    const ceil = dbToLin(-1), L = Math.round(sr * 0.005), n = out.length;
    const need = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = Math.abs(out[i]); need[i] = a > ceil ? ceil / a : 1; }
    const minAhead = new Float32Array(n), dq = new Int32Array(n); let h = 0, tl = 0;
    for (let i = n - 1; i >= 0; i--) {
      while (tl > h && need[dq[tl - 1]] >= need[i]) tl--;
      dq[tl++] = i;
      while (dq[h] > i + L) h++;
      minAhead[i] = need[dq[h]];
    }
    // 提前 5ms 开始往下压（攻击约1.5ms时间常数），峰值过去后 80ms 慢慢松开；最后再硬切一刀兜底
    const atkC = Math.exp(-1 / (L / 3)), relC = Math.exp(-1 / (0.08 * sr)); let gl = 1;
    for (let i = 0; i < n; i++) {
      const tgt = minAhead[i];
      gl = tgt < gl ? atkC * gl + (1 - atkC) * tgt : relC * gl + (1 - relC) * tgt;
      let v = out[i] * gl;
      if (v > ceil) v = ceil; else if (v < -ceil) v = -ceil;
      out[i] = v;
    }
  }
}

// ====================== 响度（LUFS，按 ITU-R BS.1770 / EBU R128 的算法） ======================
function biquad(x, b0, b1, b2, a0, a1, a2) {
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
function measureLUFS(x, sr) {
  // K 加权：高架 +4dB（约1.68kHz）＋ 高通（约38Hz）
  let w = 2 * Math.PI * 1681.974450955533 / sr, A = Math.pow(10, 3.999843853973347 / 40), al = Math.sin(w) / (2 * 0.7071752369554196), cs = Math.cos(w), sA = Math.sqrt(A);
  let y = biquad(x, A * ((A + 1) + (A - 1) * cs + 2 * sA * al), -2 * A * ((A - 1) + (A + 1) * cs), A * ((A + 1) + (A - 1) * cs - 2 * sA * al),
    (A + 1) - (A - 1) * cs + 2 * sA * al, 2 * ((A - 1) - (A + 1) * cs), (A + 1) - (A - 1) * cs - 2 * sA * al);
  w = 2 * Math.PI * 38.13547087602444 / sr; al = Math.sin(w) / (2 * 0.5003270373238773); cs = Math.cos(w);
  y = biquad(y, (1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al);
  // 400ms 一块，每 100ms 移一次；先去掉 -70 以下，再去掉比平均低 10 LU 的
  const B = Math.round(0.4 * sr), Hh = Math.round(0.1 * sr), ms = [];
  for (let s0 = 0; s0 + B <= y.length; s0 += Hh) { let s = 0; for (let i = s0; i < s0 + B; i++) s += y[i] * y[i]; ms.push(s / B); }
  const L = (m) => -0.691 + 10 * Math.log10(m + 1e-20);
  const g1 = ms.filter((m) => L(m) > -70); if (!g1.length) return -70;
  const rel = L(g1.reduce((a, b) => a + b, 0) / g1.length) - 10;
  const g2 = g1.filter((m) => L(m) > rel);
  return L(g2.reduce((a, b) => a + b, 0) / g2.length);
}
function levelClips() {   // 每段说话响度拉齐到 -20dB
  state.clips.forEach((c) => {
    const t = takes.get(c.take), d = dataFor(t), win = Math.round(t.sr * 0.02);
    const s0 = Math.floor(c.offset * t.sr), s1 = Math.min(d.length, Math.floor((c.offset + c.dur) * t.sr)), vals = [];
    for (let i = s0; i + win <= s1; i += win) { let s = 0; for (let j = i; j < i + win; j++) s += d[j] * d[j]; vals.push(s / win); }
    if (!vals.length) return;
    vals.sort((a, b) => b - a);
    const top = vals.slice(0, Math.max(1, Math.floor(vals.length * 0.5)));
    const db = 10 * Math.log10(top.reduce((a, b) => a + b, 0) / top.length + 1e-12);
    c.gainDb = Math.max(-12, Math.min(30, Math.round((-20 - db) * 2) / 2));
  });
  state.defaultGainDb = Math.round(state.clips.reduce((a, c) => a + c.gainDb, 0) / state.clips.length * 2) / 2;
}
let lastLufs = null;
function showLufs(v) { lastLufs = v; const tgt = +prefs.lufsTarget; $('#lufsVal').textContent = v == null ? '-- LUFS' : `${v.toFixed(1)} LUFS`; $('#lufsVal').style.color = v == null ? '' : Math.abs(v - tgt) <= 1 ? '#49d17a' : '#ffb347'; }
function toLoudness() {
  if (!state.clips.length) { setStatus('还没有录音', 'warn'); return; }
  setStatus('正在计算响度…');
  setTimeout(() => {
    pushUndo();
    levelClips();
    const tgt = +prefs.lufsTarget, sr = actx.sampleRate;
    let L = 0;
    for (let k = 0; k < 5; k++) {   // 压峰值会让响度略低于预期，多算几次逼近目标
      L = measureLUFS(mixdown(true), sr);
      if (Math.abs(L - tgt) < 0.2) break;
      state.masterGainDb = Math.max(-24, Math.min(30, Math.round((state.masterGainDb + (tgt - L)) * 10) / 10));
    }
    syncMasterUI(); showLufs(L); changed();
    setStatus(`已对齐到 ${L.toFixed(1)} LUFS（目标 ${tgt}），每段音量也拉齐了，主音量 ${state.masterGainDb > 0 ? '+' : ''}${state.masterGainDb}dB`);
  }, 30);
}
function measureNow() {
  if (!state.clips.length) return;
  setTimeout(() => { const L = measureLUFS(mixdown(true), actx.sampleRate); showLufs(L); setStatus(`当前响度 ${L.toFixed(1)} LUFS，目标 ${prefs.lufsTarget} LUFS${Math.abs(L - prefs.lufsTarget) > 1 ? '，点“一键标准响度”对齐' : '，已经达标'}`); }, 30);
}

// ====================== 混音 / 播放 / 导出 ======================
// 底噪：从录音里找最长的一段安静（一般是开口前那一下），做成可以无缝循环的环境声
let roomToneCache = { key: '', data: null };
function getRoomTone() {
  const ids = [...new Set(state.clips.map((c) => c.take))].sort();
  const key = ids.join(',') + '|' + (prefs.denoise || 0);
  if (roomToneCache.key === key) return roomToneCache.data;
  let best = null;
  for (const id of ids) {
    const t = takes.get(id), d = dataFor(t), win = Math.round(t.sr * 0.02), n = Math.floor(d.length / win);
    if (n < 10) continue;
    const rms = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = i * win, e = j + win; j < e; j++) s += d[j] * d[j]; rms[i] = Math.sqrt(s / win); }
    const sorted = Array.from(rms).sort((a, b) => a - b), thr = sorted[Math.floor(n * 0.15)] * 2 + 1e-6;
    let run = 0;
    for (let i = 0; i <= n; i++) {
      if (i < n && rms[i] <= thr) { run++; continue; }
      if (run >= 8) {
        const a = (i - run + 1) * win, b = (i - 1) * win;   // 两头各让出一个窗口
        let ms = 0; for (let j = a; j < b; j++) ms += d[j] * d[j]; ms /= Math.max(1, b - a);
        const len = b - a;
        if (len > 0 && (!best || len > best.len * 1.5 || (len > best.len * 0.6 && ms < best.ms))) best = { d, a, len, ms };
      }
      run = 0;
    }
  }
  let out = null;
  if (best) {
    const sr = actx.sampleRate, total = Math.round(sr * 4), L = best.len, hop = Math.floor(L / 2);
    out = new Float32Array(total + L);
    let k = 0;
    for (let pos = 0; pos < total; pos += hop, k++) {         // 50% 重叠的汉宁窗叠加，奇偶次正反放，听不出循环
      for (let j = 0; j < L; j++) {
        const w = Math.sin(Math.PI * j / L) ** 2;
        const src = best.a + (k % 2 ? L - 1 - j : j);
        out[pos + j] += best.d[src] * w;
      }
    }
    out = out.subarray(hop, hop + total - L);
  }
  roomToneCache = { key, data: out };
  return out;
}

function mixdown(withMaster) {
  const sr = actx.sampleRate, sc = sortedClips();
  if (!sc.length) return null;
  const end = Math.max(...sc.map(clipEnd)) + 0.5;
  const out = new Float32Array(Math.ceil(end * sr) + 1);
  const env = prefs.roomTone ? new Float32Array(out.length) : null;   // 每个时刻人声占了多少，底噪就让出多少
  sc.forEach((c, i) => {
    const t = takes.get(c.take), d = dataFor(t);
    let fin = prefs.fadeIn, fout = prefs.fadeOut;
    for (let k = 0; k < i; k++) { const ov = clipEnd(sc[k]) - c.start; if (ov > fin) fin = ov; }
    for (let k = i + 1; k < sc.length; k++) { const ov = clipEnd(c) - sc[k].start; if (ov > fout) fout = ov; }
    fin = Math.min(Math.max(0.004, fin), c.dur / 2); fout = Math.min(Math.max(0.004, fout), c.dur / 2);
    const g0 = dbToLin(c.gainDb), n = Math.floor(c.dur * sr), s0 = Math.round(c.start * sr), off = Math.round(c.offset * sr);
    const nin = Math.max(1, Math.round(fin * sr)), nout = Math.max(1, Math.round(fout * sr));
    const bgArr = state.breath.on ? breathGain(c.take) : null;
    for (let k = 0; k < n; k++) {
      const src = off + k; if (src >= d.length) break;
      let f = bgArr ? bgArr[src] : 1;
      if (k < nin) f *= Math.sin(Math.PI / 2 * k / nin);          // 等功率曲线
      const r = n - 1 - k; if (r < nout) f *= Math.sin(Math.PI / 2 * r / nout);
      const o = s0 + k; if (o >= out.length) break;
      out[o] += d[src] * g0 * f;
      if (env) env[o] += f * f;
    }
  });
  if (env) {
    const rt = getRoomTone();
    if (rt && rt.length) {
      const gains = sc.map((c) => c.gainDb).sort((a, b) => a - b);
      const rg = dbToLin(gains[Math.floor(gains.length / 2)]);
      for (let i = Math.floor(sc[0].start * sr); i < out.length; i++) {
        const e = env[i] >= 1 ? 1 : env[i];
        if (e < 1) out[i] += rt[i % rt.length] * rg * Math.sqrt(1 - e);
      }
    }
  }
  if (withMaster) { const m = dbToLin(state.masterGainDb); if (m !== 1) for (let i = 0; i < out.length; i++) out[i] *= m; dynamics(out, sr); }
  return out;
}

function peakDb(arr) { let pk = 0; for (let i = 0; i < arr.length; i++) { const a = arr[i] < 0 ? -arr[i] : arr[i]; if (a > pk) pk = a; } return 20 * Math.log10(pk + 1e-12); }

let playing = false, playSrc = null, playT0 = 0, playFrom = 0, playUntil = null;
function play(from, until) {
  if (!actx || recording) return;
  stopPlay();
  const mix = mixdown(true);
  if (!mix) { setStatus('还没有录音'); return; }
  const sr = actx.sampleRate, total = mix.length / sr;
  let pos = from != null ? from : playhead;
  if (pos >= total - 0.02) pos = 0;
  const buf = actx.createBuffer(1, mix.length, sr);
  buf.copyToChannel(mix, 0);
  const src = actx.createBufferSource(); src.buffer = buf; src.connect(actx.destination);
  playUntil = until != null ? Math.min(until, total) : total;
  src.start(0, pos, Math.max(0.01, playUntil - pos));
  src.onended = () => { if (playSrc === src) { playing = false; playSrc = null; playhead = Math.min(playhead, playUntil); $('#btnPlay').textContent = '▶'; draw(); } };
  playSrc = src; playing = true; playFrom = pos; playT0 = actx.currentTime; playhead = pos;
  $('#btnPlay').textContent = '■';
}
function stopPlay() {
  if (!playSrc) return;
  const s = playSrc; playSrc = null; playing = false;
  try { s.onended = null; s.stop(); } catch (e) {}
  $('#btnPlay').textContent = '▶'; draw();
}
function playSentence(sid) { const c = clipOf(sid); if (c) play(c.start, clipEnd(c)); }

async function doExport(fmt) {
  if (!state.clips.length) { setStatus('还没有录音，没法导出', 'warn'); return; }
  stopPlay();
  const mix = mixdown(true);
  const sr = actx.sampleRate;
  const first = Math.min(...state.clips.map((c) => c.start));
  const tailPad = 0;
  const s0 = Math.floor(first * sr);
  const out = new Float32Array(mix.length - s0 + tailPad);
  out.set(mix.subarray(s0));
  const pk = peakDb(out);
  try { showLufs(measureLUFS(out, sr)); } catch (e) {}
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  setStatus('正在导出…');
  const r = await bridge.exportAudio({ bytes: encodeWav(out, sr, 'int16'), format: fmt, name: state.name });
  if (r && r.ok) setStatus(`已导出：${r.path}（时长 ${fmtTime(out.length / sr)}${pk > 0 ? '，注意有爆音，建议点“统一音量”后重导' : ''}）`, pk > 0 ? 'warn' : '');
  else if (r && r.error) setStatus('导出失败：' + r.error, 'err');
  else setStatus('已取消导出');
}

// ====================== 编辑操作 ======================
function deleteClip(sid) {
  const c = clipOf(sid); if (!c) return;
  pushUndo();
  state.clips = state.clips.filter((x) => x !== c);
  if (prefs.ripple) { const d = c.dur + prefs.gap; state.clips.forEach((x) => { if (x.start > c.start) x.start = Math.max(0, x.start - d); }); }
  selSid = null;
  renderPrompter(); changed();
  setStatus(`已删除第 ${sIndex(sid) + 1} 段的录音（⌘Z 可撤销）`);
}

function arrangeAll() {
  if (!state.clips.length) return;
  pushUndo();
  let t = 0;
  state.sentences.forEach((s) => { const c = clipOf(s.id); if (c) { c.start = t; t += c.dur + prefs.gap; } });
  changed(); setStatus(`已按段落顺序重新排列，间隙 ${prefs.gap} 秒`);
}

// 统一音量：每句“说话部分”的平均响度拉到同一水平，再整体抬到峰值 -1dB
function unifyVolume() {
  if (!state.clips.length) return;
  pushUndo();
  const target = -20;
  state.clips.forEach((c) => {
    const t = takes.get(c.take), win = Math.round(t.sr * 0.02);
    const s0 = Math.floor(c.offset * t.sr), s1 = Math.min(t.data.length, Math.floor((c.offset + c.dur) * t.sr));
    const vals = [];
    for (let i = s0; i + win <= s1; i += win) { let s = 0; for (let j = i; j < i + win; j++) s += t.data[j] * t.data[j]; vals.push(s / win); }
    if (!vals.length) return;
    vals.sort((a, b) => b - a);
    const top = vals.slice(0, Math.max(1, Math.floor(vals.length * 0.5)));
    const ms = top.reduce((a, b) => a + b, 0) / top.length;
    const db = 10 * Math.log10(ms + 1e-12);
    c.gainDb = Math.max(-12, Math.min(30, Math.round((target - db) * 2) / 2));
  });
  const mix = mixdown(false);
  state.masterGainDb = prefs.limiter ? 4 : Math.max(-24, Math.min(24, Math.round((-1 - peakDb(mix)) * 2) / 2));
  state.defaultGainDb = Math.round(state.clips.reduce((a, c) => a + c.gainDb, 0) / state.clips.length * 2) / 2;
  syncMasterUI(); changed();
  setStatus(`音量已统一，主音量 ${state.masterGainDb > 0 ? '+' : ''}${state.masterGainDb}dB${prefs.limiter ? '，偏响的地方由“压峰值”自动压住' : '，输出峰值约 -1dB'}`);
}

// ====================== 提词器 ======================
let editing = false;
function splitSentences(text) {
  // 按回车分段：一行就是一段，句号不再断开
  return text.replace(/\*\*/g, '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
}

function applyScript(text) {
  const parts = splitSentences(text);
  const old = state.sentences, used = new Set();
  const ns = parts.map((t) => { const hit = old.find((s) => !used.has(s.id) && s.text === t); if (hit) { used.add(hit.id); return { id: hit.id, text: t }; } return null; });
  // 只改了几个字的句子：同一位置、旧句有录音的，保留录音
  ns.forEach((x, i) => { if (!x) { const o = old[i]; if (o && !used.has(o.id) && clipOf(o.id)) { used.add(o.id); ns[i] = { id: o.id, text: parts[i] }; } } });
  ns.forEach((x, i) => { if (!x) ns[i] = { id: uid('s'), text: parts[i] }; });
  const lost = old.filter((s) => !used.has(s.id) && clipOf(s.id));
  if (lost.length && !confirm(`有 ${lost.length} 段已经录好的段落被删掉了，它们的录音也会从时间线上移除（之后可以 ⌘Z 撤销）。继续吗？`)) return false;
  pushUndo();
  state.sentences = ns;
  state.clips = state.clips.filter((c) => ns.some((s) => s.id === c.sid));
  state.cur = Math.max(0, Math.min(state.cur, ns.length - 1));
  if (selSid && !clipOf(selSid)) selSid = null;
  return true;
}

function setEditing(on) {
  if (!on && editing) { if (!applyScript($('#scriptEdit').value)) return; }
  editing = on;
  $('#prompter').classList.toggle('editing', on);
  $('#btnEdit').textContent = on ? '完成' : '编辑稿子';
  if (on) { $('#scriptEdit').value = state.sentences.map((s) => s.text).join('\n'); setTimeout(() => $('#scriptEdit').focus(), 0); }
  else { renderPrompter(); changed(); }
}

function renderPrompter() {
  const list = $('#sentList');
  list.style.fontSize = prefs.fontSize + 'px';
  list.innerHTML = '';
  state.sentences.forEach((s, i) => {
    const c = clipOf(s.id);
    const el = document.createElement('div');
    el.className = 'sent' + (i === state.cur ? ' cur' : '') + (c ? ' done' : '');
    el.dataset.i = i;
    el.innerHTML = '<span class="num"></span><span class="txt"></span><span class="badge"></span>';
    el.children[0].textContent = i + 1; el.children[0].style.background = segColor(i);
    el.children[1].textContent = s.text;
    el.children[2].textContent = c ? `✓ ${c.dur.toFixed(1)}s` : '';
    list.appendChild(el);
  });
  if (prefs.scrollMode === 'follow') scrollCurIntoView(false);
  renderFoot();
}

function updateCurClass() {
  [...$('#sentList').children].forEach((el, i) => el.classList.toggle('cur', i === state.cur));
  if (prefs.scrollMode === 'follow') scrollCurIntoView(true);
}

function scrollCurIntoView(smooth) {
  const el = $('#sentList').children[state.cur]; if (!el) return;
  const body = $('#pBody');
  const tall = el.offsetHeight > body.clientHeight * 0.5;
  const top = tall ? el.offsetTop - body.clientHeight * 0.12 : el.offsetTop - body.clientHeight * 0.38 + el.offsetHeight / 2;
  body.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}

function setCur(i, opts = {}) {
  if (recording || !state.sentences.length) return;
  i = Math.max(0, Math.min(state.sentences.length - 1, i));
  if (i === state.cur && !opts.force) return;
  state.cur = i;
  const c = clipOf(state.sentences[i].id);
  if (c && opts.jump !== false) { selSid = c.sid; if (!playing) playhead = c.start; revealTime(c.start, clipEnd(c)); }
  updateCurClass(); changed();
}

function renderFoot() {
  const n = state.sentences.length, done = state.sentences.filter((s) => clipOf(s.id)).length;
  const sc = sortedClips();
  const total = sc.length ? Math.max(...sc.map(clipEnd)) - sc[0].start : 0;
  $('#pFoot').innerHTML = n ? `已录 <b>${done}/${n}</b> 段 · 总时长 <b>${fmtTime(total)}</b> · 当前第 <b>${state.cur + 1}</b> 段` : '先点“编辑稿子”粘贴逐字稿，也可以直接按 R 自由录';
}

let autoScrollOn = false, autoScrollLast = 0;
function startAutoScroll() { autoScrollOn = true; autoScrollLast = performance.now(); $('#btnScroll').textContent = '❚❚ 暂停'; }
function stopAutoScroll() { autoScrollOn = false; $('#btnScroll').textContent = '▶ 滚动'; }

function applyPrompterPrefs() {
  $('#prompter').style.width = prefs.prompterWidth + 'px';
  $('#prompter').classList.toggle('mode-follow', prefs.scrollMode === 'follow');
  document.querySelectorAll('#scrollModeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === prefs.scrollMode));
  $('#fontSize').value = prefs.fontSize; $('#scrollSpeed').value = prefs.scrollSpeed;
  $('#sentList').style.fontSize = prefs.fontSize + 'px';
}

// ====================== 时间线绘制 ======================
const cv = $('#tl'), g = cv.getContext('2d');
let W = 0, H = 0, dpr = 1;
const RULER = 26, BOTTOM = 34;
const pps = () => prefs.pxPerSec;
const t2x = (t) => (t - view.x0) * pps();
const x2t = (x) => x / pps() + view.x0;
const trackTop = () => RULER + 8;
const trackBot = () => H - BOTTOM;

function resizeCanvas() {
  const r = $('#timelineWrap').getBoundingClientRect();
  dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  drawNow();
}

function revealTime(a, b) {
  const vw = W / pps();
  if (a < view.x0 || b > view.x0 + vw) { view.x0 = Math.max(0, (b - a < vw * 0.8) ? b - vw * 0.75 : a - vw * 0.1); if (view.x0 > a) view.x0 = Math.max(0, a - vw * 0.1); }
}

let drawQueued = false;
function draw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(() => { drawQueued = false; drawNow(); }); } }

function niceStep() { for (const s of [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120]) if (s * pps() >= 70) return s; return 300; }
function rulerLabel(t, step) { if (step < 1) return t.toFixed(step < 0.1 ? 2 : 1) + 's'; if (t < 60) return Math.round(t) + 's'; const m = Math.floor(t / 60), s = Math.round(t - m * 60); return `${m}:${pad(s)}`; }

function drawNow() {
  if (!state || !W) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#262628'; g.fillRect(0, 0, W, H);
  const top = trackTop(), bot = trackBot();
  g.fillStyle = '#2e2f32'; g.fillRect(0, top, W, bot - top);

  // 标尺
  g.fillStyle = '#3a3b3f'; g.fillRect(0, 0, W, RULER);
  const step = niceStep(), t0 = Math.floor(view.x0 / step) * step;
  g.font = '11px -apple-system, "PingFang SC"'; g.textBaseline = 'top';
  for (let t = t0; t2x(t) < W + 1; t += step) {
    const x = Math.round(t2x(t)) + 0.5;
    g.strokeStyle = '#38393c'; g.beginPath(); g.moveTo(x, top); g.lineTo(x, bot); g.stroke();
    g.strokeStyle = '#8a8b90'; g.beginPath(); g.moveTo(x, RULER - 11); g.lineTo(x, RULER); g.stroke();
    g.fillStyle = '#c4c4c8'; g.fillText(rulerLabel(t + 1e-9, step), x + 3, 4);
    g.strokeStyle = '#5c5d61';
    for (let k = 1; k < 5; k++) { const xm = Math.round(t2x(t + step * k / 5)) + 0.5; g.beginPath(); g.moveTo(xm, RULER - 5); g.lineTo(xm, RULER); g.stroke(); }
  }

  const sc = sortedClips();
  if (!sc.length) {
    g.fillStyle = '#77787d'; g.font = '15px -apple-system, "PingFang SC"'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('按 R 开始录当前这一段，说完再按 R，自动排到时间线上', W / 2, (top + bot) / 2);
    g.textAlign = 'left';
  }
  sc.forEach((c) => drawClip(c, top, bot));

  // 间隙 / 交叉渐变标注
  g.font = '11px "SF Mono", Menlo, monospace'; g.textBaseline = 'middle'; g.textAlign = 'center';
  for (let i = 0; i < sc.length - 1; i++) {
    const a = sc[i], b = sc[i + 1], ae = clipEnd(a);
    const xa = t2x(ae), xb = t2x(b.start);
    if (Math.max(xa, xb) < -50 || Math.min(xa, xb) > W + 50) continue;
    const y = bot + 15;
    if (b.start >= ae) {
      const gap = b.start - ae;
      g.strokeStyle = gap > 1 ? '#ffb347' : '#6ea8ff';
      g.beginPath(); g.moveTo(xa + 0.5, y - 5); g.lineTo(xa + 0.5, y + 5); g.moveTo(xa, y); g.lineTo(xb, y); g.moveTo(xb + 0.5, y - 5); g.lineTo(xb + 0.5, y + 5); g.stroke();
      const label = gap.toFixed(2) + 's', tw = g.measureText(label).width + 8, cx = (xa + xb) / 2;
      g.fillStyle = '#262628'; g.fillRect(cx - tw / 2, y - 7, tw, 14);
      g.fillStyle = gap > 1 ? '#ffb347' : '#9cc3ff'; g.fillText(label, cx, y);
    } else {
      const ov = Math.min(ae, clipEnd(b)) - b.start;
      const x1 = t2x(b.start), x2 = t2x(b.start + ov), wt = top + 18;
      g.save(); g.beginPath(); g.rect(x1, wt, x2 - x1, bot - wt); g.clip();
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x1, wt, x2 - x1, bot - wt);
      g.globalAlpha = 0.6; drawWave(a, Math.max(0, Math.floor(x1)), Math.min(W, Math.ceil(x2)), top, bot, '#ffb36b');   // 前一段的尾巴（橙色）
      g.globalAlpha = 0.6; drawWave(b, Math.max(0, Math.floor(x1)), Math.min(W, Math.ceil(x2)), top, bot, '#dcdcdf');   // 后一段的开头
      g.globalAlpha = 1;
      g.lineWidth = 1.6;
      const steps = Math.max(8, Math.round((x2 - x1) / 3));
      g.strokeStyle = '#ffb36b'; g.beginPath();
      for (let k = 0; k <= steps; k++) { const u = k / steps, y = bot - (bot - wt) * Math.cos(Math.PI / 2 * u); k ? g.lineTo(x1 + (x2 - x1) * u, y) : g.moveTo(x1, y); }
      g.stroke();
      g.strokeStyle = '#ffffff'; g.beginPath();
      for (let k = 0; k <= steps; k++) { const u = k / steps, y = bot - (bot - wt) * Math.sin(Math.PI / 2 * u); k ? g.lineTo(x1 + (x2 - x1) * u, y) : g.moveTo(x1, y); }
      g.stroke(); g.lineWidth = 1; g.restore();
      g.fillStyle = '#e6c46b'; g.fillText('交叉 ' + ov.toFixed(2) + 's', (x1 + x2) / 2, y);
    }
  }
  g.textAlign = 'left';

  placeSelPop();
  // 选区
  if (rangeSel) {
    const xa = t2x(rangeSel.a), xb = t2x(rangeSel.b);
    g.fillStyle = 'rgba(120,200,255,0.18)'; g.fillRect(xa, RULER, xb - xa, bot - RULER);
    g.strokeStyle = 'rgba(120,200,255,0.9)'; g.beginPath(); g.moveTo(xa + 0.5, RULER); g.lineTo(xa + 0.5, bot); g.moveTo(xb + 0.5, RULER); g.lineTo(xb + 0.5, bot); g.stroke();
    g.fillStyle = '#9fd8ff'; g.font = '11px "SF Mono", Menlo, monospace'; g.textBaseline = 'top';
    g.fillText(`选区 ${(rangeSel.b - rangeSel.a).toFixed(2)}s`, xa + 4, RULER + 3);
  }

  // 播放头
  const px = Math.round(t2x(playhead)) + 0.5;
  if (px >= 0 && px <= W) {
    g.strokeStyle = '#f2f2f2'; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
    g.fillStyle = '#f2f2f2'; g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 6, 0); g.lineTo(px, 9); g.fill();
  }
}

function drawClip(c, top, bot) {
  const x1 = t2x(c.start), x2 = t2x(clipEnd(c));
  if (x2 < 0 || x1 > W) return;
  const si = sIndex(c.sid), isSel = c.sid === selSid, isCur = state.sentences[state.cur] && state.sentences[state.cur].id === c.sid;
  const w = Math.max(1, x2 - x1), HEAD = 18;
  g.fillStyle = isSel ? '#585c63' : '#47494d'; g.fillRect(x1, top, w, bot - top);
  g.fillStyle = isCur ? '#e2bd52' : (isSel ? '#a9c4ee' : '#c8c9cc'); g.fillRect(x1, top, w, HEAD);
  g.save(); g.beginPath(); g.rect(x1, top, w, bot - top); g.clip();
  g.fillStyle = '#1d2a40'; g.font = '12px -apple-system, "PingFang SC"'; g.textBaseline = 'middle';
  const s = state.sentences[si];
  g.fillText(`${si + 1}. ${s ? s.text : ''}`, x1 + 5, top + HEAD / 2 + 1);
  if (c.gainDb) { g.fillStyle = '#7a3b00'; g.textAlign = 'right'; g.fillText(`${c.gainDb > 0 ? '+' : ''}${c.gainDb}dB`, x2 - 5, top + HEAD / 2 + 1); g.textAlign = 'left'; }

  // 波形
  const t = takes.get(c.take);
  g.strokeStyle = '#3c3e42'; g.beginPath(); g.moveTo(x1, (top + HEAD + bot) / 2 + 0.5); g.lineTo(x2, (top + HEAD + bot) / 2 + 0.5); g.stroke();
  // 整段铺满序号水印（正常方向，错位平铺），先画，波形盖在上面
  { const col = segColor(si), bodyH = bot - top - HEAD, fs = Math.max(26, Math.min(110, Math.round(bodyH * 0.2)));
    g.save(); g.beginPath(); g.rect(x1, top + HEAD, x2 - x1, bodyH); g.clip();
    g.globalAlpha = 0.13; g.fillStyle = col; g.font = `900 ${fs}px "SF Pro Display", -apple-system, sans-serif`; g.textBaseline = 'middle'; g.textAlign = 'left';
    const label = String(si + 1), step = g.measureText(label).width + fs * 1.1, rowH = fs * 1.35, rows = Math.max(1, Math.floor(bodyH / rowH));
    const y0 = top + HEAD + (bodyH - rows * rowH) / 2 + rowH / 2;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * step / 2, k0 = Math.max(0, Math.floor((Math.max(x1, 0) - x1 - off) / step) - 1);
      for (let xx = x1 + fs * 0.3 + off + k0 * step; xx < Math.min(x2, W) + 2; xx += step) g.fillText(label, xx, y0 + r * rowH);
    }
    g.restore(); }
  drawWave(c, Math.max(0, Math.floor(x1)), Math.min(W, Math.ceil(x2)), top, bot, null);
  // 左上角序号徽标（和左边稿子同色）
  { const col = segColor(si), bx = Math.min(Math.max(x1, 0), x2 - 44) + 5, by = top + HEAD + 5, label = String(si + 1);
    g.font = 'bold 20px -apple-system, "PingFang SC"'; const bw = Math.max(34, g.measureText(label).width + 16);
    if (x2 - x1 > 20) { g.fillStyle = col; g.beginPath(); g.roundRect ? g.roundRect(bx, by, bw, 30, 7) : g.rect(bx, by, bw, 30); g.fill();
      g.fillStyle = '#16121f'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, bx + bw / 2, by + 16); g.textAlign = 'left'; } }
  // 认出来的吸气
  if (state.breath.on) {
    g.fillStyle = 'rgba(190,90,255,0.32)';
    breathRegions(c.take).forEach(([a, b]) => {
      const bx1 = t2x(c.start + a - c.offset), bx2 = t2x(c.start + b - c.offset);
      if (bx2 > x1 && bx1 < x2) g.fillRect(bx1, top + HEAD, bx2 - bx1, bot - top - HEAD);
    });
  }
  // 淡入淡出曲线
  const fx1 = t2x(c.start + Math.min(prefs.fadeIn, c.dur / 2)), fx2 = t2x(clipEnd(c) - Math.min(prefs.fadeOut, c.dur / 2));
  const ovPrev = state.clips.some((o) => o !== c && o.start < c.start && clipEnd(o) > c.start);
  const ovNext = state.clips.some((o) => o !== c && o.start > c.start && o.start < clipEnd(c));
  g.strokeStyle = 'rgba(120,180,255,0.9)'; g.lineWidth = 1.2; g.beginPath();
  if (!ovPrev) { g.moveTo(x1, bot - 1); g.lineTo(fx1, top + HEAD + 1); }
  if (!ovNext) { g.moveTo(fx2, top + HEAD + 1); g.lineTo(x2, bot - 1); }
  g.stroke(); g.lineWidth = 1;
  g.restore();
  g.strokeStyle = isSel ? '#ffffff' : '#1e1f22'; g.lineWidth = isSel ? 1.5 : 1;
  g.strokeRect(x1 + 0.5, top + 0.5, w - 1, bot - top - 1); g.lineWidth = 1;
}

function drawWave(c, xs, xe, top, bot, color) {
  const t = takes.get(c.take), HEAD = 18;
  const mid = (top + HEAD + bot) / 2, amp = (bot - top - HEAD) / 2 - 3;
  const gl = dbToLin(c.gainDb), lin = gl * prefs.waveZoom, ml = dbToLin(state.masterGainDb), spx = 1 / pps();
  for (let x = xs; x < xe; x++) {
    const tt = x2t(x) - c.start + c.offset;
    const [mn, mx] = rangeMinMax(t, tt * t.sr, (tt + spx) * t.sr);
    const y1 = mid - Math.min(1, mx * lin) * amp, y2 = mid - Math.max(-1, mn * lin) * amp;
    g.fillStyle = color || (!prefs.limiter && Math.max(mx, -mn) * gl * ml > 1 ? '#ff6b6b' : '#dcdcdf');
    g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}

const PB = 256;
function getPeaks(t) {
  if (t.peaks) return t.peaks;
  const n = Math.ceil(t.data.length / PB), mn = new Float32Array(n), mx = new Float32Array(n);
  for (let i = 0; i < n; i++) { let a = 1, b = -1; const e = Math.min(t.data.length, (i + 1) * PB); for (let j = i * PB; j < e; j++) { const v = t.data[j]; if (v < a) a = v; if (v > b) b = v; } mn[i] = a; mx[i] = b; }
  return (t.peaks = { mn, mx });
}
function rangeMinMax(t, s0, s1) {
  s0 = Math.max(0, Math.floor(s0)); s1 = Math.min(t.data.length, Math.max(s0 + 1, Math.ceil(s1)));
  if (s1 <= s0) return [0, 0];
  let a = 1, b = -1;
  if (s1 - s0 > PB * 2) { const p = getPeaks(t); for (let i = Math.floor(s0 / PB), e = Math.ceil(s1 / PB); i < e; i++) { if (p.mn[i] < a) a = p.mn[i]; if (p.mx[i] > b) b = p.mx[i]; } }
  else for (let j = s0; j < s1; j++) { const v = t.data[j]; if (v < a) a = v; if (v > b) b = v; }
  return [a, b];
}

// ====================== 时间线交互 ======================
let drag = null;
function cpos(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

function hitTest(x, y) {
  if (y < trackTop() || y > trackBot()) return null;
  const sc = sortedClips();
  for (let i = sc.length - 1; i >= 0; i--) {
    const c = sc[i], x1 = t2x(c.start), x2 = t2x(clipEnd(c));
    if (x >= x1 - 2 && x <= x2 + 2) {
      const ew = Math.min(9, Math.max(3, (x2 - x1) / 4));
      return { clip: c, zone: x - x1 < ew ? 'left' : (x2 - x < ew ? 'right' : 'move') };
    }
  }
  return null;
}

function infoFor(c) {
  const sc = sortedClips(), i = sc.indexOf(c), prev = sc[i - 1];
  let gap = '';
  if (prev) { const d = c.start - clipEnd(prev); gap = d >= 0 ? ` · 与上一段间隙 ${d.toFixed(2)}s` : ` · 与上一段交叉 ${(-d).toFixed(2)}s`; }
  return `第 ${sIndex(c.sid) + 1} 段 · 位置 ${c.start.toFixed(2)}s · 长度 ${c.dur.toFixed(2)}s${gap}`;
}

cv.addEventListener('mousedown', (e) => {
  if (recording) return;
  const { x, y } = cpos(e);
  if (y < RULER) { playhead = Math.max(0, x2t(x)); drag = { type: 'scrub' }; if (playing) play(playhead); draw(); return; }
  const hit = hitTest(x, y);
  if (rangeSel) {   // 按住选区边缘可以左右拉
    const xa = t2x(rangeSel.a), xb = t2x(rangeSel.b);
    if (Math.abs(x - xa) <= 6) { drag = { type: 'range', t0: rangeSel.b }; return; }
    if (Math.abs(x - xb) <= 6) { drag = { type: 'range', t0: rangeSel.a }; return; }
  }
  if (e.shiftKey) {
    const t = Math.max(0, x2t(x));
    const pc = !rangeSel && state.breath.on && state.clips.find((k) => t >= k.start && t < clipEnd(k));
    if (pc) {   // Shift 单击紫色吸气区：直接选中整块，再拖边缘就能扩大
      const tt = t - pc.start + pc.offset, reg = breathRegions(pc.take).find(([a, b]) => tt >= a && tt <= b);
      if (reg) { rangeSel = { a: pc.start + reg[0] - pc.offset, b: pc.start + reg[1] - pc.offset }; drag = { type: 'range', t0: rangeSel.a, keep: true }; setStatus('已选中这块吸气，拖左右边缘扩大，再按 B 标记'); draw(); return; }
    }
    if (rangeSel) {  // Shift 再点：在原选区基础上往点的方向扩大
      const anchor = Math.abs(t - rangeSel.a) > Math.abs(t - rangeSel.b) ? rangeSel.a : rangeSel.b;
      rangeSel = { a: Math.min(anchor, t), b: Math.max(anchor, t) };
      drag = { type: 'range', t0: anchor }; draw(); return;
    }
    drag = { type: 'range', t0: t }; draw(); return;
  }
  if (!hit) { selSid = null; rangeSel = null; playhead = Math.max(0, x2t(x)); if (playing) play(playhead); drag = { type: 'range', t0: playhead }; changed(); return; }
  rangeSel = null;
  const c = hit.clip;
  selSid = c.sid;
  const si = sIndex(c.sid);
  if (si >= 0 && si !== state.cur) { state.cur = si; updateCurClass(); }
  pushUndo();
  const ripple = prefs.ripple !== e.altKey;
  drag = {
    type: hit.zone, clip: c, x0: x, moved: false,
    o: { start: c.start, offset: c.offset, dur: c.dur },
    later: ripple ? sortedClips().filter((o) => o !== c && o.start >= c.start).map((o) => ({ c: o, start: o.start })) : [],
  };
  setStatus(infoFor(c));
  updateSelUI(); draw();
});

window.addEventListener('mousemove', (e) => {
  if (!drag) {
    if (e.target !== cv) return;
    const { x, y } = cpos(e);
    const hit = y >= RULER ? hitTest(x, y) : null;
    const nearEdge = rangeSel && y >= RULER && (Math.abs(x - t2x(rangeSel.a)) <= 6 || Math.abs(x - t2x(rangeSel.b)) <= 6);
    cv.style.cursor = nearEdge ? 'col-resize' : e.shiftKey && y >= RULER ? 'crosshair' : !hit ? (y < RULER ? 'text' : 'crosshair') : (hit.zone === 'move' ? 'grab' : 'ew-resize');
    return;
  }
  const { x } = cpos(e);
  if (drag.type === 'scrub') { playhead = Math.max(0, x2t(x)); draw(); return; }
  if (drag.type === 'range') {
    const t = Math.max(0, x2t(x));
    if (drag.keep && Math.abs(t - drag.t0) * pps() <= 3) { draw(); return; }
    if (Math.abs(t - drag.t0) * pps() > 3) { drag.keep = false; rangeSel = { a: Math.min(t, drag.t0), b: Math.max(t, drag.t0) }; setStatus(`选区 ${(rangeSel.b - rangeSel.a).toFixed(2)} 秒 · 按 B 标记吸气，N 不是吸气，P 试听选区`); }
    draw(); return;
  }
  const c = drag.clip, o = drag.o, dt = (x - drag.x0) / pps();
  if (Math.abs(x - drag.x0) > 1) drag.moved = true;
  if (drag.type === 'move') {
    const ns = Math.max(0, o.start + dt), d = ns - o.start;
    c.start = ns;
    drag.later.forEach((l) => { l.c.start = Math.max(0, l.start + d); });
    cv.style.cursor = 'grabbing';
  } else if (drag.type === 'left') {
    let d = Math.min(Math.max(-o.offset, dt), o.dur - 0.05);
    if (o.start + d < 0) d = -o.start;
    c.offset = o.offset + d; c.start = o.start + d; c.dur = o.dur - d;
  } else if (drag.type === 'right') {
    const nd = Math.min(Math.max(0.05, o.dur + dt), takeLen(c) - o.offset), d = nd - o.dur;
    c.dur = nd;
    drag.later.forEach((l) => { l.c.start = Math.max(0, l.start + d); });
  }
  setStatus(infoFor(c));
  draw();
});

function placeSelPop() {
  const pop = $('#selPop');
  if (!rangeSel || (drag && drag.type === 'range')) { pop.style.display = 'none'; return; }
  const xa = t2x(rangeSel.a), xb = t2x(rangeSel.b);
  pop.style.display = 'flex';
  const w = pop.offsetWidth || 300;
  pop.style.left = Math.max(4, Math.min(W - w - 4, (xa + xb) / 2 - w / 2)) + 'px';
  pop.style.top = (RULER + 26) + 'px';
}
window.addEventListener('mouseup', () => {
  if (!drag) return;
  if (drag.clip && !drag.moved) undoStack.pop();
  const wasEdit = drag.clip && drag.moved;
  drag = null;
  if (wasEdit) renderPrompter();
  changed();
});

cv.addEventListener('dblclick', (e) => {
  const { x, y } = cpos(e); const hit = hitTest(x, y);
  if (hit) play(hit.clip.start, clipEnd(hit.clip));
});

cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {           // 触控板双指捏合 / ⌘+滚轮 = 缩放
    const { x } = cpos(e);
    setZoom(pps() * Math.exp(-e.deltaY * 0.012), x2t(x), x);
  } else if (e.altKey) {                  // Option+滚轮 = 波形放大
    prefs.waveZoom = Math.max(1, Math.min(12, prefs.waveZoom * Math.exp(-e.deltaY * 0.01)));
    $('#waveZoom').value = prefs.waveZoom; savePrefs(); draw();
  } else {
    view.x0 = Math.max(0, view.x0 + (e.deltaX + e.deltaY) / pps()); draw();
  }
}, { passive: false });

function setZoom(p, anchorT, anchorX) {
  p = Math.max(5, Math.min(2000, p));
  if (anchorT == null) { anchorX = Math.max(0, Math.min(W, t2x(playhead))); anchorT = x2t(anchorX); }
  prefs.pxPerSec = p;
  view.x0 = Math.max(0, anchorT - anchorX / p);
  $('#zoom').value = Math.log(p);
  savePrefs(); draw();
}

// ====================== 选中片段 / 增益 UI ======================
function updateSelUI() {
  const c = selSid && clipOf(selSid);
  $('#clipGain').disabled = !c; $('#btnGainAll').disabled = !c;
  document.querySelectorAll('.step[data-for=clip]').forEach((b) => { b.disabled = !c; });
  $('#clipGainNum').disabled = !c;
  if (c) { $('#clipGain').value = c.gainDb; if (document.activeElement !== $('#clipGainNum')) $('#clipGainNum').value = c.gainDb; }
  else $('#clipGainNum').value = '';
}
function syncMasterUI() { $('#masterGain').value = state.masterGainDb; if (document.activeElement !== $('#masterGainNum')) $('#masterGainNum').value = state.masterGainDb; }
function reportPeak() { const m = mixdown(true); if (!m) return; const p = peakDb(m); setStatus(`输出峰值 ${p.toFixed(1)}dB${p > 0 ? '，会爆音（波形红色部分），把增益或主音量调低一点' : ''}`, p > 0 ? 'warn' : ''); }

// ====================== 主循环：电平表、播放头、匀速滚动 ======================
const lw = $('#liveWave'), lg = lw.getContext('2d');
function loop(now) {
  // 电平表
  meterShown = Math.max(meterPeak, meterShown * 0.86); meterPeak = 0;
  const db = 20 * Math.log10(meterShown + 1e-9);
  const fill = $('#meterFill');
  fill.style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%';
  fill.classList.toggle('hot', db > -3);

  // 实时波形（录音时）
  const ldpr = window.devicePixelRatio || 1;
  if (lw.width !== 180 * ldpr) { lw.width = 180 * ldpr; lw.height = 30 * ldpr; }
  lg.setTransform(ldpr, 0, 0, ldpr, 0, 0);
  lg.clearRect(0, 0, 180, 30);
  if (recording && actx) {
    const per = Math.max(1, Math.round(micRate / lastChunkLen * 3 / 180));   // 显示最近3秒
    const cols = Math.ceil(recPeaks.length / per), startCol = Math.max(0, cols - 180);
    lg.fillStyle = '#ff7b7f';
    for (let col = startCol; col < cols; col++) {
      let pk = 0; for (let k = col * per; k < Math.min(recPeaks.length, (col + 1) * per); k++) if (recPeaks[k] > pk) pk = recPeaks[k];
      const h = Math.max(1, Math.min(1, pk * 2) * 28); lg.fillRect(col - startCol, 15 - h / 2, 1, h);
    }
    $('#timeDisp').textContent = fmtTime(Math.max(0, (recLen - recPreroll) / micRate));
  }

  // 播放头
  if (playing && actx) {
    playhead = playFrom + (actx.currentTime - playT0);
    const vw = W / pps();
    if (playhead > view.x0 + vw * 0.92 || playhead < view.x0) view.x0 = Math.max(0, playhead - vw * 0.1);
    // 播到哪句，提词器就跟到哪句
    const c = state.clips.find((k) => playhead >= k.start && playhead < clipEnd(k));
    if (c) { const i = sIndex(c.sid); if (i >= 0 && i !== state.cur) { state.cur = i; updateCurClass(); renderFoot(); } }
    drawNow();
  }
  if (!recording) $('#timeDisp').textContent = fmtTime(playhead);

  // 匀速滚动
  if (autoScrollOn) {
    const dt = (now - autoScrollLast) / 1000;
    $('#pBody').scrollTop += prefs.scrollSpeed * dt;
  }
  autoScrollLast = now;
  requestAnimationFrame(loop);
}

// ====================== 事件绑定 ======================
function isTyping() {
  const a = document.activeElement; if (!a) return false;
  if (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') return true;
  return a.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes(a.type);
}

window.addEventListener('keydown', (e) => {
  if (!state) return;
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyN') { e.preventDefault(); if (!recording) newProject(); return; }
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') { e.preventDefault(); clearTimeout(saveTimer); saveProject(); return; }
  if (isTyping()) { if (e.key === 'Escape') document.activeElement.blur(); return; }
  if (e.metaKey || e.ctrlKey) return;
  const k = e.code;
  if (k === 'KeyR') { e.preventDefault(); if (!e.repeat) recording ? stopRec(false) : startRec(); }
  else if (e.key === 'Escape') { if (recording) stopRec(true); else { stopPlay(); if (rangeSel) { rangeSel = null; draw(); } } }
  else if (k === 'Space') { e.preventDefault(); if (recording) return; playing ? stopPlay() : play(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setCur(state.cur - 1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); setCur(state.cur + 1); }
  else if (k === 'KeyP') { if (rangeSel) play(rangeSel.a, rangeSel.b); else { const s = state.sentences[state.cur]; if (s) playSentence(s.id); } }
  else if (e.key === 'Backspace' || e.key === 'Delete') { if (selSid && !recording) { e.preventDefault(); deleteClip(selSid); } }
  else if (e.key === 'Enter') { playhead = 0; view.x0 = 0; if (playing) play(0); draw(); }
  else if (k === 'KeyB') addBreathSample();
  else if (k === 'KeyN') markNotBreath();
  else if (k === 'KeyU') undoLastMark();
  else if (k === 'KeyZ' && rangeSel) { const p = Math.max(5, Math.min(2000, W * 0.8 / (rangeSel.b - rangeSel.a))); prefs.pxPerSec = p; view.x0 = Math.max(0, rangeSel.a - W * 0.1 / p); $('#zoom').value = Math.log(p); savePrefs(); draw(); }
  else if (e.key === '=' || e.key === '+') setZoom(pps() * 1.4);
  else if (e.key === '-') setZoom(pps() / 1.4);
});

// 代码有更新：停下来后自动刷新（主程序变了就提示重开）
function tryReload() {
  if (recording || playing || drag) { setStatus('软件有更新，停下来后会自动刷新', 'warn'); setTimeout(tryReload, 1000); return; }
  clearTimeout(saveTimer);
  saveProject().finally(() => location.reload());
}
if (bridge.onCodeUpdated) bridge.onCodeUpdated(tryReload);
if (bridge.onNeedRestart) bridge.onNeedRestart(() => setStatus('主程序有更新：在终端按 Ctrl+C 关掉，再运行 fenju 重新打开', 'warn'));

bridge.onMenu((cmd) => {
  if (isTyping()) { document.execCommand(cmd); return; }
  if (cmd === 'undo') undo(); else if (cmd === 'redo') redo();
});

// 提词区
$('#btnEdit').onclick = () => setEditing(!editing);
$('#sentList').addEventListener('click', (e) => {
  const el = e.target.closest('.sent'); if (!el || e.target.isContentEditable) return;
  setCur(+el.dataset.i, { force: true });
});
$('#sentList').addEventListener('dblclick', (e) => {     // 双击单句改字，不影响录音
  const el = e.target.closest('.sent'); if (!el || recording) return;
  const txt = el.querySelector('.txt'), i = +el.dataset.i, before = state.sentences[i].text;
  txt.contentEditable = 'true'; txt.focus();
  const r = document.createRange(); r.selectNodeContents(txt); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  const finish = () => {
    txt.contentEditable = 'false'; txt.removeEventListener('blur', finish);
    const v = txt.textContent.trim();
    if (v && v !== before) { pushUndo(); state.sentences[i].text = v; changed(); }
    renderPrompter();
  };
  txt.addEventListener('blur', finish);
  txt.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); txt.blur(); } });
});
$('#fontSize').oninput = (e) => { prefs.fontSize = +e.target.value; $('#sentList').style.fontSize = prefs.fontSize + 'px'; savePrefs(); if (prefs.scrollMode === 'follow') scrollCurIntoView(false); };
$('#scrollSpeed').oninput = (e) => { prefs.scrollSpeed = +e.target.value; savePrefs(); };
document.querySelectorAll('#scrollModeSeg button').forEach((b) => b.onclick = () => {
  prefs.scrollMode = b.dataset.mode; savePrefs(); stopAutoScroll(); applyPrompterPrefs();
  if (prefs.scrollMode === 'follow') scrollCurIntoView(true);
});
$('#btnScroll').onclick = () => (autoScrollOn ? stopAutoScroll() : startAutoScroll());
$('#pBody').addEventListener('wheel', () => { if (autoScrollOn && !recording) stopAutoScroll(); }, { passive: true });

// 分隔条
$('#divider').addEventListener('mousedown', (e) => {
  e.preventDefault();
  const move = (ev) => { prefs.prompterWidth = Math.max(260, Math.min(window.innerWidth - 700, ev.clientX)); $('#prompter').style.width = prefs.prompterWidth + 'px'; };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); savePrefs(); };
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
});

// 工具栏
$('#btnRec').onclick = () => (recording ? stopRec(false) : startRec());
$('#btnPlay').onclick = () => (playing ? stopPlay() : play());
$('#btnHome').onclick = () => { playhead = 0; view.x0 = 0; if (playing) play(0); draw(); };
$('#device').onchange = (e) => { prefs.deviceId = e.target.value; savePrefs(); e.target.blur(); openMic(); };
$('#projName').addEventListener('change', (e) => renameProject(e.target.value));
$('#projBar').onclick = () => { const el = $('#projName'); el.focus(); el.select(); setStatus('在右上角输入新的工程名，回车确认'); };
$('#projName').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#btnOpen').onclick = showOpenDialog;
$('#btnNew').onclick = newProject;
$('#btnReveal').onclick = () => bridge.revealProject(state.name);
$('#modalClose').onclick = () => $('#modal').classList.add('hidden');
$('#btnExportM4a').onclick = () => doExport('m4a');
$('#btnExportWav').onclick = () => doExport('wav');

$('#gap').onchange = (e) => { prefs.gap = Math.max(0, Math.min(3, +e.target.value || 0)); e.target.value = prefs.gap; savePrefs(); };
$('#btnArrange').onclick = arrangeAll;
$('#ripple').onchange = (e) => { prefs.ripple = e.target.checked; savePrefs(); };
$('#autoTrim').onchange = (e) => { prefs.autoTrim = e.target.checked; savePrefs(); };
$('#roomTone').onchange = (e) => { prefs.roomTone = e.target.checked; savePrefs(); };
$('#fadeIn').onchange = (e) => { prefs.fadeIn = Math.max(0, Math.min(1, +e.target.value || 0)); e.target.value = prefs.fadeIn; savePrefs(); draw(); };
$('#fadeOut').onchange = (e) => { prefs.fadeOut = Math.max(0, Math.min(1, +e.target.value || 0)); e.target.value = prefs.fadeOut; savePrefs(); draw(); };
$('#waveZoom').oninput = (e) => { prefs.waveZoom = +e.target.value; savePrefs(); draw(); };
$('#zoom').oninput = (e) => setZoom(Math.exp(+e.target.value));

// 增益：每3dB一个定位点（0dB最“黏”），可直接输数字，也可以点 − / ＋ 每次1dB
function snapGain(v) {
  const near = Math.round(v / 3) * 3;
  const r = near === 0 ? 0.9 : 0.6;
  return Math.abs(v - near) <= r ? near : Math.round(v * 2) / 2;
}
function setClipGain(v, final) {
  const c = selSid && clipOf(selSid); if (!c) return;
  c.gainDb = Math.max(-12, Math.min(30, Math.round(v * 2) / 2));
  state.defaultGainDb = c.gainDb;
  updateSelUI();
  if (final) { changed(); reportPeak(); } else draw();
}
function setMasterGain(v, final) {
  state.masterGainDb = Math.max(-24, Math.min(30, Math.round(v * 2) / 2));
  syncMasterUI();
  if (final) { changed(); reportPeak(); } else draw();
}
let sliderUndo = false;
['clipGain', 'masterGain'].forEach((id) => {
  const el = $('#' + id), set = id === 'clipGain' ? setClipGain : setMasterGain;
  el.addEventListener('pointerdown', () => { pushUndo(); sliderUndo = true; });
  el.oninput = () => { if (!sliderUndo) { pushUndo(); sliderUndo = true; } const v = snapGain(+el.value); el.value = v; set(v, false); };
  el.onchange = () => { sliderUndo = false; set(+el.value, true); };
  el.addEventListener('dblclick', () => { pushUndo(); set(0, true); });   // 双击滑块回到0dB
});
['clipGainNum', 'masterGainNum'].forEach((id) => {
  const el = $('#' + id), set = id === 'clipGainNum' ? setClipGain : setMasterGain;
  el.addEventListener('change', () => { if (el.value === '') return; pushUndo(); set(+el.value, true); el.blur(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
});
document.querySelectorAll('.step').forEach((b) => b.addEventListener('click', () => {
  const d = +b.dataset.d;
  if (b.dataset.for === 'clip') { const c = selSid && clipOf(selSid); if (!c) return; pushUndo(); setClipGain(c.gainDb + d, true); }
  else { pushUndo(); setMasterGain(state.masterGainDb + d, true); }
}));
$('#btnGainAll').onclick = () => {
  const c = selSid && clipOf(selSid); if (!c) return;
  pushUndo(); state.clips.forEach((x) => { x.gainDb = c.gainDb; }); state.defaultGainDb = c.gainDb;
  changed(); reportPeak();
};
$('#btnUnify').onclick = toLoudness;
$('#btnMeasure').onclick = measureNow;
$('#lufsTarget').onchange = (e) => { prefs.lufsTarget = +e.target.value; savePrefs(); showLufs(lastLufs); e.target.blur(); };
$('#btnBreathSample').onclick = addBreathSample;
$('#btnBreathClear').onclick = clearBreathSample;
$('#btnNotBreath').onclick = markNotBreath;
$('#btnUndoMark').onclick = undoLastMark;
$('#popMark').onclick = addBreathSample; $('#popNot').onclick = markNotBreath;
$('#popPlay').onclick = () => rangeSel && play(rangeSel.a, rangeSel.b);
$('#popZoom').onclick = () => { if (!rangeSel) return; const p = Math.max(5, Math.min(2000, W * 0.8 / (rangeSel.b - rangeSel.a))); prefs.pxPerSec = p; view.x0 = Math.max(0, rangeSel.a - W * 0.1 / p); $('#zoom').value = Math.log(p); savePrefs(); draw(); };
$('#popClose').onclick = () => { rangeSel = null; draw(); };
$('#selPop').addEventListener('mousedown', (e) => e.stopPropagation());
$('#denoise').oninput = (e) => { $('#denoiseVal').textContent = e.target.value + '%'; };
$('#denoise').onchange = (e) => { prefs.denoise = +e.target.value; savePrefs(); setStatus(prefs.denoise ? `降噪强度 ${prefs.denoise}%，第一次处理要算几秒` : '已关闭降噪'); setTimeout(() => { changed(); setStatus(prefs.denoise ? `降噪强度 ${prefs.denoise}%，按空格听听效果` : '已关闭降噪'); }, 30); };
$('#limiter').onchange = (e) => { prefs.limiter = e.target.checked; savePrefs(); changed(); };
$('#leveler').onchange = (e) => { prefs.leveler = e.target.checked; savePrefs(); changed(); };
$('#breathMode').onchange = (e) => { state.breath.mode = e.target.value; prefs.breathMode = e.target.value; savePrefs(); syncBreathUI(); changed(); e.target.blur(); setStatus(e.target.value === 'mute' ? '吸气处改为完全去掉，只留房间环境声' : `吸气处改为压低 ${state.breath.amountDb}dB`); };
$('#breathOn').onchange = (e) => { state.breath.on = e.target.checked; changed(); if (state.breath.on) setStatus(`已开启处理吸气，${bp() ? '按样本' : '自动'}认出 ${countBreaths()} 处（紫色），压低 ${state.breath.amountDb}dB`); };
$('#breathDb').onchange = (e) => { state.breath.amountDb = Math.max(3, Math.min(40, Math.round(+e.target.value || 12))); e.target.value = state.breath.amountDb; prefs.breathDb = state.breath.amountDb; savePrefs(); changed(); e.target.blur(); };
// 拖完滑块把焦点还回去，免得方向键、空格被滑块吃掉
document.querySelectorAll('input[type=range], input[type=checkbox], button').forEach((el) => el.addEventListener('change', () => el.blur()));
document.querySelectorAll('button').forEach((el) => el.addEventListener('mouseup', () => setTimeout(() => el.blur(), 0)));

new ResizeObserver(resizeCanvas).observe($('#timelineWrap'));
window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); saveProject(); });

// ====================== 启动 ======================
(async function init() {
  applyPrompterPrefs();
  $('#gap').value = prefs.gap; $('#ripple').checked = prefs.ripple; $('#autoTrim').checked = prefs.autoTrim;
  $('#roomTone').checked = prefs.roomTone; $('#fadeIn').value = prefs.fadeIn; $('#fadeOut').value = prefs.fadeOut;
  $('#lufsTarget').value = String(prefs.lufsTarget); showLufs(null);
  $('#denoise').value = prefs.denoise || 0; $('#denoiseVal').textContent = (prefs.denoise || 0) + '%'; $('#limiter').checked = prefs.limiter !== false; $('#leveler').checked = prefs.leveler !== false;
  if (prefs.limiter === undefined) { prefs.limiter = true; prefs.leveler = true; savePrefs(); }
  $('#waveZoom').value = prefs.waveZoom; $('#zoom').value = Math.log(prefs.pxPerSec);
  await ensureAudio();
  const last = localStorage.getItem('fenju-last');
  let loaded = false;
  if (last && await bridge.projectExists(last)) { try { await loadProject(last); loaded = true; } catch (e) { setStatus('上次的工程打不开：' + e.message, 'err'); } }
  if (!loaded) { state = freshState(); afterProjectSwitch(); }
  resizeCanvas();
  requestAnimationFrame(loop);
  await openMic();
})();

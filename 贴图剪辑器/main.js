const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const media = require('./media');
const whisper = require('./whisper');
const align = require('./align');
const srt = require('./srt');
const assets = require('./assets');
const exporter = require('./export');

app.setName('贴图剪辑器');
app.setPath('userData', path.join(app.getPath('appData'), '贴图剪辑器'));
const PROJECTS_ROOT = path.join(os.homedir(), 'Movies', '贴图剪辑器项目');
let win;

/* 记住上次打开的文件夹等小设置 */
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS(), 'utf8')); } catch { return {}; } }
function writeSettings(patch) {
  const s = { ...readSettings(), ...patch };
  try { fs.mkdirSync(path.dirname(SETTINGS()), { recursive: true }); fs.writeFileSync(SETTINGS(), JSON.stringify(s, null, 2)); } catch {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#17171a',
    title: '贴图剪辑器',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

ipcMain.handle('probe', (e, file) => {
  writeSettings({ lastVideoDir: path.dirname(file) });
  return media.probe(file);
});

// 点击导入区域：打开文件选择框，默认在上次的文件夹
ipcMain.handle('pick-video', async () => {
  const last = readSettings().lastVideoDir;
  const r = await dialog.showOpenDialog(win, {
    title: '选择剪映粗剪好的视频或杂谈录音',
    defaultPath: last && fs.existsSync(last) ? last : path.join(os.homedir(), 'Movies'),
    properties: ['openFile'],
    filters: [{ name: '视频或录音', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'aif', 'aiff'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

ipcMain.handle('create-project', (e, videoPath) => {
  const base = path.basename(videoPath, path.extname(videoPath)).slice(0, 40);
  const dir = path.join(PROJECTS_ROOT, `${base}-${stamp()}`);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  return dir;
});

ipcMain.handle('extract-audio', async (e, { videoPath, dir }) => {
  const { peaks } = await media.extractAudio(videoPath, dir);
  return Array.from(peaks);
});

ipcMain.handle('save-project', (e, { dir, data }) => {
  const file = path.join(dir, 'project.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(file + '.tmp', file);
  return true;
});

ipcMain.handle('open-project', async () => {
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  const r = await dialog.showOpenDialog({
    title: '打开项目',
    defaultPath: PROJECTS_ROOT,
    properties: ['openDirectory'],
    message: '选择一个项目文件夹',
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  const file = path.join(dir, 'project.json');
  if (!fs.existsSync(file)) throw new Error('这个文件夹不是贴图剪辑器的项目');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!fs.existsSync(data.video.path)) throw new Error('找不到原视频，可能被移动或删除了：' + data.video.path);
  const peaksFile = path.join(dir, 'peaks.bin');
  let peaks;
  if (fs.existsSync(peaksFile) && fs.existsSync(path.join(dir, 'audio.wav'))) peaks = Array.from(fs.readFileSync(peaksFile));
  else peaks = Array.from((await media.extractAudio(data.video.path, dir)).peaks);
  return { dir, data, peaks };
});

ipcMain.handle('tools-status', () => ({
  ffmpeg: media.findBin('ffmpeg'),
  ffprobe: media.findBin('ffprobe'),
  whisper: whisper.findWhisper(),
  model: whisper.findModel(),
  vadModel: whisper.findVadModel(),
}));

ipcMain.handle('font-path', () => path.join(__dirname, 'fonts', 'NotoSansSC-Bold.ttf'));

/* ---------- 字幕识别 ---------- */
let running = null;

ipcMain.handle('transcribe', async (e, { dir, duration }) => {
  if (running) throw new Error('正在识别中');
  const wav = path.join(dir, 'audio.wav');
  if (!fs.existsSync(wav)) throw new Error('找不到项目的音频文件，请重新导入视频');
  const job = whisper.transcribe(wav, dir, p => win && win.webContents.send('transcribe-progress', p));
  running = job;
  try {
    const { raw, mode } = await job.done;
    // 留一份给开发调试用
    try {
      fs.mkdirSync(path.join(__dirname, 'debug'), { recursive: true });
      fs.copyFileSync(path.join(dir, 'whisper.json'), path.join(__dirname, 'debug', 'last-whisper.json'));
      fs.copyFileSync(path.join(dir, 'whisper-log.json'), path.join(__dirname, 'debug', 'last-whisper-log.json'));
    } catch {}
    const segs = whisper.parseWhisperJson(raw);
    let vad = null;
    try { vad = align.detectSpeech(wav); } catch {}
    // 没有精确时间戳时，超过10秒的长句段容易漂移，用音频自己对轨
    if (!segs.dtw) align.alignSegments(segs.filter(sg => sg.end - sg.start > 10), vad);
    const cues = whisper.buildCues(segs, vad, duration);
    return { cues, mode: { ...mode, dtw: !!segs.dtw } };
  } finally {
    running = null;
  }
});

// 导入剪映导出的SRT字幕
ipcMain.handle('load-srt', (e, { file, duration }) => {
  const items = srt.parseSrt(file);
  if (!items.length) throw new Error('这个文件里没读到字幕');
  return whisper.cuesFromSrt(items, duration);
});
ipcMain.handle('find-srt', (e, videoPath) => srt.findSiblingSrt(videoPath));
ipcMain.handle('pick-srt', async () => {
  const last = readSettings().lastVideoDir;
  const r = await dialog.showOpenDialog(win, {
    title: '选择剪映导出的字幕文件',
    defaultPath: last && fs.existsSync(last) ? last : os.homedir(),
    properties: ['openFile'],
    filters: [{ name: '字幕', extensions: ['srt'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

// 表情包素材
ipcMain.handle('import-assets', async (e, { dir, files }) => {
  const out = [];
  for (const f of files) {
    try { out.push(await assets.importFile(dir, f)); }
    catch (err) { out.push({ error: err.message, name: path.basename(f) }); }
  }
  return out;
});
// 视频素材的预览代理：720P、每半秒一个关键帧、普通MP4，拖播放头时定位快，几路视频一起播也不卡
// 只给预览用，导出仍然用原文件（画质不受影响）；存在项目的 proxies 文件夹里，删了下次会重新生成
const proxyJobs = new Map();
ipcMain.handle('make-proxy', (e, { dir, file }) => {
  const src = path.join(dir, 'assets', file);
  const out = path.join(dir, 'proxies', file.replace(/\.[^.]+$/, '') + '.mp4');
  try { if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) return out; } catch { return null; }
  if (proxyJobs.has(out)) return proxyJobs.get(out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out + '.part.mp4';
  const job = new Promise(resolve => {
    const p = spawn(media.findBin('ffmpeg'), ['-y', '-v', 'error', '-i', src,
      '-vf', "scale='min(1280,iw)':-2,fps=30", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-g', '15', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmp]);
    p.on('error', () => resolve(null));
    p.on('close', code => {
      proxyJobs.delete(out);
      if (code === 0) { try { fs.renameSync(tmp, out); return resolve(out); } catch {} }
      try { fs.unlinkSync(tmp); } catch {}
      resolve(null);
    });
  });
  proxyJobs.set(out, job);
  return job;
});
// 视频素材的波形（和母体视频同一种算法、同一个刻度），缓存在 proxies 文件夹；没有声音返回空
const peakJobs = new Map();
ipcMain.handle('asset-peaks', (e, { dir, file }) => {
  const src = path.join(dir, 'assets', file);
  const out = path.join(dir, 'proxies', file.replace(/\.[^.]+$/, '') + '.peaks');
  try { if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) return Array.from(fs.readFileSync(out)); } catch { return []; }
  if (peakJobs.has(out)) return peakJobs.get(out);
  const job = (async () => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const wav = out + '.tmp.wav';
    try {
      await media.run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
      const pk = media.computePeaks(wav, 100);
      fs.writeFileSync(out, Buffer.from(pk));
      return Array.from(pk);
    } catch { return []; }
    finally { try { fs.unlinkSync(wav); } catch {} peakJobs.delete(out); }
  })();
  peakJobs.set(out, job);
  return job;
});
ipcMain.handle('paste-asset', (e, { dir }) => assets.importClipboard(dir));
ipcMain.handle('save-asset-bytes', (e, { dir, name, bytes }) => assets.saveBytes(dir, name, bytes));

/* ---------- 素材库：用户添加的素材文件夹 ---------- */
const LIB_EXT = /\.(png|jpe?g|webp|bmp|heic|gif|mp4|mov|m4v|webm|mkv|avi)$/i;
// 素材库里加进来的东西：可以是整个文件夹，也可以是单个图片、GIF、视频
const libKind = p => { try { const st = fs.statSync(p); if (st.isDirectory()) return { kind: 'dir', mtime: st.mtimeMs }; if (LIB_EXT.test(p)) return { kind: /\.gif$/i.test(p) ? 'gif' : /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(p) ? 'video' : 'image', mtime: st.mtimeMs }; } catch {} return null; };
ipcMain.handle('lib-roots', () => (readSettings().libRoots || []).map(p => ({ path: p, ...libKind(p) })).filter(x => x.kind));
ipcMain.handle('lib-add-root', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '添加素材：可以选文件夹，也可以选单个图片、GIF、视频（按住Cmd多选）',
    buttonLabel: '添加',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: '图片、GIF、视频', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'heic', 'gif', 'mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }],
    defaultPath: readSettings().lastLibDir || os.homedir(),
  });
  if (r.canceled || !r.filePaths.length) return [];
  const picked = r.filePaths.filter(p => libKind(p));
  const roots = (readSettings().libRoots || []).filter(p => !picked.includes(p));
  roots.push(...picked);
  writeSettings({ libRoots: roots, lastLibDir: path.dirname(picked[0] || r.filePaths[0]) });
  return picked.map(p => ({ path: p, ...libKind(p) }));
});
ipcMain.handle('lib-remove-root', (e, p) => {
  writeSettings({ libRoots: (readSettings().libRoots || []).filter(x => x !== p) });
  return true;
});
ipcMain.handle('lib-list', (e, dir) => {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      let count = 0;
      try { count = fs.readdirSync(full).filter(n => !n.startsWith('.')).length; } catch {}
      out.push({ name, path: full, kind: 'dir', mtime: st.mtimeMs, count });
    } else if (LIB_EXT.test(name)) {
      out.push({ name, path: full, kind: /\.gif$/i.test(name) ? 'gif' : /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(name) ? 'video' : 'image', mtime: st.mtimeMs });
    }
  }
  // 文件夹在前；文件按时间从新到旧，刚存的图排最前面
  out.sort((a, b) => (a.kind === 'dir') !== (b.kind === 'dir') ? (a.kind === 'dir' ? -1 : 1) : a.kind === 'dir' ? a.name.localeCompare(b.name, 'zh') : b.mtime - a.mtime);
  return out;
});
// 盯住正在看的文件夹，有新文件就通知界面刷新
let libWatcher = null, libTimer = null;
ipcMain.handle('lib-watch', (e, dir) => {
  if (libWatcher) { libWatcher.close(); libWatcher = null; }
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    libWatcher = fs.watch(dir, () => {
      clearTimeout(libTimer);
      libTimer = setTimeout(() => win && win.webContents.send('lib-changed', dir), 300);
    });
  } catch { return false; }
  return true;
});

/* ---------- 导出 ---------- */
let exporting = null;
// 默认：存到“影片/贴图剪辑器成片”，文件名按导出时间
ipcMain.handle('export-defaults', () => {
  const last = readSettings().lastExportDir;
  const folder = last && fs.existsSync(last) ? last : path.join(os.homedir(), 'Movies', '贴图剪辑器成片');
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const title = `贴图剪辑_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
  return { folder, title, quality: readSettings().lastQuality || 'h264', exportKey: readSettings().exportKey || 'Meta+E' };
});

/* ---------- 设置 ---------- */
ipcMain.handle('settings-get', () => readSettings());
ipcMain.handle('settings-set', (e, patch) => { writeSettings(patch); return readSettings(); });

/* ---------- 缓存清理 ---------- */
function dirSize(p) {
  let n = 0;
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.size;
    for (const f of fs.readdirSync(p)) n += dirSize(path.join(p, f));
  } catch {}
  return n;
}
// 临时文件：导出临时文件夹、背景缓存、旧版留下的试看视频；旧项目：超过30天没动过的项目文件夹
function scanCache() {
  const res = { tempBytes: 0, tempItems: [], oldBytes: 0, oldDirs: [] };
  if (!fs.existsSync(PROJECTS_ROOT)) return res;
  const now = Date.now();
  for (const name of fs.readdirSync(PROJECTS_ROOT)) {
    const dir = path.join(PROJECTS_ROOT, name);
    try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
    for (const t of ['export-tmp', 'bgcache', '试看.mp4']) {
      const p = path.join(dir, t);
      if (fs.existsSync(p)) { res.tempBytes += dirSize(p); res.tempItems.push(p); }
    }
    let mt = 0;
    try { mt = fs.statSync(path.join(dir, 'project.json')).mtimeMs; } catch {}
    if (mt && now - mt > 30 * 86400e3) { res.oldBytes += dirSize(dir); res.oldDirs.push(dir); }
  }
  return res;
}
ipcMain.handle('cache-scan', () => {
  const r = scanCache();
  return { tempBytes: r.tempBytes, oldBytes: r.oldBytes, oldCount: r.oldDirs.length };
});
ipcMain.handle('cache-clean', (e, { old, keepDir }) => {
  const r = scanCache();
  let freed = 0;
  for (const p of r.tempItems) {
    if (exporting && keepDir && p.startsWith(keepDir)) continue;
    freed += dirSize(p);
    try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
  }
  if (old) for (const d of r.oldDirs) {
    if (keepDir && d === keepDir) continue;
    freed += dirSize(d);
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
  return freed;
});
// 启动时自动清掉一天以前的导出临时文件
function autoClean() {
  if (!fs.existsSync(PROJECTS_ROOT)) return;
  for (const name of fs.readdirSync(PROJECTS_ROOT)) {
    const p = path.join(PROJECTS_ROOT, name, 'export-tmp');
    try { if (Date.now() - fs.statSync(p).mtimeMs > 86400e3) fs.rmSync(p, { recursive: true, force: true }); } catch {}
  }
}
ipcMain.handle('export-pick-folder', async (e, { folder }) => {
  const r = await dialog.showOpenDialog(win, { title: '成片保存到哪个文件夹', defaultPath: fs.existsSync(folder) ? folder : os.homedir(), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  writeSettings({ lastExportDir: r.filePaths[0] }); // 选完马上记住
  return r.filePaths[0];
});
ipcMain.handle('export-estimate', async (e, { dir, project, quality, range, bgLoops }) => {
  const tmpDir = path.join(dir, 'export-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  exporter.cancelEstimates(); // 只留最新的一次估算
  return exporter.estimate({ project, quality, range, tmpDir, dir, bgLoops });
});
// subs：[{bytes, start, end}]，时间已经换算成导出范围内的时间
ipcMain.handle('export-start', async (e, { dir, project, quality, range, subs, blank, folder, title, preview, bgLoops, masks, texts }) => {
  if (exporting) throw new Error('正在导出中');
  exporter.cancelEstimates(); // 正式导出时停掉还在跑的估算
  const tmp = path.join(dir, 'export-tmp');
  fs.mkdirSync(tmp, { recursive: true });
  for (const f of fs.readdirSync(tmp)) { try { fs.unlinkSync(path.join(tmp, f)); } catch {} }
  const blankFile = path.join(tmp, 'blank.png');
  fs.writeFileSync(blankFile, Buffer.from(blank));
  const subFiles = subs.map((s, i) => {
    const file = path.join(tmp, `sub_${String(i).padStart(4, '0')}.png`);
    fs.writeFileSync(file, Buffer.from(s.bytes));
    return { file, start: s.start, end: s.end };
  });
  // 圆形、圆角素材的遮罩图
  for (const m of masks || []) {
    const st = project.stickers.find(x => x.id === m.id);
    if (!st) continue;
    st.mask = path.join(tmp, `mask_${m.id}.png`);
    fs.writeFileSync(st.mask, Buffer.from(m.bytes));
  }
  // 文本：界面画好的透明PNG
  for (const t of texts || []) {
    const st = project.stickers.find(x => x.id === t.id);
    if (!st) continue;
    st.textFile = path.join(tmp, `text_${t.id}.png`);
    fs.writeFileSync(st.textFile, Buffer.from(t.bytes));
  }
  const D = range.end - range.start;
  const subList = subFiles.length ? exporter.writeSubConcat(tmp, subFiles, blankFile, D) : null;
  // 正式导出和试看都存到选好的文件夹；试看文件名后面带“-试看”
  fs.mkdirSync(folder, { recursive: true });
  const safe = ((title || '成片').replace(/[\\/:*?"<>|]/g, '_').trim() || '成片') + (preview ? '-试看' : '');
  let out = path.join(folder, safe + '.mp4');
  let i = 2;
  while (fs.existsSync(out)) out = path.join(folder, `${safe}-${i++}.mp4`);
  writeSettings({ lastExportDir: folder, lastQuality: quality });
  const job = exporter.run({ project, dir, out, quality, range, subList, bgLoops }, p => win && win.webContents.send('export-progress', p));
  exporting = job;
  try {
    fs.writeFileSync(path.join(tmp, 'ffmpeg-args.txt'), job.args.join('\n'));
    await job.done;
    shell.openPath(out); // 导出完自动打开播放
    let size = 0;
    try { size = fs.statSync(out).size; } catch {}
    return { out, size };
  } finally {
    exporting = null;
  }
});
// 背景缓存：同样参数的背景只生成一次
ipcMain.handle('bg-cache', (e, { dir, key, ext }) => {
  const cdir = path.join(dir, 'bgcache');
  fs.mkdirSync(cdir, { recursive: true });
  const hash = require('crypto').createHash('md5').update(key).digest('hex').slice(0, 12);
  const file = path.join(cdir, `bg_${hash}.${ext}`);
  return { file, exists: fs.existsSync(file) };
});
ipcMain.handle('bg-still', (e, { file, bytes }) => { fs.writeFileSync(file, Buffer.from(bytes)); return file; });
ipcMain.handle('bg-begin', (e, { file, fps }) => exporter.bgBegin(file, fps));
ipcMain.handle('bg-frame', (e, { file, bytes }) => exporter.bgFrame(file, bytes));
ipcMain.handle('bg-end', (e, { file, abort }) => exporter.bgEnd(file, abort));
ipcMain.handle('export-cancel', () => { if (exporting) exporting.kill(); return true; });
ipcMain.handle('show-in-folder', (e, p) => shell.showItemInFolder(p));
ipcMain.handle('open-file', (e, p) => shell.openPath(p));

ipcMain.handle('cancel-transcribe', () => {
  if (running) running.kill();
  return true;
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, 'build', 'icon.png')); } catch {}
  }
  createWindow();
  setTimeout(autoClean, 5000);
});
app.on('window-all-closed', () => {
  if (running) running.kill();
  if (exporting) exporting.kill();
  app.quit();
});

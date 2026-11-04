// 录音机：录音、豆包语音识别、点字回放
const { app, BrowserWindow, ipcMain, shell, systemPreferences, clipboard, dialog, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const WebSocket = require('ws');

app.setName('录音机');
const SRC = path.join(__dirname, 'src');
const dataDir = () => { const d = path.join(app.getPath('documents'), '录音机'); fs.mkdirSync(d, { recursive: true }); return d; };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  appId: '', token: '', resourceId: 'volc.seedasr.sauc.duration',
  lead: 0.3, usedSeconds: 0, quotaHours: 20, counter: 0,
  exportDir: '', inputId: '', outputId: '', denoise: true, agc: false, boost: true, shareText: true, shareAudio: true, bounds: null,
};
function loadSettings() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch (e) { return Object.assign({}, DEFAULTS); }
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}
let settings = loadSettings();

// ---------- 窗口 ----------
let win;
function createWindow() {
  const b = settings.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1000, height: b.height || 700, x: b.x, y: b.y, minWidth: 340, minHeight: 190,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#ffffff', title: '录音机',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile(path.join(SRC, 'index.html'));
  win.on('close', () => { settings.bounds = win.getBounds(); saveSettings(settings); });
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '录音机', submenu: [{ role: 'hide', label: '隐藏' }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'reload', label: '重新载入' }] },
  ]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());

// ---------- 设置 ----------
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (e, patch) => { settings = Object.assign(settings, patch); saveSettings(settings); return settings; });

// ---------- 麦克风 ----------
ipcMain.handle('mic:ask', async () => {
  if (process.platform !== 'darwin') return true;
  const st = systemPreferences.getMediaAccessStatus('microphone');
  if (st === 'granted') return true;
  if (st === 'denied' || st === 'restricted') return false;
  return await systemPreferences.askForMediaAccess('microphone');
});
ipcMain.handle('mic:settings', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'));

// ---------- 录音文件 ----------
const metaPath = (id) => path.join(dataDir(), id + '.json');
const audioPath = (m) => path.join(dataDir(), m.audioFile || (m.id + '.m4a'));
const readMeta = (id) => JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
const writeMeta = (m) => fs.writeFileSync(metaPath(m.id), JSON.stringify(m));
const pad = (n) => String(n).padStart(2, '0');
function newId() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
function run(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, (err, so, se) => (err ? reject(new Error(se || err.message)) : resolve(so))));
}
function makeWav(pcm, sr) {
  sr = sr || 16000;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
// 按块解析 wav，找到 data 块（系统转出来的 wav 文件头不一定是 44 字节）
function parseWav(buf) {
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    if (id === 'data') {
      if (size === 0xffffffff || pos + 8 + size > buf.length) size = buf.length - pos - 8;
      return buf.slice(pos + 8, pos + 8 + size);
    }
    pos += 8 + size + (size & 1);
  }
  return null;
}

ipcMain.handle('rec:list', () => {
  const out = [];
  for (const f of fs.readdirSync(dataDir())) {
    if (!f.endsWith('.json')) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dataDir(), f), 'utf8'));
      out.push({ id: m.id, name: m.name, createdAt: m.createdAt, duration: m.duration, status: m.status });
    } catch (e) { /* 跳过坏文件 */ }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
});
ipcMain.handle('rec:get', (e, id) => readMeta(id));
ipcMain.handle('rec:audioUrl', (e, id) => ({ url: pathToFileURL(audioPath(readMeta(id))).href }));
ipcMain.handle('rec:audioBytes', (e, id) => fs.readFileSync(audioPath(readMeta(id))));

ipcMain.handle('rec:save', async (e, ab, wantId, sampleRate) => {
  const pcm = Buffer.from(ab);
  const sr = Number.isFinite(sampleRate) && sampleRate >= 8000 && sampleRate <= 96000 ? Math.round(sampleRate) : 16000;
  let id = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(wantId || '') ? wantId : newId();
  if (fs.existsSync(path.join(dataDir(), id + '.json'))) id = newId();
  const wav = path.join(dataDir(), id + '.wav');
  const m4a = path.join(dataDir(), id + '.m4a');
  fs.writeFileSync(wav, makeWav(pcm, sr));
  let audioFile = id + '.m4a';
  try { await run('/usr/bin/afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '96000', wav, m4a]); } catch (err) {
    try { await run('/usr/bin/afconvert', ['-f', 'm4af', '-d', 'aac', wav, m4a]); } catch (err2) { audioFile = id + '.wav'; }
  }
  settings.counter = (settings.counter || 0) + 1;
  saveSettings(settings);
  const m = {
    id, name: id, createdAt: new Date().toISOString(),
    duration: pcm.length / (2 * sr), status: 'pending', audioFile, sampleRate: sr,
  };
  writeMeta(m);
  return m;
});

ipcMain.handle('rec:remove', async (e, id) => {
  for (const ext of ['m4a', 'wav', 'json']) {
    const p = path.join(dataDir(), id + '.' + ext);
    if (fs.existsSync(p)) await shell.trashItem(p);
  }
  return true;
});

// ---------- 豆包流式语音识别 ----------
function frame(type, flags, ser, payload) {
  const body = zlib.gzipSync(payload);
  const head = Buffer.from([0x11, (type << 4) | flags, (ser << 4) | 1, 0]);
  const size = Buffer.alloc(4); size.writeUInt32BE(body.length);
  return Buffer.concat([head, size, body]);
}
function parseFrame(buf) {
  const type = buf[1] >> 4, flags = buf[1] & 15, ser = buf[2] >> 4, comp = buf[2] & 15;
  let off = 4;
  if (type === 15) {
    const code = buf.readUInt32BE(off); off += 4;
    const n = buf.readUInt32BE(off); off += 4;
    return { error: code, msg: buf.slice(off, off + n).toString() };
  }
  if (flags & 1) off += 4;
  if (flags & 4) off += 4;
  const n = buf.readUInt32BE(off); off += 4;
  let p = buf.slice(off, off + n);
  if (comp === 1) p = zlib.gunzipSync(p);
  return { last: !!(flags & 2), json: ser === 1 ? JSON.parse(p.toString()) : null };
}
function asr(pcm, onProgress) {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream', {
      headers: {
        'X-Api-App-Key': settings.appId, 'X-Api-Access-Key': settings.token,
        'X-Api-Resource-Id': settings.resourceId, 'X-Api-Connect-Id': crypto.randomUUID(),
      },
    });
    let lastJson = null, done = false, timer = null;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch (e) { /* 忽略 */ } resolve(r); };
    ws.on('unexpected-response', (req, res) => { const a = res.statusCode === 403 || res.statusCode === 401; finish({ error: (a ? '鉴权失败（HTTP ' : 'HTTP ') + res.statusCode + (a ? '）' : ''), kind: a ? 'auth' : 'other' }); });
    ws.on('error', (err) => finish({ error: '网络错误：' + err.message }));
    ws.on('open', async () => {
      const req = {
        user: { uid: 'luyinji' }, audio: { format: 'pcm', rate: 16000, bits: 16, channel: 1, codec: 'raw' },
        request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, show_utterances: true, result_type: 'full' },
      };
      ws.send(frame(1, 0, 1, Buffer.from(JSON.stringify(req))));
      const CH = 6400;
      for (let i = 0; i < pcm.length; i += CH) {
        if (done) return;
        const last = i + CH >= pcm.length;
        ws.send(frame(2, last ? 2 : 0, 0, pcm.slice(i, i + CH)));
        onProgress(Math.min(90, Math.round((i / pcm.length) * 90)));
        await new Promise((r) => setTimeout(r, 15));
      }
      timer = setTimeout(() => finish({ error: '识别超时' }), 90000);
    });
    ws.on('message', (data) => {
      let m;
      try { m = parseFrame(data); } catch (err) { return finish({ error: '解析失败：' + err.message }); }
      if (m.error) return finish({ error: m.error + ' ' + m.msg, kind: m.error === 45000292 || /quota|exceed|limit|额度|欠费|arrear|balance|expire|过期|insufficient/i.test(m.msg) ? 'quota' : /auth|token|forbidden|permission|resource|unauthor|invalid.*(app|key|token)/i.test(m.msg) ? 'auth' : 'other' });
      if (m.json) lastJson = m.json;
      if (m.last) finish({ json: lastJson });
    });
  });
}

ipcMain.handle('rec:transcribe', async (e, id) => {
  const send = (pct) => { try { e.sender.send('trans:progress', { id, pct }); } catch (err) { /* 窗口已关 */ } };
  if (!settings.appId || !settings.token) return { ok: false, error: '请先点齿轮，填入 App ID 和 Token', kind: 'auth' };
  const m = readMeta(id);
  const wav = path.join(dataDir(), id + '.wav');
  const tmp = path.join(app.getPath('temp'), id + '_16k.wav');
  let pcm = null;
  try {
    // 不管录音是多少采样率，统一转成 16k 单声道再识别
    await run('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', fs.existsSync(wav) ? wav : audioPath(m), tmp]);
    pcm = parseWav(fs.readFileSync(tmp));
  } catch (err) {
    return { ok: false, error: '音频转换失败：' + err.message, kind: 'other' };
  } finally { fs.rmSync(tmp, { force: true }); }
  if (!pcm || pcm.length < 3200) return { ok: false, error: '录音太短或没有声音', kind: 'other' };
  send(1);
  const r = await asr(pcm, send);
  if (r.error) { m.status = 'error'; m.error = r.error; m.errorKind = r.kind; writeMeta(m); return { ok: false, error: r.error, kind: r.kind }; }
  const res = (r.json && r.json.result) || {};
  m.utterances = res.utterances || [];
  m.text = res.text || '';
  m.status = 'done';
  delete m.error; delete m.errorKind;
  m.duration = m.duration || pcm.length / 32000;
  writeMeta(m);
  if (fs.existsSync(wav)) fs.rmSync(wav, { force: true });
  settings.usedSeconds = (settings.usedSeconds || 0) + pcm.length / 32000;
  saveSettings(settings);
  send(100);
  return { ok: true, meta: m };
});

// ---------- 复制、导出、分享 ----------
ipcMain.handle('copy', (e, text) => { clipboard.writeText(text); return true; });

function filesToClipboard(files) {
  if (process.platform !== 'darwin') return;
  const items = files.map((f) => `<string>${f.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`).join('');
  const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><array>${items}</array></plist>`;
  try { clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist)); } catch (err) { /* 忽略 */ }
}
ipcMain.handle('pick:exportDir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return settings.exportDir;
  settings.exportDir = r.filePaths[0]; saveSettings(settings);
  return settings.exportDir;
});
ipcMain.handle('export', async (e, { id, text }) => {
  if (!settings.exportDir || !fs.existsSync(settings.exportDir)) {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    settings.exportDir = r.filePaths[0]; saveSettings(settings);
  }
  const m = readMeta(id);
  const files = [];
  const t = path.join(settings.exportDir, id + '.txt');
  fs.writeFileSync(t, text); files.push(t);
  const a = audioPath(m);
  if (fs.existsSync(a)) { const dst = path.join(settings.exportDir, path.basename(a)); fs.copyFileSync(a, dst); files.push(dst); }
  shell.showItemInFolder(files[0]);
  return { ok: true, dir: settings.exportDir };
});
ipcMain.handle('share', async (e, { id, text }) => {
  const m = readMeta(id);
  const files = [];
  if (settings.shareText && text) {
    const d = path.join(dataDir(), '分享'); fs.mkdirSync(d, { recursive: true });
    const t = path.join(d, id + '.txt'); fs.writeFileSync(t, text); files.push(t);
  }
  if (settings.shareAudio && fs.existsSync(audioPath(m))) files.push(audioPath(m));
  if (!files.length) return { ok: false, msg: '设置里没有勾选分享内容' };
  filesToClipboard(files);
  const ok = await new Promise((resolve) => execFile('open', ['-a', 'WeChat', ...files], (err) => resolve(!err)));
  return ok ? { ok: true } : { ok: false, msg: '没找到微信' };
});

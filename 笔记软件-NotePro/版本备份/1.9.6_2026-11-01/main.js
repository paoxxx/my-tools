/* 笔记软件 主进程 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

app.setName('Note Pro');
// 改名后设置、颜色槽、导出设置等仍用原来的数据目录，不丢
app.setPath('userData', path.join(app.getPath('appData'), '笔记软件'));
const SRC = path.join(__dirname, 'src');
const notesDir = () => {
  const d = path.join(app.getPath('documents'), '笔记软件');
  fs.mkdirSync(d, { recursive: true });
  return d;
};

let win = null;

// 窗口大小和位置：记住上次退出时的样子（屏幕换了、位置跑到屏幕外就只保留大小）
function savedBounds() {
  const b = readCfg().win;
  if (!b || !(b.width > 300) || !(b.height > 200)) return null;
  try {
    const { screen } = require('electron');
    const wa = screen.getDisplayMatching(b).workArea;
    const visible = b.x < wa.x + wa.width - 60 && b.x + b.width > wa.x + 60 && b.y >= wa.y - 10 && b.y < wa.y + wa.height - 40;
    return visible ? b : { width: Math.min(b.width, wa.width), height: Math.min(b.height, wa.height) };
  } catch (e) { return { width: b.width, height: b.height }; }
}
function rememberBounds(w) {
  let t = 0;
  const save = () => {
    if (!w || w.isDestroyed() || w.isFullScreen() || w.isMinimized()) return;
    const c = readCfg(); c.win = w.getBounds(); writeCfg(c);
  };
  const later = () => { clearTimeout(t); t = setTimeout(save, 400); };
  w.on('resize', later);
  w.on('move', later);
  w.on('close', () => { clearTimeout(t); save(); });
}
// 录课窗口：按 16:9 设成正好的录制像素（Retina 屏 960×540 就是 1920×1080）
ipcMain.handle('win:size', (e, pw, ph) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return null;
  if (w.isFullScreen()) w.setFullScreen(false);
  const { screen } = require('electron');
  const d = screen.getDisplayMatching(w.getBounds());
  const sf = d.scaleFactor || 1, wa = d.workArea;
  const cw = Math.round(pw / sf), ch = Math.round(ph / sf);
  w.setContentSize(Math.min(cw, wa.width), Math.min(ch, wa.height));
  const b = w.getBounds();
  w.setPosition(Math.max(wa.x, Math.min(b.x, wa.x + wa.width - b.width)), Math.max(wa.y, Math.min(b.y, wa.y + wa.height - b.height)));
  return { sf, w: cw, h: ch, fit: cw <= wa.width && ch <= wa.height };
});

// iPad 比例：窗口锁定成 iPad Pro 11 屏幕的长宽比（2388:1668），拉大缩小都保持这个比例，
// 放到 iPad 副屏上或共享给学生时能铺满，没有黑边
const IPAD_RATIO = 2388 / 1668;
function applyRatio(w, on, resize) {
  if (!w || w.isDestroyed()) return;
  w.setAspectRatio(on ? IPAD_RATIO : 0);
  if (!on || !resize || w.isFullScreen()) return;
  const { screen } = require('electron');
  const wa = screen.getDisplayMatching(w.getBounds()).workArea;
  const [cw] = w.getContentSize();
  let nw = cw, nh = Math.round(cw / IPAD_RATIO);
  if (nh > wa.height) { nh = wa.height; nw = Math.round(nh * IPAD_RATIO); }
  if (nw > wa.width) { nw = wa.width; nh = Math.round(nw / IPAD_RATIO); }
  w.setContentSize(nw, nh);
  const b = w.getBounds();
  w.setPosition(Math.max(wa.x, Math.min(b.x, wa.x + wa.width - b.width)), Math.max(wa.y, Math.min(b.y, wa.y + wa.height - b.height)));
}
ipcMain.handle('win:ratio', (e, on) => {
  const c = readCfg();
  if (on === undefined || on === null) return !!c.winRatio;
  c.winRatio = !!on; writeCfg(c);
  applyRatio(BrowserWindow.fromWebContents(e.sender), !!on, true);
  return !!on;
});

function createWindow() {
  const sb = savedBounds();
  win = new BrowserWindow({
    width: 1360, height: 960, ...(sb || {}), minWidth: 640, minHeight: 400,
    title: 'Note Pro',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: '#F3F4EF',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.loadFile(path.join(SRC, 'index.html'));
  win.on('closed', () => { win = null; });
  trafficLights(win);
  rememberBounds(win);
  if (readCfg().winRatio) applyRatio(win, true, false);
  // 页面代码更新了：切回软件窗口时自动刷新（刷新前会存盘），不用手动 ⌘R
  const srcStamp = () => { try { return ['index.html', 'css/app.css', 'js/app.js', 'js/core.js', 'js/store.js'].map((f) => fs.statSync(path.join(SRC, f)).mtimeMs).join(','); } catch (e) { return ''; } };
  let loadedStamp = '';
  win.webContents.on('did-finish-load', () => { loadedStamp = srcStamp(); });
  win.on('focus', () => { const now = srcStamp(); if (loadedStamp && now && now !== loadedStamp) { loadedStamp = now; win.webContents.reload(); } });
}

// 红绿灯平时隐藏：鼠标移到窗口左上角才出现（全屏时交给系统，鼠标移到顶上自然出现）
function trafficLights(w) {
  if (process.platform !== 'darwin' || !w.setWindowButtonVisibility) return;
  const { screen } = require('electron');
  let shown = true;
  const set = (v) => { if (v !== shown && !w.isDestroyed()) { shown = v; w.setWindowButtonVisibility(v); } };
  set(false);
  const t = setInterval(() => {
    if (w.isDestroyed()) { clearInterval(t); return; }
    if (w.isFullScreen()) { set(true); return; }
    const p = screen.getCursorScreenPoint(), b = w.getContentBounds();
    const x = p.x - b.x, y = p.y - b.y;
    // 进入 96×40 的角落就显示，离开 130×60 才收起，避免边缘闪烁
    if (x >= 0 && y >= -30 && x <= 96 && y <= 40) set(true);
    else if (!(x >= 0 && y >= -30 && x <= 130 && y <= 60)) set(false);
  }, 120);
  w.on('leave-full-screen', () => { shown = true; set(false); });
}

function send(action, arg) {
  const w = BrowserWindow.getFocusedWindow() || win;
  if (w) w.webContents.send('menu', action, arg);
}

// 快捷键：以页面里“快捷键设置”为准，页面启动和改动时发过来，菜单跟着重建
let KEYMAP = null;
const DEF_KEYS = {
  'tool:pen1': 'CmdOrCtrl+1', 'tool:pen2': 'CmdOrCtrl+2', 'tool:note': 'CmdOrCtrl+3', 'tool:hl': 'CmdOrCtrl+4', 'tool:laser': 'CmdOrCtrl+5', 'tool:hand': 'CmdOrCtrl+6', 'tool:eraser': 'CmdOrCtrl+7', 'tool:text': 'CmdOrCtrl+8',
  lastTool: 'CmdOrCtrl+0', newNote: 'CmdOrCtrl+N', sendWechat: 'CmdOrCtrl+P', exportPDF: 'Shift+CmdOrCtrl+P', insertMind: 'Shift+CmdOrCtrl+M', lockBlock: 'CmdOrCtrl+L',
  undo: 'CmdOrCtrl+Z', redo: 'Shift+CmdOrCtrl+Z', zoomIn: 'CmdOrCtrl+=', zoomOut: 'CmdOrCtrl+-', zoomFit: 'Alt+CmdOrCtrl+0', toggleZen: 'CmdOrCtrl+F', toggleCount: 'Shift+CmdOrCtrl+C', toggleSidebar: 'Alt+CmdOrCtrl+S',
  relaunch: 'CmdOrCtrl+R', reload: 'Shift+CmdOrCtrl+R',
};
const acc = (id) => { const v = KEYMAP && id in KEYMAP ? KEYMAP[id] : DEF_KEYS[id]; return v || undefined; };
ipcMain.on('keys:set', (e, map) => { KEYMAP = map || null; try { buildMenu(); } catch (err) { /* 忽略 */ } });

function buildMenu() {
  const toolNames = ['钢笔1', '钢笔2', '批注', '标记笔', '镭射', '导航', '橡皮擦', '文本'];
  const toolIds = ['pen1', 'pen2', 'note', 'hl', 'laser', 'hand', 'eraser', 'text'];
  const template = [
    { label: 'Note Pro', submenu: [{ role: 'about', label: '关于 Note Pro' }, { type: 'separator' }, { role: 'hide', label: '隐藏' }, { role: 'hideOthers', label: '隐藏其他' }, { type: 'separator' }, { role: 'quit', label: '退出 Note Pro' }] },
    { label: '文件', submenu: [
      { label: '新建笔记', accelerator: acc('newNote'), click: () => send('newNote') },
      { label: '分享到微信', accelerator: acc('sendWechat'), click: () => send('sendWechat') },
      { label: '导出（按上次的设置）…', accelerator: acc('exportPDF'), click: () => send('exportPDF') },
      { type: 'separator' },
      { label: '插入思维导图', accelerator: acc('insertMind'), click: () => send('insertMind') },
      { label: '导入字体…', click: () => send('importFonts') },
      { label: '打开笔记文件夹', click: () => shell.openPath(notesDir()) },
    ] },
    { label: '编辑', submenu: [
      { label: '撤销', accelerator: acc('undo'), click: () => send('undo') },
      { label: '重做', accelerator: acc('redo'), click: () => send('redo') },
      { label: '锁定文字块', accelerator: acc('lockBlock'), click: () => send('lockBlock') },
      { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '拷贝' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
    ] },
    { label: '工具', submenu: [
      ...toolIds.map((id, i) => ({ label: `${toolNames[i]}`, accelerator: acc('tool:' + id), click: () => send('tool', id) })),
      { type: 'separator' },
      { label: '选择最后一个工具', accelerator: acc('lastTool'), click: () => send('lastTool') },
    ] },
    { label: '显示', submenu: [
      { label: '放大', accelerator: acc('zoomIn'), click: () => send('zoomIn') },
      { label: '缩小', accelerator: acc('zoomOut'), click: () => send('zoomOut') },
      { label: '适合宽度', accelerator: acc('zoomFit'), click: () => send('zoomFit') },
      { type: 'separator' },
      { label: '字数统计', accelerator: acc('toggleCount'), click: () => send('toggleCount') },
      { label: '专注模式（收起工具栏）', accelerator: acc('toggleZen'), click: () => send('toggleZen') },
      { label: '笔记列表', accelerator: acc('toggleSidebar'), click: () => send('toggleSidebar') },
      { type: 'separator' },
      { label: '快捷键设置…', click: () => send('keys') },
      { label: '重启软件', accelerator: acc('relaunch'), click: () => send('relaunch') },
      { label: '刷新页面', accelerator: acc('reload'), click: (item, win) => { const w = win || BrowserWindow.getFocusedWindow(); if (w) w.webContents.reload(); } },
      { role: 'toggleDevTools', label: '开发者工具' },
      { role: 'togglefullscreen', label: '全屏' },
    ] },
    { role: 'windowMenu', label: '窗口' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* 笔记存取 */
// 笔记文件用标题命名（“笔记 2026年10月27日 18:57.json”），在访达里一眼能认出来；
// 改名后文件跟着改名，同名的加（2）（3）。文件里的 id 才是笔记的身份
const safeName = (t) => (String(t || '笔记').replace(/:/g, '：').replace(/[\\/*?"<>|\r\n\t]/g, '_').replace(/^\.+/, '').trim().slice(0, 80)) || '笔记';
let fileOf = new Map(); // id → 文件名
function scanNotes() {
  const out = [];
  fileOf = new Map();
  for (const f of fs.readdirSync(notesDir())) {
    if (!f.endsWith('.json')) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(notesDir(), f), 'utf8'));
      if (!d || !d.id) continue;
      const prev = fileOf.get(d.id);
      // 同一个 id 有两个文件（改名中途断电之类）：留修改时间新的
      if (prev) { const p = out.find((x) => x.id === d.id); if (p && p.modified >= (d.modified || 0)) continue; if (p) out.splice(out.indexOf(p), 1); }
      fileOf.set(d.id, f);
      out.push({ id: d.id, title: d.title, modified: d.modified, created: d.created });
    } catch (e) { /* 跳过损坏文件 */ }
  }
  return out;
}
function fileOfNote(id) {
  if (!fileOf.has(id)) scanNotes();
  const f = fileOf.get(id);
  if (f && fs.existsSync(path.join(notesDir(), f))) return path.join(notesDir(), f);
  scanNotes();
  return fileOf.has(id) ? path.join(notesDir(), fileOf.get(id)) : null;
}
ipcMain.handle('notes:list', () => scanNotes().sort((a, b) => b.modified - a.modified));
// 老笔记文件（按 id 命名的）启动时一次性改成按标题命名，内容和修改时间不变
function renameOldNoteFiles() {
  try {
    scanNotes();
    for (const [id, f] of [...fileOf.entries()]) {
      if (/^[\w-]+\.json$/.test(f) && f === String(id).replace(/[^\w-]/g, '') + '.json') {
        const d = JSON.parse(fs.readFileSync(path.join(notesDir(), f), 'utf8'));
        if (d && d.title) writeNote(d);
      }
    }
  } catch (e) { /* 忽略 */ }
}
ipcMain.handle('notes:load', (e, id) => {
  try { const f = fileOfNote(id); return f ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } catch (err) { return null; }
});
function writeNote(doc) {
  const dir = notesDir();
  const cur = fileOfNote(doc.id);
  const base = safeName(doc.title);
  let name = base + '.json', i = 2;
  while (fs.existsSync(path.join(dir, name)) && (!cur || path.join(dir, name).toLowerCase() !== cur.toLowerCase())) name = `${base}（${i++}）.json`;
  const f = path.join(dir, name);
  const tmp = path.join(dir, '.' + String(doc.id).replace(/[^\w-]/g, '') + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(doc));
  if (cur && cur !== f && cur.toLowerCase() === f.toLowerCase()) fs.unlinkSync(cur); // 只改了大小写
  fs.renameSync(tmp, f);
  if (cur && cur !== f && fs.existsSync(cur)) fs.unlinkSync(cur);
  fileOf.set(doc.id, name);
  return true;
}
ipcMain.handle('notes:save', (e, doc) => writeNote(doc));
// 重启软件：退出后自动重新打开（主进程代码改了也会生效）
ipcMain.on('app:relaunch', () => { app.relaunch(); app.exit(0); });
// 主进程代码是不是旧的：启动后 main.js／preload.js 被更新过，就该整个重启
const BOOT_MTIME = (() => { try { return ['main.js', 'preload.js'].map((f) => fs.statSync(path.join(__dirname, f)).mtimeMs).join(','); } catch (e) { return ''; } })();
ipcMain.handle('app:stale', () => {
  try { return ['main.js', 'preload.js'].map((f) => fs.statSync(path.join(__dirname, f)).mtimeMs).join(',') !== BOOT_MTIME; } catch (e) { return false; }
});
ipcMain.on('notes:saveSync', (e, doc) => { try { writeNote(doc); } catch (err) { /* 忽略 */ } e.returnValue = true; });
ipcMain.handle('notes:remove', async (e, id) => {
  const f = fileOfNote(id);
  if (f && fs.existsSync(f)) await shell.trashItem(f);
  fileOf.delete(id);
  return true;
});

/* 图片素材：存在 文稿/笔记软件/assets */
const assetDir = () => { const d = path.join(notesDir(), 'assets'); fs.mkdirSync(d, { recursive: true }); return d; };
const assetFile = (ref) => path.join(assetDir(), String(ref).replace(/[^\w-]/g, ''));
ipcMain.handle('asset:save', (e, ref, url) => {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url || '');
  if (!m) return false;
  fs.writeFileSync(assetFile(ref) + '.' + (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg'), Buffer.from(m[2], 'base64'));
  return true;
});
ipcMain.handle('asset:load', (e, ref) => {
  const base = assetFile(ref);
  for (const ext of ['png', 'jpg', 'gif', 'webp', 'bmp', 'tiff']) {
    const f = base + '.' + ext;
    if (fs.existsSync(f)) {
      const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
      return `data:${mime};base64,` + fs.readFileSync(f).toString('base64');
    }
  }
  return null;
});
// 剪贴板里没有纯文字、只有 RTF（WPS、Pages 等复制）时，转成纯文字
ipcMain.handle('clip:text', async () => {
  try {
    const t = clipboard.readText();
    if (t && t.trim()) return t;
    const rtf = clipboard.readRTF();
    if (!rtf) return '';
    if (process.platform !== 'darwin') return '';
    const { spawnSync } = require('child_process');
    const r = spawnSync('/usr/bin/textutil', ['-stdin', '-stdout', '-format', 'rtf', '-convert', 'txt'], { input: rtf, encoding: 'utf8', timeout: 5000 });
    return (r.stdout || '').replace(/\r\n?/g, '\n').replace(/\uFFFC/g, '');
  } catch (err) { return ''; }
});
ipcMain.on('clip:image', (e, url) => { try { clipboard.writeImage(nativeImage.createFromDataURL(url)); } catch (err) { /* 忽略 */ } });


/* ---------- 我的字体：导入后只在本软件里用，不装进系统 ----------
   存在 文稿/笔记软件/fonts，索引 fonts.json：[{id, name, file}] */
const fontDir = () => { const d = path.join(notesDir(), 'fonts'); fs.mkdirSync(d, { recursive: true }); return d; };
const fontIndexFile = () => path.join(fontDir(), 'fonts.json');
function readFontIndex() { try { return JSON.parse(fs.readFileSync(fontIndexFile(), 'utf8')); } catch (e) { return []; } }
function writeFontIndex(list) { fs.writeFileSync(fontIndexFile(), JSON.stringify(list, null, 1)); }

// 从字体文件的 name 表读出字体名（优先简体中文名）
function readFontName(buf) {
  try {
    let base = 0;
    if (buf.toString('latin1', 0, 4) === 'ttcf') base = buf.readUInt32BE(12);
    const tag0 = buf.toString('latin1', base, base + 4);
    if (tag0 === 'wOFF' || tag0 === 'wOF2') return null;
    const numTables = buf.readUInt16BE(base + 4);
    let nameOff = -1;
    for (let i = 0; i < numTables; i++) {
      const rec = base + 12 + i * 16;
      if (buf.toString('latin1', rec, rec + 4) === 'name') { nameOff = buf.readUInt32BE(rec + 8); break; }
    }
    if (nameOff < 0) return null;
    const count = buf.readUInt16BE(nameOff + 2), strOff = nameOff + buf.readUInt16BE(nameOff + 4);
    const names = [];
    for (let i = 0; i < count; i++) {
      const r = nameOff + 6 + i * 12;
      const pid = buf.readUInt16BE(r), lang = buf.readUInt16BE(r + 4), nid = buf.readUInt16BE(r + 6);
      const len = buf.readUInt16BE(r + 8), off = buf.readUInt16BE(r + 10);
      if (nid !== 1 && nid !== 2 && nid !== 4) continue;
      const raw = buf.slice(strOff + off, strOff + off + len);
      let str;
      if (pid === 3 || pid === 0) { const sw = Buffer.from(raw); sw.swap16(); str = sw.toString('utf16le'); }
      else str = raw.toString('latin1');
      names.push({ pid, lang, nid, str: str.replace(/\0/g, '').trim() });
    }
    const pick = (nid, langs) => {
      for (const l of langs) { const f = names.find((n) => n.nid === nid && n.pid === 3 && n.lang === l && n.str); if (f) return f.str; }
      return null;
    };
    const zh = [0x0804, 0x0404, 0x0c04, 0x1004, 0x1404];
    let fam = pick(1, zh) || pick(1, [0x0409]) || (names.find((n) => n.nid === 1 && n.str) || {}).str;
    const sub = pick(2, [0x0409]) || '';
    if (!fam) return null;
    if (sub && !/^(regular|normal|book|roman|常规)$/i.test(sub)) fam += ' ' + sub;
    return fam;
  } catch (e) { return null; }
}
function walkFonts(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    if (f === '__MACOSX' || f.startsWith('._')) continue;
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkFonts(p, out);
    else if (/\.(ttf|otf|ttc|woff2?)$/i.test(f)) out.push(p);
  }
  return out;
}
async function importFontPaths(paths) {
  const list = readFontIndex();
  const added = [];
  const tmpRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'bjfont-'));
  let files = [];
  for (const p of paths) {
    if (/\.zip$/i.test(p)) {
      const out = path.join(tmpRoot, String(files.length) + '-' + Date.now());
      fs.mkdirSync(out, { recursive: true });
      const ok = await new Promise((resolve) => execFile(process.platform === 'darwin' ? 'ditto' : 'unzip', process.platform === 'darwin' ? ['-x', '-k', p, out] : ['-q', p, '-d', out], (err) => resolve(!err)));
      if (ok) files = files.concat(walkFonts(out, []));
    } else if (/\.(ttf|otf|ttc|woff2?)$/i.test(p)) files.push(p);
  }
  for (const f of files) {
    const buf = fs.readFileSync(f);
    const ext = path.extname(f).toLowerCase();
    const name = readFontName(buf) || path.basename(f, ext);
    if (list.find((x) => x.name === name && x.size === buf.length)) continue; // 已经导入过
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    fs.writeFileSync(path.join(fontDir(), id + ext), buf);
    const item = { id, name, file: id + ext, size: buf.length };
    list.push(item);
    added.push(item);
  }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  writeFontIndex(list);
  return added;
}
ipcMain.handle('fonts:list', () => readFontIndex());
ipcMain.handle('fonts:data', (e, id) => {
  const f = readFontIndex().find((x) => x.id === id);
  if (!f) return null;
  try { return fs.readFileSync(path.join(fontDir(), f.file)); } catch (err) { return null; }
});
ipcMain.handle('fonts:import', async (e, paths) => {
  if (!paths || !paths.length) {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: '导入字体（字体文件或压缩包）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '字体或压缩包', extensions: ['ttf', 'otf', 'ttc', 'woff', 'woff2', 'zip'] }],
    });
    if (r.canceled) return [];
    paths = r.filePaths;
  }
  return importFontPaths(paths);
});
ipcMain.handle('fonts:remove', (e, id) => {
  const list = readFontIndex();
  const f = list.find((x) => x.id === id);
  if (f) { try { fs.unlinkSync(path.join(fontDir(), f.file)); } catch (err) { /* 忽略 */ } }
  writeFontIndex(list.filter((x) => x.id !== id));
  return true;
});
// 在访达里对字体文件或压缩包选“打开方式 → 笔记软件”
const pendingOpen = [];
app.on('open-file', (e, p) => {
  e.preventDefault();
  if (!/\.(ttf|otf|ttc|woff2?|zip)$/i.test(p)) return;
  if (!app.isReady() || !win) { pendingOpen.push(p); return; }
  importFontPaths([p]).then((added) => { if (win) win.webContents.send('fonts:changed', added); });
});

/* 导出 PDF：隐藏窗口里按页排好，再用 Chromium 打印成矢量 PDF */
// 记住上次导出的文件夹（第一次默认“下载”）
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
function readCfg() { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch (e) { return {}; } }
function writeCfg(c) { try { fs.writeFileSync(cfgFile(), JSON.stringify(c)); } catch (e) { /* 忽略 */ } }
function exportDir() {
  const d = readCfg().exportDir;
  return d && fs.existsSync(d) ? d : app.getPath('downloads');
}
// 导出：PDF / 图片（每页一张 PNG）/ 可编辑 Word；分享时文件放进剪贴板并交给微信
const EXT = { pdf: 'pdf', png: 'png', docx: 'docx' };
const FMT_NAME = { pdf: 'PDF', png: '图片 PNG', docx: 'Word 文档' };
function filesToClipboard(files) {
  if (process.platform !== 'darwin') return;
  const items = files.map((f) => `<string>${f.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`).join('');
  const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><array>${items}</array></plist>`;
  try { clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist)); } catch (err) { /* 忽略 */ }
}
async function renderInWindow(doc, assets, opts, offscreen) {
  const ew = new BrowserWindow({
    show: false, width: 900, height: 1200,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, offscreen: !!offscreen },
  });
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('排版超时')), 90000);
    ipcMain.once('export:ready', (ev, info) => { clearTimeout(t); resolve(info); });
  });
  await ew.loadFile(path.join(SRC, 'export.html'));
  ew.webContents.send('export:doc', doc, assets || {}, opts || {});
  const info = await ready;
  return { ew, info };
}
ipcMain.handle('export:pdf', async (e, doc, assets, mode, opts) => {
  opts = Object.assign({ format: 'pdf', ratio: 'a4', wm: { on: false } }, opts || {});
  const fmt = EXT[opts.format] ? opts.format : 'pdf';
  if (fmt === 'docx') opts.wm = { on: false };
  const parent = BrowserWindow.fromWebContents(e.sender);
  const safe = safeName(doc.title);
  let target;
  if (process.env.BJ_EXPORT_PATH) target = process.env.BJ_EXPORT_PATH.replace(/\.\w+$/, '.' + EXT[fmt]);
  else if (mode === 'wechat') target = path.join(exportDir(), safe + '.' + EXT[fmt]);
  else {
    const r = await dialog.showSaveDialog(parent, {
      title: '导出' + FMT_NAME[fmt],
      defaultPath: path.join(exportDir(), safe + '.' + EXT[fmt]),
      filters: [{ name: FMT_NAME[fmt], extensions: [EXT[fmt]] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    target = r.filePath;
    const c = readCfg(); c.exportDir = path.dirname(target); writeCfg(c);
  }
  let files = [];
  let ew = null;
  try {
    if (fmt === 'docx') {
      const { buildDocx } = require('./docx.js');
      fs.writeFileSync(target, buildDocx(doc, readFontIndex()));
      files = [target];
    } else if (fmt === 'pdf') {
      const r = await renderInWindow(doc, assets, opts, false);
      ew = r.ew;
      const pdf = await ew.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
      fs.writeFileSync(target, pdf);
      files = [target];
    } else {
      // 图片：2 倍清晰度，逐页截图
      const ZOOM = 2;
      const r = await renderInWindow(doc, assets, opts, true);
      ew = r.ew;
      const pw = Math.round(210 * 96 / 25.4 * ZOOM), ph = Math.round((opts.ratio === '34' ? 280 : 297) * 96 / 25.4 * ZOOM);
      ew.setContentSize(pw, ph);
      const base = target.replace(/\.png$/i, '');
      for (let i = 0; i < r.info.pages; i++) {
        await ew.webContents.executeJavaScript(`window.showPage(${i}, ${ZOOM})`);
        await new Promise((res) => setTimeout(res, 120));
        const img = await ew.webContents.capturePage({ x: 0, y: 0, width: pw, height: ph });
        const f = r.info.pages === 1 ? base + '.png' : `${base}-${i + 1}.png`;
        fs.writeFileSync(f, img.toPNG());
        files.push(f);
      }
    }
    if (mode === 'wechat') {
      filesToClipboard(files);
      const ok = await new Promise((resolve) => execFile('open', ['-a', 'WeChat', ...files], (err) => resolve(!err)));
      if (!ok) return { ok: false, msg: '没找到微信，文件已保存在：' + path.dirname(files[0]) };
    } else if (!process.env.BJ_EXPORT_PATH) shell.showItemInFolder(files[0]);
    return { ok: true, path: files[0], files };
  } catch (err) {
    return { ok: false, msg: '导出失败：' + err.message };
  } finally {
    if (ew) ew.destroy();
  }
});

app.whenReady().then(() => {
  renameOldNoteFiles();
  buildMenu();
  createWindow();
  if (pendingOpen.length) {
    win.webContents.once('did-finish-load', () => {
      importFontPaths(pendingOpen.splice(0)).then((added) => { if (win) win.webContents.send('fonts:changed', added); });
    });
  }
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

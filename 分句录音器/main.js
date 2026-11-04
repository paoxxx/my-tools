// 分句录音器 主进程：窗口、工程读写、导出M4A（用Mac自带的afconvert转码）
const { app, BrowserWindow, ipcMain, dialog, systemPreferences, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const PROJ = path.join(__dirname, '工程');
let win = null;

const safe = (n) => String(n || '未命名').replace(/[\/:\\]/g, '-').trim() || '未命名';
const projDir = (n) => path.join(PROJ, safe(n));

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
}

function buildMenu() {
  const send = (cmd) => () => win && win.webContents.send('menu', cmd);
  const tpl = [
    { label: '分句录音器', submenu: [{ role: 'about', label: '关于' }, { type: 'separator' }, { role: 'hide', label: '隐藏' }, { role: 'quit', label: '退出' }] },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', click: send('redo') },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    { label: '显示', submenu: [{ role: 'reload', label: '重新载入' }, { role: 'toggleDevTools', label: '开发者工具' }, { role: 'togglefullscreen', label: '全屏' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 620,
    backgroundColor: '#1c1c1e',
    title: '分句录音器',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  win.loadFile('index.html');
}

app.whenReady().then(async () => {
  fs.mkdirSync(PROJ, { recursive: true });
  if (process.platform === 'darwin') {
    try { await systemPreferences.askForMediaAccess('microphone'); } catch (e) {}
  }
  if (process.platform === 'darwin' && app.dock) { try { app.dock.setIcon(path.join(__dirname, 'icon.png')); } catch (e) {} }
  buildMenu();
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// 开发方便：页面代码一改，自动通知页面刷新；主程序改了提示重开
let codeTimer = null;
try {
  fs.watch(__dirname, (ev, f) => {
    if (!f || !win) return;
    if (['index.html', 'app.js', 'style.css'].includes(f)) { clearTimeout(codeTimer); codeTimer = setTimeout(() => win && win.webContents.send('code-updated'), 600); }
    else if (['main.js', 'preload.js'].includes(f)) win.webContents.send('need-restart');
  });
} catch (e) {}

// ---------- 工程 ----------
ipcMain.handle('proj-list', () => {
  return fs.readdirSync(PROJ, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      let mtime = 0;
      try { mtime = fs.statSync(path.join(PROJ, d.name, 'project.json')).mtimeMs; } catch (e) {}
      return { name: d.name, mtime };
    })
    .filter((x) => x.mtime)
    .sort((a, b) => b.mtime - a.mtime);
});

ipcMain.handle('proj-exists', (e, name) => fs.existsSync(path.join(projDir(name), 'project.json')));

ipcMain.handle('proj-save', (e, name, json, files) => {
  const dir = projDir(name);
  fs.mkdirSync(path.join(dir, 'takes'), { recursive: true });
  for (const f of files || []) fs.writeFileSync(path.join(dir, 'takes', f.name), Buffer.from(f.bytes));
  const tmp = path.join(dir, 'project.json.tmp');
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, path.join(dir, 'project.json'));
  return true;
});

ipcMain.handle('proj-load', (e, name) => {
  const dir = projDir(name);
  const json = fs.readFileSync(path.join(dir, 'project.json'), 'utf8');
  const o = JSON.parse(json);
  const need = new Set((o.clips || []).map((c) => c.take + '.wav'));
  const files = {};
  for (const fn of need) {
    const p = path.join(dir, 'takes', fn);
    if (fs.existsSync(p)) files[fn] = fs.readFileSync(p);
  }
  return { json, files };
});

ipcMain.handle('proj-rename', (e, oldName, newName) => {
  const a = projDir(oldName), b = projDir(newName);
  if (a === b) return { ok: true };
  if (fs.existsSync(b)) return { ok: false, error: '已经有同名工程了' };
  if (fs.existsSync(a)) fs.renameSync(a, b);
  return { ok: true };
});

ipcMain.handle('proj-reveal', (e, name) => {
  const dir = fs.existsSync(projDir(name)) ? projDir(name) : PROJ;
  shell.openPath(dir);
});

// ---------- 导出 ----------
ipcMain.handle('export-audio', async (e, { bytes, format, name }) => {
  const ext = format === 'wav' ? 'wav' : 'm4a';
  const cfgPath = path.join(app.getPath('userData'), 'settings.json');
  let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) {}
  const dir = cfg.exportDir && fs.existsSync(cfg.exportDir) ? cfg.exportDir : app.getPath('desktop');
  const r = await dialog.showSaveDialog(win, {
    title: '导出音频',
    defaultPath: path.join(dir, `${safe(name)}.${ext}`),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return { ok: false };
  const out = r.filePath;
  try { cfg.exportDir = path.dirname(out); fs.writeFileSync(cfgPath, JSON.stringify(cfg)); } catch (e) {}   // 记住这次保存的位置，下次默认
  if (ext === 'wav') {
    fs.writeFileSync(out, Buffer.from(bytes));
    shell.showItemInFolder(out);
    return { ok: true, path: out };
  }
  const tmp = path.join(os.tmpdir(), `fenju_${Date.now()}.wav`);
  fs.writeFileSync(tmp, Buffer.from(bytes));
  let error = null;
  try {
    await run('/usr/bin/afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '192000', tmp, out]);
  } catch (err1) {
    try { await run('/usr/bin/afconvert', ['-f', 'm4af', '-d', 'aac', tmp, out]); } catch (err2) { error = err2.message; }
  }
  try { fs.rmSync(tmp, { force: true }); } catch (e2) {}
  if (error) return { ok: false, error };
  shell.showItemInFolder(out);
  return { ok: true, path: out };
});

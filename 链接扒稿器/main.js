const { app, BrowserWindow, ipcMain, shell, clipboard, dialog, session, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

app.setName('链接扒稿器');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const ROOT = fs.realpathSync(__dirname);
const PY = path.join(ROOT, '.venv', 'bin', 'python');
const SCRIPT = path.join(ROOT, 'backend', 'extract.py');
const DEFAULT_OUT = path.join(os.homedir(), 'Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/22-博主逐字稿');
const SETTINGS = () => path.join(app.getPath('userData'), 'settings.json');
const HISTORY = () => path.join(app.getPath('userData'), 'history.json');
const PARTITION = 'persist:video-sites';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
const settings = () => Object.assign({ outDir: DEFAULT_OUT, bounds: null, engine: 'sensevoice', volcAppId: '', volcToken: '' }, readJSON(SETTINGS(), {}));
const saveSettings = (patch) => writeJSON(SETTINGS(), Object.assign(settings(), patch));

// 密钥用 macOS 钥匙串加密后再存，不以明文落盘
function encrypt(text) {
  if (!text) return '';
  try { return 'enc:' + safeStorage.encryptString(text).toString('base64'); } catch { return text; }
}
function decrypt(stored) {
  if (!stored) return '';
  if (!stored.startsWith('enc:')) return stored;
  try { return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64')); } catch { return ''; }
}

// ---------------- 公考热词库 ----------------
const wordbookPath = () => path.join(settings().outDir, '公考热词库.md');
const WORDBOOK = `> 链接扒稿器会读取这篇笔记。
> “热词”：一行一个或用顿号隔开，用豆包识别时会优先识别成这些词。
> “纠错”：一行一条，写成“错的 → 对的”，两种识别方式转完都会自动替换。
> 发现哪个词老是识别错，在这里加一行就行。

## 热词

- 结构化面试、无领导小组讨论、逐字稿、考官、考生、审题、破题、采分点
- 综合分析、人际关系、组织管理、计划组织、应急应变、情景模拟、现场模拟、即兴演讲
- 国考、省考、事业单位、选调生、三支一扶、公务员、申论、行测
- 基层治理、网格员、接诉即办、枫桥经验、12345热线、驻村第一书记、村两委、党建引领
- 乡村振兴、共同富裕、中国式现代化、新质生产力、高质量发展、全过程人民民主
- 以人民为中心、群众路线、为基层减负、形式主义、官僚主义、担当作为、真抓实干
- 放管服、营商环境、一网通办、跨省通办、高效办成一件事、数字政府
- 银发经济、一老一小、老旧小区改造、垃圾分类、便民服务、民生实事、急难愁盼
- 舆情、回应关切、十五五规划、人民锐评、长征精神、红船精神、工匠精神

## 纠错

- 竹子稿 → 逐字稿
- 中端 → 终端
- Cloud Code → Claude Code
`;
function ensureWordbook() {
  try {
    const p = wordbookPath();
    if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, WORDBOOK); }
    return p;
  } catch { return ''; }
}

let win;
function createWindow() {
  const s = settings();
  win = new BrowserWindow({
    width: 460, height: 640, minWidth: 380, minHeight: 420,
    ...(s.bounds || {}),
    titleBarStyle: 'hiddenInset',
    acceptFirstMouse: true,
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    webPreferences: { preload: path.join(ROOT, 'preload.js') },
  });
  win.loadFile(path.join(ROOT, 'index.html'));
  const remember = () => saveSettings({ bounds: win.getBounds() });
  win.on('resize', remember);
  win.on('move', remember);
  ensureWordbook();
  // 用命令写进来的明文密钥，启动时改成钥匙串加密保存
  const cur = settings();
  if (cur.volcToken && !cur.volcToken.startsWith('enc:')) saveSettings({ volcToken: encrypt(cur.volcToken) });
}

// ---------------- 后台隐藏窗口打开网页，拿新鲜 Cookie、视频数据和地址 ----------------
async function writeCookieFile(ses, file) {
  const all = await ses.cookies.get({});
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of all) {
    const domain = c.hostOnly ? c.domain : (c.domain.startsWith('.') ? c.domain : '.' + c.domain);
    lines.push([domain, domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE',
      Math.floor(c.expirationDate || (Date.now() / 1000 + 86400 * 30)), c.name, c.value].join('\t'));
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

const SITES = {
  douyin: {
    urls: ['*://*.douyinvod.com/*', '*://*.zjcdn.com/*', '*://*.douyincdn.com/*', '*://*/aweme/v1/play/*'],
    keep: (u) => !/\.(m3u8|jpe?g|png|webp|image)$/i.test(u.split('?')[0]),
    probe: `(() => {
      const el = document.getElementById('RENDER_DATA');
      let render = '';
      try { render = el ? decodeURIComponent(el.textContent) : ''; } catch (e) {}
      const srcs = [...document.querySelectorAll('video source, video')].map(e => e.src || e.getAttribute('src')).filter(s => s && s.startsWith('http'));
      const a = document.querySelector('[data-e2e="video-author-title"], [data-e2e="user-info"] a span, [data-e2e="user-info"] span');
      const t = document.querySelector('[data-e2e="video-desc"], h1');
      return { render, srcs, title: (t && t.innerText) || document.title.replace(/\\s*-\\s*抖音.*$/, ''), author: a ? a.innerText.replace(/^@/, '') : '' };
    })()`,
    ready: (last, media, detail) => detail || (last && last.render && /awemeDetail/.test(last.render)),
  },
  xhs: {
    urls: ['*://*.xhscdn.com/*', '*://*.xiaohongshu.com/*'],
    keep: (u) => /sns-video|\/stream\/|\.mp4/i.test(u.split('?')[0]),
    probe: `(() => {
      const seen = new WeakSet(); let n = 0, state = '';
      try {
        state = JSON.stringify(window.__INITIAL_STATE__ || null, (k, v) => {
          if (typeof v === 'function') return undefined;
          if (v && typeof v === 'object') { if (seen.has(v)) return undefined; seen.add(v); }
          return ++n > 300000 ? undefined : v;
        }) || '';
      } catch (e) {}
      const srcs = [...document.querySelectorAll('video source, video')].map(e => e.src || e.getAttribute('src')).filter(s => s && s.startsWith('http'));
      return { state, srcs, title: document.title.replace(/\\s*-\\s*小红书.*$/, '') };
    })()`,
    ready: (last, media) => (last && last.state && /masterUrl/.test(last.state)) || media.length > 0,
  },
};

// 网页风控脚本会试探打开“bitbrowser://”之类的外部 App 链接，系统会因此弹窗；后台和登录窗口一律拒绝
let guarded = false;
function guardSession(ses) {
  if (guarded) return;
  guarded = true;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
}
app.on('web-contents-created', (_e, wc) => {
  if (wc.session !== session.fromPartition(PARTITION)) return;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const block = (e, url) => { if (!/^https?:/i.test(url)) e.preventDefault(); };
  wc.on('will-navigate', block);
  wc.on('will-frame-navigate', (e) => { if (!/^https?:|^about:|^blob:|^data:/i.test(e.url)) e.preventDefault(); });
  wc.on('will-redirect', block);
});

async function xhsLoggedIn(ses) {
  try { return (await ses.cookies.get({ name: 'web_session' })).some((c) => /xiaohongshu/.test(c.domain)); } catch { return false; }
}

function harvest(url, kind, timeoutMs = 18000) {
  const site = SITES[kind];
  return new Promise(async (resolve) => {
    const ses = session.fromPartition(PARTITION);
    guardSession(ses);
    const ua = kind === 'xhs' && !(await xhsLoggedIn(ses)) ? IPHONE_UA : CHROME_UA;
    const w = new BrowserWindow({ show: false, width: kind === 'xhs' && ua === IPHONE_UA ? 420 : 1280, height: 860, webPreferences: { session: ses, backgroundThrottling: false } });
    w.webContents.setAudioMuted(true);
    const media = [];
    ses.webRequest.onBeforeRequest({ urls: site.urls }, (d, cb) => {
      const base = d.url.split('?')[0];
      if (site.keep(d.url) && !media.some((u) => u.split('?')[0] === base)) media.push(d.url);
      cb({});
    });
    const isAudio = (u) => /media-audio|mime_type=audio|audio_mp4|\.m4a/i.test(u);
    let done = false, last = null, detail = '', audioSeen = 0, readySeen = 0;

    // 抖音：读取网页自己加载的视频详情（标题、博主、发布时间、点赞等）
    const dbg = w.webContents.debugger;
    const wanted = new Set();
    if (kind === 'douyin') {
      try {
        dbg.attach('1.3');
        dbg.sendCommand('Network.enable', { maxResourceBufferSize: 10_000_000, maxTotalBufferSize: 50_000_000 }).catch(() => {});
        dbg.on('message', async (_e, method, params) => {
          if (method === 'Network.responseReceived' && /aweme\/v1\/web\/aweme\/detail|aweme\/detail/.test(params.response.url)) wanted.add(params.requestId);
          if (method === 'Network.loadingFinished' && wanted.has(params.requestId) && !detail) {
            try {
              const r = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId });
              const body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
              if (/aweme_detail/.test(body)) detail = body;
            } catch {}
          }
        });
      } catch {}
    }

    const finish = async () => {
      if (done) return; done = true;
      clearInterval(timer);
      ses.webRequest.onBeforeRequest(null);
      const dir = app.getPath('userData');
      const cookieFile = path.join(dir, 'cookies.txt');
      const pageFile = path.join(dir, 'page.json');
      try { if (!last) last = await w.webContents.executeJavaScript(site.probe); } catch {}
      try { await writeCookieFile(ses, cookieFile); } catch {}
      let finalUrl = '';
      try { finalUrl = w.webContents.getURL(); } catch {}
      try { fs.writeFileSync(pageFile, JSON.stringify({ media, detail, finalUrl, ...(last || {}) })); } catch {}
      try { if (dbg.isAttached()) dbg.detach(); } catch {}
      if (!w.isDestroyed()) w.destroy();
      resolve({ cookieFile, pageFile });
    };
    const timer = setInterval(async () => {
      if (w.isDestroyed()) return;
      try { last = await w.webContents.executeJavaScript(site.probe); } catch {}
      try { if (/\/login/.test(w.webContents.getURL())) return finish(); } catch {}
      if (site.ready(last, media, detail)) { readySeen = readySeen || Date.now(); if (Date.now() - readySeen > 1200) finish(); }
      // 抖音声音轨已抓到但详情还没来：最多再等 5 秒
      if (kind === 'douyin' && media.some(isAudio)) { audioSeen = audioSeen || Date.now(); if (Date.now() - audioSeen > 5000) finish(); }
    }, 1000);
    setTimeout(finish, timeoutMs);
    w.webContents.setUserAgent(ua);
    w.loadURL(url).catch(() => {});
  });
}

// 登录小红书或抖音：打开一个看得见的窗口，扫码后关掉即可，登录状态会保留
function openLogin(kind) {
  const ses = session.fromPartition(PARTITION);
  guardSession(ses);
  const w = new BrowserWindow({ width: 1100, height: 800, title: kind === 'xhs' ? '登录小红书（登录后关掉这个窗口）' : '登录抖音（登录后关掉这个窗口）', webPreferences: { session: ses } });
  w.webContents.setUserAgent(CHROME_UA);
  w.loadURL(kind === 'xhs' ? 'https://www.xiaohongshu.com/explore' : 'https://www.douyin.com/');
}

// ---------------- 排队处理，一次只转写一个，避免抢内存 ----------------
const queue = [];
let running = false;

async function runNext() {
  if (running || !queue.length) return;
  running = true;
  const job = queue.shift();
  const send = (msg) => win && !win.isDestroyed() && win.webContents.send('progress', { id: job.id, ...msg });
  const s = settings();
  const args = [SCRIPT, '--out', s.outDir, '--engine', s.engine === 'doubao' ? 'doubao' : 'sensevoice'];
  const wb = ensureWordbook();
  if (wb) args.push('--wordbook', wb);
  if (job.file) args.push('--file', job.file); else args.push('--input', job.input);

  if (!fs.existsSync(PY)) {
    send({ type: 'error', text: '没找到 Python 环境，请重新运行一次安装命令' });
    running = false; return runNext();
  }

  const link = !job.file && (job.input.match(/https?:\/\/\S+/) || [])[0];
  const kind = link && (/douyin\.com/.test(link) ? 'douyin' : /xiaohongshu\.com|xhslink\.(com|cn)/.test(link) ? 'xhs' : '');
  if (kind) {
    send({ type: 'step', text: `正在打开${kind === 'douyin' ? '抖音' : '小红书'}网页获取视频……` });
    const h = await harvest(link, kind);
    args.push('--cookies', h.cookieFile, '--page', h.pageFile);
  } else {
    send({ type: 'step', text: job.file ? '读取本地文件……' : '解析链接……' });
  }

  const env = {
    ...process.env,
    PATH: `${path.dirname(PY)}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
    PYTHONUNBUFFERED: '1',
    VOLC_APP_ID: s.volcAppId || '',
    VOLC_TOKEN: decrypt(s.volcToken),
  };
  const child = spawn(PY, args, { env, cwd: ROOT });
  let buf = '', errTail = '', finished = false;
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'done') {
          finished = true;
          const h = readJSON(HISTORY(), []);
          h.unshift({ title: msg.title, author: msg.author, platform: msg.platform, path: msg.path, chars: msg.chars, engine: msg.engine, time: Date.now() });
          writeJSON(HISTORY(), h.slice(0, 200));
        }
        if (msg.type === 'error') finished = true;
        send(msg);
      } catch { /* 非 JSON 输出忽略 */ }
    }
  });
  child.stderr.on('data', (d) => { errTail = (errTail + d.toString()).slice(-600); });
  child.on('close', () => {
    if (!finished) send({ type: 'error', text: '处理中断：' + (errTail.split('\n').filter(Boolean).pop() || '未知原因') });
    running = false; runNext();
  });
}

ipcMain.handle('enqueue', (_e, jobs) => { queue.push(...jobs); runNext(); });
ipcMain.handle('history', () => readJSON(HISTORY(), []));
ipcMain.handle('get-settings', () => {
  const s = settings();
  return { outDir: s.outDir, engine: s.engine, volcAppId: s.volcAppId, hasToken: !!decrypt(s.volcToken) };
});
ipcMain.handle('save-engine', (_e, { engine, appId, token }) => {
  const patch = { engine: engine === 'doubao' ? 'doubao' : 'sensevoice', volcAppId: (appId || '').trim() };
  if (token && token.trim()) patch.volcToken = encrypt(token.trim());
  saveSettings(patch);
  return true;
});
ipcMain.handle('open-wordbook', () => {
  const p = ensureWordbook();
  if (p) shell.openExternal('obsidian://open?path=' + encodeURIComponent(p));
});
ipcMain.handle('login', (_e, kind) => openLogin(kind));
ipcMain.handle('test-doubao', () => new Promise((resolve) => {
  const s = settings();
  const env = { ...process.env, PATH: `${path.dirname(PY)}:${process.env.PATH || ''}`, VOLC_APP_ID: s.volcAppId || '', VOLC_TOKEN: decrypt(s.volcToken) };
  const child = spawn(PY, [SCRIPT, '--test-doubao'], { env, cwd: ROOT });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.on('close', () => {
    const line = out.trim().split('\n').pop() || '';
    try { const m = JSON.parse(line); resolve({ ok: m.type === 'done', text: m.text }); } catch { resolve({ ok: false, text: '测试没有返回结果' }); }
  });
}));
ipcMain.handle('read-clipboard', () => clipboard.readText());
ipcMain.handle('copy', (_e, text) => clipboard.writeText(text));
ipcMain.handle('read-note', (_e, p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } });
ipcMain.handle('open-note', (_e, p) => {
  if (!fs.existsSync(p)) return false;
  shell.openExternal('obsidian://open?path=' + encodeURIComponent(p));
  return true;
});
ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(fs.existsSync(p) ? p : settings().outDir));
ipcMain.handle('choose-dir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings().outDir });
  if (r.canceled || !r.filePaths[0]) return settings().outDir;
  saveSettings({ outDir: r.filePaths[0] });
  ensureWordbook();
  return r.filePaths[0];
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

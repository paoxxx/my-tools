(() => {
  const $ = (s) => document.querySelector(s);
  const api = window.api;
  const SV = (inner, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${inner}</svg>`;
  const ICON = {
    sidebar: SV('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M9.5 5v14"/>'),
    share: SV('<path d="M12 15V4M8.5 7.5L12 4l3.5 3.5"/><path d="M7 10H6a2 2 0 00-2 2v6a2 2 0 002 2h12a2 2 0 002-2v-6a2 2 0 00-2-2h-1"/>'),
    export: SV('<path d="M12 4v11M8.5 11.5L12 15l3.5-3.5"/><path d="M4 16v2.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V16"/>'),
    copy: SV('<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 8.5V6.7a2.2 2.2 0 00-2.2-2.2H6.7a2.2 2.2 0 00-2.2 2.2v6.6a2.2 2.2 0 002.2 2.2h1.8"/>'),
    quote: SV('<path class="bub" d="M5 4.5h14a1.8 1.8 0 011.8 1.8v9.4a1.8 1.8 0 01-1.8 1.8h-6.2L8.5 21v-3.5H5a1.8 1.8 0 01-1.8-1.8V6.3A1.8 1.8 0 015 4.5z"/><path class="qm" d="M8.4 9.4h2.1v2.2L9.4 13M13.4 9.4h2.1v2.2L14.4 13"/>'),
    gear: SV('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" transform="translate(1.2 1.2) scale(.9)"/>'),
    trash: SV('<path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l.8 12a1.5 1.5 0 001.5 1.4h6.4a1.5 1.5 0 001.5-1.4l.8-12M10 11v6M14 11v6"/>'),
    back15: SV('<path d="M5.2 12a7 7 0 107-7H8.6M8.6 5L11.4 2.4M8.6 5l2.8 2.6"/><text x="12.2" y="15.4" font-size="7.4" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">15</text>'),
    fwd15: SV('<g transform="translate(24 0) scale(-1 1)"><path d="M5.2 12a7 7 0 107-7H8.6M8.6 5L11.4 2.4M8.6 5l2.8 2.6"/></g><text x="11.8" y="15.4" font-size="7.4" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">15</text>'),
    play: SV('<path d="M7 4.2v15.6l13.2-7.8z" fill="currentColor" stroke="none"/>'),
    pause: SV('<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>'),
    close: SV('<path d="M6 6l12 12M18 6L6 18"/>'),
    reset: SV('<path d="M4.5 12a7.5 7.5 0 107.5-7.5H8.5M8.5 4.5L11 2M8.5 4.5L11 7"/>'),
    folder: SV('<path d="M3.5 7a1.5 1.5 0 011.5-1.5h4l2 2.2h7.5A1.5 1.5 0 0120 9.2v8.3a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z"/>'),
    mic: SV('<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3"/>'),
    speaker: SV('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>'),
    check: SV('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  };
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ICON[el.dataset.icon]; });
  const style = document.createElement('style');
  style.textContent = '.ib.on svg .bub{fill:currentColor}.ib.on svg .qm{stroke:#fff}';
  document.head.appendChild(style);

  // ---------- 状态 ----------
  const PPS = 100; // 波形数据：每秒 100 个点
  const audio = new Audio();
  audio.preload = 'auto';
  const S = {
    settings: {}, recs: [], win: 6.4, cur: null, tokens: [], paras: [], peaks: [], norm: 0.3,
    mode: 'wave', rec: null, trans: {}, tEls: [], sEls: [], sentOf: [], hl: -1, userScroll: 0, drag: null, lastT: -1,
  };
  const dur = () => (S.cur ? S.cur.duration || 0 : 0);

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const pad2 = (n) => String(n).padStart(2, '0');
  const clock = (t) => `${pad2(Math.floor(t / 60))}:${pad2(Math.floor(t % 60))}.${pad2(Math.floor((t % 1) * 100))}`;
  const short = (t) => `${Math.floor(t / 60)}:${pad2(Math.floor(t % 60))}`;
  function toast(msg, icon) {
    const t = $('#toast');
    t.innerHTML = (icon ? ICON[icon] : '') + (msg ? `<span>${esc(msg)}</span>` : '');
    t.hidden = false;
    clearTimeout(toast.h);
    toast.h = setTimeout(() => { t.hidden = true; }, 1600);
  }

  // ---------- 画布 ----------
  const Z = { dpr: 1, zw: 0, zh: 0, tw: 0, th: 0, ow: 0, oh: 0 };
  function measure() {
    Z.dpr = window.devicePixelRatio || 1;
    [['z', '#zoom'], ['t', '#ticks'], ['o', '#over']].forEach(([k, sel]) => {
      const c = $(sel), r = c.getBoundingClientRect();
      if (!r.width || !r.height) { Z[k + 'w'] = 0; Z[k + 'h'] = 0; return; }
      const w = Math.max(1, Math.round(r.width * Z.dpr)), h = Math.max(1, Math.round(r.height * Z.dpr));
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      Z[k + 'w'] = r.width ? w : 0; Z[k + 'h'] = r.height ? h : 0;
    });
    S.lastT = -1;
  }
  const amp = (p) => Math.min(1, p / S.norm) ** 0.75;
  function drawZoom(t) {
    const W = Z.zw, H = Z.zh, d = Z.dpr;
    if (W < 2 || H < 2) return;
    const ctx = $('#zoom').getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const rec = S.rec, P = rec ? rec.peaks : S.peaks;
    const n = P.length + (rec ? 1 : 0);
    const get = (i) => (i < P.length ? P[i] : rec.mx);
    const pxs = W / S.win, cx = W / 2, mid = H / 2, pxBin = pxs / PPS;
    const group = Math.max(1, Math.round((6 * d) / pxBin));
    ctx.lineWidth = 2 * d; ctx.lineCap = 'round';
    if (!n) {
      ctx.strokeStyle = '#a1a1a6';
      for (let x = 0; x < W; x += 6 * d) { ctx.beginPath(); ctx.moveTo(x, mid - d); ctx.lineTo(x, mid + d); ctx.stroke(); }
      return;
    }
    const g0 = Math.max(0, Math.floor(((t - S.win / 2) * PPS) / group) * group - group);
    const g1 = Math.min(n - 1, Math.ceil((t + S.win / 2) * PPS) + group);
    for (let g = g0; g <= g1; g += group) {
      let m = 0;
      const e = Math.min(n, g + group);
      for (let i = g; i < e; i++) { const v = get(i); if (v > m) m = v; }
      const x = cx + ((g + group / 2) / PPS - t) * pxs;
      const h = Math.max(2 * d, amp(m) * H * 0.86);
      ctx.strokeStyle = h <= 3 * d ? '#a1a1a6' : '#1c1c1e';
      ctx.beginPath(); ctx.moveTo(x, mid - h / 2); ctx.lineTo(x, mid + h / 2); ctx.stroke();
    }
  }
  const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  function tickLabel(s, step) {
    const m = Math.floor(s / 60), sec = s - m * 60, dec = step < 0.2 ? 2 : step < 1 ? 1 : 0;
    return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(dec)}`;
  }
  function drawTicks(t) {
    const W = Z.tw, H = Z.th, d = Z.dpr;
    if (W < 2 || H < 2) return;
    const ctx = $('#ticks').getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const pxs = W / S.win, cx = W / 2;
    const step = STEPS.find((s) => s * pxs >= 78 * d) || 120, sub = step / 5;
    ctx.font = `${13 * d}px -apple-system, "PingFang SC", sans-serif`;
    ctx.textAlign = 'center'; ctx.fillStyle = '#aeaeb2'; ctx.strokeStyle = '#d1d1d6'; ctx.lineWidth = d;
    const k0 = Math.max(0, Math.floor((t - S.win / 2) / sub)), k1 = Math.ceil((t + S.win / 2) / sub);
    for (let k = k0; k <= k1; k++) {
      const s = k * sub, x = cx + (s - t) * pxs, whole = k % 5 === 0;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, (whole ? 8 : 5) * d); ctx.stroke();
      if (whole) ctx.fillText(tickLabel(s, step), x, 24 * d);
    }
  }
  function drawOver() {
    const W = Z.ow, H = Z.oh, d = Z.dpr;
    if (W < 2 || H < 2) return;
    const ctx = $('#over').getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const peaks = S.peaks, step = 5 * d, n = Math.floor(W / step);
    ctx.lineWidth = 2 * d; ctx.lineCap = 'round';
    for (let b = 0; b < n; b++) {
      let m = 0;
      if (peaks.length) {
        const a = Math.floor((b / n) * peaks.length), z = Math.max(a + 1, Math.floor(((b + 1) / n) * peaks.length));
        for (let i = a; i < z && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      }
      const h = Math.max(2 * d, amp(m) * H * 0.8), x = b * step + step / 2;
      ctx.strokeStyle = h <= 3 * d ? '#b0b0b5' : '#1c1c1e';
      ctx.beginPath(); ctx.moveTo(x, H / 2 - h / 2); ctx.lineTo(x, H / 2 + h / 2); ctx.stroke();
    }
  }

  // ---------- 波形数据 ----------
  async function loadPeaks(id) {
    S.peaks = []; S.norm = 0.3;
    try {
      const bytes = await api.audioBytes(id);
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const buf = await ac.decodeAudioData(ab);
      ac.close();
      const ch = buf.getChannelData(0), win = Math.floor(buf.sampleRate / PPS), n = Math.ceil(ch.length / win), out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let m = 0; const e = Math.min(ch.length, (i + 1) * win);
        for (let k = i * win; k < e; k += 2) { const v = Math.abs(ch[k]); if (v > m) m = v; }
        out[i] = m;
      }
      const sorted = Array.from(out).sort((a, b) => a - b);
      S.norm = Math.max(0.02, sorted[Math.floor(sorted.length * 0.97)] || 0.3);
      if (S.cur && S.cur.id === id) S.peaks = out;
    } catch (e) {
      if (S.cur && S.cur.id === id) S.peaks = new Float32Array(Math.ceil((dur() || 1) * PPS)).fill(0.001);
    }
    drawOver(); S.lastT = -1;
  }

  // ---------- 列表 ----------
  function renderList() {
    const box = $('#list');
    box.innerHTML = '';
    const today = new Date().toDateString();
    S.recs.forEach((r) => {
      const d = new Date(r.createdAt);
      const when = d.toDateString() === today ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : `${d.getMonth() + 1}月${d.getDate()}日`;
      const el = document.createElement('div');
      el.className = 'item' + (S.cur && S.cur.id === r.id ? ' sel' : '');
      const busy = S.trans[r.id] != null && S.trans[r.id] !== 'err';
      const mark = busy ? '<i class="spin"></i>' : r.status === 'error' ? '!' : '';
      el.innerHTML = `<div class="n">${esc(r.id)}</div><div class="s"><span>${short(r.duration || 0)}</span><span class="st">${mark}</span></div>`;
      el.onclick = async () => { await selectRec(r.id); if (window.innerWidth < 760) $('#app').classList.add('collapsed'); };
      box.appendChild(el);
    });
  }
  async function refreshList() { S.recs = await api.list(); renderList(); }

  // ---------- 选择录音 ----------
  async function selectRec(id) {
    if (S.rec) return;
    audio.pause();
    const m = await api.get(id);
    S.cur = m;
    const { url } = await api.audioUrl(id);
    audio.src = url;
    S.tokens = Seg.buildTokens(m.utterances || []);
    S.paras = Seg.layout(S.tokens);
    S.hl = -1; S.lastT = -1;
    renderText();
    setMode(m.status === 'done' ? 'text' : 'wave');
    updateUI(); renderList();
    loadPeaks(id);
  }

  // ---------- 文字视图 ----------
  function renderText() {
    const tv = $('#textView');
    S.tEls = []; S.sEls = []; S.sentOf = [];
    if (!S.cur) { tv.innerHTML = ''; return; }
    if (!S.cur.utterances) {
      const pct = S.trans[S.cur.id];
      if (S.cur.status === 'error' && pct == null) {
        tv.innerHTML = `<div class="status err"><div>${esc(S.cur.error || '识别失败')}</div><button class="ib" id="bRetry">${ICON.reset}</button></div>`;
        $('#bRetry').onclick = () => transcribe(S.cur.id);
      } else {
        tv.innerHTML = `<div class="status"><div class="big" id="pctNum">${pct || 0}%</div><div class="pbar"><i id="pctBar" style="width:${pct || 0}%"></i></div></div>`;
      }
      return;
    }
    if (!S.tokens.length) { tv.innerHTML = '<div class="status">无内容</div>'; return; }
    let html = '', sIdx = 0;
    S.paras.forEach((para, pi) => {
      html += `<p class="para"><button class="pcopy" data-p="${pi}">${ICON.copy}</button>`;
      para.forEach((sent) => {
        html += `<span class="sent" data-s="${sIdx}">`;
        sent.forEach((i) => {
          const tk = S.tokens[i];
          html += `<span class="w" data-i="${i}">${esc(Seg.tokenText(tk))}</span>`;
          S.sentOf[i] = sIdx;
        });
        html += '</span>'; sIdx++;
      });
      html += '</p>';
    });
    tv.innerHTML = html;
    tv.querySelectorAll('.w').forEach((el) => { S.tEls[+el.dataset.i] = el; });
    tv.querySelectorAll('.sent').forEach((el) => { S.sEls[+el.dataset.s] = el; });
    tv.scrollTop = 0;
  }
  function renderLive() {
    const tv = $('#textView'), t = S.live ? S.live.text : '';
    tv.innerHTML = t ? '<p class="para live">' + esc(t) + '</p>' : '<div class="status"><div>正在听……</div></div>';
    tv.scrollTop = tv.scrollHeight;
  }
  function setProgress(id, pct) {
    S.trans[id] = pct;
    if (S.cur && S.cur.id === id && !S.cur.utterances) {
      const n = $('#pctNum'), b = $('#pctBar');
      if (n) n.textContent = pct + '%';
      if (b) b.style.width = pct + '%';
    }
    renderList();
  }

  function setMode(m) {
    S.mode = m;
    $('#waveView').hidden = m === 'text';
    $('#textView').hidden = m !== 'text';
    $('#bQuote').classList.toggle('on', m === 'text');
    if (m === 'wave') requestAnimationFrame(() => { measure(); drawOver(); });
    else measure();
  }
  function updateUI() {
    const hasText = !!(S.cur && S.cur.utterances && S.tokens.length);
    const app = $('#app');
    app.classList.toggle('nodata', !S.cur && !S.rec);
    $('#title').textContent = S.rec ? S.rec.id : S.cur ? S.cur.id : '录音机';
    ['#bShare', '#bExport', '#bCopy'].forEach((s) => $(s).classList.toggle('dis', !hasText || !!S.rec));
    $('#bTrash').classList.toggle('dis', !S.cur || !!S.rec);
    $('#tEnd').textContent = short(dur());
  }

  // ---------- 回放 ----------
  const sync = { at: -1, perf: 0, est: 0 };
  function playTime() {
    const at = audio.currentTime || 0, now = performance.now();
    if (at !== sync.at) { sync.at = at; sync.perf = now; sync.est = at; }
    if (audio.paused) { sync.est = at; return at; }
    let est = at + Math.min(0.12, (now - sync.perf) / 1000) * (audio.playbackRate || 1);
    if (est < sync.est && sync.est - est < 0.08) est = sync.est;
    sync.est = est;
    return est;
  }
  function seek(t, play) {
    t = Math.max(0, Math.min(dur() || t, t));
    audio.currentTime = t;
    sync.at = -1;
    if (play && audio.paused) audio.play().catch(() => {});
    S.lastT = -1;
  }
  function recTime() {
    const r = S.rec;
    if (!isFinite(r.lag)) return 0;
    const el = (performance.now() - r.t0) / 1000;
    return Math.max(0, Math.min(el - r.lag - 0.07, r.samples / r.sr));
  }
  const curTime = () => (S.rec ? recTime() : S.drag ? S.drag.t : playTime());
  function tokenAt(ms) {
    const tk = S.tokens; if (!tk.length || ms < tk[0].s - 400) return -1;
    let lo = 0, hi = tk.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tk[mid].s <= ms) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function highlight(t) {
    if (S.mode !== 'text' || !S.tEls.length) return;
    const i = tokenAt(t * 1000);
    if (i === S.hl) return;
    const old = S.hl;
    if (old >= 0 && S.tEls[old]) {
      S.tEls[old].classList.remove('cur');
      if (i < 0 || S.sentOf[i] !== S.sentOf[old]) S.sEls[S.sentOf[old]].classList.remove('cur');
    }
    S.hl = i;
    if (i < 0 || !S.tEls[i]) return;
    S.tEls[i].classList.add('cur');
    S.sEls[S.sentOf[i]].classList.add('cur');
    if (!audio.paused && Date.now() - S.userScroll > 3000) {
      const tv = $('#textView'), r = S.tEls[i].getBoundingClientRect(), tr = tv.getBoundingClientRect();
      if (r.top < tr.top + 50 || r.bottom > tr.bottom - 90) tv.scrollBy({ top: r.top - tr.top - tv.clientHeight * 0.35, behavior: 'smooth' });
    }
  }
  let lastClock = '';
  function frame() {
    if (S.rec && ++S.normTick % 12 === 0) updateRecNorm();
    const t = curTime();
    if (t !== S.lastT) {
      S.lastT = t;
      if (S.mode === 'wave') { drawZoom(t); drawTicks(t); }
      const c = clock(t);
      if (c !== lastClock) { lastClock = c; $('#bigTime').textContent = c; }
      if (!S.rec) {
        const d = dur();
        $('#overHead').style.transform = `translateX(${(d ? Math.min(1, t / d) : 0) * (Z.ow / Z.dpr)}px)`;
        highlight(t);
      }
    }
    requestAnimationFrame(frame);
  }
  const setPlayIcon = () => { $('#bPlay').innerHTML = ICON[audio.paused ? 'play' : 'pause']; };
  audio.addEventListener('play', setPlayIcon);
  audio.addEventListener('pause', setPlayIcon);
  audio.addEventListener('ended', setPlayIcon);
  function togglePlay() {
    if (S.rec || !S.cur) return;
    if (audio.paused) { if (audio.currentTime >= dur() - 0.05) audio.currentTime = 0; audio.play().catch(() => {}); } else audio.pause();
  }
  async function applySink() {
    if (!audio.setSinkId) return;
    try { await audio.setSinkId(S.settings.outputId || ''); } catch (e) { try { await audio.setSinkId(''); } catch (e2) { /* 忽略 */ } }
  }

  // ---------- 录音 ----------
  const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`; };
  async function openMic(id) {
    const base = { channelCount: 1, echoCancellation: false, noiseSuppression: S.settings.denoise !== false, autoGainControl: !!S.settings.agc };
    if (id) { try { return await navigator.mediaDevices.getUserMedia({ audio: Object.assign({ deviceId: { exact: id } }, base) }); } catch (e) { /* 设备不在了，退回系统默认 */ } }
    return navigator.mediaDevices.getUserMedia({ audio: base });
  }
  // 录音时的波形刻度：跟回放一样，按已录内容的 97% 分位数自动取，避免一直顶满
  function updateRecNorm() {
    const P = S.rec.peaks, n = Math.min(P.length, 4000);
    if (n < 30) { S.norm = 0.25; return; }
    const a = Array.from(P.slice(P.length - n)).sort((x, y) => x - y);
    const want = Math.max(0.12, a[Math.floor(a.length * 0.97)]);
    S.norm = S.norm * 0.85 + want * 0.15;
  }
  async function startRec() {
    if (!(await api.micAsk())) { toast('需要麦克风权限'); api.openMicSettings(); return; }
    const mode = S.settings.source || 'mic';
    const streams = [];
    try {
      if (mode !== 'system') streams.push(await openMic(S.settings.inputId));
      if (mode !== 'mic') {
        const ds = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        ds.getVideoTracks().forEach((t) => t.stop());
        if (!ds.getAudioTracks().length) throw new Error('no-audio');
        streams.push(new MediaStream(ds.getAudioTracks()));
      }
    } catch (e) {
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      toast(mode === 'mic' ? '打不开麦克风' : '内录失败：请到系统设置允许录音机“录屏与系统录音”，然后重启软件（需要 macOS 13 以上）');
      return;
    }
    audio.pause();
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const src = ctx.createGain();
    const srcs = streams.map((s) => { const n = ctx.createMediaStreamSource(s); n.connect(src); return n; });
    const stream = { getTracks: () => streams.flatMap((s) => s.getTracks()) };
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80; hp.Q.value = 0.7;
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    const sr = ctx.sampleRate;
    const r = { id: stamp(), stream, ctx, src, hp, proc, sr, bin: Math.round(sr / PPS), chunks: [], peaks: [], samples: 0, mx: 0, cnt: 0, pk: 0, t0: performance.now(), lag: Infinity };
    proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0), q = new Int16Array(d.length);
      for (let i = 0; i < d.length; i++) {
        const v = d[i], a = v < 0 ? -v : v;
        q[i] = v <= -1 ? -32768 : v >= 1 ? 32767 : v < 0 ? v * 32768 : v * 32767;
        if (a > r.mx) r.mx = a;
        if (a > r.pk) r.pk = a;
        if (++r.cnt >= r.bin) { r.peaks.push(r.mx); r.mx = 0; r.cnt = 0; }
      }
      for (let i = 0; i < d.length; i++) {
        r.acc += d[i]; r.n++; r.ph += 16000;
        if (r.ph >= sr) {
          r.ph -= sr;
          const v = r.acc / r.n; r.acc = 0; r.n = 0;
          r.out.push(v <= -1 ? -32768 : v >= 1 ? 32767 : v < 0 ? v * 32768 : v * 32767);
        }
      }
      if (r.out.length >= 3200) { api.liveChunk(Int16Array.from(r.out).buffer); r.out = []; }
      r.chunks.push(q);
      r.samples += d.length;
      r.lag = Math.min(r.lag, (performance.now() - r.t0) / 1000 - r.samples / sr);
    };
    src.connect(hp); hp.connect(proc); proc.connect(ctx.destination);
    r.ph = 0; r.acc = 0; r.n = 0; r.out = []; r.outN = 0;
    S.live = { text: '' };
    api.liveStart();
    S.rec = r; S.norm = 0.25; S.normTick = 0;
    $('#app').classList.add('recording');
    $('#bigTime').classList.add('rec');
    setMode('wave'); updateUI(); S.lastT = -1;
  }
  async function stopRec() {
    const r = S.rec; if (!r) return;
    r.proc.disconnect(); r.hp.disconnect(); r.src.disconnect(); r.stream.getTracks().forEach((t) => t.stop()); r.ctx.close();
    S.rec = null;
    $('#app').classList.remove('recording');
    $('#bigTime').classList.remove('rec');
    if (r.out && r.out.length) { api.liveChunk(Int16Array.from(r.out).buffer); r.out = []; }
    if (r.samples < r.sr * 0.5) { api.liveStop(); S.live = null; updateUI(); S.lastT = -1; return; }
    const pcm = new Int16Array(r.samples);
    let o = 0;
    r.chunks.forEach((c) => { pcm.set(c, o); o += c.length; });
    // 录完整体提高音量（最多放大 8 倍，已经够响的不动），不用录音时实时放大，避免爆音
    if (S.settings.boost !== false && r.pk > 0.002 && r.pk < 0.85) {
      const g = Math.min(0.9 / r.pk, 8);
      for (let i = 0; i < pcm.length; i++) { const v = pcm[i] * g; pcm[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v; }
    }
    const [meta, lr] = await Promise.all([api.save(pcm.buffer, r.id, r.sr), api.liveStop()]);
    S.live = null;
    let ok = false;
    if (lr && lr.ok) { const a = await api.attach(meta.id, lr.json); ok = !!(a && a.ok); }
    S.settings = await api.getSettings();
    await refreshList();
    await selectRec(meta.id);
    if (ok) { clearAlert(); checkQuota(); } else transcribe(meta.id);
  }

  function showAlert(msg, kind) {
    $('#alertText').textContent = msg;
    $('#alert').className = kind === 'warn' ? 'warn' : '';
    $('#alert').hidden = false;
    $('#bGear').classList.add('badge');
  }
  function clearAlert() { $('#alert').hidden = true; $('#bGear').classList.remove('badge'); }
  $('#alertX').onclick = clearAlert;
  $('#alertGo').onclick = () => { clearAlert(); openSettings(); };

  function checkQuota() {
    const frac = (S.settings.usedSeconds || 0) / (S.settings.quotaHours * 3600);
    if (frac >= 0.9) showAlert(`本软件统计已用 ${Math.round(frac * 100)}%。多个软件共用同一个账号时这里不一定准，请到火山引擎控制台核对额度`, 'warn');
  }
  async function transcribe(id) {
    setProgress(id, 1);
    if (S.cur && S.cur.id === id) { S.cur.status = 'pending'; delete S.cur.error; if (!S.rec) renderText(); }
    const res = await api.transcribe(id);
    delete S.trans[id];
    if (res.ok) {
      S.settings = await api.getSettings();
      clearAlert();
      checkQuota();
      if (S.cur && S.cur.id === id) {
        S.cur = res.meta; S.tokens = Seg.buildTokens(S.cur.utterances || []); S.paras = Seg.layout(S.tokens);
        if (!S.rec) { renderText(); setMode('text'); updateUI(); }
      }
    } else {
      if (res.kind === 'quota') showAlert('识别失败：额度可能已用完（多个软件共用同一个账号）。请到设置更新 App ID 和 Token，或换一个模型');
      else if (res.kind === 'auth') showAlert('识别失败：App ID、Token 或模型不对，也可能是额度用完了。请到设置检查，或去火山引擎控制台核对额度');
      else showAlert('识别失败：' + res.error);
      if (S.cur && S.cur.id === id) { S.cur.status = 'error'; S.cur.error = res.error; if (!S.rec) renderText(); }
    }
    refreshList();
  }

  // ---------- 设置 ----------
  function fillSettings() {
    const s = S.settings;
    $('#sAppId').value = s.appId || ''; $('#sToken').value = s.token || ''; $('#sRes').value = s.resourceId;
    $('#sQuota').value = s.quotaHours; $('#sLead').value = s.lead;
    $('#sShareText').checked = !!s.shareText; $('#sShareAudio').checked = !!s.shareAudio;
    $('#sDir').textContent = s.exportDir || '未选择';
    const used = s.usedSeconds || 0;
    $('#sUsedH').value = (used / 3600).toFixed(2);
    $('#sQuotaTxt').textContent = '/ ' + s.quotaHours + ' 小时';
    $('#sSource').value = s.source || 'mic';
    $('#sDenoise').checked = s.denoise !== false; $('#sAgc').checked = !!s.agc; $('#sBoost').checked = s.boost !== false;
    const frac = Math.min(1, used / (s.quotaHours * 3600));
    const b = $('#sBar'); b.style.width = frac * 100 + '%'; b.className = frac > 0.9 ? 'bad' : frac > 0.7 ? 'warn' : '';
  }
  async function fillDevices() {
    let devs = [];
    try { devs = await navigator.mediaDevices.enumerateDevices(); } catch (e) { /* 忽略 */ }
    const fill = (sel, kind, cur, fb) => {
      const list = devs.filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications');
      sel.innerHTML = '<option value="">系统默认</option>' + list.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || fb + ' ' + (i + 1))}</option>`).join('');
      sel.value = list.some((d) => d.deviceId === cur) ? cur : '';
    };
    fill($('#sIn'), 'audioinput', S.settings.inputId, '麦克风');
    fill($('#sOut'), 'audiooutput', S.settings.outputId, '扬声器');
  }
  // 输入电平：确认麦克风真的有声音进来
  let meter = null;
  function stopMeter() {
    if (!meter) return;
    cancelAnimationFrame(meter.raf); meter.stream.getTracks().forEach((t) => t.stop()); meter.ac.close(); meter = null;
    $('#mBar').style.width = '0'; $('#bMeter').classList.remove('on'); $('#mName').textContent = '';
  }
  async function toggleMeter() {
    if (meter) { stopMeter(); return; }
    if (S.rec) { toast('正在录音'); return; }
    if (!(await api.micAsk())) { toast('需要麦克风权限'); api.openMicSettings(); return; }
    let stream;
    try { stream = await openMic(S.settings.inputId); } catch (e) { toast('打不开麦克风'); return; }
    const ac = new AudioContext(), an = ac.createAnalyser();
    an.fftSize = 1024;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(1024);
    meter = { stream, ac, raf: 0 };
    const loop = () => {
      an.getFloatTimeDomainData(buf);
      let m = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > m) m = v; }
      $('#mBar').style.width = Math.min(100, m ** 0.5 * 120) + '%';
      meter.raf = requestAnimationFrame(loop);
    };
    loop();
    $('#bMeter').classList.add('on');
    $('#mName').textContent = stream.getAudioTracks()[0].label || '';
    fillDevices();
  }
  function beepUrl() {
    const sr = 16000, n = Math.floor(sr * 0.6), dv = new DataView(new ArrayBuffer(44 + n * 2));
    const w = (o, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 660 * i) / sr) * Math.sin((Math.PI * i) / n) * 0.35 * 32767, true);
    return URL.createObjectURL(new Blob([dv.buffer], { type: 'audio/wav' }));
  }
  async function save(patch) { S.settings = await api.setSettings(patch); fillSettings(); }
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  $('#sAppId').oninput = (e) => { clearAlert(); save({ appId: e.target.value.trim() }); };
  $('#sToken').oninput = (e) => { clearAlert(); save({ token: e.target.value.trim() }); };
  $('#sRes').onchange = (e) => save({ resourceId: e.target.value });
  $('#sQuota').onchange = (e) => save({ quotaHours: Math.max(1, num(e.target.value, 20)) });
  $('#sLead').onchange = (e) => save({ lead: Math.max(0, Math.min(2, num(e.target.value, 0.3))) });
  $('#sShareText').onchange = (e) => save({ shareText: e.target.checked });
  $('#sShareAudio').onchange = (e) => save({ shareAudio: e.target.checked });
  $('#sReset').onclick = () => save({ usedSeconds: 0 });
  $('#sUsedH').onchange = (e) => save({ usedSeconds: Math.max(0, num(e.target.value, 0)) * 3600 });
  $('#sSource').onchange = (e) => save({ source: e.target.value });
  $('#sDenoise').onchange = (e) => save({ denoise: e.target.checked });
  $('#sAgc').onchange = (e) => save({ agc: e.target.checked });
  $('#sBoost').onchange = (e) => save({ boost: e.target.checked });
  $('#sPick').onclick = async () => { await api.pickExportDir(); S.settings = await api.getSettings(); fillSettings(); };
  $('#sIn').onchange = async (e) => { await save({ inputId: e.target.value }); if (meter) { stopMeter(); toggleMeter(); } };
  $('#sOut').onchange = async (e) => { await save({ outputId: e.target.value }); applySink(); };
  $('#bMeter').onclick = toggleMeter;
  $('#bBeep').onclick = async () => {
    const a = new Audio(beepUrl());
    try { await a.setSinkId(S.settings.outputId || ''); } catch (e) { /* 用默认 */ }
    a.play().catch(() => {});
  };
  const openSettings = () => { fillSettings(); fillDevices(); $('#settings').hidden = false; };
  const closeSettings = () => { stopMeter(); $('#settings').hidden = true; };
  $('#bGear').onclick = openSettings;
  $('#sClose').onclick = closeSettings;
  $('#settings').onclick = (e) => { if (e.target.id === 'settings') closeSettings(); };
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => { if (!$('#settings').hidden) fillDevices(); });

  // ---------- 按钮 ----------
  const allText = () => Seg.fullText(S.tokens);
  $('#bSide').onclick = () => { $('#app').classList.toggle('collapsed'); setTimeout(() => { drawOver(); S.lastT = -1; }, 260); };
  $('#textView').addEventListener('click', (e) => {
    if (e.target.closest('.w, .pcopy, button')) return;
    if (String(window.getSelection()).length) return;
    if (S.rec) { S.rec.userMode = true; setMode('wave'); } else if (S.cur) setMode('wave');
  });
  $('#bQuote').onclick = () => { if (S.rec) { S.rec.userMode = true; setMode(S.mode === 'text' ? 'wave' : 'text'); renderLive(); } else setMode(S.mode === 'text' ? 'wave' : 'text'); };
  $('#bCopy').onclick = async () => { await api.copy(allText()); toast('', 'check'); };
  $('#bShare').onclick = async () => {
    const r = await api.share({ id: S.cur.id, text: allText() });
    toast(r.ok ? '' : r.msg, r.ok ? 'check' : null);
  };
  $('#bExport').onclick = async () => {
    const r = await api.exportFiles({ id: S.cur.id, text: allText() });
    if (r.ok) { S.settings = await api.getSettings(); toast('', 'check'); }
  };
  $('#bTrash').onclick = async () => {
    if (!S.cur) return;
    const id = S.cur.id; audio.pause();
    await api.remove(id);
    S.cur = null; S.tokens = []; S.paras = []; S.peaks = [];
    await refreshList();
    renderText(); setMode('wave'); updateUI(); drawOver(); S.lastT = -1; $('#tEnd').textContent = '0:00';
  };
  $('#bPlay').onclick = togglePlay;
  $('#bBack').onclick = () => seek(audio.currentTime - 15);
  $('#bFwd').onclick = () => seek(audio.currentTime + 15);
  $('#recBtn').onclick = () => (S.rec ? stopRec() : startRec());
  document.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.key === 'Escape') $('#app').classList.add('collapsed');
    if (e.key === '=' || e.key === '+') { S.win = Math.max(0.8, S.win / 1.25); S.lastT = -1; }
    if (e.key === '-') { S.win = Math.min(40, S.win * 1.25); S.lastT = -1; }
    if (e.code === 'ArrowLeft') seek(audio.currentTime - 5);
    if (e.code === 'ArrowRight') seek(audio.currentTime + 5);
    if (e.metaKey && e.shiftKey && e.code === 'KeyC' && S.tokens.length) { api.copy(allText()); toast('', 'check'); }
  });

  $('#main').addEventListener('click', (e) => {
    if ($('#app').classList.contains('collapsed')) return;
    if (e.target.closest('button, .w, .pcopy, #alert')) return;
    $('#app').classList.add('collapsed');
  });
  // 点字回放
  $('#textView').addEventListener('click', (e) => {
    const pc = e.target.closest('.pcopy');
    if (pc) { api.copy(Seg.paraText(S.tokens, S.paras[+pc.dataset.p])); toast('', 'check'); return; }
    const w = e.target.closest('.w');
    if (!w || String(window.getSelection()).length) return;
    seek(S.tokens[+w.dataset.i].s / 1000 - (S.settings.lead || 0), true);
  });
  ['wheel', 'touchmove', 'mousedown'].forEach((ev) => $('#textView').addEventListener(ev, () => { S.userScroll = Date.now(); }, { passive: true }));

  // 拖动、缩放波形
  const overSeek = (e) => { const r = $('#overBox').getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * dur()); };
  $('#overBox').addEventListener('pointerdown', (e) => { if (S.rec || !S.cur) return; e.currentTarget.setPointerCapture(e.pointerId); S.ovDrag = true; overSeek(e); });
  $('#overBox').addEventListener('pointermove', (e) => { if (S.ovDrag) overSeek(e); });
  $('#overBox').addEventListener('pointerup', () => { S.ovDrag = false; });
  const winPx = () => $('#zoomWrap').clientWidth / S.win;
  $('#zoomWrap').addEventListener('pointerdown', (e) => {
    if (S.rec || !S.cur) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    S.drag = { x: e.clientX, t0: audio.currentTime, t: audio.currentTime, was: !audio.paused };
    audio.pause();
  });
  $('#zoomWrap').addEventListener('pointermove', (e) => {
    if (!S.drag) return;
    S.drag.t = Math.max(0, Math.min(dur(), S.drag.t0 - (e.clientX - S.drag.x) / winPx()));
  });
  $('#zoomWrap').addEventListener('pointerup', () => {
    if (!S.drag) return;
    const d = S.drag; S.drag = null; audio.currentTime = d.t; sync.at = -1; if (d.was) audio.play().catch(() => {});
  });
  // 触控板：双指捏合缩放波形，左右滑动拖动时间；双击恢复
  $('#zoomWrap').addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey) { S.win = Math.max(0.8, Math.min(40, S.win * Math.exp(e.deltaY * 0.012))); S.lastT = -1; return; }
    if (S.rec || !S.cur || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    seek(audio.currentTime + e.deltaX / winPx());
  }, { passive: false });
  // 单击波形区回到文字界面（拖动、双击不算）；双击恢复缩放
  let zDown = null, zTimer = null;
  $('#zoomWrap').addEventListener('pointerdown', (e) => { zDown = { x: e.clientX, y: e.clientY }; });
  $('#zoomWrap').addEventListener('click', (e) => {
    if (!zDown || Math.abs(e.clientX - zDown.x) > 4 || Math.abs(e.clientY - zDown.y) > 4) return;
    clearTimeout(zTimer);
    zTimer = setTimeout(() => {
      if (S.mode === 'text') return;
      if (S.rec) { S.rec.userMode = true; setMode('text'); renderLive(); }
      else if (S.cur && S.cur.utterances) setMode('text');
    }, 260);
  });
  $('#zoomWrap').addEventListener('dblclick', () => { clearTimeout(zTimer); S.win = 6.4; S.lastT = -1; });
  const ro = new ResizeObserver(() => { measure(); drawOver(); });
  ['#stage', '#zoomWrap', '#overBox'].forEach((q) => ro.observe($(q)));
  window.addEventListener('resize', () => { measure(); drawOver(); });
  api.onProgress(({ id, pct }) => setProgress(id, pct));
  api.onLive(({ text }) => {
    if (!S.rec || !S.live) return;
    S.live.text = text;
    if (!S.rec.userMode && S.mode !== 'text' && text) setMode('text');
    if (S.mode === 'text') renderLive();
  });

  // ---------- 启动 ----------
  (async () => {
    S.settings = await api.getSettings();
    await refreshList();
    setMode('wave'); updateUI(); drawOver();
    setPlayIcon();
    if (!S.settings.appId || !S.settings.token) { fillSettings(); $('#settings').hidden = false; }
    measure(); drawOver(); applySink();
    requestAnimationFrame(frame);
  })();
})();

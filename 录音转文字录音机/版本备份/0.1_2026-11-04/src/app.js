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
    check: SV('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  };
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ICON[el.dataset.icon]; });
  const style = document.createElement('style');
  style.textContent = '.ib.on svg .bub{fill:currentColor}.ib.on svg .qm{stroke:#fff}';
  document.head.appendChild(style);

  // ---------- 状态 ----------
  const PPS = 25; // 每秒 25 根波形条
  const audio = new Audio();
  audio.preload = 'auto';
  const S = {
    settings: {}, recs: [], cur: null, tokens: [], paras: [], peaks: [], norm: 0.3,
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
  function fit(c) {
    const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; return true; }
    return false;
  }
  const amp = (p) => Math.min(1, p / S.norm) ** 0.75;
  function drawZoom(t) {
    const c = $('#zoom'); fit(c);
    const ctx = c.getContext('2d'), W = c.width, H = c.height, d = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, W, H);
    const peaks = S.rec ? S.rec.peaks : S.peaks;
    const pxs = W / 6.4, cx = W / 2, mid = H / 2;
    const i0 = Math.max(0, Math.floor((t - 3.4) * PPS)), i1 = Math.min(peaks.length - 1, Math.ceil((t + 3.4) * PPS));
    ctx.lineWidth = 2 * d; ctx.lineCap = 'round';
    for (let i = i0; i <= i1; i++) {
      const x = cx + (i / PPS - t) * pxs;
      const h = Math.max(2 * d, amp(peaks[i]) * H * 0.86);
      ctx.strokeStyle = h <= 3 * d ? '#a1a1a6' : '#1c1c1e';
      ctx.beginPath(); ctx.moveTo(x, mid - h / 2); ctx.lineTo(x, mid + h / 2); ctx.stroke();
    }
    if (!peaks.length) { // 空状态：一条点线
      ctx.strokeStyle = '#a1a1a6';
      for (let x = 0; x < W; x += 6 * d) { ctx.beginPath(); ctx.moveTo(x, mid - d); ctx.lineTo(x, mid + d); ctx.stroke(); }
    }
  }
  function drawTicks(t) {
    const c = $('#ticks'); fit(c);
    const ctx = c.getContext('2d'), W = c.width, H = c.height, d = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, W, H);
    const pxs = W / 6.4, cx = W / 2;
    ctx.font = `${14 * d}px -apple-system, "PingFang SC", sans-serif`;
    ctx.textAlign = 'center'; ctx.fillStyle = '#aeaeb2'; ctx.strokeStyle = '#d1d1d6'; ctx.lineWidth = d;
    for (let s = Math.floor(t - 3.4); s <= Math.ceil(t + 3.4); s += 0.5) {
      if (s < 0) continue;
      const x = cx + (s - t) * pxs;
      const whole = Math.abs(s - Math.round(s)) < 0.01;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, (whole ? 8 : 5) * d); ctx.stroke();
      if (whole) ctx.fillText(short(s), x, 26 * d);
    }
  }
  function drawOver() {
    const c = $('#over'); fit(c);
    const ctx = c.getContext('2d'), W = c.width, H = c.height, d = window.devicePixelRatio || 1;
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
        for (let k = i * win; k < e; k += 4) { const v = Math.abs(ch[k]); if (v > m) m = v; }
        out[i] = m;
      }
      const sorted = Array.from(out).sort((a, b) => a - b);
      S.norm = Math.max(0.02, sorted[Math.floor(sorted.length * 0.97)] || 0.3);
      if (S.cur && S.cur.id === id) { S.peaks = out; }
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
      el.innerHTML = `<div class="n">${esc(r.name)}</div><div class="s"><span class="st">${when}${mark ? ' ' + mark : ''}</span><span>${short(r.duration || 0)}</span></div>`;
      el.onclick = () => selectRec(r.id);
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
    S.lastT = -1;
  }
  function updateUI() {
    const hasText = !!(S.cur && S.cur.utterances && S.tokens.length);
    const app = $('#app');
    app.classList.toggle('nodata', !S.cur && !S.rec);
    $('#title').textContent = S.rec ? '新录音 ' + ((S.settings.counter || 0) + 1) : S.cur ? S.cur.name : '录音机';
    ['#bShare', '#bExport', '#bCopy'].forEach((s) => $(s).classList.toggle('dis', !hasText || !!S.rec));
    $('#bTrash').classList.toggle('dis', !S.cur || !!S.rec);
    $('#bQuote').classList.toggle('dis', !!S.rec);
    $('#tEnd').textContent = short(dur());
  }

  // ---------- 回放 ----------
  function seek(t, play) {
    t = Math.max(0, Math.min(dur() || t, t));
    audio.currentTime = t;
    if (play && audio.paused) audio.play().catch(() => {});
    S.lastT = -1;
  }
  const curTime = () => (S.rec ? S.rec.samples / 16000 : S.drag ? S.drag.t : audio.currentTime || 0);
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
  function frame() {
    const t = curTime();
    if (t !== S.lastT) {
      S.lastT = t;
      if (S.mode === 'wave') { drawZoom(t); drawTicks(t); }
      $('#bigTime').textContent = clock(t);
      const d = dur();
      $('#overHead').style.left = (d ? Math.min(1, t / d) : 0) * $('#overBox').clientWidth + 'px';
      highlight(t);
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

  // ---------- 录音 ----------
  async function startRec() {
    if (!(await api.micAsk())) { toast('需要麦克风权限'); api.openMicSettings(); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    } catch (e) { toast('打不开麦克风'); return; }
    audio.pause();
    const ctx = new AudioContext({ sampleRate: 16000 });
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const r = { stream, ctx, src, proc, chunks: [], peaks: [], samples: 0, mx: 0, cnt: 0 };
    proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      r.chunks.push(new Float32Array(d));
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]); if (v > r.mx) r.mx = v;
        if (++r.cnt >= 640) { r.peaks.push(r.mx); r.mx = 0; r.cnt = 0; }
      }
      r.samples += d.length;
    };
    src.connect(proc); proc.connect(ctx.destination);
    S.rec = r; S.norm = 0.25;
    $('#app').classList.add('recording');
    $('#bigTime').classList.add('rec');
    setMode('wave'); updateUI(); S.lastT = -1;
  }
  async function stopRec() {
    const r = S.rec; if (!r) return;
    r.proc.disconnect(); r.src.disconnect(); r.stream.getTracks().forEach((t) => t.stop()); r.ctx.close();
    S.rec = null;
    $('#app').classList.remove('recording');
    $('#bigTime').classList.remove('rec');
    if (r.samples < 16000 * 0.5) { updateUI(); S.lastT = -1; return; }
    const pcm = new Int16Array(r.samples);
    let o = 0;
    r.chunks.forEach((c) => { for (let i = 0; i < c.length; i++) { const v = Math.max(-1, Math.min(1, c[i])); pcm[o++] = v < 0 ? v * 0x8000 : v * 0x7fff; } });
    const meta = await api.save(pcm.buffer);
    S.settings = await api.getSettings();
    await refreshList();
    await selectRec(meta.id);
    transcribe(meta.id);
  }

  async function transcribe(id) {
    setProgress(id, 1);
    if (S.cur && S.cur.id === id) { S.cur.status = 'pending'; delete S.cur.error; renderText(); }
    const res = await api.transcribe(id);
    delete S.trans[id];
    if (res.ok) {
      S.settings = await api.getSettings();
      if (S.cur && S.cur.id === id) {
        S.cur = res.meta; S.tokens = Seg.buildTokens(S.cur.utterances || []); S.paras = Seg.layout(S.tokens);
        renderText(); setMode('text'); updateUI();
      }
    } else if (S.cur && S.cur.id === id) {
      S.cur.status = 'error'; S.cur.error = res.error; renderText();
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
    const used = s.usedSeconds || 0, min = Math.round(used / 60);
    $('#sUsed').textContent = `${min >= 60 ? Math.floor(min / 60) + ' 小时 ' : ''}${min % 60} 分钟 / ${s.quotaHours} 小时`;
    const frac = Math.min(1, used / (s.quotaHours * 3600));
    const b = $('#sBar'); b.style.width = frac * 100 + '%'; b.className = frac > 0.9 ? 'bad' : frac > 0.7 ? 'warn' : '';
  }
  async function save(patch) { S.settings = await api.setSettings(patch); fillSettings(); }
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  $('#sAppId').oninput = (e) => save({ appId: e.target.value.trim() });
  $('#sToken').oninput = (e) => save({ token: e.target.value.trim() });
  $('#sRes').onchange = (e) => save({ resourceId: e.target.value });
  $('#sQuota').onchange = (e) => save({ quotaHours: Math.max(1, num(e.target.value, 20)) });
  $('#sLead').onchange = (e) => save({ lead: Math.max(0, Math.min(2, num(e.target.value, 0.3))) });
  $('#sShareText').onchange = (e) => save({ shareText: e.target.checked });
  $('#sShareAudio').onchange = (e) => save({ shareAudio: e.target.checked });
  $('#sReset').onclick = () => save({ usedSeconds: 0 });
  $('#sPick').onclick = async () => { await api.pickExportDir(); S.settings = await api.getSettings(); fillSettings(); };
  $('#bGear').onclick = () => { fillSettings(); $('#settings').hidden = false; };
  $('#sClose').onclick = () => { $('#settings').hidden = true; };
  $('#settings').onclick = (e) => { if (e.target.id === 'settings') $('#settings').hidden = true; };

  // ---------- 按钮 ----------
  const allText = () => Seg.fullText(S.tokens);
  $('#bSide').onclick = () => { $('#app').classList.toggle('collapsed'); setTimeout(() => { drawOver(); S.lastT = -1; }, 260); };
  $('#bQuote').onclick = () => { if (!S.rec) setMode(S.mode === 'text' ? 'wave' : 'text'); };
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
    if (S.recs.length) await selectRec(S.recs[0].id);
    else { renderText(); setMode('wave'); updateUI(); drawOver(); S.lastT = -1; $('#tEnd').textContent = '0:00'; }
  };
  $('#bPlay').onclick = togglePlay;
  $('#bBack').onclick = () => seek(audio.currentTime - 15);
  $('#bFwd').onclick = () => seek(audio.currentTime + 15);
  $('#recBtn').onclick = () => (S.rec ? stopRec() : startRec());
  document.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowLeft') seek(audio.currentTime - 5);
    if (e.code === 'ArrowRight') seek(audio.currentTime + 5);
    if (e.metaKey && e.shiftKey && e.code === 'KeyC' && S.tokens.length) { api.copy(allText()); toast('', 'check'); }
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

  // 拖动波形
  const overSeek = (e) => { const r = $('#overBox').getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * dur()); };
  $('#overBox').addEventListener('pointerdown', (e) => { if (S.rec || !S.cur) return; e.currentTarget.setPointerCapture(e.pointerId); S.ovDrag = true; overSeek(e); });
  $('#overBox').addEventListener('pointermove', (e) => { if (S.ovDrag) overSeek(e); });
  $('#overBox').addEventListener('pointerup', () => { S.ovDrag = false; });
  $('#zoomWrap').addEventListener('pointerdown', (e) => {
    if (S.rec || !S.cur) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    S.drag = { x: e.clientX, t0: audio.currentTime, t: audio.currentTime, was: !audio.paused };
    audio.pause();
  });
  $('#zoomWrap').addEventListener('pointermove', (e) => {
    if (!S.drag) return;
    const pxs = $('#zoomWrap').clientWidth / 6.4;
    S.drag.t = Math.max(0, Math.min(dur(), S.drag.t0 - (e.clientX - S.drag.x) / pxs));
  });
  $('#zoomWrap').addEventListener('pointerup', () => {
    if (!S.drag) return;
    const d = S.drag; S.drag = null; audio.currentTime = d.t; if (d.was) audio.play().catch(() => {});
  });
  window.addEventListener('resize', () => { drawOver(); S.lastT = -1; });
  api.onProgress(({ id, pct }) => setProgress(id, pct));

  // ---------- 启动 ----------
  (async () => {
    S.settings = await api.getSettings();
    await refreshList();
    if (S.recs.length) await selectRec(S.recs[0].id);
    else { setMode('wave'); updateUI(); drawOver(); }
    setPlayIcon();
    if (!S.settings.appId || !S.settings.token) { fillSettings(); $('#settings').hidden = false; }
    requestAnimationFrame(frame);
  })();
})();

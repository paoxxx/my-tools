// 对轨：用音频本身的“有声／无声”来校准每个字的时间
// whisper给的字级时间在长句里会漂移（实测提前1秒多），
// 这里改成：只把字分配到真正有人声的地方，并把标点处的停顿对齐到音频里的静音段。
const fs = require('fs');

const HOP = 0.01; // 每帧10毫秒

function readWav(wavPath) {
  const buf = fs.readFileSync(wavPath);
  let pos = 12, ds = -1, dl = 0, rate = 16000;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4), sz = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') rate = buf.readUInt32LE(pos + 12);
    if (id === 'data') { ds = pos + 8; dl = Math.min(sz, buf.length - ds); break; }
    pos += 8 + sz + (sz % 2);
  }
  return { buf, ds, n: ds < 0 ? 0 : Math.floor(dl / 2), rate };
}

// 人声检测：按10毫秒算音量，自动定阈值
function detectSpeech(wavPath) {
  const { buf, ds, n, rate } = readWav(wavPath);
  const hop = Math.round(rate * HOP);
  const frames = Math.ceil(n / hop);
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0, c = 0;
    for (let k = f * hop; k < Math.min(n, (f + 1) * hop); k++) { const v = buf.readInt16LE(ds + k * 2) / 32768; s += v * v; c++; }
    db[f] = 10 * Math.log10(s / Math.max(1, c) + 1e-12);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] || -80;
  const top = sorted[Math.floor(sorted.length * 0.95)] || -20;
  const thr = floor + (top - floor) * 0.3;
  const sp = new Uint8Array(frames);
  for (let f = 0; f < frames; f++) sp[f] = db[f] > thr ? 1 : 0;
  // 字和字之间很短的低音量（不到80毫秒）算作还在说话
  fillRuns(sp, 0, 8, 1);
  // 很短的杂音（不到50毫秒）不算说话
  fillRuns(sp, 1, 5, 0);
  // 静音段（至少120毫秒）
  const gaps = [];
  let f = 0;
  while (f < frames) {
    if (sp[f]) { f++; continue; }
    let e = f;
    while (e < frames && !sp[e]) e++;
    if (e - f >= 12) gaps.push([f * HOP, e * HOP]);
    f = e;
  }
  return { sp, gaps, frames };
}

function fillRuns(arr, val, maxLen, to) {
  let i = 0;
  while (i < arr.length) {
    if (arr[i] !== val) { i++; continue; }
    let j = i;
    while (j < arr.length && arr[j] === val) j++;
    if (i > 0 && j < arr.length && j - i < maxLen) arr.fill(to, i, j);
    i = j;
  }
}

const isPunct = ch => /^[\s\p{P}\p{S}]$/u.test(ch);
const weightOf = ch => (isPunct(ch) ? 0 : /[A-Za-z]/.test(ch) ? 0.6 : 1);

// 把一串字按权重分配到 [t0,t1] 之间“有人声”的帧上
function distribute(chars, t0, t1, vad) {
  const total = chars.reduce((a, c) => a + weightOf(c.ch), 0);
  const f0 = Math.max(0, Math.floor(t0 / HOP)), f1 = Math.min(vad.frames, Math.ceil(t1 / HOP));
  const frames = [];
  for (let f = f0; f < f1; f++) if (vad.sp[f]) frames.push(f);
  if (!total) { chars.forEach(c => { c.t0 = c.t1 = t0; }); return; }
  if (frames.length < 3) {
    // 没检测到人声，就平均分
    let acc = 0;
    chars.forEach(c => { const w = weightOf(c.ch); c.t0 = t0 + ((t1 - t0) * acc) / total; acc += w; c.t1 = t0 + ((t1 - t0) * acc) / total; });
    return;
  }
  const at = u => { // u：0到1，按人声时长的比例
    const k = Math.min(frames.length - 1, Math.max(0, Math.floor(u * frames.length)));
    return frames[k] * HOP;
  };
  let acc = 0;
  for (const c of chars) {
    const w = weightOf(c.ch);
    if (!w) { const t = acc >= total ? frames[frames.length - 1] * HOP + HOP : at(acc / total); c.t0 = c.t1 = t; continue; }
    c.t0 = at(acc / total);
    acc += w;
    c.t1 = acc >= total ? frames[frames.length - 1] * HOP + HOP : at(acc / total);
    if (c.t1 <= c.t0) c.t1 = c.t0 + HOP;
  }
}

function speechBetween(vad, t0, t1) {
  let n = 0;
  for (let f = Math.max(0, Math.floor(t0 / HOP)); f < Math.min(vad.frames, Math.ceil(t1 / HOP)); f++) n += vad.sp[f];
  return n * HOP;
}

// 估计“从t0开始，再说frac比例的人声”是在什么时间
function timeAtSpeech(vad, t0, t1, frac) {
  const need = speechBetween(vad, t0, t1) * frac;
  let got = 0;
  for (let f = Math.max(0, Math.floor(t0 / HOP)); f < Math.min(vad.frames, Math.ceil(t1 / HOP)); f++) {
    got += vad.sp[f] * HOP;
    if (got >= need) return f * HOP;
  }
  return t1;
}

function nearestGap(vad, t, maxD) {
  let best = null, bd = maxD;
  for (const g of vad.gaps) {
    const d = t < g[0] ? g[0] - t : t > g[1] ? t - g[1] : 0;
    if (d < bd) { bd = d; best = g; }
  }
  return best;
}

function alignSegments(segs, vad) {
  if (!vad) return segs;
  const dur = vad.frames * HOP;
  const live = segs.filter(sg => sg.chars.some(c => weightOf(c.ch) > 0));
  // 1. 句段之间的分界，对到最近的静音段上
  for (let i = 0; i < live.length - 1; i++) {
    const a = live[i], b = live[i + 1];
    const mid = (a.end + b.start) / 2;
    const g = nearestGap(vad, mid, 0.8);
    if (g && g[0] > a.start + 0.2 && g[1] < b.end - 0.2) { a.end = g[0]; b.start = g[1]; }
  }
  live.forEach((sg, si) => {
    const prevEnd = si > 0 ? live[si - 1].end : 0;
    const nextStart = si < live.length - 1 ? live[si + 1].start : dur;
    let w0 = Math.max(prevEnd, si === 0 ? sg.start - 0.5 : sg.start);
    let w1 = Math.min(nextStart, si === live.length - 1 ? sg.end + 0.5 : sg.end, dur);
    let f = Math.floor(w0 / HOP);
    while (f < w1 / HOP && !vad.sp[f]) f++;
    let g = Math.ceil(w1 / HOP) - 1;
    while (g > f && !vad.sp[g]) g--;
    if (g - f < 5) return; // 这段基本没声音，保留原时间
    w0 = f * HOP; w1 = (g + 1) * HOP;
    alignOne(sg.chars, w0, w1, vad);
    sg.start = w0; sg.end = w1;
  });
  return segs;
}

// 2. 句段内部：标点（可能的停顿）和音频里的静音段做最优匹配
function alignOne(chars, w0, w1, vad) {
  const totalW = chars.reduce((a, c) => a + weightOf(c.ch), 0);
  const totalS = speechBetween(vad, w0, w1);
  if (!totalW || totalS < 0.05) return distribute(chars, w0, w1, vad);
  const r0 = totalW / totalS; // 平均语速（字／秒）
  // 候选断点：每个标点的位置
  const B = [{ i: 0, w: 0 }];
  let acc = 0;
  chars.forEach((c, i) => {
    if (isPunct(c.ch) && /[^\s]/.test(c.ch) && acc > 0 && acc < totalW && B[B.length - 1].w !== acc) B.push({ i, w: acc });
    acc += weightOf(c.ch);
  });
  B.push({ i: chars.length, w: totalW });
  // 候选静音段：窗口里面的
  const G = vad.gaps.filter(gp => gp[0] > w0 + 0.05 && gp[1] < w1 - 0.05);
  const gStart = k => (k < 0 ? w0 : G[k][1]); // 锚点之后开始说话的时间
  const gEnd = k => (k >= G.length ? w1 : G[k][0]);
  const m = B.length - 1, n = G.length;
  // dp[k][j]：第k个断点对到第j个静音段（j=-1表示开头，j=n表示结尾）时的最小代价
  const key = (k, j) => k * (n + 2) + (j + 1);
  const dp = new Map([[key(0, -1), { c: 0, pk: -1, pj: -2 }]]);
  for (let k = 1; k <= m; k++) {
    const jRange = k === m ? [n] : [...Array(n).keys()];
    for (const j of jRange) {
      let best = null;
      for (let k2 = 0; k2 < k; k2++) {
        for (let j2 = -1; j2 < j; j2++) {
          if (k2 === 0 && j2 !== -1) continue;
          if (k2 > 0 && j2 < 0) continue;
          const prev = dp.get(key(k2, j2));
          if (!prev) continue;
          const t0 = gStart(j2), t1 = gEnd(j);
          if (t1 <= t0) continue;
          const dw = B[k].w - B[k2].w;
          const ds = speechBetween(vad, t0, t1);
          if (ds < 0.05) continue;
          const lr = Math.log(dw / ds / r0);
          let c = prev.c + dw * lr * lr * 1.5;
          c += (k - k2 - 1) * 0.4; // 有标点但没停顿
          for (let q = j2 + 1; q < j; q++) c += 1.2 * Math.max(0, G[q][1] - G[q][0] - 0.1); // 停顿了但没标点
          if (!best || c < best.c) best = { c, pk: k2, pj: j2 };
        }
      }
      if (best) dp.set(key(k, j), best);
    }
  }
  const end = dp.get(key(m, n));
  if (!end) return distribute(chars, w0, w1, vad);
  // 回溯得到锚点
  const path = [];
  let k = m, j = n, cur = end;
  while (k > 0) { path.unshift({ k, j }); const pk = cur.pk, pj = cur.pj; k = pk; j = pj; cur = dp.get(key(k, j)); if (!cur) break; }
  let prevK = 0, prevJ = -1;
  for (const p of path) {
    distribute(chars.slice(B[prevK].i, B[p.k].i), gStart(prevJ), gEnd(p.j), vad);
    prevK = p.k; prevJ = p.j;
  }
}

// 每句字幕的开头对到“开口说话”的那一帧
function snapCues(cues, vad) {
  if (!vad) return cues;
  const on = t => { const f = Math.round(t / HOP); return f >= 0 && f < vad.frames && vad.sp[f] === 1; };
  cues.forEach((c, k) => {
    const prevEnd = k > 0 ? cues[k - 1].end : 0;
    if (!on(c.start)) {
      // 开头落在静音里：往后找到开口的位置
      for (let t = c.start; t < Math.min(c.start + 0.8, c.end - 0.15); t += HOP) if (on(t)) { c.start = t; break; }
    } else {
      // 开头已经在说话：往前退到这口气真正开始的地方（最多0.3秒）
      let t = c.start;
      while (t - HOP > Math.max(prevEnd, c.start - 0.3) && on(t - HOP)) t -= HOP;
      c.start = t;
    }
    // 结尾落在静音里：收回到声音结束处
    if (!on(c.end - HOP)) {
      for (let t = c.end; t > c.start + 0.3; t -= HOP) if (on(t - HOP)) { c.end = t; break; }
    }
  });
  return cues;
}

module.exports = { alignSegments, detectSpeech, snapCues };

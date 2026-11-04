// 字幕识别：调用whisper.cpp，把结果切成适合短视频的字幕行
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PROMPT = '以下是普通话的句子，使用简体中文，句子之间要加上逗号、句号和问号。';
const PROMPT_PLAIN = '以下是普通话的句子，使用简体中文。';
const MAX_CHARS = 16;     // 每行最多字数
const GAP_BREAK = 0.6;    // 字与字之间停顿超过这个秒数就断行
const HARD_PUNCT = new Set('。！？….!?\n'.split(''));   // 句末：一定断开
const SOFT_PUNCT = new Set('，、；：,;:'.split(''));     // 句中：优先在这里断，但短句可以合并

function findWhisper() {
  for (const p of ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli']) if (fs.existsSync(p)) return p;
  return null;
}

function findModel() {
  const dir = path.join(os.homedir(), 'whisper-models');
  const best = path.join(dir, 'ggml-large-v3-turbo.bin');
  if (fs.existsSync(best) && fs.statSync(best).size > 100e6) return best;
  if (!fs.existsSync(dir)) return null;
  const any = fs.readdirSync(dir).filter(f => /^ggml-.*\.bin$/.test(f))
    .map(f => path.join(dir, f)).filter(f => fs.statSync(f).size > 30e6);
  return any[0] || null;
}

// 人声检测模型（Silero VAD，不到1MB）：有它时只识别有人说话的片段，时间更准、也不会在静音处“脑补”文字
function findVadModel() {
  const dir = path.join(os.homedir(), 'whisper-models');
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter(x => /^ggml-silero.*\.bin$/.test(x)).sort().pop();
  return f ? path.join(dir, f) : null;
}

// 运行识别。onProgress(0到100)。返回 { kill(), done: Promise<{raw, mode}> }
// 依次尝试：DTW精确时间戳＋人声检测 → 去掉不支持的参数再试，保证老版本也能用
function transcribe(wavPath, outDir, onProgress) {
  const bin = findWhisper();
  if (!bin) throw new Error('没找到whisper-cli，请先在终端运行：brew install whisper-cpp');
  const model = findModel();
  if (!model) throw new Error('没找到识别模型，请把ggml-large-v3-turbo.bin放进个人文件夹的whisper-models里');
  const base = path.join(outDir, 'whisper');
  const threads = String(Math.max(4, Math.min(8, os.cpus().length - 2)));
  const vad = findVadModel();
  // 有人声检测时，句段本来就短，可以放心让模型加标点；没有时用简短提示，避免模型把几十秒合成一大段导致时间漂移
  const common = ['-m', model, '-f', wavPath, '-l', 'zh', '--prompt', vad ? PROMPT : PROMPT_PLAIN, '-ojf', '-of', base, '-pp', '-t', threads];
  const vadArgs = vad ? ['--vad', '-vm', vad] : [];
  const dtw = /turbo/.test(model) ? 'large.v3.turbo' : /large-v3/.test(model) ? 'large.v3' : null;
  const dtwArgs = dtw ? ['-dtw', dtw] : [];
  const variants = [
    { args: [...common, ...dtwArgs, '-nfa', ...vadArgs], mode: { dtw: !!dtw, vad: !!vad } },
    { args: [...common, ...dtwArgs, ...vadArgs], mode: { dtw: !!dtw, vad: !!vad } },
    { args: [...common, ...vadArgs], mode: { dtw: false, vad: !!vad } },
    { args: common, mode: { dtw: false, vad: false } },
  ].filter((v, i, arr) => arr.findIndex(x => x.args.join(' ') === v.args.join(' ')) === i);

  let proc = null, killed = false;
  const log = [];
  const runOne = args => new Promise((resolve, reject) => {
    try { fs.unlinkSync(base + '.json'); } catch {}
    proc = spawn(bin, args);
    let errTail = '';
    const onData = d => {
      const s = d.toString();
      errTail = (errTail + s).slice(-4000);
      const m = s.match(/progress\s*=\s*(\d+)%/g);
      if (m) onProgress(Number(m[m.length - 1].match(/(\d+)/)[1]));
    };
    proc.stderr.on('data', onData);
    proc.stdout.on('data', onData);
    proc.on('error', e => reject(new Error('无法启动whisper-cli：' + e.message)));
    proc.on('close', (code, signal) => {
      log.push({ args: args.join(' '), code, tail: errTail.slice(-1500) });
      if (signal || killed) return reject(new Error('已取消'));
      const file = base + '.json';
      if (code !== 0 || !fs.existsSync(file)) return reject(new Error('识别出错：' + errTail.slice(-500)));
      resolve(fs.readFileSync(file));
    });
  });
  const done = (async () => {
    let lastErr;
    for (const v of variants) {
      try {
        const raw = await runOne(v.args);
        try { fs.writeFileSync(path.join(outDir, 'whisper-log.json'), JSON.stringify({ mode: v.mode, log }, null, 2)); } catch {}
        return { raw, mode: v.mode };
      } catch (e) {
        lastErr = e;
        if (killed) throw e;
      }
    }
    try { fs.writeFileSync(path.join(outDir, 'whisper-log.json'), JSON.stringify({ log }, null, 2)); } catch {}
    throw lastErr;
  })();
  return { kill: () => { killed = true; if (proc) proc.kill('SIGTERM'); }, done };
}

/* ---------- 解析whisper的json ---------- */
// 中文一个字可能被拆进两个token，单独看每个token会是乱码。
// 所以按字节读，再把字节拼回汉字，同时记住每个字来自哪个token的时间。
function parseWhisperJson(buf) {
  let json, byteMode = true;
  try { json = JSON.parse(buf.toString('latin1')); }
  catch { json = JSON.parse(buf.toString('utf8')); byteMode = false; }
  const segs = json.transcription || [];
  const out = [];
  for (const seg of segs) {
    const s0 = (seg.offsets?.from ?? 0) / 1000, s1 = (seg.offsets?.to ?? 0) / 1000;
    const toks = (seg.tokens || []).filter(t => t.text && !/^\[_|^<\|/.test(t.text));
    // 有DTW时间戳（单位10毫秒）时，用它代替粗略的token时间
    const dtwOk = toks.length && toks.every(t => typeof t.t_dtw === 'number' && t.t_dtw >= 0);
    if (dtwOk) {
      toks.forEach((t, k) => {
        const from = t.t_dtw * 10;
        const nxt = toks[k + 1];
        const to = nxt ? Math.max(from, nxt.t_dtw * 10) : Math.max(from + 80, seg.offsets?.to ?? from + 200);
        t.offsets = { from, to: Math.min(to, from + 1500) };
      });
      out.dtw = true;
    }
    const chars = [];
    if (toks.length) {
      const anyWide = toks.some(t => /[^\x00-\xff]/.test(t.text));
      if (byteMode && !anyWide) bytesToChars(toks, chars);
      else for (const t of toks) spreadChars([...t.text], t.offsets.from / 1000, t.offsets.to / 1000, chars);
    } else {
      const text = byteMode ? Buffer.from(seg.text || '', 'latin1').toString('utf8') : seg.text || '';
      spreadChars([...text], s0, s1, chars);
    }
    out.push({ start: s0, end: s1, chars });
  }
  return out;
}

function utf8Len(b) {
  if (b < 0x80) return 1;
  if (b >= 0xf0) return 4;
  if (b >= 0xe0) return 3;
  if (b >= 0xc0) return 2;
  return 0; // 续字节
}

function bytesToChars(toks, chars) {
  let pending = [], pendTok = null;
  for (const t of toks) {
    const t0 = t.offsets.from / 1000, t1 = Math.max(t.offsets.to / 1000, t0);
    const bytes = Buffer.from(t.text, 'latin1');
    const started = []; // 本token里开头的字
    for (const b of bytes) {
      if (pending.length === 0) {
        if (utf8Len(b) === 0) continue; // 孤立的续字节，丢掉
        pending = [b];
        pendTok = started;
      } else pending.push(b);
      if (pending.length >= utf8Len(pending[0])) {
        const ch = Buffer.from(pending).toString('utf8');
        if (pendTok === started) started.push({ ch });
        else { pendTok.push({ ch }); } // 跨token的字归到它开始的那个token
        pending = [];
      }
    }
    t._started = started;
    t._t0 = t0; t._t1 = t1;
  }
  for (const t of toks) spreadChars(t._started.map(c => c.ch), t._t0, t._t1, chars);
}

function spreadChars(list, t0, t1, chars) {
  const n = list.length;
  list.forEach((ch, i) => {
    chars.push({ ch, t0: t0 + ((t1 - t0) * i) / n, t1: t0 + ((t1 - t0) * (i + 1)) / n });
  });
}

/* ---------- 切成字幕行 ---------- */
// 思路：先按标点和明显停顿切成短语，再在短语里按“词”找最自然的断点。
// 断点打分参考语气词（啊呢吧）、句首词（但是、其实、这是）和停顿，绝不把一个词拆开。
const KEEP_END = new Set('？！?!'.split(''));
const PARTICLES = '啊呢吧吗呀啦哦嘛哈呗噢哟';
const INTERJ = new Set(['嗯', '哎', '哎呀', '诶', 'OK', 'ok', 'Ok', '好', '好的', '对', '嗯嗯', '行', '那么']);
const STARTERS = new Set(['但是', '可是', '所以', '因为', '然后', '其实', '而且', '如果', '虽然', '不过', '就是', '那么', '另外', '首先', '其次', '最后', '比如', '我们', '你们', '大家', '这个', '这是', '那个', '这些', '那些', '哎呀', '哎', '嗯', 'OK', '好', '再', '还有', '包括', '因此', '只是', '甚至']);
const NO_AFTER = new Set('这那是在把被给对很都也还又就才不没第每各从向和与跟比让'.split(''));
const NO_BEFORE = new Set('的了着过么们得地个'.split(''));
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;

function buildCues(segs, vad, duration) {
  const lines = [];
  for (const sg of segs) {
    let cur = [], soft = false;
    const flush = () => { if (cur.length) lines.push(...semanticSplit(cur)); cur = []; };
    for (const c of sg.chars) {
      if (KEEP_END.has(c.ch)) { if (cur.length) { cur.push({ ...c, ch: /[?？]/.test(c.ch) ? '？' : '！', punct: true }); } flush(); soft = false; continue; }
      if (HARD_PUNCT.has(c.ch)) { flush(); soft = false; continue; }
      if (SOFT_PUNCT.has(c.ch)) { soft = true; continue; }
      if (/\s/.test(c.ch) && !cur.length) continue;
      const prev = cur[cur.length - 1];
      if (prev && c.t0 - prev.t1 > GAP_BREAK) { flush(); soft = false; }
      cur.push(soft && cur.length ? { ...c, softBreak: true } : c);
      soft = false;
    }
    flush();
  }

  let cues = lines
    .map(l => ({ text: l.map(c => c.ch).join('').replace(/\s+/g, ' ').trim(), start: l[0].t0, end: l[l.length - 1].t1 }))
    .filter(c => c.text && !/^[\s\p{P}]*$/u.test(c.text))
    .sort((a, b) => a.start - b.start);

  if (vad) require('./align').snapCues(cues, vad);
  // 字幕在话说完后多停留一小会儿，读起来更舒服
  cues.forEach(c => { c.end += 0.2; });

  // 整理：不重叠、不太短、小空隙补齐避免字幕闪烁
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i], next = cues[i + 1];
    c.start = Math.max(0, c.start);
    if (c.end - c.start < 0.4) c.end = c.start + 0.4;
    if (next) {
      if (c.end > next.start) c.end = Math.max(c.start + 0.2, next.start);
      if (next.start - c.end < 0.3) c.end = next.start;
    }
    if (duration) c.end = Math.min(c.end, duration);
    c.start = Math.round(c.start * 1000) / 1000;
    c.end = Math.round(c.end * 1000) / 1000;
  }
  return cues.filter(c => c.end > c.start).map((c, i) => ({ id: 's' + Date.now().toString(36) + i, ...c }));
}

const visLen = arr => arr.filter(c => !/\s/.test(c.ch) && !c.punct).length;

// 行长度的代价：9字左右最舒服，超过16字不允许，太短的碎句要扣分
function lineCost(n) {
  if (n > MAX_CHARS) return Infinity;
  return 2.2 + (n <= 2 ? 5 : n === 3 ? 1.2 : n === 4 ? 0.5 : 0) + (n > 9 ? 0.35 : 0.2) * Math.abs(n - 9);
}

function semanticSplit(chars) {
  chars = trimSpaces(chars);
  if (!chars.length) return [];
  const text = chars.map(c => c.ch).join('');
  // 每个字在字符串里的位置，用来把“词”的边界映射回字
  const pos = [];
  let off = 0;
  for (const c of chars) { pos.push(off); off += c.ch.length; }
  const idxAt = new Map(pos.map((p, i) => [p, i]));
  const words = [];
  if (seg) for (const w of seg.segment(text)) words.push({ i: idxAt.get(w.index), w: w.segment });
  else chars.forEach((c, i) => words.push({ i, w: c.ch }));
  // 可断点：每个词的开头（第一个词除外）
  const cand = new Map(); // 字的下标 -> 断点得分
  for (let k = 1; k < words.length; k++) {
    const i = words[k].i;
    if (i === undefined || i <= 0) continue;
    const prevW = words[k - 1].w.trim(), nextW = words[k].w.trim();
    if (!nextW) continue;
    let sc = 0;
    const gap = chars[i].t0 - chars[i - 1].t1;
    sc += Math.min(4, Math.max(0, gap) * 10);
    const last = prevW.slice(-1);
    if (PARTICLES.includes(last)) sc += 3;
    if (last === '了') sc += 1.8;
    if (INTERJ.has(prevW)) sc += 2;
    if (STARTERS.has(nextW)) sc += 1.5;
    else if (nextW === '我' || nextW === '你' || nextW === '这' || nextW === '那') sc += 0.8;
    if (chars[i].softBreak) sc += 3.5;                    // 原文这里有逗号
    if (/(怎么|怎样|如何|为了|开始|正在|可以|应该|需要|能够)$/.test(prevW) && !chars[i].softBreak) sc -= 3; // 后面通常紧跟动作，不拆
    if (prevW.length === 1 && NO_AFTER.has(prevW)) sc -= 4;
    if (NO_BEFORE.has(nextW[0]) && !PARTICLES.includes(last)) sc -= 4;
    if (PARTICLES.includes(nextW[0])) sc -= 5;              // 语气词跟着前一句走
    if (/(什么|怎么|为什么|多少|哪里|是不是|对不对|好不好)$/.test(prevW)) sc += 1.5; // 问句结尾
    if (/[A-Za-z0-9]$/.test(prevW) && /^[A-Za-z0-9]/.test(nextW)) sc -= 3;
    cand.set(i, sc);
  }
  chars.forEach((c, i) => { if (i > 0 && c.softBreak && !cand.has(i)) cand.set(i, 3.5); });
  // 动态规划：选一组断点，让总代价最小
  const n = chars.length;
  const points = [0, ...[...cand.keys()].sort((a, b) => a - b), n];
  const best = new Map([[0, { cost: 0, prev: -1 }]]);
  for (const j of points.slice(1)) {
    let bc = Infinity, bp = -1;
    for (const i of points) {
      if (i >= j) break;
      const b = best.get(i);
      if (!b || b.cost === Infinity) continue;
      const lc = lineCost(visLen(chars.slice(i, j)));
      if (lc === Infinity) continue;
      const c = b.cost + lc - (i > 0 ? cand.get(i) : 0);
      if (c < bc) { bc = c; bp = i; }
    }
    best.set(j, { cost: bc, prev: bp });
  }
  if (best.get(n).cost === Infinity) return splitLong(chars); // 找不到合适断点时兜底
  const cuts = [];
  for (let j = n; j > 0; j = best.get(j).prev) cuts.unshift(j);
  const out = [];
  let a = 0;
  for (const j of cuts) { out.push(trimSpaces(chars.slice(a, j))); a = j; }
  return out.filter(l => l.length);
}

// 兜底：超过16字的行平均拆开，尽量不拆开英文单词
function splitLong(chars) {
  const n = visLen(chars);
  if (n <= MAX_CHARS) return [trimSpaces(chars)];
  const parts = Math.ceil(n / MAX_CHARS);
  const size = Math.ceil(chars.length / parts);
  const out = [];
  let i = 0;
  while (i < chars.length) {
    let j = Math.min(chars.length, i + size);
    while (j < chars.length && j > i + 1 && /[A-Za-z0-9]/.test(chars[j - 1].ch) && /[A-Za-z0-9]/.test(chars[j].ch)) j--;
    out.push(trimSpaces(chars.slice(i, j)));
    i = j;
  }
  return out.filter(l => l.length);
}
function trimSpaces(l) {
  let a = 0, b = l.length;
  while (a < b && /\s/.test(l[a].ch)) a++;
  while (b > a && /\s/.test(l[b - 1].ch)) b--;
  return l.slice(a, b);
}

// 剪映字幕导入：保留剪映的时间，只把超过16字的长句按语义拆开，句尾的逗号句号去掉
function cuesFromSrt(items, duration) {
  const out = [];
  items.forEach((it, k) => {
    let text = it.text.replace(/[，。,.、；;：:]+$/, '').trim();
    if (!text) return;
    const chars = [...text];
    const n = chars.filter(c => !/\s/.test(c)).length;
    if (n <= MAX_CHARS) { out.push({ text, start: it.start, end: it.end }); return; }
    // 长句：字均匀分布在这句的时间里，再按语义拆
    const per = (it.end - it.start) / chars.length;
    const cs = chars.map((ch, i) => ({ ch, t0: it.start + per * i, t1: it.start + per * (i + 1) }));
    for (const l of semanticSplit(cs.filter(c => !/[，,、；;：:]/.test(c.ch) || false))) {
      out.push({ text: l.map(c => c.ch).join('').trim(), start: l[0].t0, end: l[l.length - 1].t1 });
    }
  });
  const stamp = Date.now().toString(36);
  return out
    .map((c, i) => ({ id: 's' + stamp + i, text: c.text, start: Math.max(0, Math.round(c.start * 1000) / 1000), end: Math.round(Math.min(c.end, duration || c.end) * 1000) / 1000 }))
    .filter(c => c.end > c.start);
}

module.exports = { transcribe, parseWhisperJson, buildCues, findWhisper, findModel, findVadModel, cuesFromSrt };

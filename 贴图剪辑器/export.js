// 导出成片：视频＋表情包＋字幕 → 1080P60 MP4
// 字幕：界面用和预览完全相同的画法，逐句画成透明PNG，这里按时间拼成一条“字幕层”叠上去，保证所见即所得
// 表情包：按图层从下到上依次叠加；图片、GIF、视频都只在自己的时间段内解码，速度快
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const media = require('./media');

const q = p => p.replace(/'/g, "'\\''");
const even = n => Math.max(2, Math.round(n / 2) * 2);
const f3 = n => (Math.round(n * 1000) / 1000).toFixed(3);

// subs：[{file, start, end}]（PNG都是整幅画面大小）；blank：透明整幅PNG
function writeSubConcat(tmpDir, subs, blank, total) {
  const lines = ['ffconcat version 1.0'];
  let t = 0;
  const add = (file, dur) => { if (dur > 0.0005) { lines.push(`file '${q(file)}'`, `duration ${f3(dur)}`); } };
  for (const s of subs) {
    const st = Math.max(0, Math.min(total, s.start)), en = Math.max(0, Math.min(total, s.end));
    if (en <= t + 0.0005) continue;
    if (st > t) { add(blank, st - t); t = st; }
    add(s.file, en - t);
    t = en;
  }
  if (t < total) add(blank, total - t);
  lines.push(`file '${q(blank)}'`); // 最后一项要重复一次，前面的时长才会生效
  const list = path.join(tmpDir, 'subs.ffconcat');
  fs.writeFileSync(list, lines.join('\n') + '\n');
  return list;
}

/*
 opts: {
   project, dir（项目文件夹）, out（输出文件）, quality: 'high'|'fast',
   range: {start, end}（秒，原视频时间）, subs: [{file,start,end}], blank,
 }
*/
// 编码方案：
//  h264：x264慢速预设＋CRF18，肉眼无损，静止画面多的录屏体积很小，所有平台都能播
//  hevc：Mac硬件H.265，同样画质体积再小一截，速度很快（抖音、B站、小红书都支持）
//  fast：Mac硬件H.264，最快，体积稍大
function encArgs(mode, fallback) {
  if (mode === 'hevc') return ['-c:v', 'hevc_videotoolbox', ...(fallback ? ['-b:v', '10M'] : ['-q:v', '58']), '-tag:v', 'hvc1', '-profile:v', 'main'];
  if (mode === 'fast') return ['-c:v', 'h264_videotoolbox', ...(fallback ? ['-b:v', '16M'] : ['-q:v', '62']), '-profile:v', 'high'];
  return ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high'];
}

function buildArgs(opts) {
  const { project: p, dir, out, quality, range } = opts;
  const { w: W, h: H } = p.canvas;
  const fps = p.canvas.fps || 60;
  const T0 = range.start, D = range.end - range.start;
  const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1'];
  const isAudio = p.video.kind === 'audio';
  // 0：原视频或录音（声音从这里来）
  // 画面不用时（录音、或视频轨关了眼睛）加-vn：只读声音，不碰视频画面，导出更省电
  const noPic = isAudio || p.hideVideo;
  args.push('-ss', f3(T0), '-t', f3(D), ...(noPic ? ['-vn'] : []), '-i', p.video.path);
  // 1：黑色底板
  args.push('-f', 'lavfi', '-t', f3(D), '-i', `color=c=black:s=${W}x${H}:r=${fps}`);
  let n = 2;
  const filters = [];
  filters.push(`[1:v]format=yuv420p,setsar=1[base]`);
  let cur = 'base';

  // 背景：每一段是一个循环视频（纯色是一张图），只在自己的时间段出现
  const emitBg = b => {
    const st = Math.max(0, b.start - T0), en = Math.min(D, b.end - T0);
    const len = en - st;
    if (len <= 0.01) return;
    if (b.L > 0) {
      const skip = (Math.max(0, T0 - b.start)) % b.L;
      args.push('-stream_loop', '-1', '-ss', f3(skip), '-t', f3(len), '-i', b.file);
    } else {
      args.push('-loop', '1', '-framerate', String(fps), '-t', f3(len), '-i', b.file);
    }
    filters.push(`[${n}:v]fps=${fps},format=yuv420p,setpts=PTS-STARTPTS+${f3(st)}/TB[b${n}]`);
    filters.push(`[${cur}][b${n}]overlay=0:0:eof_action=pass:enable='between(t,${f3(st)},${f3(en - 0.0001)})'[v${n}]`);
    cur = `v${n}`;
    n++;
  };

  // 视频画面：等比缩放放在正中间（竖版画布里放横版视频时，上下露出的是背景）
  const emitVideo = () => {
    filters.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1,fps=${fps},format=yuv420p[mv]`);
    filters.push(`[${cur}][mv]overlay=(W-w)/2:(H-h)/2:eof_action=pass[vm]`);
    cur = 'vm';
  };

  // 表情包：按图层从下往上叠
  const stickers = p.stickers
    .map((s, i) => ({ ...s, _i: i }))
    .filter(s => s.end > T0 && s.start < range.end)
    .sort((a, b) => (a.layer || 0) - (b.layer || 0) || a._i - b._i);
  const audioParts = []; // 打开了声音的视频素材
  const emitSticker = s => {
    const st = Math.max(0, s.start - T0), en = Math.min(D, s.end - T0);
    const len = en - st;
    if (len <= 0.01) return;
    // 文本：界面已经画成PNG（textFile）；估算时没有就跳过
    if (s.type === 'text' && !s.textFile) return;
    const file = s.type === 'text' ? s.textFile : path.join(dir, 'assets', s.file);
    // 片段在范围开头被截掉时，GIF和视频要从对应的位置开始播
    const skip = Math.max(0, T0 - s.start) + (s.type === 'video' ? (s.inPt || 0) : 0); // 视频还要加上剪掉的开头
    const withSound = s.type === 'video' && s.sound && s.hasAudio;
    if (s.type === 'image' || s.type === 'text') args.push('-loop', '1', '-framerate', String(fps), '-t', f3(len), '-i', file);
    else if (s.type === 'gif') args.push('-ignore_loop', '0', '-ss', f3(skip), '-t', f3(len), '-i', file);
    else args.push('-stream_loop', '-1', '-ss', f3(skip), '-t', f3(len), ...(withSound ? [] : ['-an']), '-i', file);
    const vi = n++;
    if (s.tierAnim) return emitTier(s, vi, st, en);
    // 裁切（原图像素）→ 缩放到显示大小 → 翻转 → 圆形／圆角遮罩 → 旋转
    const c = s.crop || { x: 0, y: 0, w: 1, h: 1 };
    const dw = even(s.w * c.w * s.scale), dh = even(s.h * c.h * s.scale);
    const f = [];
    if (s.crop) {
      const cw = Math.max(2, Math.min(s.w, Math.round(s.w * c.w))), ch = Math.max(2, Math.min(s.h, Math.round(s.h * c.h)));
      const cx = Math.min(s.w - cw, Math.max(0, Math.round(s.w * c.x))), cy = Math.min(s.h - ch, Math.max(0, Math.round(s.h * c.y)));
      f.push(`crop=${cw}:${ch}:${cx}:${cy}`);
    }
    f.push(`scale=${dw}:${dh}:flags=lanczos`);
    if (s.flip) f.push('hflip');
    f.push('format=rgba', `fps=${fps}`);
    let lab = `k${vi}`;
    filters.push(`[${vi}:v]${f.join(',')}[${lab}]`);
    if (s.mask) {
      args.push('-loop', '1', '-framerate', String(fps), '-t', f3(len), '-i', s.mask);
      const mi = n++;
      // 素材本身的透明度 × 遮罩形状，GIF、PNG原来透明的地方仍然透明
      filters.push(`[${lab}]split[${lab}a][${lab}b]`, `[${lab}b]alphaextract[${lab}al]`, `[${mi}:v]format=gray,scale=${dw}:${dh}[${lab}m]`,
        `[${lab}al][${lab}m]blend=all_mode=multiply:shortest=1[${lab}am]`, `[${lab}a][${lab}am]alphamerge[${lab}s]`);
      lab = `${lab}s`;
    }
    let ow = dw, oh = dh;
    if (s.rot) {
      const rad = (s.rot * Math.PI) / 180;
      ow = even(Math.abs(dw * Math.cos(rad)) + Math.abs(dh * Math.sin(rad)) + 2);
      oh = even(Math.abs(dw * Math.sin(rad)) + Math.abs(dh * Math.cos(rad)) + 2);
      filters.push(`[${lab}]rotate=${rad.toFixed(6)}:ow=${ow}:oh=${oh}:c=none[${lab}r]`);
      lab = `${lab}r`;
    }
    filters.push(`[${lab}]setpts=PTS-STARTPTS+${f3(st)}/TB[${lab}t]`);
    const x = Math.round(s.x - ow / 2), y = Math.round(s.y - oh / 2);
    filters.push(`[${cur}][${lab}t]overlay=x=${x}:y=${y}:eof_action=pass:enable='between(t,${f3(st)},${f3(en - 0.0001)})'[v${vi}]`);
    cur = `v${vi}`;
    if (withSound) {
      const ms = Math.round(st * 1000);
      filters.push(`[${vi}:a]asetpts=PTS-STARTPTS,volume=${(s.volume ?? 1).toFixed(2)},adelay=delays=${ms}:all=1[sa${vi}]`);
      audioParts.push(`[sa${vi}]`);
    }
  };

  // 从夯到拉的图片：大小和位置跟着时间变（scale、overlay 每帧重新算）
  // 出现：正中央，0.2秒淡入、从92%放大到100%；飞过去：从中央到档位里的位置，同时缩小
  const emitTier = (s, vi, st, en) => {
    const A = s.tierAnim, g = v => v.toFixed(3);
    const show = A.show - T0;
    const a = `clip((t-(${g(show)}))/${g(A.appear)},0,1)`;
    const k = `(0.92+0.08*${a})`;
    const cw = `(${g(A.C.w)}*${k})`, ccx = A.C.x + A.C.w / 2, ccy = A.C.y + A.C.h / 2;
    let W = cw, X = g(ccx), Y = g(ccy);
    if (A.R && A.mv != null) {
      const P = `clip((t-(${g(A.mv - T0)}))/${g(A.dur)},0,1)`;
      const e = A.anim === 'linear' ? P : `if(lt(${P},0.5),2*pow(${P},2),1-pow(2-2*${P},2)/2)`;
      W = `(${cw}+(${g(A.R.w)}-${cw})*${e})`;
      X = `(${g(ccx)}+(${g(A.R.x + A.R.w / 2 - ccx)})*${e})`;
      Y = `(${g(ccy)}+(${g(A.R.y + A.R.h / 2 - ccy)})*${e})`;
    }
    const lab = `k${vi}`;
    const f = [`setpts=PTS-STARTPTS+${f3(st)}/TB`, `fps=${fps}`, 'format=rgba', `scale=w='max(2,${W})':h=-2:eval=frame:flags=bicubic`];
    if (show >= 0) f.push(`fade=t=in:st=${f3(show)}:d=${g(A.appear)}:alpha=1`);
    filters.push(`[${vi}:v]${f.join(',')}[${lab}]`);
    filters.push(`[${cur}][${lab}]overlay=x='${X}-overlay_w/2':y='${Y}-overlay_h/2':eval=frame:eof_action=pass:enable='between(t,${f3(st)},${f3(en - 0.0001)})'[v${vi}]`);
    cur = `v${vi}`;
  };

  // 按轨道从下往上叠：背景段、原视频、表情包谁在上面由轨道顺序决定（同一层时背景＜视频＜表情包）
  const layers = [];
  for (const b of (opts.bgLoops || [])) layers.push({ layer: b.layer ?? -1, k: 0, go: () => emitBg(b) });
  if (!isAudio && !p.hideVideo) layers.push({ layer: p.video.layer ?? 0, k: 1, go: emitVideo });
  stickers.forEach((s, i) => layers.push({ layer: s.layer || 0, k: 2 + i / 1e6, go: () => emitSticker(s) }));
  layers.sort((a, b) => a.layer - b.layer || a.k - b.k);
  for (const L of layers) L.go();

  // 字幕层：放在最上面
  if (opts.subList) {
    args.push('-f', 'concat', '-safe', '0', '-i', opts.subList);
    filters.push(`[${n}:v]format=rgba,setpts=PTS-STARTPTS[subs]`);
    filters.push(`[${cur}][subs]overlay=0:0:eof_action=pass:format=auto[vs]`);
    cur = 'vs';
    n++;
  }
  filters.push(`[${cur}]format=yuv420p[vout]`);

  // 声音：有视频素材打开了声音，就和原声混在一起（不压低原声）；否则原声直接拷贝
  const mainA = p.video.audioCodec && !p.muteMain; // 母体视频所在轨道静音了就不要它的声音
  if (audioParts.length) {
    const ins = (mainA ? ['[0:a]'] : []).concat(audioParts);
    filters.push(ins.length > 1
      ? `${ins.join('')}amix=inputs=${ins.length}:normalize=0:duration=${mainA ? 'first' : 'longest'}:dropout_transition=0[aout]`
      : `${ins[0]}apad,atrim=0:${f3(D)}[aout]`);
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  if (audioParts.length) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '320k');
  else if (mainA) {
    args.push('-map', '0:a:0?');
    if (p.video.audioCodec === 'aac') args.push('-c:a', 'copy');
    else args.push('-c:a', 'aac', '-b:a', '320k');
  }
  args.push(...encArgs(quality, opts.fallback));
  args.push('-r', String(fps), '-pix_fmt', 'yuv420p', '-t', f3(D), '-movflags', '+faststart', out);
  return args;
}

// 运行导出；onProgress(0到1)
function runOnce(opts, onProgress) {
  const args = buildArgs(opts);
  const D = opts.range.end - opts.range.start;
  const proc = spawn(media.findBin('ffmpeg'), args);
  let err = '';
  const job = { args, killed: false, kill: () => { job.killed = true; proc.kill('SIGTERM'); } };
  proc.stdout.on('data', d => {
    const m = String(d).match(/out_time_(?:us|ms)=(\d+)/g);
    if (m) onProgress(Math.min(0.999, Number(m[m.length - 1].split('=')[1]) / 1e6 / D));
  });
  proc.stderr.on('data', d => { err = (err + d).slice(-4000); });
  job.done = new Promise((resolve, reject) => {
    proc.on('error', e => reject(new Error('无法启动FFmpeg：' + e.message)));
    proc.on('close', code => {
      if (job.killed) return reject(new Error('已取消'));
      if (code !== 0) return reject(new Error('导出出错：' + err.slice(-800)));
      onProgress(1);
      resolve(opts.out);
    });
  });
  return job;
}
function run(opts, onProgress) {
  let cur = runOnce(opts, onProgress);
  const outer = { args: cur.args, kill: () => cur.kill() };
  outer.done = cur.done.catch(e => {
    if (cur.killed || opts.quality === 'h264') throw e;
    cur = runOnce({ ...opts, fallback: true }, onProgress);
    outer.args = cur.args;
    return cur.done;
  });
  return outer;
}

// 估算用的FFmpeg：开始正式导出或重新估算时，把还在跑的估算停掉，免得几个FFmpeg抢CPU
const estProcs = new Set();
function cancelEstimates() { for (const p of estProcs) { p.cancelled = true; try { p.kill('SIGKILL'); } catch {} } estProcs.clear(); }
function runEst(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(media.findBin('ffmpeg'), args);
    estProcs.add(p);
    let err = '';
    p.stderr.on('data', d => { err = (err + d).slice(-600); });
    p.on('error', e => { estProcs.delete(p); reject(e); });
    p.on('close', code => {
      estProcs.delete(p);
      if (p.cancelled) { const e = new Error('估算已取消'); e.cancelled = true; return reject(e); }
      code === 0 ? resolve() : reject(new Error('ffmpeg出错：' + err));
    });
  });
}

// 估算：取两小段（各2秒），用和正式导出完全一样的画面合成和编码设置试做，再按时长推算大小和用时
async function estimate(opts) {
  const { project: p, range } = opts;
  const D = range.end - range.start;
  const len = Math.min(2, D);
  const points = D > 6 ? [0.3, 0.7] : [0];
  let bytes = 0, secs = 0, wall = 0;
  for (const k of points) {
    const st = range.start + (D - len) * k;
    const tmp = path.join(opts.tmpDir, `est_${Math.round(k * 100)}.mp4`);
    const one = fb => buildArgs({ ...opts, range: { start: st, end: st + len }, out: tmp, subList: null, fallback: fb })
      .filter((x, i, arr) => x !== '-progress' && arr[i - 1] !== '-progress');
    const t0 = Date.now();
    try { await runEst(one(false)); }
    catch (e) { if (opts.quality === 'h264' || e.cancelled) throw e; await runEst(one(true)); }
    wall += (Date.now() - t0) / 1000;
    bytes += fs.statSync(tmp).size;
    secs += len;
    try { fs.unlinkSync(tmp); } catch {}
  }
  const size = (bytes / secs) * D * 1.03; // 字幕会多一点点
  const time = (wall / secs) * D * 1.15 + 2;
  return { size, time };
}

// 背景循环视频：界面把每一帧画好传过来，这里交给FFmpeg编成一小段可以无缝循环的视频
// 每个文件同时只允许一个生成任务；先写到临时文件，完整生成后才改名，坏文件不会进缓存
const bgJobs = new Map();
function bgBegin(file, fps) {
  const old = bgJobs.get(file);
  if (old) { old.aborted = true; try { old.proc.kill('SIGKILL'); } catch {} }
  const tmp = `${file}.${process.pid}-${Date.now()}.part.mp4`;
  const proc = spawn(media.findBin('ffmpeg'), ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', tmp]);
  let err = '';
  const job = { proc, aborted: false, closed: false, frames: 0 };
  proc.stderr.on('data', d => { err = (err + d).slice(-2000); });
  proc.stdin.on('error', () => {}); // 进程提前退出时写管道会报错，结果由下面的close统一处理
  job.done = new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', code => {
      job.closed = true;
      if (job.aborted) { try { fs.unlinkSync(tmp); } catch {} return reject(new Error('背景生成已取消')); }
      if (code !== 0) { try { fs.unlinkSync(tmp); } catch {} return reject(new Error('背景生成失败：' + err)); }
      fs.renameSync(tmp, file);
      resolve(file);
    });
  });
  job.done.catch(() => {});
  bgJobs.set(file, job);
}
function bgFrame(file, bytes) {
  const j = bgJobs.get(file);
  if (!j || j.closed) return Promise.reject(new Error('背景生成中断了，请重新导出'));
  j.frames++;
  return new Promise((resolve, reject) => {
    if (j.proc.stdin.write(Buffer.from(bytes))) return resolve();
    // 等管道腾出空间；万一FFmpeg中途退出也要有回应，不然界面会一直等
    const ok = () => { j.proc.off('close', bad); resolve(); };
    const bad = () => { j.proc.stdin.off('drain', ok); reject(new Error('背景生成中断了，请重新导出')); };
    j.proc.stdin.once('drain', ok);
    j.proc.once('close', bad);
  });
}
async function bgEnd(file, abort) {
  const j = bgJobs.get(file);
  if (!j) return null;
  if (abort) { j.aborted = true; try { j.proc.kill('SIGKILL'); } catch {} }
  else j.proc.stdin.end();
  try { return await j.done; } finally { if (bgJobs.get(file) === j) bgJobs.delete(file); }
}

module.exports = { run, buildArgs, writeSubConcat, estimate, cancelEstimates, bgBegin, bgFrame, bgEnd };

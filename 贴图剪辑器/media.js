// 媒体处理：查找FFmpeg、读取视频信息、抽取音频、计算波形
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CANDIDATES = {
  ffmpeg: ['/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'],
  ffprobe: ['/opt/homebrew/opt/ffmpeg-full/bin/ffprobe', '/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'],
};

function findBin(name) {
  for (const p of CANDIDATES[name]) if (fs.existsSync(p)) return p;
  return name; // 退回系统路径
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(findBin(bin), args);
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', e => reject(new Error(`无法启动${bin}：${e.message}`)));
    p.on('close', code => (code === 0 ? resolve(out) : reject(new Error(`${bin}出错（${code}）：${err.slice(-600)}`))));
  });
}

function parseRate(r) {
  if (!r) return 0;
  const [a, b] = r.split('/').map(Number);
  return b ? a / b : a;
}

async function probe(file) {
  const json = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]));
  const v = json.streams.find(s => s.codec_type === 'video');
  const a = json.streams.find(s => s.codec_type === 'audio');
  // 纯音频（杂谈录音）：没有画面，画面由背景来出
  if (!v || /^(mp3|png|mjpeg)$/.test(v.codec_name) && a && (json.streams.length <= 2) && Number(json.format.duration) > 0 && (v.disposition?.attached_pic)) {
    if (!a) throw new Error('这个文件里既没有画面也没有声音');
    return {
      kind: 'audio',
      duration: Number(json.format.duration || a.duration || 0),
      width: 0, height: 0, fps: 0,
      videoCodec: null,
      audioCodec: a.codec_name,
      audioBitrate: Number(a.bit_rate || json.format.bit_rate || 0),
    };
  }
  let w = v.width, h = v.height;
  // 手机竖拍视频可能带旋转信息
  const rot = Math.abs(Number(v.tags?.rotate || v.side_data_list?.find(d => d.rotation !== undefined)?.rotation || 0));
  if (rot === 90 || rot === 270) [w, h] = [h, w];
  return {
    duration: Number(json.format.duration || v.duration || 0),
    width: w,
    height: h,
    fps: parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate),
    videoCodec: v.codec_name,
    audioCodec: a ? a.codec_name : null,
    audioBitrate: a ? Number(a.bit_rate || 0) : 0,
    kind: 'video',
  };
}

// 抽出单声道16kHz音频（同时给Whisper用），并计算每秒100个点的波形峰值
async function extractAudio(file, projectDir) {
  const wav = path.join(projectDir, 'audio.wav');
  await run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  const peaks = computePeaks(wav, 100);
  fs.writeFileSync(path.join(projectDir, 'peaks.bin'), Buffer.from(peaks));
  return { wav, peaks };
}

function computePeaks(wavPath, perSecond) {
  const buf = fs.readFileSync(wavPath);
  // 找到data块（跳过LIST等其他块）
  let pos = 12, dataStart = -1, dataLen = 0, rate = 16000;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') rate = buf.readUInt32LE(pos + 12);
    if (id === 'data') { dataStart = pos + 8; dataLen = Math.min(size, buf.length - dataStart); break; }
    pos += 8 + size + (size % 2);
  }
  if (dataStart < 0) return new Uint8Array(0);
  const samples = Math.floor(dataLen / 2);
  const bucket = Math.max(1, Math.round(rate / perSecond));
  const n = Math.ceil(samples / bucket);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let max = 0;
    const end = Math.min(samples, (i + 1) * bucket);
    for (let s = i * bucket; s < end; s++) {
      const v = Math.abs(buf.readInt16LE(dataStart + s * 2));
      if (v > max) max = v;
    }
    out[i] = Math.min(255, Math.round((max / 32768) * 255));
  }
  return out;
}

module.exports = { findBin, run, probe, extractAudio, computePeaks };

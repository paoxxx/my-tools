// 读取剪映导出的SRT字幕
const fs = require('fs');
const path = require('path');

function toSec(t) {
  const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0').slice(0, 3)) / 1000;
}

function parseSrt(file) {
  let txt = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const out = [];
  for (const block of txt.split(/\n\s*\n/)) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const ti = lines.findIndex(l => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const start = toSec(a), end = toSec(b);
    const text = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    if (!text || !(end > start)) continue;
    out.push({ start, end, text });
  }
  return out.sort((x, y) => x.start - y.start);
}

// 视频旁边有同名的.srt就找出来
function findSiblingSrt(videoPath) {
  const dir = path.dirname(videoPath), base = path.basename(videoPath, path.extname(videoPath));
  try {
    const f = fs.readdirSync(dir).find(x => x.toLowerCase() === (base + '.srt').toLowerCase());
    return f ? path.join(dir, f) : null;
  } catch { return null; }
}

module.exports = { parseSrt, findSiblingSrt };

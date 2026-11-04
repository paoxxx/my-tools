// 表情包素材：复制进项目、读尺寸时长、从剪贴板取图
const fs = require('fs');
const path = require('path');
const { clipboard } = require('electron');
const media = require('./media');

const IMG_EXT = /\.(png|jpe?g|webp|bmp|heic)$/i;
const GIF_EXT = /\.gif$/i;
const VID_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const isMedia = p => IMG_EXT.test(p) || GIF_EXT.test(p) || VID_EXT.test(p);

function uniqueName(dir, base) {
  const ext = path.extname(base);
  const stem = path.basename(base, ext).replace(/[\\/:*?"<>|#%]/g, '_').slice(0, 40) || 'sticker';
  let name = stem + ext, i = 1;
  while (fs.existsSync(path.join(dir, name))) name = `${stem}-${i++}${ext}`;
  return name;
}

async function describe(file) {
  const type = GIF_EXT.test(file) ? 'gif' : VID_EXT.test(file) ? 'video' : 'image';
  const json = JSON.parse(await media.run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]));
  const v = (json.streams || []).find(s => s.codec_type === 'video');
  if (!v) throw new Error('读不出这个文件的画面');
  let w = v.width, h = v.height;
  const rot = Math.abs(Number(v.tags?.rotate || v.side_data_list?.find(d => d.rotation !== undefined)?.rotation || 0));
  if (rot === 90 || rot === 270) [w, h] = [h, w];
  const duration = type === 'image' ? 0 : Number(json.format?.duration || v.duration || 0);
  const hasAudio = type === 'video' && (json.streams || []).some(s => s.codec_type === 'audio');
  return { type, w, h, duration, hasAudio };
}

// 把外部文件复制进项目的assets文件夹
async function importFile(projectDir, src) {
  if (!isMedia(src)) throw new Error('只支持图片、GIF和视频：' + path.basename(src));
  const dir = path.join(projectDir, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const name = uniqueName(dir, path.basename(src));
  await fs.promises.copyFile(src, path.join(dir, name)); // 异步复制，大视频不卡界面
  return { file: name, name: path.basename(src), src, ...(await describe(path.join(dir, name))) };
}

// 把渲染进程传来的图片数据存成文件（粘贴截图、GIF时用）
async function saveBytes(projectDir, name, bytes) {
  const dir = path.join(projectDir, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const fname = uniqueName(dir, name);
  fs.writeFileSync(path.join(dir, fname), Buffer.from(bytes));
  return { file: fname, name, ...(await describe(path.join(dir, fname))) };
}

// 兜底：直接读系统剪贴板（兼容新旧两种Electron剪贴板接口）
async function importClipboard(projectDir) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  // 旧接口
  if (typeof clipboard.readImage === 'function') {
    let fileUrl = '';
    try { fileUrl = clipboard.read('public.file-url'); } catch {}
    if (fileUrl && fileUrl.startsWith('file://')) {
      const p = decodeURIComponent(fileUrl.replace(/^file:\/\//, '').split('\0')[0].trim());
      if (fs.existsSync(p) && isMedia(p)) return importFile(projectDir, p);
    }
    try {
      const gif = clipboard.readBuffer('com.compuserve.gif');
      if (gif && gif.length > 100 && gif.slice(0, 3).toString() === 'GIF') return saveBytes(projectDir, `粘贴-${stamp}.gif`, gif);
    } catch {}
    const img = clipboard.readImage();
    if (!img.isEmpty()) return saveBytes(projectDir, `粘贴-${stamp}.png`, img.toPNG());
    return { empty: true };
  }
  // 新接口（Electron 45起）
  try {
    const items = await clipboard.read();
    for (const it of items) {
      const types = it.types || [];
      const uri = types.find(t => t === 'text/uri-list');
      if (uri) {
        const blob = await it.getType(uri);
        const txt = typeof blob === 'string' ? blob : await blob.text();
        const line = txt.split(/\r?\n/).find(l => l.startsWith('file://'));
        if (line) {
          const p = decodeURIComponent(line.replace(/^file:\/\//, '').trim());
          if (fs.existsSync(p) && isMedia(p)) return importFile(projectDir, p);
        }
      }
      for (const [mime, ext] of [['image/gif', 'gif'], ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]) {
        if (types.includes(mime)) {
          const blob = await it.getType(mime);
          const buf = Buffer.from(await blob.arrayBuffer());
          if (buf.length > 100) return saveBytes(projectDir, `粘贴-${stamp}.${ext}`, buf);
        }
      }
    }
  } catch {}
  return { empty: true };
}

module.exports = { importFile, importClipboard, saveBytes, isMedia };

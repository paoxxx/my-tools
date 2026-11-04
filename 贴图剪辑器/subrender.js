// 字幕绘制：预览和导出用同一套代码，保证所见即所得
// 字体全部是SIL开源字体协议（OFL），免费可商用（得意黑、霞鹜文楷、站酷小薇、龙藏、志莽行书、刘建毛草也都是OFL）
const SUB_FONTS = [
  { id: 'noto-bold', name: '思源黑体 粗', file: 'NotoSansSC-Bold.ttf' },
  { id: 'noto-black', name: '思源黑体 特粗', file: 'NotoSansSC-Black.ttf' },
  { id: 'noto-serif', name: '思源宋体 粗', file: 'NotoSerifSC-Bold.ttf' },
  { id: 'kuaile', name: '站酷快乐体', file: 'ZCOOLKuaiLe.ttf' },
  { id: 'huangyou', name: '站酷庆科黄油体', file: 'ZCOOLQingKeHuangYou.ttf' },
  { id: 'mashan', name: '马善政毛笔', file: 'MaShanZheng.ttf' },
  { id: 'smiley', name: '得意黑', file: 'SmileySans-Oblique.woff2' },
  { id: 'lxgw', name: '霞鹜文楷', file: 'LXGWWenKai-Medium.woff2' },
  { id: 'xiaowei', name: '站酷小薇', file: 'ZCOOLXiaoWei-Regular.woff2' },
  { id: 'longcang', name: '龙藏体（手写）', file: 'LongCang-Regular.woff2' },
  { id: 'zhimang', name: '志莽行书', file: 'ZhiMangXing-Regular.woff2' },
  { id: 'maocao', name: '刘建毛草', file: 'LiuJianMaoCao-Regular.woff2' },
];

const SUB_PRESETS = [
  { name: '灰底白字', st: { color: '#FFFFFF', outline: 0, outlineColor: '#000000', box: true, boxColor: '#000000', boxOpacity: 0.45 } },
  { name: '白字黑边', st: { color: '#FFFFFF', outline: 4, outlineColor: '#000000', box: false } },
  { name: '黄字黑边', st: { color: '#FFE14D', outline: 4, outlineColor: '#000000', box: false } },
  { name: '黑字白边', st: { color: '#141414', outline: 5, outlineColor: '#FFFFFF', box: false } },
  { name: '白底黑字', st: { color: '#141414', outline: 0, outlineColor: '#FFFFFF', box: true, boxColor: '#FFFFFF', boxOpacity: 0.9 } },
];

const fontFamily = id => 'TT-' + id;
const _fontLoads = {};
function loadSubFont(id) {
  const f = SUB_FONTS.find(x => x.id === id) || SUB_FONTS[0];
  if (!_fontLoads[f.id]) {
    const face = new FontFace(fontFamily(f.id), `url("fonts/${f.file}")`);
    _fontLoads[f.id] = face.load().then(ff => { document.fonts.add(ff); return true; }).catch(() => false);
  }
  return _fontLoads[f.id];
}

function defaultSubStyle(c) {
  const base = Math.min(c.w, c.h);
  return {
    fontId: 'noto-bold',
    size: Math.round(base * 0.06),     // 字号（按成片像素，1080画面约65）
    color: '#FFFFFF',
    outline: 0,                         // 描边粗细
    outlineColor: '#000000',
    box: true,                          // 半透明背景框
    boxColor: '#000000',
    boxOpacity: 0.45,
    marginV: Math.round(c.h * (c.w > c.h ? 0.06 : 0.2)), // 离底部距离
  };
}

// 老项目的样式补齐字段
function normalizeSubStyle(st, c) {
  const d = defaultSubStyle(c);
  if (!st) return d;
  const out = { ...d, ...st };
  if (!SUB_FONTS.some(f => f.id === out.fontId)) out.fontId = 'noto-bold';
  delete out.font;
  return out;
}

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function wrapLines(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return [text];
  // 平均拆成几行，避免最后一行只剩一两个字
  const chars = [...text];
  const n = Math.ceil(ctx.measureText(text).width / maxW);
  const per = Math.ceil(chars.length / n);
  const lines = [];
  for (let i = 0; i < chars.length; i += per) lines.push(chars.slice(i, i + per).join(''));
  return lines;
}

/* ---------- 画重点（关键词样式） ---------- */
// marks：这句字幕里被画重点的字的序号（按字算，中文一个字一个，英文字母也一个）
// kw：关键词样式，全片统一。color 文字颜色；scale 字号倍数；outline 描边粗细（null＝跟随字幕）；outlineColor；bg 荧光笔底色（''＝不要）
const KW_DEFAULT = { color: '#FFE14D', scale: 1.15, outline: null, outlineColor: '#000000', bg: '' };
const KW_PRESETS = [
  { name: '黄色', kw: { color: '#FFE14D', scale: 1.15, outline: null, outlineColor: '#000000', bg: '' } },
  { name: '红色', kw: { color: '#FF4D4F', scale: 1.15, outline: null, outlineColor: '#000000', bg: '' } },
  { name: '橙色', kw: { color: '#FF9C3D', scale: 1.15, outline: null, outlineColor: '#000000', bg: '' } },
  { name: '青色', kw: { color: '#36CFC9', scale: 1.15, outline: null, outlineColor: '#000000', bg: '' } },
  { name: '粉色', kw: { color: '#FF85C0', scale: 1.15, outline: null, outlineColor: '#000000', bg: '' } },
  { name: '绿色', kw: { color: '#95DE64', scale: 1.15, outline: null, outlineColor: '#000000', bg: '' } },
  { name: '黄字黑边', kw: { color: '#FFE14D', scale: 1.2, outline: 5, outlineColor: '#000000', bg: '' } },
  { name: '红字白边', kw: { color: '#FF3B3B', scale: 1.2, outline: 5, outlineColor: '#FFFFFF', bg: '' } },
  { name: '白字红边', kw: { color: '#FFFFFF', scale: 1.2, outline: 5, outlineColor: '#E8262B', bg: '' } },
  { name: '荧光黄', kw: { color: '#141414', scale: 1.0, outline: 0, outlineColor: '#000000', bg: '#FFE14D' } },
  { name: '荧光红', kw: { color: '#FFFFFF', scale: 1.0, outline: 0, outlineColor: '#000000', bg: '#FF4D4F' } },
  { name: '荧光蓝', kw: { color: '#FFFFFF', scale: 1.0, outline: 0, outlineColor: '#000000', bg: '#2F7BFF' } },
];
const normKw = kw => ({ ...KW_DEFAULT, ...(kw || {}) });

// 把一句字幕切成“字块”：中文一个字一块，连着的英文字母／数字算一块（和剪映一样）
function subTokens(text) {
  const chars = [...text];
  const out = [];
  for (let i = 0; i < chars.length; ) {
    let j = i + 1;
    if (/[A-Za-z0-9]/.test(chars[i])) while (j < chars.length && /[A-Za-z0-9'’.-]/.test(chars[j]) && !(/[.-]/.test(chars[j]) && !/[A-Za-z0-9]/.test(chars[j + 1] || ''))) j++;
    out.push({ a: i, b: j, t: chars.slice(i, j).join('') });
    i = j;
  }
  return out;
}

// 在 W×H 的成片坐标里画一句字幕；marks、kw可选（画重点）
function drawSubtitle(ctx, text, st, W, H, marks, kw) {
  if (!text) return;
  const size = st.size;
  const K = normKw(kw);
  const chars = [...text];
  const mk = new Set(marks && marks.length ? marks : []);
  const hasKw = mk.size > 0;
  const fontOf = big => `${big ? Math.round(size * K.scale) : size}px "${fontFamily(st.fontId)}", "PingFang SC", sans-serif`;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const padX = st.box ? size * 0.5 : 0;
  const padY = st.box ? size * 0.2 : 0;
  // 分行：按总宽度平均拆成几行，避免最后一行只剩一两个字（和以前一样）
  ctx.font = fontOf(false);
  const cw = chars.map((c, i) => { ctx.font = fontOf(mk.has(i)); return ctx.measureText(c).width; });
  const total = cw.reduce((a, b) => a + b, 0);
  const maxW = W * 0.9 - padX * 2;
  const n = total <= maxW ? 1 : Math.ceil(total / maxW);
  const per = Math.ceil(chars.length / n);
  const lines = [];
  for (let i = 0; i < chars.length; i += per) {
    // 每行再按样式分成几段（普通／重点）
    const runs = [];
    for (let k = i; k < Math.min(chars.length, i + per); k++) {
      const big = mk.has(k);
      const last = runs[runs.length - 1];
      if (last && last.big === big) last.t += chars[k]; else runs.push({ big, t: chars[k] });
    }
    let w = 0;
    for (const r of runs) { ctx.font = fontOf(r.big); r.w = ctx.measureText(r.t).width; w += r.w; }
    lines.push({ runs, w, big: runs.some(r => r.big) });
  }
  const lineH = size * 1.32, bigH = hasKw ? Math.max(lineH, size * K.scale * 1.22) : lineH;
  const lhs = lines.map(l => (l.big ? bigH : lineH));
  const blockW = Math.max(...lines.map(l => l.w)) + padX * 2;
  const blockH = lhs.reduce((a, b) => a + b, 0) + padY * 2;
  const top = H - st.marginV - blockH;
  const cx = W / 2;
  if (st.box && st.boxOpacity > 0) {
    ctx.fillStyle = hexToRgba(st.boxColor, st.boxOpacity);
    ctx.beginPath();
    ctx.roundRect(cx - blockW / 2, top, blockW, blockH, size * 0.22);
    ctx.fill();
  }
  let y0 = top + padY;
  lines.forEach((l, i) => {
    const y = y0 + lhs[i] / 2 + size * 0.04;
    y0 += lhs[i];
    let x = cx - l.w / 2;
    for (const r of l.runs) {
      ctx.font = fontOf(r.big);
      const ol = r.big && K.outline !== null && K.outline !== undefined ? K.outline : st.outline;
      const oc = r.big && K.outline !== null && K.outline !== undefined ? K.outlineColor : st.outlineColor;
      if (r.big && K.bg) {
        // 荧光笔：字后面一块圆角底色
        const fs = size * K.scale;
        ctx.fillStyle = K.bg;
        ctx.beginPath();
        ctx.roundRect(x - fs * 0.08, y - fs * 0.62, r.w + fs * 0.16, fs * 1.18, fs * 0.16);
        ctx.fill();
      }
      if (ol > 0) {
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = ol * 2;
        ctx.strokeStyle = oc;
        ctx.strokeText(r.t, x, y);
      }
      ctx.fillStyle = r.big ? K.color : st.color;
      ctx.fillText(r.t, x, y);
      x += r.w;
    }
  });
  ctx.restore();
}

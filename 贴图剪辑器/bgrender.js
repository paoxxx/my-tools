// 视频背景：纯色和几种动态图案。预览和导出用同一套画法；动态背景都按“无缝循环”来算速度
const BG_DIRS = {
  up: [0, -1, '从下往上'], down: [0, 1, '从上往下'], left: [-1, 0, '从右往左'], right: [1, 0, '从左往右'],
  'tl-br': [1, 1, '左上到右下'], 'tr-bl': [-1, 1, '右上到左下'], 'bl-tr': [1, -1, '左下到右上'], 'br-tl': [-1, -1, '右下到左上'],
  none: [0, 0, '不动'],
};
const BG_TYPES = { solid: '纯色', text: '滚动文字', grid: '网格', dots: '点阵', cross: '符号阵列', tier: '从夯到拉表格' };

// 内置素材：后面可以加“存成我的预设”
/* ---------- 从夯到拉表格（照搬从夯到拉生成器1.4的样子和排法） ---------- */
const tierRow = (text, color) => ({ id: 'r' + Math.random().toString(36).slice(2, 8), text, color, textColor: '#000000', fontId: 'noto-black', content: '#1A1A17', alpha: 100 });
const TIER_THEMES = {
  '网站原色': ['#FF0000', '#FFC000', '#FFFF00', '#FFF2CC', '#FFFFFF'],
  '经典彩虹': ['#FF7F7F', '#FFBF7F', '#FFDF7F', '#FFFF7F', '#BFFF7F', '#7FFF7F', '#7FFFFF', '#7FBFFF'],
  '柔和': ['#E8604C', '#F2A541', '#F4D35E', '#EDE6D6', '#F7F5F0'],
  '黑金': ['#C9A227', '#B8B8B8', '#A0703C', '#5A5A5A', '#2B2B2B'],
};
const tierDefault = () => ({
  type: 'tier', labelPct: 13.5, lineWidth: 2, lineColor: '#000000',
  imgScale: 82, gapX: 2, wrapDrop: 50, trayPct: 80, anim: 'smooth', dur: 0.5,
  rows: [['夯', '#FF0000'], ['顶级', '#FFC000'], ['人上人', '#FFFF00'], ['NPC', '#FFF2CC'], ['拉完了', '#FFFFFF']].map(([t, c]) => tierRow(t, c)),
});
// 表格的几何：每一行的上下边、标签栏宽度
function tierLayout(bg, W, H) {
  const n = Math.max(1, bg.rows.length), rh = H / n, y0 = [], y1 = [];
  for (let i = 0; i < n; i++) { y0.push(Math.round(i * rh)); y1.push(Math.round((i + 1) * rh)); }
  return { rh, y0, y1, lw: Math.round(W * bg.labelPct / 100), W, H };
}
const tierFont = (r, size) => `900 ${Math.max(1, Math.round(size))}px "${fontFamily(r.fontId || 'noto-black')}", "PingFang SC", sans-serif`;
// 标签文字自动取能放下的最大字号
function tierFit(ctx, r, lw, rh) {
  if (!r.text) return rh * 0.4;
  let lo = 6, hi = Math.round(rh * 1.2);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    ctx.font = tierFont(r, mid);
    if (ctx.measureText(r.text).width <= lw * 0.84 && mid <= rh * 0.62) lo = mid; else hi = mid - 1;
  }
  return lo;
}
function drawTierBoard(ctx, bg, W, H) {
  const L = tierLayout(bg, W, H);
  bg.rows.forEach((r, i) => {
    if (typeof loadSubFont === 'function') loadSubFont(r.fontId || 'noto-black');
    const y0 = L.y0[i], hh = L.y1[i] - y0;
    ctx.fillStyle = r.color; ctx.fillRect(0, y0, L.lw, hh);
    ctx.fillStyle = '#000'; ctx.fillRect(L.lw, y0, W - L.lw, hh);
    if (r.alpha > 0) { ctx.globalAlpha = r.alpha / 100; ctx.fillStyle = r.content; ctx.fillRect(L.lw, y0, W - L.lw, hh); ctx.globalAlpha = 1; }
    const size = tierFit(ctx, r, L.lw, hh);
    ctx.font = tierFont(r, size);
    ctx.fillStyle = r.textColor;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(r.text, L.lw / 2, y0 + hh / 2 + size * 0.04);
  });
  if (bg.lineWidth > 0) {
    ctx.fillStyle = bg.lineColor;
    const t = bg.lineWidth;
    for (let i = 1; i < bg.rows.length; i++) ctx.fillRect(0, L.y0[i] - Math.floor(t / 2), W, t);
    ctx.fillRect(L.lw - Math.floor(t / 2), 0, t, H);
  }
}

const BG_PRESETS = [
  { name: '纯黑', bg: { type: 'solid', color: '#000000' } },
  { name: '纯白', bg: { type: 'solid', color: '#FFFFFF' } },
  { name: '滚动文字·深', bg: { type: 'text', text: '测试文字', bgColor: '#141416', color: '#FFFFFF', opacity: 0.12, size: 90, tilt: -12, dir: 'tl-br', speed: 50 } },
  { name: '滚动文字·浅', bg: { type: 'text', text: '测试文字', bgColor: '#F4F1EA', color: '#1A1A1A', opacity: 0.08, size: 90, tilt: -12, dir: 'up', speed: 50 } },
  { name: '网格·黑', bg: { type: 'grid', bgColor: '#0B0B0D', color: '#FFFFFF', opacity: 0.18, cell: 60, line: 1.5, dir: 'up', speed: 50 } },
  { name: '网格·蓝图', bg: { type: 'grid', bgColor: '#0F2A4A', color: '#7FB8FF', opacity: 0.25, cell: 80, line: 1.5, dir: 'tl-br', speed: 50 } },
  { name: '点阵波浪', bg: { type: 'dots', bgColor: '#141A3A', color: '#C9D4FF', opacity: 0.55, gap: 36, radius: 2.4, wave: 14, dir: 'none', speed: 0 } },
  { name: '从夯到拉表格', bg: tierDefault() },
  { name: '×阵列·白', bg: { type: 'cross', bgColor: '#FFFFFF', color: '#111111', opacity: 0.85, gap: 64, radius: 9, wave: 0, dir: 'up', speed: 50 } },
];

const BG_FPS = 60;
// 速度只有四档（像素／秒），像素材一样固定，不会出现忽快忽慢
const BG_SPEEDS = [[50, '一档'], [100, '二档'], [150, '三档'], [200, '四档']];
const bgSnapSpeed = v => (!v ? 0 : BG_SPEEDS.reduce((a, [x]) => (Math.abs(x - v) < Math.abs(a - v) ? x : a), BG_SPEEDS[0][0]));
const BG_FONT = '"TT-noto-black", "PingFang SC", sans-serif';

// 一个图案“格子”的大小：动起来时，正好移动整数个格子就是一个循环
function bgTile(bg, ctx) {
  if (bg.type === 'text') {
    ctx.save();
    ctx.font = `${bg.size}px ${BG_FONT}`;
    const tw = Math.max(bg.size, ctx.measureText(bg.text || ' ').width + bg.size * 0.9);
    ctx.restore();
    return { tx: tw, ty: bg.size * 1.6 * 2 }; // 错位排列，两行一个周期
  }
  if (bg.type === 'grid') return { tx: bg.cell, ty: bg.cell };
  return { tx: bg.gap, ty: bg.gap };
}

// 运动参数：沿着图案本身的“格点方向”移动，循环一次正好走整数步，首尾无缝，速度也和设置的一致
//  上下左右：一步＝一个格子；斜向：网格、点阵是格子的对角线，滚动文字是错位排列的斜线方向（半格宽＋一行高）
//  循环长度2到12秒；速度太慢、一步要走12秒以上时，按12秒走一步（这是最慢速度）
const BG_MAX_L = 12;
function bgMotion(bg, ctx) {
  const { tx, ty } = bgTile(bg, ctx);
  const d = BG_DIRS[bg.dir] || BG_DIRS.none;
  const sp = Math.abs(bg.speed || 0);
  const waving = (bg.type === 'dots' || bg.type === 'cross') && bg.wave > 0;
  if (!sp || (!d[0] && !d[1])) return { vx: 0, vy: 0, L: waving ? 4 : 0, tx, ty };
  const g = d[0] && d[1] && bg.type === 'text' ? [d[0] * tx / 2, d[1] * ty / 2] : [d[0] * tx, d[1] * ty];
  const L0 = Math.hypot(g[0], g[1]) / sp; // 走一步要几秒
  const k = L0 < 2 ? Math.ceil(2 / L0) : 1; // 太快就一个循环走好几步
  let L = Math.min(BG_MAX_L, k * L0);
  L = Math.max(1 / BG_FPS, Math.round(L * BG_FPS) / BG_FPS);
  return { vx: (k * g[0]) / L, vy: (k * g[1]) / L, L, tx, ty };
}
// 实际速度（像素／秒），面板上显示用
function bgRealSpeed(bg, ctx) { const m = bgMotion(bg, ctx); return Math.round(Math.hypot(m.vx, m.vy)); }

const mod = (a, b) => ((a % b) + b) % b;

// t：从这段背景开始算起的秒数
function drawBackground(ctx, bg, t, W, H) {
  ctx.save();
  ctx.fillStyle = bg.type === 'solid' ? bg.color : bg.type === 'tier' ? '#000' : bg.bgColor;
  ctx.fillRect(0, 0, W, H);
  if (bg.type === 'solid') { ctx.restore(); return; }
  if (bg.type === 'tier') { drawTierBoard(ctx, bg, W, H); ctx.restore(); return; }
  const m = bgMotion(bg, ctx);
  const tt = m.L ? mod(t, m.L) : 0;
  const ox = mod(m.vx * tt, m.tx), oy = mod(m.vy * tt, m.ty);
  ctx.globalAlpha = bg.opacity ?? 1;
  ctx.translate(W / 2, H / 2);
  if (bg.tilt) ctx.rotate((bg.tilt * Math.PI) / 180);
  const R = Math.hypot(W, H) / 2 + Math.max(m.tx, m.ty);
  // 从格子对齐的位置开始铺，保证移动时图案连续
  const x0 = -Math.ceil(R / m.tx) * m.tx + ox, y0 = -Math.ceil(R / m.ty) * m.ty + oy;
  ctx.fillStyle = bg.color;
  ctx.strokeStyle = bg.color;

  if (bg.type === 'text') {
    ctx.font = `${bg.size}px ${BG_FONT}`;
    ctx.textBaseline = 'middle';
    const rowH = m.ty / 2;
    for (let y = y0, row = 0; y < R + m.ty; y += rowH, row++) {
      const shift = row % 2 ? m.tx / 2 : 0;
      for (let x = x0 - m.tx + shift; x < R + m.tx; x += m.tx) ctx.fillText(bg.text || '', x, y);
    }
  } else if (bg.type === 'grid') {
    ctx.lineWidth = bg.line || 1;
    ctx.beginPath();
    for (let x = x0; x < R + m.tx; x += m.tx) { ctx.moveTo(x, -R - m.ty); ctx.lineTo(x, R + m.ty); }
    for (let y = y0; y < R + m.ty; y += m.ty) { ctx.moveTo(-R - m.tx, y); ctx.lineTo(R + m.tx, y); }
    ctx.stroke();
  } else {
    // 点阵／符号阵列，可以加波浪起伏（波浪一个周期＝一个循环）
    const L = m.L || 4;
    const phase = (2 * Math.PI * tt) / L;
    const r = bg.radius || 2;
    ctx.lineWidth = Math.max(1, r * 0.35);
    ctx.lineCap = 'round';
    for (let y = y0; y < R + m.ty; y += m.ty) {
      for (let x = x0; x < R + m.tx; x += m.tx) {
        const dy = bg.wave ? bg.wave * Math.sin((x + R) / 220 + (y + R) / 340 - phase) : 0;
        if (bg.type === 'dots') {
          ctx.beginPath();
          ctx.arc(x, y + dy, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(x - r, y + dy - r); ctx.lineTo(x + r, y + dy + r);
          ctx.moveTo(x + r, y + dy - r); ctx.lineTo(x - r, y + dy + r);
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}

// 用来判断两段背景能不能共用同一个循环视频
function bgKey(bg, W, H) {
  return [W, H, ...Object.keys(bg).filter(k => !['id', 'start', 'end', 'track', 'layer'].includes(k)).sort().map(k => k + '=' + (typeof bg[k] === 'object' ? JSON.stringify(bg[k]) : bg[k]))].join('|');
}

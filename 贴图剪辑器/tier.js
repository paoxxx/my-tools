// 从夯到拉：背景里放一张“从夯到拉表格”（可以编辑），图片只有两个动作，全部按字幕开头卡点：
//   1. 出现：在画面正中央显示“待分配”的图片（片段开头＝出现的时间）
//   2. 飞过去：到了某句字幕开头，从中央飞到选好的档位，同时缩小（匀速或平滑，默认0.5秒）
// 终点不用手动定：每一档里按飞过去的先后从左往右排，一行放满了换行（和从夯到拉生成器1.4一样）
// 数据：图片还是轨道上的素材（stickers），多一个 s.tier = { row: 档位id或null, moveAt: 飞过去的时间或null }
const TIER_APPEAR = 0.2; // 出现时的淡入放大（秒）
const TIER_EASE = { linear: p => p, smooth: p => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2) };
const isTier = s => !!(s && s.tier);
const tierBoards = () => (S.project ? S.project.backgrounds || [] : []).filter(b => b.type === 'tier');
const visBg = b => !(trackOf(b) && trackOf(b).hidden);
// 播放头这里正在显示的表格
function tierBoardAt(t) { return tierBoards().find(b => visBg(b) && t >= b.start - 1e-6 && t < b.end - 1e-6) || null; }
// 这张图属于哪张表格：出现时间所在的那张，没有就用第一张
function tierBoardFor(s) { const l = tierBoards(); return l.find(b => s.start >= b.start - 1e-6 && s.start < b.end - 1e-6) || l[0] || null; }

// 每一档里的终点位置（成片像素）：按飞过去的先后，紧挨着上一张往右排，放满了回到最左边、往下错开
function tierSlots(board) {
  const { w: W, h: H } = S.project.canvas;
  const L = tierLayout(board, W, H), g = board.gapX / 100, hS = board.imgScale / 100, u = L.rh;
  const out = new Map();
  board.rows.forEach((r, i) => {
    const list = S.project.stickers
      .filter(s => s.tier && s.tier.row === r.id && s.tier.moveAt != null && tierBoardFor(s) === board)
      .sort((a, b) => a.tier.moveAt - b.tier.moveAt || (a.id < b.id ? -1 : 1));
    let prev = null;
    for (const s of list) {
      const w = hS * (s.w / s.h), limit = (W - L.lw) / u - g;
      let x = g, y = (1 - hS) / 2;
      if (prev) {
        const pc = prev.y + prev.h / 2;
        x = prev.x + prev.w + g; y = pc - hS / 2;
        if (x + w > limit) { x = g; y = pc + board.wrapDrop / 100 - hS / 2; }
      }
      prev = { x, y, w, h: hS };
      out.set(s.id, { x: L.lw + x * u, y: L.y0[i] + y * u, w: w * u, h: hS * u });
    }
  });
  return out;
}
// 待分配：等比缩放，最多占画面的 trayPct%，在正中央
function tierTray(s, board) {
  const { w: W, h: H } = S.project.canvas, p = board.trayPct / 100;
  const k = Math.min((W * p) / s.w, (H * p) / s.h);
  return { x: (W - s.w * k) / 2, y: (H - s.h * k) / 2, w: s.w * k, h: s.h * k };
}
// 某一时刻这张图在哪、多大、透明度多少（预览、封面、导出都用这一套）
function tierState(s, t, slots) {
  const board = tierBoardFor(s);
  if (!board) return null;
  const C = tierTray(s, board);
  const R = s.tier.moveAt != null && s.tier.row ? (slots || tierSlots(board)).get(s.id) : null;
  const a = Math.min(1, Math.max(0, (t - s.start) / TIER_APPEAR));
  const sc = 0.92 + 0.08 * a;
  const c = { x: C.x + (C.w * (1 - sc)) / 2, y: C.y + (C.h * (1 - sc)) / 2, w: C.w * sc, h: C.h * sc };
  let e = 0;
  if (R) e = (TIER_EASE[board.anim] || TIER_EASE.smooth)(Math.min(1, Math.max(0, (t - Math.max(s.start, s.tier.moveAt)) / (board.dur || 0.5))));
  const L = (p, q) => p + (q - p) * e;
  return R ? { x: L(c.x, R.x), y: L(c.y, R.y), w: L(c.w, R.w), h: L(c.h, R.h), a: e > 0 ? 1 : a, C, R } : { ...c, a, C, R: null };
}

/* ---------- 预览 ---------- */
function tierPlace(s, el, k) {
  const st = tierState(s, S.t);
  if (!st) return;
  Object.assign(el.style, { left: st.x * k + 'px', top: st.y * k + 'px', width: st.w * k + 'px', height: st.h * k + 'px', transform: '', borderRadius: '0', overflow: 'hidden', opacity: st.a });
  const m = el.firstChild;
  Object.assign(m.style, { left: '0', top: '0', width: '100%', height: '100%', transform: '' });
}

/* ---------- 打标签：普通图片点悬浮菜单的“🏷 分配”，才变成从夯到拉的分配图 ---------- */
// 出现时间对齐它所在这句字幕的开头；一直留到表格结束。原来的大小位置时长记下来，取消标签时还原
function tierMake(s) {
  if (s.type === 'video' || s.type === 'text') return;
  const board = tierBoardAt(s.start + 1e-3) || tierBoards()[0];
  if (!board) return toast('先在右侧“背景”里加一段“从夯到拉表格”，再给图片打分配标签', true, 3000);
  pushUndo(snapshot());
  s.tierPrev = { start: s.start, end: s.end, x: s.x, y: s.y, scale: s.scale };
  const sub = subAt(s.start + 1e-3);
  if (sub) s.start = sub.start; // 精准卡在字幕开头
  s.end = Math.max(s.start + 0.5, board.end);
  s.tier = { row: null, moveAt: null };
  const t = trackOf(s);
  if (!t || !trackFree(t, s)) s.track = freeTrack(s.start, s.end, s.id); // 拉长后和同轨道的撞了就换一条
  renderStickers(); layoutStickers(); syncStkPanel(); saveSoon();
  toast('🏷 已设为分配图：停到要分配的那句字幕，按数字键1、2、3…或点表格的某一档', false, 2600);
}
function tierToNormal(s) {
  pushUndo(snapshot());
  delete s.tier;
  const p = s.tierPrev;
  delete s.tierPrev;
  if (p) Object.assign(s, p);
  else { const { w: W, h: H } = S.project.canvas; s.x = W / 2; s.y = H / 2; s.scale = Math.min((W * 0.6) / s.w, (H * 0.45) / s.h, 3); }
  const t = trackOf(s);
  if (!t || !trackFree(t, s)) s.track = freeTrack(s.start, s.end, s.id);
  renderStickers(); layoutStickers(); syncStkPanel(); saveSoon();
  toast('已变回普通素材', false, 1400);
}

/* ---------- 分配：选中一张待分配的图，点表格左边的档位（或按数字键），到这句字幕开头飞过去 ---------- */
function tierAssign(s, i) {
  const board = tierBoardFor(s);
  const row = board && board.rows[i];
  if (!row) return toast('没有这一档', true);
  pushUndo(snapshot());
  const sub = subAt(S.t);
  let mv = sub ? sub.start : Math.round(S.t * FPS) / FPS;
  if (mv < s.start) mv = s.start; // 不能比出现还早
  s.tier.row = row.id;
  s.tier.moveAt = mv;
  s.end = Math.max(s.end, mv + (board.dur || 0.5) + 0.1);
  renderStickers();
  layoutStickers();
  syncStkPanel();
  saveSoon();
  toast(`✓ ${fmt(mv)}${sub ? '（这句字幕开头）' : ''} 飞到“${row.text}”`, false, 1500);
}
function tierUnassign(s) {
  pushUndo(snapshot());
  s.tier.row = null; s.tier.moveAt = null;
  renderStickers(); layoutStickers(); syncStkPanel(); saveSoon();
}
// 预览里：点到待分配的图只是选中（位置是自动的，不能拖）；选中后点表格的某一行＝分配到这一档
stage.addEventListener('mousedown', e => {
  if (!S.project || e.button !== 0 || S.cropping) return;
  if (e.target.closest('#stk-menu, #crop-bar')) return;
  const sel0 = S.selStk && getStk(S.selStk);
  if (e.target.closest('.hd, .rot-hd')) { if (isTier(sel0)) { e.preventDefault(); e.stopImmediatePropagation(); } return; }
  const el = e.target.closest('.stk');
  const hit = el && getStk(el.dataset.id);
  if (isTier(hit)) {
    e.preventDefault(); e.stopImmediatePropagation();
    video.pause();
    selectStk(hit.id);
    return;
  }
  const sel = S.selStk && getStk(S.selStk);
  const board = isTier(sel) && tierBoardAt(S.t);
  if (!board || hit) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const r = stage.getBoundingClientRect();
  const y = ((e.clientY - r.top) / r.height) * S.project.canvas.h;
  const L = tierLayout(board, S.project.canvas.w, S.project.canvas.h);
  const i = L.y0.findIndex((y0, k) => y >= y0 && y < L.y1[k]);
  if (i >= 0) tierAssign(sel, i);
}, true);
// 数字键1到9：分配到第几档
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  const s = S.selStk && getStk(S.selStk);
  if (!isTier(s)) return;
  e.preventDefault();
  tierAssign(s, Number(e.key) - 1);
});

/* ---------- 时间轴：片段上的小菱形＝飞过去的时间，左右拖可以改（吸附字幕开头） ---------- */
rowStk.addEventListener('mousedown', e => {
  const mk = e.target.closest('.mv');
  if (!mk || e.button !== 0) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const el = mk.closest('.clip'), s = getStk(el.dataset.id);
  if (!s || !s.tier) return;
  video.pause();
  selectStk(s.id);
  const board = tierBoardFor(s), x0 = e.clientX, o = s.tier.moveAt, snap = snapshot();
  let moved = false;
  const move = ev => {
    const dx = ev.clientX - x0;
    if (!moved && Math.abs(dx) < 2) return;
    moved = true;
    let t = Math.min(Math.max(s.start, o + dx / S.pps), s.end - (board ? board.dur : 0.5));
    if (!ev.metaKey) { const p = nearestSnap(t, s.id, 'start'); if (p && p.t >= s.start - 1e-6) { t = p.t; showSnapLine(t); hiSub(p.kind === 'sub' ? p.id : null); } else hiSub(null); }
    s.tier.moveAt = Math.round(t * FPS) / FPS;
    mk.style.left = (s.tier.moveAt - s.start) * S.pps - 6 + 'px';
    setTime(s.tier.moveAt);
    layoutStickers();
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    hiSub(null);
    if (moved && s.tier.moveAt !== o) { pushUndo(snap); saveSoon(); renderStickers(); syncStkPanel(); }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}, true);

/* ---------- 右侧面板（选中待分配的图片时） ---------- */
function syncTierPanel() {
  const s = S.selStk && getStk(S.selStk);
  const on = isTier(s);
  $('#stk-props').classList.toggle('tiermode', on);
  $('#tier-box').hidden = !on;
  if (!on) return;
  const board = tierBoardFor(s);
  const box = $('#tier-rows');
  box.replaceChildren(...(board ? board.rows : []).map((r, i) => {
    const b = document.createElement('button');
    b.className = 'tier-rb' + (s.tier.row === r.id ? ' on' : '');
    b.style.background = r.color;
    b.style.color = r.textColor;
    b.textContent = `${i + 1} ${r.text}`;
    b.title = `到播放头这句字幕开头，飞到“${r.text}”（快捷键${i + 1}）`;
    b.onclick = () => tierAssign(s, i);
    return b;
  }));
  const row = board && board.rows.find(r => r.id === s.tier.row);
  $('#v-tier-show').textContent = fmt(s.start);
  $('#v-tier-move').textContent = row && s.tier.moveAt != null ? `${fmt(s.tier.moveAt)} → ${row.text}` : '还没分配';
  $('#tier-unassign').disabled = !row;
}
$('#tier-show-here').onclick = () => {
  const s = getStk(S.selStk);
  if (!isTier(s)) return;
  pushUndo(snapshot());
  const sub = subAt(S.t);
  s.start = sub ? sub.start : Math.round(S.t * FPS) / FPS;
  if (s.tier.moveAt != null && s.tier.moveAt < s.start) s.tier.moveAt = s.start;
  renderStickers(); layoutStickers(); syncStkPanel(); saveSoon();
};
$('#tier-unassign').onclick = () => { const s = getStk(S.selStk); if (isTier(s)) tierUnassign(s); };
$('#tier-normal').onclick = () => { const s = getStk(S.selStk); if (isTier(s)) tierToNormal(s); };

/* ---------- 封面、导出 ---------- */
function drawTierCanvas(ctx, s, media, t) {
  const st = tierState(s, t);
  if (!st || !media) return;
  ctx.save();
  ctx.globalAlpha = st.a;
  try { ctx.drawImage(media, st.x, st.y, st.w, st.h); } catch {}
  ctx.restore();
}
// 导出要的参数：起点（中央）、终点（档位里的位置）、出现和飞过去的时间、动画方式
function tierAnimFor(s) {
  const board = tierBoardFor(s);
  if (!board) return null;
  const st = tierState(s, s.start);
  return { C: st.C, R: st.R, show: s.start, mv: s.tier.moveAt != null ? Math.max(s.start, s.tier.moveAt) : null, dur: board.dur || 0.5, anim: board.anim || 'smooth', appear: TIER_APPEAR };
}

/* ---------- 背景面板：编辑从夯到拉表格（档位名字、颜色、增删、上下移、字体、尺寸、动画） ---------- */
function tierEdit(fn, commit, rebuild) {
  editBg(fn, commit);
  layoutStickers();
  if (rebuild) syncBgPanel();
}
function renderTierEditor(box, b) {
  const h = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };
  const lab = t => h(`<div class="f-label">${t}</div>`);
  // 配色主题
  box.appendChild(lab('配色主题'));
  const th = h('<div class="btn-row tier-themes"></div>');
  Object.entries(TIER_THEMES).forEach(([name, cs]) => {
    const bt = document.createElement('button');
    bt.className = 'btn small';
    bt.innerHTML = `<span class="dots">${cs.slice(0, 5).map(c => `<i style="background:${c}"></i>`).join('')}</span>${name}`;
    bt.onclick = () => tierEdit(x => { x.rows.forEach((r, i) => { r.color = cs[i % cs.length]; }); }, true, true);
    th.appendChild(bt);
  });
  box.appendChild(th);
  // 档位列表
  box.appendChild(lab('档位（上面的就是第1档）'));
  const list = h('<div class="tier-list"></div>');
  b.rows.forEach((r, i) => {
    const it = h(`<div class="tier-item">
      <label class="tc" title="色块颜色"><input type="color"></label>
      <input type="text" class="tn" spellcheck="false">
      <label class="tc small" title="文字颜色"><input type="color"></label>
      <button class="ib up" title="上移一行">↑</button><button class="ib dn" title="下移一行">↓</button><button class="ib del" title="删除这一行">✕</button>
    </div>`);
    const [cIn, tIn] = it.querySelectorAll('input[type=color]');
    cIn.value = r.color.toLowerCase(); cIn.parentNode.style.background = r.color;
    tIn.value = r.textColor.toLowerCase(); tIn.parentNode.style.background = r.textColor;
    cIn.oninput = () => { cIn.parentNode.style.background = cIn.value; tierEdit(x => { x.rows[i].color = cIn.value.toUpperCase(); }, false); };
    cIn.onchange = () => tierEdit(x => { x.rows[i].color = cIn.value.toUpperCase(); }, true);
    tIn.oninput = () => { tIn.parentNode.style.background = tIn.value; tierEdit(x => { x.rows[i].textColor = tIn.value.toUpperCase(); }, false); };
    tIn.onchange = () => tierEdit(x => { x.rows[i].textColor = tIn.value.toUpperCase(); }, true);
    const nm = it.querySelector('.tn');
    nm.value = r.text;
    nm.oninput = () => tierEdit(x => { x.rows[i].text = nm.value; }, false);
    nm.onchange = () => tierEdit(x => { x.rows[i].text = nm.value; }, true);
    nm.onkeydown = e => e.stopPropagation();
    const mv = d => tierEdit(x => { const j = i + d; if (j < 0 || j >= x.rows.length) return; [x.rows[i], x.rows[j]] = [x.rows[j], x.rows[i]]; }, true, true);
    it.querySelector('.up').onclick = () => mv(-1);
    it.querySelector('.dn').onclick = () => mv(1);
    it.querySelector('.del').onclick = () => {
      if (b.rows.length <= 1) return toast('至少留一行', true);
      tierEdit(x => { x.rows.splice(i, 1); }, true, true);
    };
    list.appendChild(it);
  });
  box.appendChild(list);
  const add = h('<button class="btn small">＋ 加一行</button>');
  add.onclick = () => tierEdit(x => {
    const cs = TIER_THEMES['经典彩虹'], last = x.rows[x.rows.length - 1];
    const nr = tierRow('新等级', cs[x.rows.length % cs.length]);
    if (last) Object.assign(nr, { fontId: last.fontId, content: last.content, alpha: last.alpha, textColor: last.textColor });
    x.rows.push(nr);
  }, true, true);
  box.appendChild(add);
  // 字体（全部档位一起改）
  box.appendChild(lab('标签字体'));
  const fs = document.createElement('select');
  SUB_FONTS.forEach(f => fs.add(new Option(f.name, f.id)));
  fs.value = (b.rows[0] && b.rows[0].fontId) || 'noto-black';
  fs.onchange = () => tierEdit(x => { x.rows.forEach(r => { r.fontId = fs.value; }); loadSubFont(fs.value).then(() => drawBgPreview(true)); }, true);
  box.appendChild(fs);
  // 尺寸
  const slider = (label, key, min, max, step, fmtV, get = v => v, put = v => v) => {
    const l = lab(`${label} <b></b>`), v = l.querySelector('b');
    const inp = document.createElement('input');
    Object.assign(inp, { type: 'range', min, max, step });
    inp.value = put(b[key]);
    v.textContent = fmtV(put(b[key]));
    inp.oninput = () => { v.textContent = fmtV(Number(inp.value)); tierEdit(x => { x[key] = get(Number(inp.value)); }, false); };
    inp.onchange = () => tierEdit(x => { x[key] = get(Number(inp.value)); }, true);
    box.appendChild(l); box.appendChild(inp);
  };
  box.appendChild(h('<div class="f-label sec">尺寸</div>'));
  slider('标签栏宽度', 'labelPct', 5, 30, 0.5, v => v + '%');
  slider('图片大小（占一行的高度）', 'imgScale', 30, 100, 1, v => v + '%');
  slider('左右间距', 'gapX', 0, 15, 1, v => v + '%');
  slider('放满换行时往下错开', 'wrapDrop', 0, 100, 5, v => v + '%');
  slider('待分配图片大小', 'trayPct', 30, 95, 1, v => v + '%');
  slider('分割线粗细', 'lineWidth', 0, 20, 1, v => v + 'px');
  const cl = h('<div class="f-label row">分割线颜色 <label class="tc"><input type="color"></label></div>');
  const lc = cl.querySelector('input'); lc.value = b.lineColor.toLowerCase(); lc.parentNode.style.background = b.lineColor;
  lc.oninput = () => { lc.parentNode.style.background = lc.value; tierEdit(x => { x.lineColor = lc.value.toUpperCase(); }, false); };
  lc.onchange = () => tierEdit(x => { x.lineColor = lc.value.toUpperCase(); }, true);
  box.appendChild(cl);
  const cc = h('<div class="f-label row">内容区底色 <label class="tc"><input type="color"></label></div>');
  const ci = cc.querySelector('input'); const c0 = (b.rows[0] && b.rows[0].content) || '#1A1A17';
  ci.value = c0.toLowerCase(); ci.parentNode.style.background = c0;
  ci.oninput = () => { ci.parentNode.style.background = ci.value; tierEdit(x => { x.rows.forEach(r => { r.content = ci.value.toUpperCase(); }); }, false); };
  ci.onchange = () => tierEdit(x => { x.rows.forEach(r => { r.content = ci.value.toUpperCase(); }); }, true);
  box.appendChild(cc);
  // 动画
  box.appendChild(h('<div class="f-label sec">飞过去的动画</div>'));
  const an = h('<div class="seg"><button data-v="smooth">平滑（先快后慢）</button><button data-v="linear">匀速</button></div>');
  an.querySelectorAll('button').forEach(bt => {
    bt.classList.toggle('on', (b.anim || 'smooth') === bt.dataset.v);
    bt.onclick = () => tierEdit(x => { x.anim = bt.dataset.v; }, true, true);
  });
  box.appendChild(an);
  slider('飞行时长', 'dur', 0.2, 1.5, 0.1, v => Number(v).toFixed(1) + '秒');
  box.appendChild(h('<div class="side-hint dim">用法：播放头停在要出现的那句字幕上，从素材库双击图片，点图片上方悬浮菜单的“🏷 分配”，它会在这句字幕开头出现在正中央；再停到要分配的那句字幕上，按数字键1、2、3…（或点画面里表格的某一行），它就会在这句字幕开头飞过去。没打标签的图片就是普通表情包</div>'));
}
// 字体加载好以后重画表格
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { if (S.project) drawBgPreview(true); });

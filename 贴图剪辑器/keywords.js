// 字幕列表：右侧“字幕列表”页像表格一样列出全部字幕，每行能直接改字、插入、删除、搜索
// 点右上角“画重点”切换成文字块模式：点选文字块（可以多选、拖选），再点“高亮选中”，这些字就用关键词样式显示
// 数据：subtitles[].marks＝被画重点的字的序号（按字算）；project.kwStyle＝关键词样式（全片统一）
// 注意：改字只改项目里的字幕，不会去改剪映导出的SRT文件
S.kwMode = false;      // false：逐句改字；true：画重点（文字块）
S.kwPick = new Map();  // 选中的字：字幕id → Set(字的序号)
let kwAnchor = null;   // 上一次点的文字块，Shift点击扩展用
const kwList = $('#kw-list');
const kwOn = () => !$('#sub-page-kw').hidden && !$('#tab-sub').hidden;
const kwStyle = () => normKw(S.project && S.project.kwStyle);
const subById = id => S.project.subtitles.find(x => x.id === id);
const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/* ---------- 页面切换：字幕列表／导入和样式 ---------- */
function subPage(v) {
  document.querySelectorAll('#sub-pages button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#sub-page-style').hidden = v !== 'style';
  $('#sub-page-kw').hidden = v !== 'list';
  if (v === 'list') { kwRender(); kwSync(); kwScrollTo(S.selSub || (subAt(S.t) || {}).id); }
}
document.querySelectorAll('#sub-pages button').forEach(b => (b.onclick = () => subPage(b.dataset.v)));
// 画重点模式开关（右上角的笔，开着时是蓝色）
function setKwMode(on) {
  S.kwMode = on;
  if (!on) S.kwPick.clear();
  $('#kw-mode').classList.toggle('on', on);
  $('#kw-tools').hidden = !on;
  $('#kw-style-box').hidden = !on;
  $('#kw-edit-tip').hidden = on;
  kwRender();
}
$('#kw-mode').onclick = () => setKwMode(!S.kwMode);
$('#sub-search').addEventListener('input', () => kwRender());
$('#sub-search').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.target.value = ''; kwRender(); } });

/* ---------- 列表 ---------- */
function kwRowHTML(s, i) {
  if (!S.kwMode) {
    return `<span class="no">${i + 1}</span><textarea class="se" rows="1" spellcheck="false">${esc(s.text)}</textarea>` +
      '<button class="ins" title="在这句后面加一句">＋</button><button class="del" title="删除这句">🗑</button>';
  }
  const mk = new Set(s.marks || []);
  const pick = S.kwPick.get(s.id);
  const blocks = subTokens(s.text).map(t => {
    let on = true, sel = !!pick;
    for (let k = t.a; k < t.b; k++) { if (!mk.has(k)) on = false; if (!pick || !pick.has(k)) sel = false; }
    return `<span class="kb${on ? ' on' : ''}${sel ? ' sel' : ''}" data-a="${t.a}" data-b="${t.b}">${esc(t.t)}</span>`;
  }).join('');
  return `<span class="no">${i + 1}</span><div class="kbs">${blocks}</div>`;
}
function kwRender() {
  if (!S.project || !kwOn()) return;
  for (const id of [...S.kwPick.keys()]) if (!subById(id)) S.kwPick.delete(id);
  const q = $('#sub-search').value.trim();
  const curId = (subAt(S.t) || {}).id;
  const frag = document.createDocumentFragment();
  S.project.subtitles.forEach((s, i) => {
    if (q && !s.text.includes(q)) return;
    const row = document.createElement('div');
    row.className = 'kw-row' + (S.kwMode ? ' blocks' : ' edit') + (s.id === S.selSub ? ' cur' : '') + (s.id === curId ? ' playing' : '');
    row.dataset.id = s.id;
    row.innerHTML = kwRowHTML(s, i);
    frag.appendChild(row);
  });
  if (!S.project.subtitles.length) frag.appendChild(Object.assign(document.createElement('div'), { className: 'side-hint dim', textContent: '还没有字幕，到“导入和样式”页导入剪映字幕' }));
  else if (q && !frag.childNodes.length) frag.appendChild(Object.assign(document.createElement('div'), { className: 'side-hint dim', textContent: `没有找到“${q}”` }));
  kwList.replaceChildren(frag);
  kwFit();
  kwButtons();
}
// 改字框跟着字数自动变高（长句子换行显示，不用左右滚）
function kwFit(root = kwList) { root.querySelectorAll('textarea.se').forEach(t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }); }
kwList.addEventListener('input', e => { if (e.target.classList.contains('se')) kwFit(e.target.parentNode); });
function kwRenderRow(id) {
  const row = kwList.querySelector(`.kw-row[data-id="${id}"]`);
  const i = S.project.subtitles.findIndex(x => x.id === id);
  if (row && i >= 0) { row.innerHTML = kwRowHTML(S.project.subtitles[i], i); kwFit(row); }
  kwButtons();
}
let kwRT;
// 改字时正在输入，不要整表重画（会丢光标）
function kwRenderSoon() { if (!kwOn()) return; clearTimeout(kwRT); kwRT = setTimeout(() => { if (!(document.activeElement && document.activeElement.classList.contains('se'))) kwRender(); }, 60); }
function kwScrollTo(id) {
  if (!id || !kwOn()) return;
  const row = kwList.querySelector(`.kw-row[data-id="${id}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
}
// 播放时，正在念的这句在列表里亮起来
function kwPlaying(id) {
  if (!kwOn()) return;
  kwList.querySelectorAll('.kw-row.playing').forEach(r => r.classList.remove('playing'));
  const row = id && kwList.querySelector(`.kw-row[data-id="${id}"]`);
  if (row) { row.classList.add('playing'); if (!video.paused) row.scrollIntoView({ block: 'nearest' }); }
}
function kwOnSelectSub(id) {
  if (!kwOn()) return;
  kwList.querySelectorAll('.kw-row.cur').forEach(r => r.classList.remove('cur'));
  const row = id && kwList.querySelector(`.kw-row[data-id="${id}"]`);
  if (row) { row.classList.add('cur'); row.scrollIntoView({ block: 'nearest' }); }
}
function kwGoto(id) {
  const s = subById(id);
  if (!s) return;
  video.pause();
  if (S.selSub !== id) selectSub(id);
  if (S.t < s.start || S.t >= s.end) { setTime(s.start); keepPlayheadVisible(); }
}

/* ---------- 逐句改字 ---------- */
function commitText(inp) {
  const row = inp.closest('.kw-row');
  const s = row && subById(row.dataset.id);
  if (!s) return;
  const v = inp.value.replace(/\s*\n\s*/g, '').trim();
  if (v === s.text) return;
  if (!v) { inp.value = s.text; return toast('字幕不能是空的；要删除这句点右边的垃圾桶', true); }
  pushUndo(snapshot());
  s.marks = remapMarks(s.text, v, s.marks);
  if (!s.marks) delete s.marks;
  s.text = v;
  renderSubs();
  updateSubPreview();
  drawSubPreview(true);
  saveSoon();
}
kwList.addEventListener('focusin', e => { if (e.target.classList.contains('se')) kwGoto(e.target.closest('.kw-row').dataset.id); });
kwList.addEventListener('focusout', e => { if (e.target.classList.contains('se')) commitText(e.target); });
kwList.addEventListener('keydown', e => {
  const inp = e.target;
  if (!inp.classList.contains('se')) return;
  e.stopPropagation();
  if (e.isComposing || e.keyCode === 229) return; // 输入法选字时的回车不算
  const row = inp.closest('.kw-row');
  const go = r => { const n = r && r.querySelector('.se'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } };
  if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); commitText(inp); go(row.nextElementSibling); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); commitText(inp); go(row.previousElementSibling); }
  else if (e.key === 'Escape') { const s = subById(row.dataset.id); inp.value = s ? s.text : inp.value; inp.blur(); }
});
// 加一句：后面有空隙就放在空隙里（最长2秒），没有空隙就把这句的时间对半分
kwList.addEventListener('click', e => {
  const btn = e.target.closest('.ins, .del');
  if (!btn) return;
  const id = btn.closest('.kw-row').dataset.id;
  const list = S.project.subtitles;
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return;
  pushUndo(snapshot());
  if (btn.classList.contains('del')) {
    list.splice(i, 1);
    if (S.selSub === id) S.selSub = null;
    renderSubs(); updateSubPreview(); saveSoon(); kwRender();
    toast('已删除这句（Cmd＋Z可以撤销）', false, 1400);
    return;
  }
  const s = list[i], next = list[i + 1];
  const gapEnd = next ? next.start : duration();
  let ns;
  if (gapEnd - s.end >= 0.3) ns = { start: s.end, end: Math.min(gapEnd, s.end + 2) };
  else { const mid = Math.round(((s.start + s.end) / 2) * FPS) / FPS; ns = { start: mid, end: s.end }; s.end = mid; }
  const nsub = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), start: ns.start, end: ns.end, text: '新字幕' };
  list.splice(i + 1, 0, nsub);
  renderSubs(); updateSubPreview(); saveSoon(); kwRender();
  const inp = kwList.querySelector(`.kw-row[data-id="${nsub.id}"] .se`);
  if (inp) { inp.focus(); inp.select(); }
});

/* ---------- 画重点：选文字块（可以多选） ---------- */
function pickHas(id, a, b) { const p = S.kwPick.get(id); if (!p) return false; for (let k = a; k < b; k++) if (!p.has(k)) return false; return true; }
function pickSet(id, a, b, on) {
  let p = S.kwPick.get(id);
  if (!p) { p = new Set(); S.kwPick.set(id, p); }
  const chars = [...subById(id).text];
  for (let k = a; k < b; k++) { if (on && chars[k] && chars[k].trim()) p.add(k); else p.delete(k); }
  if (!p.size) S.kwPick.delete(id);
}
kwList.addEventListener('mousedown', e => {
  if (!S.kwMode) {
    const row = e.target.closest('.kw-row');
    if (row && !e.target.closest('input, button')) kwGoto(row.dataset.id);
    return;
  }
  const row = e.target.closest('.kw-row');
  if (!row || e.button !== 0) return;
  e.preventDefault();
  const id = row.dataset.id;
  kwGoto(id);
  const kb = e.target.closest('.kb');
  if (!kb) return;
  const a0 = Number(kb.dataset.a), b0 = Number(kb.dataset.b);
  if (e.shiftKey && kwAnchor && kwAnchor.id === id) {
    pickSet(id, Math.min(kwAnchor.a, a0), Math.max(kwAnchor.b, b0), true);
    kwRenderRow(id);
    return;
  }
  // 点一下：选上／取消这一块（之前选的保留，可以连续点好几块）；按住拖动：这一串跟着第一块一起选上或取消
  const on = !pickHas(id, a0, b0);
  pickSet(id, a0, b0, on);
  kwAnchor = { id, a: a0, b: b0 };
  kwRenderRow(id);
  const over = ev => {
    const k = ev.target.closest && ev.target.closest('.kb');
    if (!k || k.closest('.kw-row').dataset.id !== id) return;
    const a = Number(k.dataset.a), b = Number(k.dataset.b);
    pickSet(id, Math.min(a0, a), Math.max(b0, b), on);
    kwRenderRow(id);
  };
  const up = () => { kwList.removeEventListener('mouseover', over); window.removeEventListener('mouseup', up); };
  kwList.addEventListener('mouseover', over);
  window.addEventListener('mouseup', up);
});
// 双击一个文字块：直接高亮／取消
kwList.addEventListener('dblclick', e => {
  if (!S.kwMode) return;
  const kb = e.target.closest('.kb'), row = e.target.closest('.kw-row');
  if (!kb || !row) return;
  const s = subById(row.dataset.id);
  const a = Number(kb.dataset.a), b = Number(kb.dataset.b);
  pickSet(s.id, a, b, false); // 双击的第二下把选择又切掉了，这里不算选择
  pushUndo(snapshot());
  const mk = new Set(s.marks || []);
  let all = true;
  for (let k = a; k < b; k++) if (!mk.has(k)) all = false;
  const chars = [...s.text];
  for (let k = a; k < b; k++) { if (all) mk.delete(k); else if (chars[k].trim()) mk.add(k); }
  s.marks = [...mk].sort((x, y) => x - y);
  if (!s.marks.length) delete s.marks;
  kwChanged(s.id);
});

/* ---------- 高亮／取消 ---------- */
function kwPickAllMarked() {
  if (!S.kwPick.size) return false;
  for (const [id, set] of S.kwPick) {
    const mk = new Set((subById(id) || {}).marks || []);
    for (const k of set) if (!mk.has(k)) return false;
  }
  return true;
}
function kwButtons() {
  const has = S.kwPick.size > 0;
  $('#kw-mark').disabled = !has;
  $('#kw-unsel').disabled = !has;
  const allOn = has && kwPickAllMarked();
  $('#kw-mark').classList.toggle('on', allOn);
  $('#kw-mark').textContent = allOn ? '取消高亮' : '高亮选中';
  const cur = S.selSub && subById(S.selSub);
  $('#kw-clear').disabled = !(cur && cur.marks && cur.marks.length);
}
function kwChanged(id) {
  kwRenderRow(id);
  renderSubs();
  drawSubPreview(true);
  saveSoon();
}
function kwToggle() {
  if (!S.kwPick.size) return;
  pushUndo(snapshot());
  const off = kwPickAllMarked();
  for (const [id, set] of S.kwPick) {
    const s = subById(id);
    if (!s) continue;
    const mk = new Set(s.marks || []);
    for (const k of set) { if (off) mk.delete(k); else mk.add(k); }
    s.marks = [...mk].sort((a, b) => a - b);
    if (!s.marks.length) delete s.marks;
  }
  for (const id of S.kwPick.keys()) kwRenderRow(id);
  renderSubs();
  drawSubPreview(true);
  saveSoon();
  toast(off ? '已取消高亮' : '✓ 已高亮', false, 900);
}
$('#kw-mark').onclick = () => kwToggle();
$('#kw-unsel').onclick = () => { const ids = [...S.kwPick.keys()]; S.kwPick.clear(); ids.forEach(kwRenderRow); kwButtons(); };
$('#kw-clear').onclick = () => {
  const s = S.selSub && subById(S.selSub);
  if (!s || !s.marks) return;
  pushUndo(snapshot());
  delete s.marks;
  kwChanged(s.id);
  toast('已清除这句的重点', false, 1200);
};
// 快捷键：画重点模式里选了字，按H高亮
document.addEventListener('keydown', e => {
  if (!kwOn() || !S.kwMode || !S.kwPick.size || e.metaKey || e.ctrlKey) return;
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  if (e.key === 'h' || e.key === 'H') { e.preventDefault(); kwToggle(); }
});

// 改字后，重点尽量保留：前后没变的部分照旧，改动的中间部分去掉
function remapMarks(oldText, newText, marks) {
  if (!marks || !marks.length) return marks;
  const o = [...oldText], n = [...newText];
  let p = 0;
  while (p < o.length && p < n.length && o[p] === n[p]) p++;
  let q = 0;
  while (q < o.length - p && q < n.length - p && o[o.length - 1 - q] === n[n.length - 1 - q]) q++;
  const out = [];
  for (const k of marks) {
    if (k < p) out.push(k);
    else if (k >= o.length - q) out.push(k + n.length - o.length);
  }
  return out.length ? out : undefined;
}

/* ---------- 关键词样式 ---------- */
const KW_COLORS = {
  color: ['#FFE14D', '#FF4D4F', '#FF9C3D', '#36CFC9', '#4096FF', '#FF85C0', '#95DE64', '#FFFFFF', '#141414'],
  outlineColor: ['#000000', '#FFFFFF', '#E8262B', '#1F3A8A'],
  bg: ['#FFE14D', '#FF4D4F', '#2F7BFF', '#95DE64', '#FF85C0', '#FFFFFF'],
};
let kwPending = null;
function setKw(patch, commit) {
  if (!S.project) return;
  if (!kwPending) kwPending = snapshot();
  S.project.kwStyle = { ...kwStyle(), ...patch };
  if (commit) { pushUndo(kwPending); kwPending = null; }
  kwSync();
  drawSubPreview(true);
  saveSoon();
}
// 预设：小方块上画一个“重”字的样子
function drawKwPresets() {
  const box = $('#kw-presets');
  box.replaceChildren(...KW_PRESETS.map(p => {
    const b = document.createElement('button');
    b.className = 'kwp';
    b.title = p.name;
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    const k = normKw(p.kw);
    ctx.font = `bold 38px "TT-noto-black", "PingFang SC", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (k.bg) { ctx.fillStyle = k.bg; ctx.beginPath(); ctx.roundRect(10, 12, 44, 40, 8); ctx.fill(); }
    if (k.outline) { ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = k.outlineColor; ctx.strokeText('重', 32, 34); }
    else if (!k.bg) { ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText('重', 32, 34); }
    ctx.fillStyle = k.color; ctx.fillText('重', 32, 34);
    b.appendChild(cv);
    b.appendChild(Object.assign(document.createElement('span'), { textContent: p.name }));
    b.onclick = () => setKw({ ...p.kw }, true);
    return b;
  }));
}
document.querySelectorAll('.kwsw').forEach(box => {
  const key = box.dataset.kw;
  KW_COLORS[key].forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'sw';
    sw.style.background = c;
    sw.dataset.c = c;
    sw.title = c;
    sw.onclick = () => setKw({ [key]: c }, true);
    box.appendChild(sw);
  });
  const custom = document.createElement('label');
  custom.className = 'sw custom';
  custom.title = '自定义颜色';
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.oninput = () => setKw({ [key]: inp.value.toUpperCase() }, false);
  inp.onchange = () => setKw({ [key]: inp.value.toUpperCase() }, true);
  custom.appendChild(inp);
  box.appendChild(custom);
});
$('#kw-scale').oninput = e => setKw({ scale: Number(e.target.value) / 100 }, false);
$('#kw-scale').onchange = e => setKw({ scale: Number(e.target.value) / 100 }, true);
$('#kw-olw').oninput = e => setKw({ outline: Number(e.target.value) }, false);
$('#kw-olw').onchange = e => setKw({ outline: Number(e.target.value) }, true);
$('#kw-ol').onchange = e => setKw({ outline: e.target.checked ? 5 : null }, true);
$('#kw-bg').onchange = e => setKw({ bg: e.target.checked ? '#FFE14D' : '' }, true);
function kwSync() {
  if (!S.project) return;
  const k = kwStyle();
  $('#kw-scale').value = Math.round(k.scale * 100);
  $('#v-kw-scale').textContent = Math.round(k.scale * 100) + '%';
  const hasOl = k.outline !== null && k.outline !== undefined;
  $('#kw-ol').checked = hasOl;
  $('#kw-ol-opts').classList.toggle('off', !hasOl);
  $('#kw-olw').value = hasOl ? k.outline : 5;
  $('#v-kw-olw').textContent = hasOl ? k.outline : '跟随字幕';
  $('#kw-bg').checked = !!k.bg;
  $('#kw-bg-opts').classList.toggle('off', !k.bg);
  document.querySelectorAll('.kwsw').forEach(box => {
    const v = (k[box.dataset.kw] || '').toUpperCase();
    let hit = false;
    box.querySelectorAll('.sw[data-c]').forEach(sw => { const on = sw.dataset.c.toUpperCase() === v; sw.classList.toggle('on', on); hit = hit || on; });
    const cu = box.querySelector('.sw.custom');
    cu.classList.toggle('on', !hit && !!v);
    cu.querySelector('input').value = /^#[0-9A-F]{6}$/i.test(v) ? v.toLowerCase() : '#ffffff';
  });
  // 预设：和当前一样的亮起来
  document.querySelectorAll('#kw-presets .kwp').forEach((b, i) => {
    const p = normKw(KW_PRESETS[i].kw);
    b.classList.toggle('on', ['color', 'scale', 'outline', 'outlineColor', 'bg'].every(x => String(p[x]) === String(k[x])));
  });
}
loadSubFont('noto-black').then(drawKwPresets);
drawKwPresets();

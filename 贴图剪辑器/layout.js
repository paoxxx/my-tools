// 界面分栏：素材库、预览、属性面板、时间轴之间的边框都能拖动，大小会记住
const LAYOUT_KEY = 'tietu-layout';
const LY = (() => {
  const d = { lib: 280, side: 250, tl: 300, thumb: 116 };
  try { return { ...d, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') }; } catch { return d; }
})();
function saveLayout() { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(LY)); } catch {} }

const FIXED_ROWS = 26 + 40 + 12 + 6; // 标尺＋字幕＋滚动条＋分隔线；下面全部给数字轨道（视频片段自带波形）
function applyLayout() {
  const W = window.innerWidth, H = window.innerHeight;
  LY.lib = Math.min(Math.max(160, LY.lib), W * 0.45);
  LY.side = Math.min(Math.max(200, LY.side), W * 0.4);
  LY.tl = Math.min(Math.max(FIXED_ROWS + 50, LY.tl), H - 280);
  $('#lib').style.width = LY.lib + 'px';
  $('#side').style.width = LY.side + 'px';
  $('#timeline').style.height = LY.tl + 'px';
  // 时间轴多出来的高度都给表情包轨道，叠的层多也放得下
  document.documentElement.style.setProperty('--h-stk', Math.max(50, LY.tl - FIXED_ROWS) + 'px');
  $('#lib').style.setProperty('--thumb', LY.thumb + 'px');
  if (S.project && !$('#editor').hidden) {
    layoutStage();
    refreshTimeline();
    if (window.renderStickers) renderStickers();
  }
}

function dragSplit(el, onMove) {
  el.addEventListener('mousedown', e => {
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY, start = { ...LY };
    el.classList.add('on');
    document.body.style.cursor = getComputedStyle(el).cursor;
    const move = ev => { onMove(ev.clientX - x0, ev.clientY - y0, start); applyLayout(); };
    const up = () => {
      el.classList.remove('on');
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      saveLayout();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  // 双击边框恢复默认
  el.addEventListener('dblclick', () => {
    if (el.id === 'split-l') LY.lib = 280;
    if (el.id === 'split-r') LY.side = 250;
    if (el.id === 'split-h') LY.tl = 300;
    applyLayout();
    saveLayout();
  });
}
dragSplit($('#split-l'), (dx, dy, st) => { LY.lib = st.lib + dx; });
dragSplit($('#split-r'), (dx, dy, st) => { LY.side = st.side - dx; });
dragSplit($('#split-h'), (dx, dy, st) => { LY.tl = st.tl - dy; });
window.addEventListener('resize', applyLayout);

// 素材库：触控板双指捏合（或Cmd＋滚轮）无级缩放缩略图，双指滑动照常滚动
$('#lib-grid').addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  LY.thumb = Math.min(420, Math.max(56, LY.thumb * Math.exp(-e.deltaY * 0.01)));
  $('#lib').style.setProperty('--thumb', LY.thumb + 'px');
  clearTimeout(applyLayout.t);
  applyLayout.t = setTimeout(saveLayout, 300);
}, { passive: false });

applyLayout();

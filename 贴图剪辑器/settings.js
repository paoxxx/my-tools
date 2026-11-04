// 设置：快速导出快捷键（可自定义）、清理缓存
const SET = { exportKey: 'Meta+E', recording: false };
const KEY_NAMES = { Meta: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' };
const prettyKey = k => k.split('+').map(x => KEY_NAMES[x] || (x.length === 1 ? x.toUpperCase() : x)).join('');
function keyOf(e) {
  const mods = [];
  if (e.metaKey) mods.push('Meta');
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const k = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key;
  return [...mods, k].join('+');
}
window.api.settingsGet().then(s => { if (s.exportKey) SET.exportKey = s.exportKey; $('#set-key').textContent = prettyKey(SET.exportKey); });

// 全局：按下快速导出快捷键
document.addEventListener('keydown', e => {
  if (SET.recording) return;
  if (!S.project || $('#editor').hidden || !$('#exp').hidden || !$('#set').hidden) return;
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  if (keyOf(e) === SET.exportKey) { e.preventDefault(); quickExport(); }
}, true);

const fmtB = b => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? Math.round(b / 1e6) + ' MB' : Math.round(b / 1e3) + ' KB');
async function scanCache() {
  const r = await window.api.cacheScan();
  $('#set-temp').textContent = r.tempBytes ? fmtB(r.tempBytes) : '没有';
  $('#set-clean').disabled = !r.tempBytes;
  $('#set-old').textContent = r.oldCount ? `${r.oldCount}个，${fmtB(r.oldBytes)}` : '没有';
  $('#set-clean-old').disabled = !r.oldCount;
}

$('#btn-set').onclick = () => {
  $('#set-key').textContent = prettyKey(SET.exportKey);
  $('#set').hidden = false;
  scanCache();
};
$('#set-close').onclick = () => { $('#set').hidden = true; SET.recording = false; };

$('#set-key').onclick = () => {
  SET.recording = true;
  $('#set-key').classList.add('rec');
  $('#set-key').textContent = '请按组合键…';
  $('#set-key-tip').textContent = '要带上⌘、⌃或⌥，按Esc取消';
};
document.addEventListener('keydown', async e => {
  if (!SET.recording) return;
  e.preventDefault();
  e.stopPropagation();
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return; // 等用户按完整组合
  SET.recording = false;
  $('#set-key').classList.remove('rec');
  $('#set-key-tip').textContent = '点按钮后，按下你想用的组合键';
  if (e.key === 'Escape') { $('#set-key').textContent = prettyKey(SET.exportKey); return; }
  if (!e.metaKey && !e.ctrlKey && !e.altKey) { $('#set-key').textContent = prettyKey(SET.exportKey); return toast('快捷键要带上⌘、⌃或⌥，避免打字时误触', true); }
  const k = keyOf(e);
  if (['Meta+Z', 'Meta+Shift+Z', 'Meta+V', 'Meta+C', 'Meta+Q', 'Meta+W'].includes(k)) {
    $('#set-key').textContent = prettyKey(SET.exportKey);
    return toast('这个组合键已经有别的用处了，换一个吧', true);
  }
  SET.exportKey = k;
  $('#set-key').textContent = prettyKey(k);
  await window.api.settingsSet({ exportKey: k });
  toast(`快速导出的快捷键改成了 ${prettyKey(k)}`);
}, true);

$('#set-clean').onclick = async () => {
  const freed = await window.api.cacheClean({ old: false, keepDir: S.dir });
  toast(`已清理 ${fmtB(freed)}`);
  scanCache();
};
$('#set-clean-old').onclick = async () => {
  if (!confirm('删除超过30天没打开过的项目文件夹？导出好的成片不会受影响。删除后不能恢复。')) return;
  const freed = await window.api.cacheClean({ old: true, keepDir: S.dir });
  toast(`已清理 ${fmtB(freed)}`);
  scanCache();
};

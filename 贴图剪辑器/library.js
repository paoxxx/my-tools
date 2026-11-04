// 左侧素材库：添加素材文件夹或单个文件，按层级浏览，缩略图＋文件名，拖到画面或时间轴上使用
// LIB.roots：加进来的文件夹路径；LIB.files：单独加进来的文件 [{path, kind, mtime}]
const LIB = { roots: [], files: [], cur: null, items: [], sel: null };
const libGrid = $('#lib-grid');
const libCrumb = $('#lib-crumb');
const baseName = p => p.split('/').filter(Boolean).pop() || p;

function libSetRoots(list) {
  LIB.roots = list.filter(x => x.kind === 'dir').map(x => x.path);
  LIB.files = list.filter(x => x.kind !== 'dir');
}
async function libInit() {
  libSetRoots(await window.api.libRoots());
  if (LIB.roots.length === 1 && !LIB.files.length) LIB.cur = LIB.roots[0];
  libShow();
}

function libRootOf(p) {
  return LIB.roots.filter(r => p === r || p.startsWith(r + '/')).sort((a, b) => b.length - a.length)[0];
}

async function libShow() {
  // 面包屑：全部 / 根文件夹 / 子文件夹 …
  libCrumb.replaceChildren();
  const crumb = (label, target, cur) => {
    const a = document.createElement('a');
    a.textContent = label;
    if (cur) a.className = 'cur';
    a.onclick = () => { LIB.cur = target; libShow(); };
    libCrumb.appendChild(a);
  };
  const sep = () => libCrumb.appendChild(Object.assign(document.createElement('span'), { textContent: '/' }));
  crumb('全部', null, !LIB.cur);
  if (LIB.cur) {
    const root = libRootOf(LIB.cur);
    const rel = LIB.cur.slice(root.length).split('/').filter(Boolean);
    sep();
    crumb(baseName(root), root, rel.length === 0);
    let acc = root;
    rel.forEach((part, i) => { acc += '/' + part; sep(); crumb(part, acc, i === rel.length - 1); });
  }

  if (!LIB.cur) {
    window.api.libWatch(null);
    // 全部：先列文件夹，再列单独加进来的文件（新的在前）
    LIB.items = LIB.roots.map(r => ({ name: baseName(r), path: r, kind: 'dir', root: true }))
      .concat([...LIB.files].sort((a, b) => b.mtime - a.mtime).map(f => ({ name: baseName(f.path), path: f.path, kind: f.kind, root: true })));
  } else {
    try { LIB.items = await window.api.libList(LIB.cur); }
    catch { toast('这个文件夹打不开了，可能被移动或删除了', true); LIB.cur = null; return libShow(); }
    window.api.libWatch(LIB.cur);
  }
  libRender();
}

function libRender() {
  const used = new Set((S.project ? S.project.stickers : []).map(s => s.src).filter(Boolean));
  const frag = document.createDocumentFragment();
  if (!LIB.items.length) {
    const d = document.createElement('div');
    d.className = 'lib-empty';
    d.innerHTML = LIB.cur
      ? '这个文件夹里还没有图片、GIF或视频'
      : '还没有添加素材<br>点右上角“添加”，可以选整个文件夹（比如截图素材库），也可以选单个图片、GIF、视频';
    frag.appendChild(d);
  }
  for (const it of LIB.items) {
    const el = document.createElement('div');
    el.className = 'lib-item' + (it.kind === 'dir' ? ' dir' : '');
    el.title = it.name;
    const th = document.createElement('div');
    th.className = 'th';
    if (it.kind === 'dir') {
      th.innerHTML = '<div class="folder-ic"></div>';
    } else if (it.kind === 'video') {
      const v = document.createElement('video');
      v.src = fileURL(it.path) + '#t=0.1';
      v.muted = true; v.preload = 'metadata';
      th.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = fileURL(it.path);
      th.appendChild(img);
    }
    el.appendChild(th);
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = it.kind === 'dir' && it.count !== undefined ? `${it.name}（${it.count}）` : it.name;
    el.appendChild(nm);
    if (it.kind === 'gif' || it.kind === 'video') {
      el.appendChild(Object.assign(document.createElement('span'), { className: 'tag', textContent: it.kind === 'gif' ? 'GIF' : '视频' }));
    }
    if (it.kind === 'dir') {
      el.onclick = () => { LIB.cur = it.path; libShow(); };
      if (it.root) {
        const x = document.createElement('span');
        x.className = 'tag used';
        x.textContent = '移除';
        x.title = '从素材库移除这个文件夹（不会删除文件）';
        x.style.cursor = 'pointer';
        x.onclick = async ev => {
          ev.stopPropagation();
          await window.api.libRemoveRoot(it.path);
          LIB.roots = LIB.roots.filter(r => r !== it.path);
          libShow();
        };
        el.appendChild(x);
      }
    } else {
      if (used.has(it.path)) el.appendChild(Object.assign(document.createElement('span'), { className: 'tag used', textContent: '已添加' }));
      const add = document.createElement('button');
      add.className = 'add';
      add.textContent = '+';
      add.title = '添加到播放头';
      add.onclick = ev => { ev.stopPropagation(); libAdd(it.path); };
      el.appendChild(add);
      el.ondblclick = () => libAdd(it.path);
      if (it.root) {
        // 单独加进来的文件：可以从素材库移除（不会删除文件）
        const x = document.createElement('button');
        x.className = 'rm';
        x.textContent = '×';
        x.title = '从素材库移除（不会删除文件）';
        x.onclick = async ev => {
          ev.stopPropagation();
          await window.api.libRemoveRoot(it.path);
          LIB.files = LIB.files.filter(f => f.path !== it.path);
          libShow();
        };
        el.appendChild(x);
      }
      el.draggable = true;
      el.ondragstart = ev => {
        ev.dataTransfer.setData(LIB_TYPE, it.path);
        ev.dataTransfer.effectAllowed = 'copy';
        const img = th.querySelector('img');
        if (img && img.complete) ev.dataTransfer.setDragImage(img, 30, 30);
      };
    }
    frag.appendChild(el);
  }
  libGrid.replaceChildren(frag);
}

function libAdd(p) {
  if (!S.project) return toast('先导入一个视频');
  addFromPaths([p]);
}
function refreshLibUsed() { libRender(); }

$('#lib-add').onclick = async () => {
  const added = await window.api.libAddRoot();
  if (!added || !added.length) return;
  for (const x of added) {
    if (x.kind === 'dir') { if (!LIB.roots.includes(x.path)) LIB.roots.push(x.path); }
    else if (!LIB.files.some(f => f.path === x.path)) LIB.files.push(x);
  }
  // 只加了一个文件夹：直接打开它；加的是文件或好几样：回到“全部”
  LIB.cur = added.length === 1 && added[0].kind === 'dir' ? added[0].path : null;
  libShow();
  const nd = added.filter(x => x.kind === 'dir').length, nf = added.length - nd;
  toast(`已添加${nd ? nd + '个文件夹' : ''}${nd && nf ? '、' : ''}${nf ? nf + '个文件' : ''}`, false, 1400);
};
window.api.onLibChanged(dir => { if (dir === LIB.cur) libShow(); });

libInit();

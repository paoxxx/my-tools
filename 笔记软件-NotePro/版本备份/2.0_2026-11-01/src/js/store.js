/* 笔记存取：桌面版走主进程（存到“文稿/笔记软件”），浏览器调试时退回 localStorage */
(function () {
  const hasApi = !!window.api;
  const LS = 'bjnotes:';
  const mem = {};
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } },
    keys() { try { return Object.keys(localStorage); } catch (e) { return Object.keys(mem); } },
  };
  window.Store = {
    hasApi,
    async list() {
      if (hasApi) return window.api.list();
      return ls.keys().filter((k) => k.startsWith(LS)).map((k) => {
        const d = JSON.parse(ls.get(k));
        return { id: d.id, title: d.title, modified: d.modified, created: d.created };
      }).sort((a, b) => b.modified - a.modified);
    },
    async load(id) {
      if (hasApi) return window.api.load(id);
      const v = ls.get(LS + id);
      return v ? JSON.parse(v) : null;
    },
    async save(doc) {
      if (hasApi) return window.api.save(doc);
      ls.set(LS + doc.id, JSON.stringify(doc));
      return true;
    },
    async remove(id) {
      if (hasApi) return window.api.remove(id);
      ls.del(LS + id);
      return true;
    },
    async saveAsset(ref, url) {
      if (hasApi) return window.api.saveAsset(ref, url);
      ls.set('bjasset:' + ref, url);
      return true;
    },
    async loadAsset(ref) {
      if (hasApi) return window.api.loadAsset(ref);
      return ls.get('bjasset:' + ref);
    },
    async exportPDF(doc, assets, mode, opts) {
      if (hasApi) return window.api.exportPDF(doc, assets, mode, opts);
      window.__lastExport = doc;
      return { ok: false, msg: '浏览器调试模式不支持导出' };
    },
    pref(key, val) {
      if (val === undefined) { const v = ls.get('bjpref:' + key); return v ? JSON.parse(v) : null; }
      ls.set('bjpref:' + key, JSON.stringify(val));
    },
  };
})();

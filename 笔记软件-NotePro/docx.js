/* 生成可编辑的 Word（.docx）：只有文字。
   保留字号、加粗、颜色、高亮底色、下划线；批注变成 Word 批注挂在对应的那一行上。不需要外部库。 */
const zlib = require('zlib');

/* ---------- 极简 zip ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/* ---------- 文字样式 ---------- */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FONT_NAMES = { sans: 'PingFang SC', serif: 'Songti SC', kai: 'Kaiti SC', smiley: '得意黑', qingsong: '清松手写体', longcang: '龙藏体', zhimang: '志莽行书' };
function fontName(key, customFonts) {
  if (FONT_NAMES[key]) return FONT_NAMES[key];
  if (key && key.startsWith('u:')) { const f = (customFonts || []).find((x) => 'u:' + x.id === key); if (f) return f.name; }
  return 'PingFang SC';
}
function normalize(t) { return String(t || '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/ /g, ' '); }
function charStyles(it, n) {
  if (it.locked && it.pal && it.cst) return Array.from({ length: n }, (_, i) => it.pal[it.cst[i]] || it.pal[0]);
  const out = [];
  for (const r of it.runs || []) for (let i = 0; i < r.n && out.length < n; i++) out.push({ s: r.s, b: r.b, c: r.c });
  const last = out.length ? out[out.length - 1] : { s: it.size || 16, b: it.bold ? 1 : 0, c: null };
  while (out.length < n) out.push(last);
  return out;
}
// 高亮色带透明度时，按白底混合成实色
function solidHex(c) {
  if (!c) return null;
  const h = c.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  const mix = (v) => Math.round(v * a + 255 * (1 - a)).toString(16).padStart(2, '0');
  return (mix(r) + mix(g) + mix(b)).toUpperCase();
}
function rPr(st, m, font) {
  const sz = Math.max(2, Math.round((st.s || 16) * 1.5)); // px → 半磅
  let x = `<w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:eastAsia="${esc(font)}" w:cs="${esc(font)}"/>`;
  if (st.b || (m && m.b)) x += '<w:b/><w:bCs/>';
  if (st.c) x += `<w:color w:val="${st.c.replace('#', '').slice(0, 6)}"/>`;
  x += `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
  if (m && m.u) x += '<w:u w:val="single"/>';
  if (m && m.bg) x += `<w:shd w:val="clear" w:color="auto" w:fill="${solidHex(m.bg)}"/>`;
  return `<w:rPr>${x}</w:rPr>`;
}
const run = (props, text) => `<w:r>${props}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

function buildDocx(doc, customFonts) {
  const notes = (doc.notes || []).filter((n) => n.text && n.text.trim());
  // 批注挂到哪一段：r:块id:行号 → 这一行的字符范围
  const byBlock = {};
  const loose = [];
  notes.forEach((n, i) => {
    const m = /^r:(.+):(\d+)$/.exec(n.a || '');
    const mi = /^i:(.+)$/.exec(n.a || '');
    const bid = m ? m[1] : mi ? mi[1] : null;
    const it = bid && doc.items.find((x) => x.id === bid);
    if (!it) { loose.push(n); return; }
    let s = 0, e = 0;
    if (m && it.locked && it.lines && it.lines[+m[2]]) {
      let k = +m[2];
      while (k < it.lines.length && it.lines[k].e === it.lines[k].s) k++;
      const L = it.lines[Math.min(k, it.lines.length - 1)];
      s = L.s; e = L.e;
    } else {
      const chars = Array.from(normalize(it.text));
      const nl = chars.indexOf('\n');
      s = 0; e = nl < 0 ? chars.length : nl;
    }
    if (e <= s) { loose.push(n); return; }
    (byBlock[it.id] = byBlock[it.id] || []).push({ id: i, s, e, n });
  });

  const body = [];
  const pPr = '<w:pPr><w:spacing w:line="360" w:lineRule="auto" w:after="0"/><w:jc w:val="both"/></w:pPr>';
  doc.items.forEach((it, bi) => {
    if (it.type === 'mind') {
      // 思维导图转成分级大纲
      if (bi > 0) body.push(`<w:p>${pPr}</w:p>`);
      const font = fontName(it.font || 'sans', customFonts);
      const walk = (n, lv) => {
        const sz = lv === 0 ? 22 : lv === 1 ? 16 : 14;
        const ind = lv * 420;
        const bullet = lv === 0 ? '' : lv === 1 ? '● ' : '○ ';
        String(n.text || '').split('\n').forEach((line, i) => {
          body.push(`<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto" w:after="0"/><w:ind w:left="${ind}"/></w:pPr>${run(rPr({ s: sz, b: lv <= 1 ? 1 : 0 }, null, font), (i === 0 ? bullet : '') + line)}</w:p>`);
        });
        (n.children || []).forEach((c) => walk(c, lv + 1));
      };
      walk(it.root, 0);
      return;
    }
    if (it.type !== 'text') return;
    const chars = Array.from(normalize(it.text));
    const styles = charStyles(it, chars.length);
    const marks = it.locked ? (it.marks || {}) : {};
    const font = fontName(it.font, customFonts);
    const cms = byBlock[it.id] || [];
    const startAt = {}, endAt = {};
    cms.forEach((c) => { (startAt[c.s] = startAt[c.s] || []).push(c.id); (endAt[c.e - 1] = endAt[c.e - 1] || []).push(c.id); });
    if (bi > 0) body.push(`<w:p>${pPr}</w:p>`);
    let para = '', buf = '', bufKey = null, bufProps = '';
    const flush = () => { if (buf) para += run(bufProps, buf); buf = ''; bufKey = null; };
    const endPara = () => { flush(); body.push(`<w:p>${pPr}${para}</w:p>`); para = ''; };
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (startAt[i]) { flush(); startAt[i].forEach((id) => { para += `<w:commentRangeStart w:id="${id}"/>`; }); }
      if (ch === '\n') { endPara(); continue; }
      const st = styles[i] || {}, m = marks[i];
      const key = JSON.stringify([st.s, st.b, st.c, m && m.bg, m && m.b, m && m.u]);
      if (key !== bufKey) { flush(); bufKey = key; bufProps = rPr(st, m, font); }
      buf += ch;
      if (endAt[i]) {
        flush();
        endAt[i].forEach((id) => { para += `<w:commentRangeEnd w:id="${id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`; });
      }
    }
    endPara();
  });
  if (loose.length) {
    body.push(`<w:p>${pPr}</w:p>`);
    loose.forEach((n) => {
      String(n.text).split('\n').forEach((line) => {
        body.push(`<w:p>${pPr}${run(rPr({ s: n.s, c: n.c }, null, fontName(n.f, customFonts)), line)}</w:p>`);
      });
    });
  }
  const mm = { normal: [25.4, 31.8], moderate: [25.4, 19.1], narrow: [12.7, 12.7] }[doc.margin || 'normal'] || [25.4, 31.8];
  const tw = (v) => Math.round(v * 56.6929);
  const sect = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${tw(mm[0])}" w:right="${tw(mm[1])}" w:bottom="${tw(mm[0])}" w:left="${tw(mm[1])}" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>`;
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join('')}${sect}</w:body></w:document>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const comments = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${W}>${Object.values(byBlock).flat().map((c) =>
    `<w:comment w:id="${c.id}" w:author="批改" w:date="${now}" w:initials="批">${String(c.n.text).split('\n').map((line) =>
      `<w:p>${run(`<w:rPr><w:color w:val="${String(c.n.c || '#FF0000').replace('#', '').slice(0, 6)}"/></w:rPr>`, line)}</w:p>`).join('')}</w:comment>`).join('')}</w:comments>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="PingFang SC" w:hAnsi="PingFang SC" w:eastAsia="PingFang SC" w:cs="PingFang SC"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style></w:styles>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>`;
  return zip([
    ['[Content_Types].xml', types],
    ['_rels/.rels', rels],
    ['word/document.xml', document],
    ['word/styles.xml', styles],
    ['word/comments.xml', comments],
    ['word/_rels/document.xml.rels', docRels],
  ]);
}

module.exports = { buildDocx };

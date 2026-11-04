// 字级时间整理 + 本地规则分段（浏览器和 node 都能用）
(function (root) {
  // 把豆包返回的分句整理成“字块”：每个字块带时间，标点跟在前一个字块后面
  function buildTokens(utterances) {
    const tokens = [];
    (utterances || []).forEach((u, ui) => {
      const text = u.text || '';
      let pos = 0;
      (u.words || []).forEach((w) => {
        if (!w || w.start_time == null || w.start_time < 0 || !w.text || !w.text.trim()) return;
        let idx = text.indexOf(w.text, pos);
        if (idx < 0) idx = pos;
        const gap = text.slice(pos, idx);
        if (gap) {
          if (tokens.length) tokens[tokens.length - 1].tail += gap;
          else tokens.push({ t: '', s: w.start_time, e: w.start_time, u: ui, tail: gap, head: true });
        }
        tokens.push({ t: w.text, s: w.start_time, e: w.end_time, u: ui, tail: '' });
        pos = idx + w.text.length;
      });
      const rest = text.slice(pos);
      if (rest && tokens.length) tokens[tokens.length - 1].tail += rest;
    });
    // 开头只有标点的占位字块并入下一个字块
    if (tokens.length > 1 && tokens[0].head) { tokens[1].lead = tokens[0].tail; tokens.shift(); }
    // 去掉中文之间多余的空格，英文数字之间的空格保留
    tokens.forEach((tk, i) => {
      if (!/\s/.test(tk.tail)) return;
      const next = tokens[i + 1];
      const keep = next && /[A-Za-z0-9]$/.test(tk.t) && /^[A-Za-z0-9]/.test(next.t) && /^\s+$/.test(tk.tail);
      tk.tail = keep ? ' ' : tk.tail.replace(/\s+/g, '');
    });
    return tokens;
  }

  const FILL = '(?:(?:那么|那|然后|好|所以说|所以|就是|对|呃|嗯|啊)[，、,]?){0,2}';
  const STRONG = new RegExp('^' + FILL + '(?:首先|其次|再次|再者|其一|其二|其三|其四|一方面|另一方面|第[一二三四五六七八九十]+(?![次年届天批季名位章条轮遍回])(?:点|个|方面|步|是)?|[一二三四五六七]是)');
  const WEAK = new RegExp('^' + FILL + '(?:最后|最终|总之|综上|总的来说|另外|此外|再说)');
  const SENT_END = /[。？！?!…]/;
  const CLAUSE_END = /[，、,；;。？！?!…]/;

  // 返回每段起始的字块下标（含 0）
  function paragraphStarts(tokens) {
    const starts = [0];
    for (let i = 1; i < tokens.length; i++) {
      const prev = tokens[i - 1].tail;
      if (!CLAUSE_END.test(prev)) continue;
      let ahead = '';
      for (let k = i; k < Math.min(tokens.length, i + 10); k++) ahead += tokens[k].t;
      if (STRONG.test(ahead) || (SENT_END.test(prev) && WEAK.test(ahead))) starts.push(i);
    }
    return starts;
  }

  // 整理成：段落 -> 句子 -> 字块下标
  function layout(tokens) {
    const starts = paragraphStarts(tokens);
    const paras = [];
    starts.forEach((st, pi) => {
      const en = pi + 1 < starts.length ? starts[pi + 1] : tokens.length;
      const sents = [];
      let cur = [];
      for (let i = st; i < en; i++) {
        cur.push(i);
        if (SENT_END.test(tokens[i].tail)) { sents.push(cur); cur = []; }
      }
      if (cur.length) sents.push(cur);
      paras.push(sents);
    });
    return paras;
  }

  function tokenText(tk) { return (tk.lead || '') + tk.t + tk.tail; }
  function paraText(tokens, para) {
    return para.map((s) => s.map((i) => tokenText(tokens[i])).join('')).join('');
  }
  function fullText(tokens) {
    return layout(tokens).map((p) => paraText(tokens, p)).join('\n\n');
  }

  const api = { buildTokens, paragraphStarts, layout, paraText, fullText, tokenText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Seg = api;
})(typeof window !== 'undefined' ? window : this);

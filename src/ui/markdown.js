import { html, useMemo } from '../lib.js';

// 把一份 Markdown 画成页面。给应用里的说明页用（比如后台消息的部署教程，worker/PUSH.md），
// 只认那几份文档里用到的写法：标题、段落、列表、引用、代码块、表格、粗体、行内代码、链接、分隔线。
//
// 先整段转义再加标签，文档里写什么都只会是文字，不会变成脚本。
// 链接只保留 http(s) 的，在新窗口打开（外壳里交给系统浏览器）；相对链接只留文字 ——
// 在应用里点开仓库里的文件没有意义，要复制的代码由那一页自己给按钮。

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(raw) {
  let s = esc(raw);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => (/^https?:\/\//i.test(u)
    ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : t));
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

// 折行接起来：两边都是英文字母或数字才补一个空格，中文之间不加
function joinLines(parts) {
  return parts.map(x => x.trim()).filter(Boolean).reduce((acc, t) =>
    (acc && /[A-Za-z0-9]$/.test(acc) && /^[A-Za-z0-9]/.test(t) ? `${acc} ${t}` : acc + t), '');
}

const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

function toHtml(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i += 1;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i += 1; continue; }
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i += 1; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(joinLines(buf))}</blockquote>`);
      continue;
    }
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m) { items.push(m[3]); i += 1; continue; }
        // 列表项下面缩进的续行（含缩进的代码块）并进上一项
        if (/^\s{2,}\S/.test(lines[i]) && items.length) {
          if (/^\s+```/.test(lines[i])) {
            const buf = [];
            i += 1;
            while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++].trim());
            i += 1;
            items[items.length - 1] += `\u0001${buf.join('\n')}\u0001`;
            continue;
          }
          items[items.length - 1] = joinLines([items[items.length - 1], lines[i]]);
          i += 1;
          continue;
        }
        break;
      }
      const render = t => t.split('\u0001').map((part, k) => (k % 2 ? `<pre><code>${esc(part)}</code></pre>` : inline(part))).join('');
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(t => `<li>${render(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*\||---+\s*$|\s*([-*]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) { buf.push(lines[i++]); }
    out.push(`<p>${inline(joinLines(buf))}</p>`);
  }
  return out.join('\n');
}

export function Markdown({ text }) {
  const inner = useMemo(() => toHtml(text), [text]);
  return html`<div class="md" dangerouslySetInnerHTML=${{ __html: inner }}></div>`;
}

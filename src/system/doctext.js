import { readZip } from './unzip.js';
import { zip } from './zip.js';

// 从 docx / txt 里把纯文字抠出来。表情包那边也解析 docx，但它要的是
// 「一行一个表情」的结构；这里要的是整篇正文，所以单独一个函数。

export const ACCEPT = '.txt,.md,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const unescape = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

export async function docxText(file) {
  const zip = await readZip(file);
  const xml = await zip.text('word/document.xml');
  if (!xml) throw new Error('这个 docx 里没找到正文');
  // 每个 <w:p> 是一段，段内的 <w:t> 拼起来；<w:br> 当换行
  return xml.split(/<w:p[\s>]/).slice(1).map(para => {
    const withBreaks = para.replace(/<w:br\s*\/?>/g, '\n');
    return unescape((withBreaks.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
      .map(t => t.replace(/<[^>]+>/g, '')).join(''));
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function readText(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.docx') || /officedocument\.wordprocessingml/.test(file.type || '')) {
    return docxText(file);
  }
  const text = await file.text();
  if (/^PK\x03\x04/.test(text.slice(0, 4))) {
    throw new Error('这看着是个压缩包。docx 请直接选 .docx 文件');
  }
  return text.replace(/\r\n/g, '\n').trim();
}

// ---- 写 ----
// 世界书导出、美化包导出共用

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 文本写成一份最小的 docx：一行一段，# 与 ## 开头的行加粗 */
export async function toDocx(text) {
  const paras = String(text).split('\n').map(line => {
    const head = /^#{1,2}\s/.test(line);
    const run = `<w:r>${head ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xml(line)}</w:t></w:r>`;
    return `<w:p>${line ? run : ''}</w:p>`;
  }).join('');
  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${paras}</w:body></w:document>`;
  return zip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" '
      + 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
      + 'Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', text: doc },
  ]).then(b => new Blob([b], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
}

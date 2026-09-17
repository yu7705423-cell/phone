import { readZip } from './unzip.js';

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

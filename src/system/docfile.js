import { readZip } from './unzip.js';
import { zip } from './zip.js';
import { messages, files, chats } from './db/index.js';

// 聊天里的文件：我发过去、角色填好发回来、角色从头写一份。见 ARCHITECTURE 4.271
//
// 只认五种：txt、md、csv、docx、xlsx。docx 与 xlsx 可以「在原文件上填」：
// 拆开时给每一段、每一格一个固定编号（docx 是 #n，xlsx 是单元格坐标），角色读到的正文里带着编号，
// 填的时候只交回「几号填什么」；落库时打开原文件，找到那一段，保留它原有的样式标记，只换里面的字。
// 不重画整篇 —— 重画等于把字体、边框、图片全丢掉。
//
// 位置不靠数（「第 3 行第 2 格」模型会数错，而且不报错），靠编号。

export const EXTS = ['txt', 'md', 'csv', 'docx', 'xlsx'];
export const FILL_EXTS = new Set(['docx', 'xlsx']);
export const ACCEPT = '.txt,.md,.csv,.docx,.xlsx';
const MIME = {
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export const mimeOf = ext => MIME[ext] || 'application/octet-stream';
export const extOf = name => {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m && EXTS.includes(m[1]) ? m[1] : '';
};
export const fillable = ext => FILL_EXTS.has(ext);

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

// ---- docx ----

/** 一段的文字：<w:t> 拼起来，<w:tab/> 是制表，<w:br/> 是换行 */
function paraText(p) {
  return unesc(p.replace(/<w:tab\s*\/>/g, '\t').replace(/<w:br\s*\/>/g, '\n')
    .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (_, t) => t)
    .replace(/<[^>]+>/g, ''));
}

/**
 * 把正文拆成编了号的条目。回来的每一条：{ id, kind: 'p' | 'cell', start, end, text }，
 * start / end 是它在 document.xml 里的位置（cell 是整个 <w:tc>，p 是整个 <w:p>）。
 * 表格里的段落不单独编号，一格一个号。嵌套的表格按外层那一格算。
 */
function scanDocx(xml) {
  const items = [];
  const tokens = /<w:tbl>|<\/w:tbl>|<w:tc(?=[\s>])|<\/w:tc>|<w:tr(?=[\s>])|<\/w:tr>|<w:p(?=[\s>/])|<\/w:p>|\/>/g;
  let m;
  let tbl = 0;        // 表格嵌套深度
  let cell = null;    // 正在读的那一格 { start, depth }
  let para = null;    // 正在读的那一段（只在表格外）
  let row = null;
  const rows = [];    // 每一行的格子编号，拼正文时用
  while ((m = tokens.exec(xml))) {
    const t = m[0];
    if (t === '<w:tbl>') { tbl++; continue; }
    if (t === '</w:tbl>') { tbl--; continue; }
    if (t === '<w:tr') { if (tbl === 1) { row = []; } continue; }
    if (t === '</w:tr>') { if (tbl === 1 && row) { rows.push(row); row = null; } continue; }
    if (t === '<w:tc') { if (tbl === 1 && !cell) cell = { start: m.index, depth: 0 }; else if (cell) cell.depth++; continue; }
    if (t === '</w:tc>') {
      if (!cell) continue;
      if (cell.depth > 0) { cell.depth--; continue; }
      const end = m.index + t.length;
      const body = xml.slice(cell.start, end);
      const text = (body.match(/<w:p(?:[\s>][\s\S]*?<\/w:p>|\/>)/g) || []).map(paraText).join('\n').trim();
      const it = { id: '', kind: 'cell', start: cell.start, end, text };
      items.push(it);
      if (row) row.push(it);
      cell = null;
      continue;
    }
    if (t === '<w:p') {
      if (tbl === 0 && !cell) para = { start: m.index };
      continue;
    }
    if (t === '/>') {
      // 自闭合的 <w:p/>：空段
      if (para && xml.slice(para.start, m.index + 2).indexOf('>') === m.index + 1 - para.start) {
        items.push({ id: '', kind: 'p', start: para.start, end: m.index + 2, text: '' });
        para = null;
      }
      continue;
    }
    if (t === '</w:p>') {
      if (para) {
        const end = m.index + t.length;
        items.push({ id: '', kind: 'p', start: para.start, end, text: paraText(xml.slice(para.start, end)).trim() });
        para = null;
      }
    }
  }
  items.sort((a, b) => a.start - b.start);
  items.forEach((it, i) => { it.id = `#${i + 1}`; });
  return { items, rows };
}

/** 角色读到的正文：段落一行一条，表格一行一条、格子用竖线分开，每一条前面是编号 */
function numberedDocx({ items, rows }) {
  const inRow = new Set(rows.flat());
  const rowOf = new Map();
  rows.forEach(r => r.forEach(c => rowOf.set(c, r)));
  const out = [];
  const done = new Set();
  for (const it of items) {
    if (done.has(it)) continue;
    if (inRow.has(it)) {
      const r = rowOf.get(it);
      r.forEach(c => done.add(c));
      out.push(r.map(c => `${c.id} ${c.text.replace(/\n/g, ' ')}`.trim()).join(' | '));
    } else {
      out.push(`${it.id} ${it.text}`.trim());
    }
  }
  return out.join('\n');
}

/** 一段换成新文字：保留 <w:p> 的属性、段落属性、第一个 run 的样式，其余的 run 全去掉 */
function rewriteParagraph(p, text) {
  const open = p.match(/^<w:p(\s[^>]*?)?\s*\/?>/);
  const attrs = open && open[1] ? open[1] : '';
  const pPr = (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
  const afterPr = pPr ? p.slice(p.indexOf(pPr) + pPr.length) : p;
  const run = afterPr.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/);
  const rPr = run ? (run[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0] : '';
  const lines = String(text).split('\n');
  const body = lines.map((l, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(l)}</w:t>`).join('');
  return `<w:p${attrs}>${pPr}<w:r>${rPr}${body}</w:r></w:p>`;
}

/** 一格换成新文字：第一段照 rewriteParagraph 改，其余段落去掉（格子里至少要留一段） */
function rewriteCell(tc, text) {
  const paras = tc.match(/<w:p(?:[\s>][\s\S]*?<\/w:p>|\/>)/g) || [];
  if (!paras.length) return tc.replace(/<\/w:tc>$/, `${rewriteParagraph('<w:p/>', text)}</w:tc>`);
  const first = paras[0];
  let out = tc.slice(0, tc.indexOf(first)) + rewriteParagraph(first, text);
  let rest = tc.slice(tc.indexOf(first) + first.length);
  for (let i = 1; i < paras.length; i++) rest = rest.replace(paras[i], '');
  return out + rest;
}

async function docxParts(blob) {
  const z = await readZip(blob);
  const xml = await z.text('word/document.xml');
  if (!xml) throw new Error('这个 docx 里没找到正文');
  return { z, xml };
}

export async function readDocx(blob) {
  const { xml } = await docxParts(blob);
  const scan = scanDocx(xml);
  return { text: numberedDocx(scan), slots: scan.items.length };
}

/** 在原文件上填。fills 是 [{ id: '#3', text }]，不认识的编号跳过。回来的是新的 docx */
export async function fillDocx(blob, fills) {
  const { z, xml } = await docxParts(blob);
  const { items } = scanDocx(xml);
  const byId = new Map(items.map(it => [it.id, it]));
  const todo = [];
  for (const f of fills || []) {
    const it = byId.get(String(f.id || '').trim());
    if (it) todo.push({ it, text: String(f.text ?? '') });
  }
  // 从后往前换，前面的位置才不会挪
  todo.sort((a, b) => b.it.start - a.it.start);
  let out = xml;
  for (const { it, text } of todo) {
    const piece = out.slice(it.start, it.end);
    out = out.slice(0, it.start) + (it.kind === 'cell' ? rewriteCell(piece, text) : rewriteParagraph(piece, text)) + out.slice(it.end);
  }
  return repack(z, { 'word/document.xml': out }, MIME.docx);
}

/** 把 zip 里的几个条目换掉，其余原样抄一遍 */
async function repack(z, replace, type) {
  const entries = [];
  for (const e of z.entries) {
    if (e.name.endsWith('/')) continue;
    if (replace[e.name] !== undefined) entries.push({ name: e.name, text: replace[e.name] });
    else entries.push({ name: e.name, blob: await z.blob(e.name) });
  }
  for (const [name, text] of Object.entries(replace)) {
    if (!z.has(name)) entries.push({ name, text });
  }
  return zip(entries).then(b => new Blob([b], { type }));
}

// ---- xlsx ----

const colOf = ref => ref.match(/^[A-Z]+/)[0];
const rowOf = ref => Number(ref.match(/\d+$/)[0]);
const colNum = c => [...c].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);

async function xlsxParts(blob) {
  const z = await readZip(blob);
  const wb = await z.text('xl/workbook.xml');
  if (!wb) throw new Error('这个 xlsx 里没找到工作簿');
  const rels = await z.text('xl/_rels/workbook.xml.rels') || '';
  const relMap = new Map();
  rels.replace(/<Relationship\s[^>]*>/g, tag => {
    const id = (tag.match(/\sId="([^"]+)"/) || [])[1];
    const target = (tag.match(/\sTarget="([^"]+)"/) || [])[1];
    if (id && target) relMap.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    return tag;
  });
  const sheets = [];
  wb.replace(/<sheet\s[^>]*>/g, tag => {
    const name = unesc((tag.match(/\sname="([^"]*)"/) || [])[1] || '');
    const rid = (tag.match(/\sr:id="([^"]+)"/) || tag.match(/\s[a-z]+:id="([^"]+)"/) || [])[1];
    const path = relMap.get(rid);
    if (path) sheets.push({ name, path });
    return tag;
  });
  const ss = await z.text('xl/sharedStrings.xml') || '';
  const shared = (ss.match(/<si>[\s\S]*?<\/si>/g) || []).map(si =>
    unesc((si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')));
  return { z, sheets, shared };
}

function cellsOf(xml, shared) {
  const out = [];
  const re = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const ref = (m[1].match(/\sr="([^"]+)"|^r="([^"]+)"/) || []);
    const r = ref[1] || ref[2];
    if (!r) continue;
    const t = (m[1].match(/\bt="([^"]+)"/) || [])[1] || '';
    const inner = m[2] || '';
    let v = '';
    if (t === 's') v = shared[Number((inner.match(/<v>([^<]*)<\/v>/) || [])[1])] ?? '';
    else if (t === 'inlineStr') v = unesc((inner.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || []).map(x => x.replace(/<[^>]+>/g, '')).join(''));
    else v = unesc((inner.match(/<v>([^<]*)<\/v>/) || [])[1] || '');
    out.push({ ref: r, text: v });
  }
  return out;
}

export async function readXlsx(blob) {
  const { z, sheets, shared } = await xlsxParts(blob);
  const many = sheets.length > 1;
  const out = [];
  let slots = 0;
  for (const s of sheets) {
    const xml = await z.text(s.path) || '';
    const cells = cellsOf(xml, shared).filter(c => c.text !== '');
    if (many) out.push(`[表：${s.name}]`);
    const byRow = new Map();
    cells.forEach(c => { const r = rowOf(c.ref); if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push(c); });
    for (const [, list] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
      out.push(list.map(c => `${many ? `${s.name}!` : ''}${c.ref} ${c.text.replace(/\n/g, ' ')}`).join(' | '));
      slots += list.length;
    }
  }
  return { text: out.join('\n'), slots };
}

/** 一格换成文字（inlineStr）。没有那一格就按列序插进去，没有那一行就按行序插一行 */
function putCell(xml, ref, text) {
  const r = rowOf(ref);
  const cell = `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
  const rowRe = new RegExp(`<row\\s[^>]*\\br="${r}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`);
  const rm = xml.match(rowRe);
  if (!rm) {
    // 插一行：找第一个行号更大的行，插在它前面；没有就插在 </sheetData> 前
    const rows = [...xml.matchAll(/<row\s[^>]*\br="(\d+)"/g)];
    const after = rows.find(x => Number(x[1]) > r);
    const at = after ? after.index : xml.indexOf('</sheetData>');
    if (at < 0) throw new Error('这张表里没找到数据区');
    return xml.slice(0, at) + `<row r="${r}">${cell}</row>` + xml.slice(at);
  }
  let row = rm[0];
  if (row.endsWith('/>')) row = row.slice(0, -2) + '></row>';
  const cellRe = new RegExp(`<c\\s[^>]*\\br="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
  const cm = row.match(cellRe);
  let next;
  if (cm) {
    // 样式号留着，字体边框才在
    const style = (cm[0].match(/\ss="(\d+)"/) || [])[1];
    next = row.replace(cm[0], style ? cell.replace('<c ', `<c s="${style}" `) : cell);
  } else {
    const cells = [...row.matchAll(/<c\s[^>]*\br="([A-Z]+)\d+"/g)];
    const after = cells.find(x => colNum(x[1]) > colNum(colOf(ref)));
    const at = after ? after.index : row.lastIndexOf('</row>');
    next = row.slice(0, at) + cell + row.slice(at);
  }
  return xml.replace(rm[0], next);
}

export async function fillXlsx(blob, fills) {
  const { z, sheets } = await xlsxParts(blob);
  const changed = {};
  for (const f of fills || []) {
    const id = String(f.id || '').trim().toUpperCase();
    const m = id.match(/^(?:(.+)!)?([A-Z]+\d+)$/);
    if (!m) continue;
    const sheet = m[1] ? sheets.find(s => s.name.toUpperCase() === m[1]) : sheets[0];
    if (!sheet) continue;
    const xml = changed[sheet.path] ?? (await z.text(sheet.path));
    if (!xml) continue;
    changed[sheet.path] = putCell(xml, m[2], String(f.text ?? ''));
  }
  return repack(z, changed, MIME.xlsx);
}

// ---- 从头写一份 ----

/** 几行连着都带竖线的，就是一张表 */
function blocksOf(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let table = null;
  for (const line of lines) {
    const isRow = /\|/.test(line) && !/^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)*\|?\s*$/.test(line);
    const isRule = /^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)*\|?\s*$/.test(line) && /\|/.test(line);
    if (isRule) continue;
    if (isRow) {
      // Markdown 那种两头带竖线的（| a | b |）两头都去掉；不带头的，末尾的竖线表示最后一格空着
      const md = /^\s*\|/.test(line);
      const cells = (md ? line.replace(/^\s*\|/, '').replace(/\|\s*$/, '') : line).split('|').map(s => s.trim());
      if (!table) { table = { table: true, rows: [] }; out.push(table); }
      table.rows.push(cells);
    } else { table = null; out.push({ line }); }
  }
  return out;
}

const BORDERS = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('') + '</w:tblBorders>';

export async function makeDocx(text) {
  const body = blocksOf(text).map(b => {
    if (b.table) {
      const n = Math.max(...b.rows.map(r => r.length));
      const rows = b.rows.map(r => `<w:tr>${Array.from({ length: n }, (_, i) =>
        `<w:tc>${rewriteParagraph('<w:p/>', r[i] || '')}</w:tc>`).join('')}</w:tr>`).join('');
      return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${BORDERS}</w:tblPr>${rows}</w:tbl>`;
    }
    const head = /^#{1,3}\s/.test(b.line);
    const line = head ? b.line.replace(/^#{1,3}\s/, '') : b.line;
    return line
      ? `<w:p><w:r>${head ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`
      : '<w:p/>';
  }).join('');
  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${body}</w:body></w:document>`;
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
  ]).then(b => new Blob([b], { type: MIME.docx }));
}

const colName = n => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

export async function makeXlsx(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
  const rows = lines.map((l, i) => {
    const cells = /\|/.test(l) ? l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|')
      : /\t/.test(l) ? l.split('\t') : l.split(',');
    return `<row r="${i + 1}">${cells.map((c, j) =>
      `<c r="${colName(j + 1)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(c.trim())}</t></is></c>`).join('')}</row>`;
  }).join('');
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<sheetData>${rows}</sheetData></worksheet>`;
  return zip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '</Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>' },
    { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '</Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', text: sheet },
  ]).then(b => new Blob([b], { type: MIME.xlsx }));
}

// ---- 统一入口 ----

/** 读一份文件：{ ext, text（带编号的正文）, slots } */
export async function read(file, name = file?.name) {
  const ext = extOf(name);
  if (!ext) throw new Error('只支持 txt、md、csv、docx、xlsx');
  if (ext === 'docx') return { ext, ...(await readDocx(file)) };
  if (ext === 'xlsx') return { ext, ...(await readXlsx(file)) };
  const text = (await file.text()).replace(/\r\n/g, '\n').trim();
  if (/^PK\x03\x04/.test(text.slice(0, 4))) throw new Error('这是一个压缩包，不是文本文件');
  return { ext, text, slots: 0 };
}

export async function fill(blob, ext, fills) {
  if (ext === 'docx') return fillDocx(blob, fills);
  if (ext === 'xlsx') return fillXlsx(blob, fills);
  throw new Error('这种文件不能在原文件上填');
}

export async function make(ext, body) {
  if (ext === 'docx') return makeDocx(body);
  if (ext === 'xlsx') return makeXlsx(body);
  return new Blob([String(body)], { type: MIME[ext] || MIME.txt });
}

export const sizeText = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n || 0} B`);

// ---- 落成消息 ----

/** 我发一份文件：存进文件域，落一条 kind: 'file' 的消息，正文带编号供角色读 */
export async function sendFromUser(chatId, file) {
  const name = String(file.name || '文件');
  const ext = extOf(name);
  if (!ext) throw new Error('只支持 txt、md、csv、docx、xlsx');
  const { text, slots } = await read(file, name);
  const fileId = await files.put(file, { name, type: mimeOf(ext) });
  const chat = chats.get(chatId);
  const msg = messages.create({
    chatId, role: 'user', authorId: 'me', kind: 'file', status: 'done', media: 'done',
    fileId, name, ext, size: file.size || 0, text, slots, content: `[文件：${name}]`,
    ...(chat?.face?.on === true ? { side: 'face' } : {}),
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}

/** 这段会话里最近一份我发的、能在原文件上填的文件 */
export function latestFillable(chatId) {
  const list = messages.where(m => m.chatId === chatId && m.kind === 'file' && m.role === 'user' && fillable(m.ext) && m.fileId);
  return list.length ? list[list.length - 1] : null;
}

/** 落一条角色发出的文件消息（先占位，文件造好再补上 fileId）。造不出来在气泡上说明，不只记控制台 */
function deliver(base, { name, ext, preview = '', fills = null, srcId = '' }, job) {
  const msg = messages.create({
    ...base, kind: 'file', status: 'done', media: 'pending',
    fileId: null, name, ext, size: 0, text: preview, slots: 0, content: `[文件：${name}]`,
    ...(fills ? { fills } : {}), ...(srcId ? { srcId } : {}),
  });
  Promise.resolve().then(job).then(async blob => {
    const fileId = await files.put(blob, { name, type: mimeOf(ext) });
    messages.update(msg.id, { fileId, size: blob.size, media: 'done' });
  }).catch(err => {
    console.warn('[docfile] 文件没造出来:', err.message || err);
    messages.update(msg.id, { media: 'error', mediaError: String(err.message || err) });
  });
  return msg;
}

/** 角色填我发的那份：找最近一份能填的，在原文件上换字，发回来 */
export function deliverFill(base, fills, src = latestFillable(base.chatId)) {
  if (!src || !Array.isArray(fills) || !fills.length) return null;
  const name = /^已填写/.test(src.name) ? src.name : `已填写-${src.name}`;
  return deliver(base, { name, ext: src.ext, fills, srcId: src.id, preview: fills.map(f => `${f.id} ${f.text}`).join('\n') },
    async () => {
      const blob = await files.blob(src.fileId);
      if (!blob) throw new Error('原文件已不在');
      return fill(blob, src.ext, fills);
    });
}

/** 角色从头写一份 */
export function deliverNew(base, name, body) {
  const ext = extOf(name);
  if (!ext) return null;
  return deliver(base, { name, ext, preview: String(body || '') }, () => make(ext, body));
}

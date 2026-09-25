// 美化包的文件：导出成 json / txt / docx，读回来同样三种，外加直接粘贴一段文字（ARCHITECTURE 4.239）。
//
// 用户要求：「有的人是一键复制，json 的话会解析出问题」。json 经过聊天软件、备忘录转一手，
// 引号常被换成弯引号、换行被吞、前后多出别的字，一个字符不对整份就读不了。
// 所以 txt / docx 里放的不是 json 原文，而是 **base64 包在两行标记之间**：base64 只有字母数字和 +/=，
// 没有引号可换；读的时候标记之间的空白、换行一律丢掉，被折成几行、多出空格都不影响。
// 标记之外随便写什么都不读，那里放一段给人看的说明。
//
// 这是我们自己导出的自己的格式（CLAUDE.md 第 17 条说的那个例外），不是去认别家的 JSON。
//
// **作者署名**：导出时填一次作者名，记在设置里（settings.skinAuthor），之后每次导出自动带上，
// 名字后缀「by 作者」。只改导出去的那一份，库里自己的这一份不改名。
import { settings } from './db/index.js';
import { pack, unpack } from './skin.js';
import { readText, toDocx } from './doctext.js';

export const ACCEPT = '.json,.txt,.docx,application/json,text/plain,'
  + 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const FORMATS = [
  { id: 'json', label: 'JSON', ext: 'json' },
  { id: 'txt', label: 'TXT', ext: 'txt' },
  { id: 'docx', label: 'DOCX', ext: 'docx' },
];

const BEGIN = '-----BEGIN EIRA SKIN-----';
const END = '-----END EIRA SKIN-----';

export const author = () => String(settings.get().skinAuthor || '').trim();
export const setAuthor = v => settings.set({ skinAuthor: String(v || '').trim().slice(0, 40) });

/** 名字后缀「by 作者」。已经是这个作者的后缀就不再加 */
export function signed(name, who = author()) {
  const n = String(name || '未命名').trim() || '未命名';
  const a = String(who || '').trim();
  if (!a || n.endsWith(` by ${a}`)) return n;
  return `${n} by ${a}`;
}

const toB64 = text => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromB64 = b64 => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

/** 一份美化写成 txt 的正文 */
export function toText(row, who = author()) {
  const name = signed(row.name, who);
  const body = toB64(pack(row, { name, author: who }));
  const lines = body.match(/.{1,76}/g) || [];
  return [
    `Eira 美化包：${name}`,
    ...(who ? [`作者：${who}`] : []),
    '',
    '导入方法：在 Eira 的「美化」中点「导入美化包」选择本文件；',
    '或复制下方 BEGIN 一行到 END 一行的全部内容（连同这两行），在「粘贴导入」中粘贴。',
    '两行标记之间的内容请勿改动。',
    '',
    BEGIN,
    ...lines,
    END,
    '',
  ].join('\n');
}

/**
 * 一段文字读成美化包。认三种：两行标记包着的 base64（txt、docx、复制来的那一段）、
 * json 原文、以及被聊天软件改过引号或前后多了字的 json
 */
export function parse(text) {
  const src = String(text || '');
  // 取最后一个开头标记：前面的说明文字、聊天记录里可能也提到它
  const a = src.lastIndexOf(BEGIN);
  if (a >= 0) {
    const b = src.indexOf(END, a);
    if (b < 0) throw new Error(`内容不完整：找到了开头的标记，没有找到结尾的 ${END}`);
    const b64 = src.slice(a + BEGIN.length, b).replace(/[^A-Za-z0-9+/=]/g, '');
    let json;
    try { json = fromB64(b64); } catch { throw new Error('两行标记之间的内容被改动过，无法读取。请重新复制完整的一段'); }
    return unpack(json);
  }
  try { return unpack(src); } catch (err) {
    const from = src.indexOf('{');
    const to = src.lastIndexOf('}');
    if (from < 0 || to <= from) throw err;
    const fixed = src.slice(from, to + 1).replace(/[“”„‟＂]/g, '"');
    try { return unpack(fixed); } catch { throw err; }
  }
}

/** 选中的文件读成美化包（json、txt、docx） */
export async function readFile(file) {
  const name = String(file.name || '').toLowerCase();
  const text = name.endsWith('.json') ? await file.text() : await readText(file);
  return parse(text);
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

const fileSafe = s => String(s).replace(/[\\/:*?"<>|]/g, '_');

/** 导出一份。回来的是文件名 */
export async function exportSkin(row, format = 'json', who = author()) {
  const name = signed(row.name, who);
  const fmt = FORMATS.find(f => f.id === format) || FORMATS[0];
  const file = `美化-${fileSafe(name)}.${fmt.ext}`;
  if (fmt.id === 'json') {
    saveBlob(new Blob([pack(row, { name, author: who })], { type: 'application/json' }), file);
  } else if (fmt.id === 'txt') {
    saveBlob(new Blob([toText(row, who)], { type: 'text/plain;charset=utf-8' }), file);
  } else {
    saveBlob(await toDocx(toText(row, who)), file);
  }
  return file;
}

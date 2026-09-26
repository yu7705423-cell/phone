// 工具箱。见 ARCHITECTURE 4.247
//
// 三种工具：
//
// | 种类 | 是什么 | 存在哪 |
// |---|---|---|
// | 内置 | NPC、世界观、世界书、番外、图床教程。代码在 apps/tools 里 | 各自的设置存一行（id 固定 `tl_b_<id>`） |
// | 提示词工具 | 用户写一段指令、定几个输入框。点一次调一次接口 | tools 域一行 |
// | 网页工具 | 用户贴一段 HTML。关在 sandbox.js 的盒子里跑 | tools 域一行，HTML 原文就在行里 |
//
// 生成过的结果（NPC 一批、一份世界观、一段提示词）存 toolRuns，按工具挂着。
// 不设条数上限（CLAUDE.md 第 13 条），用户自己删。
import { tools, toolRuns, characters } from './db/index.js';
import { runTextTask } from './ai/engine.js';
import { readText, toDocx } from './doctext.js';
import { wrap } from './sandbox.js';
import { zip } from './zip.js';

export const BUILTINS = [
  { id: 'npc', name: 'NPC 生成器', icon: 'users', route: '/npc',
    desc: '围绕角色生成配角。可选世界观大类、关系标签与禁止项，逐个确认后存入联系人' },
  { id: 'world', name: '世界观生成器', icon: 'compass', route: '/world',
    desc: '按九个模块搭建世界观：从世界基础到日常质感，存为世界书' },
  { id: 'lore', name: '世界书生成器', icon: 'book', route: '/lore',
    desc: '把需求写成可执行的世界书，附本地审查与逐版修订' },
  { id: 'extra', name: '番外生成器', icon: 'film', route: '/extra',
    desc: '把脑洞与标签整理成番外提示词。可复制到别处，也可在「我们」中直接写' },
  { id: 'imghost', name: '图床搭建教程', icon: 'image', route: '/imghost',
    desc: '自建图床的步骤说明。图片地址可用于美化与头像' },
];

export const KINDS = [
  { id: 'prompt', label: '提示词工具', icon: 'sparkle',
    desc: '写一段指令并设定输入项。每次运行调用一次接口，结果可复制与保存' },
  { id: 'web', label: '网页工具', icon: 'code',
    desc: '粘贴一段 HTML 或选择 .html 文件。在隔离环境中运行，无法读取应用数据，也无法联网' },
];

// 提示词工具的输入项种类
export const INPUTS = [
  { id: 'text', label: '单行文字' },
  { id: 'long', label: '多行文字' },
  { id: 'character', label: '选择角色' },
  { id: 'lorebook', label: '选择世界书' },
];

// ---- 内置工具各自的设置 ----

const builtinKey = id => `tl_b_${id}`;

export function stateOf(id) {
  return tools.get(builtinKey(id))?.state || {};
}

export function setState(id, patch) {
  const key = builtinKey(id);
  const cur = tools.get(key);
  const next = { ...(cur?.state || {}), ...(typeof patch === 'function' ? patch(cur?.state || {}) : patch) };
  if (cur) tools.update(key, { state: next });
  else tools.create({ id: key, builtin: id, state: next });
  return next;
}

// ---- 用户自己的工具 ----

export const userTools = () => tools.where(t => !t.builtin)
  .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));

export const get = id => tools.get(id);

export function create({ kind = 'prompt', name = '', desc = '', icon = '',
  prompt = '', inputs = [], html = '', allowAI = false, allowImages = true, author = '' } = {}) {
  const k = kind === 'web' ? 'web' : 'prompt';
  return tools.create({
    kind: k,
    name: String(name || '').trim() || (k === 'web' ? '未命名网页工具' : '未命名工具'),
    desc: String(desc || '').trim(),
    icon: String(icon || '') || (k === 'web' ? 'code' : 'sparkle'),
    prompt: k === 'prompt' ? String(prompt || '') : '',
    inputs: k === 'prompt' ? cleanInputs(inputs) : [],
    html: k === 'web' ? String(html || '') : '',
    // 网页工具能不能请应用代发模型请求。默认关（CLAUDE.md 第 15 条）
    allowAI: k === 'web' ? allowAI === true : false,
    // 能不能加载外部 https 图片与字体。默认开；它们的地址能捎带东西出去，所以可以关
    allowImages: allowImages !== false,
    author: String(author || '').trim(),
    order: Date.now(),
  });
}

export function update(id, patch) {
  const next = { ...patch };
  if ('inputs' in next) next.inputs = cleanInputs(next.inputs);
  if ('allowAI' in next) next.allowAI = next.allowAI === true;
  if ('allowImages' in next) next.allowImages = next.allowImages !== false;
  return tools.update(id, next);
}

/** 删一个工具，连同它的历史 */
export function remove(id) {
  toolRuns.byIndex(id).forEach(r => toolRuns.remove(r.id));
  tools.remove(id);
}

function cleanInputs(list) {
  return (Array.isArray(list) ? list : []).map((x, i) => ({
    id: String(x?.id || `in${i + 1}`),
    label: String(x?.label || '').trim() || `输入 ${i + 1}`,
    type: INPUTS.some(t => t.id === x?.type) ? x.type : 'text',
    hint: String(x?.hint || ''),
  }));
}

// ---- 存成一个角色 ----
//
// 工具生成的人（网页工具交回来的、NPC 生成器没有绑定主角时）。与「联系」里新建的是同一种行。
export function saveCharacter(d = {}, { npc = false } = {}) {
  const s = v => String(v ?? '').trim();
  return characters.create({
    name: s(d.name) || '未命名', age: s(d.age), gender: s(d.gender), birthday: s(d.birthday),
    signature: s(d.signature), persona: s(d.persona), group: '',
    isNpc: !!npc, relations: [], lorebookIds: [], canSendVoice: true, canSendImage: true,
  });
}

// ---- 历史 ----

export const runsOf = toolId => toolRuns.byIndex(toolId)
  .slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

export const getRun = id => toolRuns.get(id);

export function addRun(toolId, { title = '', input = null, output = null } = {}) {
  return toolRuns.create({ toolId, title: String(title || '').trim(), input, output });
}

export const updateRun = (id, patch) => toolRuns.update(id, patch);
export const removeRun = id => toolRuns.remove(id);
export function clearRuns(toolId) {
  toolRuns.byIndex(toolId).forEach(r => toolRuns.remove(r.id));
}

// ---- 提示词工具 ----

/**
 * 输入项的值拼进指令里。指令里写了 {{输入项名}} 的就地替换；
 * 没被引用到的，按输入项的顺序接在后面，一项一节。
 *
 * `values[id]` 是文字；选角色、选世界书的项，界面那边先展开成文字再交过来（expand）。
 */
export function compilePrompt(tool, values = {}) {
  const inputs = tool?.inputs || [];
  const used = new Set();
  const byLabel = {};
  inputs.forEach(x => { byLabel[x.label] = x; });
  const body = String(tool?.prompt || '').replace(/\{\{([^{}]+)\}\}/g, (m, name) => {
    const x = byLabel[name.trim()];
    if (!x) return m;
    used.add(x.id);
    return String(values[x.id] ?? '');
  });
  const rest = inputs.filter(x => !used.has(x.id) && String(values[x.id] ?? '').trim());
  const user = rest.map(x => `## ${x.label}\n${String(values[x.id]).trim()}`).join('\n\n');
  return { system: body, user };
}

/** 运行一次提示词工具。一次点击，一次请求（不自动重试的次数由 retryMax 管） */
export async function runPrompt(tool, values = {}, { key = '' } = {}) {
  const { system, user } = compilePrompt(tool, values);
  if (!system.trim() && !user.trim()) throw new Error('指令与输入均为空');
  return runTextTask('tool.prompt', {
    system: system.trim(),
    user: user || 'Produce the output as instructed.',
    key: key || `tool:${tool.id}:${Date.now()}`,
    maxTokens: 4000,
  });
}

// ---- 网页工具：盒子里的 window.eira ----
//
// 盒子里只有这几件事可做，每一件都由外面（apps/tools 的运行页）拿主意：
// ai 要问用户、pick 由用户当场选、save 出确认页。盒子本身什么都拿不到。
export const BRIDGE = `(function(){
var seq=0,wait={};
function call(op,args){return new Promise(function(res,rej){var id=++seq;wait[id]={res:res,rej:rej};
parent.postMessage({eira:1,id:id,op:op,args:args||{}},'*');});}
addEventListener('message',function(e){if(e.source!==parent)return;var d=e.data;
if(!d||d.eira!==1||!wait[d.id])return;var w=wait[d.id];delete wait[d.id];
if(d.ok)w.res(d.value);else w.rej(new Error(d.error||'failed'));});
window.eira={
ai:function(prompt,opt){opt=opt||{};return call('ai',{prompt:String(prompt||''),system:String(opt.system||'')});},
pick:function(kind){return call('pick',{kind:String(kind||'text')});},
save:function(kind,data){return call('save',{kind:String(kind||''),data:data});},
copy:function(text){return call('copy',{text:String(text==null?'':text)});},
download:function(name,text){return call('download',{name:String(name||'file.txt'),text:String(text==null?'':text)});}
};})();`;

// 外部图片与字体：每个工具一个开关，默认开（老数据没有这一项，按开算）
export const imagesOn = tool => tool?.allowImages !== false;
export const docOf = tool => wrap(tool?.html || '', { bridge: BRIDGE, images: imagesOn(tool) });

// ---- 卡死之后不自动再跑 ----
//
// 打开网页工具前记一笔，正常离开就清掉。页面退到后台时也清（用户只是切走，不是卡死）；
// 回到前台、工具还开着再记上。卡死的页面连 visibilitychange 都跑不了，那一笔会留下来，
// 下次打开同一个工具时看见它，就先不跑、问一句。
const OPEN_KEY = 'phone.tool.open';
const lsGet = () => { try { return localStorage.getItem(OPEN_KEY) || ''; } catch { return ''; } };
const lsSet = v => { try { v ? localStorage.setItem(OPEN_KEY, v) : localStorage.removeItem(OPEN_KEY); } catch { /* 存不了就不防这一手 */ } };

export const stuckLast = id => lsGet() === id;
export function markOpen(id) {
  lsSet(id);
  const onVis = () => lsSet(document.visibilityState === 'hidden' ? '' : id);
  document.addEventListener('visibilitychange', onVis);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    if (lsGet() === id) lsSet('');
  };
}

// ---- 分享：导出成文件、从文件读回 ----
//
// 和美化包同一个办法（skinfile.js）：txt / docx 里放 base64，夹在两行标记之间，
// 经聊天软件转手不会被改坏。网页工具另外可以直接导出、导入 .html。
// 这是我们自己的格式（CLAUDE.md 第 17 条的例外）。

const BEGIN = '-----BEGIN EIRA TOOL-----';
const END = '-----END EIRA TOOL-----';

export const ACCEPT = '.txt,.docx,.html,.htm,text/plain,text/html,'
  + 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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

const PACK_KEYS = ['kind', 'name', 'desc', 'icon', 'prompt', 'inputs', 'html', 'author'];

export function pack(tool) {
  const out = { format: 'eira-tool', v: 1 };
  PACK_KEYS.forEach(k => { if (tool?.[k] != null) out[k] = tool[k]; });
  return JSON.stringify(out);
}

/** 读回来的只是草稿，不入库。allowAI 永远不跟着包走：导入的人自己决定 */
export function unpack(json) {
  const o = typeof json === 'string' ? JSON.parse(json) : json;
  if (!o || o.format !== 'eira-tool') throw new Error('这不是 Eira 的工具文件');
  const d = {};
  PACK_KEYS.forEach(k => { if (o[k] != null) d[k] = o[k]; });
  d.kind = d.kind === 'web' ? 'web' : 'prompt';
  d.inputs = cleanInputs(d.inputs);
  return d;
}

export function toText(tool) {
  const name = String(tool?.name || '未命名工具');
  const lines = toB64(pack(tool)).match(/.{1,76}/g) || [];
  return [
    `Eira 工具：${name}`,
    ...(tool?.author ? [`作者：${tool.author}`] : []),
    '',
    '导入方法：在 Eira 的「工具箱」中点「添加工具」，选择「从文件导入」或「粘贴导入」。',
    '两行标记之间的内容请勿改动。',
    '',
    BEGIN,
    ...lines,
    END,
    '',
  ].join('\n');
}

const looksLikeHtml = s => /<(html|body|script|div|style|!doctype)\b/i.test(s);

/** 一段文字读成工具草稿：两行标记包着的、或者就是一段 HTML */
export function parse(text) {
  const src = String(text || '');
  const a = src.lastIndexOf(BEGIN);
  if (a >= 0) {
    const b = src.indexOf(END, a);
    if (b < 0) throw new Error(`内容不完整：缺少结尾的 ${END}`);
    const b64 = src.slice(a + BEGIN.length, b).replace(/[^A-Za-z0-9+/=]/g, '');
    let json;
    try { json = fromB64(b64); } catch { throw new Error('两行标记之间的内容被改动过，无法读取'); }
    return unpack(json);
  }
  if (looksLikeHtml(src)) {
    const title = (src.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
    return { kind: 'web', name: title.trim(), desc: '', html: src, inputs: [] };
  }
  throw new Error('未识别的内容：既不是 Eira 工具文件，也不是 HTML');
}

export async function readFile(file) {
  const name = String(file.name || '').toLowerCase();
  const text = /\.html?$/.test(name) ? await file.text() : await readText(file);
  const d = parse(text);
  if (d.kind === 'web' && !d.name) d.name = String(file.name || '').replace(/\.[^.]+$/, '');
  return d;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

const fileSafe = s => String(s).replace(/[\\/:*?"<>|]/g, '_');

export const EXPORTS = [
  { id: 'txt', label: 'TXT' },
  { id: 'docx', label: 'DOCX' },
  { id: 'html', label: 'HTML', web: true },
];

export async function exportTool(tool, format = 'txt') {
  const base = `工具-${fileSafe(tool.name || '未命名')}`;
  if (format === 'html' && tool.kind === 'web') {
    saveBlob(new Blob([tool.html || ''], { type: 'text/html;charset=utf-8' }), `${base}.html`);
    return `${base}.html`;
  }
  if (format === 'docx') {
    saveBlob(await toDocx(toText(tool)), `${base}.docx`);
    return `${base}.docx`;
  }
  saveBlob(new Blob([toText(tool)], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
  return `${base}.txt`;
}

/** 通用的文本下载（工具里「导出 TXT」之类都走这一个） */
export function downloadText(name, text, type = 'text/plain;charset=utf-8') {
  saveBlob(new Blob([String(text ?? '')], { type }), fileSafe(name));
}

/** 一段生成的文字导出成 txt 或 docx。回来的是文件名 */
export async function exportText(name, text, format = 'txt') {
  const base = fileSafe(name || '导出');
  if (format === 'docx') {
    saveBlob(await toDocx(String(text ?? '')), `${base}.docx`);
    return `${base}.docx`;
  }
  saveBlob(new Blob([String(text ?? '')], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
  return `${base}.txt`;
}

/** 几段文字各成一个文件，装进一个 zip */
export async function exportZip(name, entries) {
  const z = await zip((entries || []).map(e => ({
    name: fileSafe(e.name || '未命名.txt'),
    blob: new Blob([String(e.text ?? '')], { type: 'text/plain;charset=utf-8' }),
  })));
  const file = `${fileSafe(name || '导出')}.zip`;
  saveBlob(new Blob([z], { type: 'application/zip' }), file);
  return file;
}

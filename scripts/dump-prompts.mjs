import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, rel } from './lib.mjs';

// 把所有会进 prompt 的文字导成一份可通读的 Markdown。
//
//   node scripts/dump-prompts.mjs > PROMPTS.md
//
// 全部从源码里现读，不另存一份，所以它不会和代码走散。
// 改文字仍然改源码（或在「设置 - Prompt 模板」里改），这份只用来通读与校对。

const read = p => readFileSync(join(ROOT, p), 'utf8');

// ---- 一、templates.js 里的模板 ----

function templates() {
  const src = read('src/system/ai/templates.js');
  const out = [];
  // 每条形如：  // 注释若干行（可选）\n  'id':\n`正文`,
  const re = /(?:^ {2}\/\/.*\n)*^ {2}'([\w.-]+)':\n`([\s\S]*?)`,$/gm;
  let m;
  while ((m = re.exec(src))) {
    const head = src.slice(0, m.index);
    const note = (m[0].match(/^ {2}\/\/.*$/gm) || []).map(l => l.replace(/^ {2}\/\/ ?/, ''));
    out.push({
      id: m[1], body: m[2], note,
      line: head.split('\n').length + note.length + 1,
    });
  }
  return out;
}

// ---- 二、能力目录里的那一行 ----

function capLines() {
  const src = read('src/system/ai/capabilities.js');
  // 先按 id 把每个能力切开，再在它自己那一段里找 line。
  // line 有写成字符串的，也有模板串和几段拼起来的，所以是把里面的文字段全取出来接上。
  const heads = [...src.matchAll(/^ {4}id: '([\w-]+)',$/gm)];
  return heads.map((h, i) => {
    const block = src.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : src.length);
    const always = /^ {4}always: true,$/m.test(block);
    const seg = block.match(/^ {4}line: ([\s\S]*?)\n {4}[a-z]+:/m);
    const parts = seg
      ? [...seg[1].matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g)].map(m => m[2])
      : [];
    const line = parts.join('')
      .replace(/\$\{[^}]*\}/g, '…')   // 运行时填进去的名单
      .replace(/\n\s*/g, ' ')
      .trim();
    return { id: h[1], line, always };
  });
}

// ---- 三、上下文区块与拼装时插进去的句子 ----

// 去掉注释，只留代码。字符串里的 // 不算注释。
function stripComments(src) {
  let out = ''; let i = 0; let quote = null;
  while (i < src.length) {
    const c = src[i]; const n = src[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i += 1; continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c; i += 1;
  }
  return out;
}

const CJK = /[一-鿿]/;
// label / desc / id 是界面上的名字，不进 prompt
const UI_KEY = /(label|desc|placeholder|title)\s*:\s*$/;
// 报错文案与调试日志也不进 prompt
const NOT_PROMPT = /(console\.\w+|Error|toast|warn|info)\s*\($/;

function sentences(file) {
  const src = stripComments(read(file));
  const out = [];
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const text = m[2];
    if (!CJK.test(text)) continue;
    const before = src.slice(0, m.index);
    const tail = before.slice(-40);
    if (UI_KEY.test(tail) || NOT_PROMPT.test(tail.replace(/\s+$/, ''))) continue;
    out.push({
      // 源码里写成 \n 的换行，这里还原成真正的换行，便于通读
      // 源码里写成 \n 的换行还原成真正的换行；${...} 里面的不动
      text: text.split(/(\$\{[^}]*\})/).map((seg, i) =>
        (i % 2 ? seg : seg.replace(/\\n/g, '\n').replace(/\\'/g, "'"))).join(''),
      line: before.split('\n').length,
    });
  }
  return out;
}

// ---- 输出 ----

const fence = s => '```\n' + s.replace(/\n$/, '') + '\n```';

console.log('# 小手机 · 全部提示词');
console.log();
console.log('由 `node scripts/dump-prompts.mjs` 从源码生成。');
console.log('正文中的 `{{xxx}}` 是运行时填入的占位符。');
console.log();
console.log('规则：prompt 正文一律英文；方括号标记、区块抬头与「」里引的原话留中文。见 CLAUDE.md 第 14 条。');
console.log();
console.log('提示词的编写与修订，感谢 我厌 老师的帮助。');
console.log();

const all = templates();
const pick = pre => all.filter(t => t.id.startsWith(pre));

console.log('## 一、骨架');
console.log();
console.log('每一轮聊天按这个顺序拼：开场、性别、各上下文区块、消息规则、');
console.log('能力、核心设定、性别。');
console.log();
console.log('内置提示词只陈述客观事实，不替角色作任何判断（见 CLAUDE.md 第 16 条）：');
console.log('说什么语言、该有多大反应、话题怎么接、几份设定冲突时听谁的，一律不作规定。');
console.log();
const SKEL_MAIN = ['skeleton.opening', 'skeleton.gender', 'skeleton.world', 'skeleton.rules',
  'skeleton.core', 'skeleton.group'];
for (const t of all.filter(x => SKEL_MAIN.includes(x.id))) emit(t);

console.log('## 二、各项能力的细则');
console.log();
console.log('平时只给下面第三节那张目录，这一轮真用上了才给整段细则。');
console.log('标了「常驻」的几项没有目录行，每轮直接给整段。');
console.log();
for (const t of pick('skeleton.').filter(x => !SKEL_MAIN.includes(x.id))) emit(t);

console.log('## 三、能力目录（平时只给这一行）');
console.log();
console.log(fence(capLines()
  .map(c => `${c.id}${c.always ? '（常驻，不走目录，每轮直接给整段细则）' : ''}`
    + (c.line ? `\n  ${c.line}` : ''))
  .join('\n')));
console.log();

console.log('## 四、各任务的 instruction');
console.log();
console.log('这些不是聊天，是后台活儿：生成日程、导入角色卡、整理记忆等。');
console.log();
for (const t of pick('task.')) emit(t);

console.log('## 五、上下文区块里的固定句子');
console.log();
console.log('这一部分不在模板里，直接写在代码中，界面上改不了。');
console.log();
const CTX = readdirSync(join(ROOT, 'src/system/ai/context'))
  .filter(f => f.endsWith('.js') && f !== 'index.js')
  .map(f => `src/system/ai/context/${f}`);
for (const f of [...CTX, 'src/system/ai/engine.js']) {
  const rows = sentences(f);
  if (!rows.length) continue;
  console.log(`### ${f}`);
  console.log();
  console.log(fence(rows.map(r => `${String(r.line).padStart(4)}  `
    + r.text.split('\n').join('\n      ')).join('\n')));
  console.log();
}
console.log('注：只列会送进模型的字符串，报错文案与调试日志已排除。');

function emit(t) {
  console.log(`### ${t.id}`);
  console.log();
  if (t.note.length) t.note.forEach(l => console.log(`> ${l}`));
  if (t.note.length) console.log();
  console.log(fence(t.body));
  console.log();
}

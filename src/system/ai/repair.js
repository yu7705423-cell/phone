import { messages, characters } from '../db/index.js';
import { splitReply, materialize, dropMessage } from './reply.js';

// 模型偶尔会降智：标记写成别的括号、开头多个「名字：」、整段裹一层引号、
// 换行变成字面的 \n。这些都是确定性的格式问题，不值得再调一次接口，
// 本地按规则修掉就行。每条修法都先算出结果给你看一眼再决定。

// 整行是一个媒体标记，但括号或冒号写得不对。统一改写成标准写法，
// 剩下的交给 splitReply。已经标准的再跑一遍也不会变，可以反复应用。
const LOOSE_MARK = /^[ \t]*[[【(（]?[ \t]*(图片|照片|image|pic|语音|voice|audio)[ \t]*[:：][ \t]*([^\n\]】)）]+?)[ \t]*[\]】)）]?[ \t]*$/gim;

const IMAGE_WORDS = new Set(['图片', '照片', 'image', 'pic']);

export function normalizeMarks(text) {
  return String(text || '').replace(LOOSE_MARK, (_, word, body) =>
    `[${IMAGE_WORDS.has(word.toLowerCase()) ? '图片' : '语音'}：${body.trim()}]`);
}

// 成对的包裹符号。只有首尾配上了才算，不然会把「他说“好”」的后引号当成结尾。
const WRAPS = [['“', '”'], ['「', '」'], ['『', '』'], ['"', '"'], ["'", "'"]];

const nameOf = msg => msg.role === 'user'
  ? ''
  : (characters.get(msg.authorId)?.name || '');

// 每条修法：test 判断用不用得上，run 返回新文本。
// 结构性的那条（重新分条）不走 run，单独处理。
const TEXT_FIXES = [
  {
    id: 'escape',
    label: '还原换行',
    desc: '文里有字面的 \\n，是模型把转义符直接打出来了',
    test: t => /\\[nrt]/.test(t),
    run: t => t.replace(/\\r\\n|\\r|\\n/g, '\n').replace(/\\t/g, ' '),
  },
  {
    id: 'prefix',
    label: '去掉开头的名字',
    desc: '这边本来就知道是谁在说话，不用再报一遍名',
    test: (t, msg) => {
      const n = nameOf(msg);
      return !!n && new RegExp(`^\\s*${escapeRe(n)}\\s*[:：]`).test(t);
    },
    run: (t, msg) => t.replace(new RegExp(`^\\s*${escapeRe(nameOf(msg))}\\s*[:：]\\s*`), ''),
  },
  {
    id: 'wrap',
    label: '去掉包住整段的引号',
    desc: '整句被一对引号裹着，念出来会多两个符号',
    test: t => !!wrapOf(t),
    run: t => {
      const w = wrapOf(t);
      return w ? t.slice(w[0].length, t.length - w[1].length).trim() : t;
    },
  },
  {
    id: 'stars',
    label: '星号动作换成中文括号',
    desc: '*这样的动作* 是英文写法，这里统一用（）',
    test: t => /\*{1,2}[^*\n]+\*{1,2}/.test(t),
    run: t => t.replace(/\*{1,2}([^*\n]+?)\*{1,2}/g, '（$1）'),
  },
];

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function wrapOf(text) {
  const t = String(text).trim();
  if (t.length < 3) return null;
  for (const [a, b] of WRAPS) {
    if (!t.startsWith(a) || !t.endsWith(b)) continue;
    // 中间不能再出现一次结尾符，否则是「他说“好”，然后走了」这种正常句子
    if (t.slice(a.length, t.length - b.length).includes(b)) continue;
    return [a, b];
  }
  return null;
}

const textOf = msg => msg.kind === 'image' ? (msg.prompt || '')
  : msg.kind === 'voice' ? (msg.voiceText || '')
  : (msg.content || '');

// 重新分条：先把歪掉的标记扶正，再按空行和标记拆。
// 只有拆出来跟现在不一样才算一条修法。
function partsFor(msg) {
  if (msg.kind !== 'text') return null;
  const parts = splitReply(normalizeMarks(msg.content || ''));
  if (parts.length < 2 && !parts.some(p => p.type !== 'text')) return null;
  if (parts.length === 1 && parts[0].type === 'text' && parts[0].text === (msg.content || '').trim()) return null;
  return parts;
}

function describe(parts) {
  const n = { image: 0, voice: 0 };
  parts.forEach(p => { if (p.type !== 'text') n[p.type]++; });
  const extra = [];
  if (n.image) extra.push(`${n.image} 张图`);
  if (n.voice) extra.push(`${n.voice} 段语音`);
  return `拆成 ${parts.length} 条${extra.length ? '，其中 ' + extra.join('、') : ''}`;
}

// 这条消息用得上的修法，附带改完长什么样
export function fixesFor(msg) {
  if (!msg || msg.kind === 'sticker' || msg.kind === 'typing') return [];
  const out = [];
  let t = textOf(msg);

  for (const f of TEXT_FIXES) {
    if (!f.test(t, msg)) continue;
    const after = f.run(t, msg);
    if (after === t) continue;
    out.push({ id: f.id, label: f.label, desc: f.desc, preview: after });
  }

  const parts = partsFor(msg);
  if (parts) out.push({ id: 'rows', label: '按标记重新分条', desc: '图片和语音标记没被认出来，或者该分条的挤成了一条', preview: describe(parts) });

  return out;
}

// 改完的文字写回对应字段。图片语音改的是描述，正文跟着同步。
function writeText(msg, text) {
  const t = String(text).trim();
  if (!t) return;
  if (msg.kind === 'image') messages.update(msg.id, { prompt: t, content: `[图片：${t}]` });
  else if (msg.kind === 'voice') messages.update(msg.id, { voiceText: t, content: `[语音：${t}]` });
  else messages.update(msg.id, { content: t });
}

// 把一条拆成若干条，插在原位。
// createdAt 用小数递进：排序照旧，又不会挤到下一条消息后面去。
function rebuild(msg, parts) {
  const char = characters.get(msg.authorId) || {};
  const base = msg.createdAt;
  const keep = {
    quoteId: msg.quoteId || null, quoteText: msg.quoteText || '',
    quoteRole: msg.quoteRole || '', quoteAuthorId: msg.quoteAuthorId || '',
  };

  parts.forEach((part, i) => {
    materialize(part, {
      chatId: msg.chatId, role: msg.role, authorId: msg.authorId,
      turnId: msg.turnId, status: 'done',
      createdAt: base + i / (parts.length + 1),
      // 原文与候选留在第一条上，重新生成时还能整轮替换
      ...(i === 0
        ? { ...keep, raw: msg.raw, swipes: msg.swipes, swipeIndex: msg.swipeIndex }
        : {}),
    }, char);
  });

  dropMessage(msg.id);
  return parts.length;
}

export function applyFix(msgId, fixId) {
  const msg = messages.get(msgId);
  if (!msg) throw new Error('这条消息已经不在了');

  if (fixId === 'rows') {
    const parts = partsFor(msg);
    if (!parts) throw new Error('这条不需要重新分条');
    return `拆成了 ${rebuild(msg, parts)} 条`;
  }

  const f = TEXT_FIXES.find(x => x.id === fixId);
  if (!f) throw new Error('没有这条修法');
  const before = textOf(msg);
  const after = f.run(before, msg);
  if (after === before) return '没什么可改的';
  writeText(msg, after);
  return f.label;
}

// 一键全修：文字类的按顺序叠着改完，最后再分条。
// 顺序要紧 —— 先把 \n 还原出来，分条才知道哪儿该断。
export function applyAll(msgId) {
  const msg = messages.get(msgId);
  if (!msg) throw new Error('这条消息已经不在了');

  let text = textOf(msg);
  const done = [];
  for (const f of TEXT_FIXES) {
    if (!f.test(text, msg)) continue;
    const after = f.run(text, msg);
    if (after === text) continue;
    text = after;
    done.push(f.label);
  }
  if (done.length) writeText(msg, text);

  const fresh = messages.get(msgId);
  const parts = fresh ? partsFor(fresh) : null;
  if (parts) { rebuild(fresh, parts); done.push(`拆成 ${parts.length} 条`); }

  return done;
}

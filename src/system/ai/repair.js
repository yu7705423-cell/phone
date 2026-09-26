import { messages, characters } from '../db/index.js';
import { splitReply, materialize, dropMessage, turnMessages } from './reply.js';

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
    desc: '正文中出现了字面的 \\n，模型将转义符直接输出为了文本',
    test: t => /\\[nrt]/.test(t),
    run: t => t.replace(/\\r\\n|\\r|\\n/g, '\n').replace(/\\t/g, ' '),
  },
  {
    id: 'prefix',
    label: '移除开头的角色名',
    desc: '界面已标明发言人，正文中无需重复',
    test: (t, msg) => {
      const n = nameOf(msg);
      return !!n && new RegExp(`^\\s*${escapeRe(n)}\\s*[:：]`).test(t);
    },
    run: (t, msg) => t.replace(new RegExp(`^\\s*${escapeRe(nameOf(msg))}\\s*[:：]\\s*`), ''),
  },
  {
    id: 'wrap',
    label: '移除包裹整段的引号',
    desc: '整段被一对引号包住，属于多余的符号',
    test: t => !!wrapOf(t),
    run: t => {
      const w = wrapOf(t);
      return w ? t.slice(w[0].length, t.length - w[1].length).trim() : t;
    },
  },
  {
    id: 'stars',
    label: '星号动作改为中文括号',
    desc: '*星号包裹* 为英文写法，本项目统一使用（）',
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
// 拆出来跟现在一模一样才不算一条修法 —— 注意「一样」包括没有多出
// 时间行和引用标记。旧消息里那些没被剥掉的时间行正是靠这一条清掉的。
function partsFor(msg) {
  if (msg.kind !== 'text') return null;
  const cur = (msg.content || '').trim();
  const parts = splitReply(normalizeMarks(cur));
  if (!parts.length) return null;
  const unchanged = parts.length === 1 && parts[0].type === 'text'
    && !parts[0].quote && !parts[0].stamp && parts[0].text === cur;
  return unchanged ? null : parts;
}

function describe(parts) {
  const n = { image: 0, voice: 0, sticker: 0 };
  parts.forEach(p => { if (p.type !== 'text') n[p.type]++; });
  const extra = [];
  if (n.image) extra.push(`${n.image} 张图片`);
  if (n.voice) extra.push(`${n.voice} 段语音`);
  if (n.sticker) extra.push(`${n.sticker} 个表情`);

  const notes = [];
  if (parts[0]?.stamp) notes.push('移出时间行');
  if (parts.some(p => p.quote)) notes.push('识别出引用');

  const head = parts.length > 1 ? `拆分为 ${parts.length} 条` : '整理为 1 条';
  return [
    head + (extra.length ? `，其中包含 ${extra.join('、')}` : ''),
    ...notes,
  ].join('；');
}

// 正文不是随便写的那几种：气泡里显示的东西来自各自的字段，正文是给模型读的
// 固定格式。改正文改不动字段，落下来就是两套说法 —— 所以这几种既不给改，
// 也不给「修格式」伸手。一处定义，MsgMenu 那边引这一份，别再各抄一遍。
export const STRUCTURED = new Set([
  'sticker', 'typing', 'notice',
  'transfer', 'gift', 'location', 'call', 'listen', 'read', 'pact', 'letter',
  'takeout', 'dice', 'song', 'tool', 'card',
]);

// 这条消息用得上的修法，附带改完长什么样
export function fixesFor(msg) {
  if (!msg || STRUCTURED.has(msg.kind)) return [];
  const out = [];
  let t = textOf(msg);

  for (const f of TEXT_FIXES) {
    if (!f.test(t, msg)) continue;
    const after = f.run(t, msg);
    if (after === t) continue;
    out.push({ id: f.id, label: f.label, desc: f.desc, preview: after });
  }

  const parts = partsFor(msg);
  if (parts) out.push({
    id: 'rows', label: '按标记重新整理',
    desc: '正文里混进了时间行或引用标记，或者图片、语音、表情标记未被识别',
    preview: describe(parts),
  });

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
    // 时间行在渲染时就剥掉了，重新分条别把它弄丢，上下文还指着它排时间线
    ...(msg.stamp ? { stamp: msg.stamp } : {}),
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

/**
 * 手动整理：从模型这一轮交回来的原文改起。
 *
 * **规则认不出来的走形是认不完的。** `lineMark` 那一套只认得出见过的几种，
 * 模型偶尔写出第六种、第七种，本地一条规则都命中不了 ——
 * 那时候「修正格式」列出来是一句「未发现格式问题」，人就没有出口了。
 *
 * 所以留一条手动的：把原文摆出来让人自己改一个字，再按标记重新分条。
 * 改的是**原文**不是气泡，因为一旦掉了格式，那一行早就被拆成好几个气泡了，
 * 挨个改改不回来；而原文里它还是完整的一行。
 *
 * 原文存在整轮第一条上（见 `renderTurn`）。取得到就整轮一起重排，
 * 取不到（用户自己发的、或者是旧数据）就只动这一条。
 */
export function manualSource(msg) {
  if (!msg) return null;
  const rows = msg.turnId ? turnMessages(msg.chatId, msg.turnId) : [];
  const head = rows.find(m => m.raw);
  if (head) return { text: String(head.raw), scope: 'turn', count: rows.length };
  return { text: textOf(msg), scope: 'one', count: 1 };
}

/** 按这段文字分出来会是什么样。手动那一栏一边打字一边显示这个。 */
export function previewSplit(text) {
  const parts = splitReply(normalizeMarks(String(text || '')));
  return { n: parts.length, note: parts.length ? describe(parts) : '这段文字分不出任何一条' };
}

// 整轮重排。和 rebuild 是同一件事，只是作用范围从一条变成一轮 ——
// 掉格式往往是整轮的事，只重排一条会把这一轮劈成两半
function rebuildTurn(msg, parts, raw) {
  const rows = turnMessages(msg.chatId, msg.turnId);
  const head = rows[0] || msg;
  const char = characters.get(head.authorId) || {};
  const base = head.createdAt;
  const keep = {
    quoteId: head.quoteId || null, quoteText: head.quoteText || '',
    quoteRole: head.quoteRole || '', quoteAuthorId: head.quoteAuthorId || '',
    ...(head.stamp ? { stamp: head.stamp } : {}),
  };
  // **先把要留的东西抄下来再删。** 删完那几行就读不到了
  const carry = { raw, swipes: head.swipes, swipeIndex: head.swipeIndex, turnId: head.turnId };
  rows.forEach(m => dropMessage(m.id));

  parts.forEach((part, i) => {
    materialize(part, {
      chatId: head.chatId, role: head.role, authorId: head.authorId,
      turnId: carry.turnId, status: 'done',
      createdAt: base + i / (parts.length + 1),
      ...(i === 0
        ? { ...keep, raw: carry.raw, swipes: carry.swipes, swipeIndex: carry.swipeIndex }
        : {}),
    }, char);
  });
  return parts.length;
}

/**
 * 按手动改过的这段文字重新分条。
 *
 * 改过的文字同时存回 `raw` —— 下次再打开手动那一栏，接着上次改的往下改，
 * 而不是又跳回模型最初那一版。
 */
export function applyManual(msgId, text) {
  const msg = messages.get(msgId);
  if (!msg) throw new Error('该消息已不存在');
  const raw = String(text || '').trim();
  if (!raw) throw new Error('内容是空的，没有可分条的东西');
  const parts = splitReply(normalizeMarks(raw));
  if (!parts.length) throw new Error('这段文字分不出任何一条');

  const src = manualSource(msg);
  const n = src?.scope === 'turn' ? rebuildTurn(msg, parts, raw) : rebuild(msg, parts);
  return n > 1 ? `已重新分为 ${n} 条` : '已整理为 1 条';
}

export function applyFix(msgId, fixId) {
  const msg = messages.get(msgId);
  if (!msg) throw new Error('该消息已不存在');

  if (fixId === 'rows') {
    const parts = partsFor(msg);
    if (!parts) throw new Error('该消息无需重新分条');
    const n = rebuild(msg, parts);
    return n > 1 ? `已拆分为 ${n} 条` : '已整理';
  }

  const f = TEXT_FIXES.find(x => x.id === fixId);
  if (!f) throw new Error('未知的修正项');
  const before = textOf(msg);
  const after = f.run(before, msg);
  if (after === before) return '没有可修正的内容';
  writeText(msg, after);
  return f.label;
}

// 一键全修：文字类的按顺序叠着改完，最后再分条。
// 顺序要紧 —— 先把 \n 还原出来，分条才知道哪儿该断。
export function applyAll(msgId) {
  const msg = messages.get(msgId);
  if (!msg) throw new Error('该消息已不存在');

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
  if (parts) {
    rebuild(fresh, parts);
    done.push(parts.length > 1 ? `拆分为 ${parts.length} 条` : '整理格式');
  }

  return done;
}

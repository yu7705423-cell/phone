import { settings, persona, characters, chats, messages, stickers, messagesOf } from '../db/index.js';
import * as accounts from '../accounts.js';
import * as clock from '../time.js';
import { assemble } from './context/index.js';
import { DEFAULT_TEMPLATES, fillTemplate } from './templates.js';
import { embedQuery, embedReady } from './embed.js';
import { getProvider } from './providers/index.js';
import { activeChat, fallbackChat, visionMode } from './services.js';
import * as currency from '../currency.js';
import { images } from '../db/images.js';
import { toDataUrl } from '../audio.js';
import { mediaInstruction } from './reply.js';
import { enqueue, cancel, isRunning, isAbort } from './queue.js';
import { parseJSON } from './sse.js';
import { estimate, takeLatestWithin } from './tokens.js';

// 接口协议要求带 max_tokens，取一个足够大的值，等同于不限制
export const MAX_OUTPUT = 32000;

export function template(id) {
  const s = settings.get();
  return (s.promptTemplates && s.promptTemplates[id]) || DEFAULT_TEMPLATES[id] || '';
}

function asConfig(preset) {
  if (!preset) return null;
  return {
    id: preset.id,
    name: preset.name,
    provider: preset.provider,
    apiKey: (preset.apiKey || '').trim(),
    baseUrl: (preset.baseUrl || '').trim(),
    model: (preset.model || '').trim(),
    temperature: preset.temperature,
    effort: preset.effort,
    // 不设回复上限。接口要求必须带 max_tokens，这里给到模型的上限，
    // 不作为「截断长度」暴露给用户。
    maxTokens: MAX_OUTPUT,
  };
}

// 只认「填全了的」预设。半填的预设当没配 —— 否则每个后台任务都要先
// 往它撞一次墙再退回来，白白慢一倍还刷一屏报错。
const usable = c => (c && c.apiKey && c.model) ? c : null;

export function config() { return usable(asConfig(activeChat())); }
export function fallbackConfig() { return usable(asConfig(fallbackChat())); }

export function isConfigured() { return !!config(); }

// 后台活儿：用户不会盯着屏幕等结果的那些。默认丢给副用接口，
// 主用留给「你正等着看」的东西（聊天回复、主动消息、朋友圈动态）。
// 副用一般更便宜也更慢，这些活儿慢一点无所谓。
export const BACKGROUND_TASKS = new Set([
  'memory.extract',    // 自动总结记忆
  'chat.summarize',    // 历史压缩
  'memory.import',     // 粘一大段文字拆成记忆
  'card.import',       // 导入角色卡
  'card.npc',          // 批量生成关联 NPC
  'char.alt',          // 角色自己琢磨开小号
]);

export function backgroundUsesSpare() {
  return settings.get().backgroundSpare !== false && !!fallbackConfig();
}

// 先试 a 再试 b。取消不算失败，不触发兜底。
async function tryBoth(run, first, second, label) {
  const a = first || second;
  if (!a) throw new Error('还没有配置接口，或者配的那个没填全（缺密钥或模型）');
  const b = first ? second : null;
  try {
    return await run(a);
  } catch (err) {
    if (!b || isAbort(err)) {
      // 把是哪个预设挂的写进报错，不然一句「请求失败」根本没法查
      err.message = `${a.name || label}：${err.message}`;
      throw err;
    }
    console.warn(`[ai] ${label}失败，改用另一个接口`, err.message);
    return run(b);
  }
}

// 主用失败时自动换副用再试一次
const withFallback = run => tryBoth(run, config(), fallbackConfig(), '主用接口');

// 后台活儿：反过来，副用优先，副用挂了再退回主用，别让记忆整理挡住聊天
const withSpareFirst = run => backgroundUsesSpare()
  ? tryBoth(run, fallbackConfig(), config(), '副用接口')
  : withFallback(run);

// 任务按 id 决定走哪条路
const runnerFor = taskId => (BACKGROUND_TASKS.has(taskId) ? withSpareFirst : withFallback);

// 角色能用哪些表情。名字要原样列给模型，它才知道可以写什么；
// 但表情库可能有几百个，全列出来光这一段就把预算吃掉了，所以只给最常用的。
const STICKER_LIMIT = 60;
function stickerNames(char) {
  if (char.canSendSticker === false) return '';
  const all = stickers.all();
  if (!all.length) return '';
  return all
    .slice()
    .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
    .slice(0, STICKER_LIMIT)
    .map(s => String(s.name || '').trim())
    .filter(Boolean)
    .join('、');
}

function budgets(total) {
  return { lorebook: Math.round(total * 0.4), memory: Math.round(total * 0.35) };
}

// 扫描窗口:最近 N 条消息拼接。世界书与 B 级记忆共用同一个窗口。
function scanTextOf(msgs, n) {
  return msgs.slice(-n).map(m => m.content || '').join('\n');
}

// 查询向量。扫描窗口那段文字拿去算一次，交给记忆块做语义检索。
// 单独拎出来是因为 buildChatSystem 是同步的，这一步要发请求。
// 失败不抛：拿不到就退回关键词检索，聊天不能因为向量接口挂了就发不出去。
export async function queryVecFor(msgs) {
  const s = settings.get();
  if (!s.memoryEnabled || s.memoryVector === false || !embedReady()) return null;
  const text = scanTextOf(msgs, s.scanWindow).trim();
  if (!text) return null;
  try {
    return await embedQuery(text);
  } catch (err) {
    console.warn('[memory] 取查询向量失败，这轮退回关键词检索:', err.message || err);
    return null;
  }
}

export function buildChatSystem(chat, char, msgs, opts = {}) {
  const s = settings.get();
  // 这段对话属于哪个身份。老会话没有 personaId，落到当前账号上
  const me = accounts.get(chat?.personaId) || accounts.current() || persona.get();
  const others = (chat.characterIds || []).filter(id => id !== char.id)
    .map(id => characters.get(id)).filter(Boolean);

  const ctx = {
    char, chat, messages: msgs, persona: me, settings: s,
    scanText: scanTextOf(msgs, s.scanWindow),
    budgets: budgets(s.contextBudget),
    queryVec: opts.queryVec || null,
  };

  let out = fillTemplate(template('skeleton.opening'), {
    charName: char.name || '对方',
    userName: me.name || '对方',
  });

  const { text, failed } = assemble(s.injectOrder, ctx);
  out += text;

  if (chat.summary) out += `\n\n[更早之前发生过什么]\n${chat.summary}`;

  if (others.length) {
    out += '\n\n' + fillTemplate(template('skeleton.group'), {
      members: others.map(c => c.name).join('、'),
    });
  }

  out += '\n\n' + template('skeleton.closing');
  // 自然表达协议。接在回复风格后面，管的是同一件事：这一条回复该怎么写。
  // 一千多 token，所以给了开关，见「上下文与记忆」。
  if (s.styleProtocol !== false) out += '\n\n' + template('skeleton.style');
  out += mediaInstruction(char);

  const stickerList = stickerNames(char);
  if (stickerList) {
    out += '\n\n' + fillTemplate(template('skeleton.sticker'), { names: stickerList });
  }

  // 引用是双向的：你能引他的，他也能引你的或者自己早先说过的
  if (msgs.length >= 2) out += '\n\n' + template('skeleton.quote');

  // 转账。开关在角色卡上（第 5 条：属于这个角色的事放在这个角色身上）。
  // 不按「聊过才讲」来收 token —— 那样角色永远迈不出第一步，
  // 只能等用户先转一笔，等于这个能力对它是单向的。
  if (char.canTransfer !== false) {
    const money = currency.label();
    out += '\n\n' + fillTemplate(template('skeleton.transfer'), {
      currency: money ? `\n这段对话里的钱是${money}，按这个量级写金额。` : '',
    });
  }

  // 打电话。和转账一样，能力在角色卡上开关。
  if (char.canCall !== false) out += '\n\n' + template('skeleton.ring');

  // 位置。角色报的地点要落在它自己待的那个地方 —— 时区设了就拿它当锚，
  // 没设就只能靠人设里写的，不替它瞎猜一个城市。
  if (char.canSendLocation !== false) {
    out += '\n\n' + fillTemplate(template('skeleton.location'), {
      city: char.timezone ? `（你在${clock.zoneLabel(char.timezone)}）` : '',
    });
  }
  // 让它自己把当地时间写出来。这一行显示时会被过滤掉，见 ai/reply.js
  if (clock.stampOn()) out += '\n\n' + template('skeleton.time');

  // 翻译。逐条给出译文，收在气泡里，点一下才展开
  if (chat.translateTo) {
    out += '\n\n' + fillTemplate(template('skeleton.translate'), { lang: chat.translateTo });
  }
  return { system: out, failed, tokens: estimate(out) };
}

// 引用过的消息在上下文里要带上出处,不然「是啊」这种回应模型根本不知道在应哪句。
// 原消息还在就取现文(可能被编辑过),删了就用当初存的快照。
function withQuote(m) {
  if (!m.quoteId && !m.quoteText) return m.content;
  const src = m.quoteId ? messages.get(m.quoteId) : null;
  const q = String((src ? src.content : m.quoteText) || '').replace(/\s+/g, ' ').trim();
  if (!q) return m.content;
  return `（回应前面那句「${q.length > 40 ? q.slice(0, 40) + '…' : q}」）${m.content}`;
}

// 时间感知开着的时候，历史本身要是一条时间线。
// 角色那边用它自己写的那一行(界面上过滤掉了,上下文里得留着);
// 用户这边没法要求他写,隔得久了替他补一句 —— 隔了三小时才回和秒回不是一回事。
const GAP_MARK = 30 * 60000;
function timeLine(m, prev) {
  if (!clock.enabled()) return '';
  if (m.role === 'char') return m.stamp ? `[${m.stamp}] ` : '';
  if (!prev || m.createdAt - prev.createdAt < GAP_MARK) return '';
  return `[${clock.format(clock.toWorld(m.createdAt), clock.userZone())}] `;
}

// ---- 轮次 ----
// 一轮 = 用户连着发的那几条，加上角色接着回的那几条。
// 用户重新开口的地方就是一轮的起点。

// 当前这一轮里用户已经发出、角色还没回的那几条。
// 最后一条是角色发的就说明上一轮已经收口了，当前轮为空。
export function currentTurn(msgs) {
  let i = msgs.length;
  while (i > 0 && msgs[i - 1].role === 'user') i--;
  return msgs.slice(i);
}

// 从尾往前数 n 个起点，取这 n 轮。不足 n 轮就全给。
export function takeTurns(msgs, n) {
  const limit = Math.max(1, Math.round(n) || 1);
  let seen = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const start = msgs[i].role === 'user' && (i === 0 || msgs[i - 1].role !== 'user');
    if (start && ++seen >= limit) return msgs.slice(i);
  }
  return msgs.slice();
}

// 「交给聊天模型」这一档要把图片原样塞进请求里。取图是异步的，
// buildHistory 是同步的，所以在这儿先把用得上的那几张读成 dataURL。
//
// **只带当前这一轮发的图**。图片一旦被模型看过，就在 describeCarried 里
// 写回一句描述，往后几轮只带这句话。一张压缩过的图也有几十上百 KB，
// 每轮都重传一遍，越聊越慢也越聊越贵，而且模型看到的还是同一张。
export async function imagesFor(msgs) {
  if (visionMode() !== 'chat') return null;
  const wanted = currentTurn(msgs)
    .filter(m => m.kind === 'image' && m.role === 'user' && m.imageId && m.vision !== 'done');
  if (!wanted.length) return null;

  const out = new Map();
  for (const m of wanted) {
    try {
      const blob = await images.blob(m.imageId);
      if (!blob) continue;
      out.set(m.id, { dataUrl: await toDataUrl(blob), mediaType: blob.type || 'image/png' });
    } catch (err) {
      console.warn('[vision] 这张图读不出来，跳过', err.message || err);
    }
  }
  return out.size ? out : null;
}

// 历史消息转 API 格式。群聊时给非本人的发言加上说话人前缀。
export function buildHistory(chat, char, msgs, opts = {}) {
  const s = settings.get();
  const isGroup = (chat.characterIds || []).length > 1;
  const byTurn = s.historyMode === 'turn';
  const scope = byTurn
    ? takeTurns(msgs, s.historyTurns)
    : msgs.slice(-Math.max(2, s.historyLimit * 2));
  const kept = takeLatestWithin(scope, s.contextBudget, m => m.content || '');

  const pics = opts.images || null;
  const view = byTurn ? kept : kept.slice(-s.historyLimit);
  const view2 = view.map((m, i) => {
    const mine = m.role === 'char' && m.authorId === char.id;
    const text = timeLine(m, view[i - 1]) + withQuote(m);
    if (m.role === 'user') {
      const pic = pics && pics.get(m.id);
      return pic ? { role: 'user', content: text, image: pic } : { role: 'user', content: text };
    }
    if (mine) return { role: 'assistant', content: text };
    // 群里别人说的话,以旁白形式并入 user 侧,避免被当成自己说过的
    const who = characters.get(m.authorId)?.name || '某人';
    return { role: 'user', content: isGroup ? `${who}：${text}` : text };
  });
  return mergeAdjacent(view2);
}

// 合并相邻同角色消息,部分接口不接受连续同角色。
// 带图的那条不合并 —— 合进去图就跟文字对不上了。
export function mergeAdjacent(list) {
  return list.reduce((acc, m) => {
    const last = acc[acc.length - 1];
    if (last && last.role === m.role && !last.image && !m.image) last.content += '\n' + m.content;
    else acc.push({ ...m });
    return acc;
  }, []);
}

// ---- 通话 ----
//
// 通话一轮就是一次请求，一次三分钟的通话是二十来轮。所以这里两件事跟聊天不同：
//   1. **system 只拼一次**，在通话开始时算好，整通电话复用。世界书、记忆、
//      人设在通话期间不会变，每轮重算一遍纯属白花时间（还要多跑一次向量检索）。
//   2. **回复上限压到几百 token**。电话里说一两句就停，给再多也用不上，
//      给多了反而会诱导它一口气讲完。
const CALL_MAX = 400;

export async function buildCallSystem(chat, char) {
  const msgs = messagesOf(chat.id).filter(m => m.status !== 'error');
  const { system } = buildChatSystem(chat, char, msgs, { queryVec: await queryVecFor(msgs) });
  return system + '\n\n' + template('skeleton.call');
}

export const callKey = chatId => `call:${chatId}`;
export const cancelCall = chatId => cancel(callKey(chatId));

/**
 * 通话中的一轮。lines 是这通电话到目前为止说过的话，
 * opening 是「电话刚接通，你先开口」这类一次性的指示。
 */
export function streamCall({ chat, char, system, lines = [], opening = '', onDelta }) {
  const msgs = messagesOf(chat.id).filter(m => m.status !== 'error');
  const history = buildHistory(chat, char, msgs, {});
  const talk = lines.map(l => ({
    role: l.role === 'user' ? 'user' : 'assistant',
    content: l.text,
  }));
  const tail = opening ? [{ role: 'user', content: opening }] : [];

  return enqueue(callKey(chat.id), signal => withFallback(c => getProvider(c.provider)
    .stream(c, {
      system,
      messages: mergeAdjacent([...history, ...talk, ...tail]),
      maxTokens: CALL_MAX, signal, onDelta,
    })), { replace: true, retries: 1 });
}

export function replyKey(chatId, charId) { return `reply:${chatId}:${charId}`; }
export const isReplying = (chatId, charId) => isRunning(replyKey(chatId, charId));
export const cancelReply = (chatId, charId) => cancel(replyKey(chatId, charId));

export function streamReply({ chat, char, onDelta }) {
  const msgs = messagesOf(chat.id).filter(m => m.status !== 'error');

  return enqueue(replyKey(chat.id, char.id), async signal => {
    const pics = await imagesFor(msgs);
    const history = buildHistory(chat, char, msgs, { images: pics });
    const queryVec = await queryVecFor(msgs);
    const { system } = buildChatSystem(chat, char, msgs, { queryVec });
    const text = await withFallback(c => getProvider(c.provider)
      .stream(c, { system, messages: history, maxTokens: c.maxTokens, signal, onDelta }));
    // 不 await：描述是给以后几轮用的，这一轮模型已经看过原图了，
    // 让它拖住回复的返回没有意义。
    if (pics) describeCarried(pics);
    return text;
  }, { replace: true, retries: 1 });
}

// 图给模型看过之后，再让同一个模型用一句话把它描述下来写回消息。
// 从下一轮起这条消息就是纯文字，不必再传图。
// 这一档本来就是「聊天模型自己能看图」，所以描述也用聊天模型，不需要另配接口。
async function describeCarried(pics) {
  for (const [msgId, pic] of pics) {
    try {
      const text = (await runTextTask('chat.vision-describe', {
        system: template('task.vision-describe'),
        user: '请描述这张图片。',
        image: pic,
        key: `vision-carry:${msgId}`,
        maxTokens: 500,
      }) || '').trim();
      if (!text) throw new Error('模型没有返回描述');
      messages.update(msgId, { imageDesc: text, vision: 'done', content: `[图片：${text}]` });
    } catch (err) {
      if (isAbort(err)) return;
      console.warn('[vision] 这张图没能写成描述:', err.message || err);
      messages.update(msgId, { vision: 'error', visionError: String(err.message || err) });
    }
  }
}

// 结构化任务:非流式 + 稳健 JSON 解析
export async function runJSONTask(taskId, { system, user, key, maxTokens = 1400 }) {
  const run = runnerFor(taskId);
  const raw = await enqueue(key || `task:${taskId}:${Date.now()}`, signal =>
    run(c => getProvider(c.provider).complete(c, {
      system,
      messages: [{ role: 'user', content: user || '请按要求输出 JSON。' }],
      maxTokens, signal,
    })), { retries: 1 });

  const parsed = parseJSON(raw);
  if (!parsed) {
    const err = new Error('模型返回的内容不是合法 JSON');
    err.raw = raw;
    throw err;
  }
  return parsed;
}

// image 是 { dataUrl, mediaType }，各 provider 自己转成内容块。
export async function runTextTask(taskId, { system, user, key, image, maxTokens = 900 }) {
  const run = runnerFor(taskId);
  const msg = { role: 'user', content: user || '请按要求输出。' };
  if (image) msg.image = image;
  return enqueue(key || `task:${taskId}:${Date.now()}`, signal =>
    run(c => getProvider(c.provider).complete(c, {
      system, messages: [msg], maxTokens, signal,
    })), { retries: 1 });
}

// 用指定预设跑一次，用于设置页的连接测试
export function runWithPreset(preset, { system, user, maxTokens = 64 }) {
  const c = asConfig(preset);
  return enqueue(`test:${preset.id}:${Date.now()}`, signal =>
    getProvider(c.provider).complete(c, {
      system, messages: [{ role: 'user', content: user }], maxTokens, signal,
    }), { retries: 0 });
}

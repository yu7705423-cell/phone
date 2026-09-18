import { settings, persona, characters, chats, messages, messagesOf } from '../db/index.js';
import * as accounts from '../accounts.js';
import * as clock from '../time.js';
import { assemble } from './context/index.js';
import { activate as activateLore, split as splitLore, textOf as loreText } from './context/lorebook.js';
import { fillTemplate, template } from './templates.js';
import { capabilityBlock } from './capabilities.js';
import { embedQuery, embedReady } from './embed.js';
import { getProvider } from './providers/index.js';
import { activeChat, fallbackChat, visionMode } from './services.js';
import { images } from '../db/images.js';
import * as avatarLib from '../avatar.js';
import { toDataUrl } from '../audio.js';
import { enqueue, cancel, isRunning, isAbort } from './queue.js';
import { parseJSON } from './sse.js';
import { estimate, takeLatestWithin } from './tokens.js';

// 接口协议要求带 max_tokens，取一个足够大的值，等同于不限制
export const MAX_OUTPUT = 32000;

export { template };

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
  'event.batch',       // 批量生成随机事件
  'recipe.batch',      // 批量生成食谱
  'day.plan',          // 排角色当天的日程
  'inner.voice',       // 单独生成心声
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

function budgets(total) {
  return { lorebook: Math.round(total * 0.4), memory: Math.round(total * 0.35) };
}

// 扫描窗口:最近 N 条消息拼接。世界书与 B 级记忆共用同一个窗口。
function scanTextOf(msgs, n) {
  const list = n > 0 ? msgs.slice(-n) : msgs;   // 0 = 扫整段对话
  return list.map(m => m.content || '').join('\n');
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
    lore: opts.lore || null,
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

  // 各项能力。平时只列一张单子，这一轮真沾边了才给整段细则，见 capabilities.js
  out += capabilityBlock(ctx);

  // 「对方换了头像」只该说一次。这一轮说完就记下是哪一张，下一轮它就不新了。
  if (chat.id && me?.avatar) avatarLib.markSeen(chat.id, me.avatar);

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
  const limit = Math.max(0, Math.round(n) || 0);
  if (!limit) return msgs.slice();          // 0 = 整段对话都要
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

/**
 * 把「要插进对话里」的世界书条目塞进历史。
 *
 * 深度 N = 插在**倒数第 N 条之前**，深度 1 就是贴在最后一条前面。
 * 比历史还深的（比如只剩三条却填了深度十）一律落在最前面 ——
 * 丢掉它更糟：用户明明写了一条规则，却因为聊得还不够长就不生效。
 *
 * 以 system 角色插入。不混进用户或角色的发言里：那样模型会把它当成
 * 谁说过的话，甚至回一句「好的我记住了」。
 */
export function insertLore(list, depths) {
  if (!depths || !depths.size) return list;
  const out = list.slice();
  // 从深到浅插：先插深的，浅的那一条的「倒数第 N 条」才还是原来那一条
  for (const depth of [...depths.keys()].sort((a, b) => b - a)) {
    const text = loreText(depths.get(depth));
    if (!text) continue;
    const at = Math.max(0, out.length - depth);
    out.splice(at, 0, { role: 'system', content: `[世界设定]\n${text}` });
  }
  return out;
}

// 历史消息转 API 格式。群聊时给非本人的发言加上说话人前缀。
export function buildHistory(chat, char, msgs, opts = {}) {
  const s = settings.get();
  const isGroup = (chat.characterIds || []).length > 1;
  const byTurn = s.historyMode === 'turn';
  // 条数和轮数都可以填 0，表示整段对话都进上下文（见 CLAUDE.md 第 13 条）。
  // 真正兜底的是下面的 contextBudget，它按 token 算，不按条数算。
  const capped = s.historyLimit > 0;
  const scope = byTurn
    ? takeTurns(msgs, s.historyTurns)
    : capped ? msgs.slice(-Math.max(2, s.historyLimit * 2)) : msgs.slice();
  const kept = takeLatestWithin(scope, s.contextBudget, m => m.content || '');

  const pics = opts.images || null;
  const view = (byTurn || !capped) ? kept : kept.slice(-s.historyLimit);
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
  // 先合并再插：合并会把相邻同角色的消息并成一条，插完再合并就把
  // 刚插进去的位置又挪了。
  const lore = opts.lore
    || (char ? activateLore(char, scanTextOf(msgs, s.scanWindow), budgets(s.contextBudget).lorebook).items : []);
  return insertLore(mergeAdjacent(view2), splitLore(lore).depths);
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
//      给多了反而会诱导它一口气讲完。这个数用户可以改，填 0 就是不压，
//      退回接口本身的上限（见 CLAUDE.md 第 13 条）。
const callMax = () => settings.get().callMaxTokens || 0;

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
export function streamCall({ chat, char, system, lines = [], opening = '', image, onDelta }) {
  const msgs = messagesOf(chat.id).filter(m => m.status !== 'error');
  const history = buildHistory(chat, char, msgs, {});
  const talk = lines.map(l => ({
    role: l.role === 'user' ? 'user' : 'assistant',
    content: l.text,
  }));
  const tail = opening ? [{ role: 'user', content: opening }] : [];
  const all = mergeAdjacent([...history, ...talk, ...tail]);

  // 视频通话时把摄像头那一帧挂在我这边最后说的那句上。挂不上就自己起一条 ——
  // 一帧画面没有配文也是有意义的，那就是「他现在什么样」。
  if (image) {
    let i = all.length - 1;
    while (i >= 0 && all[i].role !== 'user') i--;
    if (i >= 0) all[i] = { ...all[i], image };
    else all.push({ role: 'user', content: '（这是我这边的画面）', image });
  }

  return enqueue(callKey(chat.id), signal => withFallback(c => getProvider(c.provider)
    .stream(c, { system, messages: all, maxTokens: callMax() || c.maxTokens, signal, onDelta })),
    { replace: true, retries: 1 });
}

export function replyKey(chatId, charId) { return `reply:${chatId}:${charId}`; }
export const isReplying = (chatId, charId) => isRunning(replyKey(chatId, charId));
export const cancelReply = (chatId, charId) => cancel(replyKey(chatId, charId));

export function streamReply({ chat, char, onDelta }) {
  const msgs = messagesOf(chat.id).filter(m => m.status !== 'error');

  return enqueue(replyKey(chat.id, char.id), async signal => {
    // 今天还没排日程就先排一次，排完了这一轮才拼上下文 —— 否则「你今天」
    // 那一段要等到下一条消息才出现。开关默认关着，关着就是一句 return。
    // 动态 import：day 那个任务要用本模块，静态引会成环。
    await import('./tasks/day.js').then(m => m.ensureToday(char.id)).catch(() => {});
    const pics = await imagesFor(msgs);
    // 一轮只激活一次世界书：设定区和对话里各要一份。各算各的会把带概率的
    // 条目掷两次骰子，于是「设定区里有、对话里没有」这种鬼事就出现了。
    const s0 = settings.get();
    const lore = activateLore(char, scanTextOf(msgs, s0.scanWindow),
      budgets(s0.contextBudget).lorebook).items;
    const history = buildHistory(chat, char, msgs, { images: pics, lore });
    const queryVec = await queryVecFor(msgs);
    const { system } = buildChatSystem(chat, char, msgs, { queryVec, lore });
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

// 指定一个预设跑一次结构化任务。会联网搜索的那套接口走这条路 ——
// 它不在 chat 预设列表里，所以不能走 runJSONTask 的主用 / 副用那一套。
export async function runJSONWithPreset(preset, { system, user, key, maxTokens = 1400 }) {
  const c = asConfig(preset);
  if (!usable(c)) throw new Error('这套接口还没填全');
  const raw = await enqueue(key || `preset:${Date.now()}`, signal =>
    getProvider(c.provider).complete(c, {
      system, messages: [{ role: 'user', content: user || '请按要求输出 JSON。' }],
      maxTokens, signal,
    }), { retries: 1 });
  const parsed = parseJSON(raw);
  if (!parsed) {
    const err = new Error('模型返回的内容不是合法 JSON');
    err.raw = raw;
    throw err;
  }
  return parsed;
}

// 用指定预设跑一次，用于设置页的连接测试
export function runWithPreset(preset, { system, user, maxTokens = 64 }) {
  const c = asConfig(preset);
  return enqueue(`test:${preset.id}:${Date.now()}`, signal =>
    getProvider(c.provider).complete(c, {
      system, messages: [{ role: 'user', content: user }], maxTokens, signal,
    }), { retries: 0 });
}

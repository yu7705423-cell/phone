import { settings, persona, characters, chats, messages, messagesOf } from '../db/index.js';
import * as accounts from '../accounts.js';
import * as clock from '../time.js';
import { assemble } from './context/index.js';
import { activate as activateLore, split as splitLore, textOf as loreText } from './context/lorebook.js';
import { recallAsync as recallMemory, recallText, depthOf as memoryDepth,
  markRecalled } from './context/memory.js';
import { fillTemplate, template } from './templates.js';
import { capabilityBlock } from './capabilities.js';
import { embedQuery, embedReady } from './embed.js';
import { getProvider } from './providers/index.js';
import { activeChat, fallbackChat, visionMode, memoryConfig, memoryMode, translateMode } from './services.js';
import { images } from '../db/images.js';
import * as avatarLib from '../avatar.js';
import { toDataUrl } from '../audio.js';
import { enqueue, cancel, isRunning, isAbort } from './queue.js';
import { parseJSON } from './sse.js';
import { estimate, takeLatestWithin } from './tokens.js';
import * as trace from './trace.js';
import * as ban from '../ban.js';
import { beatsOf, timeOf, DIRECTOR, ME } from '../scene.js';

// 接口协议要求带 max_tokens，取一个足够大的值，等同于不限制
export const MAX_OUTPUT = 32000;

// 只有设定区每轮都一样的那几件值得声明缓存：对话、通话、主动找你。
// 一次性任务（总结记忆、生成相册、排行程……）的 system 每次都不同，
// 声明了也命中不了，反而按写入价多付两成五。
const CACHED_TASKS = new Set(['chat.reply', 'chat.call', 'chat.proactive', 'scene.write']);

/**
 * 所有发给模型的请求都从这里过。
 *
 * 只有一个目的：留一道门，好在门口记下这一轮实际发出去的是什么
 *（见 trace.js，默认关着）。分散在六处各调各的，就没有这样一个地方。
 * 顺带在这里按任务收窄缓存声明（见 CACHED_TASKS）。
 */
function send(taskId, c, payload, kind = 'complete') {
  const cfg = c.cache && !CACHED_TASKS.has(taskId) ? { ...c, cache: false } : c;
  const t = trace.begin({
    taskId, preset: c.name, model: c.model,
    system: payload.system, messages: payload.messages, stream: kind === 'stream',
  });
  return getProvider(cfg.provider)[kind](cfg, payload)
    .then(text => { t.done(text); return text; })
    .catch(err => { t.fail(err); throw err; });
}

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
    // 要不要声明缓存。provider 拿它决定 system 那一段带不带 cache_control；
    // send() 再按任务收窄，只有对话那几件真的带（见 CACHED_TASKS）
    cache: settings.get().promptCache !== false,
  };
}

// 只认「填全了的」预设。半填的预设当没配 —— 否则每个后台任务都要先
// 往它撞一次墙再退回来，白白慢一倍还刷一屏报错。
const usable = c => (c && c.apiKey && c.model) ? c : null;

export function config() { return usable(asConfig(activeChat())); }
export function fallbackConfig() { return usable(asConfig(fallbackChat())); }

export function isConfigured() { return !!config(); }

// 哪件事走哪套接口。见 CLAUDE.md 第 15 条。
//
// **只有你正盯着屏幕等的那两件走主用，其余一律归副用。**
// 整理记忆、排日程、生成 NPC、写朋友圈这些，慢一点没人会发现，
// 不该和聊天抢同一个（通常更贵的）接口。
//
// 副用没配就退回主用。那是「用哪一套」，不是多打一次 —— 不必给开关。
// 线下正文也算 —— 你正盯着屏幕等它一段一段往下写
const MAIN_TASKS = new Set(['chat.reply', 'chat.call', 'scene.write']);

// 记忆那几件还可以再单独配一套，见「设置 - 记忆接口」。
// 它们是量最大也最不着急的一批，值得单独挑一个便宜模型。
const MEMORY_TASKS = new Set([
  'memory.extract',    // 自动总结记忆
  'memory.bond',       // 把 S 级记忆压成关系底色
  'memory.import',     // 粘一大段文字拆成记忆
  'chat.summarize',    // 历史压缩
  'scene.summary',     // 线下一场的摘要，也是线下与线上之间唯一的通道
]);

const memoryPreset = () => (memoryMode() === 'api'
  ? usable(asConfig({ id: 'memory', name: '记忆接口', ...memoryConfig() }))
  : null);

/** 这个任务该用哪套。挑不出来就是一套都没配全。 */
export function presetFor(taskId) {
  if (MAIN_TASKS.has(taskId)) return config() || fallbackConfig();
  if (MEMORY_TASKS.has(taskId)) {
    const m = memoryPreset();
    if (m) return m;
  }
  return fallbackConfig() || config();
}

// 挑剩下的那一套，给「失败了换一个再试」用。和 a 是同一套就当没有。
function otherThan(a) {
  const list = [config(), fallbackConfig()].filter(Boolean);
  return list.find(c => c && c.id !== a.id) || null;
}

/**
 * 跑一次。
 *
 * **失败之后换另一套再试是第二次调用，所以默认关着**（第 15 条）。
 * 想开在「设置 - 用量与上限」里。取消不算失败，任何时候都不触发。
 */
async function runWith(taskId, run) {
  const a = presetFor(taskId);
  if (!a) throw new Error('还没有配置接口，或者配的那个没填全（缺密钥或模型）');
  try {
    return await run(a);
  } catch (err) {
    const b = settings.get().chatFallback === true && !isAbort(err) ? otherThan(a) : null;
    if (!b) {
      // 把是哪个预设挂的写进报错，不然一句「请求失败」根本没法查
      err.message = `${a.name || '接口'}：${err.message}`;
      throw err;
    }
    console.warn('[ai] 接口失败，改用另一套', err.message);
    return run(b);
  }
}

const runnerFor = taskId => run => runWith(taskId, run);

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
export const queryVecFor = msgs => queryVecOf(scanTextOf(msgs, settings.get().scanWindow));

export async function queryVecOf(raw) {
  const s = settings.get();
  if (!s.memoryEnabled || s.memoryVector !== true || !embedReady()) return null;
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return await embedQuery(text);
  } catch (err) {
    console.warn('[memory] 取查询向量失败，这轮退回关键词检索:', err.message || err);
    return null;
  }
}

/**
 * 性别那一段。只写填了的一方，没填就不写 —— 不替用户猜，
 * 猜错比不写更糟。两边都没填就整段不出现。
 */
function genderBlock(char, me, names) {
  const lines = [];
  const cg = String(char?.gender || '').trim();
  const ug = String(me?.gender || '').trim();
  if (cg) lines.push(`${names.charName}：${cg}`);
  if (ug) lines.push(`${names.userName}：${ug}`);
  if (!lines.length) return '';
  return fillTemplate(template('skeleton.gender'), { lines: lines.join('\n') });
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
    recall: opts.recall || null,
  };

  const names = { charName: char.name || '对方', userName: me.name || '对方' };
  let out = fillTemplate(template('skeleton.opening'), names);

  // 性别锚点。这是唯一一处绝对不能弄错的事实，所以首尾各放一次 ——
  // 长上下文里只说一遍的东西会被忽略掉，两头都说才钉得住。
  const gender = genderBlock(char, me, names);
  if (gender) out += '\n\n' + gender;

  // 每轮都变的那几块不进设定区，交给 buildHistory 插到对话末尾去
  // （见 context/index.js 的 VOLATILE 那一段）
  const { text, volatile: hot, failed } = assemble(s.injectOrder, ctx);
  out += text;

  if (chat.summary) out += `\n\n[更早之前发生过什么]\n${chat.summary}`;

  if (others.length) {
    out += '\n\n' + fillTemplate(template('skeleton.group'), {
      members: others.map(c => c.name).join('、'),
    });
  }

  out += '\n\n' + template('skeleton.rules');

  // 各项能力。平时只列一张单子，这一轮真沾边了才给整段细则，见 capabilities.js
  out += capabilityBlock(ctx);

  // 收尾两件，贴着输出放：核心设定、性别。靠后的位置模型读得最重。
  //
  // 从前这里还有一段「冲突时的取舍」，规定人设 > 世界 > 其余。那是替用户
  // 排优先级 —— 哪条该让哪条，是他自己写这几份设定时的事，不该由内置
  // 提示词代判（见 CLAUDE.md 第 16 条）。
  const core = String(char.core || '').trim();
  if (core) out += '\n\n' + fillTemplate(template('skeleton.core'), { core });
  // 禁写词也放这儿，理由同上：它是一条约束，离输出越近越管得住。
  // 列表空着就整段不出现 —— 默认就是空的（见 system/ban.js）
  if (ban.on()) out += '\n\n' + fillTemplate(template('skeleton.ban'), { list: ban.promptLines() });
  if (gender) out += '\n\n' + gender;

  // 「对方换了头像」只该说一次。这一轮说完就记下是哪一张，下一轮它就不新了。
  if (chat.id && me?.avatar) avatarLib.markSeen(chat.id, me.avatar);

  return { system: out, volatile: hot, failed, tokens: estimate(out) };
}

// 引用过的消息在上下文里要带上出处,不然「是啊」这种回应模型根本不知道在应哪句。
// 原消息还在就取现文(可能被编辑过),删了就用当初存的快照。
function withQuote(m) {
  if (!m.quoteId && !m.quoteText) return m.content;
  const src = m.quoteId ? messages.get(m.quoteId) : null;
  const q = String((src ? src.content : m.quoteText) || '').replace(/\s+/g, ' ').trim();
  if (!q) return m.content;
  return `(in reply to 「${q.length > 40 ? q.slice(0, 40) + '…' : q}」) ${m.content}`;
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
    const group = depths.get(depth);
    // raw 的那几条自带抬头（本轮相关记忆就是），不要再包一层 [世界设定]
    const lore = group.filter(e => !e.raw);
    const raw = group.filter(e => e.raw).map(e => e.content).join('\n\n');
    const body = [lore.length ? `[世界设定]\n${loreText(lore)}` : '', raw]
      .filter(Boolean).join('\n\n');
    if (!body) continue;
    const at = Math.max(0, out.length - depth);
    out.splice(at, 0, { role: 'system', content: body });
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
  // 行内译文开着时，角色自己的旧消息要带着那一行 [译文：…] 回到历史里。
  // 模型最听自己前几轮的样子：历史里一条译文都没有，等于每一轮都在示范
  // 「不必翻」，设定区里那段规则拗不过几十个反例 —— 掉翻译多半是这么掉的。
  // 界面上那一行是从消息里剥出来单独存的（reply.js），这里再拼回去。
  const inlineTrans = !!chat.translateTo && translateMode() === 'inline';
  const view2 = view.map((m, i) => {
    const mine = m.role === 'char' && m.authorId === char.id;
    const text = timeLine(m, view[i - 1]) + withQuote(m);
    if (m.role === 'user') {
      const pic = pics && pics.get(m.id);
      return pic ? { role: 'user', content: text, image: pic } : { role: 'user', content: text };
    }
    if (mine) {
      const tr = inlineTrans ? String(m.translation || '').trim() : '';
      return { role: 'assistant', content: tr ? `${text}\n[译文：${tr}]` : text };
    }
    // 群里别人说的话,以旁白形式并入 user 侧,避免被当成自己说过的
    const who = characters.get(m.authorId)?.name || '某人';
    return { role: 'user', content: isGroup ? `${who}：${text}` : text };
  });
  // 先合并再插：合并会把相邻同角色的消息并成一条，插完再合并就把
  // 刚插进去的位置又挪了。
  const lore = opts.lore
    || (char ? activateLore(char, scanTextOf(msgs, s.scanWindow), budgets(s.contextBudget).lorebook).items : []);
  const depths = splitLore(lore).depths;

  // 每轮都变的那几块，连同本轮召回，一起插到对话末尾。
  //
  // 两个理由：**缓存**（放进设定区会让它后面所有稳定内容每轮作废，
  // 见 context/index.js 的 VOLATILE）与**注意力**（末尾是模型读得最重的
  // 位置之一，而「现在几点」「你们看到哪儿了」本来就该贴着最后一句话）。
  //
  // 召回排在状态后面 —— 越靠近最后一条消息越不容易被忽略，而召回是这一段
  // 里最该被看见的。
  //
  // 译文提醒排最后：格式要求在开头说一遍、末尾再说一遍，长对话里才不会丢。
  const md = memoryDepth(s);
  const tail = [
    String(opts.volatile || '').trim(),
    md > 0 && opts.recall?.length ? recallText(opts.recall) : '',
    inlineTrans ? fillTemplate(template('skeleton.translate-tail'), { lang: chat.translateTo }) : '',
  ].filter(Boolean).join('\n\n');
  if (tail) depths.set(md || 1, [...(depths.get(md || 1) || []), { content: tail, raw: true }]);
  return insertLore(mergeAdjacent(view2), depths);
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
  const { system, volatile: hot } = buildChatSystem(chat, char, msgs, { queryVec: await queryVecFor(msgs) });
  // 通话没有 buildHistory 那条路，下沉的那几块只能接回来。
  // 这里也不必为缓存操心：整通电话只拼一次 system，本来就复用。
  return [system, hot, template('skeleton.call')].filter(Boolean).join('\n\n');
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
    else all.push({ role: 'user', content: '(this is the view from my side)', image });
  }

  return enqueue(callKey(chat.id), signal => runWith('chat.call', c => send('chat.call', c,
    { system, messages: all, maxTokens: callMax() || c.maxTokens, signal, onDelta }, 'stream')),
    { replace: true, retries: 1 });
}

// ---- 线下 ----
//
// 线上是一条条短气泡，线下是大段散文，所以另走一条：另一套骨架、另一份预算、
// 另一套历史。共用的只有底下那些注入区块（角色卡、世界书、记忆、人设、时刻）。
// 见 ARCHITECTURE 4.107
//
// **几个数和线上分开。** 线上几十条才顶满预算，线下三段就顶满了，
// 共用一个数必然有一边不对。一律 0 表示不限（第 13 条）。

const sceneMax = () => Math.max(0, Math.round(Number(settings.get().sceneMaxTokens) || 0));
const sceneBudget = () => Math.max(0, Math.round(Number(settings.get().sceneBudget) || 0));

const sceneScan = (list, n) =>
  (n > 0 ? list.slice(-n) : list).map(b => b.text || '').join('\n');

/**
 * 这一轮该听哪几条场外指示。
 *
 * **常驻的一直在，其余只管下一段。** 二十段之前随手写的「让他生气一点」
 * 不该一直挂着，可「整场都用第二人称」这种又必须留住 —— 所以给一个
 * 「一直有效」的勾，而不是两边取一个。
 */
function directorLines(list) {
  const fresh = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role !== DIRECTOR) break;
    if (!list[i].hold) fresh.unshift(list[i]);
  }
  const held = list.filter(b => b.role === DIRECTOR && b.hold);
  return [...held, ...fresh].map(b => String(b.text || '').trim()).filter(Boolean);
}

/** 这一场的几件事实。是数据，不是指令。 */
function sceneSetup(scene, others) {
  const lines = [];
  if (scene.place) lines.push(`地点：${scene.place}`);
  const now = timeOf(scene.id);
  if (now) lines.push(`时刻：${now}`);
  if (others.length) lines.push(`在场：${others.map(c => c.name).join('、')}`);
  if (scene.note) lines.push(`情境：${scene.note}`);
  if (!lines.length) return '';
  return fillTemplate(template('skeleton.scene-setup'), { lines: lines.join('\n') });
}

export function buildSceneSystem(scene, chat, char, list, opts = {}) {
  const s = settings.get();
  const me = accounts.get(chat?.personaId) || accounts.current() || persona.get();
  const others = (scene.castIds || []).filter(id => id !== char.id)
    .map(id => characters.get(id)).filter(Boolean);
  const budget = sceneBudget();

  const ctx = {
    char, chat, persona: me, settings: s,
    // 注入区块照旧读聊天记录（「你今天」「正在听什么」那些是线上的状态），
    // 但世界书与 B 级记忆按线下正文扫 —— 该被这一场勾起来的是这一场的字
    messages: messagesOf(chat.id).filter(m => m.status !== 'error'),
    scanText: sceneScan(list, s.sceneScan),
    budgets: budgets(budget),
    queryVec: opts.queryVec || null,
    lore: opts.lore || null,
    recall: opts.recall || null,
  };

  const names = { charName: char.name || '对方', userName: me.name || '对方' };
  let out = fillTemplate(template('skeleton.scene-opening'), names);

  const gender = genderBlock(char, me, names);
  if (gender) out += '\n\n' + gender;

  const { text, volatile: hot, failed } = assemble(s.injectOrder, ctx);
  out += text;

  // 摘要互通，原文不互通（4.107）。两边的上下文预算各算各的，
  // 互相灌原文长期必然顶爆。
  if (chat.summary) out += `\n\n[更早之前发生过什么]\n${chat.summary}`;
  if (scene.summary) out += `\n\n[这一场之前发生过什么]\n${scene.summary}`;

  if (others.length) {
    out += '\n\n' + fillTemplate(template('skeleton.group'), {
      members: others.map(c => c.name).join('、'),
    });
  }

  out += '\n\n' + fillTemplate(template('skeleton.scene-rules'), names);
  const setup = sceneSetup(scene, others);
  if (setup) out += '\n\n' + setup;
  // 时刻仍走线上那套协议：模型写 [时间：…]，本地摘下来记在这一段上
  out += '\n\n' + template('skeleton.time');

  // 篇幅是用户填的数，这里只转述。填 0 就整段不出现 —— 不替他定写多长
  const words = Math.max(0, Math.round(Number(s.sceneWords) || 0));
  if (words) out += '\n\n' + fillTemplate(template('skeleton.scene-length'), { words });

  const core = String(char.core || '').trim();
  if (core) out += '\n\n' + fillTemplate(template('skeleton.core'), { core });
  if (ban.on()) out += '\n\n' + fillTemplate(template('skeleton.ban'), { list: ban.promptLines() });
  if (gender) out += '\n\n' + gender;

  return { system: out, volatile: hot, failed, tokens: estimate(out) };
}

export function buildSceneHistory(scene, chat, char, list, opts = {}) {
  const s = settings.get();
  const me = accounts.get(chat?.personaId) || accounts.current() || persona.get();
  const isGroup = (scene.castIds || []).length > 1;

  const body = list.filter(b => b.role !== DIRECTOR);
  const n = Math.max(0, Math.round(Number(s.sceneWindow) || 0));
  const scope = n > 0 ? body.slice(-n) : body;
  const kept = takeLatestWithin(scope, sceneBudget(), b => b.text || '');
  // 钉住的那几段不受窗口与预算约束 —— 钉住的意思就是「这一段永远要在」
  const inKept = new Set(kept.map(b => b.id));
  const pinned = body.filter(b => b.pinned && !inKept.has(b.id));
  const all = [...pinned, ...kept];

  const view = all.map(b => {
    if (b.role === ME) return { role: 'user', content: b.text };
    if (isGroup && b.authorId !== char.id) {
      const who = characters.get(b.authorId)?.name || '某人';
      return { role: 'user', content: `${who}：${b.text}` };
    }
    return { role: 'assistant', content: b.text };
  });

  const md = memoryDepth(s);
  const dir = directorLines(list);
  const tail = [
    String(opts.volatile || '').trim(),
    md > 0 && opts.recall?.length ? recallText(opts.recall) : '',
    dir.length
      ? fillTemplate(template('skeleton.scene-director'),
        { lines: dir.join('\n'), userName: me.name || '对方' })
      : '',
    // 贴着输出再说一遍。设定区那一段离这里隔着整场戏
    fillTemplate(template('skeleton.scene-tail'), { userName: me.name || '对方' }),
  ].filter(Boolean).join('\n\n');

  return mergeAdjacent([...view, { role: 'user', content: tail }]);
}

export const sceneKey = id => `scene:${id}`;
export const isWriting = id => isRunning(sceneKey(id));
export const cancelScene = id => cancel(sceneKey(id));

export function streamScene({ scene, chat, char, onDelta }) {
  return enqueue(sceneKey(scene.id), async signal => {
    const list = beatsOf(scene.id);
    const s0 = settings.get();
    const scan = sceneScan(list, s0.sceneScan);
    const lore = activateLore(char, scan, budgets(sceneBudget()).lorebook).items;
    const me = accounts.get(chat?.personaId) || accounts.current();
    const queryVec = await queryVecOf(scan);
    const recall = await recallMemory({
      settings: s0, char, scanText: scan,
      budgets: budgets(sceneBudget()), queryVec, persona: me,
    });
    const { system, volatile: hot } = buildSceneSystem(scene, chat, char, list, { queryVec, lore, recall });
    const history = buildSceneHistory(scene, chat, char, list, { lore, recall, volatile: hot });
    const oneShot = s0.streamMode === 'once';
    // maxTokens 默认 0：OpenAI 兼容那边整个字段都不送，服务端用自己的上限。
    // 填一个大数反而会被上限低的模型退回来（见 providers/openai.js）
    const text = await runWith('scene.write', c => send('scene.write', c,
      { system, messages: history, maxTokens: sceneMax(), signal, onDelta: oneShot ? undefined : onDelta },
      oneShot ? 'complete' : 'stream'));
    if (recall?.length) markRecalled(recall);
    return text;
  }, { replace: true, retries: 1 });
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
    // 她在听什么：读角色那个音乐账号的真实播放记录。不调模型，只压自己
    // 部署的那个音乐接口，间隔由用户填，填 0 就只在手动点的时候拉。
    await import('../netease.js').then(m => m.pullIfDue(char.id)).catch(() => {});
    // 关系底色：S 级记忆有增删改时重压一遍。不 await —— 这一轮用旧的那份，
    // 下一轮就是新的。压一次要花一次接口调用，所以只在签名变了时才跑，
    // 而且整项可以关掉（见「用量与上限」）。
    if (settings.get().bondAuto !== false) {
      import('../bond.js')
        .then(m => m.refresh(char.id, chat.personaId))
        .catch(err => console.warn('[bond] 没压成:', err.message || err));
    }
    const pics = await imagesFor(msgs);
    // 一轮只激活一次世界书：设定区和对话里各要一份。各算各的会把带概率的
    // 条目掷两次骰子，于是「设定区里有、对话里没有」这种鬼事就出现了。
    const s0 = settings.get();
    const lore = activateLore(char, scanTextOf(msgs, s0.scanWindow),
      budgets(s0.contextBudget).lorebook).items;
    const queryVec = await queryVecFor(msgs);
    // 召回也是一轮只算一次：设定区与对话里用的必须是同一份，
    // 而且向量检索本身要花一次接口调用。
    const me = accounts.get(chat?.personaId) || accounts.current();
    // 开了重排的话这一步要等一次请求。没开就是同步返回，不多花时间
    const recall = await recallMemory({
      settings: s0, char, scanText: scanTextOf(msgs, s0.scanWindow),
      budgets: budgets(s0.contextBudget), queryVec, persona: me,
    });
    // 先拼 system：每轮都变的那几块由它挑出来，交给 buildHistory 插到对话末尾
    const { system, volatile: hot } = buildChatSystem(chat, char, msgs, { queryVec, lore, recall });
    const history = buildHistory(chat, char, msgs, { images: pics, lore, recall, volatile: hot });
    // 流式 / 一次返回。流式能看见字一个个出来，但**自检那一段也是流式吐的**，
    // 剥掉之后前面几秒气泡是空的，看着像卡住。一次返回则是等齐了整段才出现，
    // 中间只有「正在输入」。两种都有人要，所以给开关。
    const oneShot = settings.get().streamMode === 'once';
    const text = await runWith('chat.reply', c => send('chat.reply', c,
      { system, messages: history, maxTokens: c.maxTokens, signal, onDelta: oneShot ? undefined : onDelta },
      oneShot ? 'complete' : 'stream'));
    // 这几条记忆真的送出去了，记一笔：往后它们更容易被想起（强度），
    // 而接下来几轮会被压下去（疲劳）。请求成功之后才记 —— 拼好了没发成
    // 不算想起过
    if (recall?.length) markRecalled(recall);
    // 不 await：描述是给以后几轮用的，这一轮模型已经看过原图了，
    // 让它拖住回复的返回没有意义。
    if (pics) describeCarried(pics);
    return text;
  }, { replace: true, retries: 1 });
}

/**
 * 一小段原文，用来告诉模型「这段对话是什么语言」。
 *
 * 描述图片这件事本身没有语言线索 —— 图上没有字。从前这里写死「用中文描述」，
 * 那是替用户拿主意（见 CLAUDE.md 第 16 条），而角色来自各个国家。
 * 改成给它一段实际的原文照着走：先拿这段对话最近说的话，没有就拿角色卡。
 */
function langSampleOf(msgId) {
  const m = messages.get(msgId);
  const list = m ? messagesOf(m.chatId).filter(x => x.kind === 'text' && x.content) : [];
  const recent = list.slice(-3).map(x => x.content).join('\n').trim();
  if (recent) return recent.slice(0, 200);
  const char = characters.get((chats.get(m?.chatId)?.characterIds || [])[0]);
  return String(char?.persona || char?.name || '').slice(0, 200);
}

// 图给模型看过之后，再让同一个模型用一句话把它描述下来写回消息。
// 从下一轮起这条消息就是纯文字，不必再传图。
// 这一档本来就是「聊天模型自己能看图」，所以描述也用聊天模型，不需要另配接口。
async function describeCarried(pics) {
  for (const [msgId, pic] of pics) {
    try {
      const text = (await runTextTask('chat.vision-describe', {
        system: fillTemplate(template('task.vision-describe'), { sample: langSampleOf(msgId) }),
        user: 'Describe this image as instructed.',
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
    run(c => send(taskId, c, {
      system,
      messages: [{ role: 'user', content: user || 'Produce the JSON as instructed.' }],
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
  const msg = { role: 'user', content: user || 'Produce the output as instructed.' };
  if (image) msg.image = image;
  return enqueue(key || `task:${taskId}:${Date.now()}`, signal =>
    run(c => send(taskId, c, { system, messages: [msg], maxTokens, signal })), { retries: 1 });
}

// 指定一个预设跑一次结构化任务。会联网搜索的那套接口走这条路 ——
// 它不在 chat 预设列表里，所以不能走 runJSONTask 的主用 / 副用那一套。
export async function runJSONWithPreset(preset, { system, user, key, maxTokens = 1400, taskId }) {
  const c = asConfig(preset);
  if (!usable(c)) throw new Error('这套接口还没填全');
  const raw = await enqueue(key || `preset:${Date.now()}`, signal =>
    send(taskId || 'preset.json', c, {
      system, messages: [{ role: 'user', content: user || 'Produce the JSON as instructed.' }],
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
    send('preset.test', c, {
      system, messages: [{ role: 'user', content: user }], maxTokens, signal,
    }), { retries: 0 });
}

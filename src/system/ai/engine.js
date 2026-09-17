import { settings, persona, characters, chats, messagesOf } from '../db/index.js';
import * as accounts from '../accounts.js';
import { assemble } from './context/index.js';
import { DEFAULT_TEMPLATES, fillTemplate } from './templates.js';
import { embedQuery, embedReady } from './embed.js';
import { getProvider } from './providers/index.js';
import { activeChat, fallbackChat } from './services.js';
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
  out += mediaInstruction(char);
  return { system: out, failed, tokens: estimate(out) };
}

// 历史消息转 API 格式。群聊时给非本人的发言加上说话人前缀。
export function buildHistory(chat, char, msgs) {
  const s = settings.get();
  const isGroup = (chat.characterIds || []).length > 1;
  const kept = takeLatestWithin(
    msgs.slice(-Math.max(2, s.historyLimit * 2)),
    s.contextBudget,
    m => m.content || '');

  return kept.slice(-s.historyLimit).map(m => {
    const mine = m.role === 'char' && m.authorId === char.id;
    if (m.role === 'user') {
      return { role: 'user', content: m.content };
    }
    if (mine) return { role: 'assistant', content: m.content };
    // 群里别人说的话,以旁白形式并入 user 侧,避免被当成自己说过的
    const who = characters.get(m.authorId)?.name || '某人';
    return { role: 'user', content: isGroup ? `${who}：${m.content}` : m.content };
  }).reduce((acc, m) => {
    // 合并相邻同角色消息,部分接口不接受连续同角色
    const last = acc[acc.length - 1];
    if (last && last.role === m.role) last.content += '\n' + m.content;
    else acc.push({ ...m });
    return acc;
  }, []);
}

export function replyKey(chatId, charId) { return `reply:${chatId}:${charId}`; }
export const isReplying = (chatId, charId) => isRunning(replyKey(chatId, charId));
export const cancelReply = (chatId, charId) => cancel(replyKey(chatId, charId));

export function streamReply({ chat, char, onDelta }) {
  const msgs = messagesOf(chat.id).filter(m => m.status !== 'error');
  const history = buildHistory(chat, char, msgs);

  return enqueue(replyKey(chat.id, char.id), async signal => {
    const queryVec = await queryVecFor(msgs);
    const { system } = buildChatSystem(chat, char, msgs, { queryVec });
    return withFallback(c => getProvider(c.provider)
      .stream(c, { system, messages: history, maxTokens: c.maxTokens, signal, onDelta }));
  }, { replace: true, retries: 1 });
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

export async function runTextTask(taskId, { system, user, key, maxTokens = 900 }) {
  const run = runnerFor(taskId);
  return enqueue(key || `task:${taskId}:${Date.now()}`, signal =>
    run(c => getProvider(c.provider).complete(c, {
      system,
      messages: [{ role: 'user', content: user || '请按要求输出。' }],
      maxTokens, signal,
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

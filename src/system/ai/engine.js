import { settings, persona, characters, chats, messagesOf } from '../db/index.js';
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

export function config() { return asConfig(activeChat()); }
export function fallbackConfig() { return asConfig(fallbackChat()); }

export function isConfigured() {
  const c = config();
  return !!(c && c.apiKey && c.model);
}

// 主用失败时自动换副用再试一次。取消不算失败，不触发兜底。
async function withFallback(run) {
  const primary = config();
  if (!primary) throw new Error('还没有配置接口');
  try {
    return await run(primary);
  } catch (err) {
    const spare = fallbackConfig();
    if (!spare || isAbort(err)) throw err;
    console.warn('[ai] 主用接口失败，改用副用', err.message);
    return run(spare);
  }
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
  const me = persona.get();
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
  const raw = await enqueue(key || `task:${taskId}:${Date.now()}`, signal =>
    withFallback(c => getProvider(c.provider).complete(c, {
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
  return enqueue(key || `task:${taskId}:${Date.now()}`, signal =>
    withFallback(c => getProvider(c.provider).complete(c, {
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

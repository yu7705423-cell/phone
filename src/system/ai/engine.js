import { settings, persona, characters, chats, messagesOf } from '../db/index.js';
import { assemble } from './context/index.js';
import { DEFAULT_TEMPLATES, fillTemplate } from './templates.js';
import { getProvider } from './providers/index.js';
import { enqueue, cancel, isRunning } from './queue.js';
import { parseJSON } from './sse.js';
import { estimate, takeLatestWithin } from './tokens.js';

export function template(id) {
  const s = settings.get();
  return (s.promptTemplates && s.promptTemplates[id]) || DEFAULT_TEMPLATES[id] || '';
}

export function config() {
  const s = settings.get();
  return {
    provider: s.provider,
    apiKey: s.apiKey.trim(),
    baseUrl: s.baseUrl.trim(),
    model: s.model.trim(),
    temperature: s.temperature,
    effort: s.effort,
    maxTokens: s.maxTokens,
  };
}

export function isConfigured() {
  const c = config();
  return !!(c.apiKey && c.model);
}

function budgets(total) {
  return { lorebook: Math.round(total * 0.4), memory: Math.round(total * 0.35) };
}

// 扫描窗口:最近 N 条消息拼接。世界书与 B 级记忆共用同一个窗口。
function scanTextOf(msgs, n) {
  return msgs.slice(-n).map(m => m.content || '').join('\n');
}

export function buildChatSystem(chat, char, msgs) {
  const s = settings.get();
  const me = persona.get();
  const others = (chat.characterIds || []).filter(id => id !== char.id)
    .map(id => characters.get(id)).filter(Boolean);

  const ctx = {
    char, chat, messages: msgs, persona: me, settings: s,
    scanText: scanTextOf(msgs, s.scanWindow),
    budgets: budgets(s.contextBudget),
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
  const c = config();
  const provider = getProvider(c.provider);
  const msgs = messagesOf(chat.id).filter(m => m.status !== 'error');
  const { system } = buildChatSystem(chat, char, msgs);
  const history = buildHistory(chat, char, msgs);

  return enqueue(replyKey(chat.id, char.id), signal =>
    provider.stream(c, { system, messages: history, maxTokens: c.maxTokens, signal, onDelta }),
    { replace: true, retries: 1 });
}

// 结构化任务:非流式 + 稳健 JSON 解析
export async function runJSONTask(taskId, { system, user, key, maxTokens = 1400 }) {
  const c = config();
  const provider = getProvider(c.provider);
  const raw = await enqueue(key || `task:${taskId}:${Date.now()}`, signal =>
    provider.complete(c, {
      system,
      messages: [{ role: 'user', content: user || '请按要求输出 JSON。' }],
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

export async function runTextTask(taskId, { system, user, key, maxTokens = 900 }) {
  const c = config();
  const provider = getProvider(c.provider);
  return enqueue(key || `task:${taskId}:${Date.now()}`, signal =>
    provider.complete(c, {
      system,
      messages: [{ role: 'user', content: user || '请按要求输出。' }],
      maxTokens, signal,
    }), { retries: 1 });
}

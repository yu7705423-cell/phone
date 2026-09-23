import { messages, messagesOf, settings, chats } from './db/index.js';
import * as svc from './ai/services.js';
import * as mcp from './mcp.js';

// 角色那一侧的 MCP：它能用哪些工具、写出来的名字对应哪台服务器的哪个工具、
// 调之前要不要先问你、调完之后要不要接着回复。
//
// 连接与协议在 mcp.js，这里只管「角色」与「会话」。
//
// 一次调用落成一条消息（kind: 'tool'），状态走：
//   ask      等你允许（服务器设成要确认时）
//   running  正在调
//   done     拿到结果（toolResult）
//   error    失败（toolError）
//   denied   你拒绝了
// 结果以「[工具结果：名字]」跟在那条调用后面进历史（engine.buildHistory），
// 角色下一次回复时读得到。

/** 这个角色能用的服务器：角色卡上勾了的、而且还在的那几台 */
export function serversFor(char) {
  const ids = Array.isArray(char?.mcpServers) ? char.mcpServers : [];
  return svc.mcpServers().filter(s => ids.includes(s.id) && s.url);
}

const prefixOf = server => String(server.name || 'server').trim().replace(/[\s.]+/g, '_') || 'server';

/**
 * 这个角色能用的工具，每个带着写给模型看的那个名字（call）。
 * 两台服务器有同名工具时，名字前面加服务器名，写成「服务器.工具」
 */
export function toolsFor(char) {
  const list = [];
  serversFor(char).forEach(server => (server.tools || []).forEach(tool => {
    if (!(server.toolsOff || []).includes(tool.name)) list.push({ server, tool });
  }));
  const seen = new Map();
  list.forEach(x => seen.set(x.tool.name, (seen.get(x.tool.name) || 0) + 1));
  return list.map(x => ({ ...x, call: seen.get(x.tool.name) > 1 ? `${prefixOf(x.server)}.${x.tool.name}` : x.tool.name }));
}

/** 角色写的名字对应哪一个。带不带服务器前缀都认 */
export function resolve(char, name) {
  const n = String(name || '').trim();
  const all = toolsFor(char);
  return all.find(x => x.call === n)
    || all.find(x => `${prefixOf(x.server)}.${x.tool.name}` === n)
    || all.find(x => x.tool.name === n)
    || null;
}

export function needsAsk(server, tool) {
  const a = server?.approve || 'ask';
  return a === 'ask' || (a === 'read' && !tool?.readOnly);
}

/** 连上一台服务器、取回工具清单，存进配置。设置页的「连接」按钮 */
export async function refresh(id) {
  const server = svc.mcpServer(id);
  if (!server) throw new Error('这台服务器已删除');
  try {
    const r = await mcp.probe(server);
    svc.updateMcpServer(id, {
      tools: r.tools, info: r.info, gen: r.gen, version: r.version,
      checkedAt: Date.now(), error: '',
    });
    return r;
  } catch (err) {
    svc.updateMcpServer(id, { checkedAt: Date.now(), error: String(err.message || err) });
    throw err;
  }
}

export const forget = id => mcp.forget(id);

/**
 * 在 MCP app 里手动调一次。不经过角色、不落消息 —— 用来看这台服务器、这个工具通不通，
 * 参数写对了会回来什么
 */
export async function tryTool(id, name, args = {}) {
  const server = svc.mcpServer(id);
  if (!server) throw new Error('这台服务器已删除');
  const t0 = Date.now();
  const r = await mcp.callTool(server, name, args);
  return { text: mcp.resultText(r), isError: !!r?.isError, ms: Date.now() - t0 };
}

/** 所有会话里的工具调用，新的在前。MCP app 的「调用记录」 */
export function calls() {
  return messages.all().filter(m => m.kind === 'tool').sort((a, b) => b.createdAt - a.createdAt);
}

export const STATE_TEXT = { ask: '等待允许', running: '正在调用', done: '已完成', error: '失败', denied: '已拒绝' };

// ---- 调用 ----

const running = new Map();   // 消息 id -> AbortController
export const isRunning = id => running.has(id);

/**
 * 把一条调用真的发出去。
 *
 * 状态停在 running 却不在 running 表里的，是页面重开时正在调的那一次 ——
 * 工具可能有副作用（发邮件、写文件），不自动重调，界面上给一个「重试」。
 */
export async function run(msgId) {
  const m = messages.get(msgId);
  if (!m || m.kind !== 'tool' || running.has(msgId)) return;
  const server = svc.mcpServer(m.toolServerId);
  if (!server) {
    messages.update(msgId, { toolState: 'error', toolError: '这台服务器已删除' });
    followUp(m.chatId, m.turnId);
    return;
  }
  const ctl = new AbortController();
  running.set(msgId, ctl);
  messages.update(msgId, { toolState: 'running', toolError: '' });
  try {
    const r = await mcp.callTool(server, m.toolName, m.toolArgs || {}, { signal: ctl.signal });
    const text = mcp.resultText(r);
    messages.update(msgId, r?.isError
      ? { toolState: 'error', toolResult: text, toolError: text || '工具返回了错误' }
      : { toolState: 'done', toolResult: text, toolError: '', toolAt: Date.now() });
  } catch (err) {
    messages.update(msgId, { toolState: 'error', toolError: String(err.message || err) });
  } finally {
    running.delete(msgId);
  }
  followUp(m.chatId, m.turnId);
}

export function approve(msgId) { return run(msgId); }

export function deny(msgId) {
  const m = messages.get(msgId);
  if (!m) return;
  messages.update(msgId, { toolState: 'denied' });
  followUp(m.chatId, m.turnId);
}

export function cancel(msgId) {
  running.get(msgId)?.abort(new Error('已取消'));
}

/**
 * 结果回来之后要不要让角色接着说。
 *
 * **默认不接**（CLAUDE.md 第 15 条：接着说是又一次接口调用）。不接的时候，
 * 结果照样留在对话里，角色下一次回复时读得到。
 *
 * 开着的话：这一轮的调用都有了结果（允许、拒绝、失败都算），就把这段对话
 * 记成「该回复了」—— 走的是 pace 那一套到点回复（会话页开着就当场回，
 * 人在别处由全局那个定时器回，并且会通知）。
 *
 * 轮数：从你上一条消息往后，角色有几轮调用过工具。超过设定就停，
 * 免得它调一次、看结果、再调一次，一直转下去。0 表示不限（第 13 条）。
 */
export function followUp(chatId, turnId) {
  const s = settings.get();
  if (s.mcpFollowUp !== true) return false;
  const list = messagesOf(chatId);
  const turn = list.filter(m => m.kind === 'tool' && m.turnId === turnId);
  if (turn.some(m => m.toolState === 'ask' || m.toolState === 'running')) return false;
  const turns = new Set();
  for (let i = list.length - 1; i >= 0 && list[i].role !== 'user'; i--) {
    if (list[i].kind === 'tool' && list[i].turnId) turns.add(list[i].turnId);
  }
  const max = Math.max(0, Number(s.mcpFollowMax) || 0);
  if (max > 0 && turns.size > max) return false;
  chats.update(chatId, { pacePending: { dueAt: Date.now(), secs: 0 } });
  return true;
}

// ---- 进 prompt 的那几段 ----

/** 工具清单，一个工具一段：名字、说明、参数的 JSON Schema */
export function toolList(char) {
  return toolsFor(char).map(({ call, tool }) => {
    const { $schema, ...schema } = tool.inputSchema || {};
    return `- ${call}${tool.description ? `: ${tool.description.trim()}` : ''}\n  input: ${JSON.stringify(schema)}`;
  }).join('\n');
}

/**
 * 跟在调用后面、角色读到的那一段。状态说明是英文（第 14 条），结果本身是数据，原样给。
 * 结果按「用量与上限」里的字数截断，0 表示整段
 */
export function resultFor(m, s = settings.get()) {
  const head = `[工具结果：${m.toolName || ''}]`;
  const st = m.toolState;
  if (st === 'denied') return `${head}\nThe user declined this call.`;
  if (st === 'ask') return `${head}\nWaiting for the user to allow this call.`;
  if (st === 'running') return `${head}\nThe call is still running.`;
  if (st === 'error') return `${head}\nThe call failed: ${m.toolError || 'unknown error'}`;
  const text = String(m.toolResult || '');
  if (!text) return `${head}\n(empty result)`;
  const n = Math.max(0, Number(s.mcpResultChars) || 0);
  if (n > 0 && text.length > n) return `${head}\n${text.slice(0, n)}\n(truncated: first ${n} of ${text.length} characters)`;
  return `${head}\n${text}`;
}

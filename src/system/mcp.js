import { BUILD } from '../version.js';

// MCP 客户端（Model Context Protocol）。让角色调用外部的工具服务器。
//
// **浏览器里只能走 HTTP。** stdio 那一种要起一个本地进程，网页做不到。
// 服务器还得允许跨域（CORS），否则浏览器在发出请求之前就拦下了 ——
// 那时报的是「网络错误」，看不出是跨域，所以自检里单独写明。
//
// 服务器分三代，按从新到旧的顺序试：
//
//   2026-07-28  无状态。没有握手、没有会话 id，每个请求在 _meta 里自己带着协议版本，
//               头里带 Mcp-Method / Mcp-Name。先发一个 server/discover 探一下
//   ≤2025-11-25 Streamable HTTP。先 initialize 握手，服务器回一个 Mcp-Session-Id，
//               之后每个请求都带着它
//   2024-11-05  旧版 HTTP+SSE。先 GET 开一条事件流，流里告诉你往哪儿 POST，
//               回复从那条流里回来
//
// 新一代的探测请求带着 Mcp-Method 这类自定义头，老服务器的 CORS 白名单里没有它，
// 浏览器会在预检时直接拒掉 —— 所以探测失败（包括网络错误）一律当成「不是新一代」，
// 往下退一档。只有 401 / 403 这种明确的拒绝不往下退：换一代也还是没权限。

export const MODERN = '2026-07-28';
const LEGACY = '2025-11-25';
const CLIENT = { name: 'mini-phone', version: BUILD };

let seq = 0;
const nextId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

/** 「Key: value」一行一个的文本，读成请求头 */
export function parseHeaders(text) {
  const out = {};
  String(text || '').split('\n').forEach(line => {
    const i = line.indexOf(':');
    if (i <= 0) return;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k && v) out[k] = v;
  });
  return out;
}

class McpError extends Error {
  constructor(message, { status = 0, code = null, fallback = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    // 这一档不行、可以退一档再试
    this.fallback = fallback;
  }
}

// 一段 SSE 文本流，逐条吐出 { event, data }
async function* sseEvents(body, signal) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
      let at;
      while ((at = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, at);
        buf = buf.slice(at + 2);
        let event = 'message';
        const data = [];
        block.split('\n').forEach(l => {
          if (l.startsWith('event:')) event = l.slice(6).trim();
          else if (l.startsWith('data:')) data.push(l.slice(5).replace(/^ /, ''));
        });
        if (data.length) yield { event, data: data.join('\n') };
      }
    }
  } finally {
    try { reader.cancel(); } catch { /* 已经关了 */ }
  }
}

const parse = s => { try { return JSON.parse(s); } catch { return null; } };

// 回复里那条对得上 id 的。流里可能先来几条服务器自己的通知，跳过
async function readReply(res, id, signal) {
  const type = res.headers.get('content-type') || '';
  if (type.includes('text/event-stream')) {
    for await (const ev of sseEvents(res.body, signal)) {
      const msg = parse(ev.data);
      const list = Array.isArray(msg) ? msg : [msg];
      const hit = list.find(m => m && m.id === id && ('result' in m || 'error' in m));
      if (hit) return hit;
    }
    throw new McpError('服务器没有回复这个请求就关闭了连接');
  }
  const text = await res.text();
  const msg = parse(text);
  const list = Array.isArray(msg) ? msg : [msg];
  const hit = list.find(m => m && m.id === id);
  if (!hit) throw new McpError(`服务器的回复不是 JSON-RPC：${text.slice(0, 120)}`);
  return hit;
}

const httpError = (res, text = '') => {
  const s = res.status;
  const why = s === 401 || s === 403 ? '没有权限，请检查请求头里的密钥'
    : s === 404 ? '地址不存在' : s === 405 ? '这个地址不接受这种请求' : `HTTP ${s}`;
  return new McpError(`${why}${text ? `：${text.slice(0, 160)}` : ''}`, {
    status: s, fallback: s === 400 || s === 404 || s === 405 || s === 406 || s === 415,
  });
};

const netError = err => new McpError(
  `连不上服务器（${err.message || err}）。常见原因是服务器没有允许网页跨域访问（CORS）`,
  { fallback: true });

// ---- 一个服务器的连接 ----
//
// 按服务器 id 缓存在内存里。握手的结果（哪一代、会话 id、协商出来的版本）
// 页面一刷新就没了，下次用到时重新探一遍 —— 这比把会话 id 存进库里再去猜它过没过期省事。
const conns = new Map();

export function forget(id) {
  const c = conns.get(id);
  if (c?.stream) c.stream.abort();
  conns.delete(id);
}

function baseHeaders(server) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...parseHeaders(server.headers),
  };
}

const withTimeout = (server, signal) => {
  const ms = Math.max(1, Number(server.timeout) || 60) * 1000;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new Error(`超过 ${ms / 1000} 秒没有回复`)), ms);
  const stop = () => ctl.abort(signal?.reason);
  signal?.addEventListener('abort', stop);
  return { signal: ctl.signal, done: () => { clearTimeout(t); signal?.removeEventListener('abort', stop); } };
};

// 发一个请求，等它的回复。modern 为真时按新一代的写法带头与 _meta
async function post(server, conn, method, params, { signal, notify = false } = {}) {
  const id = notify ? undefined : nextId();
  const headers = baseHeaders(server);
  let body = { jsonrpc: '2.0', method, ...(notify ? {} : { id }), ...(params ? { params } : {}) };
  if (conn.gen === 'modern') {
    headers['MCP-Protocol-Version'] = MODERN;
    headers['Mcp-Method'] = method;
    if (params?.name) headers['Mcp-Name'] = params.name;
    body = { ...body, params: { ...(params || {}), _meta: {
      ...(params?._meta || {}),
      'io.modelcontextprotocol/protocolVersion': MODERN,
      'io.modelcontextprotocol/clientInfo': CLIENT,
      'io.modelcontextprotocol/clientCapabilities': {},
    } } };
  } else if (conn.gen === 'http') {
    if (conn.session) headers['Mcp-Session-Id'] = conn.session;
    // 2025-06-18 起要求带协议版本头；更早的服务器不认这个头，也可能没放进 CORS 白名单
    if (conn.version && conn.version >= '2025-06-18') headers['MCP-Protocol-Version'] = conn.version;
  }
  const url = conn.gen === 'sse' ? conn.postUrl : server.url;
  const t = withTimeout(server, signal);
  try {
    // 旧版 SSE：回复不在这个 POST 里，在那条事件流里
    const waiting = conn.gen === 'sse' && !notify ? conn.wait(id, t.signal) : null;
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: t.signal });
    } catch (err) {
      if (t.signal.aborted) throw new McpError(String(t.signal.reason?.message || '请求已取消'));
      throw netError(err);
    }
    if (conn.gen === 'http' && res.headers.get('mcp-session-id')) conn.session = res.headers.get('mcp-session-id');
    if (!res.ok) {
      if (res.status === 404 && conn.gen === 'http' && conn.session) {
        throw new McpError('会话已过期', { status: 404, code: 'expired' });
      }
      throw httpError(res, await res.text().catch(() => ''));
    }
    if (notify) return null;
    const msg = waiting ? await waiting : await readReply(res, id, t.signal);
    if (msg.error) {
      throw new McpError(msg.error.message || `错误 ${msg.error.code}`, {
        code: msg.error.code, fallback: msg.error.code === -32601,
      });
    }
    return msg.result;
  } finally { t.done(); }
}

// 旧版 SSE：开一条事件流，等它告诉我们往哪儿 POST
async function openSse(server) {
  const ctl = new AbortController();
  const pending = new Map();
  let res;
  try {
    res = await fetch(server.url, {
      headers: { Accept: 'text/event-stream', ...parseHeaders(server.headers) }, signal: ctl.signal,
    });
  } catch (err) { throw netError(err); }
  if (!res.ok) throw httpError(res);
  if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
    throw new McpError('这个地址既不是 Streamable HTTP，也不是旧版 SSE 的事件流');
  }
  const conn = { gen: 'sse', stream: ctl, postUrl: '' };
  let gotEndpoint;
  const endpoint = new Promise((ok, bad) => {
    gotEndpoint = ok;
    setTimeout(() => bad(new McpError('事件流里一直没有给出消息地址')), 15000);
  });
  (async () => {
    try {
      for await (const ev of sseEvents(res.body, ctl.signal)) {
        if (ev.event === 'endpoint') { gotEndpoint(new URL(ev.data, server.url).href); continue; }
        const msg = parse(ev.data);
        if (msg && msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      }
    } catch { /* 流断了：下一次请求会发现连接没了，重新连 */ }
    conns.delete(server.id);
  })();
  conn.wait = (id, signal) => new Promise((ok, bad) => {
    pending.set(id, ok);
    signal?.addEventListener('abort', () => { pending.delete(id); bad(new McpError(String(signal.reason?.message || '请求已取消'))); });
  });
  conn.postUrl = await endpoint;
  return conn;
}

async function handshake(server, conn) {
  const r = await post(server, conn, 'initialize', {
    protocolVersion: LEGACY, capabilities: {}, clientInfo: CLIENT,
  });
  conn.version = r?.protocolVersion || LEGACY;
  conn.info = r?.serverInfo || null;
  conn.instructions = r?.instructions || '';
  await post(server, conn, 'notifications/initialized', null, { notify: true }).catch(() => {});
  return conn;
}

/** 连上一个服务器。已经连着就直接用 */
export async function connect(server) {
  if (!server?.url) throw new McpError('没有填写服务器地址');
  const had = conns.get(server.id);
  if (had && had.url === server.url && had.headers === server.headers) return had;
  forget(server.id);

  // 一、新一代
  const modern = { gen: 'modern' };
  try {
    const r = await post(server, modern, 'server/discover', {});
    const versions = r?.supportedVersions || [];
    if (versions.includes(MODERN)) {
      modern.version = MODERN;
      modern.info = r?._meta?.['io.modelcontextprotocol/serverInfo'] || r?.serverInfo || null;
      modern.instructions = r?.instructions || '';
      return keep(server, modern);
    }
  } catch (err) {
    if (!(err instanceof McpError) || !(err.fallback || err.code != null)) throw err;
  }

  // 二、Streamable HTTP 握手
  try {
    return keep(server, await handshake(server, { gen: 'http' }));
  } catch (err) {
    if (!(err instanceof McpError) || !err.fallback) throw err;
  }

  // 三、旧版 SSE
  return keep(server, await handshake(server, await openSse(server)));
}

function keep(server, conn) {
  conn.url = server.url;
  conn.headers = server.headers;
  conns.set(server.id, conn);
  return conn;
}

// 带一次「会话过期就重连」的请求
async function request(server, method, params, opts) {
  let conn = await connect(server);
  try {
    return await post(server, conn, method, params, opts);
  } catch (err) {
    if (err.code !== 'expired') throw err;
    forget(server.id);
    conn = await connect(server);
    return post(server, conn, method, params, opts);
  }
}

/** 这台服务器上所有的工具。有分页就一页页取完 */
export async function listTools(server) {
  const out = [];
  let cursor;
  do {
    const r = await request(server, 'tools/list', cursor ? { cursor } : {});
    (r?.tools || []).forEach(t => out.push({
      name: String(t.name || ''), title: t.title || t.annotations?.title || '',
      description: String(t.description || ''),
      inputSchema: t.inputSchema || { type: 'object' },
      readOnly: t.annotations?.readOnlyHint === true,
    }));
    cursor = r?.nextCursor;
  } while (cursor);
  return out.filter(t => t.name);
}

/** 连上并列出工具。设置页的「连接」用 */
export async function probe(server) {
  forget(server.id);
  const conn = await connect(server);
  const tools = await listTools(server);
  return {
    gen: conn.gen, version: conn.version || '',
    info: conn.info ? { name: conn.info.name || '', version: conn.info.version || '' } : null,
    tools,
  };
}

/** 调一个工具。返回 MCP 的原始结果 */
export function callTool(server, name, args = {}, opts = {}) {
  return request(server, 'tools/call', { name, arguments: args || {} }, opts);
}

/**
 * 结果读成一段文字：角色读的、气泡上显示的都是它。
 * 图片、音频这类角色读不了，写明有这么一个东西；结构化结果没有文字时整个转成 JSON
 */
export function resultText(r) {
  const parts = (r?.content || []).map(c => {
    if (c.type === 'text') return String(c.text || '');
    if (c.type === 'image') return `[图片结果：${c.mimeType || 'image'}]`;
    if (c.type === 'audio') return `[音频结果：${c.mimeType || 'audio'}]`;
    if (c.type === 'resource') return c.resource?.text ? String(c.resource.text) : `[资源：${c.resource?.uri || ''}]`;
    if (c.type === 'resource_link') return `[链接：${c.name || ''} ${c.uri || ''}]`.trim();
    return '';
  }).filter(Boolean);
  if (!parts.length && r?.structuredContent) return JSON.stringify(r.structuredContent);
  return parts.join('\n');
}

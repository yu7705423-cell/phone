// Eira 的后台消息服务器（Cloudflare Worker）。部署步骤见 worker/PUSH.md，应用那一侧见 src/system/bgpush.js。
//
// 做三件事：
//   1. 记下每台设备，有 Web Push 订阅的连订阅一起记（POST /device）。
//      安装版应用（apk、ipa）的外壳里没有 Web Push，登记时不带订阅：照样到点替它发、存着，
//      只是不推通知，等应用打开时取回
//   2. 收下应用离开时交来的任务：每个角色接下来几次开口的时间，与到时候要发给模型的那一次请求（POST /plan）
//   3. 每分钟看一次（Cron Trigger）：到点的任务替应用发请求，拿到角色的话，用 Web Push 推到手机上，
//      结果存着等应用回来取（GET /results，取完 POST /ack 删掉）
//
// **通知通道**：除了 Web Push，还可以借别的 app 送通知，给没有 Web Push 的安装版应用用（apk、ipa）：
//   Bark     iPhone 上的推送 app。点通知打开 eira://chat/会话，直接跳进 Eira 那段会话；可以加密（AES-CBC）
//   PushPlus 经微信公众号送到微信里，哪种手机都收得到
// 用哪个、填什么由应用在交任务时一起交来（加密存在设备那一行），到点发完 Web Push 再按它发一条。
//
// 数据存在 Supabase（表结构见 worker/push.sql），经它的 REST 接口读写，用 service_role 密钥。
// **订阅、任务、结果一律先用 DATA_KEY 加密再存**：任务里带着用户的接口密钥与聊天上下文，
// 数据库里只看得到密文。DATA_KEY 只在这个 Worker 的环境变量里。
//
// 需要的环境变量（Worker 的 Settings - Variables and Secrets，全部选 Secret）：
//   SUPABASE_URL    Supabase 项目地址，例如 https://abcd.supabase.co
//   SUPABASE_KEY    Supabase 的 service_role 密钥
//   VAPID_PUBLIC    VAPID 公钥（打开这个 Worker 的 /setup 生成）
//   VAPID_PRIVATE   VAPID 私钥（同上）
//   DATA_KEY        加密用的密钥（同上）
//   VAPID_SUBJECT   可选，联系方式，例如 mailto:you@example.com
//   ALLOW_ORIGINS   可选，只许这些网站调用，逗号分隔，例如 https://eiraphone.cn
//
// 另外在 Settings - Trigger Events 加一个 Cron Trigger：`* * * * *`（每分钟）。
//
// 不依赖任何 npm 包：Web Push 的加密（RFC 8291）与 VAPID 签名（RFC 8292）都用 Workers 自带的 WebCrypto 写。

const ALIVE_MS = 6 * 60 * 1000;   // 应用最近这么久内报过到，就当它还开着，先不替它发
const BATCH = 10;                  // 每分钟最多处理几个到点的任务
const MARK_TIME = '{{bg_time}}';
const MARK_GAP = '{{bg_gap}}';

// ---- 编码 ----

const enc = s => new TextEncoder().encode(s);
const dec = b => new TextDecoder().decode(b);
function b64e(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64d(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ---- 存储加密（DATA_KEY） ----

async function dataKey(env) {
  return crypto.subtle.importKey('raw', b64d(env.DATA_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await dataKey(env), enc(JSON.stringify(obj))));
  return b64e(concat(iv, ct));
}
async function unseal(env, text) {
  const raw = b64d(text);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, await dataKey(env), raw.subarray(12));
  return JSON.parse(dec(new Uint8Array(plain)));
}
async function sha256(text) {
  return b64e(new Uint8Array(await crypto.subtle.digest('SHA-256', enc(text))));
}

// ---- Web Push：加密（RFC 8291 aes128gcm）与 VAPID（RFC 8292） ----

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

export async function encryptPayload(sub, text) {
  const uaPublic = b64d(sub.keys.p256dh);
  const authSecret = b64d(sub.keys.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 一整条就是最后一条记录：正文后面跟一个 0x02
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc(text), new Uint8Array([2]))));
  const head = new Uint8Array(16 + 4 + 1 + asPublic.length);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPublic.length;
  head.set(asPublic, 21);
  return concat(head, ct);
}

export async function vapidHeader(env, endpoint) {
  const header = b64e(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64e(enc(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:push@example.com',
  })));
  const pub = b64d(env.VAPID_PUBLIC);
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', x: b64e(pub.subarray(1, 33)), y: b64e(pub.subarray(33, 65)), d: env.VAPID_PRIVATE, ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64e(sig)}, k=${env.VAPID_PUBLIC}`;
}

// ---- 通知通道 ----

// Bark 的推送地址形如 https://api.day.app/设备码/（后面可能还跟着示例文字）
function barkTarget(url) {
  try {
    const u = new URL(url);
    const key = u.pathname.split('/').filter(Boolean)[0] || '';
    return key ? { base: u.origin, key } : null;
  } catch { return null; }
}

// Bark 的加密：在 Bark 里选 AES-128/192/256 + CBC，Key 与 IV 填同样两串（IV 16 位）
async function barkCipher(key, iv, obj) {
  const k = await crypto.subtle.importKey('raw', enc(key), 'AES-CBC', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: enc(iv) }, k, enc(JSON.stringify(obj))));
  let s = '';
  for (let i = 0; i < ct.length; i += 0x8000) s += String.fromCharCode.apply(null, ct.subarray(i, i + 0x8000));
  return btoa(s);
}

/** 按通道发一条。{ title, text, chatId }。失败只报回来，不影响那条消息已经存好 */
export async function sendChannel(ch, { title, text, chatId }) {
  const body = ch.hide ? '发来一条消息' : preview(text);
  if (ch.kind === 'bark') {
    const t = barkTarget(ch.url);
    if (!t) return { ok: false, error: 'Bark 地址不对' };
    const msg = { title, body, group: 'Eira', ...(ch.icon ? { icon: ch.icon } : {}),
      ...(chatId ? { url: `eira://chat/${encodeURIComponent(chatId)}` } : {}) };
    let res;
    if (ch.key && ch.iv) {
      const form = new URLSearchParams({ ciphertext: await barkCipher(ch.key, ch.iv, msg), iv: ch.iv });
      res = await fetch(`${t.base}/${t.key}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    } else {
      res = await fetch(`${t.base}/push`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_key: t.key, ...msg }) });
    }
    return res.ok ? { ok: true } : { ok: false, error: `Bark ${res.status}` };
  }
  if (ch.kind === 'pushplus') {
    if (!ch.token) return { ok: false, error: '没有填 PushPlus 的 token' };
    const res = await fetch('https://www.pushplus.plus/send', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: ch.token, title, content: body, template: 'txt' }) });
    const j = await res.json().catch(() => ({}));
    return res.ok && Number(j.code) === 200 ? { ok: true } : { ok: false, error: `PushPlus ${j.msg || res.status}` };
  }
  return { ok: false, error: '不认识的通知通道' };
}

/** 推一条。回来 { ok, gone }：gone 是订阅已经作废（用户退订、清了数据），这台设备可以删了 */
async function sendPush(env, sub, message) {
  const body = await encryptPayload(sub, JSON.stringify(message));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidHeader(env, sub.endpoint),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '86400',
      urgency: 'high',
    },
    body,
  });
  return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status };
}

// ---- Supabase ----

async function db(env, method, path, body, prefer) {
  const headers = {
    apikey: env.SUPABASE_KEY,
    authorization: `Bearer ${env.SUPABASE_KEY}`,
    'content-type': 'application/json',
  };
  if (prefer) headers.prefer = prefer;
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const iso = t => new Date(t).toISOString();

// ---- 模型 ----

// 「多久没说话」，和应用那边 proactive.js 的 gapText 同一种说法
function gapText(ms) {
  if (!ms || ms < 0) return 'a while';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} minutes`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hours`;
  return `${Math.round(h / 24)} days`;
}
function timeText(t, tz) {
  try { return new Date(t).toLocaleString('zh-CN', { hour12: false, timeZone: tz || 'Asia/Shanghai' }); }
  catch { return new Date(t).toLocaleString('zh-CN', { hour12: false }); }
}
// 应用留下的两个记号，按真正发出去的这一刻填
function fill(body, at, lastAt, tz) {
  const esc = s => JSON.stringify(s).slice(1, -1);
  return JSON.stringify(body)
    .split(MARK_TIME).join(esc(timeText(at, tz)))
    .split(MARK_GAP).join(esc(gapText(lastAt ? at - lastAt : 0)));
}

async function callModel(request, at, lastAt, tz) {
  const res = await fetch(request.url, { method: 'POST', headers: request.headers, body: fill(request.body, at, lastAt, tz) });
  let j = null;
  try { j = await res.json(); } catch { j = null; }
  if (!res.ok) throw new Error(`接口 ${res.status}: ${j?.error?.message || JSON.stringify(j || {}).slice(0, 200)}`);
  const text = request.provider === 'anthropic'
    ? (j?.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
    : (j?.choices?.[0]?.message?.content || '');
  if (!String(text).trim()) throw new Error('模型返回了空内容');
  return String(text).trim();
}

// 通知上那一行：第一句，方括号标记去掉
function preview(text) {
  const line = String(text).split('\n').map(s => s.replace(/\[[^\]]*\]/g, '').trim()).find(Boolean) || '发来一条消息';
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

// ---- 到点的任务 ----

async function runDue(env) {
  const now = Date.now();
  // 上一次跑到一半没了（超时、部署），占住的任务一直卡在 running：过一刻钟算失败，应用回来能看见
  await db(env, 'PATCH', `push_jobs?status=eq.running&due_at=lt.${encodeURIComponent(iso(now - 15 * 60000))}`,
    { status: 'failed', fired_at: iso(now) }).catch(() => {});
  const due = await db(env, 'GET',
    `push_jobs?status=eq.pending&due_at=lte.${encodeURIComponent(iso(now))}&order=due_at.asc&limit=${BATCH}&select=id,device_id,due_at,data`);
  const devices = new Map();
  for (const job of due || []) {
    if (!devices.has(job.device_id)) {
      const [d] = await db(env, 'GET', `push_devices?id=eq.${job.device_id}&select=id,sub,notify,seen_at`) || [];
      devices.set(job.device_id, d || null);
    }
    const dev = devices.get(job.device_id);
    if (!dev) continue;
    // 应用还开着：本机会自己发，这边不重复
    if (dev.seen_at && now - Date.parse(dev.seen_at) < ALIVE_MS) continue;
    // 先占住，免得两次触发撞在一起各发一遍
    const claimed = await db(env, 'PATCH', `push_jobs?id=eq.${job.id}&status=eq.pending`, { status: 'running' }, 'return=representation');
    if (!claimed || !claimed.length) continue;
    await runJob(env, job, dev, now).catch(async err => {
      await db(env, 'PATCH', `push_jobs?id=eq.${job.id}`, {
        status: 'failed', fired_at: iso(now), result: await seal(env, { error: String(err.message || err) }),
      }).catch(() => {});
    });
  }
}

async function runJob(env, job, dev, now) {
  const data = await unseal(env, job.data);
  const text = await callModel(data.request, now, data.lastAt, data.tz);
  await db(env, 'PATCH', `push_jobs?id=eq.${job.id}`, {
    status: 'done', fired_at: iso(now),
    result: await seal(env, { text, chatId: data.chatId, charId: data.charId }),
  });
  // 没有订阅（安装版应用）：只存着，等应用打开时取回
  if (dev.sub) {
    const sent = await sendPush(env, await unseal(env, dev.sub), {
      title: data.title || 'Eira', body: preview(text), appId: 'chat', route: `/chat/${data.chatId}`, tag: `bg-${job.id}`,
    });
    if (sent.gone) { await db(env, 'DELETE', `push_devices?id=eq.${dev.id}`); return; }
  }
  // 通知通道（Bark、PushPlus）。没发成不要紧，消息已经存好，打开应用时照样取得回
  if (dev.notify) {
    const ch = await unseal(env, dev.notify).catch(() => null);
    if (ch) await sendChannel(ch, { title: data.title || 'Eira', text, chatId: data.chatId }).catch(() => {});
  }
  // 还有下一次：把这一句接进对话，再由角色接着开口
  const rest = data.rest || [];
  if (rest.length) {
    const body = { ...data.request.body, messages: [
      ...(data.request.body.messages || []),
      { role: 'assistant', content: text },
      { role: 'user', content: data.closing || '(No new messages.)' },
    ] };
    await db(env, 'POST', 'push_jobs', {
      device_id: dev.id, due_at: iso(Math.max(rest[0], now + 60000)),
      data: await seal(env, { ...data, request: { ...data.request, body }, rest: rest.slice(1), lastAt: now }),
    });
  }
}

// ---- 设备认证 ----

async function deviceOf(env, req) {
  const m = String(req.headers.get('authorization') || '').match(/^Bearer\s+([0-9a-f-]{36})\.(\S+)$/i);
  if (!m) return null;
  const [d] = await db(env, 'GET', `push_devices?id=eq.${m[1]}&select=id,token_hash,sub,notify`) || [];
  if (!d || d.token_hash !== await sha256(m[2])) return null;
  return d;
}

// ---- HTTP ----

function cors(env, req) {
  const origin = req.headers.get('origin') || '';
  const allow = String(env.ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = !allow.length || allow.includes(origin);
  return {
    'access-control-allow-origin': ok ? (origin || '*') : 'null',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}
const json = (h, data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...h, 'content-type': 'application/json; charset=utf-8' } });
const configured = env => !!(env.SUPABASE_URL && env.SUPABASE_KEY && env.VAPID_PUBLIC && env.VAPID_PRIVATE && env.DATA_KEY);

// 第一次部署时打开 /setup：生成一套 VAPID 密钥与 DATA_KEY，照着填进环境变量
async function setupPage(env) {
  if (env.VAPID_PUBLIC && env.VAPID_PRIVATE && env.DATA_KEY) {
    return new Response('密钥已经设置好了。为安全起见，这一页不再显示任何密钥。\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64e(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const priv = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;
  const data = b64e(crypto.getRandomValues(new Uint8Array(32)));
  return new Response([
    '把下面三项分别加到这个 Worker 的 Settings - Variables and Secrets（类型选 Secret），然后重新部署：',
    '',
    `VAPID_PUBLIC   ${pub}`,
    `VAPID_PRIVATE  ${priv}`,
    `DATA_KEY       ${data}`,
    '',
    '这一页每次打开都会生成新的一套。填好之后这一页不再显示密钥。',
    '以后不要换 VAPID 密钥：换了之后所有设备的订阅都要重新做一遍。',
    '',
  ].join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function handle(req, env) {
  const url = new URL(req.url);
  const h = cors(env, req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  const route = `${req.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;

  if (route === 'GET /setup') return setupPage(env);
  if (route === 'GET /') {
    return new Response(configured(env) ? 'Eira 推送服务器：已就绪\n' : 'Eira 推送服务器：环境变量还没填全，见 worker/PUSH.md\n',
      { headers: { ...h, 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (!configured(env)) return json(h, { error: '推送服务器的环境变量还没填全' }, 503);
  if (route === 'GET /vapid') return json(h, { publicKey: env.VAPID_PUBLIC });

  if (route === 'POST /device') {
    const { subscription: sub } = await req.json().catch(() => ({}));
    // 不带订阅是可以的（安装版应用）；带了就要是完整的
    if (sub && (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth)) return json(h, { error: '订阅信息不完整' }, 400);
    const token = b64e(crypto.getRandomValues(new Uint8Array(32)));
    const [row] = await db(env, 'POST', 'push_devices',
      { token_hash: await sha256(token), sub: sub ? await seal(env, sub) : null }, 'return=representation');
    return json(h, { id: row.id, token });
  }

  const dev = await deviceOf(env, req);
  if (!dev) return json(h, { error: '设备没有登记，或者登记已失效。请在应用里关掉后台消息再打开' }, 401);

  if (route === 'DELETE /device') {
    await db(env, 'DELETE', `push_devices?id=eq.${dev.id}`);
    return json(h, { ok: true });
  }
  if (route === 'POST /test') {
    // 带着通道来的就试那个通道（设置页上刚填的，可能还没交过任务）
    const { channel } = await req.json().catch(() => ({}));
    if (channel && channel.kind) {
      const r = await sendChannel(channel, { title: 'Eira', text: '通知通道工作正常', chatId: '' });
      return r.ok ? json(h, { ok: true }) : json(h, { error: r.error }, 502);
    }
    if (!dev.sub) return json(h, { error: '这台设备没有推送订阅（安装版应用），消息在打开应用时出现' }, 400);
    const sent = await sendPush(env, await unseal(env, dev.sub), { title: 'Eira', body: '推送服务器工作正常', tag: 'bg-test' });
    if (sent.gone) await db(env, 'DELETE', `push_devices?id=eq.${dev.id}`);
    return sent.ok ? json(h, { ok: true }) : json(h, { error: `推送服务返回 ${sent.status}` }, 502);
  }
  if (route === 'POST /plan') {
    const { away = false, jobs = [], channel } = await req.json().catch(() => ({}));
    await db(env, 'DELETE', `push_jobs?device_id=eq.${dev.id}&status=eq.pending`);
    const rows = [];
    for (const j of Array.isArray(jobs) ? jobs : []) {
      const times = (Array.isArray(j.due) ? j.due : [j.due]).map(Number).filter(Boolean).sort((a, b) => a - b);
      if (!times.length || !j.request?.url || !j.request?.body) continue;
      rows.push({
        device_id: dev.id, due_at: iso(times[0]),
        data: await seal(env, {
          chatId: j.chatId, charId: j.charId, title: j.title, tz: j.tz, closing: j.closing,
          lastAt: j.lastAt || 0, request: j.request, rest: times.slice(1),
        }),
      });
    }
    if (rows.length) await db(env, 'POST', 'push_jobs', rows);
    const patch = { seen_at: away ? null : iso(Date.now()) };
    // 通知通道跟着任务一起交来：设置页上改了，下一次交任务就换过来。null 是关掉
    if (channel !== undefined) patch.notify = channel && channel.kind ? await seal(env, channel) : null;
    await db(env, 'PATCH', `push_devices?id=eq.${dev.id}`, patch);
    return json(h, { ok: true, jobs: rows.length });
  }
  if (route === 'GET /results') {
    const rows = await db(env, 'GET',
      `push_jobs?device_id=eq.${dev.id}&status=in.(done,failed)&order=fired_at.asc&select=id,status,result,fired_at`) || [];
    const results = [];
    for (const r of rows) {
      const got = r.result ? await unseal(env, r.result).catch(() => ({})) : {};
      results.push({ id: r.id, status: r.status, firedAt: Date.parse(r.fired_at) || 0, ...got });
    }
    return json(h, { results });
  }
  if (route === 'POST /ack') {
    const { ids = [] } = await req.json().catch(() => ({}));
    const clean = ids.filter(id => /^[0-9a-f-]{36}$/i.test(id));
    if (clean.length) await db(env, 'DELETE', `push_jobs?device_id=eq.${dev.id}&id=in.(${clean.join(',')})`);
    return json(h, { ok: true });
  }
  return json(h, { error: '没有这个接口' }, 404);
}

export default {
  async fetch(req, env) {
    try { return await handle(req, env); }
    catch (err) { return json(cors(env, req), { error: String(err.message || err) }, 500); }
  },
  async scheduled(event, env, ctx) {
    if (!configured(env)) return;
    ctx.waitUntil(runDue(env));
  },
};

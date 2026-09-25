// 后台消息服务器（worker/push.js，ARCHITECTURE 4.226）。不开浏览器：Supabase、模型接口、推送服务
// 三样都在这里用假的顶上，Worker 本身原样跑。
//
//   /setup 生成一套 VAPID 与 DATA_KEY；填好之后不再显示
//   登记设备、交任务；任务在数据库里是密文，接口密钥看不到原文
//   到点：替应用发模型请求，「现在几点」「多久没说话」两个记号按那一刻填好
//   推出去的通知：按 RFC 8291 解得开，VAPID 签名验得过，标题是角色名、正文是第一句、点开进那段会话
//   还有下一次：接着排一条，对话里接上刚才那句
//   应用最近报过到（还开着）：到点也不发
//   取结果、确认后删掉；口令不对一律 401；订阅作废（410）时整台设备删掉
//   通知通道：Bark（明文、加密）点开是 eira://chat/会话；PushPlus 送到微信；「不显示内容」时只写发来一条消息；
//     通道配置在数据库里是密文；设置页上的「测试」按传来的通道发
import worker from '../worker/push.js';

const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

// ---- 编码 ----
const enc = s => new TextEncoder().encode(s);
const b64e = b => Buffer.from(b).toString('base64url');
const b64d = s => new Uint8Array(Buffer.from(s, 'base64url'));
const concat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let a = 0; for (const x of p) { o.set(x, a); a += x.length; } return o; };

// ---- 假的 Supabase（PostgREST 的一小部分） ----
const tables = { push_devices: [], push_jobs: [] };
function match(row, filters) {
  return filters.every(([col, op, val]) => {
    const v = row[col];
    if (op === 'eq') return String(v) === val;
    if (op === 'lte') return v != null && Date.parse(v) <= Date.parse(val);
    if (op === 'lt') return v != null && Date.parse(v) < Date.parse(val);
    if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').includes(String(v));
    throw new Error('mock: unknown op ' + op);
  });
}
function supabase(method, url, body, prefer) {
  const table = url.pathname.replace('/rest/v1/', '');
  const q = new URLSearchParams(url.search);
  const filters = [];
  let order = null, limit = 0;
  for (const [k, v] of q) {
    if (k === 'select') continue;
    if (k === 'order') { order = v.split('.'); continue; }
    if (k === 'limit') { limit = Number(v); continue; }
    const i = v.indexOf('.');
    filters.push([k, v.slice(0, i), v.slice(i + 1)]);
  }
  const t = tables[table];
  if (!t) return [404, { message: 'no table ' + table }];
  if (method === 'GET') {
    let rows = t.filter(r => match(r, filters));
    if (order) rows = rows.sort((a, b) => (Date.parse(a[order[0]]) || 0) - (Date.parse(b[order[0]]) || 0));
    if (limit) rows = rows.slice(0, limit);
    return [200, rows.map(r => ({ ...r }))];
  }
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({
      id: crypto.randomUUID(), created_at: new Date().toISOString(),
      ...(table === 'push_jobs' ? { status: 'pending', result: null, fired_at: null } : { seen_at: null }), ...r,
    }));
    t.push(...list);
    return [201, prefer ? list : null];
  }
  if (method === 'PATCH') {
    const rows = t.filter(r => match(r, filters));
    rows.forEach(r => Object.assign(r, body));
    return [200, prefer ? rows.map(r => ({ ...r })) : null];
  }
  if (method === 'DELETE') {
    const gone = t.filter(r => match(r, filters));
    tables[table] = t.filter(r => !gone.includes(r));
    if (table === 'push_devices') tables.push_jobs = tables.push_jobs.filter(j => !gone.some(d => d.id === j.device_id));
    return [200, null];
  }
  return [405, null];
}

// ---- 假的模型与推送服务 ----
const modelCalls = [];
const pushes = [];
const channels = [];
let pushStatus = 201;
let reply = n => `[旁白：他看了一眼窗外。]\n第${n}次开口。\n你在忙吗`;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = init.method || 'GET';
  if (url.host === 'sb.test') {
    const [status, data] = supabase(method, url, init.body ? JSON.parse(init.body) : undefined, init.headers?.prefer);
    return new Response(data == null ? '' : JSON.stringify(data), { status });
  }
  if (url.host === 'model.test') {
    const body = JSON.parse(init.body);
    modelCalls.push({ url: url.href, headers: init.headers, body });
    return Response.json({ choices: [{ message: { content: reply(modelCalls.length) } }] });
  }
  if (url.host === 'api.day.app' || url.host === 'www.pushplus.plus') {
    channels.push({ url: url.href, headers: init.headers, body: init.body });
    return url.host === 'api.day.app' ? Response.json({ code: 200 }) : Response.json({ code: 200, msg: '请求成功' });
  }
  if (url.host === 'push.test') {
    pushes.push({ url: url.href, headers: init.headers, body: new Uint8Array(init.body) });
    return new Response('', { status: pushStatus });
  }
  throw new Error('unexpected fetch ' + url.href);
};

const call = async (env, method, path, { body, token } = {}) => {
  const headers = { 'content-type': 'application/json', origin: 'https://eiraphone.cn' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`https://push.worker${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
};
const tick = async env => { const waits = []; await worker.scheduled({}, env, { waitUntil: p => waits.push(p) }); await Promise.all(waits); };

// ---- /setup ----
let env = { SUPABASE_URL: 'https://sb.test', SUPABASE_KEY: 'service' };
const setup = await call(env, 'GET', '/setup');
const grab = k => (String(setup.data).match(new RegExp(`${k}\\s+(\\S+)`)) || [])[1];
env = { ...env, VAPID_PUBLIC: grab('VAPID_PUBLIC'), VAPID_PRIVATE: grab('VAPID_PRIVATE'), DATA_KEY: grab('DATA_KEY'), VAPID_SUBJECT: 'mailto:t@example.com' };
ok('/setup 生成一套 VAPID 与 DATA_KEY', env.VAPID_PUBLIC && b64d(env.VAPID_PUBLIC).length === 65 && env.VAPID_PRIVATE && b64d(env.DATA_KEY).length === 32, String(setup.data).slice(0, 200));
const again = await call(env, 'GET', '/setup');
ok('填好之后 /setup 不再显示密钥', !String(again.data).includes(env.DATA_KEY) && /已经设置好/.test(again.data), again.data);
ok('/vapid 给出公钥', (await call(env, 'GET', '/vapid')).data.publicKey === env.VAPID_PUBLIC);

// ---- 一台设备：浏览器那边的订阅 ----
const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
const authSecret = crypto.getRandomValues(new Uint8Array(16));
const subscription = { endpoint: 'https://push.test/send/abc', keys: { p256dh: b64e(uaPublic), auth: b64e(authSecret) } };
const reg = await call(env, 'POST', '/device', { body: { subscription } });
const token = `${reg.data.id}.${reg.data.token}`;
ok('登记设备：给回 id 与口令', reg.status === 200 && reg.data.id && reg.data.token, JSON.stringify(reg.data));
ok('口令不对：401', (await call(env, 'POST', '/test', { token: `${reg.data.id}.nope` })).status === 401);

// 浏览器解推送（RFC 8291）
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function decrypt(body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  return JSON.parse(new TextDecoder().decode(plain.subarray(0, plain.lastIndexOf(2))));
}
async function vapidOk(header) {
  const m = String(header).match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(\S+)$/);
  if (!m) return false;
  const pub = b64d(m[4]);
  const key = await crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64d(m[3]), enc(`${m[1]}.${m[2]}`));
  const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
  return good && claims.aud === 'https://push.test' && claims.exp > Date.now() / 1000 && m[4] === env.VAPID_PUBLIC;
}

const t0 = await call(env, 'POST', '/test', { token });
const testPush = pushes.shift();
ok('测试推送：发出去了，解得开，签名验得过', t0.status === 200 && testPush && (await decrypt(testPush.body)).body === '推送服务器工作正常'
  && await vapidOk(testPush.headers.authorization) && testPush.headers['content-encoding'] === 'aes128gcm', JSON.stringify(t0.data));

// ---- 交任务 ----
const now = Date.now();
const job = {
  due: [now - 1000, now + 3 * 3600000], chatId: 'chat_1', charId: 'char_1', title: '阿岚',
  lastAt: now - 5 * 3600000, tz: 'Asia/Shanghai', closing: '(No new messages. You are the one opening this time.)',
  request: {
    provider: 'openai', url: 'https://model.test/v1/chat/completions',
    headers: { 'content-type': 'application/json', authorization: 'Bearer sk-SECRET-123' },
    body: { model: 'm', messages: [
      { role: 'system', content: 'Current time: {{bg_time}}. Last message was {{bg_gap}} ago.' },
      { role: 'user', content: '(No new messages. You are the one opening this time.)' },
    ] },
  },
};
const planned = await call(env, 'POST', '/plan', { token, body: { away: true, jobs: [job] } });
ok('交任务：收下了', planned.status === 200 && planned.data.jobs === 1 && tables.push_jobs.length === 1, JSON.stringify(planned.data));
ok('数据库里是密文：接口密钥、会话 id 都看不到原文', !JSON.stringify(tables).includes('sk-SECRET-123') && !JSON.stringify(tables).includes('chat_1')
  && !JSON.stringify(tables).includes('push.test'), '');

// ---- 到点 ----
await tick(env);
const mc = modelCalls[0];
const sys = mc?.body?.messages?.[0]?.content || '';
ok('到点替应用发了模型请求，带着原来的密钥', modelCalls.length === 1 && mc.headers.authorization === 'Bearer sk-SECRET-123', JSON.stringify(mc?.headers));
ok('「现在几点」「多久没说话」按发出去的那一刻填好', !sys.includes('{{bg_') && /\d{4}\/\d{1,2}\/\d{1,2}/.test(sys) && /5 hours ago/.test(sys), sys);
const p1 = pushes.shift();
const msg1 = p1 ? await decrypt(p1.body) : {};
ok('推出去：标题是角色名、正文是去掉标记的第一句、点开进那段会话',
  msg1.title === '阿岚' && msg1.body === '第1次开口。' && msg1.appId === 'chat' && msg1.route === '/chat/chat_1' && await vapidOk(p1.headers.authorization), JSON.stringify(msg1));
const pending = tables.push_jobs.filter(j => j.status === 'pending');
ok('还有下一次：接着排了一条，时间是第二个', pending.length === 1 && Math.abs(Date.parse(pending[0].due_at) - job.due[1]) < 1000, JSON.stringify(pending.map(j => j.due_at)));

// 第二次到点：对话里接上了第一次那句
pending[0].due_at = new Date(Date.now() - 1000).toISOString();
await tick(env);
const second = modelCalls[1]?.body?.messages || [];
ok('第二次开口：对话里接上了第一次那句，末尾又是「由你开口」', second.length === 4 && second[2].role === 'assistant' && /第1次开口/.test(second[2].content)
  && second[3].role === 'user' && /opening this time/.test(second[3].content), JSON.stringify(second.slice(2)));
pushes.shift();

// ---- 取结果、确认 ----
const got = await call(env, 'GET', '/results', { token });
const texts = (got.data.results || []).map(r => r.text);
ok('取结果：两条都在，带着会话与角色', got.data.results.length === 2 && /第1次开口/.test(texts[0]) && /第2次开口/.test(texts[1])
  && got.data.results.every(r => r.chatId === 'chat_1' && r.charId === 'char_1' && r.firedAt > 0), JSON.stringify(got.data));
await call(env, 'POST', '/ack', { token, body: { ids: got.data.results.map(r => r.id) } });
ok('确认之后删掉', tables.push_jobs.length === 0, tables.push_jobs.length);

// ---- 应用还开着：不发 ----
await call(env, 'POST', '/plan', { token, body: { away: false, jobs: [{ ...job, due: [Date.now() - 1000] }] } });
await tick(env);
ok('应用最近报过到（还开着）：到点也不发', modelCalls.length === 2 && tables.push_jobs[0]?.status === 'pending', `${modelCalls.length} ${tables.push_jobs[0]?.status}`);

// ---- 模型报错：记为失败，原因取得回来 ----
await call(env, 'POST', '/plan', { token, body: { away: true, jobs: [{ ...job, due: [Date.now() - 1000], request: { ...job.request, url: 'https://model.test/v1/chat/completions' } }] } });
const oldReply = reply;
reply = () => '';
await tick(env);
reply = oldReply;
const failed = (await call(env, 'GET', '/results', { token })).data.results;
ok('模型返回空：记为失败，原因取得回来，不推', failed.length === 1 && failed[0].status === 'failed' && /空内容/.test(failed[0].error) && pushes.length === 0, JSON.stringify(failed));
await call(env, 'POST', '/ack', { token, body: { ids: failed.map(r => r.id) } });

// ---- 安装版应用：登记时不带订阅，照样到点发、存着，只是不推 ----
{
  const bare = await call(env, 'POST', '/device', { body: {} });
  const btoken = `${bare.data.id}.${bare.data.token}`;
  ok('安装版应用：不带订阅也能登记', bare.status === 200 && bare.data.id, JSON.stringify(bare.data));
  ok('安装版应用：测试推送说清楚没有订阅', (await call(env, 'POST', '/test', { token: btoken })).status === 400);
  const before = { calls: modelCalls.length, pushes: pushes.length };
  await call(env, 'POST', '/plan', { token: btoken, body: { away: true, jobs: [{ ...job, chatId: 'chat_app', due: [Date.now() - 1000] }] } });
  await tick(env);
  const got2 = (await call(env, 'GET', '/results', { token: btoken })).data.results;
  ok('安装版应用：到点照样替它发，结果存着等打开时取，不推', modelCalls.length === before.calls + 1 && pushes.length === before.pushes
    && got2.length === 1 && got2[0].chatId === 'chat_app' && /开口/.test(got2[0].text), JSON.stringify(got2));
  await call(env, 'POST', '/ack', { token: btoken, body: { ids: got2.map(r => r.id) } });
  await call(env, 'DELETE', '/device', { token: btoken });
}

// ---- 通知通道 ----
{
  const app = await call(env, 'POST', '/device', { body: {} });
  const tk = `${app.data.id}.${app.data.token}`;
  const fire = async (channel, chatId) => {
    await call(env, 'POST', '/plan', { token: tk, body: { away: true, channel, jobs: [{ ...job, chatId, due: [Date.now() - 1000] }] } });
    await tick(env);
    const res = (await call(env, 'GET', '/results', { token: tk })).data.results;
    await call(env, 'POST', '/ack', { token: tk, body: { ids: res.map(r => r.id) } });
    return channels.shift();
  };

  const bark = await fire({ kind: 'bark', url: 'https://api.day.app/AbCd1234/推送内容', icon: 'https://eiraphone.cn/icon-192.png' }, 'chat_b');
  const bb = bark ? JSON.parse(bark.body) : {};
  ok('Bark：发到 /push，设备码、角色名、第一句、点开进 eira://chat/会话', bark?.url === 'https://api.day.app/push' && bb.device_key === 'AbCd1234'
    && bb.title === '阿岚' && /开口/.test(bb.body) && bb.url === 'eira://chat/chat_b' && bb.group === 'Eira' && bb.icon === 'https://eiraphone.cn/icon-192.png', JSON.stringify(bb));
  ok('通道配置在数据库里是密文', !JSON.stringify(tables).includes('AbCd1234'), '');

  const KEY = '0123456789abcdef0123456789abcdef', IV = 'fedcba9876543210';
  const sealed = await fire({ kind: 'bark', url: 'https://api.day.app/AbCd1234', key: KEY, iv: IV }, 'chat_e');
  const form = new URLSearchParams(sealed?.body || '');
  let open = {};
  try {
    const k = await crypto.subtle.importKey('raw', enc(KEY), 'AES-CBC', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: enc(IV) }, k, Buffer.from(form.get('ciphertext') || '', 'base64'));
    open = JSON.parse(new TextDecoder().decode(plain));
  } catch (e) { open = { err: String(e) }; }
  ok('Bark 加密：发的是 ciphertext 与 iv，按 AES-256-CBC 解得开，里面是同样那几项', sealed?.url === 'https://api.day.app/AbCd1234' && form.get('iv') === IV
    && !/阿岚/.test(sealed.body) && open.title === '阿岚' && open.url === 'eira://chat/chat_e', JSON.stringify(open));

  const pp = await fire({ kind: 'pushplus', token: 'pp-token-1', hide: true }, 'chat_p');
  const pb = pp ? JSON.parse(pp.body) : {};
  ok('PushPlus：带 token 发到微信；「不显示内容」时只写发来一条消息', pp?.url === 'https://www.pushplus.plus/send' && pb.token === 'pp-token-1'
    && pb.title === '阿岚' && pb.content === '发来一条消息', JSON.stringify(pb));

  const t = await call(env, 'POST', '/test', { token: tk, body: { channel: { kind: 'pushplus', token: 'pp-token-2' } } });
  const tb = JSON.parse(channels.shift()?.body || '{}');
  ok('设置页上的「测试」：按传来的通道发一条', t.status === 200 && tb.token === 'pp-token-2' && /工作正常/.test(tb.content), JSON.stringify(tb));

  await fire(null, 'chat_n');
  ok('通道关掉（交 null）：之后到点不再发通道', channels.length === 0, JSON.stringify(channels));
  await call(env, 'DELETE', '/device', { token: tk });
}

// ---- 订阅作废 ----
pushStatus = 410;
await call(env, 'POST', '/plan', { token, body: { away: true, jobs: [{ ...job, due: [Date.now() - 1000] }] } });
await tick(env);
ok('推送服务说订阅作废（410）：整台设备连同任务删掉', tables.push_devices.length === 0 && tables.push_jobs.length === 0, `${tables.push_devices.length} ${tables.push_jobs.length}`);

const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);

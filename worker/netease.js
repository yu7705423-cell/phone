// Eira · 网易云转发与登录账号（Cloudflare Worker）
//
// 用法：在 Cloudflare 后台新建一个 Worker，把这整个文件的内容粘进编辑器，保存并部署，
// 得到的地址（形如 https://xxx.yyy.workers.dev）填进应用的 src/site.js 里的 neteaseWorker。
// 详细步骤见仓库里的 worker/README.md。
//
// 它只做一件事：把应用发来的、已经加密好的请求转给网易云，再把网易云的回复和它下发的
// cookie 原样交回去。加密、拼参数都在应用里做（src/system/ne/），这里不懂网易云的业务，
// 网易云改了接口也不用改这个文件。
//
// 为什么非要它：浏览器不许网页直接访问网易云（网易云不允许跨域），也不许网页自己设
// Cookie、User-Agent 这些请求头。这两件事只能由一个中间的服务器替它做。
//
// 它还管登录账号（/auth/ 开头的那些地址）。这一部分要在 Cloudflare 后台多做两步：
// 绑一个 KV 存储（变量名 ACCOUNTS），加一个管理员密码（变量名 ADMIN_PASSWORD，类型选「密钥」）。
// 两样都没做时账号功能关着，这个 Worker 只做网易云转发，和从前一样。
// 两样都做了之后，网易云转发也只给登录了的人用。
//
// 安全上的几条：
//   · 只转发到网易云的那几个域名，别的地址一律拒绝 —— 它不能被拿去当通用代理
//   · 下面 ALLOW_ORIGINS 填上你们网站的地址，别的网站的网页就用不了它
//   · 用户登录后的 cookie 会经过这里，这个文件不记录、不保存任何东西；
//     Cloudflare 后台的「日志」功能请保持默认的关闭，不要打开请求内容的记录

// 允许哪些网站使用。留空表示不限；建议填上你们网站的地址，例如 ['https://phone.example.com']
const ALLOW_ORIGINS = [];

const HOSTS = new Set(['music.163.com', 'interface.music.163.com', 'interface3.music.163.com']);
const VERSION = 2;

// 一个账号最多同时在几台设备上登录。第三台登录时，最早登录的那一台被挤下线
const MAX_DEVICES = 2;
// 登录凭证的有效期。应用每次启动都会换一张新的，天天用的人不会遇到它过期
const TOKEN_DAYS = 30;
// 密码哈希的轮数。免费版 Worker 每次请求只有 10 毫秒 CPU，再多就超了。
// 这个轮数挡不住有人拿到整个 KV 之后离线猜弱密码，所以 KV 不要给别人看
const PBKDF2_ITER = 10000;
// 新账号与重置后的初始密码。想换一个就在 Cloudflare 后台加变量 INITIAL_PASSWORD，不必改这里。
// 用户登录后可以自己改（/auth/password），改过之前管理页上标着「初始密码」
const INITIAL_PASSWORD = 'Eira2026';
// 自己改的新密码至少几位
const MIN_PASSWORD = 6;

// 只认一个看起来像 IPv4 的值，别的当没给
const isIPv4 = s => /^(\d{1,3})(\.\d{1,3}){3}$/.test(String(s || ''))
  && String(s).split('.').every(n => Number(n) <= 255);

function corsHeaders(origin) {
  const allow = !ALLOW_ORIGINS.length ? (origin || '*') : ALLOW_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (obj, status, headers) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

export default {
  async fetch(request, env = {}) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (ALLOW_ORIGINS.length && origin && !ALLOW_ORIGINS.includes(origin)) {
      return json({ error: '这个网站不在允许名单里' }, 403, cors);
    }
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    // 应用用它来认出这是转发 Worker、是哪一版、账号功能开没开
    if (request.method === 'GET') {
      return json({ ok: true, name: 'mini-phone-netease', version: VERSION, accounts: accountsOn(env), setup: setupOf(env) }, 200, cors);
    }
    if (request.method !== 'POST') return json({ error: '只接受 POST' }, 405, cors);
    if (path.startsWith('/auth/')) return auth(path, request, env, cors);

    // 账号功能开着时，网易云转发只给登录了的人用。只验凭证的签名与期限，不读存储 ——
    // 听歌时请求很多，每次都读一遍会很快用完免费额度
    if (accountsOn(env)) {
      const who = await readToken(env, (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
      if (!who) return json({ error: '请先登录' }, 401, cors);
    }

    let job;
    try { job = await request.json(); } catch { return json({ error: '请求内容不是 JSON' }, 400, cors); }
    let target;
    try { target = new URL(String(job.url || '')); } catch { return json({ error: '缺少目标地址' }, 400, cors); }
    if (target.protocol !== 'https:' || !HOSTS.has(target.hostname)) {
      return json({ error: '只转发到网易云' }, 400, cors);
    }

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (job.cookie) headers.Cookie = String(job.cookie);
    if (job.ua) headers['User-Agent'] = String(job.ua);
    if (job.referer) headers.Referer = String(job.referer);
    // 网易云按来源 IP 做风控，境外的会被拦（-462）。应用给一个国内 IP，照原项目的做法放进这两个头
    if (isIPv4(job.ip)) {
      headers['X-Real-IP'] = job.ip;
      headers['X-Forwarded-For'] = job.ip;
    }

    let res;
    try {
      res = await fetch(target.toString(), { method: 'POST', headers, body: String(job.body || ''), redirect: 'manual' });
    } catch (err) {
      return json({ status: 502, body: '', cookies: [], error: `连不上网易云：${err.message || err}` }, 200, cors);
    }
    const body = await res.text();
    const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    // 去掉 Domain：这些 cookie 由应用自己保存、下次再交回来，和哪个域名无关
    const cookies = raw.map(c => c.replace(/\s*Domain=[^;]*;?/i, ''));
    return json({ status: res.status, body, cookies }, 200, cors);
  },
};

// ---- 登录账号 ----
//
// 存储：KV 里每个账号一条 user:<账号名>，值是 { hash, salt, iter, disabled, note, createdAt, devices }。
// 列表页要的几项同时放进这一条的 metadata，列出全部账号时不必逐条读取。
// 凭证：{ 账号名, 设备号, 过期时间 } 做 HMAC 签名，密钥由管理员密码推出（见 tokenKey）。
// 管理员：密码是 Worker 的环境变量 ADMIN_PASSWORD，少于 12 位不认。

// 后台里的名字不必一字不差：绑了哪个名字的 KV 都认（找第一个长得像 KV 的绑定），
// 管理员密码与初始密码的变量名不分大小写、不管首尾空格。按名字认不出来的人太多了
const looksKV = v => v && typeof v.get === 'function' && typeof v.put === 'function' && typeof v.list === 'function';
const kv = env => (env ? (looksKV(env.ACCOUNTS) ? env.ACCOUNTS : Object.values(env).find(looksKV)) : null) || null;
const envText = (env, name) => {
  if (!env) return '';
  const k = Object.keys(env).find(x => x.trim().toUpperCase() === name);
  return k && typeof env[k] === 'string' ? env[k] : '';
};
const adminPw = env => envText(env, 'ADMIN_PASSWORD');
const adminPwOk = env => adminPw(env).length >= 12;
const accountsOn = env => !!(kv(env) && adminPwOk(env));

// 打开 Worker 地址时报的那几项：缺哪样一眼看得出来。只报有没有，不报内容
function setupOf(env) {
  const pw = adminPw(env);
  return {
    kv: kv(env) ? '已绑定' : '没有绑定 KV',
    adminPassword: !pw ? '没有设置 ADMIN_PASSWORD' : pw.length < 12 ? `ADMIN_PASSWORD 只有 ${pw.length} 位，至少要 12 位` : '已设置',
  };
}
// 留给管理员自己登录的账号名（见 /auth/login）
const ADMIN_NAME = 'admin';
const te = new TextEncoder();

const b64u = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = str => {
  const t = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};
const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));

// 逐字节比较，不因为前面几位对上了就早早返回
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
const sameText = (a, b) => sameBytes(te.encode(String(a)), te.encode(String(b)));

async function hashPassword(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', te.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64u(salt), iterations: iter }, key, 256);
  return b64u(new Uint8Array(bits));
}

// 签名密钥由管理员密码推出，不存储：KV 各地同步有延迟，随机生成再存进去的话，
// 头一分钟里两个地区可能各生成一把、互相不认。代价是改了管理员密码，所有人要重新登录一次
let secretKey = null;
let secretFor = '';
async function tokenKey(env) {
  const pw = adminPw(env);
  if (secretKey && secretFor === pw) return secretKey;
  const raw = await crypto.subtle.digest('SHA-256', te.encode(`eira-token|${pw}`));
  secretKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  secretFor = pw;
  return secretKey;
}

async function makeToken(env, name, device) {
  const body = b64u(te.encode(JSON.stringify({ n: name, d: device, e: Date.now() + TOKEN_DAYS * 86400000 })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await tokenKey(env), te.encode(body)));
  return `${body}.${b64u(sig)}`;
}

/** 凭证读得出、签名对、没过期：给回 { n, d, e }，否则 null。不读账号本身 */
async function readToken(env, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await tokenKey(env), fromB64u(sig), te.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64u(body)));
    return p && p.n && p.d && p.e > Date.now() ? p : null;
  } catch { return null; }
}

const userKey = name => `user:${name}`;
async function getUser(env, name) {
  const raw = await kv(env).get(userKey(name));
  return raw ? JSON.parse(raw) : null;
}
async function putUser(env, name, u) {
  const metadata = { disabled: !!u.disabled, devices: (u.devices || []).length, note: String(u.note || '').slice(0, 200),
    createdAt: u.createdAt || 0, initial: !!u.initial };
  await kv(env).put(userKey(name), JSON.stringify(u), { metadata });
}

// 账号名：去掉首尾空白，1 到 32 个字，不含空白与斜杠
const cleanName = raw => String(raw || '').trim();
const nameOk = n => n.length >= 1 && n.length <= 32 && !/[\s/\\]/.test(n);

const initialPassword = env => envText(env, 'INITIAL_PASSWORD') || INITIAL_PASSWORD;

async function setPassword(u, password, initial) {
  u.salt = b64u(randomBytes(16));
  u.iter = PBKDF2_ITER;
  u.hash = await hashPassword(password, u.salt, u.iter);
  u.initial = !!initial;
}

async function auth(path, request, env, cors) {
  if (!accountsOn(env)) {
    const st = setupOf(env);
    const why = [st.kv, st.adminPassword].filter(x => x !== '已绑定' && x !== '已设置').join('；');
    return json({ error: `本站尚未启用账号功能（${why}）` }, 503, cors);
  }
  let q;
  try { q = await request.json(); } catch { return json({ error: '请求内容不是 JSON' }, 400, cors); }

  if (path === '/auth/login') {
    const name = cleanName(q.name);
    const device = String(q.device || '').slice(0, 64);
    if (!name || !q.password || !device) return json({ error: '请填写账号与密码' }, 400, cors);
    const bad = () => json({ error: '账号或密码不正确' }, 401, cors);
    // 管理员自己：账号名 admin，密码就是管理员密码。开通之后第一次进应用、发第一个账号靠它
    if (name === ADMIN_NAME) {
      if (!adminPwOk(env) || !sameText(q.password, adminPw(env))) return bad();
      return json({ ok: true, name, token: await makeToken(env, name, device) }, 200, cors);
    }
    const u = await getUser(env, name);
    if (!u) return bad();
    if (!sameText(await hashPassword(q.password, u.salt, u.iter || PBKDF2_ITER), u.hash)) return bad();
    if (u.disabled) return json({ error: '该账号已停用' }, 403, cors);
    const label = String(q.label || '').slice(0, 60);
    u.devices = (u.devices || []).filter(x => x.id !== device);
    u.devices.push({ id: device, label, at: Date.now() });
    u.devices = u.devices.slice(-MAX_DEVICES);
    await putUser(env, name, u);
    return json({ ok: true, name, initial: !!u.initial, token: await makeToken(env, name, device) }, 200, cors);
  }

  if (path === '/auth/check') {
    const t = await readToken(env, q.token);
    if (!t) return json({ error: '登录已过期，请重新登录', relogin: true }, 401, cors);
    // 管理员的凭证不占设备名额；改了管理员密码，签名密钥跟着变，旧凭证自然失效
    if (t.n === ADMIN_NAME) return json({ ok: true, name: t.n, token: await makeToken(env, t.n, t.d) }, 200, cors);
    const u = await getUser(env, t.n);
    if (!u) return json({ error: '该账号已不存在', relogin: true }, 401, cors);
    if (u.disabled) return json({ error: '该账号已停用', relogin: true }, 403, cors);
    if (!(u.devices || []).some(x => x.id === t.d)) {
      return json({ error: '该账号已在其他设备登录，本设备已退出', relogin: true }, 401, cors);
    }
    return json({ ok: true, name: t.n, initial: !!u.initial, token: await makeToken(env, t.n, t.d) }, 200, cors);
  }

  // 自己改密码：要凭证、要原密码。改完之后别的设备退出，本机不退
  if (path === '/auth/password') {
    const t = await readToken(env, q.token);
    if (!t) return json({ error: '登录已过期，请重新登录', relogin: true }, 401, cors);
    if (t.n === ADMIN_NAME) return json({ error: '管理员密码在 Cloudflare 后台修改' }, 400, cors);
    const u = await getUser(env, t.n);
    if (!u || u.disabled || !(u.devices || []).some(x => x.id === t.d)) {
      return json({ error: '登录已失效，请重新登录', relogin: true }, 401, cors);
    }
    if (!sameText(await hashPassword(q.old || '', u.salt, u.iter || PBKDF2_ITER), u.hash)) {
      return json({ error: '原密码不正确' }, 400, cors);
    }
    const next = String(q.password || '');
    if (next.length < MIN_PASSWORD) return json({ error: `新密码至少 ${MIN_PASSWORD} 位` }, 400, cors);
    if (next.length > 64) return json({ error: '新密码最多 64 位' }, 400, cors);
    if (next === initialPassword(env)) return json({ error: '新密码不能与初始密码相同' }, 400, cors);
    await setPassword(u, next, false);
    u.devices = (u.devices || []).filter(x => x.id === t.d);
    await putUser(env, t.n, u);
    return json({ ok: true, name: t.n }, 200, cors);
  }

  if (path === '/auth/logout') {
    const t = await readToken(env, q.token);
    if (t) {
      const u = await getUser(env, t.n);
      if (u && (u.devices || []).some(x => x.id === t.d)) {
        u.devices = u.devices.filter(x => x.id !== t.d);
        await putUser(env, t.n, u);
      }
    }
    return json({ ok: true }, 200, cors);
  }

  if (path === '/auth/admin') return admin(q, env, cors);
  return json({ error: '没有这个地址' }, 404, cors);
}

async function admin(q, env, cors) {
  const real = adminPw(env);
  if (!adminPwOk(env)) return json({ error: '管理员密码未设置或少于 12 位，请在 Cloudflare 后台重新设置' }, 503, cors);
  if (!sameText(q.password || '', real)) return json({ error: '管理员密码不正确' }, 401, cors);
  const name = cleanName(q.name);

  if (q.op === 'list') {
    const users = [];
    let cursor;
    do {
      const page = await kv(env).list({ prefix: 'user:', cursor });
      page.keys.forEach(k => users.push({ name: k.name.slice(5), ...(k.metadata || {}) }));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return json({ ok: true, users, maxDevices: MAX_DEVICES }, 200, cors);
  }

  if (q.op === 'create') {
    const n = name;
    if (!n) return json({ error: '请填写账号名' }, 400, cors);
    if (!nameOk(n)) return json({ error: '账号名为 1 到 32 个字，不能含空格与斜杠' }, 400, cors);
    if (n === ADMIN_NAME) return json({ error: 'admin 留给管理员自己登录，请换一个账号名' }, 400, cors);
    if (await getUser(env, n)) return json({ error: '这个账号名已经有了' }, 409, cors);
    const u = { note: String(q.note || '').slice(0, 200), createdAt: Date.now(), disabled: false, devices: [] };
    const password = initialPassword(env);
    await setPassword(u, password, true);
    await putUser(env, n, u);
    return json({ ok: true, name: n, password }, 200, cors);
  }

  const u = name ? await getUser(env, name) : null;
  if (!u) return json({ error: '没有这个账号' }, 404, cors);

  // 重置：回到初始密码
  if (q.op === 'reset') {
    const password = initialPassword(env);
    await setPassword(u, password, true);
    u.devices = [];            // 改了密码，已登录的设备一并退出
    await putUser(env, name, u);
    return json({ ok: true, name, password }, 200, cors);
  }
  if (q.op === 'disable') {
    u.disabled = q.on !== false;
    if (u.disabled) u.devices = [];
    await putUser(env, name, u);
    return json({ ok: true, name, disabled: u.disabled }, 200, cors);
  }
  if (q.op === 'kick') {
    u.devices = [];
    await putUser(env, name, u);
    return json({ ok: true, name }, 200, cors);
  }
  if (q.op === 'note') {
    u.note = String(q.note || '').slice(0, 200);
    await putUser(env, name, u);
    return json({ ok: true, name }, 200, cors);
  }
  if (q.op === 'remove') {
    await kv(env).delete(userKey(name));
    return json({ ok: true, name }, 200, cors);
  }
  if (q.op === 'devices') {
    return json({ ok: true, name, devices: (u.devices || []).map(d => ({ label: d.label, at: d.at })) }, 200, cors);
  }
  return json({ error: '不认识的操作' }, 400, cors);
}

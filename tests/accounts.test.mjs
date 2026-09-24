// 登录账号（worker/netease.js 的 /auth/ 部分）。在 Node 里直接跑 Worker，KV 换成内存里的假的。
//
// 没绑 KV 时账号功能关着、转发照旧；管理员建号、登录、最多两台设备、停用、重置密码、下线、删除；
// 账号功能开着时网易云转发要登录；管理员密码太短不认
import { OUT } from './_env.mjs';

const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
void OUT;
const worker = (await import('../worker/netease.js')).default;

// 假 KV：get / put（带 metadata）/ delete / list（按前缀，分页）
function fakeKV() {
  const m = new Map();
  let writes = 0;
  return {
    m, get writes() { return writes; },
    async get(k) { return m.has(k) ? m.get(k).v : null; },
    async put(k, v, o = {}) { writes++; m.set(k, { v: String(v), meta: o.metadata || null }); },
    async delete(k) { writes++; m.delete(k); },
    async list({ prefix = '', cursor } = {}) {
      const keys = [...m.keys()].filter(k => k.startsWith(prefix)).sort();
      const from = cursor ? Number(cursor) : 0;
      const page = keys.slice(from, from + 2);           // 故意两条一页，测分页
      const done = from + 2 >= keys.length;
      return { keys: page.map(name => ({ name, metadata: m.get(name).meta })), list_complete: done, cursor: done ? undefined : String(from + 2) };
    },
  };
}

// 上游网易云
globalThis.fetch = async () => new Response('{"code":200}', { status: 200, headers: { 'Content-Type': 'application/json' } });

const ADMIN = 'correct-horse-battery';
const env = { ACCOUNTS: fakeKV(), ADMIN_PASSWORD: ADMIN };
const call = async (e, path, body, headers = {}) => {
  const r = await worker.fetch(new Request(`https://w.example.workers.dev${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://phone.example.com', ...headers },
    body: JSON.stringify(body),
  }), e);
  let b = null; try { b = await r.json(); } catch { /* 空 */ }
  return { status: r.status, body: b };
};
const admin = (op, extra = {}) => call(env, '/auth/admin', { password: ADMIN, op, ...extra });
const proxyJob = { url: 'https://interface.music.163.com/eapi/cloudsearch/pc', body: 'params=X' };

// ---- 没绑 KV：账号关着，转发照旧 ----
let r = await worker.fetch(new Request('https://w.example.workers.dev/', { method: 'GET' }), {});
let b = await r.json();
ok('没绑 KV：GET 报 accounts:false', b.accounts === false && b.version === 2, JSON.stringify(b));
r = await call({}, '/', proxyJob);
ok('没绑 KV：网易云转发不要登录', r.status === 200 && r.body.status === 200, JSON.stringify(r));
r = await call({}, '/auth/login', { name: 'a', password: 'b', device: 'd' });
ok('没绑 KV：登录接口说明本站未启用', r.status === 503 && /尚未启用/.test(r.body.error), JSON.stringify(r));

// ---- 管理员 ----
r = await call(env, '/auth/admin', { password: 'wrong', op: 'list' });
ok('管理员密码不对：401', r.status === 401);
r = await call({ ACCOUNTS: fakeKV(), ADMIN_PASSWORD: 'short' }, '/auth/admin', { password: 'short', op: 'list' });
ok('管理员密码少于 12 位：不认，写明原因', r.status === 503 && /12 位/.test(r.body.error), JSON.stringify(r));

r = await admin('create', { name: '小林', note: '第一批' });
const pw1 = r.body?.password;
ok('建号：给回统一的初始密码 Eira2026', r.status === 200 && r.body.name === '小林' && pw1 === 'Eira2026', JSON.stringify(r.body));
ok('密码不以明文存', ![...env.ACCOUNTS.m.values()].some(x => x.v.includes(pw1)));
r = await admin('create', { name: '小林' });
ok('重名：409', r.status === 409);
r = await admin('create', {});
ok('不填账号名：拒绝，账号要手动填', r.status === 400 && /请填写账号名/.test(r.body.error), JSON.stringify(r.body));
await admin('create', { name: '阿岚' });
r = await admin('create', { name: 'a b' });
ok('账号名含空格：拒绝', r.status === 400);
await admin('create', { name: '第三个' });
r = await admin('list');
ok('列出全部账号（跨分页），带备注与状态', r.body?.users?.length === 3 && r.body.users.some(u => u.name === '小林' && u.note === '第一批' && u.disabled === false), JSON.stringify(r.body));

// ---- 登录 ----
r = await call(env, '/auth/login', { name: '小林', password: 'nope', device: 'dev-a' });
ok('密码错：401，不说是哪一项错', r.status === 401 && r.body.error === '账号或密码不正确');
r = await call(env, '/auth/login', { name: '没有这人', password: pw1, device: 'dev-a' });
ok('没这个账号：同一句话', r.status === 401 && r.body.error === '账号或密码不正确');
const loginA = await call(env, '/auth/login', { name: '小林', password: pw1, device: 'dev-a', label: 'iPhone' });
ok('登录成功，给回凭证，标明还是初始密码', loginA.status === 200 && loginA.body.token && loginA.body.name === '小林' && loginA.body.initial === true, JSON.stringify(loginA.body));
const tA = loginA.body.token;
r = await call(env, '/auth/check', { token: tA });
ok('检查凭证：通过，并换一张新的', r.status === 200 && r.body.token && r.body.name === '小林');
r = await call(env, '/auth/check', { token: tA.slice(0, -3) + 'xyz' });
ok('签名被改过：不认', r.status === 401 && r.body.relogin === true);

// ---- 网易云转发要登录 ----
r = await call(env, '/', proxyJob);
ok('账号功能开着：没登录不给转发', r.status === 401);
r = await call(env, '/', proxyJob, { Authorization: `Bearer ${tA}` });
ok('带着凭证：照常转发', r.status === 200 && r.body.status === 200, JSON.stringify(r));

// ---- 最多两台设备 ----
const tB = (await call(env, '/auth/login', { name: '小林', password: pw1, device: 'dev-b' })).body.token;
r = await call(env, '/auth/check', { token: tA });
ok('第二台登录：第一台照常可用', r.status === 200);
const tC = (await call(env, '/auth/login', { name: '小林', password: pw1, device: 'dev-c' })).body.token;
r = await call(env, '/auth/check', { token: tA });
ok('第三台登录：最早那台被挤下线，写明原因', r.status === 401 && /其他设备登录/.test(r.body.error) && r.body.relogin, JSON.stringify(r.body));
r = await call(env, '/auth/check', { token: tB });
ok('第二台还在', r.status === 200);
const again = await call(env, '/auth/login', { name: '小林', password: pw1, device: 'dev-b' });
r = await call(env, '/auth/check', { token: tC });
ok('同一台设备重复登录不多占一个位置', again.status === 200 && r.status === 200);

// ---- 退出 ----
await call(env, '/auth/logout', { token: tC });
r = await call(env, '/auth/check', { token: tC });
ok('退出之后这张凭证不再通过检查', r.status === 401);

// ---- 停用、重置、下线、删除 ----
r = await admin('disable', { name: '小林', on: true });
ok('停用', r.body?.disabled === true);
r = await call(env, '/auth/check', { token: tB });
ok('停用后：已登录的设备检查不通过', r.status === 403 && /停用/.test(r.body.error));
r = await call(env, '/auth/login', { name: '小林', password: pw1, device: 'dev-b' });
ok('停用后：登录不了，写明已停用', r.status === 403 && /停用/.test(r.body.error));
await admin('disable', { name: '小林', on: false });
r = await call(env, '/auth/login', { name: '小林', password: pw1, device: 'dev-b' });
ok('恢复后能登录', r.status === 200);
const tB2 = r.body.token;

// 先自己改一次，再让管理员重置
const own = (await call(env, '/auth/login', { name: '小林', password: pw1, device: 'dev-b' })).body.token;
r = await call(env, '/auth/password', { token: own, old: 'nope', password: 'mine-123' });
ok('自己改密码：原密码不对，拒绝', r.status === 400 && /原密码/.test(r.body.error));
r = await call(env, '/auth/password', { token: own, old: pw1, password: '123' });
ok('自己改密码：太短，拒绝', r.status === 400 && /至少 6 位/.test(r.body.error));
r = await call(env, '/auth/password', { token: own, old: pw1, password: 'Eira2026' });
ok('自己改密码：不能改成初始密码', r.status === 400 && /初始密码/.test(r.body.error));
const other = (await call(env, '/auth/login', { name: '小林', password: pw1, device: 'dev-q' })).body.token;
r = await call(env, '/auth/password', { token: own, old: pw1, password: 'mine-123' });
ok('自己改密码：成功', r.status === 200);
ok('改完：本机照常', (await call(env, '/auth/check', { token: own })).status === 200);
ok('改完：另一台设备退出', (await call(env, '/auth/check', { token: other })).status === 401);
r = await call(env, '/auth/login', { name: '小林', password: pw1, device: 'dev-b' });
ok('改完：初始密码不能再用', r.status === 401);
r = await call(env, '/auth/login', { name: '小林', password: 'mine-123', device: 'dev-b' });
ok('改完：新密码能用，不再标初始密码', r.status === 200 && r.body.initial === false);
r = await admin('list');
ok('管理页列表：改过的不再标初始密码', r.body.users.find(u => u.name === '小林')?.initial === false);

r = await admin('reset', { name: '小林' });
const pw2 = r.body?.password;
ok('重置密码：回到初始密码', pw2 === 'Eira2026');
r = await call(env, '/auth/check', { token: tB2 });
ok('重置后：已登录的设备一并退出', r.status === 401);
r = await call(env, '/auth/login', { name: '小林', password: 'mine-123', device: 'dev-b' });
ok('重置后：自己改的密码不能用了', r.status === 401);
r = await call(env, '/auth/login', { name: '小林', password: pw2, device: 'dev-b' });
ok('重置后：初始密码能用', r.status === 200 && r.body.initial === true);
const tB3 = r.body.token;

await admin('kick', { name: '小林' });
r = await call(env, '/auth/check', { token: tB3 });
ok('全部下线：已登录的设备检查不通过', r.status === 401);

await admin('remove', { name: '第三个' });
r = await admin('list');
ok('删除', r.body.users.length === 2 && !r.body.users.some(u => u.name === '第三个'));

// ---- 改了管理员密码：旧凭证全部作废 ----
const t4 = (await call(env, '/auth/login', { name: '小林', password: pw2, device: 'dev-z' })).body.token;
const env2 = { ACCOUNTS: env.ACCOUNTS, ADMIN_PASSWORD: 'another-long-admin-pw' };
r = await call(env2, '/auth/check', { token: t4 });
ok('改了管理员密码：旧凭证不再通过', r.status === 401);

// ---- 管理员自己登录 ----
r = await call(env, '/auth/login', { name: 'admin', password: 'another-long-admin-pw', device: 'adm' });
ok('admin 用错的密码：登录不了', r.status === 401);
r = await call(env, '/auth/login', { name: 'admin', password: ADMIN, device: 'adm' });
ok('admin 加管理员密码：能登录', r.status === 200 && r.body.name === 'admin' && r.body.token);
const tAdm = r.body.token;
r = await call(env, '/auth/check', { token: tAdm });
ok('admin 的凭证检查通过', r.status === 200);
r = await call(env2, '/auth/check', { token: tAdm });
ok('改了管理员密码：admin 的旧凭证也失效', r.status === 401);
r = await admin('create', { name: 'admin' });
ok('admin 这个名字不能发给别人', r.status === 400 && /管理员/.test(r.body.error));

// ---- 跨域 ----
r = await worker.fetch(new Request('https://w.example.workers.dev/auth/login', { method: 'OPTIONS', headers: { Origin: 'https://phone.example.com' } }), env);
ok('预检允许 Authorization 头', /Authorization/.test(r.headers.get('access-control-allow-headers')));

const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);

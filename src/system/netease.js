import { baseOf } from './ai/url.js';
import { neteaseConfig, setNetease, neteaseReady } from './ai/services.js';
import { characters } from './db/index.js';

// 网易云。接的是**自己部署的** NeteaseCloudMusicApi，地址在设置里填。
//
// 为什么不内置：那个服务要跑 Node，浏览器里起不来。而且所有人共用一个出口 IP
// 会被网易云限流 —— 谁想用谁自己部署一份，地址也就只能是个设置项。
//
// **两个账号**。用户自己的号存在设置里，角色那个号（其实是用户的第二个号）
// 存在角色卡上。这个接口支持把 cookie 当查询参数逐次传进去，所以两个号可以
// 在同一台设备上各走各的，不需要来回登录。
//
// 关于「一起听」：网易云自己那个一起听是**要双方在线的实时房间**，角色那边
// 没有第二个客户端，房开了也没人进。所以这里做的是**让两个号的听歌数据都真的
// 动**：同一首歌给两个号各打一次卡，听过的歌进各自那个「和 XX 一起听」歌单。
// 这是这个场景下「真的一起听」唯一落得了地的含义。
//
// **cookie 就是账号权限**，比接口密钥还敏感，只存在这台设备的浏览器里。
// 登录页把这句话直说，不替用户含糊。


function base() {
  const b = baseOf(neteaseConfig().baseUrl);
  if (!b) throw new Error('还没有填写音乐接口地址');
  return b;
}

// 每次都带 timestamp，否则接口那边会给缓存过的结果（登录状态尤其怕这个）
async function call(path, params = {}, cookie = '') {
  const url = new URL(base() + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  url.searchParams.set('timestamp', String(Date.now()));
  if (cookie) url.searchParams.set('cookie', cookie);
  // 境外地址会被网易云要求先过验证（code -462），realIP 转交上去可以绕开
  const ip = neteaseConfig().realIP;
  if (ip) url.searchParams.set('realIP', ip);

  const res = await fetch(url.toString(), { method: 'GET' });
  let body = null;
  try { body = await res.json(); } catch { /* 有些错误页不是 JSON */ }
  if (!res.ok) {
    throw new Error(`音乐接口 ${res.status}: ${body?.message || body?.msg || res.statusText}`);
  }
  return body || {};
}

// 封面、头像一律走这里取。
//
// 网易云回来的图址有不少是 http 的。页面自己跑在 https 上时，浏览器会把这些
// 图当混合内容直接拦掉 —— 请求根本发不出去，看起来就是「图没了」。
// 它那个 CDN 本来就支持 https，换个协议即可，不必代理。
const picOf = url => String(url || '').replace(/^http:\/\//i, 'https://');

/**
 * 把缺封面的那几首补上。
 *
 * 有些接口回来的歌只有 id、歌名和歌手，没有专辑图 —— 老的 /search 就是这样。
 * 这些 id 拿去 /song/detail 问一次就都有了，**一次问一批**，不是一首问一次。
 *
 * 补不上不抛错：少一张图是摆个占位的字，整页失败是什么都看不见。
 */
async function fillCovers(list, cookie = '') {
  const miss = list.filter(t => !t.cover && t.id);
  if (!miss.length) return list;
  try {
    const r = await call('/song/detail', { ids: miss.map(t => t.id).join(',') }, cookie);
    const pic = new Map((r.songs || []).map(s =>
      [String(s.id), picOf(s.al?.picUrl || s.album?.picUrl || '')]));
    miss.forEach(t => { t.cover = pic.get(t.id) || ''; });
  } catch (err) {
    console.warn('[netease] 封面没补上:', err.message || err);
  }
  return list;
}

export function ready() { return neteaseReady(); }

// ---- 这个地址能不能用 ----
//
// 接口自己部署一份最稳，但也可以填别人开的公共实例 —— 那条路不花钱、
// 不用维护，代价是随时可能没了。两条路对本项目是同一件事：
// baseUrl 只是一个地址。
//
// **能不能用，只有在你自己的浏览器里问才算数。** CORS 是按来源判的：
// 同一个实例，别人用得了不代表你用得了。所以这件事做成一个探测器，
// 不做成一张我抄来的名单 —— 名单今天对，明天就不对了。
//
// 每一项单独跑、单独报，不用一个「通过 / 不通过」把话说死：
// 多数实例是部分可用的（能搜歌，登不了），那也够用。

// 探测时也把 realIP 带上，否则测出来的结果和实际用起来的不是一回事。
const withIP = (url, ip) =>
  (ip ? `${url}${url.includes('?') ? '&' : '?'}realIP=${encodeURIComponent(ip)}` : url);

// 已存的 cookie 也带着测：匿名被风控拦下的接口，带上 cookie 常常就通。
const withCookie = (url, ck) =>
  (ck ? `${url}${url.includes('?') ? '&' : '?'}cookie=${encodeURIComponent(ck)}` : url);

const probeOne = async (url, ms = 12000) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  const at = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', signal: ctl.signal });
    // **原样留一份返回的内容。** 只报一个状态码是不够用的：
    // 400 的 body 里通常写着到底缺什么、是不是被限流、Space 是不是没起来，
    // 那句话才是能照着改的东西。一个光秃秃的「返回 400」谁也查不下去。
    const raw = await res.text().catch(() => '');
    let body = null;
    try { body = JSON.parse(raw); } catch { /* 有些错误页不是 JSON */ }
    return { ok: res.ok, status: res.status, body, raw, ms: Date.now() - at };
  } catch (err) {
    // CORS 被拦、地址不通、超时，在浏览器里都是一个 TypeError，分不开
    return { ok: false, status: 0, raw: '',
      err: String(err.name === 'AbortError' ? '超时' : '请求发不出去'), ms: Date.now() - at };
  } finally { clearTimeout(t); }
};

// 接口说了什么。JSON 里的 message / msg 最有用，没有就退回原文。
// 截短到一行 —— 完整的 HTML 错误页铺满一屏，反而看不清。
function said(r) {
  const b = r.body;
  const msg = b && (b.message || b.msg || b.error
    || (typeof b.data === 'string' ? b.data : ''));
  const text = String(msg || r.raw || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const code = b && typeof b.code === 'number' && b.code !== r.status ? `code ${b.code}，` : '';
  return `${code}${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`;
}

// 网易云自己的业务码。回来了这个说明请求一路打到了网易云又原路回来，
// 地址和跨域都没问题，是上游不认这个实例的出口 IP，不该记在「连得上」头上。
const RISK = {
  '-462': '网易云要求先完成验证：这个实例的出口 IP 在风控名单上',
  '-460': '网易云拒绝了这个实例的出口 IP',
  '250': '网易云要求输入验证码',
};

function bizCode(r) {
  const c = r.body && r.body.code;
  return typeof c === 'number' ? c : null;
}

// 是不是上游风控。只说这一项发生了什么，怎么办由页面底下那段统一说一次。
function riskNote(r) {
  const c = bizCode(r);
  const hit = c !== null && RISK[String(c)];
  return hit ? `${hit}（code ${c}）` : '';
}

const CHECKS = [
  {
    id: 'reach', label: '连得上',
    desc: '地址通，而且允许这个页面跨域读取。两者缺一个，浏览器里都用不了',
    path: '/search?keywords=%E6%B5%8B%E8%AF%95&limit=1',
    auth: true,
    // 第一下给足时间：托管在 Hugging Face Spaces 一类平台上的实例闲置后
    // 会睡过去，第一个请求要等它整个起来，几十秒是常事。
    // 按八秒判超时，会把一个好实例判成死的。
    ms: 60000,
    judge: r => {
      if (r.status === 0) return [false, r.err];
      if (r.ok) return [true, `${r.ms} 毫秒`];
      // 回来的是网易云自己的业务码，说明这两件事都成立，只是上游不放行。
      // 这一项判通过，上游那件事记在它该在的那一项上。
      const c = bizCode(r);
      if (c !== null) return [true, `${r.ms} 毫秒。网易云回了 code ${c}`];
      return [false, `返回 ${r.status}${said(r) ? `：${said(r)}` : ''}`];
    },
  },
  {
    id: 'search', label: '搜歌',
    desc: '不登录也能用的那部分。只要这一项通，曲库与一起听就能用',
    path: '/cloudsearch?keywords=%E6%99%B4%E5%A4%A9&limit=1',
    auth: true,
    judge: r => {
      if (r.status === 0) return [false, r.err];
      if (r.status === 404) return [false, '没有这个接口，将退回旧版搜索'];
      if (riskNote(r)) return [false, riskNote(r)];
      const n = r.body?.result?.songs?.length || 0;
      return n ? [true, '搜到了，带封面']
        : [false, `返回 ${r.status}${said(r) ? `：${said(r)}` : '，没有结果'}`];
    },
  },
  {
    id: 'qrkey', label: '取登录用的 key',
    desc: '扫码登录的第一步。这一步不通，登录整条路都走不了',
    path: '/login/qr/key',
    judge: r => (r.status === 0 ? [false, r.err]
      : r.body?.data?.unikey ? [true, '拿得到']
      : riskNote(r) ? [false, riskNote(r)]
      : [false, `返回 ${r.status}${said(r) ? `：${said(r)}` : ''}`]),
  },
  {
    id: 'qrimg', label: '生成二维码',
    desc: '第二步。有的实例有 key 却生成不出图，那样扫不了码',
    // key 现取一个：用假 key 去要图，有的实例会直接拒绝
    path: null,
    run: async (b, ip) => {
      const k = await probeOne(withIP(`${b}/login/qr/key?timestamp=${Date.now()}`, ip));
      const key = k.body?.data?.unikey;
      if (!key) return { status: 0, err: riskNote(k) || '前一步没拿到 key' };
      return probeOne(withIP(`${b}/login/qr/create?qrimg=true&key=${encodeURIComponent(key)}`, ip));
    },
    judge: r => {
      if (r.status === 0) return [false, r.err];
      if (riskNote(r)) return [false, riskNote(r)];
      const img = r.body?.data?.qrimg;
      return img && String(img).startsWith('data:') ? [true, '拿得到图']
        : [false, `返回 ${r.status}${said(r) ? `：${said(r)}` : '，没有图'}`];
    },
  },
  {
    id: 'qrcheck', label: '轮询扫码状态',
    desc: '第三步。每三秒问一次，扫完确认后由它返回 803 与 cookie',
    path: '/login/qr/check?key=probe',
    // **这一项探的是假 key**，所以 4xx 不算坏消息：接口在，只是嫌参数不对。
    // 真正的坏消息是 404（根本没这个接口）和连不上。
    judge: r => {
      if (r.status === 0) return [false, r.err];
      if (r.status === 404) return [false, '没有这个接口'];
      if (riskNote(r)) return [true, `接口在。${riskNote(r)}`];
      if (typeof r.body?.code === 'number') return [true, `活着，返回 ${r.body.code}`];
      if (r.status >= 400 && r.status < 500) return [true, `活着，用假 key 问它回了 ${r.status}`];
      return [false, `返回 ${r.status}${said(r) ? `：${said(r)}` : ''}`];
    },
  },
  {
    id: 'cookie', label: '按次传 cookie',
    desc: '本项目把两个账号的 cookie 逐次传进去，实例必须支持这种传法',
    path: '/user/account?cookie=probe%3D1',
    // 同上，探的是假 cookie。回一个结构化的「没登录」说明它认这个参数；
    // 4xx 也说明它读到了并且不认这串假的 —— 都算这个接口在。
    // 回 HTML 错误页或者 5xx 才是真没处理。
    judge: r => {
      if (r.status === 0) return [false, r.err];
      if (r.status === 404) return [false, '没有这个接口'];
      if (riskNote(r)) return [true, `接口在。${riskNote(r)}`];
      if (r.body && typeof r.body === 'object') return [true, '认这个参数'];
      if (r.status >= 400 && r.status < 500) return [true, `读到了，用假 cookie 问它回了 ${r.status}`];
      return [false, `返回 ${r.status}${said(r) ? `：${said(r)}` : '，不像是认'}`];
    },
  },
  {
    id: 'url', label: '取播放地址',
    desc: '取不到就只能看，不能放。多数公共实例这一项是不通的',
    path: '/song/url/v1?id=347230&level=standard',
    auth: true,
    judge: r => {
      if (r.status === 0) return [false, r.err];
      if (r.status === 404) return [false, '没有这个接口'];
      if (riskNote(r)) return [false, riskNote(r)];
      const row = (r.body?.data || [])[0];
      if (row && row.url) return [true, '拿得到'];
      return [false, `拿不到（返回 ${r.status}）${said(r) ? `：${said(r)}` : '，可能需要登录或受版权限制'}`];
    },
  },
];

/**
 * 逐项探一遍。onStep 每测完一项回调一次，界面可以一行一行地显示出来。
 * 不抛错：某一项挂了就是那一项的结果，别的照测。
 */
export async function probe(baseUrl, onStep, realIP = neteaseConfig().realIP) {
  const b = baseOf(baseUrl);
  if (!b) throw new Error('请先填写地址');
  const ck = cookieOf();
  const out = [];
  for (const c of CHECKS) {
    const url = withIP(withCookie(b + (c.path || ''), c.auth ? ck : ''), realIP);
    const r = c.run ? await c.run(b, realIP) : await probeOne(url, c.ms);
    const [pass, note] = c.judge(r);
    const row = { id: c.id, label: c.label, desc: c.desc, pass, note, ms: r.ms,
      risk: !!riskNote(r) };
    out.push(row);
    if (onStep) onStep(row, out);
    // 第一项就连不上，后面几项只会重复同一个错误，不必再等
    if (c.id === 'reach' && !pass) break;
  }
  return out;
}

// ---- 登录 ----
//
// 扫码要一台装着网易云的手机。没有的人从前只剩「自己去开发者工具里找 MUSIC_U」，
// 这对多数人太难。**网页替你从 music.163.com 把 cookie 读出来是做不到的**：
// 别家网站的 cookie 浏览器不给读，MUSIC_U 还是 HttpOnly，嵌网页、书签脚本都拿不到。
//
// 但自己部署的那个接口本来就会登录：短信验证码、手机号或邮箱加密码，
// 登成了直接把 cookie 交回来，不用人去找。于是加上这两条：
//
//   短信验证码  和扫码同一个信任级别：交出去的只是一次性的码
//   密码        密码会经过填写的接口地址。原文不出这台设备（先算 MD5），
//               也不进网址（POST），但拿到 MD5 照样能登 —— 界面上照实写明，只建议在
//               自己部署的接口上用
//
// 网易云对这两条都有风控：短信发得太勤会被限，密码登录常被要求行为验证（8821），
// 那时只能换扫码、短信或粘贴 cookie，错误里写明。

// 登录那几个请求走 POST，参数放在表单里：密码（哪怕是 MD5）不该出现在网址与访问日志里。
// 表单编码是「简单请求」，不触发跨域预检
async function post(path, params = {}) {
  const url = new URL(base() + path);
  url.searchParams.set('timestamp', String(Date.now()));
  const body = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') body.set(k, String(v));
  });
  const ip = neteaseConfig().realIP;
  if (ip) body.set('realIP', ip);
  const res = await fetch(url.toString(), { method: 'POST', body });
  let data = null;
  try { data = await res.json(); } catch { /* 有些错误页不是 JSON */ }
  return { status: res.status, body: data || {} };
}

// 登录失败时网易云回的那几个码，翻成能照着做的话
const LOGIN_WHY = {
  8821: '网易云要求先完成行为验证，这种方式暂时登不上。请改用短信验证码、扫码或粘贴 cookie',
  503: '验证码不对，或者已经过期',
  502: '密码不对',
  501: '这个账号不存在',
  400: '参数有误，请检查手机号或邮箱',
  '-462': '网易云要求先完成验证：接口所在的出口 IP 在风控名单上。可在上方填写中国大陆 IP 后重试',
  405: '操作太频繁，请稍后再试',
};
const loginError = r => {
  const code = r.body?.code ?? r.status;
  return new Error(LOGIN_WHY[code] || r.body?.message || r.body?.msg || `登录失败（code ${code}）`);
};

/** 发短信验证码。ctcode 是国家区号，中国大陆为 86 */
export async function smsSend(phone, ctcode = '86') {
  const p = String(phone || '').replace(/\s+/g, '');
  if (!/^\d{5,15}$/.test(p)) throw new Error('请填写手机号');
  const r = await post('/captcha/sent', { phone: p, ctcode: ctcode || '86' });
  if (r.body?.code !== 200) throw loginError(r);
  return true;
}

/** 手机号加短信验证码登录，给回 cookie */
export async function smsLogin(phone, captcha, ctcode = '86') {
  const p = String(phone || '').replace(/\s+/g, '');
  const c = String(captcha || '').trim();
  if (!p || !c) throw new Error('请填写手机号与验证码');
  const r = await post('/login/cellphone', { phone: p, captcha: c, countrycode: ctcode || '86' });
  if (r.body?.code !== 200 || !r.body?.cookie) throw loginError(r);
  return r.body.cookie;
}

/** 手机号或邮箱加密码登录，给回 cookie。密码先算 MD5，原文不外传 */
export async function passwordLogin(account, password, ctcode = '86') {
  const a = String(account || '').trim();
  if (!a || !password) throw new Error('请填写账号与密码');
  const { md5 } = await import('./md5.js');
  const hashed = md5(password);
  const r = a.includes('@')
    ? await post('/login', { email: a, md5_password: hashed })
    : await post('/login/cellphone', { phone: a.replace(/\s+/g, ''), md5_password: hashed, countrycode: ctcode || '86' });
  if (r.body?.code !== 200 || !r.body?.cookie) throw loginError(r);
  return r.body.cookie;
}

// 扫码
export async function qrStart() {
  const key = (await call('/login/qr/key')).data?.unikey;
  if (!key) throw new Error('接口没有返回二维码 key');
  const made = await call('/login/qr/create', { key, qrimg: true });
  return { key, img: made.data?.qrimg || '', url: made.data?.qrurl || '' };
}

// 800 过期 · 801 等待扫码 · 802 已扫待确认 · 803 成功
export async function qrCheck(key) {
  const r = await call('/login/qr/check', { key });
  return { code: r.code, message: r.message || '', cookie: r.cookie || '' };
}

export async function accountOf(cookie) {
  const r = await call('/user/account', {}, cookie);
  const p = r.profile || {};
  return { uid: p.userId ? String(p.userId) : '', nickname: p.nickname || '', avatar: picOf(p.avatarUrl) };
}

// 登录成功之后把凭据落到该落的地方：不给 charId 就是用户自己的号
export async function saveLogin(cookie, charId = '') {
  const who = await accountOf(cookie);
  if (charId) {
    characters.update(charId, {
      neteaseCookie: cookie, neteaseNick: who.nickname, neteaseUid: who.uid,
    });
  } else {
    setNetease({ cookie, nickname: who.nickname, uid: who.uid });
  }
  return who;
}

/**
 * 手工粘贴 cookie 存进来。和 saveLogin 的区别只有一条：账号信息问不到也照存 ——
 * 被风控的实例上 /user/account 多半也问不到，不能因此拒绝保存。
 */
export async function saveCookie(raw, charId = '') {
  const cookie = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!cookie) throw new Error('请先填写 cookie');
  let who = { uid: '', nickname: '', avatar: '' };
  try { who = await accountOf(cookie); } catch { /* 问不到也照存，见上 */ }
  if (charId) {
    characters.update(charId, {
      neteaseCookie: cookie, neteaseNick: who.nickname, neteaseUid: who.uid,
    });
  } else {
    setNetease({ cookie, nickname: who.nickname, uid: who.uid });
  }
  return who;
}

export function logout(charId = '') {
  if (charId) characters.update(charId, { neteaseCookie: '', neteaseNick: '', neteaseUid: '' });
  else setNetease({ cookie: '', nickname: '', uid: '' });
}

export function cookieOf(charId = '') {
  if (!charId) return neteaseConfig().cookie || '';
  return characters.get(charId)?.neteaseCookie || '';
}

// 这一次动作要落到哪几个号上。两个号都登了就都落，只登一个就落一个。
export function accounts(charId) {
  const list = [];
  const mine = cookieOf();
  const hers = cookieOf(charId);
  if (mine) list.push({ cookie: mine, charId: '' });
  if (hers && hers !== mine) list.push({ cookie: hers, charId });
  return list;
}

// 这个号的 uid。登录时存过就用存的，没存过现问一次。
export async function uidOf(charId = '') {
  const saved = charId ? characters.get(charId)?.neteaseUid : neteaseConfig().uid;
  if (saved) return String(saved);
  const cookie = cookieOf(charId);
  if (!cookie) return '';
  return (await accountOf(cookie)).uid;
}

// ---- 个人主页那一页要的东西 ----
//
// 这些数字都是**网易云那边算好的**，这里只读不算：听歌总数是 listenSongs，
// 排行是 /user/record 的 playCount。自己再拿播放记录去累加会和客户端里
// 显示的对不上，而对得上正是这一页存在的理由。

export async function profile(charId = '') {
  const cookie = cookieOf(charId);
  const uid = await uidOf(charId);
  if (!uid) throw new Error('还没有登录音乐账号');
  const r = await call('/user/detail', { uid }, cookie);
  const p = r.profile || {};
  return {
    uid: String(p.userId || uid),
    nickname: p.nickname || '',
    avatar: picOf(p.avatarUrl),
    cover: picOf(p.backgroundUrl),
    signature: p.signature || '',
    level: Number(r.level || 0) || 0,
    listenSongs: Number(r.listenSongs || 0) || 0,
    createDays: Number(r.createDays || 0) || 0,
    follows: Number(p.follows || 0) || 0,
    followeds: Number(p.followeds || 0) || 0,
  };
}

// type 1 = 最近一周，0 = 所有时间。两边的结构一样，只是字段名不同。
export async function record(charId = '', { week = true, limit = 0 } = {}) {
  const cookie = cookieOf(charId);
  const uid = await uidOf(charId);
  if (!uid) throw new Error('还没有登录音乐账号');
  const r = await call('/user/record', { uid, type: week ? 1 : 0 }, cookie);
  const rows = (week ? r.weekData : r.allData) || r.weekData || r.allData || [];
  const list = rows.map(row => {
    const song = row.song || {};
    return {
      ...songOf(song),
      count: Number(row.playCount || 0) || 0,
      score: Number(row.score || 0) || 0,
      seconds: Math.round(Number(song.dt || song.duration || 0) / 1000) || 0,
      album: song.al?.name || song.album?.name || '',
    };
  }).filter(x => x.id && x.title);
  await fillCovers(list, cookie);
  return limit > 0 ? list.slice(0, limit) : list;
}

// 这个号的歌单。创建的排在前面，收藏的排在后面，网易云自己也是这个顺序。
export async function playlistsOf(charId = '') {
  const cookie = cookieOf(charId);
  const uid = await uidOf(charId);
  if (!uid) throw new Error('还没有登录音乐账号');
  const r = await call('/user/playlist', { uid, limit: 200 }, cookie);
  return (r.playlist || []).map(p => ({
    id: String(p.id),
    name: p.name || '',
    cover: picOf(p.coverImgUrl),
    count: Number(p.trackCount || 0) || 0,
    mine: String(p.userId || '') === String(uid),
    played: Number(p.playCount || 0) || 0,
  }));
}

// 歌单里的歌。/playlist/track/all 拿得到全部，老一点的部署退回 /playlist/detail。
export async function playlistTracks(id, limit = 0) {
  const cookie = cookieOf();
  try {
    const r = await call('/playlist/track/all', { id, limit: limit || 1000 }, cookie);
    const list = (r.songs || []).map(trackOf).filter(x => x.id && x.title);
    if (list.length) return list;
  } catch { /* 走下一条 */ }
  const r = await call('/playlist/detail', { id }, cookie);
  return ((r.playlist?.tracks) || []).map(trackOf).filter(x => x.id && x.title);
}

const trackOf = s => ({
  id: String(s.id || ''),
  title: s.name || '',
  artist: (s.ar || s.artists || []).map(a => a.name).filter(Boolean).join('、'),
  album: s.al?.name || s.album?.name || '',
  cover: picOf(s.al?.picUrl || s.album?.picUrl),
  seconds: Math.round(Number(s.dt || s.duration || 0) / 1000) || 0,
});

// ---- 曲库 ----
/**
 * 搜索。
 *
 * **走 /cloudsearch，不走 /search。** 两个接口搜的是同一批歌，但回来的结构
 * 是两代：/search 那一代每首只带 id、歌名、歌手和一个没有图址的 album，
 * 于是搜出来的结果一张封面都没有。/cloudsearch 回来的是新结构，带 al.picUrl。
 *
 * 老一点的部署没有 /cloudsearch，退回 /search，缺的封面再用 /song/detail 补齐。
 */
export async function search(keywords, limit = 20) {
  const cookie = cookieOf();
  let rows = [];
  try {
    const r = await call('/cloudsearch', { keywords, limit }, cookie);
    rows = r.result?.songs || [];
  } catch { /* 这份部署没有这个接口，走下一条 */ }
  if (!rows.length) {
    const r = await call('/search', { keywords, limit }, cookie);
    rows = r.result?.songs || [];
  }
  const list = rows.map(trackOf).filter(x => x.id && x.title);
  return fillCovers(list, cookie);
}

// 播放地址是**会过期的**，所以不入库，每次要放的时候现取。
export async function songUrl(id, cookie = cookieOf()) {
  const r = await call('/song/url/v1', { id, level: 'standard' }, cookie)
    .catch(() => call('/song/url', { id }, cookie));   // 老一点的部署没有 v1
  const row = (r.data || [])[0];
  if (!row || !row.url) throw new Error('这首歌取不到播放地址，可能需要会员或版权受限');
  return row.url;
}

/**
 * 歌词。原文、译文各一份 LRC（外文歌才有译文）。
 * 纯音乐与「暂无歌词」接口自己会标出来，照实带回去，界面上各说各的话。
 */
export async function lyric(id) {
  const r = await call('/lyric', { id });
  return {
    lrc: r.lrc?.lyric || '',
    tlrc: r.tlyric?.lyric || '',
    pure: !!r.pureMusic,
    none: !!(r.nolyric || r.uncollected),
  };
}

// ---- 她在听什么 ----
//
// 电脑上用角色那个号登着真正的网易云客户端，放的每一首都会记进那个账号。
// 这里把它读回来，写进上下文。于是「你在听什么」这句话的答案是真的。
//
// 上面那句「角色那边没有第二个客户端」写得太早了：**用户自己就是那个客户端**。
//
// 两条路，按能拿到的信息从多到少试：
//   /record/recent/song   最近播放，带时间戳，能说出「刚刚在听」
//   /user/record          本周听歌排行，没有时间戳，只能说「最近常听」
// 两条都没有就是这份部署不支持，界面上直说，不假装有。

const songOf = s => ({
  id: String(s.id || s.songId || ''),
  title: s.name || s.title || '',
  artist: (s.ar || s.artists || []).map(a => a.name).filter(Boolean).join('、'),
  // 这一项以前漏了，于是首页「最近播放」那一排从来没有过封面。
  // 两条路回来的结构不同：新的在 al，旧的在 album，都认。
  cover: picOf(s.al?.picUrl || s.album?.picUrl),
});

// covers：要不要把缺封面的那几首补齐。**默认不补** —— 这个函数的主要调用方是
// 注入上下文那条路（pullRecent），那边只用得着歌名和歌手，为它多问一次图址
// 是白花的一趟。首页要显示封面，自己传 true。
export async function recent(charId, limit = 5, { covers = false } = {}) {
  const cookie = cookieOf(charId);
  if (!cookie) throw new Error(charId ? '这个角色还没有登录音乐账号' : '还没有登录音乐账号');
  const n = Math.max(1, Math.round(limit) || 5);

  // 带时间戳的那条路
  try {
    const r = await call('/record/recent/song', { limit: n }, cookie);
    const list = (r.data?.list || []).map(row => ({
      ...songOf(row.data || row.song || row),
      at: Number(row.playTime || row.time || 0) || 0,
    })).filter(x => x.id && x.title);
    if (list.length) {
      const songs = list.slice(0, n);
      if (covers) await fillCovers(songs, cookie);
      return { kind: 'recent', songs, at: Date.now() };
    }
  } catch { /* 这份部署没有这个接口，走下一条 */ }

  // 退回排行榜。没有时间戳，所以只能说「最近常听」，不能说「刚刚在听」
  const uid = await uidOf(charId);
  if (!uid) throw new Error('取不到这个账号的 uid');
  const r = await call('/user/record', { uid, type: 1 }, cookie);
  const rows = r.weekData || r.allData || [];
  const songs = rows.map(row => songOf(row.song || {})).filter(x => x.id && x.title);
  if (!songs.length) throw new Error('这个账号最近没有听歌记录');
  const out = songs.slice(0, n);
  if (covers) await fillCovers(out, cookie);
  return { kind: 'week', songs: out, at: Date.now() };
}

/** 拉一次并记在角色卡上。上下文那边读的是记下来的这一份，不现拉。 */
export async function pullRecent(charId, limit = 5) {
  const got = await recent(charId, limit);
  characters.update(charId, { nowPlaying: got });
  return got;
}

/**
 * 发消息时顺便看一眼。
 *
 * 不起定时器：不聊天的时候没必要一直压着那个接口。间隔由用户自己填，
 * 填 0 就是只在手动点的时候才拉（见「用量与上限」）。
 * 失败不抛：拉不到就用上一次的，再不行就不注入这一段。
 */
export async function pullIfDue(charId) {
  const gap = Math.max(0, Math.round(Number(neteaseConfig().recentGap) ?? 5) || 0);
  if (!gap || !charId || !cookieOf(charId)) return null;
  const last = characters.get(charId)?.nowPlaying?.at || 0;
  if (Date.now() - last < gap * 60000) return null;
  try { return await pullRecent(charId); } catch { return null; }
}

// ---- 让两个号的数据都真的动 ----
//
// 打卡。网易云自己的客户端放完一首就打一次，听歌记录和年度报告读的就是它。
export async function scrobble(songId, seconds, charId = '') {
  const jobs = accounts(charId).map(a =>
    call('/scrobble', { id: songId, sourceid: songId, time: Math.max(1, Math.round(seconds)) }, a.cookie)
      .catch(err => { console.warn('[netease] 打卡失败:', err.message || err); }));
  await Promise.all(jobs);
}

async function ensureList(cookie, name) {
  const mine = await call('/user/playlist', { uid: (await accountOf(cookie)).uid, limit: 200 }, cookie);
  const found = (mine.playlist || []).find(p => p.name === name);
  if (found) return String(found.id);
  const made = await call('/playlist/create', { name, privacy: 10 }, cookie);
  const id = made.id || made.playlist?.id;
  if (!id) throw new Error('建歌单失败');
  return String(id);
}

// 把这一场听过的歌同步进两个号各自那个歌单。默认不开 ——
// 往用户真实的歌单里写东西是件重的事，得他自己点头。
export async function syncPlaylist(songIds, charId, listName) {
  if (!neteaseConfig().sync || !songIds.length) return;
  const ids = songIds.join(',');
  for (const a of accounts(charId)) {
    try {
      const pid = await ensureList(a.cookie, listName);
      await call('/playlist/tracks', { op: 'add', pid, tracks: ids }, a.cookie);
    } catch (err) {
      console.warn('[netease] 歌单同步失败:', err.message || err);
    }
  }
}

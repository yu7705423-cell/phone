// 小手机 · 网易云转发（Cloudflare Worker）
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
// 安全上的几条：
//   · 只转发到网易云的那几个域名，别的地址一律拒绝 —— 它不能被拿去当通用代理
//   · 下面 ALLOW_ORIGINS 填上你们网站的地址，别的网站的网页就用不了它
//   · 用户登录后的 cookie 会经过这里，这个文件不记录、不保存任何东西；
//     Cloudflare 后台的「日志」功能请保持默认的关闭，不要打开请求内容的记录

// 允许哪些网站使用。留空表示不限；建议填上你们网站的地址，例如 ['https://phone.example.com']
const ALLOW_ORIGINS = [];

const HOSTS = new Set(['music.163.com', 'interface.music.163.com', 'interface3.music.163.com']);
const VERSION = 1;

// 只认一个看起来像 IPv4 的值，别的当没给
const isIPv4 = s => /^(\d{1,3})(\.\d{1,3}){3}$/.test(String(s || ''))
  && String(s).split('.').every(n => Number(n) <= 255);

function corsHeaders(origin) {
  const allow = !ALLOW_ORIGINS.length ? (origin || '*') : ALLOW_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (obj, status, headers) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (ALLOW_ORIGINS.length && origin && !ALLOW_ORIGINS.includes(origin)) {
      return json({ error: '这个网站不在允许名单里' }, 403, cors);
    }
    // 应用用它来认出这是转发 Worker、是哪一版
    if (request.method === 'GET') return json({ ok: true, name: 'mini-phone-netease', version: VERSION }, 200, cors);
    if (request.method !== 'POST') return json({ error: '只接受 POST' }, 405, cors);

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

import { weapi, eapi } from './crypto.js';
import { token as authToken } from '../auth.js';

// 经由转发 Worker 直接和网易云说话的那一层。照 NeteaseCloudMusicApi（MIT）的 util/request.js 写：
// 同样的 cookie 补全、同样的请求头、同样的加密选择、同样的状态码处理 —— 这样 routes.js 里
// 各接口的回复与原项目的接口服务器给的一模一样，netease.js 其余部分一行都不用改。
//
// 与原项目不同的只有两处：
//   · 请求头里的 Cookie、User-Agent、Referer、IP 浏览器不许自己设，一并交给 Worker 去设
//   · 原项目在服务器启动时注册一个游客身份给所有人共用；这里每台设备自己注册一个（device.anon），
//     并且每台设备固定一个随机的国内 IP（device.ip）：几百个用户分散在不同 IP 上，
//     同一个账号又始终是同一个 IP，不会在网易云那边频繁「换地方」

const DOMAIN = 'https://music.163.com';
const API_DOMAIN = 'https://interface.music.163.com';
// 这几个业务码原项目当作「成功」往回交（扫码的 800 到 803 都在里面）
const SPECIAL = new Set([201, 302, 400, 502, 800, 801, 802, 803]);

const OS = {
  pc: { os: 'pc', appver: '3.1.17.204416', osver: 'Microsoft-Windows-10-Professional-build-19045-64bit', channel: 'netease' },
  iphone: { os: 'iPhone OS', appver: '9.0.90', osver: '16.2', channel: 'distribution' },
};
const UA = {
  weapi: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  eapi: 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)',
};

// 原项目用的那一批国内 IP 段
const CN_PREFIX = ['116.25', '116.76', '116.77', '116.78', '116.79', '116.80', '116.81', '116.82', '116.83', '116.84',
  '116.85', '116.86', '116.87', '116.88', '116.89', '116.90', '116.91', '116.92', '116.93', '116.94'];
const rnd = n => Math.floor(Math.random() * n);
export const randomCNIP = () => `${CN_PREFIX[rnd(CN_PREFIX.length)]}.${1 + rnd(255)}.${1 + rnd(255)}`;
export const randomDeviceId = () => Array.from({ length: 52 }, () => '0123456789ABCDEF'[rnd(16)]).join('');
const hexBytes = n => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
};
const WNMCID = `${Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz'[rnd(26)]).join('')}.${Date.now()}.01.0`;

/** 「a=1; b=2」读成对象。值里带等号的（base64 的补位）也认，原项目在这一点上会丢值 */
export function cookieToJson(cookie) {
  const out = {};
  if (!cookie) return out;
  if (typeof cookie === 'object') return { ...cookie };
  String(cookie).split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}
const toCookieString = obj => Object.keys(obj)
  .filter(k => obj[k] !== undefined && obj[k] !== null)
  .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(obj[k])}`).join('; ');

/**
 * 建一个请求器。
 *   worker   转发 Worker 的地址
 *   device() 这台设备的 { deviceId, anon, ip }（anon 是游客身份的 MUSIC_A，可能还没有）
 *   ip()     要随请求带的国内 IP：用户或本站设了 realIP 就用它，否则用这台设备那一个
 */
export function createClient({ worker, device, ip }) {
  function processCookie(cookie, uri) {
    const dev = device();
    const os = OS[cookie.os] || OS.pc;
    const nuid = hexBytes(32);
    const c = {
      ...cookie,
      __remember_me: 'true',
      ntes_kaola_ad: '1',
      _ntes_nuid: cookie._ntes_nuid || nuid,
      _ntes_nnid: cookie._ntes_nnid || `${nuid},${Date.now()}`,
      WNMCID: cookie.WNMCID || WNMCID,
      WEVNSM: cookie.WEVNSM || '1.0.0',
      osver: cookie.osver || os.osver,
      deviceId: cookie.deviceId || dev.deviceId,
      os: cookie.os || os.os,
      channel: cookie.channel || os.channel,
      appver: cookie.appver || os.appver,
    };
    if (uri.indexOf('login') === -1) c.NMTID = hexBytes(16);
    if (!c.MUSIC_U && (c.MUSIC_A || dev.anon)) c.MUSIC_A = c.MUSIC_A || dev.anon;
    return c;
  }

  /**
   * 发一个请求。uri 是 /api/... 那一段，crypto 是 weapi 或 eapi（原项目里空着的默认就是 eapi）。
   * 给回 { status, body, cookie }，status 的算法与原项目一致
   */
  async function request(uri, data, { crypto = 'eapi', cookie = {} } = {}) {
    const ck = processCookie(cookieToJson(cookie), uri);
    const csrf = ck.__csrf || '';
    const d = { ...data, e_r: false };
    let url;
    let form;
    let headerCookie;
    let ua;
    let referer = '';
    if (crypto === 'weapi') {
      d.csrf_token = csrf;
      form = await weapi(d);
      url = `${DOMAIN}/weapi/${uri.slice(5)}`;
      headerCookie = toCookieString(ck);
      ua = UA.weapi;
      referer = DOMAIN;
    } else {
      const header = {
        osver: ck.osver, deviceId: ck.deviceId, os: ck.os, appver: ck.appver,
        versioncode: ck.versioncode || '140', mobilename: ck.mobilename || '',
        buildver: ck.buildver || String(Date.now()).slice(0, 10), resolution: ck.resolution || '1920x1080',
        __csrf: csrf, channel: ck.channel,
        requestId: `${Date.now()}_${String(rnd(1000)).padStart(4, '0')}`,
      };
      if (ck.MUSIC_U) header.MUSIC_U = ck.MUSIC_U;
      if (ck.MUSIC_A) header.MUSIC_A = ck.MUSIC_A;
      headerCookie = toCookieString(header);
      ua = UA.eapi;
      d.header = header;
      form = await eapi(uri, d);
      url = `${API_DOMAIN}/eapi/${uri.slice(5)}`;
    }

    let res;
    try {
      res = await fetch(worker, {
        method: 'POST',
        // 本站开了登录时，Worker 只给登录了的人转发（见 system/auth.js）
        headers: { 'Content-Type': 'application/json', ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}) },
        body: JSON.stringify({ url, body: new URLSearchParams(form).toString(), cookie: headerCookie, ua, referer, ip: ip() }),
      });
    } catch (err) {
      return { status: 502, body: { code: 502, msg: `连不上音乐转发服务（${err.message || err}），请检查本站的 Worker 地址` }, cookie: [] };
    }
    let wrap = null;
    try { wrap = await res.json(); } catch { /* Worker 回的不是 JSON */ }
    if (!res.ok || !wrap) {
      return { status: res.status || 502, body: { code: res.status || 502, msg: wrap?.error || `音乐转发服务返回 ${res.status}` }, cookie: [] };
    }
    const answer = { status: 500, body: {}, cookie: wrap.cookies || [] };
    try {
      answer.body = JSON.parse(wrap.body);
      if (answer.body.code) answer.body.code = Number(answer.body.code);
      answer.status = Number(answer.body.code || wrap.status);
      if (SPECIAL.has(answer.body.code)) answer.status = 200;
    } catch {
      answer.body = { code: wrap.status, msg: String(wrap.body || wrap.error || '').slice(0, 200) };
      answer.status = wrap.status;
    }
    answer.status = answer.status > 100 && answer.status < 600 ? answer.status : 400;
    return answer;
  }

  return { request };
}

/** 这个地址是不是本项目的转发 Worker（GET 一下看它自报家门） */
export async function isWorker(url) {
  try {
    const r = await fetch(url, { method: 'GET' });
    const b = await r.json();
    return b?.name === 'mini-phone-netease' ? b : null;
  } catch { return null; }
}

import qrcode from '../../../vendor/qrcode-generator.mjs';
import { encodeDeviceId } from './crypto.js';

// 本项目用到的那 22 个接口，照 NeteaseCloudMusicApi（MIT）module/ 下同名文件写：
// 网易云那边的网址、参数、加密方式、回复的包装一一对应。netease.js 调 call('/cloudsearch', …)
// 时，在 Worker 模式下就落到这里的 ROUTES['/cloudsearch']，拿到的回复与原项目接口服务器给的一样。
//
// 每一项 (q, rq) => { status, body, cookie }：
//   q   调用方给的参数，外加 q.cookie（对象）与 q.device（这台设备的 deviceId）
//   rq  (uri, data, crypto) => 请求，见 client.js。crypto 不写就是 eapi（原项目的默认）
//
// 与原项目有意不同的一处：扫码状态（/login/qr/check）出错时原项目吞掉错误、回一个空的成功，
// 这里照实把错误交回去 —— 否则被风控拦下（-462）时看不出来，也就不会换游客身份再试。

const ok = r => r.status === 200;
const joinCookie = r => (r.cookie || []).join(';');

export const ROUTES = {
  '/cloudsearch': (q, rq) => rq('/api/cloudsearch/pc', {
    s: q.keywords, type: q.type || 1, limit: q.limit || 30, offset: q.offset || 0, total: true,
  }),

  '/search': (q, rq) => rq('/api/search/get', {
    s: q.keywords, type: q.type || 1, limit: q.limit || 30, offset: q.offset || 0,
  }),

  '/song/detail': (q, rq) => rq('/api/v3/song/detail', {
    c: `[${String(q.ids).split(/\s*,\s*/).map(id => `{"id":${id}}`).join(',')}]`,
  }, 'weapi'),

  '/song/url': async (q, rq) => {
    const ids = String(q.id).split(',');
    const r = await rq('/api/song/enhance/player/url', { ids: JSON.stringify(ids), br: parseInt(q.br || 999000, 10) });
    if (!ok(r)) return r;
    const data = (r.body.data || []).slice().sort((a, b) => ids.indexOf(String(a.id)) - ids.indexOf(String(b.id)));
    return { status: 200, body: { code: 200, data }, cookie: r.cookie };
  },

  '/song/url/v1': (q, rq) => {
    const data = { ids: `[${q.id}]`, level: q.level, encodeType: 'flac' };
    if (data.level === 'sky') data.immerseType = 'c51';
    return rq('/api/song/enhance/player/url/v1', data);
  },

  '/lyric': (q, rq) => rq('/api/song/lyric', { id: q.id, tv: -1, lv: -1, rv: -1, kv: -1, _nmclfl: 1 }),

  '/register/anonimous': async (q, rq) => {
    const r = await rq('/api/register/anonimous', { username: encodeDeviceId(q.device) }, 'weapi');
    if (r.body?.code !== 200) return r;
    return { status: 200, body: { ...r.body, cookie: joinCookie(r) }, cookie: r.cookie };
  },

  '/login/qr/key': async (q, rq) => {
    const r = await rq('/api/login/qrcode/unikey', { type: 3 });
    if (!ok(r)) return r;
    return { status: 200, body: { data: r.body, code: 200 }, cookie: r.cookie };
  },

  // 原项目在服务器上用 qrcode 库生成图片；这里在本机生成，不发请求
  '/login/qr/create': async q => {
    const url = `https://music.163.com/login?codekey=${q.key}`;
    let qrimg = '';
    if (q.qrimg) {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      qrimg = qr.createDataURL(6, 2);
    }
    return { status: 200, body: { code: 200, data: { qrurl: url, qrimg } }, cookie: [] };
  },

  '/login/qr/check': async (q, rq) => {
    const r = await rq('/api/login/qrcode/client/login', { key: q.key, type: 3 });
    if (!ok(r)) return r;
    return { status: 200, body: { ...r.body, cookie: joinCookie(r) }, cookie: r.cookie };
  },

  '/captcha/sent': (q, rq) => rq('/api/sms/captcha/sent', {
    ctcode: q.ctcode || '86', secrete: 'music_middleuser_pclogin', cellphone: q.phone,
  }, 'weapi'),

  // 只有短信验证码这一种，不收密码（见 ARCHITECTURE 4.183）
  '/login/cellphone': async (q, rq) => {
    const r = await rq('/api/w/login/cellphone', {
      type: '1', https: 'true', phone: q.phone, countrycode: q.countrycode || '86',
      captcha: q.captcha, remember: 'true',
    }, 'weapi');
    if (r.body?.code !== 200) return r;
    const body = JSON.parse(JSON.stringify(r.body).replace(/avatarImgId_str/g, 'avatarImgIdStr'));
    return { status: 200, body: { ...body, cookie: joinCookie(r) }, cookie: r.cookie };
  },

  '/user/account': (q, rq) => rq('/api/nuser/account/get', {}, 'weapi'),

  '/user/detail': async (q, rq) => {
    const r = await rq(`/api/v1/user/detail/${q.uid}`, {}, 'weapi');
    return JSON.parse(JSON.stringify(r).replace(/avatarImgId_str/g, 'avatarImgIdStr'));
  },

  '/user/record': (q, rq) => rq('/api/v1/play/record', { uid: q.uid, type: q.type || 0 }, 'weapi'),

  '/record/recent/song': (q, rq) => rq('/api/play-record/song/list', { limit: q.limit || 100 }, 'weapi'),

  '/user/playlist': (q, rq) => rq('/api/user/playlist', {
    uid: q.uid, limit: q.limit || 30, offset: q.offset || 0, includeVideo: true,
  }, 'weapi'),

  '/playlist/detail': (q, rq) => rq('/api/v6/playlist/detail', { id: q.id, n: 100000, s: q.s || 8 }),

  '/playlist/track/all': async (q, rq) => {
    const limit = parseInt(q.limit, 10) || 1000;
    const offset = parseInt(q.offset, 10) || 0;
    const r = await rq('/api/v6/playlist/detail', { id: q.id, n: 100000, s: q.s || 8 });
    if (!ok(r)) return r;
    const ids = (r.body.playlist?.trackIds || []).slice(offset, offset + limit);
    return rq('/api/v3/song/detail', { c: `[${ids.map(it => `{"id":${it.id}}`).join(',')}]` });
  },

  '/playlist/create': (q, rq) => rq('/api/playlist/create', {
    name: q.name, privacy: q.privacy || '0', type: q.type || 'NORMAL',
  }, 'weapi'),

  '/playlist/tracks': async (q, rq) => {
    const tracks = String(q.tracks).split(',');
    const data = { op: q.op, pid: q.pid, trackIds: JSON.stringify(tracks), imme: 'true' };
    const r = await rq('/api/playlist/manipulate/tracks', data);
    if (ok(r)) return { status: 200, body: { ...r }, cookie: r.cookie };
    if (r.body?.code === 512) {
      return rq('/api/playlist/manipulate/tracks', { ...data, trackIds: JSON.stringify([...tracks, ...tracks]) });
    }
    return { status: 200, body: r.body, cookie: r.cookie };
  },

  '/scrobble': (q, rq) => rq('/api/feedback/weblog', {
    logs: JSON.stringify([{
      action: 'play',
      json: {
        download: 0, end: 'playend', id: q.id, sourceId: q.sourceid, time: q.time,
        type: 'song', wifi: 0, source: 'list', mainsite: 1, content: '',
      },
    }]),
  }, 'weapi'),
};

/** 调一个接口。path 不认识就当 404，和原项目的接口服务器一样 */
export async function route(client, path, params = {}, cookie = {}, device = '') {
  const fn = ROUTES[path];
  if (!fn) return { status: 404, body: { code: 404, data: null, msg: 'Not Found' }, cookie: [] };
  const q = { ...params, cookie, device };
  const rq = (uri, data, crypto = 'eapi') => client.request(uri, data, { crypto, cookie });
  return fn(q, rq);
}

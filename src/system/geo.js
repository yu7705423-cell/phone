import { chats, characters } from './db/index.js';

// 共享位置：两个人隔多远。
//
// 这件事的全部要害是**那个数字不能让模型编**。问它「成都到上海多远」，
// 它会给一个听起来很像的数，而且每次都不一样。所以距离在这里是
// **本地按 haversine 算的**，算完连同单位一起写进上下文，
// 提示词里再明说一句「这个数是给定的，不要改」。
//
// 和距离、点数、金额一样：**数字不是模型的活**（见 4.678、4.82）。
//
// 坐标两边都是**自己填的**，不读设备 GPS —— 和位置那边一个道理
// （见 4.677）：用户的真实坐标不该为了一句台词交出去，角色那边更是
// 压根没有坐标可言。想用真实定位的，界面上有一个按钮单独去取。

// 常见城市的坐标。表驱动，加一行就多一个快捷选项；
// 表里没有的照样可以手填经纬度。
export const CITIES = [
  { name: '北京', lat: 39.90, lng: 116.41 },
  { name: '上海', lat: 31.23, lng: 121.47 },
  { name: '广州', lat: 23.13, lng: 113.26 },
  { name: '深圳', lat: 22.54, lng: 114.06 },
  { name: '成都', lat: 30.57, lng: 104.07 },
  { name: '杭州', lat: 30.27, lng: 120.15 },
  { name: '西安', lat: 34.34, lng: 108.94 },
  { name: '武汉', lat: 30.59, lng: 114.31 },
  { name: '重庆', lat: 29.56, lng: 106.55 },
  { name: '南京', lat: 32.06, lng: 118.80 },
  { name: '香港', lat: 22.32, lng: 114.17 },
  { name: '台北', lat: 25.03, lng: 121.57 },
  { name: '东京', lat: 35.68, lng: 139.65 },
  { name: '首尔', lat: 37.57, lng: 126.98 },
  { name: '新加坡', lat: 1.35, lng: 103.82 },
  { name: '伦敦', lat: 51.51, lng: -0.13 },
  { name: '巴黎', lat: 48.86, lng: 2.35 },
  { name: '纽约', lat: 40.71, lng: -74.01 },
  { name: '洛杉矶', lat: 34.05, lng: -118.24 },
  { name: '悉尼', lat: -33.87, lng: 151.21 },
];

// 空值必须先挡掉再转数字：Number(null) 和 Number('') 都是 0，而 0 是个
// 合法的经纬度。不挡的话，clean 一个已经 clean 过的位置会把 null 变成 0，
// 「只填了地名」的那一端就成了几内亚湾的 (0, 0)，凭空算出上万公里。
const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 一端的位置。经纬度任一缺失就算没坐标，只剩一个地点名。 */
export function clean(spot) {
  const lat = num(spot?.lat);
  const lng = num(spot?.lng);
  const ok = lat !== null && lng !== null
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  return {
    place: String(spot?.place || '').trim().slice(0, 40),
    lat: ok ? lat : null,
    lng: ok ? lng : null,
  };
}

/**
 * 球面距离，单位公里。haversine —— 两点都在地球上，直线距离按大圆算。
 * 任一端没坐标就返回 null，**不猜**。
 */
export function distance(a, b) {
  const x = clean(a), y = clean(b);
  if (x.lat === null || y.lat === null) return null;
  const R = 6371;
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(y.lat - x.lat);
  const dLng = rad(y.lng - x.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(x.lat)) * Math.cos(rad(y.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 念给人听的那一版。一公里以内改用米，免得出现「0.3 公里」这种说法。 */
export function distanceText(km) {
  if (km === null || km === undefined) return '';
  if (km < 1) return `${Math.round(km * 1000)} 米`;
  if (km < 10) return `${km.toFixed(1)} 公里`;
  return `${Math.round(km)} 公里`;
}

// ---- 存在会话上 ----

const EMPTY = { on: false, me: null, char: null };

export function stateOf(chat) {
  const s = chat?.share;
  if (!s) return { ...EMPTY };
  return {
    on: !!s.on,
    me: s.me ? clean(s.me) : null,
    char: s.char ? clean(s.char) : null,
  };
}

export const isOn = chat => stateOf(chat).on;

export function setOn(chatId, on) {
  const chat = chats.get(chatId);
  if (!chat) return;
  chats.update(chatId, { share: { ...stateOf(chat), on: !!on } });
}

/** side 是 'me' 或 'char'。传 null 表示这一端不填了。 */
export function setSpot(chatId, side, spot) {
  const chat = chats.get(chatId);
  if (!chat || (side !== 'me' && side !== 'char')) return;
  chats.update(chatId, { share: { ...stateOf(chat), [side]: spot ? clean(spot) : null } });
}

/** 浏览器的真实定位。取不到就抛 —— 不要悄悄退回一个编的坐标。 */
export function locate() {
  return new Promise((res, rej) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      rej(new Error('这个浏览器不支持定位')); return;
    }
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: Math.round(p.coords.latitude * 1e4) / 1e4,
        lng: Math.round(p.coords.longitude * 1e4) / 1e4 }),
      e => rej(new Error(e.code === 1 ? '定位权限被拒绝' : '定位失败')),
      { timeout: 10000, maximumAge: 60000 },
    );
  });
}

/** 给注入块和界面用的那一份。没开、或者哪一端没填，都返回 null。 */
export function summary(chatId) {
  const chat = chats.get(chatId);
  const s = stateOf(chat);
  if (!s.on || !s.me || !s.char) return null;
  const km = distance(s.me, s.char);
  return {
    me: s.me, char: s.char,
    km, text: distanceText(km),
    charName: characters.get((chat.characterIds || [])[0])?.name || '对方',
  };
}

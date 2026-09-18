import { settings } from './db/index.js';

// 时间感知。两件事：现在几点（可以是虚拟的），以及双方各在哪个时区。
//
// 光在 system prompt 里写一句「现在是下午三点」，模型常常视而不见。
// 真正管用的是让它每条回复先自己写一行当地时间 —— 写过一遍才算真看见。
// 那一行显示时过滤掉（见 ai/reply.js），但留在上下文里，
// 于是历史本身就是一条时间线。

export const LOCAL = 'local';

// 按用得上的概率排，不求全。要别的直接填 IANA 名。
export const ZONES = [
  { id: LOCAL, label: '跟随本设备' },
  { id: 'Asia/Shanghai', label: '中国 · 北京、上海' },
  { id: 'Asia/Hong_Kong', label: '中国香港' },
  { id: 'Asia/Taipei', label: '中国台北' },
  { id: 'Asia/Tokyo', label: '日本 · 东京' },
  { id: 'Asia/Seoul', label: '韩国 · 首尔' },
  { id: 'Asia/Singapore', label: '新加坡' },
  { id: 'Asia/Bangkok', label: '泰国 · 曼谷' },
  { id: 'Asia/Kolkata', label: '印度 · 新德里' },
  { id: 'Asia/Dubai', label: '阿联酋 · 迪拜' },
  { id: 'Europe/Moscow', label: '俄罗斯 · 莫斯科' },
  { id: 'Europe/Istanbul', label: '土耳其 · 伊斯坦布尔' },
  { id: 'Europe/Berlin', label: '德国 · 柏林' },
  { id: 'Europe/Paris', label: '法国 · 巴黎' },
  { id: 'Europe/Rome', label: '意大利 · 罗马' },
  { id: 'Europe/Madrid', label: '西班牙 · 马德里' },
  { id: 'Europe/London', label: '英国 · 伦敦' },
  { id: 'America/New_York', label: '美国 · 纽约' },
  { id: 'America/Chicago', label: '美国 · 芝加哥' },
  { id: 'America/Denver', label: '美国 · 丹佛' },
  { id: 'America/Los_Angeles', label: '美国 · 洛杉矶' },
  { id: 'America/Toronto', label: '加拿大 · 多伦多' },
  { id: 'America/Vancouver', label: '加拿大 · 温哥华' },
  { id: 'America/Mexico_City', label: '墨西哥 · 墨西哥城' },
  { id: 'America/Sao_Paulo', label: '巴西 · 圣保罗' },
  { id: 'Australia/Sydney', label: '澳大利亚 · 悉尼' },
  { id: 'Pacific/Auckland', label: '新西兰 · 奥克兰' },
  { id: 'Africa/Cairo', label: '埃及 · 开罗' },
  { id: 'Africa/Johannesburg', label: '南非 · 约翰内斯堡' },
];

const known = id => ZONES.find(z => z.id === id);

// Intl 里「跟设备一样」就是不传 timeZone
const tz = id => (!id || id === LOCAL ? undefined : id);

// 跟随设备时要把真实时区解出来再说。写「本地」等于什么都没说 ——
// 模型不知道「本地」在哪儿，也就没法判断那个点对方在干什么。
export function resolveZone(id) {
  if (id && id !== LOCAL) return id;
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
}

export function zoneLabel(id) {
  const real = resolveZone(id);
  if (!real) return '未设定的时区';
  return known(real)?.label || real;
}

export function enabled() { return settings.get().injectTime !== false; }
export function stampOn() { const s = settings.get(); return enabled() && s.timeStamp !== false; }

// 虚拟时间：记下「设定的那一刻」和「设定时的真实时刻」，两者之差就是偏移。
// 这样时间会自己往下走，不是钉死在一个点上 —— 除非明确要求停住。
export function offset() {
  const s = settings.get();
  if (s.timeMode !== 'virtual' || !s.timeVirtualAt) return 0;
  return s.timeVirtualAt - (s.timeSetAt || s.timeVirtualAt);
}

export function isVirtual() {
  const s = settings.get();
  return s.timeMode === 'virtual' && !!s.timeVirtualAt;
}

export function now() {
  const s = settings.get();
  if (isVirtual() && s.timeFrozen) return new Date(s.timeVirtualAt);
  return new Date(Date.now() + offset());
}

// 真实时刻换算成「世界时刻」。历史消息的 createdAt 要过这一道。
export function toWorld(realMs) { return new Date(realMs + offset()); }

export function partsOf(date, zoneId) {
  const f = new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz(zoneId),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  });
  const out = {};
  for (const p of f.formatToParts(date)) out[p.type] = p.value;
  return out;
}

// 2026-09-17 周三 14:30
export function format(date, zoneId) {
  const p = partsOf(date, zoneId);
  return `${p.year}-${p.month}-${p.day} ${p.weekday} ${p.hour}:${p.minute}`;
}

export function clockOnly(date, zoneId) {
  const p = partsOf(date, zoneId);
  return `${p.hour}:${p.minute}`;
}

// 某时区在这一刻与 UTC 差多少分钟。把「墙上时间」当成 UTC 反推回去，
// 夏令时也就跟着对了 —— 不用自己维护一张换算表。
function utcOffset(date, zoneId) {
  const p = partsOf(date, zoneId);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((wall - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

// a 比 b 快多少分钟。正数表示 a 那边的钟走在前面。
export function zoneDiff(a, b, date = now()) {
  // 先解析再比：一边填「跟随设备」、一边显式填了同一个时区时，
  // 按 id 比会当成两个不同的地方，凭空多出一句时差
  if (resolveZone(a) === resolveZone(b)) return 0;
  return utcOffset(date, a) - utcOffset(date, b);
}

export function diffText(minutes) {
  const n = Math.abs(minutes);
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return `${m} minutes`;
  return m ? `${h} hours ${m} minutes` : `${h} hours`;
}

export function userZone() { return settings.get().timeZoneUser || LOCAL; }

// 角色没单独设就跟你同一个时区 —— 绝大多数情况本来就是同城
export function charZone(char) { return (char && char.timezone) || userZone(); }

/**
 * 距上次说话多久。
 *
 * 要量的是**上一轮结束到现在**，不是「最后一条消息到现在」——
 * 最后一条往往就是用户刚刚发出的这一条，那样算出来永远是「刚刚」，
 * 哪怕两个人三天没说过话。
 */
export function gapText(sinceMs) {
  const min = Math.floor((Date.now() - sinceMs) / 60000);
  if (min < 5) return 'The two of you are mid-conversation.';
  if (min < 60) return `${min} minutes have passed since either of you last spoke.`;
  if (min < 1440) return `${Math.floor(min / 60)} hours have passed since either of you last spoke.`;
  return `${Math.floor(min / 1440)} days have passed since either of you last spoke.`;
}

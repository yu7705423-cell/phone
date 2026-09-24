import * as svc from './ai/services.js';

// 和风天气。角色当天的天气，按角色卡上的「所在地区」查。
//
// **天气是事实，不是设定。** 和距离、金额一样，数字不让模型编 —— 它说「成都今天
// 二十度」是凭印象，这里给的是那座城市当天真的预报。排日程时写进去，聊天时
// 「你今天」那一段也带着（context/day.js）。
//
// 查的是「所在地区」这个城市名，不是 IP：和风只认城市名、经纬度或它自己的城市 id，
// 而角色本来就没有一个真的 IP。城市名第一次查到的 id 记在配置里，以后直接用。
//
// 接口（2026 起）：每个账号一个专属的 API Host，密钥放在请求头 X-QW-Api-Key。
// 旧的公共域名 devapi / api.qweather.com 在逐步停用，所以地址必须由用户自己填。

const TIMEOUT = 10000;

/** 「abc123.re.qweatherapi.com」「https://abc123.re.qweatherapi.com/」都认 */
export function hostOf(raw) {
  const h = String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return h ? `https://${h}` : '';
}

// 和风的错误有两种形状：老的 { code: '401' }，新的 HTTP 状态码加 { error: { title, detail } }
const WHY = {
  204: '没有这个地区的数据', 400: '请求参数有误', 401: '密钥不对，或者 API Host 与密钥不属于同一个账号',
  402: '额度已用完或账号欠费', 403: '没有权限，可能是密钥限制了来源或接口', 404: '没有这个地区',
  429: '请求太频繁', 500: '和风天气那边出错了',
};

async function api(path, params) {
  const cfg = svc.qweatherConfig();
  const base = hostOf(cfg.host);
  if (!base || !cfg.key) throw new Error('尚未填写和风天气的 API Host 与 API KEY');
  const url = `${base}${path}?${new URLSearchParams({ lang: 'zh', ...params })}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  let res;
  try {
    res = await fetch(url, { headers: { 'X-QW-Api-Key': cfg.key }, signal: ctl.signal });
  } catch (err) {
    throw new Error(ctl.signal.aborted ? '和风天气超过 10 秒没有回复'
      : `连不上和风天气（${err.message || err}），请检查 API Host 是否填对`);
  } finally { clearTimeout(t); }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new Error(e?.detail || e?.title || WHY[res.status] || `HTTP ${res.status}`);
  }
  if (body?.code && body.code !== '200') throw new Error(WHY[Number(body.code)] || `和风天气返回 ${body.code}`);
  return body || {};
}

/** 城市名对应到和风的城市。查到一次就记住 */
export async function lookup(name) {
  const key = String(name || '').trim();
  if (!key) return null;
  const cities = svc.qweatherConfig().cities || {};
  if (cities[key]) return cities[key];
  const r = await api('/geo/v2/city/lookup', { location: key, number: '1' });
  const c = (r.location || [])[0];
  if (!c) throw new Error(`没有找到「${key}」这个地区`);
  const city = { id: c.id, name: c.name, adm1: c.adm1 || '', country: c.country || '', tz: c.tz || '' };
  svc.setQweather({ cities: { ...(svc.qweatherConfig().cities || {}), [key]: city } });
  return city;
}

/**
 * 某个城市某一天的预报。date 写成 2026-09-24（角色那边的日期）；
 * 三天预报里对不上就取第一天 —— 时区差出一天时，第一天就是它的「今天」
 */
export async function forecast(name, date = '') {
  const city = await lookup(name);
  const r = await api('/v7/weather/3d', { location: city.id });
  const days = r.daily || [];
  const d = days.find(x => x.fxDate === date) || days[0];
  if (!d) throw new Error('和风天气没有给出预报');
  return {
    city: city.name, adm1: city.adm1, date: d.fxDate,
    textDay: d.textDay || '', textNight: d.textNight || '',
    tempMin: Number(d.tempMin), tempMax: Number(d.tempMax),
    humidity: d.humidity ? Number(d.humidity) : null,
    precip: d.precip ? Number(d.precip) : null,
    windDir: d.windDirDay || '', windScale: d.windScaleDay || '',
    uv: d.uvIndex ? Number(d.uvIndex) : null,
    at: Date.now(),
  };
}

export const ready = () => svc.qweatherReady();

/** 这个角色当天的天气。没配、没填所在地区就是 null；查不到也是 null，不拦着日程 */
export async function forChar(char, date) {
  const region = String(char?.region || '').trim();
  if (!ready() || !region) return null;
  try { return await forecast(region, date); }
  catch (err) { console.warn('[weather] 没查到:', err.message || err); return null; }
}

/** 给人看的一行：成都 小雨转阴 18~24°C */
export function label(w) {
  if (!w) return '';
  const text = w.textDay === w.textNight || !w.textNight ? w.textDay : `${w.textDay}转${w.textNight}`;
  return `${w.city} ${text} ${w.tempMin}~${w.tempMax}°C`;
}

/**
 * 进 prompt 的那一句。说明是英文（CLAUDE.md 第 14 条），城市名与天气现象是和风给的数据，原样放。
 * 只陈述预报，不写「所以该带伞」这类判断（第 16 条）
 */
export function promptLine(w) {
  if (!w) return '';
  const bits = [`${w.textDay} by day`];
  if (w.textNight && w.textNight !== w.textDay) bits.push(`${w.textNight} at night`);
  bits.push(`${w.tempMin} to ${w.tempMax}°C`);
  if (w.humidity != null) bits.push(`humidity ${w.humidity}%`);
  if (w.precip) bits.push(`precipitation ${w.precip} mm`);
  if (w.windDir) bits.push(`wind ${w.windDir}${w.windScale ? ` force ${w.windScale}` : ''}`);
  if (w.uv != null) bits.push(`UV index ${w.uv}`);
  return `Weather forecast for ${w.city} today (${w.date}): ${bits.join(', ')}.`;
}

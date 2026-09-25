// 衣帽间里要调接口的几样：识图、按描述生图、按角色设定生成一批 —— **都是用户点了才调**，
// 按钮上写着要调几次（第 13、15 条）。见 ARCHITECTURE 4.213、4.214。
// 另有一样是每天自动的：角色今天穿什么、带什么（开关在角色的衣帽间页，默认关，4.237）
import { closet, characters } from '../../db/index.js';
import { template, fillTemplate } from '../templates.js';
import { ask, isVisionReady } from '../vision.js';
import { parseJSON } from '../sse.js';
import { generate, isImageReady } from '../image.js';
import { images } from '../../db/images.js';
import { toDataUrl } from '../../audio.js';
import { subsOf, setImage, itemsOf, isOutfit, create, garmentOnly, live, isCarry, today, wear, wornToday } from '../../closet.js';
import { GROUPS, COLORS, SEASONS, OCCASIONS, groupOf } from '../../closet-kinds.js';
import { runJSONTask } from '../engine.js';
import * as clock from '../../time.js';
import * as dayStore from '../../day.js';
import * as weatherApi from '../../weather.js';
import * as daily from '../daily.js';

export { isVisionReady, isImageReady };

// 分类表摆给识图模型看。名字是数据，原样给
const groupLines = (side = '') => GROUPS.filter(g => !side || g.side === side).map(g =>
  `${g.id}: ${g.label} — ${subsOf(g.id).map(s => s.label).join(' / ')}`).join('\n');
const idList = list => list.map(x => `${x.id} (${x.label})`).join(', ');

const pick = (ids, list) => (Array.isArray(ids) ? ids : [])
  .map(String).filter(id => list.some(x => x.id === id));

/**
 * 看一件东西的照片，填上分类、颜色、季节、场合、名字与描述。
 * **只填空着的**：用户自己写过的名字、描述、选过的分类不动
 */
export async function recognize(id) {
  const row = closet.get(id);
  if (!row) throw new Error('这件东西已经不在了');
  if (!row.imageId) throw new Error('这件东西还没有图片');
  if (!isVisionReady()) throw new Error('尚未配置识图接口，可在「设置 - 识图」中填写');
  const blob = await images.blob(row.imageId);
  if (!blob) throw new Error('图片已不存在');
  const prompt = fillTemplate(template('task.closet-vision'), {
    groups: groupLines(), colors: idList(COLORS), seasons: idList(SEASONS), occasions: idList(OCCASIONS),
  });
  const raw = await ask({ dataUrl: await toDataUrl(blob), prompt, key: `closet-vision:${id}`, maxTokens: 500 });
  const j = parseJSON(raw);
  if (!j) throw new Error('识图接口返回的内容读不出来');

  const g = groupOf(String(j.group || ''));
  const cur = closet.get(id) || row;
  const patch = {};
  if (!cur.group && g) {
    patch.group = g.id;
    patch.side = g.side;
    const sub = subsOf(g.id).find(s => s.label === String(j.sub || '').trim());
    if (sub) patch.sub = sub.label;
  }
  const name = String(j.name || '').trim().slice(0, 40);
  if (name && (!cur.name || cur.name === '未命名')) patch.name = name;
  // 照片常是模特穿着的：提到人的句子不存（ARCHITECTURE 4.215）
  const desc = garmentOnly(j.desc);
  if (desc && !cur.desc) patch.desc = desc.slice(0, 300);
  if (!(cur.colors || []).length) patch.colors = pick(j.colors, COLORS);
  if (!(cur.seasons || []).length) patch.seasons = pick(j.seasons, SEASONS);
  if (!(cur.occasions || []).length) patch.occasions = pick(j.occasions, OCCASIONS);
  const shade = String(j.shade || '').trim();
  if (shade && !cur.shade) patch.shade = shade.slice(0, 30);
  // 改分类要走 closet.update，妆台那几样默认值跟着换 —— 这里直接写，省一层 import 成环
  return closet.update(id, patch);
}

/** 一件一件识。一件失败不拦后面的；每识完一件回调一次，界面好一条一条亮 */
export async function recognizeMany(ids, onEach) {
  const failed = [];
  let done = 0;
  for (const id of ids) {
    try { await recognize(id); done += 1; }
    catch (err) { failed.push({ id, error: String(err.message || err) }); }
    onEach?.({ done, failed: failed.length, total: ids.length });
  }
  return { done, failed };
}

/** 按描述画一张。没有描述就拿名字和小类凑一句 */
export async function draw(id) {
  const row = closet.get(id);
  if (!row) throw new Error('这件东西已经不在了');
  if (!isImageReady()) throw new Error('尚未配置生图接口，可在「设置 - 生图」中填写');
  const what = String(row.desc || '').trim()
    || [row.name, row.sub, row.shade].filter(Boolean).join(', ');
  if (!what) throw new Error('先写一句描述再生成');
  const prompt = fillTemplate(template('task.closet-image'), { desc: what });
  const blob = await generate({ prompt, key: `closet-img:${id}` });
  await setImage(id, new File([blob], 'item.png', { type: blob.type || 'image/png' }));
  return closet.get(id);
}

// ---- 按角色设定生成一批（第 6 条的例外：结果先列出来看一眼再决定存不存） ----

const str = v => String(v ?? '').trim();
const norm = s => str(s).replace(/\s+/g, '').toLowerCase();

/**
 * 按角色设定生成该角色衣帽间里的一批东西。**一次调用**，只有文字；要图再逐件点「生成图片」。
 * count 由用户填，不设上限（第 13 条）。已经有的同名的不再给
 */
export async function wardrobe(charId, { count = 20, side = 'wear' } = {}) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const n = Math.max(1, Math.round(Number(count)) || 0);
  const have = itemsOf(charId).filter(r => !isOutfit(r) && r.side === side);
  const out = await runJSONTask('closet.wardrobe', {
    system: fillTemplate(template('task.closet-wardrobe'), {
      charName: char.name || '该角色',
      charPersona: [char.persona, char.appearance, char.signature].filter(Boolean).join('\n\n')
        || '（角色卡里还没有写人设）',
      count: n,
      sideName: side === 'beauty' ? 'dressing table (skincare, makeup, fragrance, tools)' : 'clothing and accessories',
      existing: have.map(r => `- ${r.name}`).join('\n') || '（还是空的）',
      groups: groupLines(side), colors: idList(COLORS), seasons: idList(SEASONS), occasions: idList(OCCASIONS),
    }),
    key: `closet-wardrobe:${charId}:${Date.now()}`,
    maxTokens: 300 + n * 110,
  });
  const seen = new Set(have.map(r => norm(r.name)));
  const rows = Array.isArray(out?.items) ? out.items : [];
  return rows.map(x => {
    const g = groupOf(str(x?.group));
    if (!g || g.side !== side) return null;
    const sub = subsOf(g.id).find(s => s.label === str(x?.sub));
    const name = str(x?.name).slice(0, 40);
    if (!name || seen.has(norm(name))) return null;
    seen.add(norm(name));
    return {
      group: g.id, side: g.side, sub: sub ? sub.label : '', name,
      desc: garmentOnly(x?.desc).slice(0, 300), shade: side === 'beauty' ? str(x?.shade).slice(0, 30) : '',
      colors: pick(x?.colors, COLORS),
      seasons: side === 'wear' ? pick(x?.seasons, SEASONS) : [],
      occasions: side === 'wear' ? pick(x?.occasions, OCCASIONS) : [],
    };
  }).filter(Boolean);
}

/** 勾选的那几件放进该角色的衣帽间。返回放进去的 */
export const keepWardrobe = (charId, rows) => rows.map(r => create({ ...r, owner: charId }));

// ---- 每天自动：今天穿什么、带什么（ARCHITECTURE 4.237）----
//
// 开关挂在角色身上（char.closetDaily），在衣帽间里那个角色的页面上（第 5 条）。
// 每天一次模型调用，默认关，登记在 cost.js（第 15 条）。接口可以在「任务用哪套接口」里单独选。
//
// **只从这个角色衣帽间里已有的东西里挑**，不另造新衣服：挑出来的就勾成「今天穿着」「今天带着」，
// 和手动勾的是同一件事，prompt 里「今天穿着」那一段照旧读它。
//
// 和身体状态、当日日程同一个规矩：**一天只试一次，失败也算试过**（closetDailyAt 记着日期），
// 不然失败之后每发一条消息都再试一次；**今天已经穿着东西的不碰** —— 手动勾的、剧情里换上的，
// 都不能被自动的盖掉。

const dailyBusy = new Set();

export const isDaily = char => !!(char && char.closetDaily === true);

const line = r => `${r.id} | ${[groupOf(r.group)?.label, r.sub].filter(Boolean).join(' / ')} | ${r.name}`
  + `${(r.seasons || []).length ? ` | ${r.seasons.map(x => SEASONS.find(y => y.id === x)?.label || x).join('、')}` : ''}`
  + `${(r.occasions || []).length ? ` | ${r.occasions.map(x => OCCASIONS.find(y => y.id === x)?.label || x).join('、')}` : ''}`;

// 当天气温落在哪几个季节。宁宽勿窄：只用来把明显不合季节的衣物拿掉，
// 没标季节的衣物一律留着（不知道就不替它判断）
function seasonsFor(w) {
  if (!w || !Number.isFinite(w.tempMin) || !Number.isFinite(w.tempMax)) return null;
  const mid = (w.tempMin + w.tempMax) / 2;
  const out = new Set();
  if (w.tempMax >= 26 || mid >= 22) out.add('summer');
  if (mid >= 8 && mid <= 25) { out.add('spring'); out.add('autumn'); }
  if (w.tempMin <= 10 || mid <= 12) out.add('winter');
  return out;
}

/** 挑一次，勾上。回来的是勾上了几件 */
export async function pickToday(charId) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const owned = itemsOf(charId).filter(r => live(r) && !isOutfit(r) && r.side === 'wear' && !(r.lent && r.lent.to));
  if (!owned.length) throw new Error('该角色的衣帽间里还没有衣物或随身物品');
  // 日期按角色那边的时区算（和日程、天气同一个「今天」）
  const p = clock.partsOf(clock.now(), clock.charZone(char));
  const date = `${p.year}-${p.month}-${p.day}`;
  // 天气：配了和风天气、角色填了所在地区才有。今天的日程已经查过就用那一份，不再查一次
  const w = dayStore.get(charId, date)?.weather || await weatherApi.forChar(char, date);
  // 用户要求严格按天气：标了季节、又不合今天气温的衣物，**不交给模型**，模型选回来也不认。
  // 随身物品不看季节。全被拿掉时照原样全给（宁可让模型按预报挑，也不让角色今天什么都不穿）
  const fit = seasonsFor(w);
  const suits = r => isCarry(r) || !fit || !(r.seasons || []).length || r.seasons.some(x => fit.has(x));
  const kept = owned.filter(suits);
  const all = kept.some(r => !isCarry(r)) || !owned.some(r => !isCarry(r)) ? kept : owned;
  const clothes = all.filter(r => !isCarry(r));
  const carry = all.filter(isCarry);
  const out = await runJSONTask('closet.daily', {
    system: fillTemplate(template('task.closet-daily'), {
      charName: char.name || '该角色',
      charPersona: [char.persona, char.appearance].filter(Boolean).join('\n\n') || '（角色卡里还没有写人设）',
      date,
      weekday: '日一二三四五六'[new Date(`${date}T12:00:00`).getDay()],
      weather: w ? fillTemplate(template('task.closet-daily-weather'), { forecast: weatherApi.promptLine(w) }) : '',
      clothes: clothes.map(line).join('\n') || '（没有）',
      carry: carry.map(line).join('\n') || '（没有）',
    }),
    key: `closet-daily:${charId}:${today()}`,
    maxTokens: 400,
  });
  const ids = new Set(all.map(r => r.id));
  const chosen = [...(Array.isArray(out?.wear) ? out.wear : []), ...(Array.isArray(out?.carry) ? out.carry : [])]
    .map(String).filter(id => ids.has(id));
  if (!chosen.length) throw new Error('模型没有从衣帽间里选出任何一件');
  chosen.forEach(id => wear(id, true));
  return chosen.length;
}

/** 开了、今天还没试过、今天还什么都没穿：挑一次。不抛错，错误记在角色身上 */
export async function ensureDaily(charId) {
  const char = characters.get(charId);
  if (!isDaily(char) || dailyBusy.has(charId)) return null;
  const d = today();
  if (char.closetDailyAt === d) return null;
  if (wornToday(charId).length) return null;
  // 今天已经自动试过（别的页面试的、开关关了又开）：不再试，等明天
  if (!daily.claim('closet', charId, d)) return null;
  dailyBusy.add(charId);
  characters.update(charId, { closetDailyAt: d, closetDailyError: '' });
  try {
    return await pickToday(charId);
  } catch (err) {
    characters.update(charId, { closetDailyError: String(err.message || err) });
    console.warn('[closet] 今天的穿搭没自动生成:', err.message || err);
    return null;
  } finally {
    dailyBusy.delete(charId);
  }
}

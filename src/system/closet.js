// 衣帽间：衣橱与妆台里的每一件东西。见 ARCHITECTURE 4.213
//
// 一件东西一行，存在 closet 域，按 owner 建索引：'me' 是自己（另记 personaId，
// 各个身份各有各的衣帽间），角色的就是角色 id。分类表在 closet-kinds.js。
//
// 全程不调接口：余量、保质期、今天穿的都是本地算的。识图与按描述生图是用户点了
// 才调的那两样，在 ai/tasks/closet.js。
import { closet, settings, characters, chats, images, messages as messagesDb } from './db/index.js';
import { PHOTO_MAX } from './db/images.js';
import * as accounts from './accounts.js';
import * as clock from './time.js';
import { dateKey } from './health.js';
import {
  GROUPS, DOSE, SHELF_MONTHS, GONE_STATES, groupOf,
} from './closet-kinds.js';

export const ME = 'me';
const DAY = 86400000;

// ---- 分类：内置的加上用户自己加的小类，减去隐藏的大类 ----

/** 这个大类下的小类。用户在衣帽间设置里加的排在内置的后面 */
export function subsOf(groupId) {
  const g = groupOf(groupId);
  if (!g) return [];
  const extra = (settings.get().closetSubs || {})[groupId] || [];
  const have = new Set(g.subs.map(s => s.label));
  return [...g.subs, ...extra.filter(l => l && !have.has(l)).map(label => ({ label, custom: true }))];
}
export const subMeta = (groupId, sub) => subsOf(groupId).find(s => s.label === sub) || {};

export function addSub(groupId, label) {
  const l = String(label || '').trim().slice(0, 12);
  if (!l || !groupOf(groupId)) return false;
  const all = { ...(settings.get().closetSubs || {}) };
  const cur = all[groupId] || [];
  if (subsOf(groupId).some(s => s.label === l)) return false;
  settings.set({ closetSubs: { ...all, [groupId]: [...cur, l] } });
  return true;
}
export function dropSub(groupId, label) {
  const all = { ...(settings.get().closetSubs || {}) };
  settings.set({ closetSubs: { ...all, [groupId]: (all[groupId] || []).filter(l => l !== label) } });
}

export const hiddenGroups = () => new Set(settings.get().closetHidden || []);
export function setGroupHidden(groupId, hide) {
  const set = hiddenGroups();
  if (hide) set.add(groupId); else set.delete(groupId);
  settings.set({ closetHidden: [...set] });
}
export const groupsOf = side => GROUPS.filter(g => g.side === side && !hiddenGroups().has(g.id));

// ---- 谁的 ----

/** 自己那一份：当前身份的，以及没记身份的老数据 */
const isMine = (row, personaId) => row.owner === ME && (!row.personaId || row.personaId === personaId);

/** 这个主人的全部。owner 是 'me' 或角色 id；自己的按身份分开 */
export function itemsOf(owner, personaId = accounts.currentId()) {
  return owner === ME
    ? closet.byIndex(ME).filter(r => isMine(r, personaId))
    : closet.byIndex(owner).slice();
}

/** 还在的：已用完、已送出的不算。清单、今天穿的、告诉角色的都只看这些 */
export const live = row => !GONE_STATES.has(row.state || '');

// ---- 增删改 ----

export function create(fields = {}) {
  const owner = fields.owner || ME;
  const g = groupOf(fields.group);
  const side = fields.side || g?.side || 'wear';
  const meta = g && fields.sub ? subMeta(g.id, fields.sub) : {};
  return closet.create({
    owner, personaId: owner === ME ? (fields.personaId || accounts.currentId() || '') : '',
    side, group: g ? g.id : '', sub: fields.sub || '',
    name: String(fields.name || '').trim().slice(0, 40) || '未命名',
    desc: fields.desc || '', imageId: fields.imageId || null,
    colors: fields.colors || [], seasons: fields.seasons || [], occasions: fields.occasions || [],
    source: fields.source || 'self', giver: fields.giver || '', with: fields.with || '',
    giftMsgId: fields.giftMsgId || '', giftChatId: fields.giftChatId || '', giftAt: fields.giftAt || 0,
    note: fields.note || '', state: fields.state || '',
    wornOn: '', wornCount: 0, lastWorn: 0,
    // 妆台
    shade: fields.shade || '',
    capacity: fields.capacity || 0, capUnit: fields.capUnit || '毫升',
    dose: fields.dose ?? (meta.dose || 0), doseUnit: fields.doseUnit || meta.unit || '',
    perDay: fields.perDay || 0, mlPer: 0, level: null,
    buyAt: fields.buyAt || '', openedAt: fields.openedAt || '', expireAt: fields.expireAt || '',
    pao: fields.pao ?? (meta.pao || 0), shelf: fields.shelf || 0,
    alertAt: 0, auto: fields.auto === true,
    createdAt: Date.now(),
  });
}

/** 改分类时，妆台那几样默认值跟着换成新小类的（用户自己填过的不动） */
export function update(id, patch) {
  const cur = closet.get(id);
  if (!cur) return null;
  // 动过一次就算我收下的了，重新生成那一轮也不撤（dropAutoGift）
  const next = { ...patch, auto: false };
  if ((patch.group && patch.group !== cur.group) || (patch.sub && patch.sub !== cur.sub)) {
    const g = groupOf(patch.group || cur.group);
    if (g) next.side = g.side;
    const meta = g ? subMeta(g.id, patch.sub ?? cur.sub) : {};
    if (!cur.doseUnit && meta.unit) { next.doseUnit = meta.unit; if (!cur.dose) next.dose = meta.dose || 0; }
    if (!cur.pao && meta.pao) next.pao = meta.pao;
  }
  return closet.update(id, next);
}

export function remove(id) {
  const row = closet.get(id);
  if (!row) return false;
  closet.remove(id);
  if (row.imageId) images.remove(row.imageId);
  return true;
}

/** 换这一件的图。旧的那张删掉 */
export async function setImage(id, file) {
  const row = closet.get(id);
  if (!row) return null;
  const img = await images.put(file, PHOTO_MAX);
  closet.update(id, { imageId: img });
  if (row.imageId && row.imageId !== img) images.remove(row.imageId);
  return img;
}

/** 一次放进好几张图：每张一件，先不分类（落在「未整理」），分类交给识图或手动 */
export async function addPhotos(files, { owner = ME, side = 'wear', group = '', sub = '' } = {}) {
  const out = [];
  for (const f of files) {
    const imageId = await images.put(f, PHOTO_MAX);
    out.push(create({ owner, side, group, sub, imageId, name: '' }));
  }
  return out;
}

// ---- 今天穿的 ----

export const today = () => dateKey(clock.now());

/** 今天穿着（戴着）的那几件 */
export const wornToday = (owner, personaId) =>
  itemsOf(owner, personaId).filter(r => r.side === 'wear' && r.wornOn === today() && live(r));

/**
 * 今天穿 / 不穿了。第一次勾上的那天穿过次数加一；当天又取消就减回去，
 * 不然来回勾两下就多记一次
 */
export function wear(id, on = true) {
  const r = closet.get(id);
  if (!r) return;
  const d = today();
  if (on) {
    if (r.wornOn === d) return;
    closet.update(id, { wornOn: d, wornCount: (r.wornCount || 0) + 1, lastWorn: clock.now() });
  } else if (r.wornOn === d) {
    closet.update(id, { wornOn: '', wornCount: Math.max(0, (r.wornCount || 0) - 1) });
  }
}

// ---- 余量与保质期（只对妆台） ----

const toMs = key => {
  if (!key) return 0;
  const [y, m, d] = String(key).split('-').map(Number);
  return y ? new Date(y, (m || 1) - 1, d || 1).getTime() : 0;
};
const addMonths = (ms, n) => { const d = new Date(ms); d.setMonth(d.getMonth() + n); return d.getTime(); };

/** 每次用多少（毫升或克）。单品页上填了换算就用填的 */
export function perUse(r) {
  const dose = Number(r.dose) || 0;
  if (!dose) return 0;
  const k = Number(r.mlPer) > 0 ? Number(r.mlPer) : (DOSE[r.doseUnit] ?? 1);
  return dose * k;
}

/**
 * 还剩多少。容量、每次用量、每天几次三样都填了才算；从开封那天（没有就购入那天、
 * 再没有就放进来那天）起按天扣。「按实际剩余校准」记一个 level，从那一刻重新扣。
 * 给 { pct, daysLeft }；算不了给 null
 */
export function remaining(r, now = clock.now()) {
  const cap = Number(r.capacity) || 0;
  const use = perUse(r) * (Number(r.perDay) || 0);
  if (r.side !== 'beauty' || !cap || !use) return null;
  const base = r.level && r.level.at
    ? r.level
    : { pct: 100, at: toMs(r.openedAt) || toMs(r.buyAt) || r.createdAt || now };
  const days = Math.max(0, (now - base.at) / DAY);
  const left = Math.max(0, cap * (Number(base.pct) || 0) / 100 - use * days);
  return { pct: Math.round(left / cap * 100), daysLeft: Math.floor(left / use) };
}

/** 按实际剩下的校准一次。pct 是现在大约还剩百分之几 */
export const calibrate = (id, pct) =>
  closet.update(id, { level: { pct: Math.max(0, Math.min(100, Math.round(Number(pct) || 0))), at: clock.now() } });

/**
 * 什么时候过期。三种依据，前面的有就用前面的：
 *   set     自己填了保质日期
 *   opened  开封日期 + 开封后可用几个月（pao）
 *   bought  购入日期 + 未开封保质期（shelf，没填按 SHELF_MONTHS）
 * 给 { at, basis, daysLeft }；一样都没有给 null
 */
export function expiry(r, now = clock.now()) {
  if (r.side !== 'beauty') return null;
  let at = 0;
  let basis = '';
  if (r.expireAt) { at = toMs(r.expireAt); basis = 'set'; }
  else if (r.openedAt && Number(r.pao) > 0) { at = addMonths(toMs(r.openedAt), Number(r.pao)); basis = 'opened'; }
  else if (r.buyAt && !r.openedAt) { at = addMonths(toMs(r.buyAt), Number(r.shelf) || SHELF_MONTHS); basis = 'bought'; }
  if (!at) return null;
  return { at, basis, daysLeft: Math.floor((at - now) / DAY) };
}

// 提醒的几道门，在衣帽间的设置里改
export const alertCfg = () => {
  const s = settings.get();
  return {
    lowPct: Number(s.closetLowPct ?? 15),
    lowDays: 14,
    expireDays: Number(s.closetExpireWarn ?? 30),
    cooldown: Number(s.closetAlertCooldown ?? 30),
  };
};

/** 这一件现在算不算快用完、快过期。给 { low, exp } 或 null */
export function flagsOf(r, now = clock.now()) {
  if (r.side !== 'beauty' || !live(r)) return null;
  const c = alertCfg();
  const rem = remaining(r, now);
  const exp = expiry(r, now);
  const low = !!rem && (rem.pct <= c.lowPct || rem.daysLeft <= c.lowDays);
  const soon = !!exp && exp.daysLeft <= c.expireDays;
  return low || soon ? { low: low ? rem : null, exp: soon ? exp : null } : null;
}

/** 妆台上快用完、快过期的那几件（界面上那一条用，不受冷却影响） */
export const alertsOf = (owner, personaId, now = clock.now()) =>
  itemsOf(owner, personaId).map(r => ({ item: r, f: flagsOf(r, now) })).filter(x => x.f);

/**
 * 这一轮要告诉角色的那几件。**低频是在这儿做的，不靠提示词去劝。**
 *
 * 一件东西满足条件之后，只在「第一次被递出去的那一天」递给角色；之后要等过了冷却期
 * （默认 30 天）才会再递一次。所以就算一个月都没聊到化妆，也最多出现一次，
 * 不会天天问「是不是快用完了」。递出去那一刻记在 alertAt 上。
 */
export function takeAlerts(personaId, now = clock.now()) {
  const c = alertCfg();
  const d = dateKey(now);
  const out = [];
  for (const { item, f } of alertsOf(ME, personaId, now)) {
    const shownToday = item.alertAt && dateKey(item.alertAt) === d;
    const cooled = !item.alertAt || now - item.alertAt >= c.cooldown * DAY;
    if (!shownToday && !cooled) continue;
    if (!shownToday) closet.update(item.id, { alertAt: now });
    out.push({ item, f });
  }
  return out;
}

// ---- 来源 ----

const nameOfWho = (id, fallback) =>
  (id === ME ? (accounts.current()?.name || '我') : (characters.get(id)?.name || fallback));

/** 来源那一句，给界面看。「阿岚送的 · 2026-08-29」 */
export function sourceText(r) {
  if (r.source === 'gift') {
    const who = r.giver ? `${nameOfWho(r.giver, '对方')}送的` : '收到的礼物';
    return r.giftAt ? `${who} · ${dateKey(r.giftAt)}` : who;
  }
  if (r.source === 'made') return r.with ? `和${nameOfWho(r.with, '对方')}一起做的` : '一起做的';
  return '';
}

// ---- 礼物联动 ----

/**
 * 从一条礼物消息里读出要放进衣帽间的那几样：归谁、叫什么、谁送的、哪天。
 * 角色送给我的归我，我送给角色的归角色。拆开了用里面的东西做名字
 */
export function fromGift(msg) {
  if (!msg || msg.kind !== 'gift') return null;
  const fromChar = msg.role === 'char';
  // 我送出去的那一件归这段会话里那一位（群里送礼物不会落到这里：礼物是一对一的能力）
  const to = (chats.get(msg.chatId)?.characterIds || [])[0] || '';
  if (!fromChar && !to) return null;
  return {
    owner: fromChar ? ME : to,
    name: String(msg.inner || msg.cover || '').slice(0, 40),
    source: 'gift', giver: fromChar ? msg.authorId : ME,
    giftMsgId: msg.id, giftChatId: msg.chatId, giftAt: msg.createdAt || clock.now(),
  };
}
/** 这条礼物已经收进衣帽间了吗（按消息 id 认） */
export const giftItem = msgId => closet.all().find(r => r.giftMsgId === msgId) || null;

// ---- 按名字猜分类（本地词表，不调接口） ----
//
// 小类名本身就是词（「耳饰」「口红」），另外补几个常见的叫法。认得出就给 { group, sub }，
// 认不出给 null。礼物自动收进角色衣帽间时靠它挡一道：「一盒糖」「一张纸条」认不出，就不收
const ALIASES = [
  ['耳环', 'jewelry', '耳饰'], ['耳钉', 'jewelry', '耳饰'], ['耳坠', 'jewelry', '耳饰'],
  ['手镯', 'jewelry', '手链 / 手镯'], ['手链', 'jewelry', '手链 / 手镯'], ['吊坠', 'jewelry', '项链'],
  ['发夹', 'acc', '发饰'], ['发卡', 'acc', '发饰'], ['发圈', 'acc', '发饰'], ['墨镜', 'acc', '眼镜'],
  ['毛衣', 'top', '针织 / 毛衣'], ['针织', 'top', '针织 / 毛衣'], ['T恤', 'top', 'T 恤'],
  ['吊带', 'top', '背心 / 吊带'], ['背心', 'top', '背心 / 吊带'], ['裙子', 'onepiece', '连衣裙'],
  ['裤', 'bottom', '长裤'], ['球鞋', 'shoes', '运动鞋'], ['高跟', 'shoes', '高跟鞋'], ['拖鞋', 'shoes', '凉拖'],
  ['包包', 'bag', '手提'], ['背包', 'bag', '双肩'], ['钱包', 'bag', '手拿'],
  ['唇膏', 'lip', '口红'], ['唇釉', 'lip', '唇釉'], ['面霜', 'skin', '乳霜'], ['粉底液', 'base', '粉底'],
  ['眼影盘', 'eye', '眼影'], ['香氛', 'scent', '香水'], ['化妆刷', 'tool', '刷具'],
  ['外套', 'outer', '夹克'], ['围巾', 'acc', '围巾'], ['帽', 'acc', '帽子'], ['手表', 'acc', '手表'],
  ['鞋', 'shoes', ''], ['包', 'bag', ''], ['裙', 'onepiece', '连衣裙'],
];
// 太泛的几个小类名单独出现时不认：「平底锅」不是鞋，「茶具套装」不是衣服
const LOOSE = new Set(['造型', '平底', '套装', '手提', '高光', '修容', '洗护', '贴身']);
export function guessKind(name) {
  const t = String(name || '');
  if (!t) return null;
  // 先认小类名：长的先认，「针织 / 毛衣」这种拆开认
  const subs = GROUPS.flatMap(g => subsOf(g.id).flatMap(s => s.label.split(' / ')
    .map(w => ({ w: w.replace(/\s+/g, ''), group: g.id, sub: s.label }))))
    .filter(x => x.w.length >= 2 && !LOOSE.has(x.w))
    .sort((a, b) => b.w.length - a.w.length);
  const hit = subs.find(x => t.replace(/\s+/g, '').includes(x.w));
  if (hit) return { group: hit.group, sub: hit.sub };
  const al = ALIASES.find(([w]) => t.includes(w));
  return al ? { group: al[1], sub: al[2] } : null;
}

/**
 * 我送的礼物，角色拆开收下了：认得出是衣帽间里的东西，就直接收进它的衣帽间，
 * 用不着我再去点。认不出（一盒糖、一张纸条）就不收；气泡上的「收进衣帽间」还在，想收可以手动点。
 * 自动收的记一个 auto，整轮重新生成把礼物退回待拆时一并撤掉（gift.unsettle）
 */
export function keepGift(msg) {
  if (!msg || msg.kind !== 'gift' || msg.role !== 'user' || giftItem(msg.id)) return null;
  const fields = fromGift(msg);
  if (!fields) return null;
  const kind = guessKind(fields.name) || guessKind(msg.cover);
  if (!kind) return null;
  return create({ ...fields, ...kind, auto: true });
}

/** 撤掉自动收进去的那一件。手动收的、改过的不动 */
export function dropAutoGift(msgId) {
  const row = giftItem(msgId);
  if (row && row.auto) remove(row.id);
}

// ---- 给角色看的清单 ----

/**
 * 一个主人的清单，按大类分行，每类最多 limit 件（0 为全部）。
 * 只写名字与少量标签，不写描述全文 —— 几十件的描述塞进去，这一段就压过了聊天本身
 */
export function listLines(owner, personaId, side, limit) {
  const rows = itemsOf(owner, personaId).filter(r => r.side === side && live(r) && r.group);
  const lines = [];
  for (const g of GROUPS.filter(x => x.side === side)) {
    const mine = rows.filter(r => r.group === g.id)
      .sort((a, b) => (b.lastWorn || b.createdAt || 0) - (a.lastWorn || a.createdAt || 0));
    if (!mine.length) continue;
    const shown = limit > 0 ? mine.slice(0, limit) : mine;
    const more = mine.length - shown.length;
    lines.push(`${g.label}: ${shown.map(r => r.name).join(', ')}${more > 0 ? ` (+${more} more)` : ''}`);
  }
  return lines;
}

// ---- 描述里只留东西本身（ARCHITECTURE 4.215） ----
//
// 存衣服的照片常常是模特穿着的。识图照理只写衣服，但描述里只要混进一句「长发模特」，
// 这一句跟着进了生图提示词，画出来的脸就可能是模特的，不是角色的。
// 所以凡是要拿描述去给别人读的地方（生图、给角色看的今天穿的），先把提到人的那几句去掉。
// 宁可多删一句，不能让别人的脸混进来
const PERSON = /模特|人台|假人|穿着者|试穿者|脸|面容|五官|长相|发型|长发|短发|卷发|肤色|身材|表情|姿势|\b(models?|mannequins?|wearer|faces?|hair|skin|pose[sd]?|posing)\b/i;
export const garmentOnly = desc => String(desc || '')
  .split(/(?<=[。！？；!?;\n]|\.\s)/)
  .filter(x => x.trim() && !PERSON.test(x))
  .join('').replace(/\s+/g, ' ').trim();

// ---- 套装（ARCHITECTURE 4.214） ----
//
// 一套就是几件单品的组合，和单品存在同一个域里，side 记作 'outfit'：
// 备份、删角色、角色包都跟着单品走，不用另登记一个域。单品那边的查询全按 side
// 筛（wear / beauty），套装自然不会混进去。items 存单品 id；单品删了，
// 套装里那一格读的时候跳过，不回头改套装
export const OUTFIT = 'outfit';
export const isOutfit = r => !!r && r.side === OUTFIT;

/** 这个主人的套装，新的在前 */
export const outfitsOf = (owner, personaId) => itemsOf(owner, personaId)
  .filter(isOutfit).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

/** 一套里还在的那几件 */
export const outfitItems = o => (o?.items || []).map(id => closet.get(id)).filter(r => r && !isOutfit(r));

/**
 * 存一套。by 是谁搭的：'me' 或角色 id（角色在会话里替你搭的那种）。
 * msgId 记着是哪一条搭配卡片，同一条卡片存过就直接打开那一套
 */
export function createOutfit(fields = {}) {
  const owner = fields.owner || ME;
  return closet.create({
    owner, personaId: owner === ME ? (fields.personaId || accounts.currentId() || '') : '',
    side: OUTFIT,
    name: String(fields.name || '').trim().slice(0, 40) || '未命名的一套',
    items: [...new Set((fields.items || []).filter(Boolean))],
    occasions: fields.occasions || [], seasons: fields.seasons || [], note: fields.note || '',
    by: fields.by || ME, fromMsgId: fields.fromMsgId || '', fromChatId: fields.fromChatId || '',
    wornOn: '', wornCount: 0, lastWorn: 0,
    createdAt: Date.now(),
  });
}

/** 今天穿的那几件存成一套 */
export function outfitFromToday(owner, name, personaId) {
  const rows = wornToday(owner, personaId);
  if (!rows.length) return null;
  return createOutfit({ owner, personaId, name, items: rows.map(r => r.id) });
}

/**
 * 今天穿这一套：今天穿着的换成这几件（不在这套里的取消），这一套穿过次数加一。
 * 妆台上的东西放进套装里可以，但「今天穿的」只管衣橱那一侧
 */
export function wearOutfit(id) {
  const o = closet.get(id);
  if (!isOutfit(o)) return;
  const d = today();
  const pid = o.owner === ME ? (o.personaId || undefined) : '';
  const want = new Set(outfitItems(o).filter(r => r.side === 'wear' && live(r)).map(r => r.id));
  for (const r of wornToday(o.owner, pid)) if (!want.has(r.id)) wear(r.id, false);
  want.forEach(x => wear(x, true));
  if (o.wornOn !== d) closet.update(id, { wornOn: d, wornCount: (o.wornCount || 0) + 1, lastWorn: clock.now() });
}

// ---- 会话里的搭配卡片 ----

/** 在聊穿搭吗。上下文带不带清单、搭配这项能力热不热，都按这一份词表认（本地，不花钱） */
export const WEAR_TOPIC = /穿|搭配|衣服|裙|裤|鞋|包包|外套|打扮|出门|约会|首饰|项链|耳环|耳饰|戒指|手链|帽子|围巾|outfit|wear|dress/i;

/** 我这边衣橱里有没有分好类的东西。一件都没有，角色就无从搭起 */
export const hasWardrobe = personaId =>
  itemsOf(ME, personaId).some(r => r.side === 'wear' && r.group && live(r));

const clean = s => String(s || '').replace(/\s+/g, '').toLowerCase();

/**
 * 按名字在这个主人的衣帽间里认出那几件。先认一模一样的，再认互相包含的；
 * 同一件不认两次。认不出的原样留着名字，卡片上画成灰的
 */
export function matchItems(owner, names, personaId) {
  const pool = itemsOf(owner, personaId).filter(r => !isOutfit(r) && live(r));
  const used = new Set();
  return (names || []).map(n => String(n || '').trim()).filter(Boolean).map(name => {
    const k = clean(name);
    const free = pool.filter(r => !used.has(r.id));
    const hit = free.find(r => clean(r.name) === k)
      || free.find(r => clean(r.name) && (k.includes(clean(r.name)) || clean(r.name).includes(k)));
    if (hit) used.add(hit.id);
    return { name, id: hit ? hit.id : '' };
  });
}

/** 卡片正文。方括号标记是协议（第 14 条），历史里角色读到的就是这一行 */
export const outfitText = (name, names) => `[搭配：${name ? `${name} | ` : ''}${names.join('、')}]`;

/** 「名字 | 甲、乙、丙」拆开。没写竖线就整段是单品 */
export function parseOutfit(body) {
  const t = String(body || '').trim();
  const i = t.search(/[|｜]/);
  const name = i < 0 ? '' : t.slice(0, i).trim();
  const names = (i < 0 ? t : t.slice(i + 1)).split(/[、,，;；/\n]+/).map(x => x.trim()).filter(Boolean);
  return names.length ? { name: name.slice(0, 40), names } : null;
}

/**
 * 在会话里落一张搭配卡片。角色写的，搭的是我衣帽间里的东西；
 * 我发的（在角色的衣帽间里替它挑了一套），搭的是它的。extra 带 turnId 之类，
 * 重新生成那一轮时跟着清掉
 */
export function postOutfit({ chatId, role, authorId, name = '', names = [], extra = {} }) {
  const chat = chats.get(chatId);
  if (!chat || !names.length) return null;
  const owner = role === 'user' ? ((chat.characterIds || [])[0] || '') : ME;
  if (!owner) return null;
  const items = matchItems(owner, names);
  const msg = messagesDb.create({
    ...extra, chatId, role, authorId, kind: 'outfit', status: 'done',
    outfitName: name, outfitOwner: owner, outfitItems: items,
    content: outfitText(name, items.map(x => x.name)),
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}

/** 在角色的衣帽间里替它挑好一套，发到和它的会话里 */
export function sendOutfit(id) {
  const o = closet.get(id);
  if (!isOutfit(o) || o.owner === ME) return null;
  const chat = chats.all()
    .filter(c => (c.characterIds || []).length === 1 && c.characterIds[0] === o.owner)
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))[0];
  if (!chat) throw new Error('还没有和该角色的会话');
  const names = outfitItems(o).map(r => r.name);
  if (!names.length) throw new Error('这一套里没有东西');
  return postOutfit({ chatId: chat.id, role: 'user', authorId: ME, name: o.name, names });
}

/** 这张卡片存过了吗 */
export const outfitOfMsg = msgId => closet.all().find(r => isOutfit(r) && r.fromMsgId === msgId) || null;

/** 卡片存成一套。存过就给存过的那一套；一件都没认出来就不存 */
export function keepOutfit(msg) {
  if (!msg || msg.kind !== 'outfit') return null;
  const had = outfitOfMsg(msg.id);
  if (had) return had;
  const items = (msg.outfitItems || []).map(x => x.id).filter(x => x && closet.get(x));
  if (!items.length) return null;
  return createOutfit({
    owner: msg.outfitOwner || ME, name: msg.outfitName || '', items,
    by: msg.role === 'char' ? msg.authorId : ME, fromMsgId: msg.id, fromChatId: msg.chatId,
  });
}

// ---- 好久没穿 ----

// 几道门，在衣帽间设置里改
export const idleCfg = () => {
  const s = settings.get();
  return { days: Math.max(0, Number(s.closetIdleDays ?? 60) || 0), gap: Math.max(0, Number(s.closetIdleGap ?? 7) || 0) };
};

/** 算得上「好久没穿」的那几件：穿过至少一次，上次穿是 days 天以前，久的在前 */
export function idleOf(owner, personaId, now = clock.now()) {
  const { days } = idleCfg();
  if (!days) return [];
  return itemsOf(owner, personaId)
    .filter(r => r.side === 'wear' && r.group && live(r) && r.wornCount > 0 && r.lastWorn
      && now - r.lastWorn >= days * DAY)
    .sort((a, b) => a.lastWorn - b.lastWorn);
}

/**
 * 这一轮要告诉角色的那一件。和快用完同一个办法：**频率是代码管的**。
 *   - 一次只递一件，递出去的那一天整天都在
 *   - 两次之间至少隔 gap 天（默认 7）
 *   - 同一件一段闲置只递一次；再穿一次之后才重新算
 * 递出去那一刻记在 idleAt 上。days 填 0 就整个关掉
 */
export function takeIdle(personaId, now = clock.now()) {
  const rows = idleOf(ME, personaId, now);
  if (!rows.length) return null;
  const d = dateKey(now);
  const shown = rows.find(r => r.idleAt && dateKey(r.idleAt) === d);
  if (shown) return shown;
  const { gap } = idleCfg();
  const last = Math.max(0, ...itemsOf(ME, personaId).map(r => r.idleAt || 0));
  if (last && now - last < gap * DAY) return null;
  const next = rows.find(r => !(r.idleAt > r.lastWorn));
  if (!next) return null;
  closet.update(next.id, { idleAt: now });
  return { ...next, idleAt: now };
}

import { chats, characters, messages as messagesDb, settings } from '../db/index.js';
import * as accounts from '../accounts.js';

import { template, buildChatSystem, isConfigured, isReplying, runTextTask, queryVecFor,
  streamGroupReply } from './engine.js';
import * as group from '../group.js';
import * as groupTurn from './group.js';
import { fillTemplate } from './templates.js';
import { renderTurn } from './reply.js';

// 每个角色自己一套设置，存在角色卡上。见 CLAUDE.md 第 5 条：
// 属于某个角色的开关就放在那个角色身上，不放全局设置里。
export const DEFAULTS = {
  proactive: false,        // 总开关，默认关
  proactiveMinutes: 60,    // 平均间隔，实际落点 0.5x ~ 1.5x 随机
  proactiveQuietFrom: 0,   // 免打扰起始小时
  proactiveQuietTo: 8,     // 免打扰结束小时，两者相等表示不设
  // 深夜那一档：夜里睡不着的时候才会冒出来的那种话。
  // 和上面那条主动消息是两件事，各有各的开关和节奏。
  emo: false,
  emoFrom: 1,              // 只在这个时段之间
  emoTo: 4,
  emoDays: 5,              // 距上次至少隔这么多天。写死会变成每晚一次的仪式
};

// 堆了这么多条没看就先停下。用户可以改，填 0 就是一直发。
const maxUnread = () => Math.max(0, settings.get().proactiveMaxUnread || 0);
const KEY = 'phone.proactive.next';
const EMO_KEY = 'phone.proactive.emo';

export function configOf(char) {
  if (!char) return { ...DEFAULTS };
  return {
    proactive: char.proactive === true,
    proactiveMinutes: Math.max(1, Number(char.proactiveMinutes) || DEFAULTS.proactiveMinutes),
    proactiveQuietFrom: clampHour(char.proactiveQuietFrom, DEFAULTS.proactiveQuietFrom),
    proactiveQuietTo: clampHour(char.proactiveQuietTo, DEFAULTS.proactiveQuietTo),
    emo: char.emo === true,
    emoFrom: clampHour(char.emoFrom, DEFAULTS.emoFrom),
    emoTo: clampHour(char.emoTo, DEFAULTS.emoTo),
    // 填 0 是「每晚都可能」，是个合法值，所以不能用 || 兜回默认值
    emoDays: numOr(char.emoDays, DEFAULTS.emoDays),
  };
}

function clampHour(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(23, Math.max(0, Math.round(n))) : fallback;
}

function numOr(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

// ---- 每个角色一个落点，存在 localStorage。设备本地的临时状态，不进 IndexedDB ----
function readMap() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function writeMap(m) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* 隐私模式会抛 */ }
}
export function nextAt(charId) { return readMap()[charId] || 0; }

/**
 * 一轮扫描当成一次事务：进来读一次，改动记在内存里，出去脏了才落盘。
 * localStorage 是同步落盘的，每个角色各读各写，二十个角色就是四十次。
 */
function openMap() {
  const m = readMap();
  let dirty = false;
  return {
    get: id => m[id] || 0,
    set(id, t) {
      if (t) {
        if (m[id] === t) return;
        m[id] = t;
      } else {
        if (m[id] === undefined) return;
        delete m[id];
      }
      dirty = true;
    },
    ids: () => Object.keys(m),
    flush() { if (dirty) writeMap(m); },
  };
}

// ---- 深夜那一档 ----
//
// 单独记上次是什么时候发的。用户的原话是「不要反复触发」——
// 每晚都来一次，它就从「今天格外难过」变成了一个固定节目。

function emoMap() {
  try { return JSON.parse(localStorage.getItem(EMO_KEY) || '{}'); } catch { return {}; }
}
function setEmoAt(charId, t) {
  const m = emoMap();
  m[charId] = t;
  try { localStorage.setItem(EMO_KEY, JSON.stringify(m)); } catch { /* 隐私模式会抛 */ }
}
export const emoAt = charId => emoMap()[charId] || 0;

export function inEmoHours(cfg, d = new Date()) {
  const a = cfg.emoFrom, b = cfg.emoTo;
  if (a === b) return false;
  const h = d.getHours();
  return a < b ? (h >= a && h < b) : (h >= a || h < b);
}

/** 今晚这一条该不该来。到点、开着、距上次够久，三样都要。 */
export function emoDue(char, { now = Date.now(), at = new Date() } = {}) {
  const cfg = configOf(char);
  if (!cfg.emo) return false;
  if (!inEmoHours(cfg, at)) return false;
  const gap = Math.max(0, Number(cfg.emoDays) || 0) * 86400000;
  return now - emoAt(char.id) >= gap;
}
function setNext(charId, t) {
  const m = readMap();
  if (t) m[charId] = t; else delete m[charId];
  writeMap(m);
}

// 落点在 0.5x ~ 1.5x 之间掷。定死间隔会像闹钟，随机才像人。
function rollDelay(minutes) {
  return Math.round(Math.max(1, minutes) * 60000 * (0.5 + Math.random()));
}

export function inQuiet(cfg, d = new Date()) {
  const a = cfg.proactiveQuietFrom, b = cfg.proactiveQuietTo;
  if (a === b) return false;
  const h = d.getHours();
  return a < b ? (h >= a && h < b) : (h >= a || h < b);
}

function quietEndsAt(cfg, d = new Date()) {
  const end = new Date(d);
  end.setMinutes(0, 0, 0);
  end.setHours(cfg.proactiveQuietTo);
  if (end <= d) end.setDate(end.getDate() + 1);
  return end.getTime();
}

// 指定多久之后发。角色刚开的小号用它安排第一条搭话
export function scheduleIn(charId, ms) {
  setNext(charId, Date.now() + Math.max(1000, ms));
}

// 改了设置之后重新掷一次，不用等旧的落点
export function reschedule(charId) {
  const cfg = configOf(characters.get(charId));
  setNext(charId, cfg.proactive ? Date.now() + rollDelay(cfg.proactiveMinutes) : 0);
}

function gapText(ms) {
  if (!ms || ms < 0) return 'a long time';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} minutes`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hours`;
  return `${Math.round(h / 24)} days`;
}

// 这个角色现在能不能被发：有单人会话、没在生成、未读没堆满
function chatFor(charId) {
  // 只往当前账号发。换了账号，别的身份那边的会话不该突然冒出新消息
  const me = accounts.currentId();
  const chat = chats.all().find(c => (c.characterIds || []).length === 1
    && c.characterIds[0] === charId && (c.personaId || me) === me);
  if (!chat) return null;
  const unreadCap = maxUnread();
  if (unreadCap && (chat.unread || 0) >= unreadCap) return null;
  if (isReplying(chat.id, charId)) return null;
  return chat;
}

export async function sendProactive(chatId, charId, { mood = false } = {}) {
  const chat = chats.get(chatId);
  const char = characters.get(charId);
  if (!chat || !char) throw new Error('会话或角色不存在');

  const msgs = messagesDb.all()
    .filter(m => m.chatId === chat.id && m.status !== 'error')
    .sort((a, b) => a.createdAt - b.createdAt);
  const last = msgs[msgs.length - 1];

  // 主动发起也不走 buildHistory，下沉的那几块要接回来 —— 少了它，角色就
  // 不知道现在几点、今天排了什么，而这一条恰恰是挑时间发的
  const { system, volatile: hot } = buildChatSystem(chat, char, msgs, { queryVec: await queryVecFor(msgs) });
  const instruction = fillTemplate(template(mood ? 'task.emo' : 'task.proactive'), {
    charName: char.name || '你',
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
    gap: gapText(last ? Date.now() - last.createdAt : 0),
  });

  const raw = await runTextTask('chat.proactive', {
    system: [system, hot, instruction].filter(Boolean).join('\n\n'),
    user: '(No new messages. You are the one opening this time.)',
    key: `${mood ? 'emo' : 'proactive'}:${chat.id}:${char.id}`,
    maxTokens: 800,
  });
  if (!raw || !raw.trim()) throw new Error('模型返回了空内容');

  const created = await renderTurn({
    chat, char, raw: raw.trim(), turnId: `p-${Date.now()}`, notify: true,
  });

  chats.update(chat.id, { unread: (chats.get(chat.id)?.unread || 0) + created.length });
  return created;
}

// ---- 群里主动开口 ----
//
// 群自己的设置（system/group.js 的 proactiveOf），落点和角色的存在同一张表里，
// 键是 `g:群 id`。一次触发一次调用：模型一次写出开口的那几个人。

const gKey = chatId => `g:${chatId}`;

export async function sendGroupProactive(chatId) {
  const chat = chats.get(chatId);
  if (!chat || !group.isGroup(chat)) throw new Error('群不存在');
  const msgs = messagesDb.all().filter(m => m.chatId === chatId && m.status !== 'error')
    .sort((a, b) => a.createdAt - b.createdAt);
  const last = msgs[msgs.length - 1];
  const opening = fillTemplate(template('task.group-proactive'), {
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
    gap: gapText(last ? Date.now() - last.createdAt : 0),
  });
  const raw = String(await streamGroupReply({ chat, opening }) || '').trim();
  if (!raw) throw new Error('模型返回了空内容');
  const created = await groupTurn.replay(chat, raw, {
    turnId: `gp-${Date.now()}`, swipes: [raw], swipeIndex: 0, notify: true,
  });
  chats.update(chatId, { unread: (chats.get(chatId)?.unread || 0) + created.length });
  return created;
}

/** 这个群现在能不能开口：当前账号的、没在生成、未读没堆满 */
function groupReady(chat) {
  const me = accounts.currentId();
  if ((chat.personaId || me) !== me) return false;
  const cap = maxUnread();
  if (cap && (chat.unread || 0) >= cap) return false;
  return !groupTurn.isBusy(chat);
}

/** 群里那一档的落点。重新设定之后调一次，不用等旧的 */
export function rescheduleGroup(chatId) {
  const cfg = group.proactiveOf(chats.get(chatId));
  setNext(gKey(chatId), cfg.on ? Date.now() + rollDelay(cfg.minutes) : 0);
}
export const groupNextAt = chatId => nextAt(gKey(chatId));

function tickGroups(m, live, now) {
  for (const chat of chats.all()) {
    if (!group.isGroup(chat)) continue;
    const k = gKey(chat.id);
    live.add(k);
    const cfg = group.proactiveOf(chat);
    if (!cfg.on) { m.set(k, 0); continue; }
    if (running.has(k)) continue;
    const next = m.get(k);
    if (!next) { m.set(k, now + rollDelay(cfg.minutes)); continue; }
    if (now < next) continue;
    const quiet = { proactiveQuietFrom: cfg.quietFrom, proactiveQuietTo: cfg.quietTo };
    if (inQuiet(quiet)) { m.set(k, quietEndsAt(quiet)); continue; }
    m.set(k, now + rollDelay(cfg.minutes));
    if (!groupReady(chat)) continue;
    running.add(k);
    sendGroupProactive(chat.id)
      .catch(err => console.warn('[proactive] 群里没开成口:', err.message || err))
      .finally(() => running.delete(k));
  }
}

// ---- 调度 ----
let timer = null;
const running = new Set();

// char-alt 那边要用本文件的 scheduleIn，所以这里只在运行时去问它，
// 避免两个模块静态互相 import 成环。
let altMod = null;
import('./tasks/char-alt.js').then(m => { altMod = m; }).catch(() => {});

// 同样的道理，这两个也只在装载时引一次，不在每个 tick 里现 import。
let spaceMod = null, paceMod = null, snapMod = null, badgesMod = null, keepMod = null, ghMod = null, otdMod = null;
import('../badges.js').then(m => { badgesMod = m; }).catch(() => {});
import('../safekeep.js').then(m => { keepMod = m; }).catch(() => {});
import('../ghbackup.js').then(m => { ghMod = m; }).catch(() => {});
import('../onthisday.js').then(m => { otdMod = m; }).catch(() => {});
import('../space.js').then(m => { spaceMod = m; }).catch(() => {});
import('../pace.js').then(m => { paceMod = m; }).catch(() => {});
import('./tasks/snap.js').then(m => { snapMod = m; }).catch(() => {});
let healthMod = null;
import('./tasks/health.js').then(m => { healthMod = m; }).catch(() => {});
const altReady = id => !!altMod && altMod.eligible(id);
const altRolls = id => !!altMod && altMod.rolls(id);

export async function tick() {
  // 定时寄信不依赖接口，所以放在 isConfigured 前面：没配接口也该寄出去
  try { spaceMod?.deliverDue(); } catch { /* 一封没寄成不该拖住别的 */ }
  // 到点该回的那几段。会话页自己也有定时器，但只管你正开着的那一段 ——
  // 人在别处的时候靠这一条，「她趁你没看的时候回了一句」才成立
  paceMod?.runDue().catch(() => {});
  // 互动标识：同步统计、快断了的到点提醒。本地算，不调接口，所以也在这条线前面
  try { badgesMod?.tick(); } catch (err) { console.warn('[badges]', err.message || err); }
  // 防丢：多久没备份就提醒一次；开了自动备份到 GitHub 的，到了间隔在后台传一次
  try { keepMod?.tick(); ghMod?.tick(); } catch (err) { console.warn('[safekeep]', err.message || err); }
  // 那年今天：往年的这一天聊过的，一天提醒一次。本地翻，不调接口
  try { otdMod?.tick(); } catch (err) { console.warn('[onthisday]', err.message || err); }
  if (!isConfigured()) return;
  const now = Date.now();
  const live = new Set();
  const m = openMap();

  for (const char of characters.all()) {
    const cfg = configOf(char);
    live.add(char.id);

    // 身体状态每天自动生成：不聊天也填上。不 await，一天只试一次（见 tasks/health.js）
    if (healthMod?.isAuto(char)) healthMod.ensureToday(char.id).catch(() => {});

    // 自己存照片那一档**不跟着主动消息走**：各有各的开关，
    // 一个只开了存照片、没开主动消息的角色照样该存（见 tasks/snap.js）
    if (snapMod && !running.has(char.id) && snapMod.due(char, now)) {
      snapMod.setLastAt(char.id, now);
      running.add(char.id);
      snapMod.takeSnap(char.id)
        .catch(err => console.warn('[snap] 没存成:', err.message || err))
        .finally(() => running.delete(char.id));
      continue;
    }

    if (!cfg.proactive) { m.set(char.id, 0); continue; }
    if (running.has(char.id)) continue;

    const next = m.get(char.id);
    if (!next) { m.set(char.id, now + rollDelay(cfg.proactiveMinutes)); continue; }
    if (now < next) continue;

    const chat = chatFor(char.id);

    // 深夜那一档要排在免打扰前面判断。它本来就发生在夜里，而免打扰
    // 默认正好是 0 点到 8 点 —— 排在后面的话，这一档永远轮不上。
    // 它有自己的时段和自己的开关，界面上也写明了不受免打扰限制。
    if (chat && emoDue(char)) {
      m.set(char.id, now + rollDelay(cfg.proactiveMinutes));
      setEmoAt(char.id, now);
      running.add(char.id);
      sendProactive(chat.id, char.id, { mood: true })
        .catch(err => console.warn('[emo] 没发出去:', err.message || err))
        .finally(() => running.delete(char.id));
      continue;
    }

    if (inQuiet(cfg)) { m.set(char.id, quietEndsAt(cfg)); continue; }
    m.set(char.id, now + rollDelay(cfg.proactiveMinutes));

    // 轮到她主动时，有一定概率她开的不是口，而是一个新号。
    // 动态 import：char-alt 反过来要用这里的 scheduleIn，静态引会成环。
    if (altReady(char.id) && altRolls(char.id)) {
      running.add(char.id);
      import('./tasks/char-alt.js')
        .then(m => m.openAlt(char.id))
        .then(({ alt }) => console.info('[proactive] 角色开设了小号:', alt.name))
        .catch(err => console.warn('[proactive] 开小号失败:', err.message || err))
        .finally(() => running.delete(char.id));
      continue;
    }

    if (!chat) continue;

    running.add(char.id);
    sendProactive(chat.id, char.id)
      .catch(err => console.warn('[proactive] 没发出去:', err.message || err))
      .finally(() => running.delete(char.id));
  }

  tickGroups(m, live, now);

  // 角色删了、群删了，落点也跟着清掉
  m.ids().forEach(id => { if (!live.has(id)) m.set(id, 0); });
  m.flush();

  // 最近的那个落点，用来决定下一次什么时候醒。见 start()
  return m.ids().reduce((a, id) => {
    const t = m.get(id);
    return t && (!a || t < a) ? t : a;
  }, 0);
}

// 下一次多久之后醒。上限就是安全网：这个数算错了，到点该发的也最多迟 MAX，
// 所以不必去问 pace 和 space 各自的下一件事。主动消息的间隔按分钟算，
// 二十秒的精度对它没有意义。
const MIN_GAP = 20000;
const MAX_GAP = 60000;
function gapUntil(soonest, now = Date.now()) {
  if (!soonest) return MAX_GAP;
  return Math.min(MAX_GAP, Math.max(MIN_GAP, soonest - now));
}

export function start() {
  if (timer) return;
  // 页面关着的这段时间是不跑的。重新打开时如果早就该发了，不要立刻炸出来，
  // 挪到十几秒到一分钟之后，像是刚好这会儿想起你。
  const now = Date.now();
  const m = readMap();
  let dirty = false;
  for (const id of Object.keys(m)) {
    if (m[id] && m[id] <= now) {
      m[id] = now + 10000 + Math.round(Math.random() * 50000);
      dirty = true;
    }
  }
  if (dirty) writeMap(m);

  // 串起来跑，不用 setInterval：tick 是异步的，上一轮还没跑完就再进一轮，
  // 同一个角色会被安排两次。跑完再定下一次，顺便按最近的落点决定隔多久。
  let stopped = false;
  const loop = delay => {
    timer = setTimeout(async () => {
      let next = 0;
      try { next = await tick(); } catch (err) { console.warn('[proactive] tick 出错:', err.message || err); }
      if (!stopped) loop(gapUntil(next));
    }, delay);
  };
  // 第一次照旧按最短的来：页面刚打开，关着的这段时间里可能积了该寄的信、
  // 该回的话，不该让它们再等一分钟
  loop(MIN_GAP);

  return () => { stopped = true; clearTimeout(timer); timer = null; };
}

import { chats, characters, messages as messagesDb, settings } from '../db/index.js';
import * as accounts from '../accounts.js';

import { template, buildChatSystem, isConfigured, isReplying, runTextTask, queryVecFor } from './engine.js';
import { fillTemplate } from './templates.js';
import { renderTurn, notifyTurn } from './reply.js';

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
  if (!ms || ms < 0) return '很久';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} 分钟`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时`;
  return `${Math.round(h / 24)} 天`;
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

  const { system } = buildChatSystem(chat, char, msgs, { queryVec: await queryVecFor(msgs) });
  const instruction = fillTemplate(template(mood ? 'task.emo' : 'task.proactive'), {
    charName: char.name || '你',
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
    gap: gapText(last ? Date.now() - last.createdAt : 0),
  });

  const raw = await runTextTask('chat.proactive', {
    system: system + '\n\n' + instruction,
    user: '（没有新消息。现在由你主动开口。）',
    key: `${mood ? 'emo' : 'proactive'}:${chat.id}:${char.id}`,
    maxTokens: 800,
  });
  if (!raw || !raw.trim()) throw new Error('模型返回了空内容');

  const created = await renderTurn({
    chat, char, raw: raw.trim(), turnId: `p-${Date.now()}`,
  });

  chats.update(chat.id, { unread: (chats.get(chat.id)?.unread || 0) + created.length });
  notifyTurn(chat, char, created);
  return created;
}

// ---- 调度 ----
let timer = null;
const running = new Set();

// char-alt 那边要用本文件的 scheduleIn，所以这里只在运行时去问它，
// 避免两个模块静态互相 import 成环。
let altMod = null;
import('./tasks/char-alt.js').then(m => { altMod = m; }).catch(() => {});
const altReady = id => !!altMod && altMod.eligible(id);
const altRolls = id => !!altMod && altMod.rolls(id);

export async function tick() {
  // 定时寄信不依赖接口，所以放在 isConfigured 前面：没配接口也该寄出去
  import('../space.js').then(m => m.deliverDue()).catch(() => {});
  // 到点该回的那几段。会话页自己也有定时器，但只管你正开着的那一段 ——
  // 人在别处的时候靠这一条，「她趁你没看的时候回了一句」才成立
  import('../pace.js').then(m => m.runDue()).catch(() => {});
  if (!isConfigured()) return;
  const now = Date.now();
  const live = new Set();

  for (const char of characters.all()) {
    const cfg = configOf(char);
    live.add(char.id);
    if (!cfg.proactive) { setNext(char.id, 0); continue; }
    if (running.has(char.id)) continue;

    const next = nextAt(char.id);
    if (!next) { setNext(char.id, now + rollDelay(cfg.proactiveMinutes)); continue; }
    if (now < next) continue;

    const chat = chatFor(char.id);

    // 深夜那一档要排在免打扰前面判断。它本来就发生在夜里，而免打扰
    // 默认正好是 0 点到 8 点 —— 排在后面的话，这一档永远轮不上。
    // 它有自己的时段和自己的开关，界面上也写明了不受免打扰限制。
    if (chat && emoDue(char)) {
      setNext(char.id, now + rollDelay(cfg.proactiveMinutes));
      setEmoAt(char.id, now);
      running.add(char.id);
      sendProactive(chat.id, char.id, { mood: true })
        .catch(err => console.warn('[emo] 没发出去:', err.message || err))
        .finally(() => running.delete(char.id));
      continue;
    }

    if (inQuiet(cfg)) { setNext(char.id, quietEndsAt(cfg)); continue; }
    setNext(char.id, now + rollDelay(cfg.proactiveMinutes));

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

  // 角色删了，落点也跟着清掉
  const m = readMap();
  let dirty = false;
  for (const id of Object.keys(m)) if (!live.has(id)) { delete m[id]; dirty = true; }
  if (dirty) writeMap(m);
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

  timer = setInterval(tick, 20000);
  return () => { clearInterval(timer); timer = null; };
}

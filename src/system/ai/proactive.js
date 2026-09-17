import { chats, characters, messages as messagesDb } from '../db/index.js';
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
};

// 堆了这么多条没看就先停下，不是设置项，写死就行
const MAX_UNREAD = 3;
const KEY = 'phone.proactive.next';

export function configOf(char) {
  if (!char) return { ...DEFAULTS };
  return {
    proactive: char.proactive === true,
    proactiveMinutes: Math.max(1, Number(char.proactiveMinutes) || DEFAULTS.proactiveMinutes),
    proactiveQuietFrom: clampHour(char.proactiveQuietFrom, DEFAULTS.proactiveQuietFrom),
    proactiveQuietTo: clampHour(char.proactiveQuietTo, DEFAULTS.proactiveQuietTo),
  };
}

function clampHour(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(23, Math.max(0, Math.round(n))) : fallback;
}

// ---- 每个角色一个落点，存在 localStorage。设备本地的临时状态，不进 IndexedDB ----
function readMap() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function writeMap(m) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* 隐私模式会抛 */ }
}
export function nextAt(charId) { return readMap()[charId] || 0; }
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
  if ((chat.unread || 0) >= MAX_UNREAD) return null;
  if (isReplying(chat.id, charId)) return null;
  return chat;
}

export async function sendProactive(chatId, charId) {
  const chat = chats.get(chatId);
  const char = characters.get(charId);
  if (!chat || !char) throw new Error('会话或角色不存在');

  const msgs = messagesDb.all()
    .filter(m => m.chatId === chat.id && m.status !== 'error')
    .sort((a, b) => a.createdAt - b.createdAt);
  const last = msgs[msgs.length - 1];

  const { system } = buildChatSystem(chat, char, msgs, { queryVec: await queryVecFor(msgs) });
  const instruction = fillTemplate(template('task.proactive'), {
    charName: char.name || '你',
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
    gap: gapText(last ? Date.now() - last.createdAt : 0),
  });

  const raw = await runTextTask('chat.proactive', {
    system: system + '\n\n' + instruction,
    user: '（没有新消息。现在由你主动开口。）',
    key: `proactive:${chat.id}:${char.id}`,
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

    if (inQuiet(cfg)) { setNext(char.id, quietEndsAt(cfg)); continue; }

    const chat = chatFor(char.id);
    setNext(char.id, now + rollDelay(cfg.proactiveMinutes));

    // 轮到她主动时，有一定概率她开的不是口，而是一个新号。
    // 动态 import：char-alt 反过来要用这里的 scheduleIn，静态引会成环。
    if (altReady(char.id) && altRolls(char.id)) {
      running.add(char.id);
      import('./tasks/char-alt.js')
        .then(m => m.openAlt(char.id))
        .then(({ alt }) => console.info('[proactive] 她开了个小号:', alt.name))
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

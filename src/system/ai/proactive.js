import { chats, characters, messages as messagesDb, settings } from '../db/index.js';
import { notify } from '../notify.js';
import { template, buildChatSystem, buildHistory, isConfigured, isReplying } from './engine.js';
import { fillTemplate } from './templates.js';
import { runTextTask } from './engine.js';
import { renderTurn } from './reply.js';

const KEY = 'phone.proactive.nextAt';

export const DEFAULT_PROACTIVE = {
  enabled: false,
  minutes: 60,        // 平均间隔。实际落点在 0.5x ~ 1.5x 之间随机
  quietFrom: 0,       // 免打扰起始小时（含）
  quietTo: 8,         // 免打扰结束小时（不含）。两者相等表示不设免打扰
  maxUnread: 3,       // 已经堆了这么多条没看，就先不发了
};

export function config() {
  return { ...DEFAULT_PROACTIVE, ...(settings.get().proactive || {}) };
}

function readNext() {
  try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; }
}
function writeNext(t) {
  try { localStorage.setItem(KEY, String(t)); } catch { /* 隐私模式会抛 */ }
}

// 下一次落在 0.5x ~ 1.5x 平均间隔之间。定死间隔会像闹钟，随机才像人。
function rollDelay(minutes) {
  const base = Math.max(1, Number(minutes) || 60) * 60000;
  return Math.round(base * (0.5 + Math.random()));
}

export function inQuiet(cfg, d = new Date()) {
  const { quietFrom: a, quietTo: b } = cfg;
  if (a === b) return false;
  const h = d.getHours();
  return a < b ? (h >= a && h < b) : (h >= a || h < b);
}

// 免打扰结束的那一刻（本地时间）
function quietEndsAt(cfg, d = new Date()) {
  const end = new Date(d);
  end.setMinutes(0, 0, 0);
  end.setHours(cfg.quietTo);
  if (end <= d) end.setDate(end.getDate() + 1);
  return end.getTime();
}

// 谁可以被挑中：单人会话、角色没关掉主动、没在生成、堆积的未读没超上限
function candidates(cfg) {
  return chats.all().map(chat => {
    const ids = chat.characterIds || [];
    if (ids.length !== 1) return null;                 // 群聊另算，这里先不碰
    const char = characters.get(ids[0]);
    if (!char || char.proactive === false) return null;
    if ((chat.unread || 0) >= cfg.maxUnread) return null;
    if (isReplying(chat.id, char.id)) return null;
    return { chat, char };
  }).filter(Boolean);
}

function gapText(ms) {
  if (!ms || ms < 0) return '很久';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} 分钟`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时`;
  return `${Math.round(h / 24)} 天`;
}

export async function sendProactive(chatId, charId) {
  const chat = chats.get(chatId);
  const char = characters.get(charId);
  if (!chat || !char) throw new Error('会话或角色不存在');

  const msgs = messagesDb.all()
    .filter(m => m.chatId === chat.id && m.status !== 'error')
    .sort((a, b) => a.createdAt - b.createdAt);
  const last = msgs[msgs.length - 1];

  const { system } = buildChatSystem(chat, char, msgs);
  const instruction = fillTemplate(template('task.proactive'), {
    charName: char.name || '你',
    userName: chat.title || '对方',
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
  const first = created.find(m => m.kind === 'text') || created[0];
  notify({
    title: char.name, body: first?.content || '发来一条消息',
    icon: 'message', appId: 'chat', avatar: char.avatar,
    payload: { route: `/chat/${chat.id}` },
  });
  return created;
}

// ---- 调度 ----
let timer = null;
let running = false;

// 导出是为了能被测试直接驱动，平时由 start() 里的定时器调用
export async function tick() {
  const cfg = config();
  if (!cfg.enabled) { writeNext(0); return; }
  if (!isConfigured() || running) return;

  const now = Date.now();
  let next = readNext();

  // 第一次开启，或者上次的落点已经被清掉了
  if (!next) { writeNext(now + rollDelay(cfg.minutes)); return; }
  if (now < next) return;

  if (inQuiet(cfg)) { writeNext(quietEndsAt(cfg)); return; }

  const list = candidates(cfg);
  if (!list.length) { writeNext(now + rollDelay(cfg.minutes)); return; }

  const pick = list[Math.floor(Math.random() * list.length)];
  writeNext(now + rollDelay(cfg.minutes));
  running = true;
  try {
    await sendProactive(pick.chat.id, pick.char.id);
  } catch (err) {
    console.warn('[proactive] 没发出去:', err.message || err);
  } finally {
    running = false;
  }
}

export function start() {
  if (timer) return;
  const cfg = config();
  const now = Date.now();
  const next = readNext();
  // 页面关着的这段时间是不跑的。重新打开时如果早就该发了，
  // 不要立刻炸出来，挪到十几秒到一分钟之后，像是刚好这会儿想起你。
  if (cfg.enabled && next && next <= now) {
    writeNext(now + 10000 + Math.round(Math.random() * 50000));
  }
  timer = setInterval(tick, 20000);
  return () => { clearInterval(timer); timer = null; };
}

// 改了频率之后重新掷一次，不用等旧的落点
export function reschedule() {
  const cfg = config();
  writeNext(cfg.enabled ? Date.now() + rollDelay(cfg.minutes) : 0);
}

export function nextAt() { return readNext(); }

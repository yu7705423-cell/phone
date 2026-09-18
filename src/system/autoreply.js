import { messages, chats, characters, settings } from './db/index.js';
import * as accounts from './accounts.js';

// 自动回复。两个方向都有：
//
//   **我这边** 我不在，角色发来消息时替我回一句固定的。
//   **她那边** 她在忙或者在睡，我发消息时回一句固定的，**不调接口**。
//
// 后一个方向顺带省钱：一句「在开会，晚点回你」不该花一次生成。
//
// 这件事最容易出的毛病是**忘了自己开着**，然后一整天都在自动回复。
// 用户的原话是「要限制死不能一直回忘了自动回复」。所以两道闸一起上：
//
//   **条数** 一个窗口里最多回几条，到了就自动关，并且落一行提示；
//   **时限** 到点自动关，同样落一行提示。
//
// 两道闸都**主动关掉并说一声**，不是默默不回 —— 默默不回的话，
// 用户只会觉得坏了。

export const SIDES = ['mine', 'hers'];

const DEFAULTS = { on: false, text: '', max: 3, used: 0, until: 0 };

const trim = (v, n) => String(v || '').trim().slice(0, n);

export function configOf(chat, side) {
  const raw = chat?.autoReply?.[side];
  return {
    ...DEFAULTS, ...(raw || {}),
    text: trim(raw?.text, 200),
    max: Math.max(0, Math.round(Number(raw?.max) ?? DEFAULTS.max) || 0),
    used: Math.max(0, Math.round(Number(raw?.used) || 0)),
    until: Math.max(0, Number(raw?.until) || 0),
  };
}

function write(chatId, side, patch) {
  const chat = chats.get(chatId);
  if (!chat || !SIDES.includes(side)) return null;
  const cur = chat.autoReply || {};
  const next = { ...configOf(chat, side), ...patch };
  chats.update(chatId, { autoReply: { ...cur, [side]: next } });
  return next;
}

/** 改配置。开启时把用过的条数清零 —— 新开一个窗口就是新的一轮。 */
export function setConfig(chatId, side, patch) {
  const clean = { ...patch };
  if (clean.text !== undefined) clean.text = trim(clean.text, 200);
  if (clean.max !== undefined) clean.max = Math.max(0, Math.round(Number(clean.max) || 0));
  if (clean.until !== undefined) clean.until = Math.max(0, Number(clean.until) || 0);
  if (clean.on === true) clean.used = 0;
  return write(chatId, side, clean);
}

export const isOn = (chat, side) => {
  const c = configOf(chat, side);
  return !!(c.on && c.text);
};

/** 还剩几条。max 填 0 表示不限条数，返回 Infinity。 */
export function leftOf(chat, side) {
  const c = configOf(chat, side);
  return c.max ? Math.max(0, c.max - c.used) : Infinity;
}

// 到期或者用完了就关掉，并落一行提示说清楚为什么停。
function stop(chatId, side, why) {
  const chat = chats.get(chatId);
  if (!chat) return;
  write(chatId, side, { on: false, used: 0 });
  const who = side === 'mine' ? '你的' : (characters.get((chat.characterIds || [])[0])?.name || '对方') + '的';
  messages.create({
    chatId, role: 'user', authorId: 'me', kind: 'notice',
    content: `[${who}自动回复已停止：${why}]`, status: 'done',
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
}

/**
 * 现在该不该自动回。顺带把到期和用完这两件事处理掉 ——
 * 判断和收尾放在一处，否则总有一条路径忘了关。
 */
export function shouldReply(chatId, side) {
  const chat = chats.get(chatId);
  if (!chat || !isOn(chat, side)) return false;
  const c = configOf(chat, side);
  if (c.until && Date.now() >= c.until) { stop(chatId, side, '已到设定的结束时间'); return false; }
  if (c.max && c.used >= c.max) { stop(chatId, side, '已达设定的条数上限'); return false; }
  return true;
}

/**
 * 回一条。回完计数加一，加完正好到顶就当场关掉 ——
 * 等到下一条才发现超了，那一条已经发出去了。
 */
export function fire(chatId, side) {
  if (!shouldReply(chatId, side)) return null;
  const chat = chats.get(chatId);
  const char = characters.get((chat.characterIds || [])[0]);
  const c = configOf(chat, side);

  const msg = messages.create({
    chatId,
    role: side === 'mine' ? 'user' : 'char',
    authorId: side === 'mine' ? 'me' : (char?.id || ''),
    kind: 'text', content: c.text, auto: true, status: 'done',
  });
  chats.update(chatId, { lastMessageAt: Date.now() });

  const used = c.used + 1;
  write(chatId, side, { used });
  if (c.max && used >= c.max) stop(chatId, side, '已达设定的条数上限');
  return msg;
}

/** 界面上那一行横幅要写什么。没开就返回空串。 */
export function bannerOf(chat) {
  const parts = [];
  for (const side of SIDES) {
    if (!isOn(chat, side)) continue;
    const c = configOf(chat, side);
    const who = side === 'mine' ? '你' : (characters.get((chat.characterIds || [])[0])?.name || '对方');
    const left = c.max ? `还可回 ${Math.max(0, c.max - c.used)} 条` : '不限条数';
    parts.push(`${who}的自动回复开着（${left}）`);
  }
  return parts.join('；');
}

import { messages, chats, ebooks } from './db/index.js';

// 书摘小卡片。自己读书的时候摘一段，发到某个角色的会话里。
//
// 摘的是你自己导入的那本书里的一段，卡片只放一小段 —— 它是书摘，
// 不是转载。超出的部分截掉，界面上也写着还能写多少字。

export const MAX_QUOTE = 300;
export const MAX_NOTE = 200;

const cut = (s, n) => String(s || '').trim().slice(0, n);

/** 卡片正文。方括号标记是协议，reply 那边和历史消息都按它认（第 14 条）。 */
export function textOf({ title, quote, note }) {
  return [`[书摘：《${title}》]`, `「${quote}」`, note].filter(Boolean).join('\n');
}

/**
 * 发一张卡片到某段会话。**不调接口** —— 它只是一条消息，
 * 角色要不要接话由这段对话自己的节奏决定。
 */
export function send({ chatId, bookId, quote, note = '', at = 0, authorId = 'me' }) {
  const chat = chats.get(chatId);
  if (!chat) throw new Error('会话不存在');
  const q = cut(quote, MAX_QUOTE);
  if (!q) throw new Error('请先写下要摘的那一段');
  const row = ebooks.get(bookId);
  const title = row?.title || '一本书';

  const msg = messages.create({
    chatId, role: 'user', authorId, kind: 'excerpt', status: 'done',
    bookId, bookTitle: title, bookAuthor: row?.author || '',
    quote: q, note: cut(note, MAX_NOTE), at,
    content: textOf({ title, quote: q, note: cut(note, MAX_NOTE) }),
  });
  chats.update(chatId, { lastMessageAt: Date.now() });
  return msg;
}

/** 能发给谁：一对一的会话。群里发书摘没有意义，收的人不明确。 */
export const targets = () => chats.all()
  .filter(c => (c.characterIds || []).length === 1)
  .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));

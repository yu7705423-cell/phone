import { phone } from '../../sdk/index.js';
const { db } = phone;

export function relTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (ts >= today.getTime()) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (ts >= today.getTime() - 86400000) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// 会话属于「某个身份 + 某个角色」。换成小号去找同一个角色，开的是新会话。
export function chatFor(charId, personaId = phone.accounts.currentId()) {
  const found = db.chats.all().find(c => (c.characterIds || []).length === 1
    && c.characterIds[0] === charId && c.personaId === personaId);
  if (found) return found;
  return db.chats.create({
    characterIds: [charId], personaId,
    title: '', lastMessageAt: Date.now(), unread: 0, summary: '',
  });
}

// 当前身份能看到的会话
export function myChats() {
  const me = phone.accounts.currentId();
  return db.chats.where(c => (c.personaId || me) === me);
}

export function displayName(authorId) {
  if (authorId === 'me') return phone.accounts.current()?.name || '我';
  return db.characters.get(authorId)?.name || '未知';
}

// 一条回复里可能有多段,用空行分隔,渲染成多个气泡
export function splitBubbles(text) {
  return String(text || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
}

// 引用块显示用。原消息还在就跟着它走（可能被编辑过），
// 删了就退回发送当时存下的那份快照 —— 引用不该因为原话被删就变成空的。
export function quoteOf(msg, { char, chat } = {}) {
  if (!msg || (!msg.quoteId && !msg.quoteText)) return null;
  const src = msg.quoteId ? db.messages.get(msg.quoteId) : null;
  const text = (src ? src.content : msg.quoteText) || '';
  if (!text.trim()) return null;

  const role = src ? src.role : msg.quoteRole;
  const authorId = src ? src.authorId : msg.quoteAuthorId;
  // 角色那一边：设了备注就写备注，和会话标题、会话列表同一个名字（system/remark.js）
  const who = role === 'char' ? (db.characters.get(authorId) || char) : null;
  const name = role === 'user'
    ? (phone.accounts.get(chat?.personaId)?.name || phone.accounts.current()?.name || '我')
    : role === 'char'
      ? (phone.remark.nameOf(who) || '对方')
      : '';

  return { id: src ? src.id : null, name, text: phone.ai.reply.snippet(text) };
}

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

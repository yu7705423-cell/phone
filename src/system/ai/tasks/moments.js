import { moments, characters, persona } from '../../db/index.js';
import { template, runJSONTask } from '../engine.js';
import { fillTemplate } from '../templates.js';
import { listFor } from '../context/memory.js';

function charContext(char) {
  const mems = listFor(char.id, null)
    .filter(m => m.rank === 'S' || m.rank === 'A')
    .slice(0, 12)
    .map(m => `- ${m.content}`).join('\n');
  return [char.persona, mems ? `最近记得的事：\n${mems}` : ''].filter(Boolean).join('\n\n');
}

export async function createMoment(charId) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const system = fillTemplate(template('task.moment-create'), {
    charName: char.name,
  }) + `\n\n## 你的设定\n${charContext(char)}`;

  const r = await runJSONTask('moment.create', { system, key: `moment-create:${charId}`, maxTokens: 500 });
  if (!r?.text) throw new Error('模型没有返回动态内容');
  return moments.create({
    authorId: charId, text: String(r.text).trim(), mood: r.mood || '',
    images: [], likes: [], comments: [],
  });
}

export async function commentMoment(momentId, charId) {
  const mo = moments.get(momentId);
  const char = characters.get(charId);
  if (!mo || !char) throw new Error('数据不存在');
  const author = mo.authorId === 'me' ? persona.get().name : characters.get(mo.authorId)?.name;

  const system = fillTemplate(template('task.moment-comment'), {
    charName: char.name, authorName: author || '对方', momentText: mo.text,
  }) + `\n\n## 你的设定\n${charContext(char)}`;

  const r = await runJSONTask('moment.comment', { system, key: `moment-comment:${momentId}:${charId}`, maxTokens: 300 });
  if (!r?.text) throw new Error('模型没有返回评论');
  return addComment(momentId, charId, String(r.text).trim());
}

export async function replyComment(momentId, charId, commentText) {
  const mo = moments.get(momentId);
  const char = characters.get(charId);
  if (!mo || !char) throw new Error('数据不存在');

  const system = fillTemplate(template('task.moment-reply'), {
    charName: char.name, userName: persona.get().name,
    momentText: mo.text, commentText,
  }) + `\n\n## 你的设定\n${charContext(char)}`;

  const r = await runJSONTask('moment.reply', { system, key: `moment-reply:${momentId}`, maxTokens: 300 });
  if (!r?.text) throw new Error('模型没有返回回复');
  return addComment(momentId, charId, String(r.text).trim());
}

export function addComment(momentId, authorId, text, replyTo = null) {
  const mo = moments.get(momentId);
  if (!mo) return null;
  const comment = {
    id: `cm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    authorId, text, replyTo, createdAt: Date.now(),
  };
  moments.update(momentId, { comments: [...(mo.comments || []), comment] });
  return comment;
}

export function toggleLike(momentId, who = 'me') {
  const mo = moments.get(momentId);
  if (!mo) return;
  const likes = mo.likes || [];
  moments.update(momentId, {
    likes: likes.includes(who) ? likes.filter(x => x !== who) : [...likes, who],
  });
}

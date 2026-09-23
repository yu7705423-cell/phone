import { chats, characters, messagesOf } from '../../db/index.js';
import { template, buildChatSystem, runTextTask } from '../engine.js';
import { fillTemplate } from '../templates.js';
import * as badges from '../../badges.js';
import * as accounts from '../../accounts.js';

/**
 * 年度回顾里「由角色写的一段话」。点了才写，一次调用（见 ARCHITECTURE 4.164）。
 *
 * 数字全是本地算好的（badges.yearOf），交给模型的只是这些事实和平常那份设定：
 * 数字不是模型的活，写错了它也不知道（第 16 条那一类客观事实，由我们给）。
 */
export async function write(chatId, year) {
  const chat = chats.get(chatId);
  const char = characters.get((chat?.characterIds || [])[0]);
  if (!chat || !char) throw new Error('会话或角色不存在');
  const y = badges.yearOf(chatId, year);
  const me = accounts.get(chat.personaId) || accounts.current();
  const facts = [
    `Messages this year: ${y.n} (${me?.name || 'the user'} ${y.nU}, ${char.name} ${y.nC}).`,
    `Days with any messages: ${y.activeDays}; days on which both sides messaged: ${y.bothDays}.`,
    `Longest run of consecutive days on which both sides messaged: ${y.bestStreak}.`,
    y.busiest ? `Busiest day: ${new Date(y.busiest.at).toLocaleDateString('zh-CN')}, ${y.busiest.n} messages.` : '',
    y.latest ? `Latest hour of the night they talked: ${new Date(y.latest).toLocaleString('zh-CN', { hour12: false })}.` : '',
    y.words.length ? `Words used most often: ${y.words.map(x => x.w).join(', ')}.` : '',
    y.unlocked.length || y.limited.length
      ? `Badges unlocked this year: ${[...y.unlocked, ...y.limited].map(badges.labelOf).filter(Boolean).join('; ')}.` : '',
    y.awards.length ? `Badges given to each other: ${y.awards.map(a => a.name).join('; ')}.` : '',
  ].filter(Boolean).join('\n');
  const msgs = messagesOf(chatId).filter(m => m.status !== 'error');
  const { system } = buildChatSystem(chat, char, msgs);
  const text = String(await runTextTask('badge.year', {
    system: [system, fillTemplate(template('task.year-note'), { year: String(year), facts })].join('\n\n'),
    user: '(Write the passage as instructed.)',
    key: `year-note:${chatId}:${year}`,
    maxTokens: 900,
  }) || '').trim();
  if (!text) throw new Error('模型返回了空内容');
  chats.update(chatId, { yearNotes: { ...(chats.get(chatId)?.yearNotes || {}), [year]: text } });
  return text;
}

import { settings, chapters } from '../../db/index.js';
import * as work from '../../work.js';
import * as scene from '../../scene.js';
import { template } from '../templates.js';
import { runTextTask } from '../engine.js';

// 一篇写完之后压成一段摘要。**默认关着**（第 15 条，见 ai/cost.js）：
// 它是另一次接口调用。
//
// 摘要是长篇里章与章之间的通道：下一章的设定区里带的是前面各章的摘要，
// 没有摘要就截正文的末尾顶上（那一步不调接口，见 work.digestOf）。

const who = (b, w) => (b.role === scene.ME ? work.meOf(w).name : work.charOf(w).name);

/** 拼给模型看的原文。场外指示不进去 —— 那是指令，不是发生过的事。 */
function transcript(list, w) {
  return list
    .filter(b => b.role !== scene.DIRECTOR && String(b.text || '').trim())
    .map(b => `${who(b, w)}${b.at ? `（${b.at}）` : ''}：\n${b.text.trim()}`)
    .join('\n\n');
}

/** 收篇。把这一篇压成一段，写回 chapter.summary。 */
export async function wrap(chapterId) {
  if (settings.get().workSummary !== true) return '';
  const row = work.getChapter(chapterId);
  const w = work.workOfChapter(chapterId);
  if (!row || !w) throw new Error('这一篇已经不在了');
  const body = transcript(scene.beatsOf(chapterId), w);
  if (!body.trim()) return '';
  const head = [
    w.title ? `作品：${w.title}` : '',
    w.kind === work.SAGA ? `第 ${row.no} 章${row.title ? `　${row.title}` : ''}` : (row.title || ''),
    row.place ? `地点：${row.place}` : '',
    row.summary ? `[这一篇之前发生过什么]\n${row.summary}` : '',
  ].filter(Boolean).join('\n');
  const text = String(await runTextTask('work.summary', {
    system: template('task.work-summary'),
    user: [head, body].filter(Boolean).join('\n\n'),
    key: `work-wrap:${chapterId}`, maxTokens: 1200,
  }) || '').trim();
  if (text) chapters.update(chapterId, { summary: text, updatedAt: Date.now() });
  return text;
}

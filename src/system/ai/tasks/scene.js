import { settings, characters, chats } from '../../db/index.js';
import * as accounts from '../../accounts.js';
import * as scene from '../../scene.js';
import { template } from '../templates.js';
import { runTextTask } from '../engine.js';

// 线下那一场的摘要。两处用它，**都默认关着**（第 15 条，见 ai/cost.js）：
//   收场   把整场压成一段，进记忆、线上也看得见；
//   压缩   窗口把老段落挡在外面时，先把挡掉的那些压进摘要里再挡。
//
// 摘要互通、原文不互通（4.107）—— 所以这里出来的这一段是线下与线上之间
// 唯一的通道。慢一点没人会发现，走副用或记忆接口。

const who = (b, chat) => {
  if (b.role === scene.ME) {
    const me = accounts.get(chat?.personaId) || accounts.current();
    return me?.name || '我';
  }
  return characters.get(b.authorId)?.name || '对方';
};

/** 拼给模型看的原文。场外指示不进去 —— 那是指令，不是发生过的事。 */
function transcript(list, chat) {
  return list
    .filter(b => b.role !== scene.DIRECTOR && String(b.text || '').trim())
    .map(b => `${who(b, chat)}${b.at ? `（${b.at}）` : ''}：\n${b.text.trim()}`)
    .join('\n\n');
}

async function summarize(row, list, { key, maxTokens }) {
  const chat = chats.get(row.chatId);
  const body = transcript(list, chat);
  if (!body.trim()) return '';
  const head = [
    row.title ? `场次：${row.title}` : '',
    row.place ? `地点：${row.place}` : '',
    row.summary ? `[这一场之前发生过什么]\n${row.summary}` : '',
  ].filter(Boolean).join('\n');
  const text = String(await runTextTask('scene.summary', {
    system: template('task.scene-summary'),
    user: [head, body].filter(Boolean).join('\n\n'),
    key, maxTokens,
  }) || '').trim();
  return text;
}

/** 收场。整场压成一段，写回 scene.summary。 */
export async function wrap(sceneId) {
  if (settings.get().sceneSummary !== true) return '';
  const row = scene.get(sceneId);
  if (!row) throw new Error('这一场已经不在了');
  const text = await summarize(row, scene.beatsOf(sceneId), {
    key: `scene-wrap:${sceneId}`, maxTokens: 1200,
  });
  if (text) scene.update(sceneId, { summary: text, wrappedAt: Date.now() });
  return text;
}

/**
 * 窗口外的那些先压进摘要再挡掉。
 *
 * 窗口填 0（默认）时一段都挡不掉，这里直接返回 —— 所以默认既不多花钱，
 * 也没有任何行为变化。压到哪一段记在 compressedTo 上，不会重复压。
 */
export async function compressIfDue(sceneId) {
  const s = settings.get();
  if (s.sceneCompress !== true) return false;
  const n = Math.max(0, Math.round(Number(s.sceneWindow) || 0));
  if (!n) return false;
  const row = scene.get(sceneId);
  if (!row) return false;

  const body = scene.beatsOf(sceneId).filter(b => b.role !== scene.DIRECTOR);
  const out = body.slice(0, Math.max(0, body.length - n));
  if (!out.length) return false;
  const edge = out[out.length - 1].id;
  if (row.compressedTo === edge) return false;

  const since = row.compressedTo ? out.findIndex(b => b.id === row.compressedTo) + 1 : 0;
  const fresh = out.slice(since);
  if (!fresh.length) { scene.update(sceneId, { compressedTo: edge }); return false; }

  const text = await summarize(row, fresh, { key: `scene-compress:${sceneId}`, maxTokens: 900 });
  if (!text) return false;
  scene.update(sceneId, { summary: text, compressedTo: edge });
  return true;
}

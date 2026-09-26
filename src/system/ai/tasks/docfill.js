import { characters, chats, messages, messagesOf } from '../../db/index.js';
import * as docfile from '../../docfile.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask } from '../engine.js';

// 让角色单独填一份文件（ARCHITECTURE 4.271）。
//
// 平时填写是随回复一起写的，不多调接口。这里是文件卡上那个「让角色填写」按钮：
// **用户点了才调，一次一个请求**，把带编号的整篇交给模型，收回一份结构化结果，
// 不经过聊天回复的解析，也不受「文件正文最多带多少字」那个上限影响。表格大的时候用它。

export const key = msgId => `docfill:${msgId}`;

export async function fill(chatId, msgId) {
  const chat = chats.get(chatId);
  const src = messages.get(msgId);
  const char = characters.get((chat?.characterIds || [])[0]);
  if (!chat || !char) throw new Error('这段对话已不存在');
  if (!src || src.kind !== 'file' || !docfile.fillable(src.ext) || !src.fileId) throw new Error('这份文件不能在原文件上填');

  const recent = messagesOf(chatId).filter(m => m.status !== 'error' && m.kind !== 'side' && m.content)
    .slice(-8).map(m => `${m.role === 'user' ? 'User' : char.name}：${String(m.content).slice(0, 200)}`).join('\n');
  const system = fillTemplate(template('task.file-fill'), {
    charName: char.name || '该角色',
    charPersona: char.persona || '(no character card was written)',
    recent: recent || '(none)',
    doc: src.text || '',
  });
  const out = await runJSONTask('file.fill', { system, key: key(msgId), maxTokens: 4000 });
  const fills = (Array.isArray(out?.fills) ? out.fills : [])
    .filter(f => f && f.id != null).map(f => ({ id: String(f.id).trim(), text: String(f.text ?? '') }));
  if (!fills.length) throw new Error('模型没有给出任何填写内容');
  return docfile.deliverFill({ chatId, role: 'char', authorId: char.id, turnId: `fill-${Date.now()}` }, fills, src);
}

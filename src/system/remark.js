// 备注。两个方向，各存一处。见 ARCHITECTURE 4.200
//
//   **我给角色的备注**  挂在角色上（char.remark）。会话列表、会话标题、联系人列表显示它，
//                      没有就显示角色名。只是换个叫法：prompt 里照旧用角色的本名，
//                      另外告诉角色一句「对方把你存成了什么」。
//
//   **角色给我的备注**  挂在会话上（chat.charRemark）。同一个角色对不同身份的你各是各的，
//                      所以不挂在角色身上。角色在回复里写一行 [备注：…] 改它，
//                      会话里落一行提示；查它的手机时，「与你」那一栏显示的就是这个名字。
import { characters, chats, messages, personas } from './db/index.js';

export const MAX = 20;
export const clean = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, MAX);

/** 我给这个角色起的备注，没有就是空串 */
export const mineOf = char => clean(char?.remark);
/** 列表、标题上显示的名字：有备注用备注 */
export const nameOf = char => mineOf(char) || char?.name || '';
export function setMine(charId, text) {
  characters.update(charId, { remark: clean(text) });
}

/** 角色在这段会话里给我起的备注 */
export const theirsOf = chat => clean(chat?.charRemark);
/** 查角色手机时「与你」那一栏的名字：角色起的备注，没有就是我的身份名 */
export const shownToChar = chat => theirsOf(chat) || personas.get(chat?.personaId)?.name || '我';

/**
 * 角色改了对我的备注。落一行提示，正文进上下文，角色下一轮也看得见自己改过。
 * row 是这一轮回复的公共字段（turnId 在里面），重新生成这一轮时这行提示跟着被换掉。
 * 名字没变、或者空的，什么都不做。
 */
export function setTheirs(chatId, text, { char, row = {} } = {}) {
  const name = clean(text);
  const chat = chats.get(chatId);
  if (!chat || !name || name === theirsOf(chat)) return null;
  chats.update(chatId, { charRemark: name });
  return messages.create({
    chatId, role: 'char', authorId: char?.id || '', status: 'done', ...row,
    kind: 'notice', remark: name,
    content: `[${char?.name || '对方'}将你的备注改为「${name}」]`,
  });
}

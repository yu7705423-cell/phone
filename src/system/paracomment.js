import { readnotes, ebooks, characters } from './db/index.js';

// 段评。每一段正文旁边一个小气泡，点开是这一段的评论页。
//
// **评论挂在书上，不挂在某段对话上。** 多人共读本来就是几个角色评同一本书，
// 挂在会话上就得给每段对话各存一份，同一段话要存好几遍。
//
// 一段的身份是它在全书正文里的字符起点（见 book.paragraphsOf）。
//
// 上一版的「预读批注」按页存在同一个域里，没有作者字段。那些仍然读得出来，
// 显示成没有署名的一条 —— 不为一个刚加的功能做数据迁移。

export const CHAR = 'char';       // 你的角色
export const READER = 'reader';   // 临时编的读者，不入库，只留个名字
export const ME = 'me';

const nameOf = id => characters.get(id)?.name || '';

/** 这一段上的评论，早的在前。 */
export const listFor = (bookId, at) => readnotes
  .where(n => n.bookId === bookId && n.at === at && n.text)
  .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

/** 这一页里每一段各有几条。气泡上的数字用它，一次算完，不要一段查一次。 */
export function countsIn(bookId, from, span) {
  const map = new Map();
  for (const n of readnotes.where(x => x.bookId === bookId && x.text)) {
    if (n.at < from || n.at >= from + span) continue;
    map.set(n.at, (map.get(n.at) || 0) + 1);
  }
  return map;
}

export function add({ bookId, at, text, kind = CHAR, authorId = '', authorName = '' }) {
  const body = String(text || '').trim();
  if (!body) throw new Error('评论是空的');
  return readnotes.create({
    bookId, at: Math.max(0, Math.round(at) || 0),
    kind, authorId,
    authorName: authorName || nameOf(authorId) || '',
    text: body.slice(0, 600), createdAt: Date.now(),
  });
}

export const addMany = rows => rows.map(add);

export const remove = id => readnotes.remove(id);

export function clearAt(bookId, at) {
  const list = listFor(bookId, at);
  list.forEach(n => readnotes.remove(n.id));
  return list.length;
}

export const countFor = bookId =>
  readnotes.where(n => n.bookId === bookId && n.text).length;

/** 书没了，它身上的段评一起清掉。 */
export function dropBook(bookId) {
  readnotes.where(n => n.bookId === bookId).forEach(n => readnotes.remove(n.id));
}

// ---- 共读名单 ----
//
// 存在书上。第一次挑好谁参与，之后每一段点一下就生成，不必每段重挑。

export const crewOf = bookId => (ebooks.get(bookId)?.crew || [])
  .map(id => characters.get(id))
  .filter(Boolean);

export const setCrew = (bookId, ids) =>
  ebooks.update(bookId, { crew: [...new Set(ids)] });

/** 能进名单的：正经角色，不含 NPC 与马甲。 */
export const candidates = () => characters.all().filter(c => !c.isNpc && !c.parentId);

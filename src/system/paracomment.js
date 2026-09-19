import { readnotes, ebooks, videos, characters } from './db/index.js';

// 段评。书里是每一段旁边一个小气泡，影片里是每一句台词旁边一个。
//
// **评论挂在作品上，不挂在某段对话上。** 多人共读本来就是几个角色评同一本书，
// 挂在会话上就得给每段对话各存一份，同一段话要存好几遍。
//
// 一个锚点是「哪部作品 + 哪个位置」：
//
//   书   position = 这一段在全书正文里的**字符起点**（book.paragraphsOf）
//   影片 position = 这一句台词的**开始秒数**（subtitle 那边的 at）
//
// 两种坐标不通用，所以 subject 里带着类型：`book:xxx` / `video:xxx`。
//
// 早先只有书，那时的记录只写了 bookId 没写 subject。读的时候补上，
// 不为此做数据迁移。

export const CHAR = 'char';       // 你的角色
export const READER = 'reader';   // 临时编的读者，不入库，只留个名字
export const ME = 'me';

export const BOOK = 'book';
export const VIDEO = 'video';

const nameOf = id => characters.get(id)?.name || '';

/** 作品的身份。两种坐标不通用，类型得带着。 */
export const subjectOf = (kind, id) => `${kind}:${id}`;

// 早先只有书，那批记录没有 subject，靠 bookId 认
const rowSubject = n => n.subject || (n.bookId ? `${BOOK}:${n.bookId}` : '');

export const parseSubject = key => {
  const i = String(key || '').indexOf(':');
  return i < 0 ? { kind: BOOK, id: key || '' }
    : { kind: String(key).slice(0, i), id: String(key).slice(i + 1) };
};

/** 这个位置上的评论，早的在前。 */
export const listFor = (subject, at) => readnotes
  .where(n => rowSubject(n) === subject && n.at === at && n.text)
  .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

/**
 * 这一段区间里每个位置各有几条。气泡上的数字用它，一次算完，
 * 不要一段查一次。书按字符区间，影片按秒区间，都是同一个写法。
 */
export function countsIn(subject, from, span) {
  const map = new Map();
  for (const n of readnotes.where(x => rowSubject(x) === subject && x.text)) {
    if (n.at < from || n.at >= from + span) continue;
    map.set(n.at, (map.get(n.at) || 0) + 1);
  }
  return map;
}

export function add({ subject, at, text, kind = CHAR, authorId = '', authorName = '' }) {
  const body = String(text || '').trim();
  if (!body) throw new Error('评论是空的');
  const { kind: sKind, id } = parseSubject(subject);
  return readnotes.create({
    subject,
    // 书那一路仍然写 bookId：删书时按它清，早先的记录也按它认
    ...(sKind === BOOK ? { bookId: id } : { videoId: id }),
    at: Math.max(0, Math.round(at) || 0),
    kind, authorId,
    authorName: authorName || nameOf(authorId) || '',
    text: body.slice(0, 600), createdAt: Date.now(),
  });
}

export const addMany = rows => rows.map(add);

export const remove = id => readnotes.remove(id);

export function clearAt(subject, at) {
  const list = listFor(subject, at);
  list.forEach(n => readnotes.remove(n.id));
  return list.length;
}

export const countFor = subject =>
  readnotes.where(n => rowSubject(n) === subject && n.text).length;

/** 作品没了，它身上的段评一起清掉。 */
export function dropSubject(subject) {
  readnotes.where(n => rowSubject(n) === subject).forEach(n => readnotes.remove(n.id));
}

export const dropBook = bookId => dropSubject(subjectOf(BOOK, bookId));
export const dropVideo = videoId => dropSubject(subjectOf(VIDEO, videoId));

// ---- 共读名单 ----
//
// 存在书上。第一次挑好谁参与，之后每一段点一下就生成，不必每段重挑。

const workRow = subject => {
  const { kind, id } = parseSubject(subject);
  return kind === VIDEO ? { store: videos, id } : { store: ebooks, id };
};

export function crewOf(subject) {
  const { store, id } = workRow(subject);
  return (store.get(id)?.crew || []).map(cid => characters.get(cid)).filter(Boolean);
}

export function setCrew(subject, ids) {
  const { store, id } = workRow(subject);
  store.update(id, { crew: [...new Set(ids)] });
}

/** 能进名单的：正经角色，不含 NPC 与马甲。 */
export const candidates = () => characters.all().filter(c => !c.isNpc && !c.parentId);

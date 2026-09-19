import { characters, images, ebooks } from './db/index.js';
import { uid } from './store.js';
import * as book from './book.js';

// 角色的个人书架。
//
// **书架上的书默认是个占位**：只有书名、作者和一张封面，点开只会告诉你
// 还没导入。这是诚实的做法 —— 角色「读过」的书，文件本来就不在你这儿。
//
// 你自己导入同名的书之后，那一格就接上真书，能读、能一起读。
// 接的是 bookId，不是书名：书改了名也不会断。

const listRaw = charId => characters.get(charId)?.shelf || [];

const norm = s => String(s || '').trim().toLowerCase()
  .replace(/[《》「」【】\s]/g, '');

/** 书架上那几本。带上「这一格接没接上真书」。 */
export function listOf(charId) {
  return listRaw(charId).map(it => {
    const row = it.bookId ? ebooks.get(it.bookId) : null;
    return {
      ...it,
      book: row || null,
      real: !!row,
      percent: row ? book.percentOf(row) : 0,
    };
  });
}

function write(charId, next) {
  characters.update(charId, { shelf: next });
  return next;
}

export function add(charId, { title, author = '', coverUrl = '', cover = null, note = '' }) {
  const name = String(title || '').trim();
  if (!name) throw new Error('请填写书名');
  const list = listRaw(charId);
  if (list.some(it => norm(it.title) === norm(name))) throw new Error('书架上已经有这一本了');
  const item = { id: uid('shf'), title: name.slice(0, 80), author: String(author || '').slice(0, 40),
    coverUrl: String(coverUrl || ''), cover, note: String(note || '').slice(0, 200), bookId: null };
  // 库里已经有同名的书就直接接上
  const hit = ebooks.all().find(b => norm(b.title) === norm(name));
  if (hit) item.bookId = hit.id;
  write(charId, [...list, item]);
  return item;
}

export function setEntry(charId, entryId, patch) {
  write(charId, listRaw(charId).map(it => (it.id === entryId ? { ...it, ...patch } : it)));
}

export function remove(charId, entryId) {
  const it = listRaw(charId).find(x => x.id === entryId);
  if (it?.cover) images.remove(it.cover);
  write(charId, listRaw(charId).filter(x => x.id !== entryId));
}

/** 手动接上某一本真书，或者断开。断开之后这一格退回占位。 */
export const link = (charId, entryId, bookId) => setEntry(charId, entryId, { bookId: bookId || null });

/**
 * 刚导入一本书，把各个角色书架上同名的占位接上。
 * 导入的人不必知道谁的书架上有它。
 */
export function linkImported(bookId) {
  const row = ebooks.get(bookId);
  if (!row) return 0;
  let n = 0;
  for (const c of characters.all()) {
    const list = c.shelf || [];
    if (!list.length) continue;
    let dirty = false;
    const next = list.map(it => {
      if (it.bookId || norm(it.title) !== norm(row.title)) return it;
      dirty = true; n += 1;
      return { ...it, bookId };
    });
    if (dirty) characters.update(c.id, { shelf: next });
  }
  return n;
}

/** 一本书被删掉了，接着它的那几格退回占位。 */
export function unlinkBook(bookId) {
  for (const c of characters.all()) {
    const list = c.shelf || [];
    if (!list.some(it => it.bookId === bookId)) continue;
    characters.update(c.id, {
      shelf: list.map(it => (it.bookId === bookId ? { ...it, bookId: null } : it)),
    });
  }
}

/** 哪些角色有书架。一起看那个 app 的首页要列出来。 */
export const withShelf = () => characters.all()
  .filter(c => (c.shelf || []).length)
  .map(c => ({ id: c.id, name: c.name, avatar: c.avatar, count: (c.shelf || []).length }));

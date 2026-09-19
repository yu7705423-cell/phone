import { html, useState, useEffect, useRef } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, Button, Sheet, Spinner, EmptyState, toast } from '../../../ui/index.js';

const { db, nav, book } = phone;

const PAGE = book.PAGE;

// 一页一页地翻，按字数走。不做滚动式连续阅读：那样「读到哪儿了」
// 只能靠滚动位置猜，换个字号就对不上，角色那边也说不清人看到哪一段。
export function ReadPage({ bookId }) {
  useStore(db.ebooks.store);
  const row = db.ebooks.get(bookId);
  const [text, setText] = useState(() => book.peekText(bookId));
  const [at, setAt] = useState(row?.at || 0);
  const [toc, setToc] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    let alive = true;
    book.textOf(bookId).then(t => { if (alive) setText(t); });
    return () => { alive = false; };
  }, [bookId]);

  // 翻页之后回到顶部，并把进度记下来
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    book.setAt(bookId, at);
  }, [at, bookId]);

  if (!row) {
    return html`<${Page} title="阅读" onBack=${nav.pop}>
      <${EmptyState} title="这本书已经不在了"/><//>`;
  }
  if (!text) {
    return html`<${Page} title=${row.title} onBack=${nav.pop}>
      <div class="pad"><${Spinner} size=${18}/></div><//>`;
  }

  const chapter = book.chapterAt(row, at);
  const page = book.slice(text, at, PAGE);
  const canPrev = at > 0;
  const canNext = at + PAGE < text.length;
  const pct = Math.min(100, Math.round((at + page.length) / text.length * 100));

  const jump = to => setAt(Math.max(0, Math.min(text.length - 1, to)));

  return html`
    <${Page} title=${row.title} onBack=${nav.pop} noScroll
      right=${html`<button class="nav-text press" onClick=${() => setToc(true)}>目录</button>`}>
      <div class="rd">
        <div class="rd-body scroll" ref=${bodyRef}>
          ${chapter ? html`<div class="rd-chapter">${chapter.title}</div>` : null}
          ${page.split('\n').filter(l => l.trim()).map((p, i) => html`
            <p key=${i} class="rd-p">${p}</p>`)}
        </div>

        <div class="rd-bar">
          <button class="mu-ctl press" disabled=${!canPrev} aria-label="上一页"
            onClick=${() => jump(at - PAGE)}><${Icon} name="chevronLeft" size=${19}/></button>
          <div class="rd-meta">
            <span>${pct}%</span>
            <span class="rd-sub">
              ${(at + 1).toLocaleString()} – ${(at + page.length).toLocaleString()}
              / ${text.length.toLocaleString()} 字
            </span>
          </div>
          <button class="mu-ctl press" disabled=${!canNext} aria-label="下一页"
            onClick=${() => jump(at + PAGE)}><${Icon} name="chevronRight" size=${19}/></button>
        </div>
      </div>

      <${Sheet} open=${toc} onClose=${() => setToc(false)} title="目录" height="76%">
        <${List} inset=${false}>
          ${(row.chapters || []).map((c, i) => html`
            <${ListItem} key=${i} title=${c.title}
              subtitle=${`${Math.round(c.start / (row.chars || 1) * 100)}%`}
              right=${chapter && chapter.index === i ? html`<${Icon} name="check" size=${16}/>` : null}
              onClick=${() => { jump(c.start); setToc(false); }}/>`)}
        <//>
      <//>
    <//>`;
}

// 书的资料页：读、一起读、进度、章节
export function BookPage({ bookId }) {
  useStore(db.ebooks.store);
  useStore(db.chats.store);
  const row = db.ebooks.get(bookId);
  const [picking, setPicking] = useState(false);
  if (!row) {
    return html`<${Page} title="书" onBack=${nav.pop}>
      <${EmptyState} title="这本书已经不在了"/><//>`;
  }

  const chapter = book.chapterAt(row);
  const chats = db.chats.all().filter(c => (c.characterIds || []).length === 1);

  return html`
    <${Page} title=${row.title} onBack=${nav.pop}>
      <${List}>
        <${ListItem} title="继续阅读" arrow multiline
          subtitle=${row.at
            ? `读到 ${book.percentOf(row)}%${chapter ? ` · ${chapter.title}` : ''}`
            : '从头开始'}
          left=${html`<${Icon} name="book" size=${18}/>`}
          onClick=${() => nav.push(`/read/${row.id}`)}/>
        <${ListItem} title="和角色一起读" arrow multiline
          subtitle="选一个角色，边读边聊。角色看得到你正读到的那一段"
          left=${html`<${Icon} name="users" size=${18}/>`}
          onClick=${() => setPicking(true)}/>
      <//>

      <${List} title="这本书">
        <${ListItem} title="作者" subtitle=${row.author || '未填写'} multiline/>
        <${ListItem} title="字数" subtitle=${`${(row.chars || 0).toLocaleString()} 字`} multiline/>
        <${ListItem} title="章节" subtitle=${`${(row.chapters || []).length} 章`} multiline/>
        <${ListItem} title="格式" subtitle=${row.kind === 'epub' ? 'epub' : '纯文本'} multiline/>
      <//>

      <${Sheet} open=${picking} onClose=${() => setPicking(false)} title="和谁一起读" height="70%">
        <${List} inset=${false}>
          ${chats.map(c => {
            const ch = db.characters.get(c.characterIds[0]);
            return ch ? html`
              <${ListItem} key=${c.id} title=${ch.name} arrow
                subtitle=${ch.signature || ''}
                onClick=${() => { setPicking(false); nav.push(`/together/${c.id}/${row.id}`); }}/>` : null;
          })}
          ${chats.length ? null : html`<${ListItem} title="还没有会话" multiline
            subtitle="先在聊天里和一个角色说上话，再回来一起读"/>`}
        <//>
      <//>
    <//>`;
}

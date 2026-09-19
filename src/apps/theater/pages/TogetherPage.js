import { html, useState, useEffect, useRef } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, Sheet, Spinner, EmptyState, toast, confirm } from '../../../ui/index.js';

const { db, nav, book, read, ai } = phone;

const PAGE = book.PAGE;

// 和角色一起读。阅读页加一条「她说的话」，翻页时给她一次开口的机会。
export function TogetherPage({ chatId, bookId }) {
  useStore(db.ebooks.store);
  useStore(db.messages.store);
  useStore(read.read);
  const s = read.read.get();
  const row = db.ebooks.get(bookId);
  const chat = db.chats.get(chatId);
  const char = chat ? db.characters.get((chat.characterIds || [])[0]) : null;

  const [text, setText] = useState(() => book.peekText(bookId));
  const [busy, setBusy] = useState(false);
  const [toc, setToc] = useState(false);
  const bodyRef = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    let alive = true;
    book.textOf(bookId).then(t => { if (alive) setText(t); });
    return () => { alive = false; };
  }, [bookId]);

  // 进这一页就开场，退出去只是「离开」，不收场 —— 中途回一条消息还要接着读
  useEffect(() => {
    if (started.current || !row || !chat) return;
    started.current = true;
    try { read.start({ chatId, bookId }); read.markStart(); }
    catch (err) { toast(String(err.message || err), 'error'); }
    return () => read.away();
  }, [chatId, bookId, !!row, !!chat]);

  useEffect(() => { read.back(); }, []);

  if (!row || !chat || !char) {
    return html`<${Page} title="一起读" onBack=${nav.pop}>
      <${EmptyState} title="这本书或这段会话已经不在了"/><//>`;
  }
  if (!text) {
    return html`<${Page} title=${row.title} onBack=${nav.pop}>
      <div class="pad"><${Spinner} size=${18}/></div><//>`;
  }

  const at = s.active ? s.at : (row.at || 0);
  const page = book.slice(text, at, PAGE);
  const chapter = book.chapterAt(row, at);
  const pct = Math.min(100, Math.round((at + page.length) / text.length * 100));

  // 角色开口。一次调用，和聊天同一套接口，落进那段会话里
  const speak = async () => {
    if (busy || !ai.isConfigured()) return;
    setBusy(true);
    try {
      const raw = await ai.streamReply({ chat, char });
      const clean = String(raw || '').trim();
      if (clean) {
        await ai.reply.renderTurn({ chat, char, raw: clean, turnId: phone.uid('turn'), notify: true });
        read.markSaid();
      }
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };

  const turn = to => {
    const next = Math.max(0, Math.min(text.length - 1, to));
    read.setAt(next);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    if (read.due()) speak();
  };

  const finish = async () => {
    if (!await confirm({ title: '结束这一场', message: '会在会话中留下一条记录。书的进度保留。' })) return;
    read.stop();
    nav.pop();
  };

  // 她刚说的那几句
  const said = db.messagesOf(chatId).filter(m => m.role === 'char' && m.kind === 'text').slice(-2);

  return html`
    <${Page} title=${`和 ${char.name} 一起读`} onBack=${nav.pop} noScroll
      right=${html`<button class="nav-text press" onClick=${finish}>结束</button>`}>
      <div class="rd">
        <div class="rd-body scroll" ref=${bodyRef}>
          ${chapter ? html`<div class="rd-chapter">${chapter.title}</div>` : null}
          ${page.split('\n').filter(l => l.trim()).map((p, i) => html`
            <p key=${i} class="rd-p">${p}</p>`)}
        </div>

        ${said.length ? html`
          <div class="rd-say">
            <div class="rd-say-who">${char.name}</div>
            ${said.map(m => html`<div key=${m.id} class="rd-say-line">${m.content}</div>`)}
          </div>` : null}

        <div class="rd-bar">
          <button class="mu-ctl press" disabled=${at <= 0} aria-label="上一页"
            onClick=${() => turn(at - PAGE)}><${Icon} name="chevronLeft" size=${19}/></button>
          <button class="mu-ctl press" disabled=${busy} aria-label="让她说一句"
            onClick=${speak}>
            ${busy ? html`<${Spinner} size=${16}/>` : html`<${Icon} name="message" size=${18}/>`}
          </button>
          <div class="rd-meta">
            <span>${pct}%</span>
            <span class="rd-sub">${s.pages || 0} 页 · 她说了 ${s.said || 0} 次</span>
          </div>
          <button class="mu-ctl press" disabled=${at + PAGE >= text.length} aria-label="下一页"
            onClick=${() => turn(at + PAGE)}><${Icon} name="chevronRight" size=${19}/></button>
        </div>
      </div>

      <${Sheet} open=${toc} onClose=${() => setToc(false)} title="目录" height="76%">
        <${List} inset=${false}>
          ${(row.chapters || []).map((c, i) => html`
            <${ListItem} key=${i} title=${c.title}
              onClick=${() => { turn(c.start); setToc(false); }}/>`)}
        <//>
      <//>
    <//>`;
}

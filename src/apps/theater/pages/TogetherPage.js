import { html, useState, useEffect, useRef } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, IconButton, Sheet, Spinner, EmptyState, toast, confirm } from '../../../ui/index.js';
import { Paragraphs } from './Para.js';

const { db, nav, book, read, ai, readnotes } = phone;
const notesTask = ai.readNotes;

const PAGE = book.PAGE;

// 和角色一起读。阅读页加一条「她说的话」，翻页时给她一次开口的机会。
export function TogetherPage({ chatId, bookId }) {
  useStore(db.ebooks.store);
  useStore(db.messages.store);
  useStore(read.read);
  useStore(db.readnotes.store);
  useStore(db.settings.store);
  const s = read.read.get();
  const row = db.ebooks.get(bookId);
  const chat = db.chats.get(chatId);
  const char = chat ? db.characters.get((chat.characterIds || [])[0]) : null;

  const [text, setText] = useState(() => book.peekText(bookId));
  const [busy, setBusy] = useState(false);
  const [noting, setNoting] = useState(false);
  const [toc, setToc] = useState(false);
  const [open, setOpen] = useState(false);       // 她说的话默认收着
  const bodyRef = useRef(null);
  const started = useRef(false);
  const auto = useRef(null);

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

  useEffect(() => () => clearTimeout(auto.current), []);

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

  // 预读批注。一次把后面几页交给她，按页标出想说的话 —— 比一页一调省得多。
  const makeNotes = async () => {
    if (noting || !ai.isConfigured()) return;
    setNoting(true);
    try {
      const r = await notesTask.generate({ chatId, bookId, at });
      toast(r.added ? `批了 ${r.pages} 页，留下 ${r.added} 处` : `批了 ${r.pages} 页，这几页她没有话说`,
        r.added ? 'ok' : 'plain', 4000);
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setNoting(false); }
  };

  const turn = to => {
    const next = Math.max(0, Math.min(text.length - 1, to));
    read.setAt(next);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    // 自动预读：翻到还没批过的地方就批一批。默认关着（第 15 条）
    if (db.settings.get().readNotesAuto && next > readnotes.coveredTo(chatId, bookId)) {
      clearTimeout(auto.current);
      auto.current = setTimeout(makeNotes, 400);
    } else if (read.due()) speak();
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
      right=${html`
        <div class="nav-acts">
          <${IconButton} name=${noting ? 'clock' : 'notes'} label="预读批注"
            onClick=${makeNotes}/>
          <button class="nav-text press" onClick=${finish}>结束</button>
        </div>`}>
      <div class="rd">
        <div class="rd-body scroll" ref=${bodyRef}>
          ${chapter ? html`<div class="rd-chapter">${chapter.title}</div>` : null}
          <${Paragraphs} bookId=${bookId} text=${text} at=${at} span=${PAGE}
            onOpen=${to => nav.push(`/para/${bookId}/${to}`)}/>
        </div>

        ${said.length ? html`
          <div class=${`rd-say${open ? '' : ' is-folded'}`}>
            <button class="rd-say-head press" onClick=${() => setOpen(v => !v)}>
              <span class="rd-say-who">${char.name} · ${said.length} 句</span>
              <${Icon} name=${open ? 'chevronDown' : 'chevronUp'} size=${15}/>
            </button>
            ${open ? said.map(m => html`
              <div key=${m.id} class="rd-say-line">${m.content}</div>`) : null}
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

import { html, useState, useEffect, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, IconButton, Button, Sheet, Spinner,
         EmptyState, toast } from '../../../ui/index.js';
import { ReaderSettings } from './ReaderSettings.js';
import { ExcerptSheet } from './ExcerptSheet.js';
import { Paragraphs } from './Para.js';
import { ReadAheadSheet, ReadAheadWatch } from './ReadAhead.js';

const { db, nav, book, review, reader } = phone;

const PAGE = book.PAGE;
const OUT_MS = 170;
const IN_MS = 190;

// 一页一页地翻，按字数走。不做滚动式连续阅读：那样「读到哪儿了」
// 只能靠滚动位置猜，换个字号就对不上，角色那边也说不清人看到哪一段。
//
// 外观（纸色、字体、字号、翻页方式、全屏）存在 system/reader.js，
// 和全局主题分开 —— 读书时想要的那一套和 app 的皮肤本来就不是一回事。
export function ReadPage({ bookId }) {
  useStore(db.ebooks.store);
  useStore(db.settings.store);
  const row = db.ebooks.get(bookId);
  const [text, setText] = useState(() => book.peekText(bookId));
  const [at, setAt] = useState(row?.at || 0);
  const [toc, setToc] = useState(false);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [excerpting, setExcerpting] = useState(false);
  const [aheading, setAheading] = useState(false);
  const [anim, setAnim] = useState('');
  const [bare, setBare] = useState(false);     // 全屏时把顶栏收起来
  const bodyRef = useRef(null);
  const timers = useRef([]);

  const cfg = reader.get();
  const bgUrl = useImage(cfg.bgImage);

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

  useEffect(() => { reader.applyFont(cfg); }, [cfg.fontUrl, cfg.fontFamily]);

  // 进全屏就先把顶栏收起来；关掉全屏要让它回来，否则顶栏再也唤不出
  useEffect(() => { setBare(cfg.fullscreen); }, [cfg.fullscreen]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

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

  // 翻页动画：旧的一页先出去，换页，新的一页再进来。
  // 动画期间不接新的翻页请求，否则连点会让页码和位移对不上。
  const turn = dir => {
    if (anim) return;
    const to = at + dir * PAGE;
    if (to < 0 || to > text.length - 1) return;
    if (cfg.effect === 'instant') { jump(to); return; }
    const way = dir > 0 ? 'fwd' : 'back';
    setAnim(`fx-${cfg.effect} is-out is-${way}`);
    timers.current.push(setTimeout(() => {
      jump(to);
      setAnim(`fx-${cfg.effect} is-in is-${way}`);
      timers.current.push(setTimeout(() => setAnim(''), IN_MS));
    }, OUT_MS));
  };

  // 点左三分之一向前，右三分之一向后，中间呼出或收起顶栏
  const onTap = e => {
    if (!cfg.tapTurn) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    if (x < 0.33) turn(-1);
    else if (x > 0.67) turn(1);
    else if (cfg.fullscreen) setBare(v => !v);
  };

  const immersive = cfg.fullscreen && bare;
  const chrome = immersive ? {} : {
    title: row.title,
    onBack: nav.pop,
    right: html`
      <div class="nav-acts">
        <${IconButton} name="users" label="让角色先读" onClick=${() => setAheading(true)}/>
        <${IconButton} name="notes" label="书摘" onClick=${() => setExcerpting(true)}/>
        <${IconButton} name="settings" label="阅读设置" onClick=${() => setCfgOpen(true)}/>
        <button class="nav-text press" onClick=${() => setToc(true)}>目录</button>
      </div>`,
  };

  return html`
    <${Page} ...${chrome} noScroll>
      <div class=${`rd rd-paper-${cfg.paper}${immersive ? ' is-bare' : ''}`}
        style=${reader.varsOf(cfg, bgUrl)}>
        <div class="rd-tap" onClick=${onTap}>
          <div class=${`rd-body scroll ${anim}`} ref=${bodyRef}>
            ${chapter ? html`<div class="rd-chapter">${chapter.title}</div>` : null}
            <${Paragraphs} bookId=${bookId} text=${text} at=${at} span=${PAGE}
              onOpen=${to => nav.push(`/para/book/${bookId}/${to}`)}/>
          </div>
        </div>

        ${immersive ? null : html`<${ReadAheadWatch} bookId=${bookId} at=${at} span=${PAGE}/>`}

        ${immersive ? null : html`
          <div class="rd-bar">
            <button class="mu-ctl press" disabled=${!canPrev} aria-label="上一页"
              onClick=${() => turn(-1)}><${Icon} name="chevronLeft" size=${19}/></button>
            <div class="rd-meta">
              <span>${pct}%</span>
              <span class="rd-sub">
                ${(at + 1).toLocaleString()} – ${(at + page.length).toLocaleString()}
                / ${text.length.toLocaleString()} 字
              </span>
            </div>
            <button class="mu-ctl press" disabled=${!canNext} aria-label="下一页"
              onClick=${() => turn(1)}><${Icon} name="chevronRight" size=${19}/></button>
          </div>`}
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

      <${ReaderSettings} open=${cfgOpen} onClose=${() => setCfgOpen(false)}/>
      <${ExcerptSheet} open=${excerpting} bookId=${bookId} at=${at}
        onClose=${() => setExcerpting(false)}/>
      <${ReadAheadSheet} open=${aheading} bookId=${bookId} from=${at}
        onClose=${() => setAheading(false)}/>
    <//>`;
}

// 书的资料页：读、一起读、进度、章节
export function BookPage({ bookId }) {
  useStore(db.ebooks.store);
  useStore(db.chats.store);
  useStore(db.reviews.store);
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

      <${List} title=${`书评 · ${review.countFor(review.BOOK, row.id)} 篇`}>
        <${ListItem} title="角色写的书评" arrow multiline
          subtitle=${review.countFor(review.BOOK, row.id)
            ? '每写一篇都留着，重读之后再写不会冲掉旧的'
            : '让角色按你读到的内容写一篇。写一篇调用一次接口'}
          left=${html`<${Icon} name="notes" size=${18}/>`}
          onClick=${() => nav.push(`/reviews/book/${row.id}`)}/>
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

import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, IconButton, Sheet, EmptyState } from '../../ui/index.js';
import { VideosPage } from './pages/VideosPage.js';
import { WatchPage } from './pages/WatchPage.js';
import { BooksPage } from './pages/BooksPage.js';
import { ReadPage, BookPage } from './pages/ReadPage.js';
import { TogetherPage } from './pages/TogetherPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { ShelfPage } from './pages/ShelfPage.js';
import { ReviewsPage } from './pages/ReviewsPage.js';
import { ParaPage } from './pages/ParaPage.js';

const { db, nav, video, watch, book, read, shelf } = phone;

// 一起看。片库、播放，以及正在进行的那一场。
//
// 从聊天里拆出来是因为它不只属于某一段对话：片库是全局的，
// 而「和谁一起看」只是开场时挑的一个人。聊天那边点「一起看」走 Intent 过来。

// 进来先分两边：看的和读的。两边的东西本来就不共用，混在一页里
// 越加越长。切到哪一边记在模块上，退出去再进来还在原处。
const TABS = [{ id: 'video', label: '影片' }, { id: 'book', label: '书籍' }];
const tabState = { current: 'video' };

function TopSwitch({ value, onChange }) {
  return html`
    <div class="top-switch">
      ${TABS.map(t => html`
        <button key=${t.id} class=${`top-switch-item press${value === t.id ? ' is-active' : ''}`}
          onClick=${() => onChange(t.id)}>${t.label}</button>`)}
    </div>`;
}

function Home() {
  useStore(db.videos.store);
  useStore(db.ebooks.store);
  useStore(db.chats.store);
  useStore(db.characters.store);
  useStore(watch.watch);
  useStore(read.read);
  const [tab, setTabLocal] = useState(tabState.current);
  const setTab = id => { tabState.current = id; setTabLocal(id); };
  const [picking, setPicking] = useState(false);

  const s = watch.watch.get();
  const rs = read.read.get();
  const live = s.active ? db.chats.get(s.chatId) : null;
  const liveChar = live ? db.characters.get((live.characterIds || [])[0]) : null;
  const row = s.active ? db.videos.get(s.videoId) : null;
  const readChat = rs.active ? db.chats.get(rs.chatId) : null;
  const readChar = readChat ? db.characters.get((readChat.characterIds || [])[0]) : null;

  const shelves = shelf.withShelf();
  const reading = book.all().filter(b => b.at > 0).slice(0, 5);
  const recent = db.videos.all()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 5);

  const videoSide = html`
    ${live && row ? html`
      <${List} title="正在看">
        <${ListItem} title=${row.title} arrow multiline
          subtitle=${`和 ${liveChar?.name || '某个角色'} · ${s.playing ? '播放中' : '已暂停'}`}
          left=${html`<${Icon} name="film" size=${18}/>`}
          onClick=${() => nav.push(`/watch/${s.chatId}`)}/>
      <//>` : null}

    <${List}>
      <${ListItem} title="片库" subtitle=${`共 ${db.videos.count()} 部`} arrow multiline
        left=${html`<${Icon} name="film" size=${18}/>`}
        onClick=${() => nav.push('/videos')}/>
    <//>

    ${recent.length ? html`
      <${List} title="最近加入">
        ${recent.map(v => html`
          <${ListItem} key=${v.id} title=${v.title} arrow multiline
            subtitle=${video.hasSubtitle(v)
              ? `字幕 ${video.linesOf(v).length} 句`
              : '没有字幕。角色只知道进度，不知道演了什么'}
            left=${html`<${Icon} name="film" size=${18}/>`}
            onClick=${() => nav.push('/videos')}/>`)}
      <//>` : null}

    ${db.videos.count() ? null : html`
      <${EmptyState} icon="film" title="片库是空的"
        desc="在片库中添加一个播放地址，或者选择一个本机视频文件。"/>`}

    <div class="settings-foot">
      影片在会话的输入面板中点「一起看」开场。
    </div>`;

  const bookSide = html`
    ${rs.active && readChat ? html`
      <${List} title="正在读">
        <${ListItem} title=${db.ebooks.get(rs.bookId)?.title || '一本书'} arrow multiline
          subtitle=${`和 ${readChar?.name || '某个角色'} · 已翻 ${rs.pages} 页`}
          left=${html`<${Icon} name="book" size=${18}/>`}
          onClick=${() => nav.push(`/together/${rs.chatId}/${rs.bookId}`)}/>
      <//>` : null}

    <${List}>
      <${ListItem} title="书库" subtitle=${`共 ${db.ebooks.count()} 本`} arrow multiline
        left=${html`<${Icon} name="book" size=${18}/>`}
        onClick=${() => nav.push('/books')}/>
    <//>

    ${reading.length ? html`
      <${List} title="在读">
        ${reading.map(b => html`
          <${ListItem} key=${b.id} title=${b.title} arrow multiline
            subtitle=${`${b.author ? b.author + ' · ' : ''}读到 ${book.percentOf(b)}%`}
            left=${html`<${Icon} name="book" size=${18}/>`}
            onClick=${() => nav.push(`/book/${b.id}`)}/>`)}
      <//>` : null}

    <${List} title="角色的书架">
      ${shelves.map(c => html`
        <${ListItem} key=${c.id} title=${`${c.name} 的书架`} arrow multiline
          subtitle=${`${c.count} 本`}
          left=${html`<${Icon} name="book" size=${18}/>`}
          onClick=${() => nav.push(`/shelf/${c.id}`)}/>`)}
      <${ListItem} title="给某个角色摆一个书架" arrow multiline
        subtitle="从角色卡进去，或者在这里挑一个角色"
        left=${html`<${Icon} name="plus" size=${18}/>`}
        onClick=${() => setPicking(true)}/>
    <//>

    ${db.ebooks.count() ? null : html`
      <${EmptyState} icon="book" title="书库是空的"
        desc="在书库中导入一个 txt 或 epub 文件。"/>`}

    <div class="settings-foot">
      书在书里点「和角色一起读」开场。
    </div>`;

  return html`
    <${Page} title="一起看"
      right=${html`<${IconButton} name="settings" label="设置"
        onClick=${() => nav.push('/settings')}/>`}
      headerExtra=${html`<${TopSwitch} value=${tab} onChange=${setTab}/>`}>
      ${tab === 'video' ? videoSide : bookSide}

      <${Sheet} open=${picking} onClose=${() => setPicking(false)} title="给谁摆书架" height="70%">
        <${List} inset=${false}>
          ${db.characters.all().filter(c => !c.parentId).map(c => html`
            <${ListItem} key=${c.id} title=${c.name} arrow
              subtitle=${`${(c.shelf || []).length} 本`}
              onClick=${() => { setPicking(false); nav.push(`/shelf/${c.id}`); }}/>`)}
          ${db.characters.count() ? null : html`<${ListItem} title="还没有角色" multiline
            subtitle="先在「联系」里建一个角色"/>`}
        <//>
      <//>
    <//>`;
}

export default function TheaterApp({ route }) {
  if (route === '/videos') return html`<${VideosPage}/>`;
  if (route === '/books') return html`<${BooksPage}/>`;
  const bk = route?.match(/^\/book\/(.+)$/);
  if (bk) return html`<${BookPage} bookId=${bk[1]}/>`;
  const rd = route?.match(/^\/read\/(.+)$/);
  if (rd) return html`<${ReadPage} bookId=${rd[1]}/>`;
  const tg = route?.match(/^\/together\/([^/]+)\/(.+)$/);
  if (tg) return html`<${TogetherPage} chatId=${tg[1]} bookId=${tg[2]}/>`;
  if (route === '/settings') return html`<${SettingsPage}/>`;
  const sh = route?.match(/^\/shelf\/(.+)$/);
  if (sh) return html`<${ShelfPage} charId=${sh[1]}/>`;
  const pa = route?.match(/^\/para\/([^/]+)\/(\d+)$/);
  if (pa) return html`<${ParaPage} bookId=${pa[1]} at=${Number(pa[2])}/>`;

  const rv = route?.match(/^\/reviews\/(video|book)\/(.+)$/);
  if (rv) return html`<${ReviewsPage} kind=${rv[1]} subjectId=${rv[2]}/>`;
  const w = route?.match(/^\/watch\/(.+)$/);
  if (w) return html`<${WatchPage} chatId=${w[1]}/>`;
  return html`<${Home}/>`;
}

import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState } from '../../ui/index.js';
import { VideosPage } from './pages/VideosPage.js';
import { WatchPage } from './pages/WatchPage.js';
import { BooksPage } from './pages/BooksPage.js';
import { ReadPage, BookPage } from './pages/ReadPage.js';

const { db, nav, video, watch, book } = phone;

// 一起看。片库、播放，以及正在进行的那一场。
//
// 从聊天里拆出来是因为它不只属于某一段对话：片库是全局的，
// 而「和谁一起看」只是开场时挑的一个人。聊天那边点「一起看」走 Intent 过来。

function Home() {
  useStore(db.videos.store);
  useStore(db.ebooks.store);
  useStore(db.chats.store);
  useStore(watch.watch);
  const s = watch.watch.get();
  const live = s.active ? db.chats.get(s.chatId) : null;
  const liveChar = live ? db.characters.get((live.characterIds || [])[0]) : null;
  const row = s.active ? db.videos.get(s.videoId) : null;

  const reading = book.all().filter(b => b.at > 0).slice(0, 5);
  const recent = db.videos.all()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 5);

  return html`
    <${Page} title="一起看">
      ${live && row ? html`
        <${List} title="正在看">
          <${ListItem} title=${row.title} arrow multiline
            subtitle=${`和 ${liveChar?.name || '某个角色'} · ${s.playing ? '播放中' : '已暂停'}`}
            left=${html`<${Icon} name="film" size=${18}/>`}
            onClick=${() => nav.push(`/watch/${s.chatId}`)}/>
        <//>` : null}

      <${List} title="片库与书库">
        <${ListItem} title="全部影片" subtitle=${`共 ${db.videos.count()} 部`} arrow multiline
          left=${html`<${Icon} name="film" size=${18}/>`}
          onClick=${() => nav.push('/videos')}/>
        <${ListItem} title="全部书籍" subtitle=${`共 ${db.ebooks.count()} 本`} arrow multiline
          left=${html`<${Icon} name="book" size=${18}/>`}
          onClick=${() => nav.push('/books')}/>
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

      ${reading.length ? html`
        <${List} title="在读">
          ${reading.map(b => html`
            <${ListItem} key=${b.id} title=${b.title} arrow multiline
              subtitle=${`${b.author ? b.author + ' · ' : ''}读到 ${book.percentOf(b)}%`}
              left=${html`<${Icon} name="book" size=${18}/>`}
              onClick=${() => nav.push(`/book/${b.id}`)}/>`)}
        <//>` : null}

      ${db.videos.count() || db.ebooks.count() ? null : html`
        <${EmptyState} icon="film" title="还没有片子，也没有书"
          desc="片库里添加一个播放地址或本机视频文件，书库里导入 txt 或 epub。"/>`}

      <div class="settings-foot">
        在会话的输入面板中点「一起看」，即可与该角色开始一场。
      </div>
    <//>`;
}

export default function TheaterApp({ route }) {
  if (route === '/videos') return html`<${VideosPage}/>`;
  if (route === '/books') return html`<${BooksPage}/>`;
  const bk = route?.match(/^\/book\/(.+)$/);
  if (bk) return html`<${BookPage} bookId=${bk[1]}/>`;
  const rd = route?.match(/^\/read\/(.+)$/);
  if (rd) return html`<${ReadPage} bookId=${rd[1]}/>`;
  const w = route?.match(/^\/watch\/(.+)$/);
  if (w) return html`<${WatchPage} chatId=${w[1]}/>`;
  return html`<${Home}/>`;
}

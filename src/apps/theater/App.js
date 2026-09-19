import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState } from '../../ui/index.js';
import { VideosPage } from './pages/VideosPage.js';
import { WatchPage } from './pages/WatchPage.js';

const { db, nav, video, watch } = phone;

// 一起看。片库、播放，以及正在进行的那一场。
//
// 从聊天里拆出来是因为它不只属于某一段对话：片库是全局的，
// 而「和谁一起看」只是开场时挑的一个人。聊天那边点「一起看」走 Intent 过来。

function Home() {
  useStore(db.videos.store);
  useStore(db.chats.store);
  useStore(watch.watch);
  const s = watch.watch.get();
  const live = s.active ? db.chats.get(s.chatId) : null;
  const liveChar = live ? db.characters.get((live.characterIds || [])[0]) : null;
  const row = s.active ? db.videos.get(s.videoId) : null;

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

      <${List} title="片库">
        <${ListItem} title="全部影片" subtitle=${`共 ${db.videos.count()} 部`} arrow multiline
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
          desc="在片库中添加一个播放地址或本机视频文件。字幕可以从视频中读取，也可以自行粘贴。"/>`}

      <div class="settings-foot">
        在会话的输入面板中点「一起看」，即可与该角色开始一场。
      </div>
    <//>`;
}

export default function TheaterApp({ route }) {
  if (route === '/videos') return html`<${VideosPage}/>`;
  const w = route?.match(/^\/watch\/(.+)$/);
  if (w) return html`<${WatchPage} chatId=${w[1]}/>`;
  return html`<${Home}/>`;
}

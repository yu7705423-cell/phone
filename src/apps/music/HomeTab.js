import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { List, ListItem, Icon, Spinner } from '../../ui/index.js';
import { Cover, NeedLogin, useRemote, Failed } from './parts.js';

const { db, nav, netease, player } = phone;
const svc = phone.ai.services;

// 首页。只放两样：刚才在听什么、手里有哪些歌单。
//
// 不做推荐位、不做排行榜、不做电台 —— 那些是网易云用来卖歌的地方，
// 这个 app 要的是「我自己的那点东西，随手就能点开」。

export function HomeTab() {
  useStore(db.settings.store);
  const cfg = svc.neteaseConfig();
  const logged = !!cfg.cookie;

  const recent = useRemote(
    () => (logged ? netease.recent('', 12, { covers: true }).then(r => r.songs) : Promise.resolve([])),
    [logged]);
  const lists = useRemote(
    () => (logged ? netease.playlistsOf('') : Promise.resolve([])), [logged]);

  const gate = NeedLogin({ ready: svc.neteaseReady(), logged });
  if (gate) return gate;

  if (recent.loading && lists.loading) {
    return html`<div class="mu-wait"><${Spinner}/></div>`;
  }

  const songs = recent.data || [];
  const playAll = at => player.play(songs, at);

  return html`
    <div class="mu-page">
      <div class="mu-sec">
        <span>最近播放</span>
        ${songs.length ? html`
          <button class="nav-text press" onClick=${() => playAll(0)}>全部播放</button>` : null}
      </div>
      ${recent.err
        ? html`<${Failed} err=${recent.err} onRetry=${recent.reload}/>`
        : songs.length
          ? html`<div class="mu-strip">
              ${songs.map((t, i) => html`
                <button key=${t.id} class="mu-card press" onClick=${() => playAll(i)}>
                  <${Cover} src=${t.cover} name=${t.title} size=${104} radius="var(--r-lg)"/>
                  <div class="mu-card-name ellipsis">${t.title}</div>
                  <div class="mu-card-sub ellipsis">${t.artist}</div>
                </button>`)}
            </div>`
          : html`<div class="settings-foot">
              该账号暂无播放记录。在网易云客户端或本页播放后，此处会显示最近听过的曲目。
            </div>`}

      <${List} title=${`我的歌单 · ${(lists.data || []).length}`}>
        ${(lists.data || []).map(p => html`
          <${ListItem} key=${p.id} title=${p.name} subtitle=${`${p.count} 首${p.mine ? '' : ' · 收藏'}`}
            multiline arrow
            left=${html`<${Cover} src=${p.cover} name=${p.name} size=${40}/>`}
            onClick=${() => nav.push(`/list/${p.id}`)}/>`)}
        ${lists.err ? html`<${ListItem} title="歌单读取失败" subtitle=${lists.err} multiline/>` : null}
        ${!lists.err && !(lists.data || []).length && !lists.loading
          ? html`<${ListItem} title="该账号下没有歌单"/>` : null}
      <//>

      <${List} title="本机曲库">
        <${ListItem} title=${`已收 ${phone.music.allSongs().length} 首`} multiline arrow
          subtitle="上传本机音频、填写播放地址、编辑歌词。该曲库供会话中的「一起听」选曲使用"
          left=${html`<${Icon} name="database" size=${18}/>`}
          onClick=${() => nav.push('/library')}/>
      <//>

      <div class="settings-foot">
        本页的数据来自你登录的网易云账号，读取时不经过模型接口。
      </div>
    </div>`;
}

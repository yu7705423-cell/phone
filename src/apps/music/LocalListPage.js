import { html } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Page, Button, EmptyState, toast, confirm } from '../../ui/index.js';
import { TrackRow, Cover, NowBar } from './parts.js';

const { db, nav, music, player } = phone;

// 本机的一个歌单：我自己建的，或者角色在会话里建的（owner 是角色 id）。
// 和 PlaylistPage 的区别：那边是网易云账号上的歌单，只能看、只能放；
// 这边的歌单在本机，能从里面拿掉一首、能整个删掉。
//
// 从会话里的一起听那一页进来时路由带着 chatId，页面上多一个「一起听」。
export function LocalListPage({ id, chatId = '' }) {
  useStore(db.playlists.store);
  useStore(db.songs.store);
  const list = db.playlists.get(id);
  const tracks = list ? music.tracksOf(id) : [];
  const first = tracks[0];
  const firstCover = useImage(first?.coverId);

  if (!list) {
    return html`<${Page} title="歌单" onBack=${nav.pop}>
      <${EmptyState} icon="music" title="该歌单已删除"/><//>`;
  }

  const owner = list.owner === music.LIB_OWNER ? null : db.characters.get(list.owner);
  const whose = list.owner === music.LIB_OWNER ? '我的歌单' : `${owner?.name || '已删除的角色'}的歌单`;
  const chat = chatId ? db.chats.get(chatId) : null;
  const canListen = !!chat && !phone.group.isGroup(chat) && tracks.length > 0;

  const together = () => {
    try { phone.listen.start({ chatId, listId: id }); toast('已开始一起听', 'ok'); nav.pop(); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };
  const drop = async song => {
    music.removeTrack(id, song.id);
    toast(`已从歌单中移除「${song.title}」`);
  };
  const dropList = async () => {
    if (!await confirm({ title: '删除歌单', message: `将删除「${list.name}」。曲库中的歌曲不受影响。`, okText: '删除', danger: true })) return;
    music.removeList(id);
    nav.pop();
  };

  return html`
    <${Page} title=${list.name} onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${dropList}>删除</button>`}>
      <div class="mu-page">
        <div class="mu-head">
          <${Cover} src=${first?.cover || firstCover} name=${list.name} size=${88} radius="var(--r-lg)"/>
          <div>
            <div class="mu-head-n">${whose} · 共 ${tracks.length} 首</div>
            <div class="btn-row is-chips">
              <${Button} size="sm" icon="play" disabled=${!tracks.length}
                onClick=${() => player.play(tracks, 0)}>播放<//>
              ${canListen ? html`<${Button} size="sm" variant="ghost" icon="headphone"
                onClick=${together}>一起听<//>` : null}
            </div>
          </div>
        </div>

        ${tracks.length ? html`
          <div class="mu-list">
            ${tracks.map((t, i) => html`
              <${TrackRow} key=${t.id} track=${t} index=${i + 1}
                onPlay=${() => player.play(tracks, i)}
                right=${html`<button class="nav-text press"
                  onClick=${e => { e.stopPropagation(); drop(t); }}>移除</button>`}/>`)}
          </div>` : html`
          <${EmptyState} icon="music" title="歌单是空的"
            desc=${owner ? '角色在会话中加入歌曲后会出现在这里。' : '可在会话中长按分享的歌曲加入此歌单。'}/>`}
        <div class="settings-foot">从歌单中移除歌曲不会将其移出曲库。</div>
      </div>
      <${NowBar} safe/>
    <//>`;
}

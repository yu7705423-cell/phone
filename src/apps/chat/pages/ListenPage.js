import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Button, Icon,
         Sheet, EmptyState, toast, confirm, prompt } from '../../../ui/index.js';

const { db, nav, music, listen } = phone;

function SongRow({ song, right, onTap }) {
  return html`
    <${ListItem} title=${song.title}
      subtitle=${song.artist
    || (song.source === 'netease' ? '网易云' : song.url ? '外部地址' : '本地文件')}
      right=${right} onClick=${onTap}/>`;
}

export function ListenPage({ chatId }) {
  useStore(db.songs.store);
  useStore(db.playlists.store);
  useStore(db.chats.store);
  const s = useStore(listen.listen);
  const [picking, setPicking] = useState(null);   // 往哪个歌单里加歌

  const chat = db.chats.get(chatId);
  const char = db.characters.get((chat?.characterIds || [])[0]);
  const lib = music.allSongs();
  const mine = music.allLists(music.LIB_OWNER);
  const hers = char ? music.allLists(char.id) : [];
  const total = listen.totals(chatId);
  const live = listen.inChat(chatId);

  // 曲库归音乐 app 管：加歌、传音频、改歌词都在那边，这里只管挑来一起听。
  // 一个开关只能有一个入口，见 CLAUDE.md 第 5 条。
  const openLib = () => phone.intent.open('music', { route: '/library' });

  const startList = id => {
    try { listen.start({ chatId, listId: id }); nav.pop(); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };
  const startSong = id => {
    try { listen.start({ chatId, songId: id }); nav.pop(); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };

  const newList = async () => {
    const name = await prompt({ title: '新建歌单', okText: '创建' });
    if (!name || !name.trim()) return;
    try { music.createList({ name }); } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const dropList = async p => {
    if (!await confirm({ title: '删除歌单', message: p.name, danger: true })) return;
    music.removeList(p.id);
  };

  return html`
    <${Page} title="一起听" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${openLib}>曲库</button>`}>

      ${live && listen.current() ? html`
        <${List} title="正在播放">
          <${ListItem} title=${listen.current().title} arrow
            subtitle=${[listen.current().artist, s.playing ? '播放中' : '已暂停'].filter(Boolean).join(' · ')}
            left=${html`<${Icon} name="music" size=${18}/>`}
            onClick=${() => phone.intent.open('music', { route: '/now/listen', back: true })}/>
        <//>` : null}

      <${List} title="一起听了多久">
        <${ListItem} title="累积" multiline
          subtitle=${total.count
            ? `和${char?.name || '对方'}一共听了 ${listen.fmt(total.seconds)}，${total.count} 首`
            : '还没有一起听过'}/>
        ${live ? html`
          <${ListItem} title="本次" multiline
            subtitle=${`${listen.fmt(s.seconds)}，${s.count} 首`}
            right=${html`<button class="nav-text press"
              onClick=${() => listen.stop()}>结束</button>`}/>` : null}
      <//>

      ${hers.length ? html`
        <${List} title=${`${char?.name || '角色'}建的歌单`}>
          ${hers.map(p => html`
            <${ListItem} key=${p.id} title=${p.name}
              subtitle=${`${(p.trackIds || []).length} 首`} arrow
              onClick=${() => startList(p.id)}/>`)}
        <//>` : null}

      <${List} title="我的歌单">
        ${mine.map(p => html`
          <${ListItem} key=${p.id} title=${p.name}
            subtitle=${`${(p.trackIds || []).length} 首`}
            right=${html`<span class="row-acts">
              <button class="nav-text press" onClick=${e => { e.stopPropagation(); setPicking(p.id); }}>加歌</button>
              <button class="nav-text press" onClick=${e => { e.stopPropagation(); dropList(p); }}>删除</button>
            </span>`}
            onClick=${() => startList(p.id)}/>`)}
        <${ListItem} title="新建歌单" arrow
          left=${html`<${Icon} name="plus" size=${18}/>`} onClick=${newList}/>
      <//>

      ${lib.length ? html`
        <${List} title=${`曲库 · ${lib.length} 首`}>
          ${lib.map(song => html`
            <${SongRow} key=${song.id} song=${song} onTap=${() => startSong(song.id)}/>`)}
          <${ListItem} title="管理曲库" arrow multiline
            subtitle="在音乐中上传音频、填写播放地址、编辑歌词"
            left=${html`<${Icon} name="database" size=${18}/>`}
            onClick=${openLib}/>
        <//>`
      : html`<${EmptyState} icon="music" title="曲库是空的"
          desc="曲库在音乐中管理：可上传本机音频、填写播放地址，或收入网易云的曲目。"
          action=${html`<${Button} size="sm" icon="database" onClick=${openLib}>前往曲库<//>`}/>`}

      <div class="settings-foot">
        点击歌单或单曲即可开始一起听。播放期间可在会话顶部控制。
      </div>

      <${Sheet} open=${!!picking} onClose=${() => setPicking(null)} title="选择要加入的歌曲" height="70%">
        <${List} inset=${false}>
          ${lib.map(song => html`
            <${SongRow} key=${song.id} song=${song}
              onTap=${() => { music.addTrack(picking, song.id); toast('已加入'); }}/>`)}
        <//>
        ${lib.length ? null : html`<div class="settings-foot">曲库是空的。</div>`}
      <//>
    <//>`;
}

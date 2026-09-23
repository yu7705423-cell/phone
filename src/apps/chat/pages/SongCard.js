import { html, useState } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Sheet, List, ListItem, Input, Button, Icon, toast } from '../../../ui/index.js';

const { db, music } = phone;

// 一首歌的卡片。会话里角色分享的那一条、朋友圈里带的那一首，都是这一张。
//
//   songId  找到了的那首（在曲库里）
//   query   角色写的那串「歌名 - 歌手」，还没找到时拿它显示
//   state   pending 正在找 / missing 两处都没有
//
// 点一下放这首，并进音乐的「正在播放」。
export function SongCard({ songId, query = '', state = '', cls = '' }) {
  useStore(db.songs.store);
  const song = songId ? db.songs.get(songId) : null;
  const local = useImage(song?.coverId);
  const [bad, setBad] = useState(false);
  const pic = !bad && (song?.cover || local);
  const q = music.splitQuery(query);
  const title = song?.title || q.title || '一首歌';
  const sub = song ? (song.artist || '分享歌曲')
    : state === 'pending' ? '正在找这首歌'
    : phone.netease.ready() ? '曲库与网易云里都没有找到这首歌'
    : '曲库里没有这首歌。配置音乐服务后可从网易云找到';
  const play = e => {
    e.stopPropagation();
    if (!song) return;
    phone.player.play([song], 0);
    phone.intent.open('music', { route: '/now', back: true });
  };
  return html`
    <button class=${`song-card press${song ? '' : ' is-off'} ${cls}`} onClick=${play}
      aria-label=${song ? `播放 ${title}` : title}>
      <span class="song-cover">
        ${pic ? html`<img src=${pic} alt="" referrerpolicy="no-referrer" onError=${() => setBad(true)}/>`
          : html`<${Icon} name="music" size=${20}/>`}
      </span>
      <span class="song-main">
        <span class="song-title ellipsis">${title}</span>
        <span class="song-sub ellipsis">${sub}</span>
      </span>
      ${song ? html`<${Icon} name="play" size=${18} class="song-play"/>` : null}
    </button>`;
}

/**
 * 挑一首歌。先列曲库（输入框按歌名、歌手筛）；配了网易云的，
 * 输入之后可以去那边搜，选中的那首收进曲库。选好回调 onPick(song)。
 */
export function SongPicker({ open, onClose, onPick }) {
  useStore(db.songs.store);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);     // 网易云搜回来的；null 表示还没搜
  const [busy, setBusy] = useState(false);
  const key = q.trim().toLowerCase();
  const lib = music.allSongs().filter(s => !key
    || `${s.title} ${s.artist || ''}`.toLowerCase().includes(key));
  const ne = phone.netease.ready();

  const search = async () => {
    if (!key || busy) return;
    setBusy(true);
    try { setHits(await phone.netease.search(q.trim(), 20)); }
    catch (err) { toast(String(err.message || err), 'error', 4000); setHits([]); }
    finally { setBusy(false); }
  };
  const pick = song => { onPick(song); setQ(''); setHits(null); onClose(); };

  return html`
    <${Sheet} open=${open} onClose=${onClose} title="选择歌曲" height="75%">
      <div class="song-search">
        <${Input} value=${q} placeholder=${ne ? '歌名或歌手' : '在曲库中筛选'}
          onInput=${v => { setQ(v); setHits(null); }}
          onKeyDown=${e => { if (e.key === 'Enter') search(); }}/>
        ${ne ? html`<${Button} size="sm" onClick=${search} disabled=${!key || busy}>
          ${busy ? '搜索中' : '搜索网易云'}<//>` : null}
      </div>
      ${hits ? html`
        <${List} title="网易云" inset=${false}>
          ${hits.map(t => html`
            <${ListItem} key=${t.id} title=${t.title} subtitle=${t.artist}
              onClick=${() => pick(music.fromNetease(t))}/>`)}
          ${hits.length ? null : html`<${ListItem} title="没有搜到结果"/>`}
        <//>` : null}
      <${List} title=${`曲库 · ${lib.length} 首`} inset=${false}>
        ${lib.map(s => html`
          <${ListItem} key=${s.id} title=${s.title}
            subtitle=${s.artist || (s.source === 'netease' ? '网易云' : '本地')}
            onClick=${() => pick(s)}/>`)}
      <//>
      ${lib.length || hits ? null : html`<div class="settings-foot">
        ${ne ? '曲库中没有匹配的歌曲。输入歌名后可搜索网易云。'
          : '曲库是空的。可在音乐中添加歌曲，或在设置中配置音乐服务后搜索网易云。'}
      </div>`}
    <//>`;
}

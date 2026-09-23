import { html, useState, useEffect } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Sheet, List, ListItem, Input, Button, Icon, toast } from '../../../ui/index.js';

const { db, music } = phone;

// 一首歌的卡片。会话里分享的那一条、朋友圈里带的那一首，都是这一张。
//
// 照 Apple Music 分享出去的那张卡片的样子：
//
//   tile（会话里）  上面整幅方形封面，右下角一个圆形播放键；下面一栏歌名、歌手、来源
//   row （朋友圈）  封面在左，文字居中，播放键在右，一行放得下
//
// 底色取封面的主色，和面板底色按比例混一下 —— 每首歌的卡片颜色各不相同，
// 一眼认得出是哪首；混进去的只有两成多，仍然是低饱和的底色（CLAUDE.md 第 4 条）。
// 取不到颜色（网易云的图不许跨域读像素）就用面板底色。
//
// 播放键就地放、就地停，不跳页；正在放的这首，播放键外面一圈是进度。
// 点卡片其余地方进音乐的「正在播放」看歌词。
//
//   songId  找到了的那首（在曲库里）
//   query   「歌名 - 歌手」，还没找到时拿它显示
//   state   pending 正在找 / missing 两处都没有

// 取主色：缩成 16×16，按饱和度加权求平均。太白、太黑的像素不算 ——
// 专辑封面四周常有一圈白边或黑底，平均进去整张卡就灰了
const tintCache = new Map();
function useTint(src) {
  const [tint, setTint] = useState(() => tintCache.get(src) || '');
  useEffect(() => {
    if (!src) { setTint(''); return undefined; }
    if (tintCache.has(src)) { setTint(tintCache.get(src)); return undefined; }
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      let out = '';
      try {
        const c = document.createElement('canvas');
        c.width = 16; c.height = 16;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, 16, 16);
        const d = g.getImageData(0, 0, 16, 16).data;
        let r = 0, gg = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]);
          const min = Math.min(d[i], d[i + 1], d[i + 2]);
          if (max < 24 || min > 232) continue;
          const k = 0.15 + (max - min) / 255;
          r += d[i] * k; gg += d[i + 1] * k; b += d[i + 2] * k; w += k;
        }
        if (w) out = `rgb(${Math.round(r / w)} ${Math.round(gg / w)} ${Math.round(b / w)})`;
      } catch { /* 跨域的图读不了像素，照常用面板底色 */ }
      tintCache.set(src, out);
      if (alive) setTint(out);
    };
    img.onerror = () => { tintCache.set(src, ''); if (alive) setTint(''); };
    img.src = src;
    return () => { alive = false; };
  }, [src]);
  return tint;
}

// 播放键外面那一圈进度。只有正在放的这首才每半秒取一次位置
function useProgress(on) {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const read = () => {
      const d = phone.player.player.get().duration || 0;
      setP(d ? Math.min(1, phone.player.position() / d) : 0);
    };
    read();
    const t = setInterval(read, 500);
    return () => clearInterval(t);
  }, [on]);
  return p;
}

const RING = 2 * Math.PI * 17;

// 这一首在播放器里是什么状态：0 不是它，1 是它但停着，2 正在放。
//
// **不用 useStore 整个订阅播放器。** 播放器每秒更新一次秒数，整个订阅的话，
// 聊天记录里有几十张歌曲卡片，每秒就几十张一起重画 —— 而它们要显示的东西
// 一个都没变。这里只在「是不是它、放没放」变了的时候才更新，同一个数不会触发重画
function usePlayState(id) {
  const pick = () => {
    const s = phone.player.player.get();
    const cur = s.queue[s.index];
    return id && cur?.id === id ? (s.playing ? 2 : 1) : 0;
  };
  const [v, set] = useState(pick);
  useEffect(() => {
    set(pick());
    return phone.player.player.subscribe(() => set(pick()));
  }, [id]);
  return v;
}

function PlayKey({ song, size = 36 }) {
  const ps = usePlayState(song?.id);
  const isCur = ps > 0;
  const playing = ps === 2;
  const prog = useProgress(isCur);
  const tap = e => {
    e.stopPropagation();
    if (!song) return;
    if (isCur) phone.player.toggle(); else phone.player.play([song], 0);
  };
  return html`
    <button class=${`song-key press${playing ? ' is-playing' : ''}`} style=${`--key:${size}px`}
      aria-label=${playing ? '暂停' : '播放'} onClick=${tap} disabled=${!song}>
      ${isCur ? html`
        <svg class="song-ring" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="17"/>
          <circle cx="20" cy="20" r="17" class="song-ring-on"
            style=${`stroke-dasharray:${RING};stroke-dashoffset:${RING * (1 - prog)}`}/>
        </svg>` : null}
      <${Icon} name=${playing ? 'pause' : 'play'} size=${Math.round(size * 0.42)}/>
    </button>`;
}

export function SongCard({ songId, query = '', state = '', layout = 'tile', cls = '' }) {
  useStore(db.songs.store);
  const song = songId ? db.songs.get(songId) : null;
  const local = useImage(song?.coverId);
  const [bad, setBad] = useState(false);
  const pic = !bad && (song?.cover || local) || '';
  const tint = useTint(pic);
  const q = music.splitQuery(query);
  const title = song?.title || q.title || '一首歌';
  const artist = song ? (song.artist || '') : q.artist;
  const note = song ? `歌曲 · ${song.source === 'netease' ? '网易云音乐' : '本机曲库'}`
    : state === 'pending' ? '正在查找这首歌'
    : phone.netease.ready() ? '曲库与网易云中均未找到'
    : '曲库中没有这首歌。配置音乐服务后可从网易云查找';
  const open = e => {
    e.stopPropagation();
    if (!song) return;
    const cur = phone.player.current();
    if (cur?.id !== song.id) phone.player.play([song], 0);
    phone.intent.open('music', { route: '/now', back: true });
  };
  const art = html`
    <span class=${`song-art${state === 'pending' && !song ? ' is-pending' : ''}`}>
      ${pic ? html`<img src=${pic} alt="" referrerpolicy="no-referrer" onError=${() => setBad(true)}/>`
        : html`<${Icon} name="disc" size=${layout === 'tile' ? 44 : 22}/>`}
    </span>`;
  const text = html`
    <span class="song-main">
      <span class="song-title ellipsis">${title}</span>
      ${artist ? html`<span class="song-artist ellipsis">${artist}</span>` : null}
      <span class="song-note ellipsis">${note}</span>
    </span>`;
  return html`
    <div class=${`song-card is-${layout}${song ? '' : ' is-off'}${tint ? ' is-tinted' : ''} ${cls}`}
      role="button" tabindex="0" onClick=${open}
      onKeyDown=${e => { if (e.key === 'Enter') open(e); }}
      aria-label=${song ? `${title}，打开正在播放` : title}
      style=${tint ? `--song-tint:${tint}` : ''}>
      ${layout === 'tile' ? html`
        <span class="song-top">
          ${art}
          ${song ? html`<${PlayKey} song=${song} size=${38}/>` : null}
        </span>
        <span class="song-foot">${text}</span>` : html`
        ${art}${text}
        ${song ? html`<${PlayKey} song=${song} size=${34}/>` : null}`}
    </div>`;
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

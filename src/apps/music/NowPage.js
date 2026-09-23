import { html, useState, useEffect, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, Icon, EmptyState } from '../../ui/index.js';
import { Cover } from './parts.js';

// 正在播放。点底部那条进来，和网易云同一个样子：
//
//   封面那一面：大封面，下面一行是正唱到的那一句
//   歌词那一面：整首滚动，正唱的那句高亮并停在正中；点哪一句就从哪一句放
//   两面之间点一下切换。外文歌有译文的，译文排在原文下面，右上角可以关
//
// 高亮按 player.position() 算，不按 player 里的 seconds：那个一秒才更新一次，
// 还取了整，拿它对歌词每一句都要慢半拍才亮。

const { player, nav } = phone;

// 取到第几句了。时间戳略提前一点点亮，人听到的比 timeupdate 早
function activeAt(lines, sec) {
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].at > sec + 0.2) break;
    at = i;
  }
  return at;
}

export function NowPage() {
  const s = useStore(player.player);
  const cur = s.queue[s.index];
  const [view, setView] = useState('cover');
  const [lyr, setLyr] = useState({ loading: true });
  const [pos, setPos] = useState(0);
  const [drag, setDrag] = useState(null);
  const [showTrans, setShowTrans] = useState(true);
  const boxRef = useRef(null);
  const userAt = useRef(0);      // 手指最后一次自己划歌词的时刻
  const autoAt = useRef(0);      // 最后一次由这里替人滚动的时刻

  // 换了一首就重新取歌词
  useEffect(() => {
    if (!cur) return undefined;
    let alive = true;
    setLyr({ loading: true });
    player.lyricOf(cur)
      .then(r => { if (alive) setLyr(r); })
      .catch(err => { if (alive) setLyr({ lines: [], error: String(err.message || err) }); });
    return () => { alive = false; };
  }, [cur?.id]);

  // 位置四分之一秒取一次，够逐句高亮用，不必每帧都画
  useEffect(() => {
    const t = setInterval(() => setPos(player.position()), 250);
    return () => clearInterval(t);
  }, []);

  const lines = lyr.lines || [];
  const idx = activeAt(lines, pos);
  const hasTrans = lines.some(l => l.trans);

  // 正唱的那句停在正中。人刚自己划过就先不抢，三秒之后再接着跟
  useEffect(() => {
    if (view !== 'lyric' || idx < 0) return;
    if (Date.now() - userAt.current < 3000) return;
    const box = boxRef.current;
    const el = box?.querySelector(`[data-line="${idx}"]`);
    if (!box || !el) return;
    autoAt.current = Date.now();
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
  }, [idx, view, showTrans]);

  const onScroll = () => {
    // 自己滚的那一下也会触发这里，那不算人划的
    if (Date.now() - autoAt.current > 700) userAt.current = Date.now();
  };

  if (!cur) {
    return html`<${Page} title="正在播放" onBack=${nav.pop}>
      <${EmptyState} icon="music" title="当前没有在播放的歌曲"/><//>`;
  }

  const dur = s.duration || cur.seconds || 0;
  const shown = drag ?? pos;
  const pct = dur ? Math.min(100, (shown / dur) * 100) : 0;
  const coverSize = Math.max(160, Math.min(320, (typeof window !== 'undefined' ? window.innerWidth : 390) - 96));

  const empty = lyr.loading ? '正在取歌词'
    : lyr.error ? `歌词读取失败：${lyr.error}`
    : lyr.pure ? '纯音乐，请欣赏'
    : lyr.local ? '这首歌没有歌词。可在「本机曲库」里编辑这首歌，粘贴 LRC 歌词'
    : lyr.none ? '暂无歌词' : '';

  return html`
    <${Page} title=${cur.title} onBack=${nav.pop} noScroll
      right=${hasTrans && view === 'lyric' ? html`
        <button class=${`icon-btn press mu-trans-btn${showTrans ? ' is-on' : ''}`}
          aria-label=${showTrans ? '隐藏译文' : '显示译文'} onClick=${() => setShowTrans(v => !v)}>
          <${Icon} name="translate" size=${18}/>
        </button>` : null}>
      <div class="mu-now">
        <div class="mu-now-artist ellipsis">${cur.artist || ''}</div>

        ${view === 'cover' ? html`
          <button class="mu-now-face press" onClick=${() => setView('lyric')} aria-label="查看歌词">
            <${Cover} src=${cur.cover} name=${cur.title} size=${coverSize} radius="var(--r-lg)"/>
            <div class="mu-now-line">${idx >= 0 ? lines[idx].text : (empty || ' ')}</div>
            ${idx >= 0 && showTrans && lines[idx].trans ? html`<div class="mu-now-line-t">${lines[idx].trans}</div>` : null}
          </button>` : html`
          <div class="mu-lyrics" ref=${boxRef} onScroll=${onScroll}
            onClick=${e => { if (!e.target.closest('[data-line]')) setView('cover'); }}>
            ${lines.length ? html`
              <div class="mu-lyrics-pad"></div>
              ${lines.map((l, i) => html`
                <p key=${i} data-line=${i} class=${`mu-ly${i === idx ? ' is-on' : ''}`}
                  onClick=${() => { userAt.current = 0; player.seek(l.at); setPos(l.at); }}>
                  ${l.text}
                  ${showTrans && l.trans ? html`<span class="mu-ly-t">${l.trans}</span>` : null}
                </p>`)}
              <div class="mu-lyrics-pad"></div>` : html`
              <div class="mu-lyrics-empty">${empty}</div>`}
          </div>`}

        <div class="mu-now-ctl">
          <div class="mu-now-seek">
            <span class="mu-now-t">${player.fmt(shown)}</span>
            <input type="range" class="mu-range" min="0" max=${dur || 1} step="0.5"
              value=${shown} style=${`--pct:${pct}%`} disabled=${!dur}
              onInput=${e => setDrag(Number(e.currentTarget.value))}
              onChange=${e => { const v = Number(e.currentTarget.value); player.seek(v); setPos(v); setDrag(null); }}/>
            <span class="mu-now-t">${player.fmt(dur)}</span>
          </div>
          ${s.error ? html`<div class="mu-now-err">${s.error}</div>` : null}
          <div class="mu-now-btns">
            <button class="mu-now-btn press" aria-label="上一首" onClick=${player.prev}>
              <${Icon} name="skipPrev" size=${26}/>
            </button>
            <button class="mu-now-btn mu-now-main press" aria-label=${s.playing ? '暂停' : '播放'} onClick=${player.toggle}>
              <${Icon} name=${s.playing ? 'pause' : 'play'} size=${30}/>
            </button>
            <button class="mu-now-btn press" aria-label="下一首" onClick=${player.next}>
              <${Icon} name="skipNext" size=${26}/>
            </button>
          </div>
        </div>
      </div>
    <//>`;
}

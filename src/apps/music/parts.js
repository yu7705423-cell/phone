import { html, useState, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Icon, EmptyState, Button, toast } from '../../ui/index.js';

const { player } = phone;

// 封面。取不到就摆一个字，不留一个空框。
export function Cover({ src, name = '', size = 48, radius = 'var(--r-md)' }) {
  const [bad, setBad] = useState(false);
  const style = `width:${size}px;height:${size}px;border-radius:${radius}`;
  if (!src || bad) {
    return html`<div class="mu-cover mu-cover-empty" style=${style}>
      <span>${(name || '?').slice(0, 1)}</span></div>`;
  }
  return html`<img class="mu-cover" style=${style} src=${src} alt=""
    loading="lazy" referrerpolicy="no-referrer" onError=${() => setBad(true)}/>`;
}

// 一行一首。右边那个按钮把这首收进本机曲库，一起听那边用的是曲库里的。
export function TrackRow({ track, index, onPlay, right }) {
  const s = useStore(player.player);
  const cur = s.queue[s.index];
  const on = cur && cur.id === track.id;
  return html`
    <div class=${`mu-row press${on ? ' is-on' : ''}`} onClick=${onPlay}>
      ${index != null
        ? html`<span class="mu-idx">${index}</span>`
        : html`<${Cover} src=${track.cover} name=${track.title} size=${44}/>`}
      <div class="mu-main">
        <div class="mu-title ellipsis">${track.title}</div>
        <div class="mu-sub ellipsis">${[track.artist, track.album].filter(Boolean).join(' · ')}</div>
      </div>
      ${right || null}
    </div>`;
}

// 收进曲库的按钮。收过的就不再问第二次。
export function KeepButton({ track }) {
  const [kept, setKept] = useState(false);
  const keep = e => {
    e.stopPropagation();
    phone.music.fromNetease(track);
    setKept(true);
    toast('已加入本机曲库', 'ok');
  };
  return html`
    <button class="mu-keep press" aria-label="加入本机曲库" onClick=${keep}>
      <${Icon} name=${kept ? 'check' : 'plus'} size=${17}/>
    </button>`;
}

// 底部那条。没在放就不占位置。
// safe：这一页底下没有页签栏，那条就得自己让开 Home Indicator。
export function NowBar({ safe }) {
  const s = useStore(player.player);
  const cur = s.queue[s.index];
  if (!cur) return null;
  const pct = s.duration ? Math.min(100, (s.seconds / s.duration) * 100) : 0;
  // 点进度条跳到那一处。条子只有两像素高，热区靠 CSS 的 padding 撑开。
  const jump = e => {
    if (!s.duration) return;
    const box = e.currentTarget.getBoundingClientRect();
    player.seek(((e.clientX - box.left) / box.width) * s.duration);
  };
  return html`
    <div class=${`mu-bar${safe ? ' mu-bar-safe' : ''}`}>
      <div class="mu-bar-line" onClick=${jump}><i style=${`width:${pct}%`}></i></div>
      <div class="mu-bar-body">
        <${Cover} src=${cur.cover} name=${cur.title} size=${40}/>
        <div class="mu-main">
          <div class="mu-title ellipsis">${cur.title}</div>
          <div class="mu-sub ellipsis">
            ${s.error ? s.error : s.loading ? '正在取播放地址' : cur.artist}
          </div>
        </div>
        <button class="mu-ctl press" aria-label=${s.playing ? '暂停' : '播放'}
          onClick=${player.toggle}>
          <${Icon} name=${s.playing ? 'pause' : 'play'} size=${19}/>
        </button>
        <button class="mu-ctl press" aria-label="下一首" onClick=${player.next}>
          <${Icon} name="skipNext" size=${19}/>
        </button>
      </div>
    </div>`;
}

// 没填地址、没登录时各自该说的话。三处都要用，写在一处。
export function NeedLogin({ ready, logged }) {
  if (!ready) {
    return html`
      <${EmptyState} icon="music" title="尚未配置音乐接口"
        desc="该应用的数据来自你自己部署的网易云音乐接口。请先在设置中填写接口地址并登录。"
        action=${html`<${Button} size="sm" icon="settings"
          onClick=${() => phone.intent.open('settings', { route: '/music', back: true })}>前往设置<//>`}/>`;
  }
  if (!logged) {
    return html`
      <${EmptyState} icon="user" title="尚未登录"
        desc="登录后可查看个人主页、听歌排行与歌单。在此播放的歌曲会记入该账号的听歌记录。"
        action=${html`<${Button} size="sm" icon="user"
          onClick=${() => phone.intent.open('settings', { route: '/music', back: true })}>前往登录<//>`}/>`;
  }
  return null;
}

/**
 * 拉一次远端数据。**每个页面自己拉自己的** —— 这些数字变得慢，
 * 不值得为它们在库里再养一份缓存，进来拉一次就够。
 * 返回 { data, err, loading, reload }。
 */
export function useRemote(fn, deps = []) {
  const [state, setState] = useState({ data: null, err: '', loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true, err: '' }));
    Promise.resolve()
      .then(fn)
      .then(data => { if (alive) setState({ data, err: '', loading: false }); })
      .catch(e => { if (alive) setState({ data: null, err: String(e.message || e), loading: false }); });
    return () => { alive = false; };
  }, [...deps, n]);
  return { ...state, reload: () => setN(x => x + 1) };
}

// 拉取失败时统一的样子。接口是用户自己部署的，错在哪儿要原样说出来。
export function Failed({ err, onRetry }) {
  return html`
    <${EmptyState} icon="refresh" title="读取失败" desc=${err}
      action=${html`<${Button} size="sm" icon="refresh" onClick=${onRetry}>重试<//>`}/>`;
}

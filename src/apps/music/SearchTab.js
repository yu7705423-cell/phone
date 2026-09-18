import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Icon, Spinner, EmptyState } from '../../ui/index.js';
import { TrackRow, KeepButton, NeedLogin } from './parts.js';

const { db, netease, player } = phone;
const svc = phone.ai.services;

// 搜索。回车才发请求 —— 每敲一个字就查一次，是在替用户的接口挨限流。
export function SearchTab() {
  useStore(db.settings.store);
  const cfg = svc.neteaseConfig();
  const [q, setQ] = useState('');
  const [state, setState] = useState({ list: [], err: '', loading: false, done: false });

  const go = async () => {
    const key = q.trim();
    if (!key) return;
    setState({ list: [], err: '', loading: true, done: false });
    try {
      const list = await netease.search(key, 30);
      setState({ list, err: '', loading: false, done: true });
    } catch (e) {
      setState({ list: [], err: String(e.message || e), loading: false, done: true });
    }
  };

  const gate = NeedLogin({ ready: !!cfg.baseUrl, logged: true });
  if (gate) return gate;

  return html`
    <div class="mu-page">
      <div class="search-bar">
        <${Icon} name="search" size=${16}/>
        <input value=${q} placeholder="搜索歌曲、歌手" enterkeyhint="search"
          onInput=${e => setQ(e.target.value)}
          onKeyDown=${e => { if (e.key === 'Enter') { e.target.blur(); go(); } }}/>
        ${q ? html`<button class="press" aria-label="清空"
          onClick=${() => { setQ(''); setState({ list: [], err: '', loading: false, done: false }); }}>
          <${Icon} name="close" size=${15}/></button>` : null}
      </div>

      ${state.loading ? html`<div class="mu-wait"><${Spinner}/></div>` : null}

      ${state.err ? html`<${EmptyState} icon="refresh" title="搜索失败" desc=${state.err}/>` : null}

      ${state.done && !state.err && !state.list.length
        ? html`<${EmptyState} icon="search" title="没有匹配的歌曲"/>` : null}

      <div class="mu-list">
        ${state.list.map((t, i) => html`
          <${TrackRow} key=${t.id} track=${t}
            onPlay=${() => player.play(state.list, i)}
            right=${html`<${KeepButton} track=${t}/>`}/>`)}
      </div>

      ${!state.done && !state.loading ? html`
        <div class="settings-foot">
          输入关键词后按回车开始搜索。点击结果即可播放，右侧的加号将其收入本机曲库。
        </div>` : null}
    </div>`;
}

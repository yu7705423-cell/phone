import { html } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Page, Spinner, Button } from '../../ui/index.js';
import { TrackRow, KeepButton, useRemote, Failed, Cover, NowBar } from './parts.js';

const { nav, netease, player } = phone;

// 歌单里有什么。歌单本身不落库 —— 它在网易云那边，这里只是看一眼、点来放。
export function PlaylistPage({ id }) {
  const got = useRemote(() => netease.playlistTracks(id), [id]);
  const tracks = got.data || [];

  return html`
    <${Page} title="歌单" onBack=${nav.pop}
      right=${tracks.length ? html`
        <button class="nav-text press" onClick=${() => player.play(tracks, 0)}>全部播放</button>` : null}>
      <div class="mu-page">
      ${got.loading ? html`<div class="mu-wait"><${Spinner}/></div>` : null}
      ${got.err ? html`<${Failed} err=${got.err} onRetry=${got.reload}/>` : null}

      ${tracks.length ? html`
        <div class="mu-head">
          <${Cover} src=${tracks[0].cover} name=${tracks[0].album} size=${88} radius="var(--r-lg)"/>
          <div>
            <div class="mu-head-n">共 ${tracks.length} 首</div>
            <${Button} size="sm" icon="play" onClick=${() => player.play(tracks, 0)}>播放<//>
          </div>
        </div>` : null}

      <div class="mu-list">
        ${tracks.map((t, i) => html`
          <${TrackRow} key=${t.id} track=${t} index=${i + 1}
            onPlay=${() => player.play(tracks, i)}
            right=${html`<${KeepButton} track=${t}/>`}/>`)}
      </div>
      </div>
      <${NowBar}/>
    <//>`;
}

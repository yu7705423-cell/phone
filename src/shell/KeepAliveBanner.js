import { html } from '../lib.js';
import { useStore } from '../system/store.js';
import { Icon } from '../icons/Icon.js';
import * as keepAlive from '../system/keepalive.js';

// 保活断了、而且自动续不上时的那一条。
//
// 为什么非要用户点一下：浏览器只在**真实触摸之后**才允许播音频。
// 断在后台的那种，代码怎么试都会被拒，只有这一下既是许可也是手势。
// 所以这条横幅不是提示，它本身就是恢复手段。
export function KeepAliveBanner() {
  const s = useStore(keepAlive.state);
  if (!s.want || !s.needsTap) return null;

  return html`
    <div class="ka-banner">
      <${Icon} name="power" size=${16}/>
      <div class="ka-text">
        <div class="ka-title">后台保活已中断</div>
        <div class="ka-sub">浏览器需要一次点击才能重新开始播放。</div>
      </div>
      <button class="ka-act press" onClick=${() => keepAlive.resume()}>重新开启</button>
      <button class="ka-close press" aria-label="知道了"
        onClick=${() => keepAlive.dismiss()}><${Icon} name="close" size=${15}/></button>
    </div>`;
}

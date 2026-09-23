import { html, useState } from '../../../lib.js';
import { phone, useThumb } from '../../../sdk/index.js';
import { Icon } from '../../../ui/index.js';

// 一次发好几张图的时候，摞成一叠。
//
// 不摞的话，五张图就是五个气泡、一屏高，中间说过的话全被顶出屏幕。
//
// 只并**连着发的、同一个人发的**那几张。中间夹了一句话就断开 ——
// 那两张之间隔着一句话，本来就不是一组。

export const STACK_MIN = 2;

export function groupImages(list) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= STACK_MIN) out.push({ stack: true, id: run[0].id, msgs: run });
    else run.forEach(m => out.push({ stack: false, id: m.id, msg: m }));
    run = [];
  };
  for (const m of list) {
    const same = run.length && run[0].role === m.role && run[0].authorId === m.authorId;
    // **带着状态的那几张不并进来**：出错的、还在生成的、还在识别的、
    // 识图没开的 —— 它们各自下面挂着一行说明（「角色看不到这张图」之类），
    // 摞进叠里那行说明就没了，而那正是当时最该看见的一句话。
    // 用文字写的那张没有图可叠，照一条文字气泡单独摆
    const plain = m.kind === 'image' && m.media !== 'text'
      && m.status !== 'error'
      && m.media !== 'pending' && m.media !== 'error'
      && (!m.vision || m.vision === 'done');
    if (plain && (!run.length || same)) { run.push(m); continue; }
    flush();
    if (plain) run.push(m);
    else out.push({ stack: false, id: m.id, msg: m });
  }
  flush();
  return out;
}

// 最上面那张在流里，整叠多宽多高由它说了算 —— 横图竖图各是各的样子，
// 不套固定的框，套了就得裁。背后那两张绝对定位铺满它。
function Card({ msg, back }) {
  const url = useThumb(msg.imageId);
  return html`
    <div class=${`stack-card${back ? ' is-back' : ''}`} style=${back ? `--i:${back}` : ''}>
      ${url ? html`<img src=${url} alt="" loading="lazy"/>` : null}
    </div>`;
}

/**
 * 摞起来的那一叠。
 *
 * 默认露在外面的是**最后一张**，和真摞一叠照片一样：后放上去的在最上面。
 * **点一下换一张**：整叠往后翻一位，背后那两张跟着换。不必展开就能挨个看。
 * 背后最多露两张，多了只是噪音，数目写在按钮上。
 */
export function ImageStack({ msgs, onExpand }) {
  const n = msgs.length;
  const [i, setI] = useState(n - 1);
  const at = k => msgs[((k % n) + n) % n];
  const depth = Math.min(2, n - 1);
  // 从深到浅渲染：先画的在下面
  const back = Array.from({ length: depth }, (_, k) => depth - k);

  return html`
    <div class="img-stack">
      <button class="stack-more press" onClick=${onExpand}>展开 ${n} 张</button>
      <div class="stack-cards no-callout" onClick=${() => setI(i - 1)}>
        ${back.map(d => html`<${Card} key=${at(i - d).id} msg=${at(i - d)} back=${d}/>`)}
        <${Card} key=${at(i).id} msg=${at(i)}/>
        <span class="stack-n">${((i % n) + n) % n + 1} / ${n}</span>
      </div>
    </div>`;
}

export function StackFold({ count, onFold }) {
  return html`
    <button class="stack-fold press" onClick=${onFold}>
      <${Icon} name="chevronUp" size=${12}/>
      <span>收起这 ${count} 张</span>
    </button>`;
}

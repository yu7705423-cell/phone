import { html, useState, useEffect, useRef } from '../lib.js';

// HTML 卡片的那个框（ARCHITECTURE 4.250）。整页由调用方渲染好交进来（phone.htmlcard.docOf），
// 这里只管三件事：
//
//   1. sandbox=""：连 allow-scripts 都不给，更不给 allow-same-origin。卡片只有 HTML 与 CSS。
//   2. 滚到屏幕附近才挂 iframe。一段聊天里几十张卡片同时挂着，每张都是一整页，手机吃不消。
//   3. 它要是把自己跳到别处（第二次 load），当场撤掉换成一行提示。清洗已经拿掉了能跳的东西，这是兜底。
//
// w、h 是聊天里的宽高（px）；fluid 为真时宽度占满父元素、高度按同一比例（全屏查看那一页）。
export function CardFrame({ doc, w = 270, h = 200, fluid = false, title = '卡片' }) {
  const box = useRef(null);
  const [near, setNear] = useState(fluid);
  const [gone, setGone] = useState(false);
  const loads = useRef(0);

  useEffect(() => {
    if (near || !box.current) return undefined;
    if (typeof IntersectionObserver !== 'function') { setNear(true); return undefined; }
    const io = new IntersectionObserver(list => {
      if (list.some(x => x.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: '600px 0px' });
    io.observe(box.current);
    return () => io.disconnect();
  }, [near]);

  // 换了内容就是一张新卡片，重新数 load
  useEffect(() => { loads.current = 0; setGone(false); }, [doc]);

  const onLoad = () => { loads.current += 1; if (loads.current > 1) setGone(true); };
  const style = fluid ? `--hc-ratio:${w} / ${h}` : `--hc-w:${w}px;--hc-h:${h}px`;

  return html`
    <div ref=${box} class=${`hc-frame${fluid ? ' is-fluid' : ''}`} style=${style}>
      ${gone ? html`<div class="hc-note">该卡片试图打开外部网页，已停止显示</div>`
        : near && doc ? html`<iframe key=${doc.length} sandbox="" srcdoc=${doc} title=${title}
            referrerpolicy="no-referrer" loading="lazy" onLoad=${onLoad}></iframe>`
        : html`<div class="hc-note"></div>`}
    </div>`;
}

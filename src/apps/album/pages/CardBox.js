import { html, useRef, useEffect } from '../../../lib.js';
import { phone } from '../../../sdk/index.js';

const { album, cardshot } = phone;

/**
 * 卡片画在 shadow root 里。
 *
 * **必须隔离**：里面盖着的是存卡片那一刻的美化 CSS 原文，直接塞进页面
 * 会把整个 app 的样子一起改了。shadow root 两头都挡：里面的规则出不去，
 * 外面的也进不来。CSS 变量是继承的，所以 var(--text) 这些照样取得到。
 */
export function CardBox({ photo, onMeasure }) {
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [base, body] = await Promise.all([
        cardshot.appCss(),
        cardshot.buildHtml(photo.msgs || []),
      ]);
      if (!alive || !ref.current) return;
      const host = ref.current;
      const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${base}\n${cardshot.SHOT_CSS}\n`
        + `${album.shotCss(photo.shotId)}</style>${body}`;
      if (onMeasure) {
        // 等一帧再量，样式还没套上时量出来是错的
        requestAnimationFrame(() => {
          const box = root.querySelector('.shot');
          if (box && alive) onMeasure({ el: box, html: body, w: box.offsetWidth, h: box.offsetHeight });
        });
      }
    })();
    return () => { alive = false; };
  }, [photo?.id, photo?.shotId]);

  return html`<div class="cardbox" ref=${ref}></div>`;
}

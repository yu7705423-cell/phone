import { html, useRef, useEffect } from '../../lib.js';
import { phone } from '../../sdk/index.js';

const { skin } = phone;

/**
 * 一份美化长什么样。
 *
 * **和生成器顶上那块是同一份复刻页**（system/skin-stage.js），只是缩得更小。
 * 从前这里另用卡片那一套静态 HTML，于是它没有契约钩子，生成器里调好的东西
 * 在库里一样都看不见 —— 两份复刻，永远差一截。一份就没有这个问题。
 *
 * 画在 shadow root 里：这份美化的 CSS 直接塞进页面会把整个 app 一起改了。
 * 令牌那一段要挂在 `:host` 上，shadow 里没有 `:root`。
 */
const STAGE_W = 430;

export function Preview({ row }) {
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const base = await skin.stageCss();
      if (!alive || !ref.current) return;
      const host = ref.current;
      const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${base}\n${skin.STAGE_CSS}\n`
        + `${skin.compile(row, { varsOn: ':host' })}</style>`
        + `<div class="stage-scale">${skin.buildStage()}</div>`;
      const scaler = root.querySelector('.stage-scale');
      if (!scaler) return;
      const k = Math.min((host.clientWidth || STAGE_W) / STAGE_W,
        (host.clientHeight || 200) / (scaler.offsetHeight || 620));
      const pad = ((host.clientWidth || STAGE_W) / k - STAGE_W) / 2;
      scaler.style.transform = `scale(${k}) translateX(${pad}px)`;
    })();
    return () => { alive = false; };
  }, [row?.id, row?.updatedAt]);

  return html`<div class="skin-preview" ref=${ref}></div>`;
}

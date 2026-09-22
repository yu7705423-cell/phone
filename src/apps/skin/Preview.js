import { html, useRef, useEffect } from '../../lib.js';
import { phone } from '../../sdk/index.js';

const { skin, cardshot } = phone;

// 几条假消息，只为把这份美化套上去看一眼。内容固定，好让两份美化之间可比。
const SAMPLE = [
  { id: 'p1', role: 'char', kind: 'text', content: '这是一条角色发来的消息。', _name: '角色' },
  { id: 'p2', role: 'user', kind: 'text', content: '这是你发出去的。', _name: '我' },
  { id: 'p3', role: 'char', kind: 'text', content: '气泡、间距、圆角、字号都会按这份美化显示。', _name: '角色' },
];

/**
 * 一份美化长什么样。
 *
 * **这是预览，不是样板间。** 会话里那个样板间用的是真的 `Bubble` 组件，
 * 所见即所得；这里用的是卡片那一套静态 HTML（`cardshot`）—— 因为
 * 第 8 条不许一个 app 去 import 另一个 app 的组件，chat 的 `Bubble` 在这儿拿不到。
 *
 * 两边的 class 是同一套（`.msg` `.bubble` `.msg-col`，都来自 app.css），
 * 所以针对这些选择器写的规则在这儿看得出来；但结构不完全一样，
 * 细到伪元素、相邻选择器那一层就可能对不上。**要准就回会话里看。**
 *
 * 画在 shadow root 里：这份美化的 CSS 直接塞进页面会把整个 app 一起改了。
 */
export function Preview({ row }) {
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [base, body] = await Promise.all([
        cardshot.appCss(),
        cardshot.buildHtml(SAMPLE),
      ]);
      if (!alive || !ref.current) return;
      const host = ref.current;
      const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
      // 令牌那一段要挂在 :host 上。shadow 里没有 :root —— 那是文档根，
      // 挂过去等于整段不生效，人会以为尺寸那几栏坏了
      root.innerHTML = `<style>${base}\n${cardshot.SHOT_CSS}\n`
        + `${skin.compile(row, { varsOn: ':host' })}</style>${body}`;
    })();
    return () => { alive = false; };
  }, [row?.id, row?.updatedAt]);

  return html`<div class="skin-preview" ref=${ref}></div>`;
}

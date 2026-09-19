import { html } from '../../../lib.js';
import { phone } from '../../../sdk/index.js';
import { Icon } from '../../../ui/index.js';

const { book, para } = phone;

/**
 * 一页正文，每一段旁边一个小气泡。有评论显示条数，没有就是个淡气泡。
 * 自己看的和一起读的共用这一个 —— 两边长得不一样就成了两套东西。
 */
export function Paragraphs({ bookId, text, at, span, onOpen }) {
  const list = book.paragraphsOf(text, at, span);
  const counts = para.countsIn(para.subjectOf(para.BOOK, bookId), at, span);
  return html`
    ${list.map(p => {
      const n = counts.get(p.at) || 0;
      return html`
        <div key=${p.at} class="rd-para">
          <p class="rd-p">${p.text}</p>
          <button class=${`rd-dot press${n ? ' has-n' : ''}`}
            aria-label=${n ? `这一段有 ${n} 条评论` : '评论这一段'}
            onClick=${() => onOpen(p.at)}>
            ${n ? html`<span class="rd-dot-n">${n > 99 ? '99' : n}</span>`
              : html`<${Icon} name="message" size=${11}/>`}
          </button>
        </div>`;
    })}`;
}

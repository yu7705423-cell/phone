import { html } from '../../../lib.js';
import { useImage } from '../../../sdk/index.js';
import { Icon } from '../../../ui/index.js';

// 线下正文的展示层。见 ARCHITECTURE 4.107

// 对白与动作**只在这里分样式**：不进 prompt、不改数据、可关。
// 解析错了最多是颜色不对，弄不坏正文 —— 这是选它而不是让模型按格式写的理由。
const RUN = /(「[^」\n]*」|“[^”\n]*”|（[^）\n]*）|\([^)\n]*\)|\*[^*\n]+\*)/g;
const ACT = /^[（(*]/;

export function runsOf(text) {
  const s = String(text || '');
  const out = [];
  let last = 0;
  let m;
  RUN.lastIndex = 0;
  while ((m = RUN.exec(s))) {
    if (m.index > last) out.push({ kind: '', text: s.slice(last, m.index) });
    out.push({ kind: ACT.test(m[0]) ? 'act' : 'q', text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ kind: '', text: s.slice(last) });
  return out;
}

/**
 * 这一段能不能做首字下沉。两条都要满足：
 *
 * **开头得是字，不能是标点。** `::first-letter` 取的是第一个字符，而正文很常
 * 以「或者（开头，放大成两行高的一个引号很难看。CSS 判不了这件事，
 * 所以在这里判完再决定加不加那个类。
 *
 * **头一段得够长。** 下沉的那个字比一行高，头一段只有一行的话，它比整段还大，
 * 看着像出了错。杂志也不会给两行的段落做首字下沉。
 */
const DROPPABLE = /^[\u4e00-\u9fff\u3400-\u4dbfA-Za-z0-9]/;
const DROP_MIN = 16;
export const canDrop = (text) => {
  const t = String(text || '').trimStart();
  return DROPPABLE.test(t) && t.length >= DROP_MIN;
};

export const Prose = ({ text, marks, drop }) => {
  const lines = String(text || '').split('\n');
  const cls = `sg-text no-callout${drop && canDrop(lines[0]) ? ' is-drop' : ''}`;
  return html`
    <div class=${cls}>
      ${lines.map((line, i) => html`
        <p key=${i}>
          ${marks
    ? runsOf(line).map((r, j) => (r.kind
      ? html`<span key=${j} class=${`sg-${r.kind}`}>${r.text}</span>`
      : r.text))
    : line}
        </p>`)}
    </div>`;
};

// 署名上只写时刻，不写日期 —— 「2026-01-01 周三 14:30」整条摆在那儿会把
// 一行占满。认不出时刻就这一项不占位。
export const clockOf = at => (String(at || '').match(/\d{1,2}:\d{2}/) || [''])[0];

const pad = n => String(Math.max(0, n) + 1).padStart(2, '0');

/**
 * 一段开头的署名。
 *
 * 一行名字、一行地点时刻与编号，下面一道发丝线。**全都是小字**——
 * 撑开篇那一页的是下面正文的首字下沉，不是这里。
 *
 * 先做过一枚圆邮戳，再做过一个 56px 的大编号，都撤了。大编号那版尤其不对：
 * 刊物里的页码（folio）一向是小的、推到页边的，摆一个巨大的数字在开篇
 * 是模板做法，不是刊物做法。
 */
export const Sign = ({ sign, no, face }) => {
  // hook 要在提前 return 之前调完，否则这一块一会儿有一会儿没有，
  // 数量就对不上了（第 10 条）
  const src = useImage(face ? sign?.face : null);
  if (!sign) return null;
  const meta = [sign.place, clockOf(sign.time), pad(no || 0)].filter(Boolean).join('　');
  if (!sign.name && !meta) return null;
  return html`
    <div class=${`sg-sign${sign.mine ? ' is-mine' : ''}`}>
      ${face && src ? html`<img class="sg-face" src=${src} alt=""/>` : null}
      <div class="sg-sign-text">
        <div class="sg-sign-name">${sign.name}</div>
        <div class="sg-sign-meta">${meta}</div>
      </div>
    </div>`;
};

// 只要一行的那一档。同一份字距，去掉头像与细线。
export const Byline = ({ sign, no }) => {
  if (!sign) return null;
  const parts = [sign.name, sign.place, clockOf(sign.time), pad(no || 0)].filter(Boolean);
  if (!parts.length) return null;
  return html`<div class=${`sg-byline${sign.mine ? ' is-mine' : ''}`}>${parts.join('　')}</div>`;
};

// 明信片那一档的一张。竖着滑，一张一张排下去。
//
// 每张自己是一个组件，因为头像要 useImage 解析 —— 在一个循环里调 hook
// 是不行的（第 10 条）。
export const Card = ({ page, sign, marks, drop, showSign, face, grow, vers, onPick, onHold, onEnd }) => html`
  <article class=${`sg-card no-callout${grow ? '' : ' is-fixed'}`}
    onTouchStart=${onHold} onTouchEnd=${onEnd} onTouchMove=${onEnd} onTouchCancel=${onEnd}
    onContextMenu=${e => { e.preventDefault(); if (onHold) onHold(); }}>
    ${showSign && sign ? html`<${Sign} sign=${sign} no=${page.beatIndex} face=${face}/>` : null}
    <div class="sg-card-body">
      <${Prose} text=${page.text} marks=${marks} drop=${drop && page.first}/>
      ${vers && page.page === page.pages - 1
    ? html`<${Versions} n=${vers.n} at=${vers.at} onPick=${onPick}/>` : null}
    </div>
  </article>`;

// 一段的第几版。重写不删旧的，往后添一版，在这里翻。
// 只有一版时整条不出现。
export const Versions = ({ n, at, onPick }) => (n > 1 ? html`
  <div class="sg-vers">
    <button class="sg-vers-btn press" disabled=${at <= 0}
      onClick=${e => { e.stopPropagation(); onPick(at - 1); }} aria-label="上一版">
      <${Icon} name="chevronLeft" size=${15}/>
    <//>
    <span class="sg-vers-no">${at + 1} / ${n}</span>
    <button class="sg-vers-btn press" disabled=${at >= n - 1}
      onClick=${e => { e.stopPropagation(); onPick(at + 1); }} aria-label="下一版">
      <${Icon} name="chevronRight" size=${15}/>
    <//>
  </div>` : null);

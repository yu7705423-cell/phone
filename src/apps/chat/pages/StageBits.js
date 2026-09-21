import { html } from '../../../lib.js';
import { useImage } from '../../../sdk/index.js';

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

export const Prose = ({ text, marks }) => html`
  <div class="sg-text no-callout">
    ${String(text || '').split('\n').map((line, i) => html`
      <p key=${i}>
        ${marks
    ? runsOf(line).map((r, j) => (r.kind
      ? html`<span key=${j} class=${`sg-${r.kind}`}>${r.text}</span>`
      : r.text))
    : line}
      </p>`)}
  </div>`;

// 署名上只写时刻，不写日期 —— 「2026-01-01 周三 14:30」整条摆在那儿会把
// 一行占满。认不出时刻就这一项不占位。
export const clockOf = at => (String(at || '').match(/\d{1,2}:\d{2}/) || [''])[0];

const pad = n => String(Math.max(0, n) + 1).padStart(2, '0');

/**
 * 一段开头的署名。
 *
 * 先做过一枚圆邮戳，丑，撤了。现在这一块走时尚大片那一路：
 * **靠尺度反差，不靠图形** —— 一个又大又细的编号，一道发丝线，
 * 下面一行极小、字距拉得很开的名字与地点。杂志里开篇那一页就是这么排的。
 */
export const Sign = ({ sign, no, face }) => {
  // hook 要在提前 return 之前调完，否则这一块一会儿有署名一会儿没有，
  // 数量就对不上了（第 10 条）
  const src = useImage(face ? sign?.face : null);
  if (!sign) return null;
  const time = clockOf(sign.time);
  const meta = [sign.place, time].filter(Boolean).join('  ');
  if (!sign.name && !meta) return null;
  return html`
    <div class=${`sg-sign${sign.mine ? ' is-mine' : ''}`}>
      <div class="sg-sign-top">
        <div class="sg-sign-no">${pad(no || 0)}</div>
        ${face && src ? html`<img class="sg-face" src=${src} alt=""/>` : null}
      </div>
      <div class="sg-sign-row">
        <span class="sg-sign-name">${sign.name}</span>
        <span class="sg-sign-meta">${meta}</span>
      </div>
    </div>`;
};

// 只要一行的那一档。同一份字距，去掉编号和细线。
export const Byline = ({ sign }) => {
  if (!sign) return null;
  const parts = [sign.name, sign.place, clockOf(sign.time)].filter(Boolean);
  if (!parts.length) return null;
  return html`<div class=${`sg-byline${sign.mine ? ' is-mine' : ''}`}>${parts.join('  ')}</div>`;
};

// 明信片那一档的一张。竖着滑，一张一张排下去，头像盖在右上角。
//
// 每张自己是一个组件，因为头像要 useImage 解析 —— 在一个循环里调 hook
// 是不行的（第 10 条）。
export const Card = ({ page, sign, marks, showSign, face, onHold, onEnd }) => html`
  <article class="sg-card no-callout"
    onTouchStart=${onHold} onTouchEnd=${onEnd} onTouchMove=${onEnd} onTouchCancel=${onEnd}
    onContextMenu=${e => { e.preventDefault(); if (onHold) onHold(); }}>
    ${showSign && sign ? html`<${Sign} sign=${sign} no=${page.beatIndex} face=${face}/>` : null}
    <${Prose} text=${page.text} marks=${marks}/>
  </article>`;

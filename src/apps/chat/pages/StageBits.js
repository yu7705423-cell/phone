import { html } from '../../../lib.js';

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

// 戳上只盖时刻，不盖日期 —— 「2026-01-01 周三 14:30」整条塞进 60px 的圈里
// 一个字都看不清。认不出时刻就这一行不占位，圈跟着收小。
export const clockOf = at => (String(at || '').match(/\d{1,2}:\d{2}/) || [''])[0];

export const Stamp = ({ stamp, float }) => {
  if (!stamp) return null;
  const time = clockOf(stamp.time);
  if (!stamp.place && !time && !stamp.name) return null;
  const cls = `sg-stamp${stamp.solid ? '' : ' is-mine'}${float ? ' sg-stamp-float' : ''}`;
  return html`
    <div class=${cls} style=${`transform: rotate(${stamp.angle}deg)`}>
      <div class="sg-stamp-ring">
        ${stamp.place ? html`<span class="sg-stamp-place">${stamp.place}</span>` : null}
        ${time ? html`<span class="sg-stamp-time">${time}</span>` : null}
        ${stamp.name ? html`<span class="sg-stamp-name">${stamp.name}</span>` : null}
      </div>
    </div>`;
};

// 邮戳关掉之后退回来的那一行：小字号、大字距、次要色，杂志里的署名行
export const Byline = ({ stamp }) => {
  if (!stamp) return null;
  const time = clockOf(stamp.time);
  const parts = [stamp.name, stamp.place, time].filter(Boolean);
  if (!parts.length) return null;
  return html`<div class="sg-eyebrow">${parts.join(' · ')}</div>`;
};

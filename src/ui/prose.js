import { html } from '../lib.js';
import { Icon } from './index.js';

// 散文正文的展示层。线下与「我们」共用，所以放在 ui/ 而不是某个 app 里。
// 见 ARCHITECTURE 4.107、4.117
//
// **这里一行都不碰 sdk。** ui/ 是横向基建，不依赖任何层（第 8 条的分层图）。
// 署名上那张头像要把图片 id 解析成地址，而那要用 useImage —— 那是 sdk 的东西。
// 所以头像由调用方传一个组件进来（`Face`），这一层只负责摆在哪儿。

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
// 首字下沉去掉了（4.282）：::first-letter 加浮动在各家浏览器上高低不齐，中文开头带引号时更乱
export const Prose = ({ text, marks }) => {
  const lines = String(text || '').split('\n');
  const cls = 'sg-text no-callout';
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
export const Sign = ({ sign, no, Face }) => {
  if (!sign) return null;
  const meta = [sign.place, clockOf(sign.time), pad(no || 0)].filter(Boolean).join('　');
  if (!sign.name && !meta) return null;
  return html`
    <div class=${`sg-sign${sign.mine ? ' is-mine' : ''}`}>
      ${Face && sign.face ? html`<${Face} id=${sign.face}/>` : null}
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
// `Face` 原样递给署名，见文件开头。
export const Card = ({ page, sign, marks, showSign, Face, grow, vers, onPick, onHold, onEnd }) => html`
  <article class=${`sg-card no-callout${grow ? '' : ' is-fixed'}`}
    onTouchStart=${onHold} onTouchEnd=${onEnd} onTouchMove=${onEnd} onTouchCancel=${onEnd}
    onContextMenu=${e => { e.preventDefault(); if (onHold) onHold(); }}>
    ${showSign && sign ? html`<${Sign} sign=${sign} no=${page.beatIndex} Face=${Face}/>` : null}
    <div class="sg-card-body">
      <${Prose} text=${page.text} marks=${marks}/>
      ${vers && page.page === page.pages - 1
    ? html`<${Versions} n=${vers.n} at=${vers.at} onPick=${onPick}/>` : null}
    </div>
  </article>`;

// ---- 气泡那一档：一段一个长气泡，气泡里按句断行 ----
//
// 阅读那两档（翻页、明信片）是刊物的排法；这一档是另一种读法 ——
// 竖着滚，一段一个气泡。见 ARCHITECTURE 4.118
//
// 封面不在这儿：**读的时候上面不该压着一张封面**，那是扉页的事。
// 扉页在「我们」的作品页上（apps/us/pages/Bits.js 的 Hero）。

// 按句断行。歌词页之所以是歌词页，靠的就是「一句一行 + 行距拉开」，
// 不是靠字号。断在句末，收口的引号算在前一句里。
//
// **后面那个否定前瞻少不了。** 只写「句末标点加一个可选的收口引号」的话，
// 句号后面和引号后面各断一次 —— 「…早。」会被切成「…早。」与一个孤零零的
// 引号，一行上就一个符号。
const SENT = /(?<=[。！？!?…；;]["」』”’]?)(?!["」』”’])/;
export function linesOf(text) {
  return String(text || '')
    .split('\n')
    .flatMap(p => p.split(SENT))
    .map(x => x.trim())
    .filter(Boolean);
}

const SAID = /^[「“"']/;

/** 一段正文，按歌词页的排法。对白那几行重一点，其余照旧。 */
export const Lyric = ({ text, marks }) => html`
  <div class="sg-lyric">
    ${linesOf(text).map((line, i) => html`
      <p key=${i} class=${SAID.test(line) ? 'is-said' : ''}>
        ${marks
    ? runsOf(line).map((r, j) => (r.kind
      ? html`<span key=${j} class=${`sg-${r.kind}`}>${r.text}</span>`
      : r.text))
    : line}
      </p>`)}
  </div>`;

/** 一段一个长气泡。自己写的那些不填底，只描一道线。 */
export const Bub = ({ who, mine, text, marks, vers, onPick, onHold, onEnd }) => html`
  <article class=${`sg-bub no-callout${mine ? ' is-mine' : ''}`}
    onTouchStart=${onHold} onTouchEnd=${onEnd} onTouchMove=${onEnd} onTouchCancel=${onEnd}
    onContextMenu=${e => { e.preventDefault(); if (onHold) onHold(); }}>
    ${who ? html`<div class="sg-bub-who">${who}</div>` : null}
    <${Lyric} text=${text} marks=${marks}/>
    ${vers ? html`<${Versions} ...${vers} onPick=${onPick}/>` : null}
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

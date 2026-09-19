import { html } from '../../../lib.js';
import { useThumb } from '../../../sdk/index.js';

// 没有封面时给它排一张。
//
// **不是「灰底加一行系统字」。** 那不是设计，是占位。这里按第 4 条的路子做：
// 低饱和底色、单色墨、一条细框、充足留白，书名竖排在右侧，作者小字压在
// 左下，中间留白。像一套丛书的统一版式，而不是一张缺图的图。
//
// 竖排不用 writing-mode：CJK 一个字一个 <text>，位置自己算，
// 各家浏览器一致，长书名换第二列也好控制。

const TINTS = 6;

export function tintOf(title) {
  const t = String(title || '');
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return (h % TINTS) + 1;
}

const clean = t => String(t || '').replace(/[《》「」【】\s]/g, '');

const CJK = /[\u3000-\u9fff\uf900-\ufaff]/;

// 书名切成竖排的一到两列，每列最多七个字。再长就截断，封面不是简介
function columns(title) {
  const t = clean(title) || '无题';
  const per = 7;
  if (t.length <= per) return [t.split('')];
  return [t.slice(0, per).split(''), t.slice(per, per * 2).split('')];
}

// 拉丁书名不竖排。一个字母一行既难看也不是它的排法，横排折行才是
function wrap(title, per = 11) {
  const words = String(title || '').trim().split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= per) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
    if (lines.length >= 3) break;
  }
  if (cur && lines.length < 4) lines.push(cur);
  return lines.slice(0, 4);
}

// 字数少就排大一点。两个字的书名用小字排，封面会空得发虚
const sizeFor = n => (n === 1 ? 14 : n === 2 ? 11.5 : n <= 4 ? 9 : 7.4);

/**
 * 生成的那一张。60 x 90 的画布，和真实封面同一个比例。
 * 尺寸由外面的盒子定，这里只管版式。
 */
export function DrawnCover({ title, author = '', mini = false }) {
  const n = tintOf(title);
  const name = clean(title) || '无题';
  const zh = CJK.test(name);
  const body = zh
    ? (() => {
      const cols = columns(name);
      const size = mini ? 10 : sizeFor(cols[0].length);
      const step = size * 1.16;
      return cols.map((chars, ci) => chars.map((ch, i) => html`
        <text key=${`${ci}-${i}`} class="cv-title"
          x=${44 - ci * (size + 2.4)} y=${14 + size * 0.5 + i * step}
          font-size=${size} text-anchor="middle">${ch}</text>`));
    })()
    : (() => {
      const lines = wrap(name, mini ? 8 : 11);
      const size = mini ? 8 : lines.length > 2 ? 7 : 8.6;
      return lines.map((ln, i) => html`
        <text key=${i} class="cv-title" x="11" y=${22 + i * size * 1.25}
          font-size=${size} text-anchor="start">${ln}</text>`);
    })();

  return html`
    <svg class=${`cv-drawn cv-t${n}`} viewBox="0 0 60 90" preserveAspectRatio="none"
      role="img" aria-label=${name}>
      <rect x="0" y="0" width="60" height="90" class="cv-ground"/>
      <rect x="3.5" y="3.5" width="53" height="83" class="cv-frame"/>
      ${body}
      <line x1="11" y1="72" x2="27" y2="72" class="cv-rule"/>
      ${author && !mini ? html`
        <text class="cv-author" x="11" y="79.5" font-size="3.6">${clean(author).slice(0, 10)}</text>` : null}
    </svg>`;
}

/**
 * 封面。按四档找：自己传的，填的地址，接上那本书自带的，最后生成一张。
 * 书架、书库两处共用，长得一样。
 */
export function BookCover({ title, author = '', cover = null, coverUrl = '',
  bookCover = null, mini = false, className = '' }) {
  const mine = useThumb(cover);
  const fromBook = useThumb(bookCover);
  const src = mine || coverUrl || fromBook || '';
  return html`
    <div class=${`cv ${mini ? 'cv-mini' : ''} ${className}`}>
      ${src
        ? html`<div class="cv-photo" style=${`background-image:url(${src})`}></div>`
        : html`<${DrawnCover} title=${title} author=${author} mini=${mini}/>`}
    </div>`;
}

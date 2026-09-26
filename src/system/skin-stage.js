// 生成器顶上那块预览。见 ARCHITECTURE 4.138
//
// ---- 为什么是一份手写的复刻，不是真组件 ----
//
// 真的 `Bubble` 与 `ComposerBar` 只在会话页里有，用它们就得先挂到某一段会话
// 上才能调样式 —— 而生成器要能独立打开。更要紧的是：真页面上很多状态凑不齐。
// 「同一个人连发三条」要正好有那样一段历史，「带引用的一条」「表情」「已读」
// 各要一个条件，凑齐一屏得先造一段假数据进库。
//
// 所以这里手写一份，把要调的状态一次摆全。
//
// ---- 手写的那一份一定会走偏，所以有一个测试盯着 ----
//
// 「另写一份假的，真页面改了 class 它不跟」是这个项目反复吃过的亏
//（4.135 就是上一次）。`stage.mjs` 把这一份和真会话页各渲染一遍，
// 把两边出现的契约钩子与它们的嵌套关系对起来，对不上就报错。
//
// **所以这份复刻只保证契约钩子那一层一致**，内部类名、真实图片、网络字体、
// 流式那几个中间态都不在内。要看那些仍然回会话页。

import { HOOKS } from './skin-contract.js';

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 图标画成 svg，和真界面同一套路径。 */
import { PATHS } from '../icons/paths.js';
const icon = (name, size = 20) => {
  const d = PATHS[name] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
};

const face = (name, mine) => `<div class="msg-face ph-face">`
  + `<div class="avatar ph-avatar avatar-fallback" style="--av-size:36px;--av-r:18px;--av-fs:14px">`
  + `${esc(mine ? '我' : name).slice(0, 1)}</div></div>`;

/**
 * 一行消息。
 *
 *   parts   这一轮拆成几个气泡。`.ph-col` 里放几个 `.ph-bubble`
 *   quote   带一条引用
 *   meta    带时刻与已读
 *   sticker 这一行是表情
 */
function row({ mine, name, parts, quote, stamp, read, sticker, card, trans }) {
  const bubbles = sticker
    ? `<div class="bubble-sticker ph-sticker">${icon('heart', 48)}</div>`
    : card ? CARDS[card]
    : parts.map((t, i) => `<div class="bubble ph-bubble `
      + `${mine ? 'ph-bubble-mine' : 'ph-bubble-theirs'}${trans && i === parts.length - 1 ? ' has-trans' : ''}">`
      // 气泡里那一份引用（默认不显示，见 Conversation.js 的 QuoteIn）
      + (quote && i === 0 ? `<span class="bubble-quote ph-quote-in"><span class="quote-name">${esc(quote.name)}</span>`
        + `<span class="quote-text">${esc(quote.text)}</span></span>` : '')
      + esc(t)
      + (trans && i === parts.length - 1 ? `<div class="bubble-trans ph-trans">${esc(trans)}</div>` : '')
      + '</div>').join('');
  const q = quote
    ? `<button class="quote-ref ph-quote"><span class="quote-name">${esc(quote.name)}</span>`
      + `<span class="quote-text ellipsis">${esc(quote.text)}</span></button>`
    : '';
  const m = (stamp || read)
    ? `<div class="msg-meta ph-meta at-side">`
      + (stamp ? `<span class="msg-stamp ph-stamp">${esc(stamp)}</span>` : '')
      + (read ? `<span class="msg-read ph-read">${esc(read)}</span>` : '')
      + '</div>'
    : '';
  return `<div class="msg ph-msg ${mine ? 'is-mine ph-msg-mine' : 'ph-msg-theirs'}">`
    + face(name, mine)
    + `<div class="msg-col ph-col">${bubbles}${q}</div>${m}</div>`;
}

/**
 * 几种卡片气泡。结构照着真组件抄（TransferBits.js、MediaBubble.js），
 * 契约钩子那一层由 stage.mjs 盯着，内部类名跟着抄是为了预览里长得像。
 */
const CARDS = {
  transfer: `<div class="bubble bubble-transfer ph-transfer"><div class="tr-top">${icon('wallet')}`
    + `<div class="tr-body"><div class="tr-amount">¥52.00</div><div class="tr-note ellipsis">奶茶钱</div></div></div>`
    + `<div class="tr-foot">待收款</div></div>`,
  gift: `<div class="bubble bubble-gift ph-gift"><div class="tr-top">${icon('gift')}`
    + `<div class="tr-body"><div class="gift-cover ellipsis">一个小盒子</div></div></div>`
    + `<div class="tr-foot">未拆开</div></div>`,
  voice: `<div class="voice-wrap"><button class="bubble bubble-voice ph-voice press">${icon('headphone', 16)}`
    + `<span class="voice-bars">${[6, 10, 14, 6].map(h => `<i style="height:${h}px"></i>`).join('')}</span>`
    + `<span class="voice-len">4"</span></button></div>`,
  call: `<div class="bubble bubble-call ph-call">${icon('phone', 18)}<span>通话时长 03:12</span></div>`,
  location: `<div class="bubble bubble-location ph-location"><div class="loc-body">`
    + `<div class="loc-name ellipsis">海边</div><div class="loc-addr ellipsis">滨海路 1 号</div></div>`
    + `<div class="loc-map">${icon('map', 22)}</div></div>`,
};

/**
 * 摆出来的那一屏。**连发三条是故意的** —— 「只有第一条带头像」
 * 这类规则要有连着的几条才看得出来。
 */
export const SAMPLE = {
  charName: '阿岚',
  title: '阿岚',
  rows: [
    { mine: false, name: '阿岚', parts: ['连着的第一条。'] },
    { mine: false, name: '阿岚', parts: ['连着的第二条。'] },
    { mine: false, name: '阿岚', parts: ['连着的第三条，这一轮还拆成了两个气泡。', '第二个气泡在这里。'] },
    { mine: true, name: '我', parts: ['我回一条。'], stamp: '09:41', read: '已读' },
    { mine: true, name: '我', parts: ['带引用的一条。'],
      quote: { name: '阿岚', text: '连着的第三条' } },
    { mine: false, name: '阿岚', sticker: true },
    { sep: '昨天 21:30' },
    { mine: false, name: '阿岚', parts: ['带译文的一条。'], trans: 'A line with a translation.' },
    { mine: false, name: '阿岚', card: 'voice' },
    { mine: true, name: '我', card: 'transfer' },
    { mine: false, name: '阿岚', card: 'gift' },
    { mine: false, name: '阿岚', card: 'location' },
    { mine: true, name: '我', card: 'call' },
  ],
};

/** 顶栏。返回键、标题、右上角那个按钮，各有各的钩子。 */
const navbar = title => `<div class="navbar ph-navbar">`
  + `<div class="nav-left ph-nav-left">`
  + `<button class="icon-btn press ph-back" aria-label="返回">${icon('chevronLeft', 22)}</button></div>`
  + `<div class="nav-title ellipsis ph-nav-title">${esc(title)}</div>`
  + `<div class="nav-right ph-nav-right">`
  + `<button class="icon-btn press ph-nav-action" aria-label="更多">${icon('more', 20)}</button></div>`
  + '</div>';

/** 底栏。加号、输入框、表情、发送键。 */
const composer = () => `<div class="composer-bar ph-composer">`
  + `<button class="composer-side ph-composer-btn ph-plus press" aria-label="添加内容">${icon('plus')}</button>`
  + `<textarea class="composer-input ph-composer-input" rows="1" readonly placeholder="Aa…"></textarea>`
  + `<button class="composer-side ph-composer-btn ph-sticker-btn press" aria-label="表情">${icon('heart')}</button>`
  + `<button class="send-btn ph-send is-ghost press" aria-label="让对方回复">${icon('reply', 22)}</button>`
  + '</div>';

/**
 * 复刻页要的那几张样式表。
 *
 * **和 index.html 里那一串一模一样，一张都不能少。** 栽过一次：只取了
 * base 与 app，而 `.navbar` 的 `display: grid` 写在 ui.css 里，于是预览里
 * 顶栏三样东西竖着排成一摞，看着像布局坏了 —— 坏的是取样式表那一步。
 */
const SHEETS = ['styles/tokens.css', 'styles/base.css', 'styles/ui.css',
  'styles/shell.css', 'styles/app.css'];

let cssOnce = null;
export function stageCss() {
  if (!cssOnce) {
    cssOnce = Promise.all(SHEETS.map(u => fetch(u)
      .then(r => (r.ok ? r.text() : ''))
      .catch(() => ''))).then(parts => parts.join('\n'));
  }
  return cssOnce;
}

/** 整块。外面那一层 `.ph-page` 与 `.ph-chat` 都要有，作者写得到它们。 */
export function buildStage(sample = SAMPLE) {
  return `<div class="page ph-page stage-page">`
    + navbar(sample.title)
    + `<div class="conv ph-chat">`
    + `<div class="conv-main"><div class="conv-body ph-chat-body">`
    + sample.rows.map(r => (r.sep ? `<div class="time-sep ph-time-sep">${esc(r.sep)}</div>` : row(r))).join('')
    + `</div></div>`
    + composer()
    + '</div></div>';
}

/** 复刻页里出现了哪些契约钩子。`stage.mjs` 拿它和真页面对。 */
export const hooksInStage = () => {
  const html = buildStage();
  return HOOKS.filter(h => html.includes(`ph-${h.hook}`)).map(h => h.hook);
};

import { html } from '../../lib.js';
import { Icon } from '../../icons/Icon.js';
import { registerWidget } from '../../system/registry.js';
import { chats, moments, memories, characters, lastMessageOf, persona } from '../../system/db/index.js';
import * as health from '../../system/health.js';
import * as album from '../../system/album.js';
import { openApp } from '../../system/nav.js';
import { useImage, useThumb } from '../../system/db/useImage.js';
import { useFile } from '../../system/db/useFile.js';

function relTime(ts) {
  if (!ts) return '';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  if (min < 1440) return `${Math.floor(min / 60)}小时前`;
  return `${Math.floor(min / 1440)}天前`;
}

// ---- 播放器版式横条 ----
export const LINE_SIZES = [
  { value: 'sm', label: '小' },
  { value: 'md', label: '中' },
  { value: 'lg', label: '大' },
  { value: 'xl', label: '特大' },
];

export const PLAYER_DEFAULT = {
  cover: null,
  align: 'left',
  line1: '', size1: 'md',
  line2: '', size2: 'xl',
  line3: '', size3: 'lg',
  serif: true,
};

function Cover({ id }) {
  const url = useThumb(id);
  return html`
    <div class="pl-cover" style=${url ? `background-image:url(${url})` : ''}>
      ${url ? null : html`<${Icon} name="image" size=${22}/>`}
    </div>`;
}

registerWidget({
  id: 'player',
  label: '播放器横条',
  sizes: [[4, 2]],
  editable: true,
  render(cell) {
    const c = { ...PLAYER_DEFAULT, ...(cell?.config || {}) };
    return html`
      <div class=${`wg wg-player${c.align === 'right' ? ' is-right' : ''}${c.serif ? ' is-serif' : ''}`}>
        <${Cover} id=${c.cover}/>
        <div class="pl-text">
          ${[1, 2, 3].map(n => c[`line${n}`]
            ? html`<div key=${n} class=${`pl-line pl-${c[`size${n}`]}`}>${c[`line${n}`]}</div>`
            : null)}
        </div>
        <${Icon} name="music" size=${18} class="pl-mark"/>
      </div>`;
  },
});

// ---- 自由文字块，任意尺寸 ----
export const NOTE_DEFAULT = { line1: '', size1: 'lg', line2: '', size2: 'sm', serif: false };

registerWidget({
  id: 'note',
  label: '文字块',
  sizes: [[2, 1], [2, 2], [4, 1], [4, 2]],
  editable: true,
  render(cell) {
    const c = { ...NOTE_DEFAULT, ...(cell?.config || {}) };
    return html`
      <div class=${`wg wg-note${c.serif ? ' is-serif' : ''}`}>
        <div class=${`pl-line pl-${c.size1}`}>${c.line1}</div>
        ${c.line2 ? html`<div class=${`pl-line pl-${c.size2}`}>${c.line2}</div>` : null}
      </div>`;
  },
});

// ---- 大图块 ----
registerWidget({
  id: 'photo',
  label: '图片块',
  sizes: [[2, 2], [4, 2], [2, 1]],
  editable: true,
  render(cell) {
    const c = cell?.config || {};
    return html`<${PhotoBody} id=${c.cover} caption=${c.line1}/>`;
  },
});

// 这个挂件可以占满一整行，缩略图撑到那么宽会糊，所以用原图。
// 别处那些小图（歌单封面、头像、气泡、九宫格）都走 useThumb
function PhotoBody({ id, caption }) {
  const url = useImage(id);
  return html`
    <div class="wg wg-photo" style=${url ? `background-image:url(${url})` : ''}>
      ${url ? null : html`<div class="wg-photo-empty"><${Icon} name="image" size=${24}/></div>`}
      ${caption ? html`<div class="wg-photo-cap">${caption}</div>` : null}
    </div>`;
}

registerWidget({
  id: 'recent-chats',
  label: '最近会话',
  sizes: [[2, 2], [4, 2]],
  render() {
    const list = chats.all()
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
      .slice(0, 3);
    return html`
      <div class="wg wg-list" onClick=${() => openApp('chat')}>
        <div class="wg-head"><${Icon} name="message" size=${15}/><span>最近会话</span></div>
        ${list.length ? html`<div class="wg-rows">
          ${list.map(c => {
            const char = characters.get((c.characterIds || [])[0]);
            const last = lastMessageOf(c.id);
            return html`
              <div key=${c.id} class="wg-row">
                <div class="wg-row-title ellipsis">${char?.name || c.title || '会话'}</div>
                <div class="wg-row-sub ellipsis">${last?.content || '还没有消息'}</div>
              </div>`;
          })}
        </div>` : html`<div class="wg-empty">还没有会话</div>`}
      </div>`;
  },
});

registerWidget({
  id: 'moments-peek',
  label: '朋友圈',
  sizes: [[2, 2], [4, 2]],
  render() {
    const mo = moments.all().sort((a, b) => b.createdAt - a.createdAt)[0];
    const author = mo ? (mo.authorId === 'me' ? persona.get().name : characters.get(mo.authorId)?.name) : null;
    return html`
      <div class="wg wg-list" onClick=${() => openApp('chat', '/moments')}>
        <div class="wg-head"><${Icon} name="moments" size=${15}/><span>朋友圈</span></div>
        ${mo ? html`
          <div class="wg-rows">
            <div class="wg-row-title ellipsis">${author || '某人'}</div>
            <div class="wg-moment-text">${mo.text}</div>
            <div class="wg-row-sub">${relTime(mo.createdAt)}</div>
          </div>` : html`<div class="wg-empty">还没有动态</div>`}
      </div>`;
  },
});

registerWidget({
  id: 'memory-count',
  label: '记忆统计',
  sizes: [[2, 2], [2, 1]],
  render() {
    const all = memories.all();
    const auto = all.filter(m => m.source === 'auto').length;
    return html`
      <div class="wg wg-stat" onClick=${() => openApp('memory')}>
        <div class="wg-head"><${Icon} name="brain" size=${15}/><span>记忆</span></div>
        <div class="wg-stat-num">${all.length}</div>
        <div class="wg-row-sub">其中 ${auto} 条自动提取</div>
      </div>`;
  },
});

// ---- 健康 ----
//
// 摆在主界面上的东西是**一眼扫过去会被别人看见的**，所以显示哪几项由用户自己挑，
// 默认不含体重 —— 那一项最不适合放在随手一瞥的地方。第 13 条同样的道理：
// 代码不替用户做这个决定，只把默认值往保守了给。

export const HEALTH_STATS = [
  { id: 'sleep', label: '睡眠' },
  { id: 'steps', label: '步数' },
  { id: 'water', label: '喝水' },
  { id: 'weight', label: '体重' },
  { id: 'mood', label: '心情' },
];

export const HEALTH_DEFAULT = { show: ['sleep', 'steps', 'water'] };

// 挂件上写不下「7 小时 30 分」，缩成 7h30
const shortSleep = min => {
  const m = Math.max(0, Math.round(min) || 0);
  if (!m) return '—';
  const h = Math.floor(m / 60);
  return h ? `${h}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`;
};

function healthValue(id, d) {
  if (id === 'sleep') return shortSleep(d.sleepMin);
  if (id === 'steps') return d.steps ? d.steps.toLocaleString() : '—';
  if (id === 'water') return String(d.water || 0);
  if (id === 'weight') return d.weight ? String(health.toDisplay(d.weight)) : '—';
  if (id === 'mood') return health.moodOf(d.mood)?.label || '—';
  return '—';
}

registerWidget({
  id: 'health',
  label: '健康',
  sizes: [[2, 1], [2, 2], [4, 1], [4, 2]],
  editable: true,
  render(cell) {
    const c = { ...HEALTH_DEFAULT, ...(cell?.config || {}) };
    const d = health.today();
    const picked = HEALTH_STATS.filter(x => (c.show || []).includes(x.id));
    const flat = (cell?.h || 2) === 1;
    const due = health.dueMeds();

    return html`
      <div class=${`wg wg-health${flat ? ' is-flat' : ''}`} onClick=${() => openApp('health')}>
        ${flat ? null : html`
          <div class="wg-head"><${Icon} name="pulse" size=${15}/><span>今天</span></div>`}
        ${picked.length ? html`
          <div class="wg-hl">
            ${picked.map(x => html`
              <div key=${x.id} class="wg-hl-one">
                <b>${healthValue(x.id, d)}</b>
                <span>${x.label}</span>
              </div>`)}
          </div>`
        : html`<div class="wg-empty">尚未选择要显示的项目</div>`}
        ${!flat && due.length ? html`
          <div class="wg-row-sub">${due.map(m => m.name).join('、')} 还没有记上</div>` : null}
      </div>`;
  },
});

// ---- 相册 ----
//
// 最近存的几张铺成一格。没有图的卡片（光栅没成的那些）不铺进来 ——
// 挂件上放一块空白没有意义，宁可少一张。

const albumTiles = n => album.allPhotos().filter(p => p.imageId).slice(0, n);

function Shot({ id }) {
  const url = useThumb(id);
  return html`<span class="wg-shot" style=${url ? `background-image:url(${url})` : ''}></span>`;
}

registerWidget({
  id: 'album',
  label: '相册',
  sizes: [[2, 2], [4, 2], [2, 1]],
  render(cell) {
    const flat = (cell?.h || 2) === 1;
    const wide = (cell?.w || 2) >= 4;
    const tiles = albumTiles(flat ? 3 : wide ? 8 : 4);
    const total = album.allPhotos().length;
    return html`
      <div class=${`wg wg-album${flat ? ' is-flat' : ''}`} onClick=${() => openApp('album')}>
        ${flat ? null : html`
          <div class="wg-head"><${Icon} name="camera" size=${15}/><span>相册</span></div>`}
        ${tiles.length ? html`
          <div class=${`wg-shots${wide ? ' is-wide' : ''}`}>
            ${tiles.map(p => html`<${Shot} key=${p.id} id=${p.imageId}/>`)}
          </div>`
        : html`<div class="wg-empty">还没有存过图片</div>`}
        ${!flat && total ? html`<div class="wg-row-sub">共 ${total} 张</div>` : null}
      </div>`;
  },
});

registerWidget({
  id: 'clock',
  label: '时间',
  sizes: [[2, 1], [2, 2], [4, 1]],
  render() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return html`
      <div class="wg wg-clock">
        <div class="wg-clock-time">${hh}:${mm}</div>
        <div class="wg-row-sub">${now.getMonth() + 1}月${now.getDate()}日 星期${'日一二三四五六'[now.getDay()]}</div>
      </div>`;
  },
});


// ---- Love：头像 + 一行字 + 整月日历 ----
//
// 默认黑白，颜色全部走 currentColor，配色只有 --love-ink 一个口子，
// 用户改颜色时以内联样式塞进去（cell.config.color）。
//
// 日历撑满剩下的高度，天数格子用 1fr 平分，并且**固定画六行** ——
// 原稿是定高 420 加固定间距，赶上跨六周的月份最后一行就被切掉；
// 按剩余空间分行既不会切，也不会因为这个月只有五行就忽然变高。
export const LOVE_DEFAULT = {
  cover: null,
  word: 'Love',
  color: '',          // 空 = 跟随主题的前景色
  serif: true,
  lang: 'en',         // en | zh
};

const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_EN_MIN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六'];

function LoveBody({ cell }) {
  const c = { ...LOVE_DEFAULT, ...(cell?.config || {}) };
  const avatar = useThumb(c.cover);
  const zh = c.lang === 'zh';
  // 2 格宽的时候一行塞不下 Sun Mon Tue，星期只留首字母
  const compact = (cell?.w || 4) <= 2;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthName = zh ? `${month + 1}月` : new Date(year, month, 1).toLocaleString('en-US', { month: 'long' });

  // 小号只铺两周：本周和下周。整月塞进 188px 每一格只剩十来个像素，
  // 密得看不清 —— 而且日常真正要看的就是眼前这几天。
  // 大号才铺整月，按当月实际占几行平分剩余高度：定高会把跨六周的月份
  // 最后一行切掉，补到固定六行又会在五行的月份底下留一条空带子。
  let rows;
  const days = [];
  if (compact) {
    rows = 2;
    const sunday = new Date(year, month, now.getDate() - now.getDay());
    for (let i = 0; i < 14; i++) {
      const d = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
      days.push({
        n: d.getDate(),
        out: d.getMonth() !== month,
        today: d.getMonth() === month && d.getDate() === now.getDate(),
      });
    }
  } else {
    const first = new Date(year, month, 1).getDay();
    const total = new Date(year, month + 1, 0).getDate();
    rows = Math.ceil((first + total) / 7);
    for (let i = 0; i < first; i++) days.push(null);
    for (let d = 1; d <= total; d++) days.push({ n: d, out: false, today: d === now.getDate() });
    while (days.length < rows * 7) days.push(null);
  }

  return html`
    <div class=${`wg wg-love${c.serif ? ' is-serif' : ''}${compact ? ' is-compact' : ''}`}
      style=${c.color ? `--love-ink:${c.color}` : ''}>

      <div class="love-top">
        <div class=${`love-avatar${avatar ? ' has-image' : ''}`}
          style=${avatar ? `background-image:url(${avatar})` : ''}>
          ${avatar ? null : html`<${Icon} name="user" size=${compact ? 16 : 20}/>`}
        </div>
        <div class="love-right">
          <div class="love-word ellipsis">${c.word}</div>
          <div class="love-eq">
            ${Array.from({ length: compact ? 14 : 26 }, (_, i) => html`<i key=${i}></i>`)}
          </div>
        </div>
      </div>

      <div class="love-cal">
        <div class="love-cal-head">
          <span class="love-month">${monthName}</span>
          <span class="love-year">${year}</span>
        </div>
        <div class="love-week">
          ${(zh ? WEEK_ZH : compact ? WEEK_EN_MIN : WEEK_EN)
            .map((w, i) => html`<span key=${i}>${w}</span>`)}
        </div>
        <div class="love-days" style=${`grid-template-rows:repeat(${rows},1fr)`}>
          ${days.map((d, i) => d === null
            ? html`<span key=${i}></span>`
            : html`
              <span key=${i}
                class=${`love-day${d.today ? ' is-today' : ''}${d.out ? ' is-out' : ''}`}>
                ${d.today ? html`<${Icon} name="music" size=${compact ? 12 : 14}/>` : d.n}
              </span>`)}
        </div>
      </div>
    </div>`;
}

registerWidget({
  id: 'love',
  label: 'Love 日历',
  sizes: [[2, 2], [4, 4], [4, 3]],
  editable: true,
  render(cell) { return html`<${LoveBody} cell=${cell}/>`; },
});

// ---- 自定义组件：自己传一个 HTML 进来 ----
//
// 一律关进 sandbox 的 iframe，且**不给 allow-same-origin**。
// 这样它拿到的是一个不透明源，读不到本应用的 IndexedDB 与 localStorage ——
// 接口密钥就存在那里面，一个随手传进来的 HTML 不该够得着。
// 代价是它也用不了本应用的任何数据，只能自己画自己的。
export const CUSTOM_DEFAULT = { fileId: null, name: '' };
export const CUSTOM_MAX_BYTES = 512 * 1024;

function CustomBody({ cell }) {
  const c = { ...CUSTOM_DEFAULT, ...(cell?.config || {}) };
  const url = useFile(c.fileId);

  if (!c.fileId) {
    return html`
      <div class="wg wg-custom-empty">
        <${Icon} name="grid" size=${22}/>
        <span>点这里上传一个 HTML 文件</span>
      </div>`;
  }
  if (!url) return html`<div class="wg wg-custom-empty"><span class="spinner"></span></div>`;

  return html`
    <iframe class="wg-custom" src=${url} sandbox="allow-scripts"
      title=${c.name || '自定义组件'} loading="lazy"></iframe>`;
}

registerWidget({
  id: 'custom',
  label: '自定义组件',
  sizes: [[2, 1], [2, 2], [4, 1], [4, 2], [4, 4]],
  editable: true,
  render(cell) { return html`<${CustomBody} cell=${cell}/>`; },
});

import { html } from '../../lib.js';
import { Icon } from '../../icons/Icon.js';
import { registerWidget } from '../../system/registry.js';
import { chats, moments, characters, messagesOf } from '../../system/db/index.js';
import * as album from '../../system/album.js';
import * as accounts from '../../system/accounts.js';
import * as day from '../../system/day.js';
import * as weather from '../../system/weather.js';
import { openApp } from '../../system/nav.js';
import { useImage, useThumb } from '../../system/db/useImage.js';

// ins 风的一组小组件。
//
// 仍然守着 tokens.css 那句「黑白，不用灰作为填充色」：ins 的样子靠的是留白、
// 发丝线、衬线字与小写的英文标注，不靠颜色。拍立得的相纸在深色主题下也是白的，
// 和应用图标在深色下仍是白底同一个道理（--paper）。
//
// 每个组件的可调项写在 fields 里，编辑面板照着它生成（WidgetEditor），
// 不再每加一个组件就去那边手写一段表单。

const GROUP = 'ins';
// 点一下就跳走的那几个，不让这一下再冒泡到格子上 —— 格子上那一下是「打开编辑面板」，
// 两件事一起发生，回到主屏时面前摆着一张没人要的编辑表。改内容走整理模式里的「编辑内容」
const go = fn => e => { e.stopPropagation(); fn(); };
const pad = n => String(n).padStart(2, '0');
const dot = t => { const d = new Date(t); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 选了哪个角色；没选就用最近聊过的那一个 —— 放上去就有东西看，不是一块空白
function charOf(id) {
  if (id) return characters.get(id) || null;
  const me = accounts.currentId();
  const last = chats.where(c => (c.personaId || me) === me && (c.characterIds || []).length === 1)
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))[0];
  return last ? characters.get(last.characterIds[0]) : characters.all()[0] || null;
}
const chatWith = charId => {
  const me = accounts.currentId();
  return chats.all().find(c => (c.characterIds || []).length === 1 && c.characterIds[0] === charId
    && (c.personaId || me) === me) || null;
};
const CHAR_FIELD = { key: 'charId', type: 'char', label: '角色', desc: '不选则跟随最近聊过的角色' };

function Round({ id, name, size, ring }) {
  const url = useThumb(id);
  return html`
    <span class=${`ins-round${ring ? ` is-${ring}` : ''}`} style=${`--round:${size}px`}>
      <span class="ins-round-in" style=${url ? `background-image:url(${url})` : ''}>
        ${url ? null : (name || '').slice(0, 1)}
      </span>
    </span>`;
}

function Tile({ id, cls = 'ins-tile' }) {
  const url = useThumb(id);
  return html`<span class=${cls} style=${url ? `background-image:url(${url})` : ''}></span>`;
}

// ---- 拍立得 ----
function PolaroidBody({ cell }) {
  const c = cell?.config || {};
  const url = useImage(c.cover);
  const tall = (cell?.h || 2) >= 3;
  return html`
    <div class=${`wg ins-polaroid${c.tilt ? ` is-tilt-${c.tilt}` : ''}${tall ? ' is-tall' : ''}`}>
      <div class="ins-paper">
        <div class="ins-shot" style=${url ? `background-image:url(${url})` : ''}>
          ${url ? null : html`<${Icon} name="image" size=${22}/>`}
        </div>
        <div class="ins-caption">
          <span class="ins-caption-t">${c.caption || (url ? '' : '长按主屏编辑，放一张照片')}</span>
          ${c.date !== false ? html`<span class="ins-caption-d">${dot(c.at || Date.now())}</span>` : null}
        </div>
      </div>
    </div>`;
}
registerWidget({
  id: 'ins-polaroid', label: '拍立得', group: GROUP, desc: '一张照片加一行手写感的字',
  sizes: [[2, 2], [2, 3], [4, 3]], editable: true,
  defaults: { cover: null, caption: '', date: true, tilt: '' },
  fields: [
    { key: 'cover', type: 'image', label: '照片' },
    { key: 'caption', type: 'text', label: '文字', placeholder: '例如 a quiet sunday' },
    { key: 'date', type: 'switch', label: '显示日期', desc: '相纸右下角的日期，取放上照片的那一天' },
    { key: 'tilt', type: 'segmented', label: '摆放',
      items: [{ value: '', label: '端正' }, { value: 'l', label: '左倾' }, { value: 'r', label: '右倾' }] },
  ],
  render(cell) { return html`<${PolaroidBody} cell=${cell}/>`; },
});

// ---- 胶片 ----
function FilmBody({ cell }) {
  const c = cell?.config || {};
  const wide = (cell?.w || 4) >= 4;
  const n = wide ? 4 : 2;
  const shots = (c.source === 'moments'
    ? moments.all().sort((a, b) => b.createdAt - a.createdAt).flatMap(m => m.images || [])
    : album.allPhotos().filter(p => p.imageId).map(p => p.imageId)).slice(0, n);
  const open = () => (c.source === 'moments' ? openApp('chat', '/moments') : openApp('album'));
  return html`
    <div class="wg ins-film" onClick=${go(open)}>
      <div class="ins-holes"></div>
      <div class="ins-frames">
        ${Array.from({ length: n }, (_, i) => html`
          <div key=${i} class="ins-frame">
            ${shots[i] ? html`<${Tile} id=${shots[i]} cls="ins-frame-img"/>` : html`<span class="ins-frame-img is-empty"></span>`}
            <span class="ins-frame-no">${pad(i + 1)}A</span>
          </div>`)}
      </div>
      <div class="ins-holes"></div>
      <span class="ins-film-mark">${(c.label || 'FILM 400').slice(0, 16)}</span>
    </div>`;
}
registerWidget({
  id: 'ins-film', label: '胶片', group: GROUP, desc: '最近的几张照片排成一条底片',
  sizes: [[4, 1], [4, 2], [2, 1]], editable: true,
  defaults: { source: 'album', label: 'FILM 400' },
  fields: [
    { key: 'source', type: 'segmented', label: '照片来自',
      items: [{ value: 'album', label: '相册' }, { value: 'moments', label: '朋友圈' }] },
    { key: 'label', type: 'text', label: '边上的字', placeholder: 'FILM 400' },
  ],
  render(cell) { return html`<${FilmBody} cell=${cell}/>`; },
});

// ---- 快拍：一排头像，二十四小时内发过动态的带一圈 ----
function StoriesBody({ cell }) {
  const me = accounts.current();
  const since = Date.now() - 24 * 3600 * 1000;
  const fresh = new Set(moments.where(m => m.createdAt >= since).map(m => m.authorId));
  const n = Math.max(3, Math.round((cell?.w || 4) * 1.25));
  const list = characters.all()
    .sort((a, b) => Number(fresh.has(b.id)) - Number(fresh.has(a.id))
      || (chatWith(b.id)?.lastMessageAt || 0) - (chatWith(a.id)?.lastMessageAt || 0))
    .slice(0, n - 1);
  return html`
    <div class="wg ins-stories">
      <button class="ins-story" onClick=${e => { e.stopPropagation(); openApp('chat', '/moments'); }}>
        <${Round} id=${me?.avatar} name=${me?.name} size=${46} ring=${fresh.has('me') ? 'new' : 'seen'}/>
        <span class="ins-story-name">你的快拍</span>
      </button>
      ${list.map(ch => html`
        <button key=${ch.id} class="ins-story"
          onClick=${e => { e.stopPropagation(); openApp('chat', fresh.has(ch.id) ? '/moments' : `/profile/${ch.id}`); }}>
          <${Round} id=${ch.avatar} name=${ch.name} size=${46} ring=${fresh.has(ch.id) ? 'new' : 'seen'}/>
          <span class="ins-story-name ellipsis">${ch.name}</span>
        </button>`)}
    </div>`;
}
registerWidget({
  id: 'ins-stories', label: '快拍', group: GROUP, desc: '一排头像，二十四小时内发过动态的带一圈',
  sizes: [[4, 1]],
  render(cell) { return html`<${StoriesBody} cell=${cell}/>`; },
});

// ---- 主页卡 ----
function ProfileBody({ cell }) {
  const ch = charOf(cell?.config?.charId);
  if (!ch) return html`<div class="wg"><div class="wg-empty">还没有角色</div></div>`;
  const posts = moments.where(m => m.authorId === ch.id).length;
  const shots = album.allPhotos().filter(p => p.from?.charId === ch.id).length;
  const chat = chatWith(ch.id);
  const days = chat ? Math.max(1, Math.ceil((Date.now() - (chat.createdAt || Date.now())) / 86400000)) : 0;
  return html`
    <div class="wg ins-profile" onClick=${go(() => openApp('chat', `/profile/${ch.id}`))}>
      <div class="ins-profile-top">
        <${Round} id=${ch.avatar} name=${ch.name} size=${62} ring="seen"/>
        <div class="ins-profile-stats">
          <div><b>${posts}</b><span>posts</span></div>
          <div><b>${shots}</b><span>photos</span></div>
          <div><b>${days}</b><span>days</span></div>
        </div>
      </div>
      <div class="ins-profile-name ellipsis">${ch.name}</div>
      ${ch.signature ? html`<div class="ins-profile-sign ellipsis">${ch.signature}</div>` : null}
    </div>`;
}
registerWidget({
  id: 'ins-profile', label: '主页卡', group: GROUP, desc: '角色的头像、动态数与签名',
  sizes: [[4, 2]], editable: true, defaults: { charId: '' }, fields: [CHAR_FIELD],
  render(cell) { return html`<${ProfileBody} cell=${cell}/>`; },
});

// ---- 九宫格 ----
function GridBody({ cell }) {
  const c = cell?.config || {};
  const ids = (c.source === 'album'
    ? album.allPhotos().filter(p => p.imageId).map(p => p.imageId)
    : moments.all().sort((a, b) => b.createdAt - a.createdAt).flatMap(m => m.images || [])).slice(0, 9);
  const open = () => (c.source === 'album' ? openApp('album') : openApp('chat', '/moments'));
  return html`
    <div class="wg ins-grid" onClick=${go(open)}>
      ${Array.from({ length: 9 }, (_, i) => (ids[i]
        ? html`<${Tile} key=${i} id=${ids[i]}/>`
        : html`<span key=${i} class="ins-tile is-empty"></span>`))}
    </div>`;
}
registerWidget({
  id: 'ins-grid', label: '九宫格', group: GROUP, desc: '最近九张照片，像主页的格子',
  sizes: [[2, 2], [4, 4]], editable: true, defaults: { source: 'moments' },
  fields: [{ key: 'source', type: 'segmented', label: '照片来自',
    items: [{ value: 'moments', label: '朋友圈' }, { value: 'album', label: '相册' }] }],
  render(cell) { return html`<${GridBody} cell=${cell}/>`; },
});

// ---- 一句：角色说过的一句话，每天换一句 ----
//
// 从聊天记录里挑，本地挑，不调接口。按日期取，同一天看到的是同一句；
// 太短的（嗯、好）和太长的（放不下）不挑
function pickLine(ch) {
  const chat = ch ? chatWith(ch.id) : null;
  if (!chat) return null;
  const pool = messagesOf(chat.id).filter(m => m.role === 'char' && m.kind === 'text'
    && m.status !== 'error' && !/^\[/.test(m.content || '') && (m.content || '').length >= 6 && (m.content || '').length <= 60);
  if (!pool.length) return null;
  const d = new Date();
  const seed = d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate();
  return { m: pool[seed % pool.length], chat };
}
function QuoteBody({ cell }) {
  const ch = charOf(cell?.config?.charId);
  const got = pickLine(ch);
  const at = got ? new Date(got.m.createdAt) : null;
  return html`
    <div class="wg ins-quote" onClick=${got ? go(() => openApp('chat', `/chat/${got.chat.id}`)) : null}>
      <span class="ins-quote-mark">“</span>
      <div class="ins-quote-text">${got ? got.m.content : '和角色聊过之后，这里每天摘一句它说过的话'}</div>
      ${got ? html`<div class="ins-quote-by">— ${ch.name} · ${MONTH[at.getMonth()]} ${at.getDate()}</div>` : null}
    </div>`;
}
registerWidget({
  id: 'ins-quote', label: '一句', group: GROUP, desc: '每天从聊天记录里摘一句角色说过的话',
  sizes: [[4, 2], [2, 2]], editable: true, defaults: { charId: '' }, fields: [CHAR_FIELD],
  render(cell) { return html`<${QuoteBody} cell=${cell}/>`; },
});

// ---- 在一起的天数 ----
function DaysBody({ cell }) {
  const c = cell?.config || {};
  const ch = charOf(c.charId);
  const me = accounts.current();
  const chat = ch ? chatWith(ch.id) : null;
  const start = c.since ? new Date(`${c.since}T00:00:00`).getTime() : chat?.createdAt || null;
  const n = start ? Math.floor((Date.now() - start) / 86400000) + 1 : 0;
  const zh = c.lang === 'zh';
  return html`
    <div class="wg ins-days" onClick=${ch ? go(() => openApp('chat', `/profile/${ch.id}`)) : null}>
      <div class="ins-days-faces">
        <${Round} id=${me?.avatar} name=${me?.name} size=${30}/>
        <${Round} id=${ch?.avatar} name=${ch?.name} size=${30}/>
      </div>
      <div class="ins-days-n">${n || '—'}</div>
      <div class="ins-days-sub">${zh ? `在一起的第 ${n} 天` : `days together`}</div>
      ${start ? html`<div class="ins-days-since">${zh ? '始于' : 'since'} ${dot(start)}</div>` : null}
    </div>`;
}
registerWidget({
  id: 'ins-days', label: '在一起', group: GROUP, desc: '两个头像与在一起的天数',
  sizes: [[2, 2], [4, 2]], editable: true, defaults: { charId: '', since: '', lang: 'en' },
  fields: [
    CHAR_FIELD,
    { key: 'since', type: 'date', label: '从哪天算起', desc: '留空则从这段对话开始的那天算起' },
    { key: 'lang', type: 'segmented', label: '文字',
      items: [{ value: 'en', label: 'English' }, { value: 'zh', label: '中文' }] },
  ],
  render(cell) { return html`<${DaysBody} cell=${cell}/>`; },
});

// ---- 天气：角色那座城市今天的天气 ----
//
// 读的是当日日程里存下的那一份（排日程时查的，见 tasks/day.js），
// 这里不发请求 —— 主屏每次重画都去查一遍天气，额度一会儿就没了
function WeatherBody({ cell }) {
  const ch = charOf(cell?.config?.charId);
  const w = ch ? day.today(ch.id)?.weather : null;
  const flat = (cell?.h || 2) === 1;
  if (!w) {
    return html`
      <div class="wg ins-weather">
        <div class="wg-empty">${!weather.ready() ? '在「设置 - 和风天气」中配置后显示'
          : !ch?.region ? '在角色卡中填写「所在地区」后显示' : '角色今天的日程安排后显示'}</div>
      </div>`;
  }
  const text = w.textNight && w.textNight !== w.textDay ? `${w.textDay} / ${w.textNight}` : w.textDay;
  return html`
    <div class=${`wg ins-weather${flat ? ' is-flat' : ''}`} onClick=${go(() => openApp('daily', `/today/${ch.id}`))}>
      <div class="ins-weather-t">${w.tempMin}°<i>/</i>${w.tempMax}°</div>
      <div class="ins-weather-meta">
        <div class="ins-weather-city ellipsis">${w.city}${flat ? '' : html`<span> · ${ch.name}</span>`}</div>
        <div class="ins-weather-x ellipsis">${flat ? w.textDay : text}</div>
      </div>
    </div>`;
}
registerWidget({
  id: 'ins-weather', label: '天气', group: GROUP, desc: '角色所在城市今天的天气',
  sizes: [[2, 2], [2, 1]], editable: true, defaults: { charId: '' }, fields: [CHAR_FIELD],
  render(cell) { return html`<${WeatherBody} cell=${cell}/>`; },
});

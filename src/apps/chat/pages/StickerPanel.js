import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Icon, Button, EmptyState } from '../../../ui/index.js';
import { StickerImg } from './StickerBits.js';

const { db, nav, stickers: api } = phone;

export function StickerPanel({ onSend }) {
  useStore(db.stickers.store);
  const groups = api.groups();
  const [group, setGroup] = useState(groups[0] || api.DEFAULT_GROUP);
  const list = api.inGroup(groups.includes(group) ? group : (groups[0] || group));

  if (!db.stickers.count()) {
    return html`
      <${EmptyState} icon="heart" title="暂无表情包"
        desc="可批量选择图片导入，也可从 txt 或 docx 中成批读取「名称与链接」。"
        action=${html`<${Button} size="sm" icon="upload"
          onClick=${() => nav.push('/stickers')}>去导入<//>`}/>`;
  }

  return html`
    <div class="stk-panel">
      <div class="stk-tabs">
        ${groups.map(g => html`
          <button key=${g} class=${`chip${g === group ? ' is-active' : ''}`}
            onClick=${() => setGroup(g)}>${g}</button>`)}
        <button class="chip" onClick=${() => nav.push('/stickers')}>
          <${Icon} name="settings" size=${13}/>
        </button>
      </div>
      <div class="stk-grid scroll">
        ${list.map(s => html`
          <button key=${s.id} class="stk-cell press" onClick=${() => onSend(s)} title=${s.name}>
            <${StickerImg} sticker=${s}/>
          </button>`)}
      </div>
    </div>`;
}

// 输入时按关键词推荐，横向一条
export function StickerSuggest({ text, onSend }) {
  useStore(db.stickers.store);
  const list = api.suggest(text);
  if (!list.length) return null;
  return html`
    <div class="stk-suggest scroll">
      ${list.map(s => html`
        <button key=${s.id} class="stk-sug press" onClick=${() => onSend(s)} title=${s.name}>
          <${StickerImg} sticker=${s} size=${44}/>
        </button>`)}
    </div>`;
}

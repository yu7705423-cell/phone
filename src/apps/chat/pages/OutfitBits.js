import { html } from '../../../lib.js';
import { phone, useStore, useThumb } from '../../../sdk/index.js';
import { Icon } from '../../../ui/index.js';

const { db, closet, intent } = phone;

// 搭配卡片（ARCHITECTURE 4.214）。角色从你的衣帽间里挑几件搭成一套，
// 或者你在角色的衣帽间里替它挑好一套发过来。认得出的单品带缩略图，认不出的只留名字、画成灰的

function Piece({ it }) {
  const row = it.id ? db.closet.get(it.id) : null;
  const url = useThumb(row?.imageId);
  const c = row ? closet.kinds.COLORS.find(x => x.id === (row.colors || [])[0]) : null;
  return html`
    <div class=${`fit-piece${row ? '' : ' is-miss'}`}>
      ${url ? html`<i class="fit-img" style=${`--img:url(${url})`}></i>`
        : html`<i class="fit-img is-blank" style=${c ? `--sw:${c.sw}` : ''}>
            ${c ? null : html`<${Icon} name="hanger" size=${14}/>`}</i>`}
      <span class="ellipsis">${it.name}</span>
    </div>`;
}

export function OutfitBubble({ msg, mine }) {
  useStore(db.closet.store);
  const items = msg.outfitItems || [];
  const hits = items.filter(x => x.id && db.closet.get(x.id)).length;
  const saved = closet.outfitOfMsg(msg.id);
  const miss = items.length - hits;
  return html`
    <div class=${`bubble bubble-outfit ph-outfit${mine ? ' is-mine' : ''}`}>
      <div class="tr-top">
        <${Icon} name="hanger" size=${20}/>
        <div class="tr-body">
          <div class="fit-tag">${mine ? '为对方搭配了一套' : '为你搭配了一套'}</div>
          <div class="fit-name ellipsis">${msg.outfitName || '一套搭配'}</div>
        </div>
      </div>
      <div class="fit-pieces">${items.map((it, i) => html`<${Piece} key=${i} it=${it}/>`)}</div>
      <div class="tr-foot">
        ${miss > 0 ? `${miss} 件不在衣帽间中` : `共 ${items.length} 件`}
        ${!mine && hits ? html`
          <button class="gift-closet press" onClick=${e => {
            e.stopPropagation();
            intent.open('closet', { route: `/fit/${msg.id}`, back: true });
          }}>${saved ? '在衣帽间中查看' : '存为套装'}</button>` : null}
      </div>
    </div>`;
}

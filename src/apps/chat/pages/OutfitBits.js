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
  // 穿搭盲盒里角色挑的那一套：揭晓之前只露一句（ARCHITECTURE 4.216）
  if (msg.sealed) {
    return html`
      <div class=${`bubble bubble-outfit ph-outfit is-sealed${mine ? ' is-mine' : ''}`}>
        <div class="tr-top">
          <${Icon} name="gift" size=${20}/>
          <div class="tr-body">
            <div class="fit-tag">穿搭盲盒</div>
            <div class="fit-name">已为你挑好一套</div>
          </div>
        </div>
        <div class="tr-foot">在主题卡片上点「揭晓」后公开</div>
      </div>`;
  }
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

/** 动作卡片：在会话里用了衣帽间里的一件东西（帮对方喷上香水之类） */
export function GroomBubble({ msg, mine }) {
  useStore(db.closet.store);
  const row = msg.itemId ? db.closet.get(msg.itemId) : null;
  return html`
    <div class=${`bubble bubble-outfit ph-groom${mine ? ' is-mine' : ''}`}>
      <div class="tr-top">
        <${Piece} it=${{ id: row ? row.id : '', name: '' }}/>
        <div class="tr-body">
          <div class="fit-tag">${msg.action || ''}</div>
          <div class="fit-name ellipsis">${msg.itemName || row?.name || ''}</div>
        </div>
      </div>
    </div>`;
}

/** 穿搭盲盒的主题卡片。揭晓之前我挑的那一套也不显示，免得自己先剧透给自己看 */
export function DresscodeBubble({ msg, mine }) {
  useStore(db.messages.store);
  const items = msg.outfitItems || [];
  const reveal = e => {
    e.stopPropagation();
    closet.revealDresscode(msg.id);
  };
  return html`
    <div class=${`bubble bubble-outfit ph-dresscode${mine ? ' is-mine' : ''}${msg.revealed ? ' is-done' : ''}`}>
      <div class="tr-top">
        <${Icon} name="gift" size=${20}/>
        <div class="tr-body">
          <div class="fit-tag">穿搭盲盒 · 主题</div>
          <div class="fit-name ellipsis">${msg.theme}</div>
        </div>
      </div>
      ${msg.revealed ? html`
        <div class="fit-sub">我为对方挑的：${msg.outfitName || ''}</div>
        <div class="fit-pieces">${items.map((it, i) => html`<${Piece} key=${i} it=${it}/>`)}</div>` : null}
      <div class="tr-foot">
        ${msg.revealed ? '已揭晓' : `为对方挑好了 ${items.length} 件，揭晓前双方都不公开`}
        ${msg.revealed ? null : html`<button class="gift-closet press" onClick=${reveal}>揭晓</button>`}
      </div>
    </div>`;
}

/**
 * 角色在线下偷偷塞进我包里的东西（ARCHITECTURE 4.217）。收场后才落到会话里，
 * 点开之前只写「包里多了一样东西」；点开落一行我发现了什么，角色下一轮读到
 */
export function SlipBubble({ msg }) {
  useStore(db.closet.store);
  const kept = db.closet.all().find(r => r.giftMsgId === msg.id);
  const open = e => { e.stopPropagation(); phone.closetStory.openSlip(msg.id); };
  const keep = e => {
    e.stopPropagation();
    const r = kept || phone.closetStory.keepSlip(msg.id);
    if (r) intent.open('closet', { route: `/item/${r.id}`, back: true });
  };
  return html`
    <div class=${`bubble bubble-outfit ph-slip${msg.slipOpened ? ' is-done' : ''}`}
      onClick=${msg.slipOpened ? null : open}>
      <div class="tr-top">
        <${Icon} name="bag" size=${20}/>
        <div class="tr-body">
          <div class="fit-tag">${msg.slipOpened ? '包里多出来的' : '回到家，包里多了一样东西'}</div>
          <div class="fit-name">${msg.slipOpened ? msg.slipWhat : '点开看看'}</div>
        </div>
      </div>
      ${msg.slipOpened ? html`
        <div class="tr-foot">
          <button class="gift-closet press" onClick=${keep}>${kept ? '在衣帽间中查看' : '收进衣帽间'}</button>
        </div>` : null}
    </div>`;
}

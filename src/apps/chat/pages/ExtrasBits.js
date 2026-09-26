import { html, useState } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Icon, Sheet, List, ListItem } from '../../../ui/index.js';

const { db, extras } = phone;

// 骰子气泡。点数是本地掷的，落库时就定了 —— 这里只是把它显示出来。
export function DiceBubble({ msg }) {
  return html`
    <div class="bubble bubble-dice">
      <span class="dice-num">${msg.value}</span>
      <span class="dice-face">${msg.faces === 6 ? '骰子' : `${msg.faces} 面骰`}</span>
    </div>`;
}

// 心声。默认藏着，点角色头像才展开。
// 两种样式：贴在气泡下面的一行淡字，或者单独一张卡片。
export function InnerVoice({ text, style }) {
  if (!text) return null;
  return html`<div class=${`inner-voice inner-${style}`}>${text}</div>`;
}

// 掷骰子之前先选几面。会话里设好的那个是默认值，这里可以临时换一个。
export function DiceSheet({ open, chatId, onClose }) {
  const chat = chatId ? phone.db.chats.get(chatId) : null;
  const cur = extras.facesOf(chat);
  const send = n => { extras.roll({ chatId, role: 'user', faces: n }); onClose(); };
  return html`
    <${Sheet} open=${open} onClose=${onClose} title="掷骰子">
      <${List} inset=${false}>
        ${extras.FACES.map(n => html`
          <${ListItem} key=${n} title=${`${n} 面`} arrow
            subtitle=${n === cur ? '这段对话的默认值' : ''}
            left=${html`<${Icon} name="grid" size=${18}/>`}
            onClick=${() => send(n)}/>`)}
      <//>
      <div class="settings-foot">
        点数由本地随机数掷出，不经过模型。角色要到下一轮才看得到结果。
      </div>
    <//>`;
}


const stampOf = ts => {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * 心声那张卡（「显示成什么样」选「打开一页」时，ARCHITECTURE 4.274）。
 *
 * 一张独立的小卡片，像明信片：正中一张纸，上面是谁、什么时候；中间是那一句心声；
 * 底下写着第几张。左右两头点一下翻到上一张、下一张，这段会话里以前的每一条都能翻到。
 * 点纸外面收起。不做拟物：一张纸色的卡、一条细线、一枚小头像，没有邮票和邮戳。
 */
export function InnerSheet({ chatId, msgId, char, onClose }) {
  useStore(db.messages.store);
  const all = extras.innerHistory(chatId);
  const start = Math.max(0, all.findIndex(m => m.id === msgId));
  const [i, setI] = useState(start);
  // 点卡上的头像：把以前的每一条列出来，点一条翻过去
  const [listing, setListing] = useState(false);
  const avatar = useImage(char?.avatar);
  const name = phone.remark.nameOf(char) || char?.name || '角色';
  const cur = all[i] || null;
  const go = d => setI(x => Math.min(all.length - 1, Math.max(0, x + d)));
  return html`
    <div class="inner-layer" onClick=${onClose}>
      <div class=${`inner-postcard${listing ? ' is-listing' : ''}`} onClick=${e => e.stopPropagation()}>
        <button class="inner-postcard-head press" onClick=${() => setListing(v => !v)} aria-label="历史心声">
          ${avatar ? html`<img class="inner-postcard-face" src=${avatar} alt=""/>`
            : html`<span class="inner-postcard-face inner-postcard-face-fallback">${name.slice(0, 1)}</span>`}
          <span class="inner-postcard-name">${name}</span>
          <span class="inner-postcard-stamp">${listing ? `共 ${all.length} 条` : (cur ? stampOf(cur.createdAt) : '')}</span>
        </button>
        ${listing ? html`
          <div class="inner-postcard-list">
            ${all.map((m, k) => html`
              <button key=${m.id} class=${`inner-postcard-item press${k === i ? ' is-cur' : ''}`}
                onClick=${() => { setI(k); setListing(false); }}>
                <span class="inner-postcard-item-stamp">${stampOf(m.createdAt)}</span>
                <span class="inner-postcard-item-text">${m.inner}</span>
              </button>`)}
            ${all.length ? null : html`<div class="inner-postcard-empty">这段会话里还没有心声</div>`}
          </div>` : html`
        <div class="inner-postcard-body">
          ${cur ? html`
            <div class="inner-postcard-text">${cur.inner}</div>
            <div class="inner-postcard-said">${String(cur.content || '').slice(0, 60)}</div>`
          : html`<div class="inner-postcard-empty">这段会话里还没有心声</div>`}
        </div>`}
        <div class="inner-postcard-foot">
          <button class="inner-postcard-nav press" disabled=${i >= all.length - 1} onClick=${() => go(1)}
            aria-label="上一张"><${Icon} name="chevronLeft" size=${16}/></button>
          <span class="inner-postcard-count">${all.length ? `${all.length - i} / ${all.length}` : ''}</span>
          <button class="inner-postcard-nav press" disabled=${i <= 0} onClick=${() => go(-1)}
            aria-label="下一张"><${Icon} name="chevronRight" size=${16}/></button>
        </div>
      </div>
    </div>`;
}

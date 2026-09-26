import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
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
 * 心声那一页（「显示成什么样」选「打开一页」时，ARCHITECTURE 4.274）。
 * 上面是点开的这一轮，下面是这段会话里以前的每一条，新的在前。
 */
export function InnerSheet({ chatId, msgId, char, onClose }) {
  useStore(db.messages.store);
  const [showAll, setShowAll] = useState(false);
  const cur = msgId ? db.messages.get(msgId) : null;
  const all = extras.innerHistory(chatId).filter(m => m.id !== msgId);
  const list = showAll ? all : all.slice(0, 20);
  const name = phone.remark.nameOf(char) || char?.name || '角色';
  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${`${name}的心声`} height="84%">
      <div class="pad">
        ${cur ? html`
          <div class="inner-page-now">
            <div class="inner-page-stamp">${stampOf(cur.createdAt)} · 这一轮</div>
            <div class="inner-page-said">${String(cur.content || '').slice(0, 80)}</div>
            <div class="inner-page-text">${cur.inner}</div>
          </div>` : html`<div class="field-desc">这一轮没有心声。</div>`}
      </div>
      ${all.length ? html`
        <${List} title=${`以前的 · ${all.length}`}>
          ${list.map(m => html`
            <${ListItem} key=${m.id} multiline title=${m.inner}
              subtitle=${`${stampOf(m.createdAt)} · ${String(m.content || '').slice(0, 40)}`}/>`)}
          ${all.length > list.length ? html`
            <${ListItem} title=${`还有 ${all.length - list.length} 条`} onClick=${() => setShowAll(true)}/>` : null}
        <//>` : html`<div class="pad-x settings-foot">这段会话里还没有别的心声。</div>`}
    <//>`;
}

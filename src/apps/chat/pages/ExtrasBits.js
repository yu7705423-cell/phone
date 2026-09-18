import { html } from '../../../lib.js';
import { phone } from '../../../sdk/index.js';
import { Icon, Sheet, List, ListItem } from '../../../ui/index.js';

const { extras } = phone;

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

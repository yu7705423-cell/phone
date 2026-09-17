import { html } from '../../../lib.js';
import { phone } from '../../../sdk/index.js';
import { Sheet, Icon, List, ListItem } from '../../../ui/index.js';

const { space } = phone;

// 约定与信在对话里各占一个气泡。
//
// 两样都是消息（kind 为 pact / letter），所以它们天然在上下文里、
// 天然跟着会话一起删。情侣空间那一侧只是同一批消息的另一种看法。

export function PactBubble({ msg, onFinish }) {
  const done = msg.pact === space.PACT_DONE;
  // 只有对方提出的那一条能由自己点完成 —— 自己提的自己说了不算。
  const actionable = !done && onFinish;
  return html`
    <div class=${`bubble bubble-pact${done ? ' is-done' : ''}`}
      onClick=${actionable ? () => onFinish(msg) : null}>
      <div class="tr-top">
        <${Icon} name=${done ? 'check' : 'bookmark'} size=${19}/>
        <div class="tr-body">
          <div class="pact-title">${msg.title}</div>
        </div>
      </div>
      <div class="tr-foot">
        ${done ? '约定已完成' : `约定${actionable ? ' · 点击标记完成' : ''}`}
      </div>
    </div>`;
}

export function LetterBubble({ msg, onOpen }) {
  return html`
    <div class="bubble bubble-letter" onClick=${onOpen ? () => onOpen(msg) : null}>
      <div class="tr-top">
        <${Icon} name="mail" size=${19}/>
        <div class="tr-body">
          <div class="letter-title ellipsis">${msg.title || '一封信'}</div>
        </div>
      </div>
      <div class="tr-foot">点击展开</div>
    </div>`;
}

// 读信。信可能很长，铺在气泡里会把整屏挤满，所以收在一张卡片后面。
export function LetterSheet({ msg, onClose }) {
  return html`
    <${Sheet} open=${!!msg} onClose=${onClose} title=${msg?.title || '信'}>
      <div class="pad">
        <div class="sp-letter">${msg?.body || ''}</div>
      </div>
    <//>`;
}

// 标记完成。落一行提示进对话，删掉那一行约定就回到未完成。
export function PactSheet({ msg, onClose }) {
  if (!msg) return null;
  return html`
    <${Sheet} open=${!!msg} onClose=${onClose} title=${msg.title}>
      <${List} inset=${false}>
        <${ListItem} title="标记为已完成" arrow
          left=${html`<${Icon} name="check" size=${18}/>`}
          onClick=${() => { space.completePact(msg.id); onClose(); }}/>
      <//>
      <div class="settings-foot">
        完成后对话中会留下一行提示，角色即可知道这件事做到了。删除该提示将使约定回到未完成。
      </div>
    <//>`;
}

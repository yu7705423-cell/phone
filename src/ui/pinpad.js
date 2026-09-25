import { html, useState } from '../lib.js';
import { Icon } from '../icons/Icon.js';

// 数字密码键盘：一排圆点、一行说明、十二个键。本机锁屏与「设置 - 外观 - 锁屏密码」共用。
//
// 输满 length 位就交给 onDone，不另设「确定」键。onDone 可以是异步的；交出去之后圆点清空，
// 对不对由调用方用 note / wrong 说。disabled 时键盘不接（输错太多次、正在等）。

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

export function PinPad({ length = 4, onDone, note = '', wrong = false, disabled = false }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const tap = async k => {
    if (disabled || busy) return;
    if (k === 'del') { setCode(code.slice(0, -1)); return; }
    const next = (code + k).slice(0, length);
    setCode(next);
    if (next.length < length) return;
    setBusy(true);
    try { await onDone?.(next); } finally { setCode(''); setBusy(false); }
  };
  return html`
    <div class="pinpad">
      <div class=${`pinpad-dots${wrong ? ' is-wrong' : ''}`}>
        ${Array.from({ length }, (_, i) => html`<i key=${i} class=${i < code.length ? 'is-on' : ''}></i>`)}
      </div>
      <div class=${`pinpad-note${wrong ? ' is-wrong' : ''}`}>${note}</div>
      <div class="pinpad-keys">
        ${KEYS.map((k, i) => (k === '' ? html`<span key=${i}></span>` : html`
          <button key=${i} type="button" class="pinpad-key press" disabled=${disabled}
            aria-label=${k === 'del' ? '删除' : k} onClick=${() => tap(k)}>
            ${k === 'del' ? html`<${Icon} name="chevronLeft" size=${20}/>` : k}
          </button>`))}
      </div>
    </div>`;
}

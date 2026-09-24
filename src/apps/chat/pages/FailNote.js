import { html } from '../../../lib.js';
import { phone } from '../../../sdk/index.js';
import { Icon } from '../../../ui/index.js';

const svc = phone.ai.services;

// 回复失败那一条。写明报错原文，给「重试」；失败的那一套接口填了站点或充值链接的，
// 再给一个能直接点开的链接 —— 余额不足时是「去充值」，别的错误是「打开站点」。
// 充值完回到这里点「重试」即可，不必退出去找站点。
//
// 链接在「设置 - 接口」里各套自己的编辑页填，这里只读。
// 余额不足却没填链接时，写明去哪儿填：这正是用户想起要填它的时候。
export function FailNote({ msg, onRetry }) {
  const seen = new Set();
  const rows = (msg.failedPresets || []).filter(f => f?.id && !seen.has(f.id) && seen.add(f.id))
    .map(f => ({ ...f, link: svc.presetLinks(f.id) }))
    .filter(f => f.link);
  const broke = rows.some(f => f.balance);
  const links = rows.filter(f => (f.balance ? f.link.topup : f.link.site));
  const many = links.length > 1;

  return html`
    <div class="fail-note">
      ${msg.error ? html`<div class="fail-text">${broke ? '余额不足。' : ''}${msg.error}</div>` : null}
      <div class="fail-acts">
        <button class="msg-retry press" onClick=${() => onRetry(msg)}>
          <${Icon} name="refresh" size=${13}/> 重试
        </button>
        ${links.map(f => html`
          <a key=${f.id} class="msg-retry press" target="_blank" rel="noopener noreferrer"
            href=${f.balance ? f.link.topup : f.link.site}>
            <${Icon} name=${f.balance ? 'wallet' : 'link'} size=${13}/>
            ${f.balance ? '去充值' : '打开站点'}${many ? `（${f.link.name}）` : ''}
          </a>`)}
      </div>
      ${broke && !links.length ? html`
        <div class="fail-hint">可在「设置 - 接口」中为这一套接口填写充值链接，此后在这里直接打开。</div>` : null}
    </div>`;
}

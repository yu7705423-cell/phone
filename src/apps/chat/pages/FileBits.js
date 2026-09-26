import { html, useState } from '../../../lib.js';
import { phone, useFile, useStore } from '../../../sdk/index.js';
import { Icon, Spinner, Sheet, Button, List, ListItem, Switch, toast } from '../../../ui/index.js';

const { db, docfile, ai } = phone;

// 聊天里的文件（ARCHITECTURE 4.271）：一张卡，点开看正文、另存、让角色填写

export function FileBubble({ msg, onOpen }) {
  const pending = msg.media === 'pending' && !msg.fileId;
  const failed = msg.media === 'error';
  return html`
    <button class=${`file-card ph-file press${failed ? ' is-failed' : ''}`} onClick=${() => onOpen?.(msg)}>
      <span class="file-card-icon">${pending ? html`<${Spinner} size=${16}/>` : html`<${Icon} name="folder" size=${20}/>`}</span>
      <span class="file-card-body">
        <span class="file-card-name">${msg.name || '文件'}</span>
        <span class="file-card-meta">${failed ? (msg.mediaError || '生成失败')
          : pending ? '生成中' : `${String(msg.ext || '').toUpperCase()} · ${docfile.sizeText(msg.size)}`}</span>
      </span>
    </button>`;
}

function saveBlobUrl(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name || '文件';
  document.body.appendChild(a); a.click(); a.remove();
}

export function FileSheet({ msg, chatId, onClose }) {
  useStore(db.characters.store);
  const url = useFile(msg?.fileId);
  const [busy, setBusy] = useState(false);
  if (!msg) return null;
  const canFill = msg.role === 'user' && docfile.fillable(msg.ext) && !!msg.fileId;
  const chat = db.chats.get(chatId);
  const char = chat ? db.characters.get((chat.characterIds || [])[0]) : null;
  const capOn = !!char && char.canSendFile === true;
  const askFill = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ai.docfill.fill(chatId, msg.id);
      toast('已交给角色填写', 'ok');
      onClose();
    } catch (e) { toast(String(e.message || e), 'error'); } finally { setBusy(false); }
  };
  return html`
    <${Sheet} open=${!!msg} onClose=${onClose} title=${msg.name || '文件'} height="84%">
      <div class="pad">
        <div class="file-actions">
          ${url ? html`<${Button} size="sm" onClick=${() => saveBlobUrl(url, msg.name)}>另存<//>` : null}
          ${canFill ? html`<${Button} size="sm" variant="ghost" disabled=${busy} onClick=${askFill}>${busy ? '填写中' : '让角色填写'}<//>` : null}
        </div>
        ${canFill ? html`<div class="field-desc">「让角色填写」单独调用一次接口，把整篇交给角色，填好后以新文件发回，原文件不变。平时角色也可以在回复里直接填。</div>` : null}
        ${canFill && char && !capOn ? html`
          <${List}>
            <${ListItem} title="角色卡未开启「发文件」" multiline
              subtitle="关着时角色在回复里不会填写文件，只会把内容当消息发出。开启后角色可以在回复里直接填好发回；「让角色填写」按钮不受此限"
              right=${html`<${Switch} checked=${false} onChange=${() => { db.characters.update(char.id, { canSendFile: true }); toast('已开启', 'ok'); }}/>`}/>
          <//>` : null}
        <pre class="file-preview">${msg.text || '(没有可显示的正文)'}</pre>
      </div>
    <//>`;
}

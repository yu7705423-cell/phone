import { html, useState } from '../../../lib.js';
import { phone } from '../../../sdk/index.js';
import { Sheet, List, ListItem, Field, Textarea, Input, Button, Avatar,
         toast } from '../../../ui/index.js';

const { db, excerpt } = phone;

// 书摘小卡片。摘一小段，写一句自己的话，发到某个角色的会话里。
// 只是一条消息，不调接口 —— 角色接不接话由那段对话自己的节奏决定。
export function ExcerptSheet({ open, bookId, at = 0, onClose }) {
  const [quote, setQuote] = useState('');
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);

  const left = excerpt.MAX_QUOTE - quote.length;
  const row = bookId ? db.ebooks.get(bookId) : null;

  const send = chatId => {
    try {
      excerpt.send({ chatId, bookId, quote, note, at });
      const c = db.chats.get(chatId);
      const ch = db.characters.get((c.characterIds || [])[0]);
      toast(`已发给 ${ch?.name || '对方'}`, 'ok');
      setQuote(''); setNote(''); setPicking(false); onClose();
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
  };

  if (!open) return null;

  if (picking) {
    const list = excerpt.targets();
    return html`
      <${Sheet} open=${true} onClose=${() => setPicking(false)} title="发给谁" height="70%">
        <${List} inset=${false}>
          ${list.map(c => {
            const ch = db.characters.get(c.characterIds[0]);
            return ch ? html`
              <${ListItem} key=${c.id} title=${ch.name} arrow
                subtitle=${ch.signature || ''}
                left=${html`<${Avatar} src=${ch.avatar} name=${ch.name} size=${34}/>`}
                onClick=${() => send(c.id)}/>` : null;
          })}
          ${list.length ? null : html`<${ListItem} title="还没有一对一的会话" multiline
            subtitle="先在「聊天」里和一个角色说上话，再回来发书摘"/>`}
        <//>
      <//>`;
  }

  return html`
    <${Sheet} open=${true} onClose=${onClose} title="书摘" height="80%">
      <div class="pad-x">
        <div class="hint-box">
          摘自《${row?.title || '这本书'}》${row?.author ? ` · ${row.author}` : ''}。
          卡片只放一小段，发出去之后是会话里的一条消息。
        </div>
        <${Field} label="摘录" desc=${`还可以写 ${left} 字。`}>
          <${Textarea} rows=${6} value=${quote}
            onInput=${v => setQuote(v.slice(0, excerpt.MAX_QUOTE))}
            placeholder="写下想摘的那一段"/>
        <//>
        <${Field} label="想说的话" desc="可留空。写了会一并出现在卡片下方。">
          <${Input} value=${note} placeholder="可留空"
            onInput=${v => setNote(v.slice(0, excerpt.MAX_NOTE))}/>
        <//>
        <div class="pad-b">
          <${Button} full disabled=${!quote.trim()}
            onClick=${() => setPicking(true)}>选择角色并发送<//>
        </div>
      </div>
    <//>`;
}

import { html, useState, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, FullSheet, Sheet, Button, Field, Input, Textarea,
         Icon, IconButton, EmptyState, toast, confirm } from '../../ui/index.js';

import { ymdhm as when } from './fmt.js';

const { db, nav, space } = phone;


const BLANK = { id: '', title: '', body: '' };

// 写信。
//
// 「留在信箱」和「寄出」是两件事：留着的信只有自己看得见，不进上下文，
// 对方不知道有这么一封；寄出之后它变成这段对话里的一条消息，角色才读得到。
function Composer({ open, chatId, draft, onClose }) {
  const [cur, setCur] = useState(BLANK);
  useEffect(() => { if (open) setCur(draft ? { ...BLANK, ...draft } : BLANK); }, [open, draft]);
  const set = patch => setCur(c => ({ ...c, ...patch }));

  const keep = () => {
    try {
      space.saveDraft({ chatId, id: cur.id, title: cur.title, body: cur.body });
      toast('已留在信箱');
      onClose();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const send = () => {
    try {
      space.sendLetter({ chatId, role: 'user', authorId: 'me', title: cur.title, body: cur.body });
      if (cur.id) space.removeDraft(cur.id);
      toast('已寄出', 'ok');
      onClose();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  return html`
    <${FullSheet} open=${open} onClose=${onClose} title="写信">
      <div class="pad">
        <${Field} label="信封上写什么" desc="可以不写。">
          <${Input} value=${cur.title} onInput=${v => set({ title: v })} placeholder="给你"/>
        <//>
        <${Field} label="正文">
          <${Textarea} rows=${10} value=${cur.body} onInput=${v => set({ body: v })}
            placeholder="写点什么"/>
        <//>
        <div class="btn-row">
          <${Button} full variant="ghost" onClick=${keep}>留在信箱<//>
          <${Button} full onClick=${send}>寄出<//>
        </div>
        <div class="settings-foot">
          留在信箱的信只有自己看得见，不会进入对话，角色不知道它存在。
          寄出后信会成为这段对话中的一条消息，角色即可读到。
        </div>
      </div>
    <//>`;
}

function Reader({ letter, onClose, charName, meName }) {
  return html`
    <${Sheet} open=${!!letter} onClose=${onClose} title=${letter?.title || '信'}>
      <div class="pad">
        <div class="sp-letter">${letter?.body || ''}</div>
        <div class="settings-foot">
          ${letter ? `${letter.role === 'user' ? meName : charName} · ${when(letter.createdAt)}` : ''}
        </div>
      </div>
    <//>`;
}

export function MailPage({ chatId }) {
  useStore(db.messages.store);
  useStore(db.spaceItems.store);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState(null);
  const [reading, setReading] = useState(null);

  const sp = space.spaceOf(chatId);
  const sent = space.letters(chatId).slice().reverse();
  const kept = space.drafts(chatId).slice().reverse();
  const meName = sp?.persona?.name || '我';
  const charName = sp?.char?.name || '角色';

  const compose = d => { setDraft(d || null); setWriting(true); };
  const close = () => { setWriting(false); setDraft(null); };

  const post = async d => {
    if (!await confirm({ title: '寄出这封信', message: '寄出后角色即可读到这封信的内容。' })) return;
    space.sendDraft(d.id);
    toast('已寄出', 'ok');
  };

  const drop = async d => {
    if (!await confirm({ title: '删除这封信', message: '这封信将被删除。', danger: true })) return;
    space.removeDraft(d.id);
  };

  const preview = t => String(t || '').replace(/\s+/g, ' ').slice(0, 24);

  return html`
    <${Page} title="信箱" onBack=${nav.pop}
      right=${html`<${IconButton} name="edit" label="写信" onClick=${() => compose(null)}/>`}>

      ${kept.length ? html`
        <${List} title=${`还没寄出 ${kept.length}`}>
          ${kept.map(d => html`
            <${ListItem} key=${d.id} title=${d.title || '没有抬头'} multiline
              subtitle=${preview(d.body)}
              left=${html`<${Icon} name="bookmark" size=${18}/>`}
              right=${html`
                <button class="nav-text press" onClick=${e => { e.stopPropagation(); post(d); }}>寄出</button>
                <${IconButton} name="trash" size=${17} label="删除"
                  onClick=${e => { e.stopPropagation(); drop(d); }}/>`}
              onClick=${() => compose(d)}/>`)}
        <//>` : null}

      ${sent.length ? html`
        <${List} title=${`已寄出 ${sent.length}`}>
          ${sent.map(m => html`
            <${ListItem} key=${m.id} title=${m.title || '没有抬头'} multiline
              subtitle=${`${m.role === 'user' ? meName : charName} · ${when(m.createdAt)}`}
              left=${html`<${Icon} name="mail" size=${18}/>`}
              onClick=${() => setReading(m)}/>`)}
        <//>` : null}

      ${(kept.length || sent.length) ? html`
        <div class="settings-foot">
          已寄出的信同时是这段对话中的一条消息，删除该消息即从信箱中移除。
        </div>`
      : html`<${EmptyState} icon="mail" title="信箱是空的"
          desc="有些话适合写下来。留在信箱的信只有自己看得见，寄出后角色才读得到。"
          action=${html`<${Button} size="sm" onClick=${() => compose(null)}>写一封<//>`}/>`}

      <${Composer} open=${writing} chatId=${chatId} draft=${draft} onClose=${close}/>
      <${Reader} letter=${reading} charName=${charName} meName=${meName}
        onClose=${() => setReading(null)}/>
    <//>`;
}

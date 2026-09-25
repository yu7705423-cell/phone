import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Sheet, Button, Field, Input,
         Icon, IconButton, EmptyState, toast, confirm } from '../../ui/index.js';

import { ymd as when } from './fmt.js';

const { db, nav, space } = phone;


// 约定是一条消息（kind 为 pact），所以它天然在聊天记录里，也天然进上下文。
// 这一页只是同一批消息的另一种看法。
export function PactsPage({ chatId }) {
  useStore(db.messages.store);
  useStore(db.characters.store);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  const sp = space.spaceOf(chatId);
  const list = space.pacts(chatId).slice().reverse();
  const undone = list.filter(m => m.pact === space.PACT_OPEN);
  const done = list.filter(m => m.pact === space.PACT_DONE);

  const add = () => {
    try {
      space.makePact({ chatId, role: 'user', authorId: 'me', title });
      setTitle('');
      setOpen(false);
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const finish = async m => {
    if (!await confirm({ title: '标记为完成', message: `将「${m.title}」标记为已完成。` })) return;
    space.completePact(m.id);
  };

  const del = async m => {
    if (!await confirm({ title: '删除约定', message: `将删除「${m.title}」。`, danger: true })) return;
    space.removePact(m.id);
  };

  const who = m => (m.role === 'user'
    ? (sp?.persona?.name || '我')
    : (phone.remark.nameOf(sp?.char) || '角色'));

  return html`
    <${Page} title="约定" onBack=${nav.pop}
      right=${html`<${IconButton} name="plus" label="新增" onClick=${() => setOpen(true)}/>`}>

      ${list.length ? html`
        <${List} title=${`未完成 ${undone.length}`}>
          ${undone.length ? undone.map(m => html`
            <${ListItem} key=${m.id} title=${m.title} multiline
              subtitle=${`${who(m)}提出 · ${when(m.createdAt)}`}
              left=${html`<${Icon} name="bookmark" size=${18}/>`}
              right=${html`
                <button class="nav-text press" onClick=${() => finish(m)}>完成</button>`}/>`)
          : html`<${ListItem} title="没有未完成的约定"/>`}
        <//>

        ${done.length ? html`
          <${List} title=${`已完成 ${done.length}`}>
            ${done.map(m => html`
              <${ListItem} key=${m.id} title=${m.title} multiline
                subtitle=${`${who(m)}提出 · 完成于 ${when(m.doneAt)}`}
                left=${html`<${Icon} name="check" size=${18}/>`}
                right=${html`<${IconButton} name="trash" size=${17} label="删除"
                  onClick=${() => del(m)}/>`}/>`)}
          <//>` : null}

        <div class="settings-foot">
          约定同时是这段对话里的一条消息。角色写出「约定」一行时也会记在这里；
          完成之后，对话中会留下一行完成提示，删除该提示将使约定回到未完成。
        </div>`
      : html`<${EmptyState} icon="bookmark" title="还没有约定"
          desc="说定了以后要做的事可以记在这里。角色在对话中也可以提出约定。"
          action=${html`<${Button} size="sm" onClick=${() => setOpen(true)}>新增约定<//>`}/>`}

      <${Sheet} open=${open} onClose=${() => setOpen(false)} title="新增约定">
        <div class="pad">
          <${Field} label="约定内容" desc="写一件以后要一起做的事。约定会出现在对话中，完成前一直挂着。">
            <${Input} value=${title} onInput=${setTitle} placeholder="例如：下个月一起去看海"/>
          <//>
          <${Button} full onClick=${add}>记下<//>
        </div>
      <//>
    <//>`;
}

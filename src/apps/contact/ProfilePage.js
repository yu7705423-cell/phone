import { html } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Page, List, ListItem, Avatar, Button, Icon, IconButton,
         EmptyState } from '../../ui/index.js';

const { db, nav, ai } = phone;
const card = ai.card;

// 点开角色先看到的是「资料」，不是一屏输入框。
// 要改才点「编辑资料」。
export function ProfilePage({ id }) {
  useStore(db.characters.store);
  const char = db.characters.get(id);
  const avatar = useImage(char?.avatar);
  if (!char) {
    return html`<${Page} title="资料" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已被删除"/><//>`;
  }

  const rels = card.relationsOf(id);
  const alts = db.characters.where(x => x.parentId === id);
  const facts = [
    char.age && { k: '年龄', v: char.age },
    char.gender && { k: '性别', v: char.gender },
    char.birthday && { k: '生日', v: char.birthday },
  ].filter(Boolean);

  const parent = char.parentId ? db.characters.get(char.parentId) : null;

  return html`
    <${Page} title="" onBack=${nav.pop}
      right=${html`<${IconButton} name="message" label="去聊天"
        onClick=${() => phone.intent.open('chat', { route: '/' })}/>`}>
      <div class="pf-head">
        <div class="pf-avatar"><${Avatar} src=${avatar} name=${char.name} size=${92}/></div>
        <div class="pf-name">${char.name || '未命名'}</div>
        ${char.signature ? html`<div class="pf-sign">${char.signature}</div>` : null}
        ${facts.length ? html`
          <div class="pf-facts">
            ${facts.map(f => html`
              <div key=${f.k} class="pf-fact"><b>${f.v}</b><span>${f.k}</span></div>`)}
          </div>` : null}
      </div>

      <div class="pf-acts">
        <${Button} size="sm" variant="ghost" icon="edit"
          onClick=${() => nav.push(`/edit/${id}`)}>编辑资料<//>
        <${Button} size="sm" variant="ghost" icon="users"
          onClick=${() => nav.push(`/net/${id}`)}>关系网<//>
      </div>

      ${char.persona || char.scenario ? html`
        <div class="pf-body">
          ${char.persona ? html`
            <div class="pf-block"><h4>人设</h4><p>${char.persona}</p></div>` : null}
          ${char.scenario ? html`
            <div class="pf-block"><h4>情境</h4><p>${char.scenario}</p></div>` : null}
        </div>` : html`
        <div class="settings-foot">还没写人设。点「编辑资料」补上，或者导入一份 txt / docx。</div>`}

      <${List} title=${`关系 · ${rels.length}`}>
        ${rels.map(r => {
          const other = db.characters.get(r.charId);
          return html`
            <${ListItem} key=${r.charId} title=${other?.name || '已删除'}
              subtitle=${r.label} arrow multiline
              left=${html`<${Icon} name="user" size=${18}/>`}
              onClick=${() => nav.push(`/profile/${r.charId}`)}/>`;
        })}
        <${ListItem} title="关联角色" subtitle="手动挑一个，或者让模型一次生成一批" arrow multiline
          left=${html`<${Icon} name="plus" size=${18}/>`}
          onClick=${() => nav.push(`/npc/${id}`)}/>
      <//>

      ${parent ? html`
        <div class="settings-foot">
          这是「${parent.name}」自己开的小号。<br/>
          ${char.altReason ? html`她给自己的理由：${char.altReason}` : null}
        </div>` : null}
      ${alts.length ? html`
        <${List} title=${`她的小号 · ${alts.length}`}>
          ${alts.map(a => html`
            <${ListItem} key=${a.id} title=${a.name} subtitle=${a.altReason || ''} arrow multiline
              left=${html`<${Icon} name="user" size=${18}/>`}
              onClick=${() => nav.push(`/profile/${a.id}`)}/>`)}
        <//>` : null}
    <//>`;
}

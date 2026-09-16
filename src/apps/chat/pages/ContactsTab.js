import { html } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { List, ListItem, Avatar, EmptyState, Button, Icon } from '../../../ui/index.js';

const { db, nav } = phone;

function Row({ char }) {
  const avatar = useImage(char.avatar);
  return html`
    <${ListItem} title=${char.name} subtitle=${char.signature || char.persona?.slice(0, 30) || '还没有设定'}
      arrow left=${html`<${Avatar} src=${avatar} name=${char.name} size=${40}/>`}
      onClick=${() => nav.push(`/profile/${char.id}`)}/>`;
}

export function ContactsTab() {
  useStore(db.characters.store);
  const list = db.characters.all().sort((a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.name.localeCompare(b.name, 'zh'));

  const add = () => {
    const c = db.characters.create({
      name: '新角色', persona: '', scenario: '', firstMessage: '',
      exampleDialogue: '', lorebookIds: [], tags: [],
    });
    nav.push(`/edit/${c.id}`);
  };

  if (!list.length) {
    return html`<${EmptyState} icon="users" title="还没有角色卡"
      desc="角色卡是整套系统的核心。它不属于任何一个页面，聊天、朋友圈、主页用的都是同一份。"
      action=${html`<${Button} size="sm" icon="plus" onClick=${add}>新建角色卡<//>`}/>`;
  }

  return html`
    <div>
      <${List} inset=${false}>${list.map(c => html`<${Row} key=${c.id} char=${c}/>`)}<//>
      <div class="pad">
        <${Button} full variant="ghost" icon="plus" onClick=${add}>新建角色卡<//>
      </div>
    </div>`;
}

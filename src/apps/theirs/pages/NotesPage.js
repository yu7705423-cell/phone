import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState, Button, confirm, toast } from '../../../ui/index.js';

const { db, nav, theirs } = phone;

// 这台手机上的备忘录。生成出来的东西，可以逐条删 —— 不合意的那几条留着碍眼。
export function NotesPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.phones.store);
  const char = db.characters.get(charId);
  if (!char) {
    return html`<${Page} title="备忘录" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  const list = theirs.notesOf(charId);

  const drop = async i => {
    if (!await confirm({ title: '删除这一条', danger: true, okText: '删除',
      message: '删除后无法恢复，可以重新生成。' })) return;
    theirs.removeNote(charId, i);
    toast('已删除');
  };

  if (!list.length) {
    return html`<${Page} title="备忘录" onBack=${nav.pop}>
      <${EmptyState} icon="notes" title="还没有备忘录"
        desc="依据该角色的设定生成这台手机里的备忘录。"
        action=${html`<${Button} size="sm" icon="plus"
          onClick=${() => nav.push(`/make/${charId}`)}>去生成<//>`}/>
    <//>`;
  }

  return html`
    <${Page} title="备忘录" onBack=${nav.pop}
      right=${html`<button class="nav-text press"
        onClick=${() => nav.push(`/make/${charId}`)}>生成</button>`}>
      <${List} title=${`共 ${list.length} 条`}>
        ${list.map((n, i) => html`
          <${ListItem} key=${i} title=${n.title || '无标题'} multiline
            subtitle=${n.text}
            left=${html`<${Icon} name="notes" size=${18}/>`}
            right=${html`
              <button class="press" aria-label=${`删除 ${n.title || '这一条'}`}
                onClick=${() => drop(i)}><${Icon} name="trash" size=${16}/></button>`}/>`)}
      <//>
      <div class="settings-foot">
        这些内容依据该角色的设定生成，不是该角色在对话中说过的话。
      </div>
    <//>`;
}

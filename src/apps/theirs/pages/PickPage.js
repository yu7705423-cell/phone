import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Avatar, EmptyState } from '../../../ui/index.js';

const { db, nav, shelf, health, day, theirs } = phone;

// 先挑一个角色。一台手机只属于一个人，所以这一步绕不过去。
//
// 副标题写这台手机上现在有几样东西，不写人设 —— 第 6 条，
// 人设只在编辑资料里出现，列表里一个字都不许露。
export function PickPage() {
  useStore(db.characters.store);
  useStore(db.health.store);
  useStore(db.days.store);
  useStore(db.phones.store);

  const chars = db.characters.all().filter(c => !c.isNpc && !c.parentId);

  const bitsOf = c => {
    const out = [];
    if (theirs.locked(c.id)) out.push(theirs.isOpen(c.id) ? '已解锁' : '锁屏已设定');
    const books = shelf.listOf(c.id).length;
    if (books) out.push(`书架 ${books} 本`);
    if (health.charOn(c.id)) out.push('身体状态');
    if (day.isOn(c)) out.push('今天');
    return out.length ? out.join(' · ') : '这台手机上还没有内容';
  };

  if (!chars.length) {
    return html`<${Page} title="角色手机">
      <${EmptyState} icon="phone" title="还没有角色"
        desc="先在「联系」中建立一个角色，之后可以在这里查看属于该角色的手机。"/><//>`;
  }

  return html`
    <${Page} title="角色手机">
      <${List} title=${`共 ${chars.length} 个角色`}>
        ${chars.map(c => html`
          <${ListItem} key=${c.id} title=${c.name} arrow multiline
            subtitle=${bitsOf(c)}
            left=${html`<${Avatar} src=${c.avatar} name=${c.name} size=${36}/>`}
            onClick=${() => nav.push(`/home/${c.id}`)}/>`)}
      <//>
      <div class="settings-foot">
        这里只做查看。书架、身体状态与今天的内容在各自的设定页中修改，
        本页不作改动。
      </div>
    <//>`;
}

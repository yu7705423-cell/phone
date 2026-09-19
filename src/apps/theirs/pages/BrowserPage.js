import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState, Button, confirm, toast } from '../../../ui/index.js';

const { db, nav, theirs } = phone;

// 这台手机上的浏览器。目前只有搜索记录 —— 没有真的网页可以打开，
// 摆一个打不开的地址栏只会让人点一下然后发现是假的。
export function BrowserPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.phones.store);
  const char = db.characters.get(charId);
  if (!char) {
    return html`<${Page} title="浏览器" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  const list = theirs.visitsOf(charId);

  const drop = async i => {
    if (!await confirm({ title: '删除这一条', danger: true, okText: '删除',
      message: '删除后无法恢复，可以重新生成。' })) return;
    theirs.removeVisit(charId, i);
    toast('已删除');
  };

  if (!list.length) {
    return html`<${Page} title="浏览器" onBack=${nav.pop}>
      <${EmptyState} icon="search" title="还没有搜索记录"
        desc="依据该角色的设定生成这台手机里的搜索记录。"
        action=${html`<${Button} size="sm" icon="plus"
          onClick=${() => nav.push(`/make/${charId}`)}>去生成<//>`}/>
    <//>`;
  }

  return html`
    <${Page} title="浏览器" onBack=${nav.pop}
      right=${html`<button class="nav-text press"
        onClick=${() => nav.push(`/make/${charId}`)}>生成</button>`}>
      <${List} title=${`搜索记录 ${list.length} 条`}>
        ${list.map((v, i) => html`
          <${ListItem} key=${i} title=${v.query} multiline
            subtitle=${v.site || '没有打开结果'}
            left=${html`<${Icon} name="search" size=${18}/>`}
            right=${html`
              <button class="press" aria-label=${`删除 ${v.query}`}
                onClick=${() => drop(i)}><${Icon} name="trash" size=${16}/></button>`}/>`)}
      <//>
      <div class="settings-foot">
        新的在上。这些内容依据该角色的设定生成，其中的站点名称不指向真实网页。
      </div>
    <//>`;
}

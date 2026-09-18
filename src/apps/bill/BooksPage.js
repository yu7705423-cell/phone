import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Segmented, Icon,
  Sheet, toast, confirm } from '../../ui/index.js';

const { db, nav, ledger } = phone;

const KINDS = [
  { value: 'real', label: '真实' },
  { value: 'play', label: '虚拟' },
];

// 账本。
//
// 两种账本功能完全一样：都可以有我的账户、角色的账户、共同账户。
// 差别只在 user 那一侧记的是不是真事 —— 真实账本里角色照样有钱，
// 那部分本来就是设定出来的。所以这里只是一个标签，界面上说清楚即可。
export function BooksPage() {
  useStore(db.books.store);
  useStore(db.entries.store);
  useStore(db.settings.store);
  const [editing, setEditing] = useState(null);
  const list = ledger.all();
  const cur = ledger.currentId();

  const drop = async b => {
    if (!await confirm({
      title: `删除「${b.name}」`, danger: true, okText: '删除',
      message: `该账本下的 ${ledger.entriesOf(b.id).length} 笔流水会一并删除，且无法恢复。`,
    })) return;
    ledger.remove(b.id);
    toast('已删除');
  };

  return html`
    <${Page} title="账本" onBack=${nav.pop}
      right=${html`<button class="nav-text press"
        onClick=${() => setEditing({ name: "", kind: "play", chatId: "" })}>新建</button>`}>

      <${List}>
        ${list.map(b => html`
          <${ListItem} key=${b.id} title=${b.name} multiline
            subtitle=${`${b.kind === 'real' ? '真实' : '虚拟'} · `
              + `${ledger.accountsOf(b.id).length} 个账户 · `
              + `${ledger.entriesOf(b.id).length} 笔流水 · `
              + `合计 ${ledger.money(b.id, ledger.totalOf(b.id))}`}
            left=${html`<${Icon} name=${b.kind === 'real' ? 'wallet' : 'sparkle'} size=${18}/>`}
            right=${b.id === cur ? html`<span class="li-hint">当前</span>` : null}
            onClick=${() => { ledger.setCurrent(b.id); toast(`已切换到「${b.name}」`, 'ok'); }}/>`)}
        ${!list.length ? html`<${ListItem} title="还没有账本"/>` : null}
      <//>

      ${list.map(b => html`
        <${List} key=${`e${b.id}`} title=${b.name}>
          <${ListItem} title="重命名 / 改归类" arrow
            left=${html`<${Icon} name="edit" size=${18}/>`}
            onClick=${() => setEditing(b)}/>
          <${ListItem} title="删除这本账" arrow
            left=${html`<${Icon} name="trash" size=${18}/>`}
            onClick=${() => drop(b)}/>
        <//>`)}

      <div class="settings-foot">
        两种账本的功能完全相同，均可设置本人账户、角色账户与共同账户。
        归类只影响这一本记的是否为实际收支：真实账本用于记录本人的实际生活，
        虚拟账本用于记录设定中的收支。
      </div>

      ${editing ? html`<${BookEditor} book=${editing} onClose=${() => setEditing(null)}/>` : null}
    <//>`;
}

function BookEditor({ book, onClose }) {
  const [name, setName] = useState(book.name || '');
  const [kind, setKind] = useState(book.kind || 'play');
  const [chatId, setChatId] = useState(book.chatId || '');
  const pairs = db.chats.all().filter(c => (c.characterIds || []).length === 1);

  const save = () => {
    if (book.id) ledger.update(book.id, { name, kind, chatId });
    else {
      const made = ledger.create({ name, kind, chatId });
      ledger.setCurrent(made.id);
    }
    toast('已保存', 'ok');
    onClose();
  };

  return html`
    <${Sheet} open title=${book.id ? '账本' : '新建账本'} onClose=${onClose}>
      <div class="pad">
        <${Field} label="名称">
          <${Input} value=${name} placeholder="我的账本" onInput=${setName}/>
        <//>
        <${Field} label="归类"
          desc=${kind === 'real'
            ? '用于记录本人的实际收支。角色账户与共同账户同样可用，该部分属于设定内容。'
            : '用于记录设定中的收支，不对应实际生活。'}>
          <${Segmented} value=${kind} items=${KINDS} onChange=${setKind}/>
        <//>
      </div>

      <${List} title="关联的对话"
        >
        <${ListItem} title="不关联" subtitle="仅本人账户，不显示角色相关的内容" multiline
          right=${!chatId ? html`<span class="li-hint">已选</span>` : null}
          onClick=${() => setChatId('')}/>
        ${pairs.map(c => {
          const char = db.characters.get(c.characterIds[0]);
          return html`
            <${ListItem} key=${c.id} title=${char?.name || '未命名'}
              right=${chatId === c.id ? html`<span class="li-hint">已选</span>` : null}
              onClick=${() => setChatId(c.id)}/>`;
        })}
      <//>
      <div class="settings-foot">
        关联对话后，该角色的账户与共同账户会显示其名称，聊天中提到的收支也会归入这一本。
      </div>

      <div class="pad">
        <${Button} full onClick=${save}>保存<//>
      </div>
    <//>`;
}

import { html, useState } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Field, Input, Avatar, List, ListItem, Switch, Button, Icon, Sheet,
         EmptyState, toast, confirm } from '../../../ui/index.js';

// 群聊的几块界面。见 ARCHITECTURE 4.162
//
// 群是一段会话，所以会话页本身照用；这里只放群才有的：建群、群资料、
// 群头像、@ 成员。

const { db, nav } = phone;

function Face({ char, size }) {
  const src = useImage(char?.avatar);
  return html`<${Avatar} src=${src} name=${char?.name || ''} size=${size} radius=${Math.round(size / 2)}/>`;
}

/**
 * 群头像：最多四个成员拼成一格。每一格单独一个组件取图 ——
 * 成员数会变，在一个组件里按成员数调 useImage，钩子个数就对不上。
 */
export function GroupFace({ chat, size = 46 }) {
  const list = phone.group.members(chat).slice(0, 4);
  const cell = list.length > 1 ? Math.floor(size / 2) - 1 : size;
  return html`
    <div class=${`group-face n-${list.length}`} style=${`--gf-size:${size}px`}>
      ${list.map(c => html`<${Face} key=${c.id} char=${c} size=${cell}/>`)}
    </div>`;
}

/** 选角色。群里已有的打勾，点一下切换 */
function Picker({ picked, onToggle, exclude = [] }) {
  useStore(db.characters.store);
  const list = db.characters.all()
    .filter(c => !exclude.includes(c.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
  if (!list.length) return html`<${EmptyState} title="没有可选的角色" desc="请先在「联系」中创建角色卡。"/>`;
  return html`
    <${List}>
      ${list.map(c => html`
        <${ListItem} key=${c.id} title=${c.name} subtitle=${c.signature || ''}
          left=${html`<${Face} char=${c} size=${34}/>`}
          right=${html`<span class=${`pick-dot${picked.includes(c.id) ? ' is-on' : ''}`}>
            ${picked.includes(c.id) ? html`<${Icon} name="check" size=${11}/>` : null}</span>`}
          onClick=${() => onToggle(c.id)}/>`)}
    <//>`;
}

export function NewGroupPage() {
  const [picked, setPicked] = useState([]);
  const [title, setTitle] = useState('');
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const enough = picked.length >= phone.group.MIN;
  const make = () => {
    try {
      const chat = phone.group.create({ ids: picked, title });
      nav.replace(`/chat/${chat.id}`);
    } catch (err) { toast(err.message || String(err), 'error'); }
  };
  return html`
    <${Page} title="发起群聊" onBack=${nav.pop}
      right=${html`<button class=${`nav-text press${enough ? '' : ' is-off'}`}
        onClick=${enough ? make : null}>完成${picked.length ? `（${picked.length}）` : ''}</button>`}>
      <div class="pad">
        <${Field} label="群名称" desc="可留空。留空时以成员名字显示，之后可在群资料中修改。">
          <${Input} value=${title} placeholder="群聊" onInput=${setTitle}/>
        <//>
      </div>
      <div class="settings-foot">选择至少 ${phone.group.MIN} 个角色。</div>
      <${Picker} picked=${picked} onToggle=${toggle}/>
    <//>`;
}

/** 群资料：名字、成员、这个群自己的几个开关（第 5 条：开关放在它起作用的地方） */
export function GroupPage({ chatId }) {
  useStore(db.chats.store);
  useStore(db.characters.store);
  const [adding, setAdding] = useState(false);
  const [more, setMore] = useState([]);
  const chat = db.chats.get(chatId);
  if (!chat) return html`<${Page} title="群资料" onBack=${nav.pop}><${EmptyState} title="该群已不存在"/><//>`;
  const members = phone.group.members(chat);

  const drop = async c => {
    if (members.length <= phone.group.MIN) {
      toast(`群聊至少需要 ${phone.group.MIN} 名成员`, 'error');
      return;
    }
    if (!await confirm({ title: `移出 ${c.name}`, message: '已有的消息保留。移出后该角色不再在这个群里发言。' })) return;
    phone.group.removeMember(chatId, c.id);
  };
  const remove = async () => {
    if (!await confirm({
      title: '删除群聊',
      message: '聊天记录会一起删除。只在这个群里生效的记忆一并删除，其余记忆保留。',
      danger: true,
    })) return;
    phone.purge.dropChat(chatId);
    nav.popToRoot();
  };

  return html`
    <${Page} title="群资料" onBack=${nav.pop}>
      <div class="group-head">
        <${GroupFace} chat=${chat} size=${64}/>
      </div>
      <div class="pad">
        <${Field} label="群名称" desc="留空时以成员名字显示。">
          <${Input} value=${chat.title || ''} placeholder=${phone.group.titleOf({ ...chat, title: '' })}
            onInput=${v => phone.group.rename(chatId, v)}/>
        <//>
      </div>

      <${List} title=${`成员（${members.length}）`}>
        ${members.map(c => html`
          <${ListItem} key=${c.id} title=${c.name} subtitle=${c.signature || ''}
            left=${html`<${Face} char=${c} size=${34}/>`}
            right=${html`<button class="nav-text press is-danger" onClick=${e => { e.stopPropagation(); drop(c); }}>移出</button>`}
            onClick=${() => nav.push(`/profile/${c.id}`)}/>`)}
        <${ListItem} title="添加成员" arrow
          left=${html`<${Icon} name="plus" size=${18}/>`}
          onClick=${() => { setMore([]); setAdding(true); }}/>
      <//>

      <${List} title="记忆">
        <${ListItem} title="群里的事带进私聊" multiline
          subtitle=${phone.group.memShared(chat)
            ? '已开启。从这个群里总结出的记忆，成员在私聊中同样记得。'
            : '已关闭。从这个群里总结出的记忆只在这个群里生效，私聊中不会出现。已经总结过的记忆不受影响。'}
          right=${html`<${Switch} checked=${phone.group.memShared(chat)}
            onChange=${v => db.chats.update(chatId, { groupMemory: v ? 'shared' : 'group' })}/>`}/>
      <//>
      <div class="settings-foot">
        每轮由模型一次写出开口成员的台词，只调用一次接口。被 @ 的成员在这一轮必定回复。
        若要每个成员单独调用，在「设置 - 用量与上限」中开启「群聊中每个角色单独调用」。
      </div>

      <${List}>
        <${ListItem} title="删除群聊" danger arrow
          left=${html`<${Icon} name="trash" size=${18}/>`} onClick=${remove}/>
      <//>

      <${Sheet} open=${adding} onClose=${() => setAdding(false)} title="添加成员" height="76%">
        <${Picker} picked=${more} exclude=${chat.characterIds || []}
          onToggle=${id => setMore(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))}/>
        <div class="group-add-foot">
          <${Button} full disabled=${!more.length} onClick=${() => {
            phone.group.addMembers(chatId, more);
            setAdding(false);
          }}>添加${more.length ? `（${more.length}）` : ''}<//>
        </div>
      <//>
    <//>`;
}

/**
 * @ 成员那一条。输入框里最后一个字是 @（或 @ 加上半个名字）时出现在输入框上面，
 * 点一下补全成「@名字 」。存的是 id（发出去那一下由 group.mentionsIn 认），
 * 所以之后改名也不影响。
 */
export function MentionBar({ chat, draft, onPick }) {
  const m = String(draft || '').match(/@([^\s@]*)$/);
  if (!m) return null;
  const key = m[1];
  const list = phone.group.members(chat).filter(c => !key || (c.name || '').includes(key));
  if (!list.length) return null;
  return html`
    <div class="mention-bar chip-row">
      ${list.map(c => html`
        <button key=${c.id} class="chip press"
          onClick=${() => onPick(`${draft.slice(0, draft.length - m[0].length)}@${c.name} `)}>
          @${c.name}
        </button>`)}
    </div>`;
}

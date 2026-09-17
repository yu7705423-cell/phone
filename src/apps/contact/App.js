import { html, useRef, useState } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { ProfilePage } from './ProfilePage.js';
import { NetPage } from './NetPage.js';
import { NpcPage } from './NpcPage.js';
import { ImportPage } from './ImportPage.js';
import { Page, List, ListItem, Field, Input, Textarea, Avatar, Button,
         Icon, IconButton, Sheet, EmptyState, toast, confirm, prompt } from '../../ui/index.js';

const { db, nav, images, accounts } = phone;
const AVATAR_MAX = 256;

// 「这个人是谁」都在这儿：我的人设，和每个角色的人设。
// 聊天里的角色卡只留「她在对话里怎么表现」那部分（语音、发图、主动找我、世界书）。
//
// 注意：人设正文只在「编辑资料」页的输入框里出现。列表和资料页一个字都不露，
// 要显示就用 signature。见 CLAUDE.md 第 6 条。

function AvatarPicker({ src, name, onPick }) {
  const fileRef = useRef(null);
  const url = useImage(src);
  const choose = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const id = await images.put(file, AVATAR_MAX);
      onPick(id, src);
    } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };
  return html`
    <div class="avatar-picker">
      <${Avatar} src=${url} name=${name} size=${76}/>
      <${Button} size="sm" variant="ghost" icon="upload"
        onClick=${() => fileRef.current?.click()}>更换头像<//>
      <input type="file" accept="image/*" ref=${fileRef} onChange=${choose} style="display:none"/>
    </div>`;
}

// 像卡片墙一样铺开，不是一行一行的列表
function Card({ char, onClick }) {
  const url = useImage(char.avatar);
  const alts = db.characters.where(x => x.parentId === char.id).length;
  const bits = [char.age && `${char.age}`, char.gender].filter(Boolean).join(' · ');
  return html`
    <button class="ct-card press" onClick=${onClick}>
      <div class=${`ct-cover${url ? ' has-image' : ''}`}
        style=${url ? `background-image:url(${url})` : ''}>
        ${url ? null : html`<span class="ct-initial">${(char.name || '?').slice(0, 1)}</span>`}
        ${alts ? html`<span class="ct-badge">${alts} 个小号</span>` : null}
        ${char.isNpc ? html`<span class="ct-badge ct-badge-npc">NPC</span>` : null}
      </div>
      <div class="ct-name ellipsis">${char.name || '未命名'}</div>
      <div class="ct-sign ellipsis">${char.signature || bits || '还没写签名'}</div>
    </button>`;
}

// 只显示签名。人设一个字都不往外露 —— 那是只有「编辑资料」里才出现的东西。
function Row({ subject, onClick, right, tag }) {
  const url = useImage(subject.avatar);
  return html`
    <${ListItem} multiline onClick=${onClick} right=${right} arrow=${!right}
      left=${html`<${Avatar} src=${url} name=${subject.name} size=${40}/>`}
      title=${html`${subject.name || '未命名'}${tag ? html`<span class="acc-tag">${tag}</span>` : null}`}
      subtitle=${subject.signature || ''}/>`;
}

function Home() {
  useStore(db.personas.store);
  useStore(db.characters.store);
  useStore(db.settings.store);
  useStore(db.chats.store);
  const [picking, setPicking] = useState(false);

  const me = accounts.current();
  const roots = accounts.roots();
  const chars = db.characters.all()
    .filter(c => !c.parentId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const addChar = () => {
    const c = db.characters.create({
      name: '新角色', persona: '', signature: '',
      lorebookIds: [], canSendVoice: true, canSendImage: true, parentId: null,
    });
    nav.push(`/edit/${c.id}`);
  };

  const newAccount = async () => {
    setPicking(false);
    const name = await prompt({ title: '新账号', placeholder: '换个名字' });
    if (name === null) return;
    const p = accounts.createRoot({ name: (name || '').trim() || '新账号' });
    accounts.switchTo(p.id);
    nav.push(`/me/${p.id}`);
  };

  const pickAccount = id => { accounts.switchTo(id); setPicking(false); };

  return html`
    <${Page} title="联系"
      right=${html`
        <${IconButton} name="upload" label="导入角色卡"
          onClick=${() => nav.push('/import')}/>
        <${IconButton} name="plus" label="新建角色" onClick=${addChar}/>`}>
      <${List} title="当前账号">
        ${me ? html`
          <${Row} subject=${me} tag=${me.parentId ? '小号' : null}
            onClick=${() => nav.push(`/me/${me.id}`)}/>` : null}
        <${ListItem} title="切换账号" multiline arrow
          subtitle=${`共 ${roots.length} 个账号。各账号之间完全独立，互不共享会话与记忆`}
          left=${html`<${Icon} name="users" size=${18}/>`}
          onClick=${() => setPicking(true)}/>
      <//>

      ${chars.length ? html`
        <div class="ct-sec">角色 · ${chars.length}</div>
        <div class="ct-grid">
          ${chars.map(c => html`<${Card} key=${c.id} char=${c}
            onClick=${() => nav.push(`/char/${c.id}`)}/>`)}
        </div>`
      : html`<${EmptyState} icon="users" title="暂无角色"
          desc="可新建角色，或导入已写好的 txt / docx 资料。"
          action=${html`<${Button} size="sm" icon="plus" onClick=${addChar}>新建角色<//>`}/>`}

      <div class="settings-foot">
        这里写的是「这个人是谁」，会进 prompt。<br/>
        语音、发图、主动找我这些在会话右上角的角色卡里调。
      </div>

      <${Sheet} open=${picking} onClose=${() => setPicking(false)} title="切换账号" height="70%">
        <${List} inset=${false}>
          ${roots.map(r => html`
            <div key=${r.id}>
              <${Row} subject=${r}
                right=${me?.id === r.id ? html`<${Icon} name="check" size=${17}/>` : null}
                onClick=${() => pickAccount(r.id)}/>
              ${accounts.altsOf(r.id).map(a2 => html`
                <div key=${a2.id} class="acc-alt">
                  <${Row} subject=${a2} tag="小号"
                    right=${me?.id === a2.id ? html`<${Icon} name="check" size=${17}/>` : null}
                    onClick=${() => pickAccount(a2.id)}/>
                </div>`)}
            </div>`)}
        <//>
        <div class="pad">
          <${Button} full variant="ghost" icon="plus" onClick=${newAccount}>再开一个账号<//>
        </div>
        <div class="settings-foot">
          小号在账号自己的页面里开。小号找角色聊天时，角色记得的事都还在，
          但不知道你就是大号那个人。
        </div>
      <//>
    <//>`;
}

function MePage({ id }) {
  useStore(db.personas.store);
  useStore(db.chats.store);
  const me = accounts.get(id) || accounts.current();
  if (!me) {
    return html`<${Page} title="账号" onBack=${nav.pop}>
      <${EmptyState} title="该账号已不存在"/><//>`;
  }
  const set = p => db.personas.update(me.id, p);
  const alts = me.parentId ? [] : accounts.altsOf(me.id);
  const isCurrent = accounts.currentId() === me.id;

  const addAlt = async () => {
    const name = await prompt({ title: '开个小号', placeholder: `${me.name}的小号` });
    if (name === null) return;
    const a = accounts.createAlt(me.id, { name: (name || '').trim() || `${me.name}的小号` });
    nav.push(`/me/${a.id}`);
  };

  const del = async () => {
    if (accounts.roots().length <= 1 && !me.parentId) {
      toast('这是唯一的账号，无法删除'); return;
    }
    if (!await confirm({
      title: me.parentId ? '删掉这个小号' : '删掉这个账号', danger: true, okText: '删掉',
      message: me.parentId
        ? `「${me.name}」和它名下的会话都会删掉。`
        : `「${me.name}」、它的小号、以及这些身份下的所有会话都会删掉。记忆不会自动删。`,
    })) return;
    accounts.remove(me.id);
    nav.pop();
  };

  return html`
    <${Page} title=${me.parentId ? '小号' : '账号'} onBack=${nav.pop}
      right=${isCurrent ? null : html`
        <button class="nav-text press"
          onClick=${() => { accounts.switchTo(me.id); toast(`已切换至 ${me.name}`, 'ok'); }}>切换至此</button>`}>
      <div class="pad">
        <${AvatarPicker} src=${me.avatar} name=${me.name}
          onPick=${(imgId, old) => { set({ avatar: imgId }); if (old) images.remove(old); }}/>

        <${Field} label="昵称" desc="角色将以此称呼你。">
          <${Input} value=${me.name} onInput=${v => set({ name: v })}/>
        <//>
        <${Field} label="个性签名" desc="显示在主页上。">
          <${Input} value=${me.signature || ''} onInput=${v => set({ signature: v })}/>
        <//>
        <${Field} label="人设描述"
          desc="该内容将作为「对方是谁」注入 prompt。请写明你希望角色如何认识你。">
          <${Textarea} rows=${8} value=${me.description || ''}
            placeholder="例如：大学生，设计专业，话不多但想到什么说什么，不喜欢被说教。"
            onInput=${v => set({ description: v })}/>
        <//>
      </div>

      ${me.parentId ? html`
        <div class="settings-foot">
          这是「${accounts.rootOf(me.id)?.name}」的小号。<br/>
          用它去找角色聊天时，角色自己的经历和它跟大号之间的事都还记得，
          但不知道眼前这个人就是大号 —— 对它来说你是个陌生人。
        </div>` : html`
        <${List} title=${`小号 · ${alts.length}`}>
          ${alts.map(a => html`
            <${ListItem} key=${a.id} title=${a.name} arrow multiline
              subtitle=${a.signature || ''}
              left=${html`<${Icon} name="user" size=${18}/>`}
              onClick=${() => nav.push(`/me/${a.id}`)}/>`)}
          <${ListItem} title="创建小号" arrow multiline
            subtitle="以另一身份与同一角色对话。角色保留原有记忆，但不认识该新身份"
            left=${html`<${Icon} name="plus" size=${18}/>`}
            onClick=${addAlt}/>
        <//>`}

      <div class="pad">
        <${Button} full variant="danger" onClick=${del}>
          ${me.parentId ? '删掉这个小号' : '删掉这个账号'}<//>
      </div>
    <//>`;
}

function EditPage({ id }) {
  useStore(db.characters.store);
  const char = db.characters.get(id);
  if (!char) {
    return html`<${Page} title="人设" onBack=${nav.pop}>
      <${EmptyState} title="该角色已被删除"/><//>`;
  }
  const patch = p => db.characters.update(id, p);

  const del = async () => {
    if (!await confirm({
      title: '删除这个角色', danger: true, okText: '删除',
      message: `将删除「${char.name}」。与该角色的聊天记录不会一并删除。`,
    })) return;
    db.characters.remove(id);
    nav.pop();
  };

  return html`
    <${Page} title="编辑资料" onBack=${nav.pop}>
      <div class="pad">
        <${AvatarPicker} src=${char.avatar} name=${char.name}
          onPick=${(imgId, old) => { patch({ avatar: imgId }); if (old) images.remove(old); }}/>

        <${Field} label="名字">
          <${Input} value=${char.name} onInput=${v => patch({ name: v })}/>
        <//>
        <${Field} label="个性签名" desc="一句话，建议十五字以内。">
          <${Input} value=${char.signature || ''} onInput=${v => patch({ signature: v })}/>
        <//>
        <div class="quiet-row">
          <${Field} label="年龄">
            <${Input} value=${char.age || ''} onInput=${v => patch({ age: v })}/>
          <//>
          <${Field} label="性别">
            <${Input} value=${char.gender || ''} onInput=${v => patch({ gender: v })}/>
          <//>
        </div>
        <${Field} label="生日" desc="可填写为 3月14日 或 1999-03-14。">
          <${Input} value=${char.birthday || ''} onInput=${v => patch({ birthday: v })}/>
        <//>
        <${Field} label="人设" desc="进入 prompt 的主体内容。写明这个人是谁、性格如何、说话方式如何。">
          <${Textarea} rows=${9} value=${char.persona}
            placeholder="例如：林晓，二十二岁，美术学院三年级。说话略带漫不经心，熟悉后会突然认真。不喜欢被安慰。"
            onInput=${v => patch({ persona: v })}/>
        <//>
        <${Field} label="情境" desc="双方是什么关系，当前处于什么场景。">
          <${Textarea} rows=${3} value=${char.scenario || ''}
            onInput=${v => patch({ scenario: v })}/>
        <//>
        <${Field} label="开场白" desc="新会话中角色发出的第一条消息。">
          <${Textarea} rows=${3} value=${char.firstMessage || ''}
            onInput=${v => patch({ firstMessage: v })}/>
        <//>
        <${Field} label="对话示例" desc="提供几句角色的典型发言。示例比形容词更有效。">
          <${Textarea} rows=${6} value=${char.exampleDialogue || ''}
            onInput=${v => patch({ exampleDialogue: v })}/>
        <//>
      </div>

      ${char.parentId ? html`
        <div class="settings-foot">
          这是「${db.characters.get(char.parentId)?.name || '某个角色'}」自己开的小号。<br/>
          ${char.altReason ? html`她给自己的理由：${char.altReason}<br/>` : null}
          它和本体是两个身份，各自和你单独聊，记忆也分开。
        </div>`
      : html`
        <${List} title=${`该角色的小号 · ${db.characters.where(x => x.parentId === id).length}`}>
          ${db.characters.where(x => x.parentId === id).map(a => html`
            <${ListItem} key=${a.id} title=${a.name} arrow multiline
              subtitle=${a.altReason || a.signature || ''}
              left=${html`<${Icon} name="user" size=${18}/>`}
              onClick=${() => nav.push(`/char/${a.id}`)}/>`)}
          ${db.characters.where(x => x.parentId === id).length ? null : html`
            <${ListItem} title="暂无" multiline
              subtitle="角色小号由角色自行创建，无法手动添加。在会话的「主动发起对话」中开启相应开关后，对话累积到一定程度可能出现"/>`}
        <//>`}

      <div class="settings-foot">
        语音、发图、主动找我、关联世界书在会话右上角的「角色卡」里调。
      </div>

      <div class="pad">
        <${Button} full variant="danger" onClick=${del}>删除这个角色<//>
      </div>
    <//>`;
}

export default function ContactApp({ route }) {
  if (route === '/import') return html`<${ImportPage}/>`;
  if (route === '/me') return html`<${MePage} id=${accounts.currentId()}/>`;
  const m = route?.match(/^\/me\/(.+)$/);
  if (m) return html`<${MePage} id=${m[1]}/>`;
  const e = route?.match(/^\/edit\/(.+)$/);
  if (e) return html`<${EditPage} id=${e[1]}/>`;
  const n = route?.match(/^\/net\/(.+)$/);
  if (n) return html`<${NetPage} id=${n[1]}/>`;
  const p = route?.match(/^\/npc\/(.+)$/);
  if (p) return html`<${NpcPage} id=${p[1]}/>`;
  // /char/ 和 /profile/ 都进资料页，聊天那边的老链接不至于落空
  const c = route?.match(/^\/(?:char|profile)\/(.+)$/);
  if (c) return html`<${ProfilePage} id=${c[1]}/>`;
  return html`<${Home}/>`;
}

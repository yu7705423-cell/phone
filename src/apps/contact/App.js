import { html, useRef, useState } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Avatar, Button,
         Icon, IconButton, Sheet, EmptyState, toast, confirm, prompt } from '../../ui/index.js';

const { db, nav, images, accounts } = phone;
const AVATAR_MAX = 256;

// 「这个人是谁」都在这儿：我的人设，和每个角色的人设。
// 聊天里的角色卡只留「她在对话里怎么表现」那部分（语音、发图、主动找我、世界书）。

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

function Row({ subject, isMe, onClick, right, tag }) {
  const url = useImage(subject.avatar);
  const text = isMe ? subject.description : subject.persona;
  return html`
    <${ListItem} multiline onClick=${onClick} right=${right} arrow=${!right}
      left=${html`<${Avatar} src=${url} name=${subject.name} size=${40}/>`}
      title=${html`${subject.name || '未命名'}${tag ? html`<span class="acc-tag">${tag}</span>` : null}`}
      subtitle=${text ? String(text).slice(0, 40) : '还没写人设'}/>`;
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
    nav.push(`/char/${c.id}`);
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
      right=${html`<button class="nav-text press" onClick=${addChar}>新建</button>`}>
      <${List} title="当前账号">
        ${me ? html`
          <${Row} subject=${me} isMe tag=${me.parentId ? '小号' : null}
            onClick=${() => nav.push(`/me/${me.id}`)}/>` : null}
        <${ListItem} title="切换账号" multiline arrow
          subtitle=${`一共 ${roots.length} 个账号。不同账号之间完全独立，互相看不到对方的会话和记忆`}
          left=${html`<${Icon} name="users" size=${18}/>`}
          onClick=${() => setPicking(true)}/>
      <//>

      ${chars.length ? html`
        <${List} title=${`角色 · ${chars.length}`}>
          ${chars.map(c => html`
            <${Row} key=${c.id} subject=${c}
              tag=${db.characters.where(x => x.parentId === c.id).length
                ? `${db.characters.where(x => x.parentId === c.id).length} 个小号` : null}
              onClick=${() => nav.push(`/char/${c.id}`)}/>`)}
        <//>`
      : html`<${EmptyState} icon="users" title="还没有角色"
          desc="在这里建一个，写好人设之后去「聊天」里开始对话。"
          action=${html`<${Button} size="sm" icon="plus" onClick=${addChar}>新建角色<//>`}/>`}

      <div class="settings-foot">
        这里写的是「这个人是谁」，会进 prompt。<br/>
        语音、发图、主动找我这些在会话右上角的角色卡里调。
      </div>

      <${Sheet} open=${picking} onClose=${() => setPicking(false)} title="切换账号" height="70%">
        <${List} inset=${false}>
          ${roots.map(r => html`
            <div key=${r.id}>
              <${Row} subject=${r} isMe
                right=${me?.id === r.id ? html`<${Icon} name="check" size=${17}/>` : null}
                onClick=${() => pickAccount(r.id)}/>
              ${accounts.altsOf(r.id).map(a2 => html`
                <div key=${a2.id} class="acc-alt">
                  <${Row} subject=${a2} isMe tag="小号"
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
      <${EmptyState} title="这个账号不在了"/><//>`;
  }
  const set = p => db.personas.update(me.id, p);
  const alts = me.parentId ? [] : accounts.altsOf(me.id);
  const isCurrent = accounts.currentId() === me.id;

  const del = async () => {
    if (accounts.roots().length <= 1 && !me.parentId) {
      toast('这是唯一的账号，删不了'); return;
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
          onClick=${() => { accounts.switchTo(me.id); toast(`切到${me.name}`, 'ok'); }}>切过来</button>`}>
      <div class="pad">
        <${AvatarPicker} src=${me.avatar} name=${me.name}
          onPick=${(imgId, old) => { set({ avatar: imgId }); if (old) images.remove(old); }}/>

        <${Field} label="昵称" desc="角色会这样称呼你">
          <${Input} value=${me.name} onInput=${v => set({ name: v })}/>
        <//>
        <${Field} label="个性签名" desc="显示在主页上">
          <${Input} value=${me.signature || ''} onInput=${v => set({ signature: v })}/>
        <//>
        <${Field} label="人设描述"
          desc="这段会作为「对方是谁」注入到 prompt。写你希望角色怎么认识你。">
          <${Textarea} rows=${8} value=${me.description || ''}
            placeholder="例如：大学生，学设计，话不多但想到什么说什么，讨厌被说教。"
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
              subtitle=${a.description ? String(a.description).slice(0, 34) : '还没写人设'}
              left=${html`<${Icon} name="user" size=${18}/>`}
              onClick=${() => nav.push(`/me/${a.id}`)}/>`)}
          <${ListItem} title="开一个小号" arrow multiline
            subtitle="换个身份去加同一个角色。角色记得的事都在，但不认识这个新身份"
            left=${html`<${Icon} name="plus" size=${18}/>`}
            onClick=${addAlt}/>
        <//>`}

      <div class="pad">
        <${Button} full variant="danger" onClick=${del}>
          ${me.parentId ? '删掉这个小号' : '删掉这个账号'}<//>
      </div>
    <//>`;
}

function CharPage({ id }) {
  useStore(db.characters.store);
  const char = db.characters.get(id);
  if (!char) {
    return html`<${Page} title="人设" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已被删除"/><//>`;
  }
  const patch = p => db.characters.update(id, p);

  const addAlt = async () => {
    const name = await prompt({ title: '给她开个小号', placeholder: `${char.name}的小号` });
    if (name === null) return;
    const a = db.characters.create({
      name: (name || '').trim() || `${char.name}的小号`,
      parentId: id, persona: '', signature: '',
      lorebookIds: [], canSendVoice: true, canSendImage: true,
    });
    nav.push(`/char/${a.id}`);
  };

  const del = async () => {
    if (!await confirm({
      title: '删除这个角色', danger: true, okText: '删除',
      message: `「${char.name}」会被删掉。和她的聊天记录不会自动删除。`,
    })) return;
    db.characters.remove(id);
    nav.pop();
  };

  return html`
    <${Page} title=${char.name || '角色'} onBack=${nav.pop}
      right=${html`<${IconButton} name="message" label="去聊天"
        onClick=${() => phone.intent.open('chat', { route: '/' })}/>`}>
      <div class="pad">
        <${AvatarPicker} src=${char.avatar} name=${char.name}
          onPick=${(imgId, old) => { patch({ avatar: imgId }); if (old) images.remove(old); }}/>

        <${Field} label="名字">
          <${Input} value=${char.name} onInput=${v => patch({ name: v })}/>
        <//>
        <${Field} label="个性签名" desc="显示在主页和联系人列表">
          <${Input} value=${char.signature || ''} onInput=${v => patch({ signature: v })}/>
        <//>
        <${Field} label="人设" desc="进入 prompt 的主体。写这个人是谁、什么性格、怎么说话。">
          <${Textarea} rows=${9} value=${char.persona}
            placeholder="例如：林晓，二十二岁，美院大三。说话带点漫不经心，熟了之后会突然认真。不喜欢被安慰。"
            onInput=${v => patch({ persona: v })}/>
        <//>
        <${Field} label="情境" desc="你们是什么关系、现在处在什么场景">
          <${Textarea} rows=${3} value=${char.scenario || ''}
            onInput=${v => patch({ scenario: v })}/>
        <//>
        <${Field} label="开场白" desc="新会话里她发的第一条消息">
          <${Textarea} rows=${3} value=${char.firstMessage || ''}
            onInput=${v => patch({ firstMessage: v })}/>
        <//>
        <${Field} label="说话方式示例" desc="给模型看几句她会怎么说，比形容词管用">
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
        <${List} title=${`她的小号 · ${db.characters.where(x => x.parentId === id).length}`}>
          ${db.characters.where(x => x.parentId === id).map(a => html`
            <${ListItem} key=${a.id} title=${a.name} arrow multiline
              subtitle=${a.altReason || (a.persona ? String(a.persona).slice(0, 34) : '还没写人设')}
              left=${html`<${Icon} name="user" size=${18}/>`}
              onClick=${() => nav.push(`/char/${a.id}`)}/>`)}
          ${db.characters.where(x => x.parentId === id).length ? null : html`
            <${ListItem} title="还没有" multiline
              subtitle="小号是她自己开的，你开不了。在会话的「主动找我」里把开关打开，聊得够久她可能会动这个念头"/>`}
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
  if (route === '/me') return html`<${MePage} id=${accounts.currentId()}/>`;
  const m = route?.match(/^\/me\/(.+)$/);
  if (m) return html`<${MePage} id=${m[1]}/>`;
  const c = route?.match(/^\/char\/(.+)$/);
  if (c) return html`<${CharPage} id=${c[1]}/>`;
  return html`<${Home}/>`;
}

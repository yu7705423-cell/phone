import { html, useRef } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Avatar, Button,
         Icon, IconButton, EmptyState, toast, confirm } from '../../ui/index.js';

const { db, nav, images } = phone;
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

function Row({ subject, isMe, onClick }) {
  const url = useImage(isMe ? subject.avatar : subject.avatar);
  const text = isMe ? subject.description : subject.persona;
  return html`
    <${ListItem} multiline arrow onClick=${onClick}
      left=${html`<${Avatar} src=${url} name=${subject.name} size=${40}/>`}
      title=${subject.name || '未命名'}
      subtitle=${text ? String(text).slice(0, 40) : '还没写人设'}/>`;
}

function Home() {
  useStore(db.persona.store);
  useStore(db.characters.store);
  const me = db.persona.get();
  const list = db.characters.all().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const add = () => {
    const c = db.characters.create({
      name: '新角色', persona: '', signature: '',
      lorebookIds: [], canSendVoice: true, canSendImage: true,
    });
    nav.push(`/char/${c.id}`);
  };

  return html`
    <${Page} title="联系"
      right=${html`<button class="nav-text press" onClick=${add}>新建</button>`}>
      <${List} title="我">
        <${Row} subject=${me} isMe onClick=${() => nav.push('/me')}/>
      <//>

      ${list.length ? html`
        <${List} title=${`角色 · ${list.length}`}>
          ${list.map(c => html`
            <${Row} key=${c.id} subject=${c} onClick=${() => nav.push(`/char/${c.id}`)}/>`)}
        <//>`
      : html`<${EmptyState} icon="users" title="还没有角色"
          desc="在这里建一个，写好人设之后去「聊天」里开始对话。"
          action=${html`<${Button} size="sm" icon="plus" onClick=${add}>新建角色<//>`}/>`}

      <div class="settings-foot">
        这里写的是「这个人是谁」，会进 prompt。<br/>
        语音、发图、主动找我这些在会话右上角的角色卡里调。
      </div>
    <//>`;
}

function MePage() {
  useStore(db.persona.store);
  const me = db.persona.get();
  const set = p => db.persona.set(p);

  return html`
    <${Page} title="我的人设" onBack=${nav.pop}>
      <div class="pad">
        <${AvatarPicker} src=${me.avatar} name=${me.name}
          onPick=${(id, old) => { set({ avatar: id }); if (old) images.remove(old); }}/>

        <${Field} label="昵称" desc="角色会这样称呼你">
          <${Input} value=${me.name} onInput=${v => set({ name: v })}/>
        <//>
        <${Field} label="个性签名" desc="显示在主页上">
          <${Input} value=${me.signature} onInput=${v => set({ signature: v })}/>
        <//>
        <${Field} label="人设描述"
          desc="这段会作为「对方是谁」注入到 prompt。写你希望角色怎么认识你。">
          <${Textarea} rows=${8} value=${me.description}
            placeholder="例如：大学生，学设计，话不多但想到什么说什么，讨厌被说教。"
            onInput=${v => set({ description: v })}/>
        <//>
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

      <div class="settings-foot">
        语音、发图、主动找我、关联世界书在会话右上角的「角色卡」里调。
      </div>

      <div class="pad">
        <${Button} full variant="danger" onClick=${del}>删除这个角色<//>
      </div>
    <//>`;
}

export default function ContactApp({ route }) {
  if (route === '/me') return html`<${MePage}/>`;
  const c = route?.match(/^\/char\/(.+)$/);
  if (c) return html`<${CharPage} id=${c[1]}/>`;
  return html`<${Home}/>`;
}

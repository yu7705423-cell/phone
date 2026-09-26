import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Sheet, FullSheet, List, ListItem, Field, Input, Textarea, Switch, Button, toast } from '../../../ui/index.js';

const { db, face, tone, ai } = phone;

// 会话页上的线上 / 线下切换（ARCHITECTURE 4.269）。
//
//   FaceChooser  面板里点「线下」先问一句：就在这里用气泡演，还是写成长文
//   FaceSheet    切到线下之前那张单子：地点、时刻、情境、这一段关掉哪几本书、文风
//   FaceBar      线下期间顶上那一条：写着在哪，点一下改，旁边一个「回到线上」
//   SideLine     消息流里的分隔线

export function FaceChooser({ open, onClose, onHere, onProse }) {
  return html`
    <${Sheet} open=${open} onClose=${onClose} title="线下">
      <${List}>
        <${ListItem} title="就在这里" multiline arrow
          subtitle="接着用气泡对话，角色每轮至少写一行旁白描写此刻。切换后两人视为在同一处，切回线上前不再视为发消息。"
          onClick=${() => { onClose(); onHere(); }}/>
        <${ListItem} title="写成长文" multiline arrow
          subtitle="以成段的文字推进，在「线下」页或聊天里演。"
          onClick=${() => { onClose(); onProse(); }}/>
      <//>
    <//>`;
}

function BooksPart({ chat, chars }) {
  useStore(db.lorebooks.store);
  const off = face.offBooks(chat);
  const on = face.extraBooks(chat);
  const attached = new Set(chars.flatMap(c => c.lorebookIds || []));
  const books = db.lorebooks.all().filter(b => ai.lore.purposeOf(b) === 'chat');
  const mine = books.filter(b => b.global || attached.has(b.id));
  const rest = books.filter(b => !(b.global || attached.has(b.id)));
  if (!books.length) return null;
  const flipOff = id => face.setBooks(chat.id, { off: off.includes(id) ? off.filter(x => x !== id) : [...off, id] });
  const flipOn = id => face.setBooks(chat.id, { extra: on.includes(id) ? on.filter(x => x !== id) : [...on, id] });
  return html`
    ${mine.length ? html`
      <${List} title="线下时生效的世界书">
        ${mine.map(b => html`
          <${ListItem} key=${b.id} title=${b.name || '未命名'} subtitle=${b.global ? '全局' : '角色已挂'}
            right=${html`<${Switch} checked=${!off.includes(b.id)} onChange=${() => flipOff(b.id)}/>`}
            onClick=${() => flipOff(b.id)}/>`)}
      <//>` : null}
    ${rest.length ? html`
      <${List} title="只在线下挂上">
        ${rest.map(b => html`
          <${ListItem} key=${b.id} title=${b.name || '未命名'}
            right=${html`<${Switch} checked=${on.includes(b.id)} onChange=${() => flipOn(b.id)}/>`}
            onClick=${() => flipOn(b.id)}/>`)}
      <//>` : null}
    <div class="settings-foot">关掉的书在线下期间不注入，切回线上恢复。此处的选择记在这段会话上。</div>`;
}

function TonePart({ chat }) {
  useStore(db.settings.store);
  const picked = face.tonesOf(chat);
  const list = tone.list();
  const flip = id => face.setTones(chat.id, picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id]);
  return html`
    <${List} title="线下时的文风">
      ${list.map(t => html`
        <${ListItem} key=${t.id} title=${t.name} subtitle=${String(t.text || '').split('\n')[0]} multiline
          right=${html`<${Switch} checked=${picked.includes(t.id)} onChange=${() => flip(t.id)}/>`}
          onClick=${() => flip(t.id)}/>`)}
      <${ListItem} title="这段会话自己写" multiline subtitle="只作用于这段会话的线下"
        right=${html`<${Switch} checked=${picked.includes('custom')} onChange=${() => flip('custom')}/>`}
        onClick=${() => flip('custom')}/>
    <//>
    ${picked.includes('custom') ? html`
      <div class="pad-x">
        <${Textarea} rows=${4} value=${chat.faceToneText || ''}
          placeholder="写线下要的文风。一律用英文，可以用 {{charName}} 与 {{userName}} 指代双方。"
          onInput=${v => face.setTones(chat.id, picked, v)}/>
      </div>` : null}
    <div class="settings-foot">可以选多份，按选中的顺序写入提示词。预设在「线下」页新建那一场时编辑。</div>`;
}

/** 切到线下之前的那张单子；线下期间点顶上那一条也是它，改的是同一份 */
export function FaceSheet({ open, chat, chars, onClose }) {
  useStore(db.chats.store);
  const live = face.on(chat);
  const info = face.infoOf(chat) || {};
  const [v, setV] = useState({ place: info.place || '', at: info.at || '', note: info.note || '' });
  const set = patch => setV(x => ({ ...x, ...patch }));
  const go = () => {
    if (live) face.update(chat.id, v);
    else face.enter(chat.id, v);
    onClose();
    if (!live) toast('已切到线下', 'ok');
  };
  return html`
    <${FullSheet} open=${open} onClose=${onClose} title=${live ? '线下' : '切到线下'}
      right=${html`<${Button} size="sm" onClick=${go}>${live ? '保存' : '开始'}<//>`}>
      <div class="pad">
        <${Field} label="地点" desc="作为事实进入上下文。留空表示不写。">
          <${Input} value=${v.place} onInput=${x => set({ place: x })} placeholder="例如 旧书店"/>
        <//>
        <${Field} label="时刻" desc="这一段从什么时候开始。留空表示不写。">
          <${Input} value=${v.at} onInput=${x => set({ at: x })} placeholder="例如 周三 14:30"/>
        <//>
        <${Field} label="情境" desc="这一段的前提。作为事实进入上下文，不作为写法上的要求。">
          <${Textarea} rows=${3} value=${v.note} onInput=${x => set({ note: x })}
            placeholder="例如 两人约好在这里见面，但对方迟到了四十分钟"/>
        <//>
      </div>
      <${BooksPart} chat=${chat} chars=${chars}/>
      <${TonePart} chat=${chat}/>
      <div class="settings-foot">
        线下期间：角色每轮至少写一行旁白；转账、外卖、表情、图片、语音、通话等手机上的动作不可用；
        角色不主动发起对话；延迟回复按发完就回处理。切回线上后全部恢复。
      </div>
    <//>`;
}

/** 线下期间顶上那一条 */
export function FaceBar({ chat, onEdit }) {
  const info = face.infoOf(chat);
  return html`
    <div class="face-bar ph-toolbar">
      <button class="face-bar-main press" onClick=${onEdit}>${face.labelOf(info)}</button>
      <button class="face-bar-back press" onClick=${() => { face.leave(chat.id); toast('已回到线上', 'ok'); }}>回到线上</button>
    </div>`;
}

/** 消息流里的分隔线 */
export function SideLine({ msg }) {
  const text = msg.side === 'face' ? face.labelOf(msg.face) : '回到线上';
  return html`
    <div class=${`side-div ph-side${msg.side === 'face' ? ' is-face' : ''}`}>
      <span class="side-div-line"></span>
      <span class="side-div-text">${text}</span>
      <span class="side-div-line"></span>
    </div>`;
}

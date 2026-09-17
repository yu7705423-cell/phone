import { html } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Field, Input, Avatar, List, ListItem,
         Switch, Icon } from '../../../ui/index.js';

const { db, nav } = phone;

export function CharacterEdit({ id }) {
  useStore(db.characters.store);
  useStore(db.lorebooks.store);
  const char = db.characters.get(id);
  const avatar = useImage(char?.avatar);

  if (!char) return html`<${Page} title="编辑" onBack=${nav.pop}/>`;
  const patch = p => db.characters.update(id, p);

  const toggleBook = bid => {
    const cur = char.lorebookIds || [];
    patch({ lorebookIds: cur.includes(bid) ? cur.filter(x => x !== bid) : [...cur, bid] });
  };

  return html`
    <${Page} title="角色卡" onBack=${nav.pop}>
      <div class="pad">
        <div class="avatar-picker">
          <${Avatar} src=${avatar} name=${char.name} size=${76}/>
          <div class="char-name">${char.name}</div>
        </div>

        <${List} inset=${false}>
          <${ListItem} title="人设、情境、开场白、说话示例" arrow multiline
            subtitle=${char.persona ? String(char.persona).slice(0, 34) : '还没写。这些决定她是谁，去「联系」里写'}
            left=${html`<${Icon} name="user" size=${18}/>`}
            onClick=${() => phone.intent.open('contact', { route: `/char/${id}` })}/>
        <//>

        <${Field} label="音色 ID"
          desc="语音合成用哪个音色。接口和模型在「设置」的「语音」里配，这里只填这个角色用哪个音色。">
          <${Input} value=${char.voiceId || ''} placeholder="例如 male-qn-qingse"
            onInput=${v => patch({ voiceId: v })}/>
        <//>

        <${Field} label=${`语速　${(char.voiceSpeed ?? 1).toFixed(2)}`} desc="1 是正常速度">
          <input type="range" min="0.5" max="2" step="0.05" value=${char.voiceSpeed ?? 1}
            onInput=${e => patch({ voiceSpeed: parseFloat(e.target.value) })}/>
        <//>
      </div>

      <${List} title="她可以主动发什么">
        <${ListItem} title="发语音" multiline
          subtitle=${char.voiceId ? '模型觉得合适时会用说的代替打字' : '还没填音色 ID，填了才会生效'}
          right=${html`<${Switch} checked=${char.canSendVoice !== false}
            onChange=${v => patch({ canSendVoice: v })}/>`}/>
        <${ListItem} title="发图片" subtitle="模型觉得合适时会描述一个画面，交给生图接口"
          multiline
          right=${html`<${Switch} checked=${char.canSendImage !== false}
            onChange=${v => patch({ canSendImage: v })}/>`}/>
      <//>

      <${List} title="关联世界书">
        ${db.lorebooks.all().map(b => html`
          <${ListItem} key=${b.id} title=${b.name}
            subtitle=${b.global ? '全局生效，不需要关联' : `${(b.entries || []).length} 个条目`}
            right=${html`<${Switch} checked=${b.global || (char.lorebookIds || []).includes(b.id)}
              onChange=${() => !b.global && toggleBook(b.id)}/>`}/>`)}
        ${!db.lorebooks.count() ? html`<${ListItem} title="还没有世界书"/>` : null}
      <//>
      <div class="pad-b"></div>
    <//>`;
}

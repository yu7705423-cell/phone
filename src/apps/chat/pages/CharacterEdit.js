import { html, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Field, Input, Textarea, Avatar, Button, List, ListItem,
         Switch, Icon, toast } from '../../../ui/index.js';
import { AVATAR_MAX } from '../../../system/db/images.js';

const { db, nav } = phone;

export function CharacterEdit({ id }) {
  useStore(db.characters.store);
  useStore(db.lorebooks.store);
  const char = db.characters.get(id);
  const avatar = useImage(char?.avatar);
  const fileRef = useRef(null);

  if (!char) return html`<${Page} title="编辑" onBack=${nav.pop}/>`;
  const patch = p => db.characters.update(id, p);

  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const imgId = await db.images.put(file, AVATAR_MAX);
      if (char.avatar) db.images.remove(char.avatar);
      patch({ avatar: imgId });
    } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };

  const toggleBook = bid => {
    const cur = char.lorebookIds || [];
    patch({ lorebookIds: cur.includes(bid) ? cur.filter(x => x !== bid) : [...cur, bid] });
  };

  return html`
    <${Page} title="编辑角色卡" onBack=${nav.pop}>
      <div class="pad">
        <div class="avatar-picker">
          <${Avatar} src=${avatar} name=${char.name} size=${76}/>
          <${Button} size="sm" variant="ghost" icon="upload"
            onClick=${() => fileRef.current?.click()}>更换头像<//>
          <input type="file" accept="image/*" ref=${fileRef} onChange=${pick} style="display:none"/>
        </div>

        <${Field} label="名字">
          <${Input} value=${char.name} onInput=${v => patch({ name: v })}/>
        <//>

        <${Field} label="个性签名" desc="显示在主页和联系人列表">
          <${Input} value=${char.signature || ''} onInput=${v => patch({ signature: v })}/>
        <//>

        <${Field} label="人设" desc="进入 prompt 的主体。写这个人是谁、什么性格、怎么说话。">
          <${Textarea} rows=${7} value=${char.persona}
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
          <${Textarea} rows=${5} value=${char.exampleDialogue || ''}
            onInput=${v => patch({ exampleDialogue: v })}/>
        <//>
      </div>

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

import { html, useRef } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Page, Field, Input, Textarea, Avatar, Button, toast } from '../../ui/index.js';
import { AVATAR_MAX } from '../../system/db/images.js';

const { db, nav } = phone;

export function PersonaPage() {
  const me = useStore(db.persona.store);
  const avatar = useImage(me.avatar);
  const fileRef = useRef(null);

  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const id = await db.images.put(file, AVATAR_MAX);
      if (me.avatar) db.images.remove(me.avatar);
      db.persona.set({ avatar: id });
    } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };

  return html`
    <${Page} title="我的人设" onBack=${nav.pop}>
      <div class="pad">
        <div class="avatar-picker">
          <${Avatar} src=${avatar} name=${me.name} size=${76}/>
          <${Button} size="sm" variant="ghost" icon="upload"
            onClick=${() => fileRef.current?.click()}>更换头像<//>
          <input type="file" accept="image/*" ref=${fileRef} onChange=${pick} style="display:none"/>
        </div>

        <${Field} label="昵称">
          <${Input} value=${me.name} placeholder="角色会这样称呼你"
            onInput=${v => db.persona.set({ name: v })}/>
        <//>

        <${Field} label="个性签名">
          <${Input} value=${me.signature} placeholder="显示在主页上"
            onInput=${v => db.persona.set({ signature: v })}/>
        <//>

        <${Field} label="人设描述"
          desc="这段会作为「对方是谁」注入到 prompt。写你希望角色怎么认识你。">
          <${Textarea} rows=${6} value=${me.description}
            placeholder="例如：大学生，学设计，话不多但想到什么说什么，讨厌被说教。"
            onInput=${v => db.persona.set({ description: v })}/>
        <//>
      </div>
    <//>`;
}

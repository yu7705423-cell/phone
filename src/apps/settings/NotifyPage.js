import { html, useState, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Button, Switch, Icon, toast } from '../../ui/index.js';

const { db, nav, sound, notify } = phone;   // notify 就是 notify()，见 sdk/index.js

export function NotifyPage() {
  const s = useStore(db.settings.store);
  const cfg = sound.config();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const set = patch => db.settings.set({ notify: { ...(s.notify || {}), ...patch } });

  const pick = id => { set({ sound: id, soundFileId: null }); sound.unlock(); sound.ring({ ...cfg, sound: id, soundFileId: null }); };

  const upload = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const old = cfg.soundFileId;
      const id = await db.files.put(file, { name: file.name, type: file.type });
      set({ soundFileId: id });
      if (old) db.files.remove(old);
      sound.unlock();
      sound.ring({ ...cfg, soundFileId: id });
      toast('换好了', 'ok');
    } catch (err) {
      toast('用不了这个文件：' + err.message, 'error', 4000);
    } finally { setBusy(false); }
  };

  // 真的走一遍 notify()，横幅、声音、锁屏列表三处一起验，不是单独弹个假的
  const test = () => {
    sound.unlock();
    const chat = db.chats.all()[0];
    const char = chat ? db.characters.get((chat.characterIds || [])[0]) : null;
    notify({
      title: char?.name || '林晓',
      body: char ? '在干嘛' : '这是一条测试通知，点一下会跳进聊天',
      icon: 'message', appId: 'chat', avatar: char?.avatar,
      payload: chat ? { route: `/chat/${chat.id}` } : null,
    });
    nav.home();
  };

  return html`
    <${Page} title="通知" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title="横幅" multiline
          subtitle="来消息时从顶上掉下来一条，点开进会话，往上一推收起"
          right=${html`<${Switch} checked=${cfg.banner}
            onChange=${v => set({ banner: v })}/>`}/>
      <//>

      <${List} title="提示音">
        ${sound.PRESETS.map(p => html`
          <${ListItem} key=${p.id} title=${p.label}
            onClick=${() => pick(p.id)}
            right=${!cfg.soundFileId && cfg.sound === p.id
              ? html`<${Icon} name="check" size=${17}/>` : null}/>`)}
        <${ListItem} title="自己传一个" multiline
          subtitle=${cfg.soundFileId ? '正在用自己传的那个' : '任意音频文件，存在本地'}
          right=${cfg.soundFileId ? html`<${Icon} name="check" size=${17}/>` : null}
          onClick=${() => fileRef.current?.click()}/>
      <//>
      <input type="file" accept="audio/*" ref=${fileRef} onChange=${upload} style="display:none"/>

      <div class="pad-x">
        <${Field} label=${`音量　${Math.round(cfg.volume * 100)}%`}>
          <input type="range" min="0" max="1" step="0.05" value=${cfg.volume}
            onInput=${e => set({ volume: parseFloat(e.target.value) })}/>
        <//>
      </div>

      <div class="pad">
        <${Button} full disabled=${busy} onClick=${test}>试一条通知<//>
      </div>

      <div class="settings-foot">
        点上面那个按钮会回到主界面，横幅从顶上掉下来，同时响一声。<br/>
        手机上第一次要先碰一下屏幕，浏览器才允许出声。<br/>
        页面关着的时候不会有通知，纯前端跑不了后台。
      </div>
    <//>`;
}

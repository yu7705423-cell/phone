import { html, useState, useRef, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Switch, Icon, toast, confirm } from '../../ui/index.js';

const { db, nav, sound, notify, push } = phone;   // notify 就是 notify()，见 sdk/index.js

const PERM_TEXT = {
  granted: '已授权',
  denied: '被拒了。iOS 要到「设置 - 通知 - 小手机」里重新打开',
  default: '还没问过',
  unsupported: '这个浏览器不支持',
};

export function NotifyPage() {
  const s = useStore(db.settings.store);
  const cfg = sound.config();
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState(push.permission());
  const [sub, setSub] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => { push.subscription().then(setSub).catch(() => {}); }, [perm]);

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

  const askPerm = async () => {
    setBusy(true);
    try {
      await push.ask();
      setPerm(push.permission());
      set({ system: true });
      toast('授权好了，试一条系统通知看看', 'ok');
    } catch (e) {
      setPerm(push.permission());
      toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); }
  };

  // 真的走 SW 的 showNotification，不是应用内横幅
  const testSystem = async () => {
    setBusy(true);
    try {
      if (push.permission() !== 'granted') await push.ask();
      setPerm(push.permission());
      const chat = db.chats.all()[0];
      const char = chat ? db.characters.get((chat.characterIds || [])[0]) : null;
      await push.show({
        title: char?.name || '林晓',
        body: '这是一条真的系统通知，点一下会跳进聊天',
        appId: 'chat', route: chat ? `/chat/${chat.id}` : '/',
      });
      toast('发出去了。退到桌面或下拉通知中心看看', 'ok', 5000);
    } catch (e) {
      toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); }
  };

  const doSubscribe = async () => {
    setBusy(true);
    try {
      const got = await push.subscribe();
      setSub(got);
      toast('订阅成功', 'ok');
    } catch (e) {
      toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); }
  };

  const copySub = async () => {
    if (!sub) return;
    const text = JSON.stringify(sub.toJSON ? sub.toJSON() : sub, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast('订阅已复制，粘给你的服务器', 'ok', 4000);
    } catch {
      toast('复制不了，从控制台拿：' + text.slice(0, 40) + '...', 'plain', 5000);
    }
  };

  const drop = async () => {
    if (!await confirm({ title: '退订', message: '退订之后服务器就推不动这台设备了。', okText: '退订', danger: true })) return;
    await push.unsubscribe();
    setSub(null);
    toast('退订了');
  };

  const pcfg = push.pushConfig();

  return html`
    <${Page} title="通知" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title="横幅" multiline
          subtitle="来消息时从顶上掉下来一条，点开进会话，往上一推收起"
          right=${html`<${Switch} checked=${cfg.banner}
            onChange=${v => set({ banner: v })}/>`}/>
      <//>

      <${List} title="系统通知">
        <${ListItem} title="交给系统弹" multiline
          subtitle=${perm === 'granted'
            ? '页面不在前台时改由系统通知中心弹，锁屏上也看得到'
            : `需要先授权。当前：${PERM_TEXT[perm] || perm}`}
          right=${perm === 'granted'
            ? html`<${Switch} checked=${(s.notify || {}).system === true}
                onChange=${v => set({ system: v })}/>`
            : html`<${Button} size="sm" variant="ghost" disabled=${busy}
                onClick=${askPerm}>去授权<//>`}/>
        <${ListItem} title="试一条系统通知" arrow multiline
          subtitle="走 Service Worker，和应用内横幅是两条路"
          left=${html`<${Icon} name="bell" size=${18}/>`}
          onClick=${busy ? null : testSystem}/>
      <//>
      ${!push.standalone() ? html`
        <div class="settings-foot">
          现在是在浏览器标签页里。iOS 只给「添加到主屏幕」之后的 PWA 发系统通知，
          在标签页里授权了也不会响。
        </div>` : null}

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
        <${Button} full disabled=${busy} onClick=${test}>试一条应用内横幅<//>
      </div>

      <${List} title="Web Push">
        <${ListItem} title="订阅状态" multiline
          subtitle=${sub ? '已订阅。把订阅复制给你的服务器就能推了' : '没订阅'}
          right=${sub ? html`<${Icon} name="check" size=${17}/>` : null}/>
      <//>
      <div class="pad-x">
        <${Field} label="VAPID 公钥"
          desc="服务器生成的那一对里的公钥。没有服务器就填不了，也订阅不了">
          <${Input} value=${pcfg.vapidPublicKey}
            onInput=${v => db.settings.set({ push: { ...(s.push || {}), vapidPublicKey: v.trim() } })}
            placeholder="BEl62i..."/>
        <//>
        <${Field} label="订阅上报地址（可选）"
          desc="填了就在订阅成功后 POST 给它。不填就自己复制粘过去">
          <${Input} value=${pcfg.reportUrl}
            onInput=${v => db.settings.set({ push: { ...(s.push || {}), reportUrl: v.trim() } })}
            placeholder="https://.../subscribe"/>
        <//>
      </div>
      <div class="pad batch-acts">
        <${Button} size="sm" disabled=${busy || !pcfg.vapidPublicKey}
          onClick=${doSubscribe}>${sub ? '重新订阅' : '订阅'}<//>
        <${Button} size="sm" variant="ghost" disabled=${!sub} onClick=${copySub}>复制订阅<//>
        <${Button} size="sm" variant="ghost" disabled=${!sub} onClick=${drop}>退订<//>
      </div>

      <div class="settings-foot">
        「试一条应用内横幅」会回到主界面，横幅从顶上掉下来，同时响一声。<br/>
        手机上第一次要先碰一下屏幕，浏览器才允许出声。<br/><br/>
        <b>app 完全关掉之后要收到通知，只能靠 Web Push，而 Web Push 必须有一台
        服务器替你发。</b>iOS 会在 PWA 退到后台几秒后冻结 JS，这边的定时器就停了，
        所以「订阅」以下这些是给服务器用的，客户端这半边已经接好了。
      </div>
    <//>`;
}

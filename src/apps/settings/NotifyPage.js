import { html, useState, useRef, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, NumberInput, Button, Switch, Icon, toast, confirm } from '../../ui/index.js';

const { db, nav, sound, notify, push, bgpush } = phone;   // notify 就是 notify()，见 sdk/index.js

const PERM_TEXT = {
  granted: '已授权',
  denied: '被拒了。iOS 要到「设置 - 通知 - Eira」里重新打开',
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
      toast('已更换', 'ok');
    } catch (err) {
      toast('该文件无法使用：' + err.message, 'error', 4000);
    } finally { setBusy(false); }
  };

  // 真的走一遍 notify()，横幅、声音、锁屏列表三处一起验，不是单独弹个假的
  const test = () => {
    sound.unlock();
    const chat = db.chats.all()[0];
    const char = chat ? db.characters.get((chat.characterIds || [])[0]) : null;
    notify({
      title: char?.name || '林晓',
      body: char ? '这是一条测试通知' : '这是一条测试通知，点击后会进入聊天',
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
      toast('已授权，可发送一条系统通知进行测试', 'ok');
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
      toast('已发送。返回桌面或下拉通知中心查看', 'ok', 5000);
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
      toast('订阅信息已复制，请粘贴至服务端', 'ok', 4000);
    } catch {
      toast('复制失败，请从控制台获取：' + text.slice(0, 40) + '...', 'plain', 5000);
    }
  };

  const drop = async () => {
    if (!await confirm({ title: '退订', message: '退订后服务端将无法向本设备推送。', okText: '退订', danger: true })) return;
    await push.unsubscribe();
    setSub(null);
    toast('已退订');
  };

  const pcfg = push.pushConfig();

  // 后台消息（system/bgpush.js）。打开要问通知权限，所以必须在这一下点击里做
  const bg = s.bgPush || {};
  const toggleBg = async v => {
    setBusy(true);
    try {
      if (v) {
        await bgpush.enable();
        setPerm(push.permission());
        push.subscription().then(setSub).catch(() => {});
        toast('后台消息已开启', 'ok');
      } else {
        await bgpush.disable();
        toast('后台消息已关闭');
      }
    } catch (e) {
      setPerm(push.permission());
      toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); }
  };
  const testBg = async () => {
    setBusy(true);
    try { await bgpush.test(); toast('推送服务器已发出一条测试通知', 'ok', 4000); }
    catch (e) { toast(String(e.message || e), 'error', 6000); }
    finally { setBusy(false); }
  };

  return html`
    <${Page} title="通知" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title="横幅" multiline
          subtitle="新消息到达时从顶部下滑显示，点击进入会话，上滑收起。"
          right=${html`<${Switch} checked=${cfg.banner}
            onChange=${v => set({ banner: v })}/>`}/>
        <${ListItem} title="显示消息内容" multiline
          subtitle=${`在横幅、锁屏列表与系统通知上显示消息正文。`
            + `关闭后一律显示「收到一条新消息」，发送者名称仍会显示。`
            + `此项只影响通知的呈现，不影响消息本身。`}
          right=${html`<${Switch} checked=${cfg.preview !== false}
            onChange=${v => set({ preview: v })}/>`}/>
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
          subtitle=${push.native()
            ? '由外壳发送，与应用内横幅是两套独立机制。'
            : '经由 Service Worker 发送，与应用内横幅是两套独立机制。'}
          left=${html`<${Icon} name="bell" size=${18}/>`}
          onClick=${busy ? null : testSystem}/>
      <//>
      ${push.native() ? html`
        <div class="settings-foot">
          当前为已安装的应用，系统通知由外壳发送，不经过浏览器，
          也不需要签名时附带任何额外权限。
        </div>` : null}
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
          subtitle=${cfg.soundFileId ? '正在使用自行上传的音频' : '支持任意音频文件，保存在本地'}
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

      ${bgpush.available() ? html`
        <${List} title="后台消息">
          <${ListItem} title="后台消息" multiline
            subtitle=${`开启后，离开应用期间，已开启「主动找你」的角色由推送服务器按原定时间代为发出消息，`
              + (bgpush.canNotify()
                ? '并以系统通知送达；回到应用时，这些消息写入对应的会话。'
                : '回到应用时，这些消息写入对应的会话，时间为当时发出的时刻。当前环境不支持推送通知，离开期间不会弹出通知。')
              + '接口密钥与该段对话的上下文会加密后交给推送服务器保存，到时间后用于调用模型。关闭后，服务器上的任务与本机登记一并删除。'}
            right=${html`<${Switch} checked=${bg.on === true} disabled=${busy} onChange=${toggleBg}/>`}/>
        <//>
        ${bg.on ? html`
          <div class="pad-x">
            <${Field} label="每个角色离开期间最多发几次"
              desc="每一次都是一次模型调用，费用与应用开着时角色主动发消息相同。未读条数达到「用量与上限」中设定的上限后不再发送。">
              <${NumberInput} value=${bg.perChar || bgpush.PER_CHAR} min=${1} unit="次"
                onChange=${v => db.settings.set({ bgPush: { ...bg, perChar: Math.max(1, Number(v) || bgpush.PER_CHAR) } })}/>
            <//>
          </div>
          ${bgpush.canNotify() ? html`
            <div class="pad batch-acts">
              <${Button} size="sm" disabled=${busy} onClick=${testBg}>发一条测试推送<//>
            </div>` : null}` : null}
        <div class="settings-foot">
          应用开着时，角色的主动消息仍由本机发出，推送服务器不重复发送。
          离开期间弹出通知需要浏览器或添加到主屏幕的网页；安装版应用（apk、ipa）不弹通知，消息在打开应用时出现。
        </div>` : null}

      ${push.native() ? html`
        <div class="settings-foot">
          Web Push 需要浏览器的 Push API，已安装的应用里没有这一项，因此不显示。
          应用被系统完全结束之后的通知仍然需要一台服务器，那一条这里做不到。
        </div>` : bgpush.available() ? null : html`
      <${List} title="Web Push">
        <${ListItem} title="订阅状态" multiline
          subtitle=${sub ? '已订阅。将订阅信息提供给服务端即可推送' : '未订阅'}
          right=${sub ? html`<${Icon} name="check" size=${17}/>` : null}/>
      <//>
      <div class="pad-x">
        <${Field} label="VAPID 公钥"
          desc="服务端生成的 VAPID 密钥对中的公钥。没有服务端则无法填写，也无法订阅。">
          <${Input} value=${pcfg.vapidPublicKey}
            onInput=${v => db.settings.set({ push: { ...(s.push || {}), vapidPublicKey: v.trim() } })}
            placeholder="BEl62i..."/>
        <//>
        <${Field} label="订阅上报地址（可选）"
          desc="填写后将在订阅成功时自动 POST 至该地址。留空则需手动复制订阅信息。">
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
      </div>`}

      <div class="settings-foot">
        「试一条应用内横幅」会回到主界面，横幅从顶上掉下来，同时响一声。<br/>
        手机上第一次要先碰一下屏幕，浏览器才允许出声。<br/><br/>
        <b>app 完全关掉之后要收到通知，只能靠 Web Push，而 Web Push 必须有一台
        服务器替你发。</b>iOS 会在 PWA 退到后台几秒后冻结 JS，这边的定时器就停了，
        所以「订阅」以下这些是给服务器用的，客户端这半边已经接好了。
      </div>
    <//>`;
}

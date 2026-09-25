import { html, useState, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, NumberInput, Segmented, Button, Switch, Icon, toast } from '../../ui/index.js';

const { db, nav, sound, notify, push, bgpush } = phone;   // notify 就是 notify()，见 sdk/index.js

const CHANNEL_ITEMS = [
  { value: '', label: '不使用' },
  { value: 'bark', label: 'Bark' },
  { value: 'pushplus', label: 'PushPlus' },
];

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

  // 后台消息（system/bgpush.js）。打开要问通知权限，所以必须在这一下点击里做
  const bg = s.bgPush || {};
  const toggleBg = async v => {
    setBusy(true);
    try {
      if (v) {
        await bgpush.enable();
        setPerm(push.permission());
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
  const ch = bgpush.channelOf();
  const testCh = async () => {
    setBusy(true);
    try { await bgpush.testChannel(); toast('已通过通知通道发出一条测试通知', 'ok', 4000); }
    catch (e) { toast(String(e.message || e), 'error', 6000); }
    finally { setBusy(false); }
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

      <${List} title="后台消息"/>
      <div class="pad-x">
        <${Field} label="推送服务器地址"
          desc=${bg.on
            ? '关闭后台消息后才能更换。'
            : '在自己的 Cloudflare 与 Supabase 账号上按教程部署推送服务器后，填入它的地址。模型调用、通知与数据都在自己的账号上，不经过他人。'}>
          <${Input} value=${bg.server || ''} placeholder=${bgpush.siteServer() || 'https://push.example.com'} disabled=${bg.on === true}
            onInput=${v => db.settings.set({ bgPush: { ...bg, server: v.trim().replace(/\/+$/, '') } })}/>
        <//>
      </div>
      <${List}>
        <${ListItem} title="部署教程" arrow onClick=${() => nav.push('/push-guide')}/>
      <//>
      <${List}>
          <${ListItem} title="后台消息" multiline
            subtitle=${`此功能处于测试阶段，请谨慎使用。开启后，离开应用期间，已开启「主动找你」的角色由推送服务器按原定时间代为发出消息，`
              + (bgpush.canNotify()
                ? '并以系统通知送达；回到应用时，这些消息写入对应的会话。'
                : '回到应用时，这些消息写入对应的会话，时间为当时发出的时刻。当前环境不支持推送通知，离开期间不会弹出通知。')
              + '接口密钥与该段对话的上下文会加密后交给推送服务器保存，到时间后用于调用模型。关闭后，服务器上的任务与本机登记一并删除。'}
            right=${html`<${Switch} checked=${bg.on === true} disabled=${busy || !bgpush.serverOk()} onChange=${toggleBg}/>`}/>
        <//>
        ${bg.on && bgpush.problem() ? html`<div class="settings-foot is-error">${bgpush.problem()}</div>` : null}
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
            </div>` : null}
          <div class="pad-x">
            <${Field} label="通知通道"
              desc="借其他应用送达离开期间的通知，适用于没有推送通知的安装版应用，也可与推送通知同时使用。Bark 仅限 iPhone，点击通知打开对应会话；PushPlus 经微信公众号送达，任何手机可用。消息内容会经过所选服务的服务器。">
              <${Segmented} value=${ch.kind} items=${CHANNEL_ITEMS} onChange=${v => bgpush.setChannel({ kind: v })}/>
            <//>
            ${ch.kind === 'bark' ? html`
              <${Field} label="Bark 推送地址" desc="在 Bark 首页复制的地址，形如 https://api.day.app/ 加一串设备码。">
                <${Input} value=${ch.url} placeholder="https://api.day.app/..."
                  onInput=${v => bgpush.setChannel({ url: v.trim() })}/>
              <//>
              <${Field} label="加密 Key（可选）"
                desc="在 Bark 的「推送加密」中选择 AES 与 CBC 模式，填入与此处相同的 Key 与 IV。Key 为 16、24 或 32 位，IV 为 16 位。填写后，Bark 的服务器无法读取消息内容；填写有误时，通知只显示「发来一条消息」。">
                <${Input} value=${ch.key} placeholder="16、24 或 32 位" onInput=${v => bgpush.setChannel({ key: v.trim() })}/>
              <//>
              <${Field} label="加密 IV（可选）">
                <${Input} value=${ch.iv} placeholder="16 位" onInput=${v => bgpush.setChannel({ iv: v.trim() })}/>
              <//>` : null}
            ${ch.kind === 'pushplus' ? html`
              <${Field} label="PushPlus token" desc="在 pushplus.plus 用微信登录后，于「一对一消息」中复制。">
                <${Input} value=${ch.token} placeholder="token" onInput=${v => bgpush.setChannel({ token: v.trim() })}/>
              <//>` : null}
          </div>
          ${ch.kind ? html`
            <${List}>
              <${ListItem} title="通知中不显示消息内容" multiline
                subtitle="开启后，通知只显示角色名与「发来一条消息」，消息内容不经过通知服务。"
                right=${html`<${Switch} checked=${ch.hide === true} onChange=${v => bgpush.setChannel({ hide: v })}/>`}/>
            <//>
            <div class="pad batch-acts">
              <${Button} size="sm" disabled=${busy} onClick=${testCh}>测试通知通道<//>
            </div>` : null}` : null}
        <div class="settings-foot">
          应用开着时，角色的主动消息仍由本机发出，推送服务器不重复发送。
          离开期间的推送通知需要浏览器或添加到主屏幕的网页；安装版应用（apk、ipa）可改用上方的通知通道，未设置时消息在打开应用时出现。
        </div>

      <div class="settings-foot">
        「试一条应用内横幅」会回到主界面，横幅从顶上掉下来，同时响一声。<br/>
        手机上第一次要先碰一下屏幕，浏览器才允许出声。<br/><br/>
        应用完全关闭之后，角色的主动消息需要由推送服务器代为发出，见上方「后台消息」。
      </div>
    <//>`;
}

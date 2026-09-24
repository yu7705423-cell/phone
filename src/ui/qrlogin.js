import { html, useState, useEffect, useRef } from '../lib.js';
import { Button, Field, Textarea, Input } from './basic.js';
import { toast } from './overlay.js';

// 扫码登录。**不认识任何具体服务** —— 要用的三个动作由调用方传进来：
//
//   service.qrStart()            取一张二维码，给回 { key, img }
//   service.qrCheck(key)         问一下扫了没，给回 { code, cookie }
//   service.saveLogin(cookie, owner)  成了就把凭据存到该存的地方
//
// 这么写是因为登这个号的地方有两处（设置里登自己的，角色卡上登角色的），
// 而这两处分属不同的 app，不能互相 import（规约第 8 条）。
// 组件放进 ui 层，服务当参数传，两边各自把自己的 owner 递进来。
// 三秒问一次。公共实例多半有限流，问太勤会被挡回来。
const POLL_MS = 3000;

// 网易云那套状态码：800 过期 · 801 等待扫码 · 802 已扫待确认 · 803 成功
const EXPIRED = 800, SCANNED = 802, OK = 803;

export function QrLogin({ service, owner = '', onDone, hint = '请使用对应的 App 扫描二维码' }) {
  const [phase, setPhase] = useState('idle');   // idle | loading | waiting | scanned | error
  const [img, setImg] = useState('');
  const [msg, setMsg] = useState('');
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const start = async () => {
    clearInterval(timer.current);
    setPhase('loading'); setImg(''); setMsg('');
    try {
      const { key, img: qr } = await service.qrStart();
      setImg(qr); setPhase('waiting');
      timer.current = setInterval(async () => {
        try {
          const r = await service.qrCheck(key);
          if (r.code === SCANNED) setPhase('scanned');
          if (r.code === EXPIRED) {
            clearInterval(timer.current);
            setPhase('error'); setMsg('二维码已过期，请重新获取'); setImg('');
          }
          if (r.code === OK) {
            clearInterval(timer.current);
            const who = await service.saveLogin(r.cookie, owner);
            setPhase('idle'); setImg('');
            toast(`已登录：${who?.nickname || '账号'}`, 'ok');
            onDone && onDone(who);
          }
        } catch (err) {
          clearInterval(timer.current);
          setPhase('error'); setMsg(String(err.message || err));
        }
      }, POLL_MS);
    } catch (err) {
      setPhase('error'); setMsg(String(err.message || err));
    }
  };

  return html`
    <div class="qr-box">
      ${img ? html`<img class="qr-img" src=${img} alt="登录二维码"/>` : null}
      <div class="qr-note">
        ${phase === 'waiting' ? hint
          : phase === 'scanned' ? '已扫描，请在手机上确认'
          : phase === 'loading' ? '正在获取二维码'
          : phase === 'error' ? msg
          : '点击下方按钮获取二维码'}
      </div>
      <${Button} size="sm" variant="ghost" icon="refresh" onClick=${start}>
        ${img ? '重新获取' : '获取二维码'}<//>
    </div>`;
}


/**
 * 手工粘贴 cookie。公共实例跑在机房里，扫码那三个接口会被网易云风控整条
 * 拦掉（code -462），这时把浏览器里已登录的 MUSIC_U 拿过来还走得通。
 * 和扫码共用 service 约定，多一个 saveCookie(cookie, owner)。
 */
export function CookiePaste({ service, owner = '', onDone,
  hint = '在浏览器中登录网易云音乐后，从开发者工具的存储中复制 MUSIC_U 的值' }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const who = await service.saveCookie(text, owner);
      setText('');
      toast(who?.nickname ? `已保存：${who.nickname}` : '已保存。未能读取账号信息', 'ok');
      onDone && onDone(who);
    } catch (err) {
      toast(String(err.message || err), 'error', 4000);
    } finally { setBusy(false); }
  };

  return html`
    <${Field} label="或者直接填写 cookie" desc=${hint}>
      <${Textarea} rows=${3} value=${text} placeholder="MUSIC_U=..."
        onInput=${v => setText(v)}/>
    <//>
    <${Button} size="sm" variant="ghost" icon="check"
      onClick=${() => !busy && text.trim() && save()}>
      ${busy ? '保存中' : '保存'}<//>`;
}

/**
 * 短信验证码登录。扫码之外的另一条路，和扫码同一个信任级别：交出去的只是一次性的码。
 * **不做密码登录**：密码哪怕先转成 MD5，接口一方拿到也照样能登，泄露了还收不回来。
 * 和扫码共用 service 约定，多两个：
 *
 *   service.smsSend(phone, ctcode)
 *   service.smsLogin(phone, captcha, ctcode)   给回 cookie
 *
 * 登成了照样走 service.saveLogin(cookie, owner)，cookie 不经人手。
 */
const WAIT = 60;   // 验证码重发要等多少秒。网易云自己也限，发得太勤会被挡

export function SmsLogin({ service, owner = '', onDone }) {
  const [ct, setCt] = useState('86');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const tick = useRef(null);

  useEffect(() => () => clearInterval(tick.current), []);

  const run = async fn => {
    if (busy) return;
    setBusy(true); setMsg('');
    try { await fn(); } catch (err) { setMsg(String(err.message || err)); }
    finally { setBusy(false); }
  };
  const send = () => run(async () => {
    await service.smsSend(phone, ct);
    setLeft(WAIT);
    clearInterval(tick.current);
    tick.current = setInterval(() => setLeft(n => {
      if (n <= 1) { clearInterval(tick.current); return 0; }
      return n - 1;
    }), 1000);
    toast('验证码已发送', 'ok');
  });
  const login = () => run(async () => {
    const cookie = await service.smsLogin(phone, code, ct);
    const who = await service.saveLogin(cookie, owner);
    setCode('');
    toast(`已登录：${who?.nickname || '账号'}`, 'ok');
    onDone && onDone(who);
  });

  return html`
    <div class="acct-login">
      <div class="acct-row">
        <${Input} class="acct-ct" value=${ct} inputmode="numeric" aria-label="国家区号"
          onInput=${v => setCt(v.replace(/[^\d]/g, '').slice(0, 4))}/>
        <${Input} value=${phone} inputmode="tel" placeholder="手机号" onInput=${setPhone}/>
      </div>
      <div class="acct-row">
        <${Input} value=${code} inputmode="numeric" placeholder="验证码" onInput=${setCode}/>
        <${Button} size="sm" variant="ghost" disabled=${busy || left > 0 || !phone.trim()} onClick=${send}>
          ${left > 0 ? `${left} 秒后重发` : '发送验证码'}<//>
      </div>
      <${Button} full disabled=${busy || !phone.trim() || !code.trim()} onClick=${login}>
        ${busy ? '正在登录' : '登录'}<//>
      ${msg ? html`<div class="acct-note is-error">${msg}</div>` : null}
    </div>`;
}


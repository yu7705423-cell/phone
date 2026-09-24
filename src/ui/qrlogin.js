import { html, useState, useEffect, useRef } from '../lib.js';
import { Button, Field, Textarea, Input, Segmented } from './basic.js';
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
 * 账号登录：短信验证码，或者手机号 / 邮箱加密码。给没有手机扫码的人用。
 * 和扫码共用 service 约定，多三个：
 *
 *   service.smsSend(phone, ctcode)
 *   service.smsLogin(phone, captcha, ctcode)       给回 cookie
 *   service.passwordLogin(account, password, ctcode) 给回 cookie
 *
 * 登成了照样走 service.saveLogin(cookie, owner)，cookie 不经人手。
 */
const WAIT = 60;   // 验证码重发要等多少秒。网易云自己也限，发得太勤会被挡

export function AccountLogin({ service, owner = '', onDone }) {
  const [mode, setMode] = useState('sms');
  const [ct, setCt] = useState('86');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
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
  const done = async cookie => {
    const who = await service.saveLogin(cookie, owner);
    setCode(''); setPassword('');
    toast(`已登录：${who?.nickname || '账号'}`, 'ok');
    onDone && onDone(who);
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

  return html`
    <div class="acct-login">
      <${Segmented} value=${mode} onChange=${v => { setMode(v); setMsg(''); }}
        items=${[{ value: 'sms', label: '短信验证码' }, { value: 'pwd', label: '密码' }]}/>
      ${mode === 'sms' ? html`
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
        <${Button} full disabled=${busy || !phone.trim() || !code.trim()}
          onClick=${() => run(async () => done(await service.smsLogin(phone, code, ct)))}>
          ${busy ? '正在登录' : '登录'}<//>
        <div class="acct-note">
          验证码发到手机号上，普通手机收短信即可，不需要安装网易云。
        </div>`
      : html`
        <div class="acct-row">
          <${Input} class="acct-ct" value=${ct} inputmode="numeric" aria-label="国家区号"
            onInput=${v => setCt(v.replace(/[^\d]/g, '').slice(0, 4))}/>
          <${Input} value=${account} placeholder="手机号或邮箱" onInput=${setAccount}/>
        </div>
        <${Input} type="password" value=${password} placeholder="密码" onInput=${setPassword}/>
        <${Button} full disabled=${busy || !account.trim() || !password}
          onClick=${() => run(async () => done(await service.passwordLogin(account, password, ct)))}>
          ${busy ? '正在登录' : '登录'}<//>
        <div class="acct-note">
          密码会经过上方填写的接口地址发往网易云。发出前先转换为 MD5，原文不离开本设备，也不写入网址，
          但接口一方仍可凭它登录该账号。请仅在自己部署的接口上使用。密码本身不保存。
          网易云常对密码登录要求行为验证，登录不上时请改用短信验证码。
        </div>`}
      ${msg ? html`<div class="acct-note is-error">${msg}</div>` : null}
    </div>`;
}


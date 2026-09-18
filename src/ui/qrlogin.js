import { html, useState, useEffect, useRef } from '../lib.js';
import { Button, Field, Textarea } from './basic.js';
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
 * 手工粘贴 cookie。扫码那条路走不通时的另一个入口。
 *
 * 网易云按请求来源的 IP 做风控，公共实例跑在机房里，扫码的三个接口会被
 * 整条拦掉（code -462）。这种时候把浏览器里已登录的 MUSIC_U 拿过来，
 * 请求就从匿名变成了登录，那套尺度松得多。
 *
 * 和扫码共用同一个 service 约定，多用一个动作：
 *   service.saveCookie(cookie, owner)   存起来，账号信息问不到也存
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

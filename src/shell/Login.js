import { html, useState } from '../lib.js';
import { Input, Button } from '../ui/basic.js';
import { login, changePassword } from '../system/auth.js';

// 登录页。开机时账号服务说「要登录」才出现（见 system/auth.js 的 gate），
// 它在应用本体之前画，这时数据库、各个 app 都还没起来，所以只用最基础的几样零件。
//
// 没有「注册」：账号由运营方添加。忘记密码找运营方重置（回到初始密码）。
// 用初始密码登录进来的，接着给一步「修改初始密码」，可以跳过 —— 之后在「设置 - 登录账号」里也能改。
export function Login({ note = '', offline = false, onDone }) {
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [initial, setInitial] = useState(null);     // 用初始密码登录成功后：那个初始密码
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');

  const submit = async e => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const r = await login(name, pw);
      if (r.initial) { setInitial(pw); setBusy(false); return; }
      onDone();
    } catch (x) {
      setErr(String(x.message || x));
      setBusy(false);
    }
  };

  const change = async e => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true); setErr('');
    try {
      await changePassword(initial, next, again);
      onDone();
    } catch (x) {
      setErr(String(x.message || x));
      setBusy(false);
    }
  };

  if (initial !== null) {
    return html`
      <form class="login" onSubmit=${change}>
        <img class="login-icon" src="icon-192.png" alt=""/>
        <div class="login-title">修改初始密码</div>
        <div class="login-note">当前使用的是统一发放的初始密码，其他知道账号名的人也能登录。建议现在改成只有自己知道的密码。</div>
        <div class="login-fields">
          <${Input} type="password" value=${next} onInput=${setNext} placeholder="新密码（至少 6 位）"
            autocomplete="new-password"/>
          <${Input} type="password" value=${again} onInput=${setAgain} placeholder="再输入一次"
            autocomplete="new-password"/>
        </div>
        ${err ? html`<div class="login-err">${err}</div>` : null}
        <${Button} full disabled=${busy}>${busy ? '正在修改' : '修改并进入'}<//>
        <button type="button" class="login-retry press" onClick=${onDone}>以后再说</button>
      </form>`;
  }

  return html`
    <form class="login" onSubmit=${submit}>
      <img class="login-icon" src="icon-192.png" alt=""/>
      <div class="login-title">Eira</div>
      ${note && !err ? html`<div class="login-note">${note}</div>` : null}
      <div class="login-fields">
        <${Input} value=${name} onInput=${setName} placeholder="账号"
          autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false"/>
        <${Input} type="password" value=${pw} onInput=${setPw} placeholder="密码"
          autocomplete="current-password"/>
      </div>
      ${err ? html`<div class="login-err">${err}</div>` : null}
      <${Button} full disabled=${busy}>${busy ? '正在登录' : '登录'}<//>
      ${offline ? html`<button type="button" class="login-retry press" onClick=${() => location.reload()}>重新连接</button>` : null}
      <div class="login-hint">账号由本站添加，不开放注册。忘记密码请联系添加账号的人重置。</div>
    </form>`;
}

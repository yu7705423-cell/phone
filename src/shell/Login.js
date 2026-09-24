import { html, useState } from '../lib.js';
import { Input, Button } from '../ui/basic.js';
import { login } from '../system/auth.js';

// 登录页。开机时账号服务说「要登录」才出现（见 system/auth.js 的 gate），
// 它在应用本体之前画，这时数据库、各个 app 都还没起来，所以只用最基础的几样零件。
//
// 没有「注册」：账号由运营方发放。没有「忘记密码」：找运营方重置。
export function Login({ note = '', offline = false, onDone }) {
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async e => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true); setErr('');
    try {
      await login(name, pw);
      onDone();
    } catch (x) {
      setErr(String(x.message || x));
      setBusy(false);
    }
  };

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
      <div class="login-hint">账号由本站发放，不开放注册。忘记密码请联系发放账号的人重置。</div>
    </form>`;
}

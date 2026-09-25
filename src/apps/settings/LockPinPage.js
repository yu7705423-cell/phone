import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Segmented, PinPad, Icon, toast } from '../../ui/index.js';

const { db, nav, pinlock, auth } = phone;

// 设置、更改、关闭本机的锁屏密码（system/pinlock.js）。入口在「外观 - 启动时显示锁屏」下面，
// 和锁屏那一项放在一起（CLAUDE.md 第 5 条）。
//
// 设新的要输两遍；改和关都先核对一遍旧的。

export function LockPinPage() {
  useStore(db.settings.store);
  const has = pinlock.hasPin();
  // menu：已设过时的选择；old：核对旧密码；new / again：输新密码两遍
  const [step, setStep] = useState(has ? 'menu' : 'new');
  const [intent, setIntent] = useState(has ? '' : 'set');
  const [len, setLen] = useState(4);
  const [first, setFirst] = useState('');
  const [wrong, setWrong] = useState('');

  const start = what => { setIntent(what); setWrong(''); setStep('old'); };

  const onOld = async code => {
    if (!await pinlock.check(code)) {
      const w = pinlock.waitLeft();
      setWrong(w ? `输错次数过多，${w} 秒后可再试` : '密码错误');
      return;
    }
    setWrong('');
    if (intent === 'off') {
      pinlock.clearPin();
      toast('锁屏密码已关闭', 'ok');
      nav.pop();
      return;
    }
    setStep('new');
  };

  const onNew = code => { setFirst(code); setWrong(''); setStep('again'); };

  const onAgain = async code => {
    if (code !== first) { setWrong('两次输入不一致，请重新设置'); setFirst(''); setStep('new'); return; }
    try {
      await pinlock.setPin(code);
      toast(intent === 'change' ? '锁屏密码已更改' : '锁屏密码已设置', 'ok');
      nav.pop();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const recover = auth.serviceUrl() && auth.currentName()
    ? `忘记密码时，可在锁屏上输入账号「${auth.currentName()}」的登录密码，验证通过后清除锁屏密码，数据不受影响。`
    : '当前未登录账号，忘记密码后无法重置，只能清除本网站的数据，全部数据将一并清除。请牢记密码。';

  const title = { set: '设置锁屏密码', change: '更改锁屏密码', off: '关闭锁屏密码' }[intent] || '锁屏密码';

  if (step === 'menu') {
    return html`
      <${Page} title="锁屏密码" onBack=${nav.pop}>
        <${List}>
          <${ListItem} title="更改密码" arrow left=${html`<${Icon} name="edit" size=${18}/>`}
            onClick=${() => start('change')}/>
          <${ListItem} title="关闭密码" arrow left=${html`<${Icon} name="lock" size=${18}/>`}
            onClick=${() => start('off')}/>
        <//>
        <div class="settings-foot">
          当前为 ${pinlock.pinLength()} 位密码。每次打开应用时需要输入；切到后台再回来不需要。${recover}
        </div>
      <//>`;
  }

  const pad = step === 'old'
    ? html`<${PinPad} key="old" length=${pinlock.pinLength()} onDone=${onOld}
        note=${wrong || '输入当前的锁屏密码'} wrong=${!!wrong}/>`
    : step === 'new'
      ? html`<${PinPad} key=${`new${len}`} length=${len} onDone=${onNew}
          note=${wrong || `输入 ${len} 位新密码`} wrong=${!!wrong}/>`
      : html`<${PinPad} key=${`again${len}`} length=${len} onDone=${onAgain} note="再输入一遍"/>`;

  return html`
    <${Page} title=${title} onBack=${nav.pop}>
      ${step === 'new' ? html`
        <div class="pad-x pad-t">
          <${Segmented} value=${len} onChange=${v => { setLen(v); setWrong(''); }}
            items=${[{ value: 4, label: '4 位数字' }, { value: 6, label: '6 位数字' }]}/>
        </div>` : null}
      <div class="pad">${pad}</div>
      ${step === 'new' ? html`
        <div class="settings-foot">
          设置后，每次打开应用都需要输入密码；切到后台再回来不需要。「启动时显示锁屏」关闭时同样生效。${recover}
        </div>` : null}
    <//>`;
}

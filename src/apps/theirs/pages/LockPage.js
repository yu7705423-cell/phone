import { html, useState } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Field, Segmented, Button, Icon, Avatar, EmptyState,
         toast, confirm } from '../../../ui/index.js';

const { db, nav, theirs, ai, clock, day } = phone;

// 锁屏。
//
// 密码按人设定，**生成的时候不给你看** —— 看了就没得猜了，而猜这一下
// 本来就是这个功能的全部意思。
//
// 猜不出来可以问它要提示。提示是生成密码那一次一起产出的，问的时候不再
// 调接口（第 15 条）。三条问完还猜不出，可以直接看答案 —— 这个口子必须留着，
// 不然一台永远打不开的手机就是一个坏功能。
//
// **解开之后只在这次打开应用期间有效**，不落库：存起来就等于「解过一次
// 永远不用再解」，那这道锁只有第一次有用。

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

export function LockPage({ charId, onOpen }) {
  useStore(db.characters.store);
  useStore(db.phones.store);
  const char = db.characters.get(charId);
  const wall = useImage(char?.cover);

  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(0);
  const [digits, setDigits] = useState(4);
  const [busy, setBusy] = useState(false);

  if (!char) {
    return html`<${Page} title="角色手机" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  const lock = theirs.lockOf(charId);
  const shown = theirs.shownHints(charId);
  const left = lock ? (lock.hints || []).length - shown.length : 0;

  // ---- 还没有密码：先生成一个 ----
  const make = async () => {
    setBusy(true);
    try {
      const got = await ai.phone.makeLock(charId, { digits });
      toast(`已设定 ${got.digits} 位密码。现在需要你自己猜`, 'ok', 5000);
    } catch (err) {
      toast(String(err.message || err), 'error', 6000);
    } finally { setBusy(false); }
  };

  if (!lock) {
    return html`
      <${Page} title=${char.name} onBack=${nav.pop}>
        <div class="pad-x pad-t">
          <div class="hint-box">
            这台手机还没有设定密码。密码将依据该角色的设定生成，
            生成后不会显示给你，需要自行推测，也可以向该角色询问线索。
          </div>
          <${Field} label="密码位数">
            <${Segmented} value=${digits} onChange=${setDigits}
              items=${[{ value: 4, label: '四位' }, { value: 6, label: '六位' }]}/>
          <//>
        </div>
        <div class="pad">
          <${Button} full disabled=${busy} onClick=${make}>
            ${busy ? '正在设定' : '设定密码'}
          <//>
        </div>
        <div class="settings-foot">
          调用一次副用接口，与聊天分开计费。只发送该角色的设定，不发送对话历史。
        </div>
      <//>`;
  }

  // ---- 有密码：输密码 ----
  const need = String(lock.code || '').length;

  const tap = k => {
    if (k === 'del') { setCode(code.slice(0, -1)); return; }
    if (!k || code.length >= need) return;
    const next = code + k;
    setCode(next);
    if (next.length < need) return;
    // 满了就判一次
    if (theirs.tryCode(charId, next)) {
      theirs.open(charId);
      onOpen?.();
      return;
    }
    setWrong(wrong + 1);
    setCode('');
  };

  const askHint = () => {
    const h = theirs.nextHint(charId);
    if (h) { toast(h, 'plain', 8000); return; }
    toast('该角色没有更多线索了', 'plain');
  };

  const giveUp = async () => {
    if (!await confirm({
      title: '直接查看密码',
      message: '查看后这台手机将直接打开，不再需要推测。',
      okText: '查看',
    })) return;
    toast(`密码是 ${lock.code}${lock.why ? `。${lock.why}` : ''}`, 'plain', 10000);
    theirs.open(charId);
    onOpen?.();
  };

  return html`
    <${Page} title="" onBack=${nav.pop} noScroll statusBarStyle="light">
      <div class=${`tp-lock${wall ? ' has-img' : ''}`}
        style=${wall ? `background-image:url(${wall})` : ''}>
        <div class="tp-lock-top">
          <b class="tp-lock-time">${clock.clockOnly(clock.now(), clock.charZone(char))}</b>
          <span>${day.weekdayOf(char)}</span>
          <${Avatar} src=${char.avatar} name=${char.name} size=${48}/>
          <span class="tp-lock-name">${char.name}</span>
        </div>

        <div class="tp-dots">
          ${Array.from({ length: need }, (_, i) => html`
            <i key=${i} class=${i < code.length ? 'is-on' : ''}></i>`)}
        </div>
        <div class="tp-lock-note">
          ${wrong ? `密码错误，已尝试 ${wrong} 次` : `${need} 位密码`}
        </div>

        <div class="tp-keys">
          ${KEYS.map((k, i) => (k === '' ? html`<span key=${i}></span>` : html`
            <button key=${i} class="tp-key press"
              aria-label=${k === 'del' ? '删除' : k}
              onClick=${() => tap(k)}>
              ${k === 'del' ? html`<${Icon} name="chevronLeft" size=${20}/>` : k}
            </button>`))}
        </div>

        <div class="tp-lock-acts">
          <button class="press" onClick=${askHint}>
            ${left > 0 ? `问 ${char.name}（还有 ${left} 条线索）` : '没有更多线索'}
          </button>
          ${left > 0 ? null : html`
            <button class="press" onClick=${giveUp}>直接查看密码</button>`}
        </div>
      </div>
    <//>`;
}

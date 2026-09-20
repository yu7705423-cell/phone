import { html, useState } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Icon, EmptyState, toast, confirm } from '../../../ui/index.js';
import { CharAvatar } from '../parts.js';

const { db, nav, theirs } = phone;

// 锁屏。**点进一个角色，看见的第一屏就是这里。**
//
// 从前这里还有一页「先设定一个密码」的设置：挑位数、按一下、等模型回来。
// 那一页把这件事的意思整个抽掉了 —— 拿起别人的手机，看见的是锁屏，
// 不是一份问你要不要上锁的表格。现在没有那一页了：密码在数据层就先有
// （system/theirs.js 的 localLock，按生日或设定里的数字当场推出来，不调接口），
// 想换一个由模型定的，在「生成内容」里换。
//
// 密码不显示。猜不出来可以问它要提示，提示是跟着密码一起有的，问的时候
// 不调接口（第 15 条）。问完还猜不出可以直接看答案 —— 这个口子必须留着，
// 不然一台永远打不开的手机就是一个坏功能。
//
// **解开之后只在这次打开应用期间有效**，不落库：存起来就等于「解过一次
// 永远不用再解」，那这道锁只有第一次有用。
//
// 上面只放一张头像。原先那里还有时刻与星期，那是从主屏抄过来的 ——
// 主屏上它是「这台手机此刻几点」，有用；锁屏上你是来输密码的，
// 那两行只是占着地方。是谁的手机，一张脸就够了。

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

export function LockPage({ charId, onOpen }) {
  useStore(db.characters.store);
  useStore(db.phones.store);
  const char = db.characters.get(charId);
  // 壁纸和主屏用同一张：换过的优先，没换过用角色卡的封面
  const wall = useImage(theirs.wallpaperOf(charId) || char?.cover);

  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(0);

  if (!char) {
    return html`<${Page} title="角色手机" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  const lock = theirs.lockOf(charId);
  const need = String(lock?.code || '').length;
  const left = (lock?.hints || []).length - (lock?.shown || 0);

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
    toast(h || '该角色没有更多线索了', 'plain', h ? 8000 : 2500);
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
    <${Page} onBack=${nav.pop} hideBar noScroll statusBarStyle="light">
      <div class=${`tp-lock${wall ? ' has-img' : ''}`}
        style=${wall ? `background-image:url(${wall})` : ''}>
        <div class="tp-lock-top">
          <${CharAvatar} subject=${char} size=${88}/>
        </div>

        <div class="tp-lock-mid">
          <div class="tp-dots">
            ${Array.from({ length: need }, (_, i) => html`
              <i key=${i} class=${i < code.length ? 'is-on' : ''}></i>`)}
          </div>
          <div class="tp-lock-note">
            ${wrong ? `密码错误，已尝试 ${wrong} 次` : `${need} 位密码`}
          </div>
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
          ${left > 0 ? html`
            <button class="press" onClick=${askHint}>
              向${char.name}询问线索（还有 ${left} 条）
            </button>`
          : html`
            <button class="press" onClick=${giveUp}>直接查看密码</button>`}
          <button class="press" onClick=${nav.pop}>退出这台手机</button>
        </div>
      </div>
    <//>`;
}

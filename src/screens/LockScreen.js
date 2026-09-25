import { html, useState, useEffect, useRef } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { useStore } from '../system/store.js';
import { notifications, openNotification, dismiss, shownBody } from '../system/notify.js';
import { unlock, nav } from '../system/nav.js';
import { useImage } from '../system/db/useImage.js';
import { layout } from '../system/db/index.js';
import * as pinlock from '../system/pinlock.js';
import * as auth from '../system/auth.js';
import { PinPad } from '../ui/pinpad.js';
import { prompt, toast } from '../ui/overlay.js';

// 设了锁屏密码时（system/pinlock.js）：上滑、点「上滑解锁」、点锁屏上的通知，都先出数字键盘。
// 点通知那一下先记着，输对了再兑现
function PinGate({ onPass, onCancel }) {
  const len = pinlock.pinLength();
  const [wrong, setWrong] = useState(false);
  const [wait, setWait] = useState(() => pinlock.waitLeft());
  useEffect(() => {
    if (!wait) return undefined;
    const t = setTimeout(() => setWait(pinlock.waitLeft()), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const done = async code => {
    if (await pinlock.check(code)) { onPass(); return; }
    setWrong(true);
    setWait(pinlock.waitLeft());
  };

  // 忘了：用登录用的账号密码验证一次，过了就清掉锁屏密码，数据不动
  const forgot = async () => {
    if (!auth.serviceUrl() || !auth.currentName()) {
      toast('未登录账号，无法通过账号验证身份。', 'error', 5000);
      return;
    }
    const pw = await prompt({
      title: '忘记锁屏密码', type: 'password', okText: '验证',
      message: `输入账号「${auth.currentName()}」的登录密码。验证通过后清除锁屏密码，数据不受影响。`,
      placeholder: '账号密码',
    });
    if (pw === null) return;
    try {
      await auth.login(auth.currentName(), pw);
      pinlock.clearPin();
      toast('锁屏密码已清除，可在「设置 - 外观」重新设置', 'ok', 5000);
      onPass();
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
  };

  const note = wait ? `输错次数过多，${wait} 秒后可再试`
    : wrong ? `密码错误，已错 ${pinlock.failCount()} 次` : `输入 ${len} 位锁屏密码`;
  return html`
    <div class="lock-pin">
      <${PinPad} key=${len} length=${len} onDone=${done} note=${note}
        wrong=${wrong || !!wait} disabled=${!!wait}/>
      <div class="lock-pin-acts">
        <button class="press" onClick=${forgot}>忘记密码</button>
        <button class="press" onClick=${onCancel}>取消</button>
      </div>
    </div>`;
}

export function LockScreen() {
  const [now, setNow] = useState(() => new Date());
  const { items } = useStore(notifications);
  const lay = useStore(layout.store);
  const wallpaper = useImage(lay.wallpaper?.lock);
  const start = useRef(null);
  const [asking, setAsking] = useState(false);
  const after = useRef(null);            // 输对之后要做的那件事（点了哪条通知）

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(t);
  }, []);

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const date = `${now.getMonth() + 1}月${now.getDate()}日 星期${'日一二三四五六'[now.getDay()]}`;

  // 设了密码：先要密码，对了再放开（门在 Root 上，见 pinlock.js）
  const go = then => {
    if (!pinlock.pinStore.get().locked) { then?.(); unlock(); return; }
    after.current = then || null;
    setAsking(true);
  };
  const pass = () => {
    const then = after.current;
    after.current = null;
    setAsking(false);
    pinlock.release();
    then?.();
    // 导航已经被推去别处（点了系统通知）就落在那儿，不再拉回主界面
    if (nav.get().screen === 'lock') unlock();
  };

  const onTouchStart = e => { start.current = e.touches[0].clientY; };
  const onTouchEnd = e => {
    if (start.current == null) return;
    if (start.current - e.changedTouches[0].clientY > 70) go();
    start.current = null;
  };

  if (asking) {
    return html`
      <div class=${`lock is-pin no-callout${wallpaper ? ' has-wallpaper' : ''}`}>
        <div class="lock-clock">
          <div class="lock-time">${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}</div>
        </div>
        <${PinGate} onPass=${pass} onCancel=${() => { after.current = null; setAsking(false); }}/>
      </div>`;
  }

  return html`
    <div class=${`lock no-callout${wallpaper ? ' has-wallpaper' : ''}`}
      onTouchStart=${onTouchStart} onTouchEnd=${onTouchEnd}>
      <div class="lock-clock">
        <div class="lock-time">${hh}:${mm}</div>
        <div class="lock-date">${date}</div>
      </div>

      <div class="lock-notifications scroll">
        ${items.slice(0, 8).map(n => html`
          <div key=${n.id} class="lock-note press" onClick=${() => go(() => openNotification(n.id))}>
            <${Icon} name=${n.icon || 'bell'} size=${16}/>
            <div class="lock-note-body">
              <div class="lock-note-title ellipsis">${n.title}</div>
              ${shownBody(n) ? html`<div class="lock-note-text ellipsis">${shownBody(n)}</div>` : null}
            </div>
            <button class="lock-note-x" onClick=${e => { e.stopPropagation(); dismiss(n.id); }}
              aria-label="忽略"><${Icon} name="close" size=${14}/></button>
          </div>`)}
      </div>

      <button class="lock-unlock press" onClick=${() => go()}>
        <${Icon} name="chevronUp" size=${18}/>
        <span>上滑解锁</span>
      </button>
    </div>`;
}

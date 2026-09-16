import { html, useState, useEffect, useRef } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { useStore } from '../system/store.js';
import { notifications, openNotification, dismiss } from '../system/notify.js';
import { unlock } from '../system/nav.js';
import { useImage } from '../system/db/useImage.js';
import { layout } from '../system/db/index.js';

export function LockScreen() {
  const [now, setNow] = useState(() => new Date());
  const { items } = useStore(notifications);
  const lay = useStore(layout.store);
  const wallpaper = useImage(lay.wallpaper?.lock);
  const start = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(t);
  }, []);

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const date = `${now.getMonth() + 1}月${now.getDate()}日 星期${'日一二三四五六'[now.getDay()]}`;

  const onTouchStart = e => { start.current = e.touches[0].clientY; };
  const onTouchEnd = e => {
    if (start.current == null) return;
    if (start.current - e.changedTouches[0].clientY > 70) unlock();
    start.current = null;
  };

  return html`
    <div class=${`lock${wallpaper ? ' has-wallpaper' : ''}`}
      onTouchStart=${onTouchStart} onTouchEnd=${onTouchEnd}>
      <div class="lock-clock">
        <div class="lock-time">${hh}:${mm}</div>
        <div class="lock-date">${date}</div>
      </div>

      <div class="lock-notifications scroll">
        ${items.slice(0, 6).map(n => html`
          <div key=${n.id} class="lock-note press" onClick=${() => { openNotification(n.id); unlock(); }}>
            <${Icon} name=${n.icon || 'bell'} size=${16}/>
            <div class="lock-note-body">
              <div class="lock-note-title ellipsis">${n.title}</div>
              ${n.body ? html`<div class="lock-note-text ellipsis">${n.body}</div>` : null}
            </div>
            <button class="lock-note-x" onClick=${e => { e.stopPropagation(); dismiss(n.id); }}
              aria-label="忽略"><${Icon} name="close" size=${14}/></button>
          </div>`)}
      </div>

      <button class="lock-unlock press" onClick=${unlock}>
        <${Icon} name="chevronUp" size=${18}/>
        <span>上滑解锁</span>
      </button>
    </div>`;
}

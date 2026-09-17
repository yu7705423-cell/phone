import { html, useState, useEffect, useRef } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { Avatar } from '../ui/basic.js';
import { on, EVENTS } from '../system/bus.js';
import { openNotification } from '../system/notify.js';
import { useImage } from '../system/db/useImage.js';
import { ring, config as soundConfig } from '../system/sound.js';
import { appLook } from '../system/look.js';
import { nav, currentRoute } from '../system/nav.js';

const SHOW_MS = 4600;

function Banner({ item, onDone }) {
  const avatar = useImage(item.avatar);
  const [leaving, setLeaving] = useState(false);
  const start = useRef(0);
  const timer = useRef(null);

  const close = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(onDone, 220);
  };

  useEffect(() => {
    timer.current = setTimeout(close, SHOW_MS);
    return () => clearTimeout(timer.current);
  }, [item.id]);

  const app = item.appId ? appLook(item.appId) : null;
  const when = new Date(item.createdAt);
  const hh = String(when.getHours()).padStart(2, '0');
  const mm = String(when.getMinutes()).padStart(2, '0');

  return html`
    <div class=${`banner${leaving ? ' is-leaving' : ''}`}
      onClick=${() => { clearTimeout(timer.current); openNotification(item.id); close(); }}
      onTouchStart=${e => { start.current = e.touches[0].clientY; }}
      onTouchEnd=${e => {
        // 往上一推就收起来，和真机一样
        if (start.current - (e.changedTouches[0]?.clientY ?? start.current) > 24) {
          clearTimeout(timer.current); close();
        }
      }}>
      <div class="banner-icon">
        ${avatar
          ? html`<${Avatar} src=${avatar} name=${item.title} size=${34}/>`
          : html`<${Icon} name=${item.icon || 'bell'} size=${18}/>`}
      </div>
      <div class="banner-text">
        <div class="banner-head">
          <span class="banner-app ellipsis">${app?.name || '小手机'}</span>
          <span class="banner-time">${hh}:${mm}</span>
        </div>
        <div class="banner-title ellipsis">${item.title}</div>
        ${item.body ? html`<div class="banner-body">${item.body}</div>` : null}
      </div>
    </div>`;
}

function looking(item) {
  const s = nav.get();
  if (s.screen !== 'app' || s.appId !== item.appId) return false;
  const route = item.payload?.route;
  return !!route && currentRoute() === route;
}

// 从顶上掉下来的通知横幅。挂在 .root 里，压在所有界面之上。
export function NotifyBanner() {
  const [queue, setQueue] = useState([]);

  useEffect(() => on(EVENTS.notify, item => {
    // 正开着那个会话就别弹了，人就在看。真机也是这么做的
    if (looking(item)) return;
    const cfg = soundConfig();
    ring(cfg);
    if (!cfg.banner) return;
    // 同一时刻只显示最新那条，旧的直接顶掉，不排队堆成一摞
    setQueue([item]);
  }), []);

  if (!queue.length) return null;
  const item = queue[0];
  return html`
    <div class="banner-host">
      <${Banner} key=${item.id} item=${item} onDone=${() => setQueue([])}/>
    </div>`;
}

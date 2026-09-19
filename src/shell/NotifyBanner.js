import { html, useState, useEffect, useRef } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { Avatar } from '../ui/basic.js';
import { on, EVENTS } from '../system/bus.js';
import { openNotification, shownBody } from '../system/notify.js';
import { useImage } from '../system/db/useImage.js';
import { ring, config as soundConfig } from '../system/sound.js';
import { appLook } from '../system/look.js';
import { nav, currentRoute } from '../system/nav.js';

const SHOW_MS = 4600;
// 藏起来的时候最多攒这么多条。同一个会话的并成一条，
// 所以这个数限的是「几个来源」，不是几条消息。
const QUEUE_MAX = 3;

// 同一个会话的算同一个来源
const sourceOf = item => `${item.appId || ''}:${item.payload?.route || item.title || ''}`;

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

  // 页面不在前台时**不走这个计时**。
  //
  // 从前是收到就起一个 4.6 秒的定时器，于是保活状态下角色半夜发来的消息，
  // 横幅在你看不见的时候弹出来、又自己消失，切回来什么都没有。
  // 现在藏起来时把计时停掉，回到前台再从头计。
  useEffect(() => {
    const stop = () => clearTimeout(timer.current);
    const go = () => {
      stop();
      if (document.visibilityState === 'visible') timer.current = setTimeout(close, SHOW_MS);
    };
    go();
    document.addEventListener('visibilitychange', go);
    return () => { stop(); document.removeEventListener('visibilitychange', go); };
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
        <div class="banner-title ellipsis">
          ${item.title}${item.count > 1 ? html`<span class="banner-count">${item.count} 条</span>` : null}
        </div>
        ${shownBody(item) ? html`<div class="banner-body">${shownBody(item)}</div>` : null}
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
    setQueue(q => {
      // 前台时只显示最新那条。藏起来时攒着，但同一个会话的并成一条 ——
      // 一轮五条各弹一遍，回来就是二十几秒的横幅，谁也不会等着看完。
      if (document.visibilityState === 'visible') return [item];
      const src = sourceOf(item);
      const at = q.findIndex(x => sourceOf(x) === src);
      if (at >= 0) {
        const merged = { ...item, count: (q[at].count || 1) + 1 };
        return [...q.slice(0, at), ...q.slice(at + 1), merged];
      }
      return [...q, item].slice(-QUEUE_MAX);
    });
  }), []);

  if (!queue.length) return null;
  const item = queue[0];
  return html`
    <div class="banner-host">
      <${Banner} key=${item.id} item=${item} onDone=${() => setQueue(q => q.slice(1))}/>
    </div>`;
}

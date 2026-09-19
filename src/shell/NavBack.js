import { html, useRef } from '../lib.js';
import { Icon } from '../icons/Icon.js';
import { goHome, setSwitcher } from '../system/nav.js';
import { goBack } from './goback.js';

// 左上角那个悬浮返回键。和底部横条二选一，在「设置 - 主题」里换。
//
// 它比页面自己那个返回箭头多出来的那点用处，在于**没有导航栏的地方也有它** ——
// 读书和看片的全屏、锁屏之外的每一处都在同一个位置。所以开了它之后，
// 页面自己那个箭头就让位（样式里藏掉），免得同一个位置摆两个返回。
//
// 按下去做什么，和那个箭头完全一致：先问浮层要不要关，再问当前这一页
// 自己的 onBack —— 有七页的返回是「退出多选」这种页内的事，统一 nav.pop
// 会把它们连页面一起退掉。见 ui/page.js 里那个返回栈。
//
// 底部横条原来还兼着回主界面和多任务，换成这个键之后这两件事也得有地方去：
//   在应用里  长按回主界面
//   在主界面  点一下开多任务（主界面本来就没有上一级可退）

const HOLD = 500;

export function NavBack({ screen }) {
  const timer = useRef(null);
  const held = useRef(false);

  const start = () => {
    held.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { held.current = true; goHome(); }, HOLD);
  };
  const end = () => { clearTimeout(timer.current); timer.current = null; };

  const tap = () => {
    // 长按已经把事办了，抬手那一下不要再办一次
    if (held.current) { held.current = false; return; }
    // 主界面没有上一级可退，那里这个键管多任务
    if (screen === 'home') { setSwitcher(true); return; }
    // 其余一律交给那一份共用的优先级，见 shell/goback.js
    goBack();
  };

  const home = screen === 'home';
  return html`
    <button class="navback no-callout press" onClick=${tap}
      onMouseDown=${start} onMouseUp=${end} onMouseLeave=${end}
      onTouchStart=${start} onTouchEnd=${end} onTouchMove=${end} onTouchCancel=${end}
      aria-label=${home ? '多任务' : '返回上一级'}
      title=${home ? '打开多任务' : '返回上一级。长按回到主界面'}>
      <${Icon} name=${home ? 'layers' : 'chevronLeft'} size=${22}/>
    </button>`;
}

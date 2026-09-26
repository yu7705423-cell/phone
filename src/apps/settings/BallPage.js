import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Switch, Button, toast, confirm } from '../../ui/index.js';

// 悬浮球（ARCHITECTURE 4.256）。放哪几项、大小、图片、CSS 都在球上长按改（CLAUDE.md 第 5 条：改的时候人就在球那儿）；
// 这里只放开关，和两个找回来的口子：
//   - 「恢复默认位置」：球跑到看不见的地方时，球在不在屏幕上都点得到；
//   - 「恢复默认样式」：自己写的 CSS 把球或面板弄没了、弄得点不开时用。设置 app 里不挂那段 CSS，这一页永远是好的
const { db, nav, quickball: qb } = phone;

export function BallPage() {
  useStore(db.settings.store);
  const c = qb.cfg();
  const custom = !!(c.img || c.css);
  return html`
    <${Page} title="悬浮球" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title="显示悬浮球" multiline
          subtitle="开启后在整个应用中显示。点击展开快捷操作；长按悬浮球选择放入的项目，并调整大小、图片与样式；拖动可调整位置，松手后贴靠最近的一侧。"
          right=${html`<${Switch} checked=${c.on} onChange=${v => qb.setCfg({ on: v })}/>`}/>
      <//>
      <div class="pad">
        <${Button} full variant="ghost" onClick=${() => { qb.resetPos(); toast('已恢复默认位置', 'ok'); }}>恢复默认位置<//>
        <div class="field-desc pad-t">悬浮球停留在上次放置的位置。屏幕尺寸变化时自动移回可见范围内；找不到悬浮球时，点此放回屏幕右侧。</div>
      </div>
      <div class="pad">
        <${Button} full variant="ghost" onClick=${async () => {
          if (custom && !await confirm({ title: '恢复默认样式', message: '将移除悬浮球的图片与自定义 CSS，大小与不透明度恢复默认。放入的项目与位置不变。', danger: true })) return;
          qb.resetLook();
          toast('已恢复默认样式', 'ok');
        }}>恢复默认样式<//>
        <div class="field-desc pad-t">自定义 CSS 在设置应用中不生效。悬浮球或其面板因自定义样式无法使用时，点此恢复。</div>
      </div>
    <//>`;
}

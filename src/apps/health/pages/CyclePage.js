import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, EmptyState, toast, confirm, prompt } from '../../../ui/index.js';

const { db, nav, health } = phone;

// 经期。只做一件事：把你自己记的那几次算个平均，推下一次大概什么时候。
// **这是对你自己记录的算术，不是医学判断。**
export function CyclePage() {
  useStore(db.cycles.store);
  const list = health.listCycles();
  const open = health.openCycle();
  const pred = health.predictCycle();

  const begin = async () => {
    const d = await prompt({ title: '开始日期', placeholder: health.dateKey(),
      value: health.dateKey() });
    if (!d) return;
    health.startCycle(String(d).trim());
  };

  const finish = async c => {
    const d = await prompt({ title: '结束日期', placeholder: health.dateKey(),
      value: health.dateKey() });
    if (!d) return;
    health.endCycle(c.id, String(d).trim());
  };

  const drop = async c => {
    if (!await confirm({ title: `删除 ${c.start} 那一次`, danger: true })) return;
    health.removeCycle(c.id);
  };

  return html`
    <${Page} title="经期" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${begin}>记一次</button>`}>

      ${open ? html`
        <${List} title="正在进行">
          <${ListItem} title=${`${open.start} 开始`} multiline
            subtitle=${`已经 ${health.daysBetween(open.start, health.dateKey()) + 1} 天，还没有记结束`}
            left=${html`<${Icon} name="calendar" size=${18}/>`}
            right=${html`<button class="nav-text press"
              onClick=${() => finish(open)}>记结束</button>`}/>
        <//>` : null}

      ${pred ? html`
        <div class="pad-x pad-t">
          <div class="hint-box">
            按你已记的 ${pred.samples} 次间隔平均 ${pred.avg} 天推算，
            下一次大约在 ${pred.next}。<br/>
            这是对你自己记录做的算术，不是医学判断，也不用于任何健康评估。
          </div>
        </div>` : null}

      ${list.length ? html`
        <${List} title=${`共 ${list.length} 次`}>
          ${list.map(c => html`
            <${ListItem} key=${c.id} title=${c.start} multiline
              subtitle=${c.end
                ? `到 ${c.end}，共 ${health.daysBetween(c.start, c.end) + 1} 天`
                : '还没有记结束'}
              left=${html`<${Icon} name="calendar" size=${18}/>`}
              right=${html`<button class="nav-text press"
                onClick=${() => drop(c)}>删除</button>`}/>`)}
        <//>`
      : html`
        <${EmptyState} icon="calendar" title="还没有记录"
          desc="记下每一次的开始与结束。记满两次之后，可以按你自己的间隔推算下一次。"
          action=${html`<${Button} size="sm" icon="plus" onClick=${begin}>记一次<//>`}/>`}

      <div class="settings-foot">
        是否让角色知道这一项，在「健康 - 设置」中单独控制，默认关闭。
      </div>
    <//>`;
}

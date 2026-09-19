import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Segmented, Switch, Icon,
         toast, confirm } from '../../../ui/index.js';

const { db, nav, health } = phone;

export function SettingsPage() {
  useStore(db.settings.store);
  useStore(db.characters.store);
  useStore(db.health.store);
  const s = db.settings.get();
  const set = patch => db.settings.set(patch);

  const chars = db.characters.all().filter(c => !c.isNpc && !c.parentId);

  const wipeAll = async () => {
    if (!await confirm({ title: '删除全部健康数据', danger: true,
      message: '每日记录、经期、用药三项全部删除，不可恢复。' })) return;
    db.health.all().forEach(r => db.health.remove(r.id));
    db.cycles.all().forEach(r => db.cycles.remove(r.id));
    db.meds.all().forEach(r => db.meds.remove(r.id));
    toast('已删除', 'ok');
  };

  return html`
    <${Page} title="健康设置" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <${Field} label="体重单位" desc="一律按公斤存，换单位不会改到已记的数值。">
          <${Segmented} value=${health.unit()} onChange=${v => set({ weightUnit: v })}
            items=${[{ value: 'kg', label: '公斤' }, { value: 'lb', label: '磅' }]}/>
        <//>
      </div>

      <${List} title="让角色知道">
        <${ListItem} title="把我的健康记录写进上下文" multiline
          subtitle=${'开启后，当天的睡眠、步数、体重、喝水、心情与不适会作为事实'
            + '写进对话上下文，角色据此反应。关闭则一个字都不写。'
            + '这是你的身体数据，所以默认关闭。'}
          right=${html`<${Switch} checked=${s.healthInject === true}
            onChange=${v => set({ healthInject: v })}/>`}/>
        <${ListItem} title="经期也一并写进去" multiline
          subtitle=${'单独一道开关。上一项开启也不代表这一项跟着出去。'
            + '开启后只写当前处于经期第几天与推算的下次日期，不写别的。'}
          right=${html`<${Switch} checked=${s.healthCycleInject === true}
            onChange=${v => set({ healthCycleInject: v })}
            disabled=${s.healthInject !== true}/>`}/>
      <//>
      ${s.healthInject === true ? null : html`
        <div class="settings-foot">上一项关闭时，经期开关不生效。</div>`}

      <${List} title="角色的身体状态">
        ${chars.map(c => html`
          <${ListItem} key=${c.id} title=${c.name} multiline
            subtitle=${health.charOn(c.id)
              ? '已开启。在「健康」首页为它设定今天的状态'
              : '关闭。开启后可为它设定每天的精力、心情与不适，并写进它的上下文'}
            right=${html`<${Switch} checked=${health.charOn(c.id)}
              onChange=${v => health.setCharOn(c.id, v)}/>`}/>`)}
        ${chars.length ? null : html`
          <${ListItem} title="还没有角色" multiline subtitle="先在「联系」里建一个角色"/>`}
      <//>

      <${List}>
        <${ListItem} title="删除全部健康数据" danger arrow multiline
          subtitle="每日记录、经期、用药三项一并删除"
          left=${html`<${Icon} name="trash" size=${18}/>`}
          onClick=${wipeAll}/>
      <//>

      <div class="settings-foot">
        全部数据只存在本机，不上传，也不调用任何接口。<br/>
        这个应用只做记录，不进行健康评估，不提供医疗或用药建议。
      </div>
    <//>`;
}

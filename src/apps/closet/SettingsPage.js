import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, NumberInput, Switch, Icon, toast, prompt, confirm } from '../../ui/index.js';

const { db, nav, closet } = phone;
const K = closet.kinds;

// 衣帽间自己的设置。分类表的增减、快用完与快过期的几道门都在这儿（第 5 条：
// 人在衣帽间里想改这几样）。「聊到穿搭时每类带几件」在「用量与上限」，那是请求里带多少字的事

function GroupRow({ group }) {
  const hidden = closet.hiddenGroups().has(group.id);
  const extra = closet.subsOf(group.id).filter(s => s.custom);
  const add = async () => {
    const v = await prompt({ title: `在「${group.label}」下添加小类`, placeholder: '例如 马甲' });
    if (v == null) return;
    toast(closet.addSub(group.id, v) ? '已添加' : '名称为空或已存在');
  };
  const drop = async label => {
    if (!await confirm({ title: `删除小类「${label}」`, message: '已放在这个小类里的东西保留，小类一栏显示为空。', danger: true, okText: '删除' })) return;
    closet.dropSub(group.id, label);
  };
  return html`
    <${ListItem} title=${group.label} multiline
      subtitle=${closet.subsOf(group.id).map(s => s.label).join('、')}
      right=${html`<${Switch} checked=${!hidden} onChange=${v => closet.setGroupHidden(group.id, !v)}/>`}/>
    ${hidden ? null : html`
      <div class="cl-sub-edit">
        ${extra.map(s => html`
          <button key=${s.label} class="chip press" onClick=${() => drop(s.label)}>
            ${s.label}<${Icon} name="close" size=${11}/></button>`)}
        <button class="chip press" onClick=${add}><${Icon} name="plus" size=${11}/>小类</button>
      </div>`}`;
}

export function SettingsPage() {
  const s = useStore(db.settings.store);
  return html`
    <${Page} title="衣帽间设置" onBack=${nav.pop}>
      ${K.SIDES.map(side => html`
        <${List} key=${side.id} title=${side.label}>
          ${K.GROUPS.filter(g => g.side === side.id).map(g => html`<${GroupRow} key=${g.id} group=${g}/>`)}
        <//>`)}
      <div class="settings-foot">
        关闭的大类在衣帽间中隐藏，已放入的东西保留。自己添加的小类点一下可删除。
      </div>

      <${List} title="快用完与快过期"/>
      <div class="pad-x">
        <${Field} label="余量低于" desc="估算的余量低于这个比例，或按当前用量不足 14 天时，算作快用完。">
          <${NumberInput} value=${s.closetLowPct ?? 15} max=${100} unit="%" onChange=${v => db.settings.set({ closetLowPct: v })}/>
        <//>
        <${Field} label="离过期不足" desc="离估算的过期日不足这么多天时，算作快过期。">
          <${NumberInput} value=${s.closetExpireWarn ?? 30} unit="天" onChange=${v => db.settings.set({ closetExpireWarn: v })}/>
        <//>
        <${Field} label="同一件东西两次告诉角色至少间隔"
          desc="快用完、快过期的东西只在第一次满足条件的那一天告诉角色，之后要过了这么多天才会再告诉一次。衣帽间里「快用完或快过期」那一栏不受此限。">
          <${NumberInput} value=${s.closetAlertCooldown ?? 30} min=${1} unit="天" onChange=${v => db.settings.set({ closetAlertCooldown: v })}/>
        <//>
      </div>
      <div class="settings-foot">
        以上都是本地估算，不调用接口。角色能否看到衣帽间，由会话的「上下文」中的「衣帽间」一项控制。
      </div>

      <${List} title="好久没穿"/>
      <div class="pad-x">
        <${Field} label="上次穿着距今超过" desc="穿过至少一次、上次穿着距今超过这么多天的衣物，算作好久没穿。填 0 表示不告诉角色。">
          <${NumberInput} value=${s.closetIdleDays ?? 60} unit="天" onChange=${v => db.settings.set({ closetIdleDays: v })}/>
        <//>
        <${Field} label="两次告诉角色至少间隔"
          desc="每次只告诉角色一件，只在当天出现。同一件东西再穿一次之后才会重新计算。">
          <${NumberInput} value=${s.closetIdleGap ?? 7} unit="天" onChange=${v => db.settings.set({ closetIdleGap: v })}/>
        <//>
      </div>

      <${List} title="生图">
        <${ListItem} title="生图时参考今天穿的" multiline
          subtitle="开启后，画面描述中出现角色或你的名字，或写着合照、我们、一起时，将此人今天穿着的名称与描述接在生图提示词后面。不增加接口调用；关闭后生图不读取衣帽间。"
          right=${html`<${Switch} checked=${!!s.closetInImage} onChange=${v => db.settings.set({ closetInImage: v })}/>`}/>
      <//>
    <//>`;
}

import { html } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Field, Input, Button, Icon } from '../../ui/index.js';

const { health } = phone;

// 排便。**一次一条**，每条带自己的时间与形态。
//
// 自己那一份和角色那一份用的是同一个组件 —— 两边要记的东西一模一样，
// 各写一份迟早会有一边少一项。区别只在文案：自己那份是「记下来的」，
// 角色那份是「你替它定的」。
//
// 时间默认填当下，多数人是刚上完就记；记不得的清掉，这一条照样在。
// 形态点一下记上，再点取消，可以一直空着 —— 不是每次都要看一眼。
export function PoopField({ who, date, list, mine = true }) {
  const add = () => health.addPoop(who, date);
  const upd = (i, patch) => health.updatePoop(who, date, i, patch);

  return html`
    <${Field} label="排便"
      desc=${mine
        ? '每次记一条。时间默认填当下，可以改，也可以清空。形态可以不填。'
        : '为该角色设定今天的情况。每次一条，时间与形态都可以留空。'}>
      ${list.map((e, i) => html`
        <div class="hl-poop" key=${i}>
          <div class="hl-poop-head">
            <span class="hl-poop-no">第 ${i + 1} 次</span>
            <${Input} value=${e.at} placeholder="时间可留空"
              inputmode="numeric" onInput=${v => upd(i, { at: v })}/>
            <button class="press" aria-label=${`删除第 ${i + 1} 次`}
              onClick=${() => health.removePoop(who, date, i)}>
              <${Icon} name="trash" size=${16}/>
            </button>
          </div>
          <div class="chip-row">
            ${health.POOP_FORMS.map(f => html`
              <button key=${f.id}
                class=${`chip${e.form === f.id ? ' is-active' : ''}`}
                onClick=${() => upd(i, { form: e.form === f.id ? '' : f.id })}>
                ${f.label}
              </button>`)}
          </div>
        </div>`)}
      <div class=${list.length ? 'pad-t' : ''}>
        <${Button} full variant="ghost" icon="plus" onClick=${add}>记一次<//>
      </div>
      ${list.length ? null : html`
        <div class="settings-foot">
          形态按布里斯托分型，从硬到稀七档。只记外观，不作任何判断。
        </div>`}
    <//>`;
}

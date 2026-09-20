import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Segmented, Button, Icon,
         EmptyState, toast } from '../../../ui/index.js';

const { db, nav, theirs, ai } = phone;

// 生成这台手机里的内容。
//
// **一个 app 一次请求。** 一次把整台手机塞进一个请求里，模型常常只写出前几项
// 就收尾，后面那几个空着；而且失败一次要从头再来。一个一个来，坏了只重来那一个。
//
// 「全部生成」也是一个一个发，只是不用你按那么多下：中间某一个失败，
// 前面成了的留着，后面的照常继续，最后把成了几个、哪一个没成一并说清楚。
// **带 solo 的那几项不在「全部生成」里** —— 锁屏密码本来就有一个，
// 顺带换掉不该是按一下就发生的事。
//
// 条数由用户填，不设上限（第 13 条）。再生成一次是**往后加**，不是重掷 ——
// 抹掉的话上一次里合意的那几条也跟着没了。锁屏是唯一的例外，它本来就只有一个。
//
// 每一项长什么样（名称、图标、此刻有几条、说明）写在 ai/tasks/phone.js 的
// MAKERS 里，这一页只负责摆出来 —— 以后加一项不必回这儿改。

const COUNTS = { chats: 6, album: 8, notes: 6, visits: 10, lock: 4 };

export function MakePage({ charId }) {
  useStore(db.characters.store);
  useStore(db.phones.store);
  useStore(db.phoneChats.store);
  const char = db.characters.get(charId);
  const [counts, setCounts] = useState(COUNTS);
  const [busy, setBusy] = useState('');       // 正在生成哪一个

  if (!char) {
    return html`<${Page} title="生成内容" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  // 有几位是 digits，有几条是 count。收的名字不同，这一页替它们分开
  const optsOf = m => (m.choices ? { digits: counts[m.id] } : { count: counts[m.id] });

  const runOne = async m => {
    setBusy(m.id);
    try {
      const n = await m.run(charId, optsOf(m));
      toast(`${m.label}：${m.done(n)}`, 'ok', 5000);
    } catch (err) {
      toast(`${m.label}没成：${err.message || err}`, 'error', 6000);
    } finally { setBusy(''); }
  };

  // 一个一个发。中间坏了不打断后面的，最后一并说清楚
  const runAll = async () => {
    const failed = [];
    let okd = 0;
    for (const m of ai.phone.MAKERS.filter(x => !x.solo)) {
      setBusy(m.id);
      try {
        await m.run(charId, optsOf(m));
        okd += 1;
      } catch { failed.push(m.label); }
    }
    setBusy('');
    toast(failed.length
      ? `${okd} 项完成，${failed.join('、')}没成，可单独重试`
      : `${okd} 项全部完成`, failed.length ? 'plain' : 'ok', 6000);
  };

  return html`
    <${Page} title="生成内容" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="hint-box">
          依据该角色的设定生成这台手机里的内容。一个应用一次请求：
          某一项失败只需重试那一项，已经生成的内容不受影响。
          除锁屏密码外，再次生成为追加，不会覆盖已有内容。
        </div>
      </div>

      <${List} title="逐项生成">
        ${ai.phone.MAKERS.map(m => html`
          <${ListItem} key=${m.id} title=${m.label} multiline
            subtitle=${m.state(charId)}
            left=${html`<${Icon} name=${m.icon} size=${18}/>`}
            right=${html`
              <${Button} size="sm" variant="ghost" disabled=${!!busy}
                onClick=${() => runOne(m)}>
                ${busy === m.id ? '正在生成' : '生成'}
              <//>`}/>`)}
      <//>

      <div class="pad-x">
        ${ai.phone.MAKERS.map(m => html`
          <${Field} key=${m.id}
            label=${m.choices ? `${m.label}的位数` : `${m.label}每次生成多少`}
            desc=${m.desc}>
            ${m.choices
              ? html`<${Segmented} value=${counts[m.id]} items=${m.choices}
                  onChange=${v => setCounts({ ...counts, [m.id]: v })}/>`
              : html`<${Input} type="number" inputmode="numeric" value=${counts[m.id]}
                  onInput=${v => setCounts({ ...counts, [m.id]: Math.max(1, Number(v) || 1) })}/>`}
          <//>`)}
      </div>

      <div class="pad">
        <${Button} full disabled=${!!busy} onClick=${runAll}>
          ${busy ? '正在生成' : '全部生成'}
        <//>
      </div>
      <div class="settings-foot">
        「全部生成」同样是一项一项发送，只是不必逐个点击，其中不包含锁屏密码。
        中途失败的项目会在结束时列出，已完成的项目保留。<br/>
        全部使用副用接口，与聊天分开计费。只发送该角色的设定，不发送对话历史。
      </div>
    <//>`;
}

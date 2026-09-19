import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Icon, EmptyState,
         toast } from '../../../ui/index.js';

const { db, nav, theirs, ai } = phone;

// 生成这台手机里的内容。
//
// **一个 app 一次请求。** 一次把整台手机塞进一个请求里，模型常常只写出前几项
// 就收尾，后面那几个空着；而且失败一次要从头再来。一个一个来，坏了只重来那一个。
//
// 「全部生成」也是一个一个发，只是不用你按那么多下：中间某一个失败，
// 前面成了的留着，后面的照常继续，最后把成了几个、哪一个没成一并说清楚。
//
// 条数由用户填，不设上限（第 13 条）。再生成一次是**往后加**，不是重掷 ——
// 抹掉的话上一次里合意的那几条也跟着没了。

const COUNTS = { chats: 6, notes: 6, visits: 10 };

const stateOf = (charId, id) => (id === 'chats' ? theirs.chatsOf(charId).length
  : id === 'notes' ? theirs.notesOf(charId).length
  : theirs.visitsOf(charId).length);

export function MakePage({ charId }) {
  useStore(db.characters.store);
  useStore(db.phones.store);
  const char = db.characters.get(charId);
  const [counts, setCounts] = useState(COUNTS);
  const [busy, setBusy] = useState('');       // 正在生成哪一个

  if (!char) {
    return html`<${Page} title="生成内容" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }

  const runOne = async m => {
    setBusy(m.id);
    try {
      const n = await m.run(charId, { count: counts[m.id] });
      toast(`${m.label}：新增 ${n} ${m.unit}`, 'ok');
      return true;
    } catch (err) {
      toast(`${m.label}没成：${err.message || err}`, 'error', 6000);
      return false;
    } finally { setBusy(''); }
  };

  // 一个一个发。中间坏了不打断后面的，最后一并说清楚
  const runAll = async () => {
    const failed = [];
    let okd = 0;
    for (const m of ai.phone.MAKERS) {
      setBusy(m.id);
      try {
        await m.run(charId, { count: counts[m.id] });
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
          依据该角色的设定生成这台手机里的内容。**一个应用一次请求**：
          某一项失败只需重试那一项，已经生成的内容不受影响。
          再次生成为追加，不会覆盖已有内容。
        </div>
      </div>

      <${List} title="逐项生成">
        ${ai.phone.MAKERS.map(m => html`
          <${ListItem} key=${m.id} title=${m.label} multiline
            subtitle=${`已有 ${stateOf(charId, m.id)} ${m.unit}`}
            left=${html`<${Icon}
              name=${m.id === 'chats' ? 'message' : m.id === 'notes' ? 'notes' : 'search'}
              size=${18}/>`}
            right=${html`
              <${Button} size="sm" variant="ghost" disabled=${!!busy}
                onClick=${() => runOne(m)}>
                ${busy === m.id ? '正在生成' : '生成'}
              <//>`}/>`)}
      <//>

      <div class="pad-x">
        ${ai.phone.MAKERS.map(m => html`
          <${Field} key=${m.id} label=${`${m.label}每次生成多少`}
            desc=${m.id === 'chats'
              ? '不设上限。这一步只生成「和谁在聊、最后一句是什么」，'
                + '每段对话的正文在点进那一条时单独生成。'
              : m.id === 'notes'
              ? '不设上限。数量越多，这一次请求越长，也越可能写不完。'
              : '不设上限。'}>
            <${Input} type="number" inputmode="numeric" value=${counts[m.id]}
              onInput=${v => setCounts({ ...counts, [m.id]: Math.max(1, Number(v) || 1) })}/>
          <//>`)}
      </div>

      <div class="pad">
        <${Button} full disabled=${!!busy} onClick=${runAll}>
          ${busy ? '正在生成' : '全部生成'}
        <//>
      </div>
      <div class="settings-foot">
        「全部生成」同样是一项一项发送，只是不必逐个点击。
        中途失败的项目会在结束时列出，已完成的项目保留。<br/>
        全部使用副用接口，与聊天分开计费。只发送该角色的设定，不发送对话历史。
      </div>
    <//>`;
}

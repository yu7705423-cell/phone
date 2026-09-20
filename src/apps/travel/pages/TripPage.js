import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Segmented, Button, Icon,
         EmptyState, confirm, toast } from '../../../ui/index.js';

const { db, nav, trip, ledger, intent } = phone;

// 一次出行的详情。
//
// 上面一块是**算出来的那几个数**：到哪一步了、还有几天、第几天。
// 那几个不是存的字段，是按日期现算的 —— 存了就要有人负责在日子过去时
// 把它改掉，而那个人迟早会漏（和余额不入库同一条理由）。
//
// 钱那一段只显示，不在这里记：**共同账户里有多少、这次已经花了多少、
// 还差多少**。三个数都从账本折出来。没绑账本就写明白，给一个过去绑的入口
// —— 不在这儿另记一个「已攒多少」，那样同一笔钱会有两处。
//
// 票与攻略是后面两批的事，这一页先把位置留出来，但**不画空壳** ——
// 画一个点进去什么也没有的入口，等于让人白点一次。

export function TripPage({ tripId }) {
  useStore(db.trips.store);
  useStore(db.chats.store);
  useStore(db.characters.store);
  useStore(db.entries.store);
  useStore(db.books.store);
  useStore(db.messages.store);
  const [editing, setEditing] = useState(false);

  const row = trip.get(tripId);
  if (!row) {
    return html`<${Page} title="出行" onBack=${nav.pop}>
      <${EmptyState} title="这次出行已经不在了"/><//>`;
  }

  const chat = db.chats.get(row.chatId);
  const char = chat && db.characters.get((chat.characterIds || [])[0]);
  const phase = trip.phaseOf(row);
  const k = trip.kindOf(row.kind);
  const saving = trip.savingOn(tripId);
  const spent = trip.spentOn(tripId);

  const set = patch => trip.update(tripId, patch);

  const doBook = () => {
    try { trip.book(tripId); toast('已定下来', 'ok'); }
    catch (e) { toast(String(e.message || e), 'error', 4000); }
  };

  const doDrop = async () => {
    if (!await confirm({
      title: '取消这次出行', danger: true, okText: '取消出行',
      message: '记录会保留，可以重新启用。已经记在账本上的花费不受影响。',
    })) return;
    trip.drop(tripId);
  };

  const doRemove = async () => {
    if (!await confirm({
      title: '删除这次出行', danger: true, okText: '删除',
      message: '删除后无法恢复。已经记在账本上的花费会保留在账本中。',
    })) return;
    trip.remove(tripId);
    nav.pop();
  };

  // 上面那一行状态：写算出来的数，不写形容
  const head = (() => {
    if (phase === trip.TALKING) return row.agreed ? '已说好，等定日期' : '商量中';
    if (phase === trip.SOON) {
      const d = trip.daysUntil(row);
      return d === 0 ? '今天出发' : d != null ? `还有 ${d} 天出发` : '已定，日期待定';
    }
    if (phase === trip.GOING) return `进行中，第 ${trip.dayIndex(row)} 天，共 ${trip.nights(row)} 天`;
    if (phase === trip.DONE) return '已结束';
    return '已取消';
  })();

  const money = n => (saving?.book ? ledger.money(saving.book.id, n) : String(n));

  return html`
    <${Page} title=${row.title} onBack=${nav.pop}
      right=${html`<button class="nav-text press"
        onClick=${() => setEditing(!editing)}>${editing ? '完成' : '编辑'}</button>`}>

      <div class="pad-x pad-t">
        <div class="trip-head">
          <${Icon} name=${k.icon} size=${20}/>
          <div>
            <b>${head}</b>
            <span>${[k.label, row.place, row.venue].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
      </div>

      ${editing ? html`
        <div class="pad-x pad-t">
          <${Field} label="类型">
            <${Segmented} value=${row.kind} onChange=${v => set({ kind: v })}
              items=${trip.KINDS.map(x => ({ value: x.id, label: x.label }))}/>
          <//>
          <${Field} label="名称">
            <${Input} value=${row.title} onInput=${v => set({ title: v })}/>
          <//>
          <${Field} label=${k.what}>
            <${Input} value=${row.place} onInput=${v => set({ place: v })}/>
          <//>
          <${Field} label="场馆" desc="看演出或看比赛时填写。旅行可以留空。">
            <${Input} value=${row.venue} onInput=${v => set({ venue: v })}/>
          <//>
          <${Field} label="出发日期" desc="格式为 2026-10-03。定下来之前可以留空。">
            <${Input} value=${row.from} placeholder="2026-10-03"
              onInput=${v => set({ from: v })}/>
          <//>
          <${Field} label="返回日期" desc="留空按一天算。填反了会自动调换。">
            <${Input} value=${row.to} placeholder="2026-10-07"
              onInput=${v => set({ to: v })}/>
          <//>
          <${Field} label="预算" desc="这次出行打算花多少。用于算还差多少，不限制实际花费。">
            <${Input} type="number" inputmode="decimal" value=${row.budget || ''}
              onInput=${v => set({ budget: v })}/>
          <//>
          <${Field} label="备注" desc="会随这次出行一并写入对话上下文。">
            <${Input} value=${row.note} onInput=${v => set({ note: v })}/>
          <//>
        </div>` : null}

      <${List} title="同行">
        <${ListItem} title=${char?.name || '这段对话已经不在了'}
          subtitle=${row.agreed ? '已答应同行'
            : row.proposedBy === 'char' ? '由该角色提出' : '尚未答应'}
          left=${html`<${Icon} name="users" size=${18}/>`}
          arrow=${!!chat}
          onClick=${chat
            ? () => intent.open('chat', { route: `/chat/${chat.id}`, back: true })
            : null}/>
      <//>

      <${List} title="钱">
        ${saving ? html`
          <${ListItem} title="共同账户" multiline
            subtitle=${saving.joint
              ? `余额 ${money(saving.have)}`
              : '这本账上还没有共同账户。出行的花费需要一个共同账户来结算'}
            left=${html`<${Icon} name="wallet" size=${18}/>`}
            arrow onClick=${() => intent.open('bill', { route: '/accounts', back: true })}/>
          <${ListItem} title="这次已花" multiline
            subtitle=${spent > 0
              ? `${money(spent)}，共 ${trip.entriesOf(tripId).length} 笔`
              : '还没有记在这次出行名下的花费'}
            left=${html`<${Icon} name="filter" size=${18}/>`}/>
          ${row.budget > 0 ? html`
            <${ListItem} title="还差" multiline
              subtitle=${saving.short > 0
                ? `${money(saving.short)}。预算 ${money(row.budget)}，共同账户里有 ${money(saving.have)}`
                : `够了。预算 ${money(row.budget)}，共同账户里有 ${money(saving.have)}`}
              left=${html`<${Icon} name="check" size=${18}/>`}/>` : null}`
        : html`
          <${ListItem} title="这段对话还没有账本" multiline
            subtitle="出行的花费记在账本上，攒钱用的是共同账户。在「记账」中新建一本并绑定这段对话。"
            left=${html`<${Icon} name="wallet" size=${18}/>`}
            arrow onClick=${() => intent.open('bill', { route: '/books', back: true })}/>`}
      <//>

      <div class="pad">
        ${phase === trip.TALKING ? html`
          <${Button} full onClick=${doBook}>定下来<//>` : null}
        ${phase === trip.SOON || phase === trip.GOING ? html`
          <${Button} full variant="ghost"
            onClick=${() => trip.undoBook(tripId)}>改回商量中<//>` : null}
        ${phase === trip.DROPPED ? html`
          <${Button} full variant="ghost"
            onClick=${() => trip.undrop(tripId)}>重新启用<//>` : null}
      </div>

      ${phase !== trip.DROPPED ? html`
        <div class="pad-x">
          <${Button} full variant="ghost" onClick=${doDrop}>取消这次出行<//>
        </div>` : null}
      <div class="pad">
        <${Button} full variant="ghost" danger onClick=${doRemove}>删除<//>
      </div>

      <div class="settings-foot">
        进行中与已结束由日期算出，不需要手动切换。<br/>
        票与攻略尚未做到这一批，这一页暂时只有行程与钱。
      </div>
    <//>`;
}

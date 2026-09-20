import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Segmented, Button, Icon, Sheet,
         EmptyState, confirm, toast } from '../../../ui/index.js';

const { db, nav, trip, ledger, ai } = phone;

// 这次出行的攻略。
//
// ---- 两个人各加各的 ----
//
// 你在这一页添加，角色在对话里写 [攻略：地点]，检索出来的算第三种。
// 每一条记着是谁加的 —— **一份分不出谁是谁的清单，和一个人列的没有区别**，
// 而「一起做攻略」这件事的意思正在于看得见对方想去哪儿。
//
// ---- 排进哪一天由人来排 ----
//
// 检索回来的条目一律落在「未排期」里。**模型不给先后顺序**（见
// ai/tasks/trip.js 那一段）：先去哪个后去哪个是你们自己的事。
//
// 天数存的是第几天，不是日期。出发日期一改，整份攻略跟着挪。

const BY = { [trip.BY_ME]: '我添加', [trip.BY_CHAR]: '对方添加', [trip.BY_SEARCH]: '检索添加' };

export function PlanPage({ tripId }) {
  useStore(db.trips.store);
  useStore(db.chats.store);
  useStore(db.characters.store);
  useStore(db.books.store);

  const [count, setCount] = useState(8);
  const [query, setQuery] = useState(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', kind: trip.SPOT, price: '' });
  const [moving, setMoving] = useState(null);

  const row = trip.get(tripId);
  if (!row) {
    return html`<${Page} title="攻略" onBack=${nav.pop}>
      <${EmptyState} title="这次出行已经不在了"/><//>`;
  }

  const q = query == null ? (row.place || row.title) : query;
  const book = ledger.bookOfChat(row.chatId);
  const money = n => (book ? ledger.money(book.id, n) : String(n));
  const groups = trip.planByDay(tripId);
  const total = trip.planOf(tripId).length;
  const cost = trip.planCost(tripId);
  const web = ai.trip.canSearch();
  const days = Math.max(1, trip.nights(row));
  // 出行期间才给「去过了」。没出发就勾，勾的是一件还没发生的事
  const going = trip.phaseOf(row) === trip.GOING;

  const make = async () => {
    setBusy(true);
    try {
      const got = await ai.trip.makePlan(tripId, { count, web, query: q });
      toast(`新增 ${got.length} 条`, 'ok');
    } catch (e) {
      toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); }
  };

  const add = () => {
    const got = trip.addPlan(tripId, [{ ...draft, price: Number(draft.price) || 0 }],
      { by: trip.BY_ME, src: trip.MANUAL });
    if (!got.length) { toast('请填写名称，或该条目已存在', 'error', 4000); return; }
    setDraft({ title: '', kind: trip.SPOT, price: '' });
    setAdding(false);
  };

  const drop = async p => {
    if (!await confirm({ title: '删除这一条', danger: true, okText: '删除',
      message: '删除后无法恢复。' })) return;
    trip.removePlan(tripId, p.id);
  };

  const writeBudget = async () => {
    if (!await confirm({
      title: '按攻略写入预算',
      message: `攻略合计 ${money(cost)}，按两人计算。票款不在其中。`
        + `当前预算为 ${money(row.budget || 0)}。`,
      okText: '写入',
    })) return;
    trip.update(tripId, { budget: cost });
    toast('已写入预算', 'ok');
  };

  const titleOf = g => (g.day === 0 ? `未排期 ${g.items.length}`
    : g.day === -1 ? `超出行程天数 ${g.items.length}`
    : `第 ${g.day} 天　${g.items.length} 项`);

  const subOf = p => [
    p.done ? '已去过' : '',
    trip.planKindOf(p.kind).label,
    p.slot ? trip.slotLabel(p.slot) : '',
    p.place,
    p.price > 0 ? `每人 ${money(p.price)}` : '',
    p.open,
    p.note,
    BY[p.by] || '',
  ].filter(Boolean).join(' · ');

  return html`
    <${Page} title="攻略" onBack=${nav.pop}
      right=${html`<button class="nav-text press"
        onClick=${() => setAdding(true)}>添加</button>`}>

      ${total ? groups.filter(g => g.items.length).map(g => html`
        <${List} key=${g.day} title=${titleOf(g)}>
          ${g.items.map(p => html`
            <${ListItem} key=${p.id} multiline title=${p.title} subtitle=${subOf(p)}
              left=${html`<${Icon} name=${trip.planKindOf(p.kind).icon} size=${18}/>`}
              right=${html`
                <div class="tk-acts">
                  ${going ? html`
                    <${Button} size="sm" variant="ghost"
                      onClick=${() => trip.togglePlanDone(tripId, p.id)}>
                      ${p.done ? '取消' : '去过了'}
                    <//>` : null}
                  <${Button} size="sm" variant="ghost"
                    onClick=${() => setMoving(p)}>排期<//>
                  <button class="press" aria-label=${`删除 ${p.title}`}
                    onClick=${() => drop(p)}><${Icon} name="trash" size=${16}/></button>
                </div>`}/>`)}
        <//>`)
      : html`<${EmptyState} icon="compass" title="攻略还是空的"
          desc="添加想去的地方，或者检索目的地的景点与餐饮。对方也可以在对话中提出。"/>`}

      ${total ? html`
        <div class="pad-x pad-t">
          <${Button} full variant="ghost" onClick=${writeBudget}>
            攻略合计 ${money(cost)}，写入预算
          <//>
        </div>
        <div class="settings-foot">
          合计按两人计算，只包含攻略条目的费用，票款不在其中。
        </div>` : null}

      <div class="pad-x pad-t">
        <${Field} label="检索内容" desc="默认使用这次出行填写的地点。">
          <${Input} value=${q} onInput=${setQuery}/>
        <//>
        <${Field} label="一次检索多少条" desc="不设上限。条数越多，这一次请求越长。">
          <${Input} type="number" inputmode="numeric" value=${count}
            onInput=${v => setCount(Math.max(1, Number(v) || 1))}/>
        <//>
      </div>
      <div class="pad">
        <${Button} full disabled=${busy} onClick=${make}>
          ${busy ? '正在检索' : web ? '联网检索景点与餐饮' : '由模型列出景点与餐饮'}
        <//>
      </div>

      <div class="settings-foot">
        ${web
          ? '检索到的门票价与开放时间来自模型在网络上看到的内容，可能已经过期。'
          : '尚未配置会联网搜索的接口，由模型按已知内容列出，价格为估算。'}<br/>
        检索结果一律落在「未排期」中。排进哪一天、先去哪一处，由你们自行安排。<br/>
        出行期间，当天的条目会写入对话上下文，已去过的一并标明。<br/>
        检索使用副用接口，与聊天分开计费，每检索一次调用一次。
      </div>

      <${Sheet} open=${adding} title="添加一条" onClose=${() => setAdding(false)}>
        <div class="pad-x pad-t">
          <${Field} label="名称">
            <${Input} value=${draft.title}
              onInput=${v => setDraft({ ...draft, title: v })}/>
          <//>
          <${Field} label="类别">
            <${Segmented} value=${draft.kind}
              onChange=${v => setDraft({ ...draft, kind: v })}
              items=${trip.PLAN_KINDS.map(k => ({ value: k.id, label: k.label }))}/>
          <//>
          <${Field} label="每人费用" desc="门票或人均消费。免费或未知时填 0。">
            <${Input} type="number" inputmode="decimal" value=${draft.price}
              onInput=${v => setDraft({ ...draft, price: v })}/>
          <//>
        </div>
        <div class="pad">
          <${Button} full disabled=${!draft.title.trim()} onClick=${add}>添加<//>
        </div>
      <//>

      <${Sheet} open=${!!moving} title=${`排期：${moving?.title || ''}`}
        onClose=${() => setMoving(null)}>
        <div class="pad-x pad-t">
          <${Field} label="第几天">
            <${Segmented} value=${moving?.day ?? 0}
              onChange=${v => { trip.updatePlan(tripId, moving.id, { day: v });
                setMoving(trip.planItemOf(tripId, moving.id)); }}
              items=${[{ value: 0, label: '未排期' },
                ...Array.from({ length: days }, (_, i) => ({ value: i + 1, label: `第 ${i + 1} 天` }))]}/>
          <//>
          <${Field} label="时段">
            <${Segmented} value=${moving?.slot ?? ''}
              onChange=${v => { trip.updatePlan(tripId, moving.id, { slot: v });
                setMoving(trip.planItemOf(tripId, moving.id)); }}
              items=${trip.SLOTS.map(s => ({ value: s.id, label: s.label }))}/>
          <//>
        </div>
        <div class="settings-foot">
          天数是第几天，不是日期。改动出发日期时，整份攻略一并前后移动。
        </div>
      <//>
    <//>`;
}

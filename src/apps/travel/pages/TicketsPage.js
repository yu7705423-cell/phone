import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Segmented, Button, Icon,
         EmptyState, confirm, toast } from '../../../ui/index.js';

const { db, nav, trip, grab, ledger, ai, intent } = phone;

// 这次出行的票。
//
// ---- 搜出来的是什么 ----
//
// 是**模型在网上看到的数字**，不是实时票价。可能过期，可能是一个区间。
// 每一条都标着来源与搜到的时刻，界面照实写。这个应用不订票，也不付款。
//
// ---- 要抢的那几种 ----
//
// 演出票与比赛票不走直接购买，走抢票（system/grab.js）。那一页把**算出来的
// 数**摆出来：这一档多少张、多少人抢、一场下来抢到的概率、余票还剩多少。
// 概率是本地算的，搜索只给场馆容量与想看人数这两个客观数字。
//
// 抢不到可以加价从转售买，倍数同样由供需比算出来 —— 三十倍超额的开天价，
// 一点五倍的加一成，两种都不是拍出来的。
//
// ---- 检索内容自己填 ----
//
// 出行那一行上只有城市与场馆。要找某个人的某一场演出，那句话只有你写得出来，
// 所以检索框默认填出行上已有的信息，但**可以改**。

const STATES = {
  [trip.FOUND]: '',
  [trip.BOUGHT]: '已购买',
  [trip.MISSED]: '未购得',
  [trip.GIVENUP]: '已放弃',
};

const SRC = {
  [trip.SEARCHED]: '联网检索',
  [trip.GUESSED]: '模型估算',
  [trip.MANUAL]: '手动填写',
};

const when = ts => {
  const d = new Date(ts || 0);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function TicketsPage({ tripId }) {
  useStore(db.trips.store);
  useStore(db.chats.store);
  useStore(db.entries.store);
  useStore(db.books.store);

  const row = trip.get(tripId);
  const kinds = row ? ai.trip.kindsFor(row) : [];
  const [kind, setKind] = useState('');
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  // 自己改过检索内容就用自己那一句，没改过跟着票种走
  const [query, setQuery] = useState(null);

  // **选中的票种要现算，不能只靠 useState 的初值。** 从一次旅行的票页
  // 跳到一次演出的票页，组件是同一个实例，state 原样留着 —— 于是屏幕上
  // 第一个是「演出票」，实际拿去检索的却是上一页选的「机票」。
  // 选过的仍然作数，只是它不在这一次的选项里时退回第一个。
  const active = kinds.includes(kind) ? kind : (kinds[0] || trip.FLIGHT);
  const q = query == null ? ai.trip.queryFor(row, active) : query;

  if (!row) {
    return html`<${Page} title="票" onBack=${nav.pop}>
      <${EmptyState} title="这次出行已经不在了"/><//>`;
  }

  const book = ledger.bookOfChat(row.chatId);
  const joint = book && ledger.defaultFor(book.id, ledger.JOINT);
  const money = n => (book ? ledger.money(book.id, n) : String(n));
  const list = trip.ticketsOf(tripId);
  const web = ai.trip.canSearch();

  const find = async () => {
    setBusy(true);
    try {
      const got = await ai.trip.findTickets(tripId, { kind: active, count, web, query: q });
      toast(`找到 ${got.length} 条`, 'ok');
    } catch (e) {
      toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); }
  };

  const buy = async t => {
    const cost = trip.costOf(t);
    if (!await confirm({
      title: `购买 ${t.title}`,
      message: `${t.qty} 张，共 ${money(cost)}。将从情侣账户扣除，并记入账本。`,
      okText: '购买',
    })) return;
    try {
      trip.buyTicket(tripId, t.id);
      toast('已购买，并记入账本', 'ok');
    } catch (e) {
      toast(String(e.message || e), 'error', 6000);
    }
  };

  const refund = async t => {
    if (!await confirm({
      title: '退掉这张票', danger: true, okText: '退票',
      message: '账本中对应的那一笔会一并撤销。',
    })) return;
    trip.refundTicket(tripId, t.id);
  };

  const drop = async t => {
    if (!await confirm({ title: '删除这一条', danger: true, okText: '删除',
      message: '删除后无法恢复，可以重新检索。' })) return;
    trip.removeTicket(tripId, t.id);
  };

  // 一条的副标题：票档、单价、张数、来源。数字全摆出来，不概括
  const subOf = t => [
    t.seat,
    `${money(t.face)} × ${t.qty}`,
    t.at,
    `${SRC[t.src] || ''} ${when(t.foundAt)}`,
  ].filter(Boolean).join(' · ');

  // 需要抢的那几种，把搜回来的供需数字与算出来的概率摆出来。
  // **不写「很难抢」这种形容** —— 形容是主观的，这几个数是算出来的
  const grabOf = t => {
    if (!trip.grabRequired(t)) return '';
    if (!t.capacity || !t.demand) return '需要抢票。未能检索到场馆容量与想看人数';
    const o = grab.oddsOf(tripId, t.id);
    const share = t.share ? `，本档约占 ${Math.round(t.share * 100)}%` : '';
    const p = o ? `。抢到的概率 ${(o.p1 * 100).toFixed(o.p1 < 0.01 ? 2 : 1)}%` : '';
    // 编出来的数照样摆出来，只是标着。见 system/trip.js 的 numsMade
    const made = t.numsMade ? '（虚拟）' : '';
    return `场馆容量 ${t.capacity} 人，想看 ${t.demand} 人${made}${share}${p}`;
  };

  return html`
    <${Page} title="票" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="hint-box">
          ${web
            ? '检索到的价格来自模型在网络上看到的内容，不是实时票价，可能已经过期。本应用不提供订票与支付。'
            : '尚未配置会联网搜索的接口，只能由模型估算常见价位。估算结果不是实际票价。'}
        </div>
      </div>

      <div class="pad-x pad-t">
        <${Field} label="检索哪一种">
          <${Segmented} value=${active}
            onChange=${v => { setKind(v); setQuery(null); }}
            items=${kinds.map(id => ({ value: id, label: trip.ticketKindOf(id).label }))}/>
        <//>
        <${Field} label="检索内容"
          desc="默认使用这次出行填写的地点与场馆。查找某一场演出或某一场比赛时，在此写明。">
          <${Input} value=${q} onInput=${setQuery}/>
        <//>
        <${Field} label="一次检索多少条" desc="不设上限。条数越多，这一次请求越长。">
          <${Input} type="number" inputmode="numeric" value=${count}
            onInput=${v => setCount(Math.max(1, Number(v) || 1))}/>
        <//>
      </div>
      <div class="pad">
        <${Button} full disabled=${busy} onClick=${find}>
          ${busy ? '正在检索' : web ? '联网检索' : '由模型估算'}
        <//>
      </div>

      ${list.length ? html`
        <${List} title=${`共 ${list.length} 条`}>
          ${list.map(t => html`
            <${ListItem} key=${t.id} multiline
              title=${`${trip.ticketKindOf(t.kind).label}　${t.title}`}
              subtitle=${[subOf(t), grabOf(t), t.note,
                STATES[t.state] ? `${STATES[t.state]}，共 ${money(t.paid)}` : '']
                .filter(Boolean).join('\n')}
              left=${html`<${Icon} name=${trip.ticketKindOf(t.kind).icon} size=${18}/>`}
              right=${html`
                <div class="tk-acts">
                  ${t.state === trip.BOUGHT
                    ? html`<${Button} size="sm" variant="ghost"
                        onClick=${() => refund(t)}>退票<//>`
                    : trip.grabRequired(t)
                    ? html`<${Button} size="sm" variant="ghost"
                        onClick=${() => nav.push(`/grab/${tripId}/${t.id}`)}>抢票<//>`
                    : html`<${Button} size="sm" variant="ghost"
                        onClick=${() => buy(t)}>购买<//>`}
                  <button class="press" aria-label=${`删除 ${t.title}`}
                    onClick=${() => drop(t)}><${Icon} name="trash" size=${16}/></button>
                </div>`}/>`)}
        <//>`
      : html`<${EmptyState} icon="bookmark" title="还没有票"
          desc="检索这次出行需要的票。检索结果只作参考，购买时从情侣账户扣除。"/>`}

      ${joint ? html`
        <div class="settings-foot">
          情侣账户余额 ${money(ledger.balanceOf(book.id, joint.id))}。
          购买时余额不足会被拒绝，需要先存入。
        </div>`
      : html`
        <div class="pad">
          <${Button} full variant="ghost"
            onClick=${() => intent.open('bill', { route: '/accounts', back: true })}>
            前往「记账」建立情侣账户
          <//>
        </div>`}

      <div class="settings-foot">
        演出票与比赛票需要抢票，点击「抢票」进入。抢到的概率由场馆容量与
        想看人数算出，不调用接口。<br/>
        检索使用副用接口，与聊天分开计费，每检索一次调用一次。购买不调用接口。
      </div>
    <//>`;
}

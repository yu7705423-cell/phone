import { html, useState, useEffect } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, EmptyState, confirm, toast } from '../../../ui/index.js';

const { db, nav, trip, grab, ledger, intent } = phone;

// 抢一张票。
//
// **这一页把算出来的数全摆出来**：这一档多少张、多少人抢、一场下来抢到的
// 概率、余票还剩多少。不写「很难抢」这种形容 —— 形容是主观的，
// 而这几个数是从场馆容量和想看人数算出来的（见 system/grab.js）。
//
// 摆出来还有一个理由：**抢不到的时候，人应该看得见为什么**。
// 三千张票对九万人，抢不到是算术，不是运气不好。
//
// 抢票不调接口，所以不限次数。真正的限制是票会被抢光。

const pct = v => `${(v * 100).toFixed(v < 0.01 ? 2 : 1)}%`;

// 还有多久开售
function untilText(ms) {
  const s = Math.ceil(ms / 1000);
  if (s >= 86400) return `${Math.floor(s / 86400)} 天后开售`;
  if (s >= 3600) return `${Math.floor(s / 3600)} 小时后开售`;
  if (s >= 60) return `${Math.floor(s / 60)} 分钟后开售`;
  return `${s} 秒后开售`;
}

export function GrabPage({ tripId, ticketId }) {
  useStore(db.trips.store);
  useStore(db.entries.store);
  useStore(db.books.store);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  // 开售倒计时要自己走针。hook 一律无条件调用
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const row = trip.get(tripId);
  const t = row && trip.ticketOf(tripId, ticketId);
  if (!row || !t) {
    return html`<${Page} title="抢票" onBack=${nav.pop}>
      <${EmptyState} title="这张票已经不在了"/><//>`;
  }

  const odds = grab.oddsOf(tripId, ticketId);
  const book = ledger.bookOfChat(row.chatId);
  const joint = book && ledger.defaultFor(book.id, ledger.JOINT);
  const money = n => (book ? ledger.money(book.id, n) : String(n));
  const cost = trip.costOf(t);
  const open = grab.saleOpen(t);
  const wait = grab.untilSale(t);

  const say = s => setLog(v => [s, ...v].slice(0, 20));

  const once = () => {
    setBusy(true);
    try {
      const r = grab.grabOnce(tripId, ticketId);
      if (r.ok) { say('已抢到，款项已从共同账户扣除'); toast('已抢到', 'ok'); }
      else if (r.reason === 'soldout') say('本档已售罄');
      else say(`未抢到，本档剩余 ${r.left} 张`);
    } catch (e) {
      toast(String(e.message || e), 'error', 5000);
    } finally { setBusy(false); }
  };

  const resale = async () => {
    const times = odds?.times || 1;
    if (!await confirm({
      title: '从转售购买',
      message: `转售价约为票面的 ${times} 倍，${t.qty} 张共 ${money(trip.costOf(t, times))}。`
        + '转售同样可能被他人先行购得，未购得时不扣款。',
      okText: '购买',
    })) return;
    setBusy(true);
    try {
      const r = grab.buyResale(tripId, ticketId);
      if (r.ok) { say(`已从转售购得，按票面的 ${r.times} 倍成交`); toast('已购得', 'ok'); }
      else say('未购得，该转售票已被他人购得');
    } catch (e) {
      toast(String(e.message || e), 'error', 5000);
    } finally { setBusy(false); }
  };

  const done = t.state === trip.BOUGHT;
  const gone = t.state === trip.MISSED;
  const quit = t.state === trip.GIVENUP;

  return html`
    <${Page} title="抢票" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="trip-head">
          <${Icon} name=${trip.ticketKindOf(t.kind).icon} size=${20}/>
          <div>
            <b>${t.title}</b>
            <span>${[t.seat, t.at, `${money(t.face)} × ${t.qty}`].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
      </div>

      ${odds ? html`
        <${List} title="这一档的账">
          <${ListItem} title="本档放票" subtitle=${`约 ${odds.pool} 张，按场馆 ${t.capacity} 人计算`}
            left=${html`<${Icon} name="bookmark" size=${18}/>`}/>
          <${ListItem} title="抢这一档的人" subtitle=${`约 ${odds.rivals} 人，按想看 ${t.demand} 人分摊`}
            left=${html`<${Icon} name="users" size=${18}/>`}/>
          <${ListItem} title="抢到的概率" multiline
            subtitle=${`一场下来 ${pct(odds.p1)}，每次尝试 ${pct(odds.each)}。`
              + '该数值由上面两项算出，不是估计值'}
            left=${html`<${Icon} name="filter" size=${18}/>`}/>
          <${ListItem} title="余票" multiline
            subtitle=${odds.left > 0
              ? `${odds.left} 张。已尝试 ${odds.tries} 次，票会随尝试减少`
              : '已售罄'}
            left=${html`<${Icon} name="clock" size=${18}/>`}/>
        <//>`
      : html`
        <div class="pad-x pad-t">
          <div class="hint-box">
            未能检索到场馆容量与想看人数，无法计算抢到的概率。
            可以重新检索这一种票，或者直接按票面价购买。
          </div>
        </div>`}

      ${log.length ? html`
        <${List} title="记录">
          ${log.map((l, i) => html`
            <${ListItem} key=${i} title=${l}
              left=${html`<${Icon} name=${/已抢到|已.*购得/.test(l) ? 'check' : 'close'} size=${18}/>`}/>`)}
        <//>` : null}

      <div class="pad">
        ${done ? html`
          <${Button} full variant="ghost"
            onClick=${() => { trip.refundTicket(tripId, ticketId); say('已退票'); }}>退票<//>`
        : !open ? html`
          <${Button} full disabled>${untilText(wait)}<//>`
        : gone || quit ? null
        : html`
          <${Button} full disabled=${busy || !odds} onClick=${once}>
            ${busy ? '正在尝试' : '抢票'}
          <//>`}
      </div>

      ${!done && odds && (gone || odds.left <= 0) ? html`
        <div class="pad-x">
          <${Button} full variant="ghost" disabled=${busy} onClick=${resale}>
            从转售购买（约票面的 ${odds.times} 倍）
          <//>
        </div>` : null}

      ${!done && !quit ? html`
        <div class="pad">
          <${Button} full variant="ghost"
            onClick=${() => grab.giveUp(tripId, ticketId)}>不再尝试<//>
        </div>`
      : quit ? html`
        <div class="pad">
          <${Button} full variant="ghost"
            onClick=${() => grab.retry(tripId, ticketId)}>重新尝试<//>
        </div>` : null}

      ${joint ? html`
        <div class="settings-foot">
          共同账户余额 ${money(ledger.balanceOf(book.id, joint.id))}，
          本档按票面需 ${money(cost)}。余额不足时不能抢票。
        </div>`
      : html`
        <div class="pad">
          <${Button} full variant="ghost"
            onClick=${() => intent.open('bill', { route: '/accounts', back: true })}>
            前往「记账」建立共同账户
          <//>
        </div>`}

      <div class="settings-foot">
        抢票不调用接口，次数不受限制。限制来自票本身：每尝试一次，
        本档余票按供需比减少，减至零即为售罄。<br/>
        转售价按供需比计算，同样可能未能购得，未购得时不扣款。
      </div>
    <//>`;
}

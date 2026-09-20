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
  // 这一次走到哪一步了。抢票的过程本身就是要给人看的
  const [step, setStep] = useState('');
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
  // 这一局的场馆容量与想看人数是查来的还是编的。编的照样能算，
  // 只是每一处数字旁边都标着「虚拟」—— 算得出来和算得准不是一回事
  const made = !!t.numsMade;
  const mark = made ? '（虚拟）' : '';
  const book = ledger.bookOfChat(row.chatId);
  const joint = book && ledger.defaultFor(book.id, ledger.JOINT);
  const money = n => (book ? ledger.money(book.id, n) : String(n));
  const cost = trip.costOf(t);
  const open = grab.saleOpen(t);
  const wait = grab.untilSale(t);

  const say = s => setLog(v => [s, ...v].slice(0, 20));

  // 抢一次。**过程要走出来**，不是掷完骰子直接给个结果。
  //
  // 真实的抢票，难受的地方不在「没抢到」这三个字，在点下去之后那几秒：
  // 转圈、排队、页面没反应，然后告诉你没了。所以这里一步一步显示，
  // 每一步停多久由挤的程度决定 —— 人越多转得越久（见 system/grab.js）。
  //
  // 结果本身仍然是 grabOnce 一次算完的，这里只是把它演出来：
  // 演的时长不影响结果，手速也不影响，这一条不能破（见那个文件开头）。
  const hold = ms => new Promise(r => setTimeout(r, ms));
  const once = async () => {
    setBusy(true);
    try {
      const jam = odds ? grab.pressure(odds.ratio) : 0;
      const beat = 260 + Math.round(jam * 900);
      setStep('正在连接购票页');
      await hold(beat);
      const r = grab.grabOnce(tripId, ticketId);
      if (r.stage === 'queue') { setStep('正在排队'); await hold(beat); }
      else if (r.stage === 'slow') { setStep('正在加载'); await hold(beat * 2); }
      else { setStep('正在提交订单'); await hold(beat); }
      say(grab.reasonText(r.reason) + (r.ok || r.left <= 0 ? '' : `，本档剩余 ${r.left} 张`));
      toast(r.ok ? '已抢到' : grab.reasonText(r.reason), r.ok ? 'ok' : 'plain', 4000);
    } catch (e) {
      toast(String(e.message || e), 'error', 5000);
    } finally { setStep(''); setBusy(false); }
  };

  // 一次跑完整场。和连点「抢票」到底是同一件事 —— 同一套概率、同一套扣款，
  // 只是不必点上几十下，也不必等到开售时刻。见 system/grab.js 的 simulate
  const runAll = async () => {
    if (!await confirm({
      title: '立即模拟抢票',
      message: '不等待开售时刻，按本档的概率连续尝试，直到抢到或本档售罄。'
        + '概率与扣款均与逐次点击相同，抢到时同样从共同账户扣除票款。',
      okText: '开始',
    })) return;
    setBusy(true);
    try {
      const r = grab.simulate(tripId, ticketId);
      say(r.ok
        ? `模拟结束：第 ${r.tries} 次尝试购得，款项已从共同账户扣除`
        : `模拟结束：尝试 ${r.tries} 次，${grab.reasonText(r.reason)}`);
      toast(r.ok ? '已抢到' : '未抢到，本档已售罄', r.ok ? 'ok' : 'plain', 4000);
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
          <${ListItem} title=${`本档放票${mark}`}
            subtitle=${`约 ${odds.pool} 张，按场馆 ${t.capacity} 人计算`}
            left=${html`<${Icon} name="bookmark" size=${18}/>`}/>
          <${ListItem} title=${`抢这一档的人${mark}`}
            subtitle=${`约 ${odds.rivals} 人，按想看 ${t.demand} 人分摊`}
            left=${html`<${Icon} name="users" size=${18}/>`}/>
          <${ListItem} title="抢到的概率" multiline
            subtitle=${`一场下来 ${pct(odds.p1)}，每次尝试 ${pct(odds.each)}。`
              + (made
                ? '该数值由上面两项算出。上面两项未能检索到，为模型给出的虚拟数，'
                  + '因此这一概率同样是虚拟的'
                : '该数值由上面两项算出，不是估计值')}
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
            <${ListItem} key=${i} title=${l} multiline
              left=${html`<${Icon} name=${/已购得/.test(l) ? 'check'
                : /排队|响应超时/.test(l) ? 'clock' : 'close'} size=${18}/>`}/>`)}
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
            ${busy ? (step || '正在尝试') : '抢票'}
          <//>`}
      </div>

      ${!done && !gone && !quit && odds ? html`
        <div class="pad-x">
          <${Button} full variant="ghost" disabled=${busy} onClick=${runAll}>
            立即模拟抢票
          <//>
          <div class="settings-foot">
            不等待开售时刻，按本档的概率连续尝试，直到抢到或本档售罄。
          </div>
        </div>` : null}

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

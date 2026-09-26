import { html, useState, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, Segmented, confirm } from '../../ui/index.js';

// 后台在做什么。见 ARCHITECTURE 4.166
//
// 只读。开关各在各的对象身上（CLAUDE.md 第 5 条），这一页只把它们摆在一处：
// 哪些东西在没人看着的时候自己跑、下一次什么时候、最近实际打了几次接口。
// 每一行点进去就是那一项自己的开关页，不在这里另放一份开关。

const { db, nav, ai } = phone;

const HOUR = 3600000;
const RANGES = [
  { value: 24, label: '24 小时' },
  { value: 24 * 7, label: '7 天' },
  { value: 24 * 30, label: '30 天' },
];

const hm = t => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
// 下一次在什么时候。今天以内写几点，再远写日期
function whenText(t, now = Date.now()) {
  if (!t) return '一分钟内排定';
  if (t <= now) return '即将执行';
  const d = new Date(t);
  if (d.toDateString() === new Date(now).toDateString()) return `${hm(t)} 前后`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hm(t)}`;
}
const dateText = t => (t ? new Date(t).toLocaleDateString('zh-CN') : '');
const gapText = m => (m < 60 ? `${m} 分钟` : m % 60 === 0 ? `${m / 60} 小时` : `${(m / 60).toFixed(1)} 小时`);

// 按到点自己跑的那几样，逐个对象列出来。paid 表示会调用接口
function scheduled(now = Date.now()) {
  const rows = [];
  const open = (app, route) => () => phone.intent.open(app, { route, back: true });
  const apiOk = ai.isConfigured();

  for (const c of db.characters.all()) {
    const cfg = ai.proactive.configOf(c);
    if (cfg.proactive) {
      const quiet = cfg.proactiveQuietFrom !== cfg.proactiveQuietTo
        ? `，${cfg.proactiveQuietFrom}:00 至 ${cfg.proactiveQuietTo}:00 免打扰` : '';
      rows.push({
        key: `p-${c.id}`, paid: true, icon: 'bell',
        title: `${c.name} · 主动发起对话`,
        sub: `平均每 ${gapText(cfg.proactiveMinutes)}一次${quiet}。下一次：${whenText(ai.proactive.nextAt(c.id), now)}`,
        go: open('chat', `/proactive/${c.id}`),
      });
    }
    if (cfg.emo) {
      const last = ai.proactive.emoAt(c.id);
      rows.push({
        key: `e-${c.id}`, paid: true, icon: 'moon',
        title: `${c.name} · 深夜消息`,
        sub: `${cfg.emoFrom}:00 至 ${cfg.emoTo}:00 之间，距上次至少 ${cfg.emoDays} 天`
          + (last ? `。上次：${dateText(last)}` : '。尚未发送过'),
        go: open('chat', `/proactive/${c.id}`),
      });
    }
    const s = ai.snap.configOf(c);
    if (s.snap) {
      const last = ai.snap.lastAt(c.id);
      rows.push({
        key: `s-${c.id}`, paid: true, icon: 'camera',
        title: `${c.name} · 自己存照片`,
        sub: !ai.image.isImageReady() ? '生图接口尚未配置，不会执行'
          : `每隔${s.snapDays > 0 ? `至少 ${s.snapDays} 天` : '不限间隔'}一次，每次调用两次接口`
            + (last ? `。上次：${dateText(last)}` : '。尚未执行过'),
        go: open('chat', `/proactive/${c.id}`),
      });
    }
    if (c.dayOn) {
      rows.push({
        key: `d-${c.id}`, paid: true, icon: 'calendar',
        title: `${c.name} · 当日日程`,
        sub: '每天第一条消息时生成一次当天的日程',
        go: open('chat', `/edit/${c.id}`),
      });
    }
  }

  for (const chat of db.chats.all()) {
    if (phone.group.isGroup(chat) && phone.group.proactiveOf(chat).on) {
      const g = phone.group.proactiveOf(chat);
      rows.push({
        key: `g-${chat.id}`, paid: true, icon: 'users',
        title: `${phone.group.titleOf(chat)} · 群里主动开口`,
        sub: `平均每 ${gapText(g.minutes)}一次。下一次：${whenText(ai.proactive.groupNextAt(chat.id), now)}`,
        go: open('chat', `/group/${chat.id}`),
      });
    }
    const pend = phone.pace.pendingOf(chat);
    if (pend) {
      const who = phone.group.isGroup(chat) ? phone.group.titleOf(chat)
        : db.characters.get((chat.characterIds || [])[0])?.name || '会话';
      rows.push({
        key: `r-${chat.id}`, paid: true, icon: 'clock',
        title: `${who} · 延迟回复`,
        sub: `${phone.pace.pendingText(chat)}。到点后调用一次接口生成回复；应用不在前台且未开保活时到点收不到，下次打开时补回`,
        go: open('chat', `/chat/${chat.id}`),
      });
    }
  }

  // 下面这几样不调模型接口：寄信与提醒在本机，备份走的是 GitHub
  const letters = db.spaceItems.all().filter(r => r.type === phone.space.DRAFT && r.sendAt > now)
    .sort((a, b) => a.sendAt - b.sendAt);
  if (letters.length) {
    rows.push({
      key: 'letters', paid: false, icon: 'mail',
      title: '定时寄出的信',
      sub: `共 ${letters.length} 封。最近一封：${whenText(letters[0].sendAt, now)}`,
      go: open('space', `/space/${letters[0].chatId}`),
    });
  }

  const gh = phone.ghbackup.configOf();
  if (gh.autoDays > 0) {
    rows.push({
      key: 'gh', paid: false, icon: 'upload',
      title: '自动备份到 GitHub',
      sub: `距上次备份超过 ${gh.autoDays} 天时执行一次`
        + (gh.lastAt ? `。上次：${dateText(gh.lastAt)}` : '。尚未备份过')
        + (gh.lastError ? `。上次失败：${gh.lastError}` : ''),
      go: () => nav.push('/github'),
    });
  }
  const remind = phone.safekeep.remindDays();
  if (remind > 0) {
    rows.push({
      key: 'remind', paid: false, icon: 'download',
      title: '备份提醒',
      sub: `距上次备份超过 ${remind} 天时发一条通知`,
      go: () => nav.push('/storage'),
    });
  }

  return { rows, apiOk };
}

export function BackgroundPage() {
  useStore(db.characters.store);
  useStore(db.chats.store);
  useStore(db.settings.store);
  useStore(db.spaceItems.store);
  useStore(ai.usage.usageStore);
  const [range, setRange] = useState(24);
  // 下一次的时刻、排队的请求都在走，这一页开着的时候每几秒重画一次
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const { rows, apiOk } = scheduled(now);
  const paid = rows.filter(r => r.paid);
  const local = rows.filter(r => !r.paid);
  const q = ai.queue.stats();

  const settings = db.settings.get();
  // 每条消息顺带多打的那几项。按对象挂的、按时跑的已经在上面逐个列了
  const skip = new Set(['proactive', 'groupProactive', 'snap', 'dayOn']);
  const extras = ai.cost.EXTRA_CALLS.filter(x => !skip.has(x.id) && x.on(settings));

  const used = ai.usage.since(range * HOUR, now);
  const total = used.reduce((a, r) => a + r.n, 0);
  const autoN = used.filter(r => r.auto).reduce((a, r) => a + r.n, 0);
  const first = ai.usage.firstAt();

  const row = r => html`
    <${ListItem} key=${r.key} title=${r.title} subtitle=${r.sub} arrow multiline
      left=${html`<${Icon} name=${r.icon} size=${18}/>`}
      onClick=${r.go}/>`;

  const clear = async () => {
    if (!await confirm({
      title: '清空调用记录', danger: true, okText: '清空',
      message: '清空这台设备上记下的接口调用次数。只影响本页的统计，不影响任何数据与设置。',
    })) return;
    ai.usage.clear();
  };

  return html`
    <${Page} title="后台任务" onBack=${nav.pop}>
      <div class="hint-box">
        以下任务只在应用打开期间运行。应用关闭时不执行，重新打开后补上已到期的部分。各项的开关在各自的页面，点击对应一行前往。
      </div>

      <${List} title="正在进行">
        <${ListItem} title=${q.active || q.waiting ? `进行中 ${q.active} 个请求` : '当前没有进行中的请求'}
          subtitle=${q.waiting ? `另有 ${q.waiting} 个排队` : ''}
          left=${html`<${Icon} name="signal" size=${18}/>`}/>
      <//>

      <${List} title="定时执行 · 调用接口">
        ${paid.length ? paid.map(row) : html`
          <${ListItem} title="未开启任何定时调用接口的任务"
            subtitle="角色主动发起对话、深夜消息、自己存照片、当日日程、群里主动开口、延迟回复均已关闭" multiline/>`}
        ${paid.length && !apiOk ? html`
          <${ListItem} title="聊天接口尚未配置" subtitle="配置之前，以上任务不会执行" multiline
            left=${html`<${Icon} name="key" size=${18}/>`}/>` : null}
      <//>

      ${local.length ? html`
        <${List} title="定时执行 · 不产生模型费用">
          ${local.map(row)}
        <//>` : null}

      <${List} title="每条消息顺带的调用">
        ${extras.length ? extras.map(x => html`
          <${ListItem} key=${x.id} title=${x.label} arrow multiline
            subtitle=${typeof x.when === 'function' ? x.when(settings) : x.when}
            left=${html`<${Icon} name="filter" size=${18}/>`}
            onClick=${() => nav.push('/limits')}/>`) : html`
          <${ListItem} title="已全部关闭" subtitle="每发一条消息只调用一次接口" arrow multiline
            onClick=${() => nav.push('/limits')}/>`}
      <//>

      <${List} title="实际调用次数">
        <div class="pad-x pad-b">
          <${Segmented} items=${RANGES} value=${range} onChange=${setRange}/>
        </div>
        <${ListItem} title=${`共 ${total} 次`}
          subtitle=${total ? `其中 ${autoN} 次在后台自动发生，无人等待其结果` : '这段时间内没有调用接口'}
          multiline/>
        ${used.map(r => html`
          <${ListItem} key=${r.label} title=${r.label}
            subtitle=${r.auto ? '后台' : ''}
            right=${`${r.n} 次`}/>`)}
      <//>
      <div class="settings-foot">
        按请求实际发出的次数计，重试与换用下一套接口各算一次。只记录这台设备，
        按小时汇总，保留 30 天${first ? `，当前记录始于 ${dateText(first)}` : ''}。
        费用以服务商账单为准。
      </div>
      <${List}>
        <${ListItem} title="清空调用记录" danger onClick=${clear}
          left=${html`<${Icon} name="trash" size=${18}/>`}/>
      <//>
    <//>`;
}

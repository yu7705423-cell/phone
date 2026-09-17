import { html, useState } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Page, List, ListItem, Avatar, Icon, Switch, Sheet, Button,
         Field, EmptyState, toast } from '../../ui/index.js';

const { db, nav, space, accounts, listen } = phone;

export const toDateInput = ms => {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const fromDateInput = v => {
  const [y, m, d] = String(v || '').split('-').map(Number);
  return (y && m && d) ? new Date(y, m - 1, d).getTime() : 0;
};

const hhmm = sec => {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} 小时 ${m} 分钟` : `${m} 分钟`;
};

// 起始日。没设就是没设 —— 不拿会话创建时间顶替，那是「什么时候装的这个应用」。
function StartSheet({ open, chat, onClose }) {
  const [draft, setDraft] = useState('');
  const value = draft || (chat.loveStartAt ? toDateInput(chat.loveStartAt) : '');
  const save = () => {
    const ms = fromDateInput(value);
    if (!ms) { toast('请选择日期', 'error'); return; }
    if (ms > Date.now()) { toast('起始日不能晚于今天', 'error'); return; }
    space.setStart(chat.id, ms);
    setDraft('');
    onClose();
  };
  return html`
    <${Sheet} open=${open} onClose=${onClose} title="在一起的日子">
      <div class="pad">
        <${Field} label="起始日" desc="设定后，空间与上下文中会显示在一起的天数。清除后不再显示。">
          <input class="dt-input" type="date" value=${value}
            onInput=${e => setDraft(e.target.value)}/>
        <//>
        <div class="btn-row">
          <${Button} full onClick=${save}>保存<//>
          <${Button} full variant="ghost"
            onClick=${() => { space.setStart(chat.id, 0); setDraft(''); onClose(); }}>清除<//>
        </div>
      </div>
    <//>`;
}

export function SpacePage({ chatId }) {
  useStore(db.chats.store);
  useStore(db.messages.store);
  useStore(db.spaceItems.store);
  useStore(db.characters.store);
  const [editing, setEditing] = useState(false);

  const sp = space.spaceOf(chatId);
  const meAvatar = useImage(sp ? (sp.persona?.avatar || accounts.current()?.avatar) : null);
  const charAvatar = useImage(sp ? sp.char.avatar : null);

  if (!sp) {
    return html`
      <${Page} title="情侣空间" onBack=${nav.pop}>
        <${EmptyState} icon="heart" title="空间不存在"
          desc="对应的一对一对话可能已被删除。"/>
      <//>`;
  }

  const { chat, char, persona } = sp;
  const st = space.stats(chatId);
  const soon = space.upcoming(chatId, 1)[0] || null;
  const inject = space.injectOn(chat);

  const dayText = soon
    ? (soon.left < 0 ? `${soon.item.title} 已过`
      : soon.left === 0 ? `今天是${soon.item.title}`
      : `${soon.item.title} 还有 ${soon.left} 天`)
    : '还没有添加纪念日';

  const logs = [
    { kind: 'gift', icon: 'gift', label: '礼物墙', n: st.gifts, unit: '件' },
    { kind: 'location', icon: 'map', label: '一起去过的地方', n: st.places, unit: '处' },
    { kind: 'listen', icon: 'music', label: '一起听',
      n: st.listenCount, unit: '首', extra: st.listenSeconds ? hhmm(st.listenSeconds) : '' },
    { kind: 'call', icon: 'phone', label: '通话记录', n: st.calls, unit: '次' },
  ];

  return html`
    <${Page} title="情侣空间" onBack=${nav.pop}>
      <div class="sp-head">
        <div class="sp-faces">
          <${Avatar} src=${meAvatar} name=${persona?.name} size=${64}/>
          <${Icon} name="heart" size=${20}/>
          <${Avatar} src=${charAvatar} name=${char.name} size=${64}/>
        </div>
        <button class="sp-days press" onClick=${() => setEditing(true)}>
          ${st.days ? html`<b>${st.days}</b><span>在一起的天数</span>`
            : html`<span>设置在一起的日子</span>`}
        </button>
      </div>

      <div class="pad-x">
        <div class="stat-row">
          <div class="stat-chip"><b>${st.gifts}</b><span>礼物</span></div>
          <div class="stat-chip"><b>${st.places}</b><span>去过</span></div>
          <div class="stat-chip"><b>${st.listenCount}</b><span>一起听</span></div>
          <div class="stat-chip"><b>${st.calls}</b><span>通话</span></div>
        </div>
      </div>

      <${List}>
        <${ListItem} title="纪念日" subtitle=${dayText} arrow
          left=${html`<${Icon} name="calendar" size=${19}/>`}
          onClick=${() => nav.push(`/days/${chatId}`)}/>
        <${ListItem} title="约定" arrow
          subtitle=${st.pactsOpen || st.pactsDone
            ? `${st.pactsOpen} 个未完成，${st.pactsDone} 个已完成`
            : '还没有约定'}
          left=${html`<${Icon} name="check" size=${19}/>`}
          onClick=${() => nav.push(`/pacts/${chatId}`)}/>
        <${ListItem} title="信箱" arrow
          subtitle=${st.letters || st.drafts
            ? `${st.letters} 封已寄出${st.drafts ? `，${st.drafts} 封未寄出` : ''}`
            : '还没有信'}
          left=${html`<${Icon} name="mail" size=${19}/>`}
          onClick=${() => nav.push(`/mail/${chatId}`)}/>
      <//>

      <${List} title="记录">
        ${logs.map(l => html`
          <${ListItem} key=${l.kind} title=${l.label} arrow
            subtitle=${l.n ? `${l.n} ${l.unit}${l.extra ? ' · ' + l.extra : ''}` : '还没有记录'}
            left=${html`<${Icon} name=${l.icon} size=${19}/>`}
            onClick=${() => nav.push(`/log/${chatId}/${l.kind}`)}/>`)}
      <//>

      <${List} title="上下文">
        <${ListItem} title="让角色知道这些" multiline
          left=${html`<${Icon} name="brain" size=${18}/>`}
          subtitle=${`开启后，每次对话都会附带在一起的天数、三十天内将到的纪念日、`
            + `以及还没完成的约定。这会增加每次请求的长度。`
            + `关闭后角色不会主动提起这些内容，空间本身照常记录。`}
          right=${html`<${Switch} checked=${inject}
            onChange=${v => space.setInject(chatId, v)}/>`}/>
      <//>

      <div class="settings-foot">
        礼物、位置、一起听与通话的记录来自这段对话本身，在对话中产生后自动出现在这里。
        ${listen.playing() ? '当前正在一起听歌。' : ''}
      </div>

      <${StartSheet} open=${editing} chat=${chat} onClose=${() => setEditing(false)}/>
    <//>`;
}

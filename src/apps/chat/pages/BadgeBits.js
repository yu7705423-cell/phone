import { html, useState, useEffect, useMemo } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, List, ListItem, Switch, Button, Icon, Sheet, Field, Input, Avatar,
         EmptyState, Spinner, toast, confirm, prompt } from '../../../ui/index.js';

// 互动标识的界面。统计与规则在 system/badges.js，这里只读 `chat.stats` 画出来。
//
// 单色 SVG（第 2、4 条），花哨放在形态和动效上：火苗会晃、快断时一明一暗、
// 太阳慢慢转、满级那一圈有个亮点在绕。美化包能从 `ph-badge`、`ph-award`、
// `ph-level-ring` 这三个钩子往上加东西（第 18 条）。

const { db, nav, ai } = phone;
const B = () => phone.badges;

const FORM_ICON = { spark: 'spark', flame: 'flame', torch: 'torch', star: 'star', sun: 'sun' };

/** 一枚标识的图形。state 决定动效：lit 晃、risk 闪、ember 暗 */
export function Glyph({ name, size = 16, state = 'lit', title = '' }) {
  return html`
    <span class=${`bd-g ph-badge is-${state} is-${name}`} title=${title} aria-label=${title}>
      <${Icon} name=${name} size=${size} stroke=${1.7}/>
    </span>`;
}

/** 连续互发那一枚：图形加天数。没点亮（不足三天、熄了）就不画 */
export function StreakMark({ chat, size = 14, withNum = true }) {
  if (!chat || !B().shown(chat)) return null;
  const s = B().streakOf(chat);
  if (s.state === 'ember') {
    return html`<span class="bd-streak"><${Glyph} name="ember" size=${size} state="ember"
      title=${`火花昨天熄灭，连续 ${s.n} 天`}/></span>`;
  }
  if ((s.state !== 'lit' && s.state !== 'risk') || !s.form) return null;
  return html`
    <span class="bd-streak">
      <${Glyph} name=${FORM_ICON[s.form.form]} size=${size} state=${s.state}
        title=${s.state === 'risk' ? `连续 ${s.n} 天，今天尚未互发` : `连续互发 ${s.n} 天`}/>
      ${withNum ? html`<span class=${`bd-num${s.state === 'risk' ? ' is-risk' : ''}`}>${s.n}</span>` : null}
    </span>`;
}

/** 消息列表名字旁边那一两枚：火花，加上成长类里最高的一档 */
export function ListBadges({ chat }) {
  if (!chat?.stats || !B().shown(chat)) return null;
  const top = B().tiersOf(chat).filter(t => t.level > 0 && t.id === 'count')[0];
  return html`
    <span class="bd-list">
      <${StreakMark} chat=${chat} size=${13}/>
      ${top ? html`<${Glyph} name=${top.iconNow} size=${13} title=${top.label}/>` : null}
    </span>`;
}

/**
 * 头像外那一圈。等级越高圈越满，满级时一个亮点绕着转。
 * 尺寸只以自定义属性传进去（第 18 条：挂钩子的元素不写死声明）。
 */
export function LevelRing({ chat, size = 84, children }) {
  if (!chat || !B().shown(chat) || !chat.stats) return children;
  const lv = B().levelOf(chat);
  const frac = Math.min(1, (lv.level - 1 + lv.progress) / lv.max);
  const R = 50 - 2;
  const C = 2 * Math.PI * R;
  return html`
    <div class=${`lv-ring ph-level-ring${lv.level === lv.max ? ' is-max' : ''}`} style=${`--lv-size:${size}px`}>
      ${children}
      <svg class="lv-svg" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="lv-track" cx="50" cy="50" r=${R}/>
        <circle class="lv-arc" cx="50" cy="50" r=${R}
          stroke-dasharray=${`${(C * frac).toFixed(1)} ${C.toFixed(1)}`}/>
        ${lv.level === lv.max ? html`<g class="lv-orbit"><circle cx="50" cy=${50 - R} r="2.6"/></g>` : null}
      </svg>
    </div>`;
}

/** 角色主页上那一排：火花、等级名、最近解锁的几枚，点进标识页 */
export function BadgeStrip({ chat }) {
  if (!chat || !B().shown(chat)) return null;
  const lv = chat.stats ? B().levelOf(chat) : null;
  const recent = Object.entries(chat.unlocked || {})
    .map(([id, at]) => ({ id, at, a: B().achievementOf(id) }))
    .filter(x => x.a).sort((a, b) => b.at - a.at).slice(0, 5);
  const n = Object.keys(chat.unlocked || {}).length + Object.keys(chat.limited || {}).length
    + (chat.awards || []).length;
  return html`
    <button class="bd-strip press" onClick=${() => nav.push(`/badges/${chat.id}`)}>
      <${StreakMark} chat=${chat} size=${15}/>
      ${lv ? html`<span class="bd-strip-lv">${lv.name}</span>` : null}
      ${recent.map(x => html`<${Glyph} key=${x.id} name=${x.a.icon} size=${15} title=${x.a.name}/>`)}
      <span class="bd-strip-n">${n ? `互动标识 ${n}` : '互动标识'}</span>
      <${Icon} name="chevronRight" size=${14}/>
    </button>`;
}

/** 颁发标识那一条气泡 */
export function AwardBubble({ msg, mine }) {
  return html`
    <div class=${`bd-award ph-award${mine ? ' is-mine' : ''}`}>
      <${Glyph} name="medal" size=${26}/>
      <div class="bd-award-body">
        <div class="bd-award-tag">${mine ? '颁发了一枚标识' : '颁给你一枚标识'}</div>
        <div class="bd-award-name">${msg.awardName || ''}</div>
        ${msg.awardReason ? html`<div class="bd-award-why">${msg.awardReason}</div>` : null}
      </div>
    </div>`;
}

/** 刚解锁时那一下：图形放大落定、四个音往上走、震一下，三秒后收起 */
export function UnlockToast({ chatId }) {
  const fresh = useStore(B().fresh);
  const mine = (fresh.items || []).filter(x => x.chatId === chatId);
  const first = mine[0];
  useEffect(() => {
    if (!first) return undefined;
    try { phone.sound.chime(); } catch { /* 没解锁音频就算了 */ }
    try { navigator.vibrate?.(40); } catch { /* 不支持就算了 */ }
    const t = setTimeout(() => B().dismissFresh(chatId), 3200);
    return () => clearTimeout(t);
  }, [first?.id, first?.at]);
  if (!first) return null;
  const view = viewOf(first.id);
  return html`
    <div class="bd-toast" onClick=${() => { B().dismissFresh(chatId); nav.push(`/badges/${chatId}`); }}>
      <div class="bd-toast-glyph"><${Glyph} name=${view.icon} size=${34}/></div>
      <div class="bd-toast-body">
        <div class="bd-toast-tag">解锁${mine.length > 1 ? ` · 共 ${mine.length} 枚` : ''}</div>
        <div class="bd-toast-name">${view.name}</div>
        ${view.desc ? html`<div class="bd-toast-desc">${view.desc}</div>` : null}
      </div>
    </div>`;
}

/** 一条解锁记录画成什么样 */
function viewOf(id) {
  const a = B().achievementOf(id);
  if (a) return { icon: a.icon, name: a.name, desc: a.desc };
  if (id.includes(':')) {
    return { icon: 'calendar', name: `${id.split(':')[1]} ${B().limitedName(id)}`, desc: '节日与纪念日限定' };
  }
  const m = id.match(/^([a-z]+)-(\d+)$/);
  if (m && m[1] === 'streak') {
    const x = B().STREAK_TIERS.find(t => t.at === Number(m[2]));
    return { icon: FORM_ICON[x?.form] || 'flame', name: x?.name || '', desc: `连续互发 ${m[2]} 天` };
  }
  const tier = m && B().TIERS.find(t => t.id === m[1]);
  if (tier) {
    const i = tier.steps.indexOf(Number(m[2]));
    return { icon: tier.icons?.[i] || tier.icon, name: tier.names?.[i] || `${tier.name} ${m[2]} ${tier.unit}`,
      desc: `${tier.name}达到 ${m[2]} ${tier.unit}` };
  }
  return { icon: 'medal', name: id, desc: '' };
}

const dateOf = t => (t ? new Date(t).toLocaleDateString('zh-CN') : '');
const nameOfId = id => (id === 'me' ? (phone.accounts.current()?.name || '我') : db.characters.get(id)?.name || '已删除的角色');

// ---- 标识页 ----

export function BadgesPage({ chatId }) {
  useStore(db.chats.store);
  useStore(db.characters.store);
  const [naming, setNaming] = useState(false);
  const [giving, setGiving] = useState(null);     // 颁给谁
  const [form, setForm] = useState({ name: '', reason: '' });
  const [pick, setPick] = useState(false);
  const chat = db.chats.get(chatId);
  useEffect(() => { if (chat) B().sync(chatId); }, [chatId]);
  if (!chat) return html`<${Page} title="互动标识" onBack=${nav.pop}><${EmptyState} title="该会话已不存在"/><//>`;

  const inGroup = phone.group.isGroup(chat);
  const members = inGroup ? phone.group.members(chat) : [db.characters.get((chat.characterIds || [])[0])].filter(Boolean);
  const s = B().streakOf(chat);
  const lv = B().levelOf(chat);
  const tiers = B().tiersOf(chat);
  const set = patch => db.chats.update(chatId, patch);

  const stateText = {
    lit: `今天已互发，连续 ${s.n} 天。`,
    risk: `连续 ${s.n} 天，今天尚未互发。零点之后火花熄灭。`,
    ember: `连续 ${s.n} 天的火花昨天熄灭。今天由对方先开口、双方互发，火花可以接续。`,
    out: s.best ? `当前没有火花。最长连续 ${s.best} 天。` : '当前没有火花。双方连续三天互发消息后点亮。',
    none: '当前没有火花。双方连续三天互发消息后点亮。',
  }[s.state];

  const give = async () => {
    const name = form.name.trim();
    if (!name || !giving) return;
    const reason = form.reason.trim();
    const msg = db.messages.create({
      chatId, role: 'user', authorId: 'me', kind: 'award', awardName: name.slice(0, 24), awardReason: reason,
      awardTo: giving.id, content: `[授予：${name.slice(0, 24)}${reason ? '｜' + reason : ''}]`, status: 'done',
    });
    B().addAward(chatId, { name, reason, by: 'me', to: giving.id, msgId: msg.id });
    db.chats.update(chatId, { lastMessageAt: Date.now() });
    setGiving(null);
    setForm({ name: '', reason: '' });
    toast('已颁发，并在会话中留下一条记录', 'ok');
  };

  const recount = async () => {
    if (!await confirm({ title: '重新统计', message: '按现有的聊天记录从头统计一遍。已删除的消息不再计入，已解锁的标识按重新统计的结果保留。' })) return;
    B().sync(chatId, { full: true });
    toast('已重新统计', 'ok');
  };

  const allAch = B().ACHIEVEMENTS;
  const limited = Object.entries(chat.limited || {}).sort((a, b) => b[1] - a[1]);
  const awards = (chat.awards || []).slice().sort((a, b) => b.at - a.at);

  return html`
    <${Page} title="互动标识" onBack=${nav.pop}>
      <div class="bd-hero">
        <${LevelRing} chat=${chat} size=${72}>
          <div class="bd-hero-face"><${Glyph} name=${s.form ? FORM_ICON[s.form.form] : 'medal'} size=${36}
            state=${s.state === 'risk' ? 'risk' : s.state === 'ember' ? 'ember' : 'lit'}/></div>
        <//>
        <div class="bd-hero-lv">${lv.name}</div>
        <div class="bd-hero-sub">第 ${lv.level} / ${lv.max} 级${lv.next ? ` · 距下一级 ${lv.next - lv.score} 分` : ' · 已满级'}</div>
        <button class="nav-text press" onClick=${() => setNaming(true)}>为各级命名</button>
      </div>

      <${List} title="连续互发">
        <${ListItem} title=${stateText} multiline
          left=${html`<${StreakMark} chat=${chat} size=${18} withNum=${false}/>`}
          subtitle="一天里双方都至少发过一条算一天。连续三天点亮，之后按天数改变形态。断了正好一天时留下余烬，第二天由对方先开口并互发即可接续。"/>
        <div class="bd-forms">
          ${B().STREAK_TIERS.map(x => html`
            <div key=${x.at} class=${`bd-form${s.best >= x.at ? ' is-got' : ''}`}>
              <${Glyph} name=${FORM_ICON[x.form]} size=${22} state=${s.best >= x.at ? 'lit' : 'off'}/>
              <span>${x.name}</span><small>${x.at} 天</small>
            </div>`)}
        </div>
      <//>

      <${List} title="成长">
        ${!inGroup && !chat.loveStartAt ? html`
          <${ListItem} title="在一起" arrow multiline
            subtitle="尚未设定在一起的那一天。在情侣空间中设定后，这里多一档「在一起」，每年那一天也会有一枚限定"
            left=${html`<${Glyph} name="heart" size=${18} state="off"/>`}
            onClick=${() => phone.intent.open('space', { route: `/space/${chatId}`, back: true })}/>` : null}
        ${tiers.map(t => html`
          <${ListItem} key=${t.id} title=${t.level ? t.label : t.name}
            left=${html`<${Glyph} name=${t.iconNow} size=${18} state=${t.level ? 'lit' : 'off'}/>`}
            subtitle=${`当前 ${t.value} ${t.unit}${t.next !== null ? ` · 下一档 ${t.next} ${t.unit}` : ' · 已到最高档'}`}/>`)}
      <//>

      <${List} title=${`隐藏成就（${allAch.filter(a => chat.unlocked?.[a.id]).length} / ${allAch.length}）`}>
        <div class="bd-grid">
          ${allAch.map(a => {
    const at = chat.unlocked?.[a.id];
    return html`
              <div key=${a.id} class=${`bd-cell${at ? ' is-got' : ''}`}>
                <${Glyph} name=${at ? a.icon : 'lock'} size=${24} state=${at ? 'lit' : 'off'}/>
                <b>${at ? a.name : '？？？'}</b>
                <small>${at ? `${a.desc} · ${dateOf(at)}` : a.hint}</small>
              </div>`;
  })}
        </div>
      <//>

      <${List} title="限定">
        ${limited.length ? limited.map(([id, at]) => html`
          <${ListItem} key=${id} title=${`${id.split(':')[1]} ${B().limitedName(id)}`}
            left=${html`<${Glyph} name="calendar" size=${18}/>`} subtitle=${dateOf(at)}/>`)
          : html`<${ListItem} title="尚未获得" multiline
              subtitle="新年第一天、情人节、圣诞节、双方的生日、相识纪念日、在一起纪念日，以及情侣空间里每年重复的纪念日，当天双方互发消息即获得当年的一枚。生日取自角色卡与我的资料。"/>`}
      <//>

      <${List} title="颁发">
        ${awards.map(a => html`
          <${ListItem} key=${a.id} title=${a.name} multiline
            left=${html`<${Glyph} name="medal" size=${18}/>`}
            subtitle=${`${nameOfId(a.by)} 颁给 ${nameOfId(a.to)} · ${dateOf(a.at)}${a.reason ? '\n' + a.reason : ''}`}/>`)}
        <${ListItem} title=${inGroup ? '颁给一位成员' : `颁给${members[0]?.name || '对方'}`} arrow
          left=${html`<${Icon} name="plus" size=${18}/>`}
          onClick=${() => (inGroup ? setPick(true) : setGiving(members[0] || null))}/>
      <//>
      <div class="settings-foot">角色也可以在对话中颁给你标识，会记在这里。标识名由颁发的一方自行命名。</div>

      <${List} title="回顾">
        <${ListItem} title="年度回顾" arrow multiline
          subtitle=${`${new Date().getFullYear()} 年的消息量、最热闹的一天、最晚的一次、最常说的词与解锁的标识`}
          left=${html`<${Icon} name="calendar" size=${18}/>`}
          onClick=${() => nav.push(`/year/${chatId}`)}/>
        <${ListItem} title="那年今天" arrow multiline
          subtitle=${(() => {
            const ys = phone.onThisDay.ofChat(chatId);
            return ys.length ? `往年的今天有 ${ys.length} 年留有对话，最近一次在 ${ys[0].ago} 年前`
              : '往年的今天没有对话记录。可以翻看其他日期';
          })()}
          left=${html`<${Icon} name="clock" size=${18}/>`}
          onClick=${() => nav.push(`/onthisday/${chatId}`)}/>
      <//>

      <${List} title="这段对话">
        <${ListItem} title="显示互动标识" multiline
          subtitle=${B().shown(chat) ? '已开启。消息列表、会话顶栏与主页上显示标识。' : '已关闭。统计照常进行，界面上不显示。'}
          right=${html`<${Switch} checked=${B().shown(chat)} onChange=${v => set({ badgeShow: v })}/>`}/>
        <${ListItem} title="让角色知道" multiline
          subtitle=${B().aware(chat)
            ? '已开启。连续互发的天数、今天的状态、等级与刚解锁的标识写入提示词末尾，不额外调用接口。'
            : '已关闭。标识只给你看，角色不知道。'}
          right=${html`<${Switch} checked=${B().aware(chat)} onChange=${v => set({ badgeAware: v })}/>`}/>
        <${ListItem} title="火花快熄灭时提醒" multiline
          subtitle=${B().remindOn(chat)
            ? `已开启。连续三天以上、当天尚未互发时，${B().remindHour(chat)} 点之后提醒一次。本地通知，不调用接口。`
            : '已关闭。'}
          right=${html`<${Switch} checked=${B().remindOn(chat)} onChange=${v => set({ badgeRemind: v })}/>`}/>
        ${B().remindOn(chat) ? html`
          <div class="pad-x">
            <${Field} label="提醒时刻（点）">
              <${Input} type="number" value=${B().remindHour(chat)}
                onInput=${v => set({ badgeRemindHour: Math.min(23, Math.max(0, parseInt(v, 10) || 0)) })}/>
            <//>
          </div>` : null}
        <${ListItem} title="重新统计" arrow multiline
          subtitle="按现有聊天记录从头统计。删除过消息、或导入了历史记录后使用"
          left=${html`<${Icon} name="refresh" size=${18}/>`} onClick=${recount}/>
      <//>
      <div class="settings-foot">全部标识在本地按聊天记录统计，不调用任何接口。</div>

      <${Sheet} open=${naming} onClose=${() => setNaming(false)} title="为各级命名" height="76%">
        <div class="pad-x">
          ${B().LEVELS.map((_, i) => html`
            <${Field} key=${i} label=${`第 ${i + 1} 级`}>
              <${Input} value=${(chat.levelNames || [])[i] || ''} placeholder=${`第 ${i + 1} 级`}
                onInput=${v => {
    const next = [...(chat.levelNames || [])];
    next[i] = v;
    set({ levelNames: next });
  }}/>
            <//>`)}
          <div class="settings-foot">留空时显示为「第 n 级」。等级由连续天数、消息量、通话、共同经历与标识数量合计得出。</div>
        </div>
      <//>

      <${Sheet} open=${pick} onClose=${() => setPick(false)} title="颁给哪一位">
        <${List}>
          ${members.map(c => html`
            <${ListItem} key=${c.id} title=${phone.remark.nameOf(c)} arrow
              onClick=${() => { setPick(false); setGiving(c); }}/>`)}
        <//>
      <//>

      <${Sheet} open=${!!giving} onClose=${() => setGiving(null)} title=${`颁给${giving?.name || ''}`}>
        <div class="pad-x">
          <${Field} label="标识名" desc="不超过 24 个字">
            <${Input} value=${form.name} placeholder="例如：最会挑咖啡的人"
              onInput=${v => setForm(f => ({ ...f, name: v }))}/>
          <//>
          <${Field} label="理由" desc="可留空">
            <${Input} value=${form.reason} onInput=${v => setForm(f => ({ ...f, reason: v }))}/>
          <//>
          <${Button} full disabled=${!form.name.trim()} onClick=${give}>颁发<//>
        </div>
      <//>
    <//>`;
}

// ---- 年度回顾 ----

export function YearPage({ chatId }) {
  useStore(db.chats.store);
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const chat = db.chats.get(chatId);
  const view = useMemo(() => (chat ? B().yearOf(chatId, year, { words: false }) : null),
    [chatId, year, chat?.yearNotes, chat?.updatedAt]);
  // 最常说的词另算：分词慢，不挡着页面先出来
  const [words, setWords] = useState(null);
  useEffect(() => {
    setWords(null);
    const t = setTimeout(() => setWords(B().yearOf(chatId, year).words), 30);
    return () => clearTimeout(t);
  }, [chatId, year]);
  if (!chat || !view) return html`<${Page} title="年度回顾" onBack=${nav.pop}><${EmptyState} title="该会话已不存在"/><//>`;
  const inGroup = phone.group.isGroup(chat);
  const title = inGroup ? phone.group.titleOf(chat) : (db.characters.get((chat.characterIds || [])[0])?.name || '');
  const hm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  const write = async () => {
    setBusy(true);
    try {
      await ai.yearNote.write(chatId, year);
      toast('已写好', 'ok');
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setBusy(false); }
  };

  return html`
    <${Page} title=${`${year} 年回顾`} onBack=${nav.pop}>
      <div class="yr-head">
        <button class="nav-text press" onClick=${() => setYear(y => y - 1)}>上一年</button>
        <b>${title}</b>
        <button class=${`nav-text press${year >= new Date().getFullYear() ? ' is-off' : ''}`}
          onClick=${() => year < new Date().getFullYear() && setYear(y => y + 1)}>下一年</button>
      </div>
      ${view.n ? html`
        <div class="yr-grid">
          <div class="yr-cell"><b>${view.n}</b><span>条消息</span></div>
          <div class="yr-cell"><b>${view.activeDays}</b><span>天有来往</span></div>
          <div class="yr-cell"><b>${view.bothDays}</b><span>天互发</span></div>
          <div class="yr-cell"><b>${view.bestStreak}</b><span>天最长连续</span></div>
        </div>
        <${List}>
          ${view.busiest ? html`<${ListItem} title="最热闹的一天"
            subtitle=${`${new Date(view.busiest.at).toLocaleDateString('zh-CN')}，共 ${view.busiest.n} 条`}
            left=${html`<${Icon} name="sparkle" size=${18}/>`}/>` : null}
          ${view.latest ? html`<${ListItem} title="最晚的一次"
            subtitle=${`${new Date(view.latest).toLocaleDateString('zh-CN')} ${hm(view.latest)}`}
            left=${html`<${Icon} name="moon" size=${18}/>`}/>` : null}
          <${ListItem} title="双方各自说了多少"
            subtitle=${`我 ${view.nU} 条 · ${inGroup ? '成员' : title} ${view.nC} 条`}
            left=${html`<${Icon} name="message" size=${18}/>`}/>
          <${ListItem} title="最常说的词" multiline
            subtitle=${words === null ? '正在统计' : (words.map(x => `${x.w}（${x.n}）`).join('、') || '无')}
            left=${html`<${Icon} name="notes" size=${18}/>`}/>
          <${ListItem} title="这一年解锁的标识" multiline
            subtitle=${[...view.unlocked.map(id => viewOf(id).name), ...view.limited.map(id => viewOf(id).name),
              ...view.awards.map(a => `${a.name}（${nameOfId(a.by)} 颁发）`)].join('、') || '无'}
            left=${html`<${Icon} name="medal" size=${18}/>`}/>
        <//>
        ${inGroup ? null : html`
          <${List} title=${`${title}写的一段话`}>
            ${view.note ? html`<div class="yr-note">${view.note}</div>` : null}
            <${ListItem} title=${busy ? '正在写' : view.note ? '重新写一段' : '请角色写一段'} arrow multiline
              subtitle="按上面这些数字与聊天记录，由角色写一段回顾。调用一次接口，点击时才调用。"
              left=${busy ? html`<${Spinner} size=${16}/>` : html`<${Icon} name="edit" size=${18}/>`}
              onClick=${() => !busy && write()}/>
          <//>`}
      ` : html`<${EmptyState} icon="calendar" title="这一年没有消息"/>`}
    <//>`;
}

import { html, useState, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, IconButton, Field, Input, Textarea,
         Switch, Sheet, EmptyState, toast, confirm, prompt } from '../../ui/index.js';

const { db, nav, todo, alarm, when } = phone;

// 待办。用户自己的那一份 —— 角色的日程在「日常」，你们之间的约定在「你们之间」。
//
// 进来的路有三条：对话里本地识别、角色在回复里写 [待办：…]、自己在这一页添加。
// 前两条都只落成待确认，点头才算（见 system/todo.js 开头那段）。

const dayText = ms => {
  if (!ms) return '';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const timeText = ms => {
  if (!ms) return '';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${dayText(ms)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 这条上的时刻怎么说。挂了闹钟的和只写了时刻的要分得清 ——
// 前者关掉 app 也会响，后者只在开着的时候提醒
const remindText = row => {
  const ms = alarm.timeOf(row);
  if (!ms) return '';
  const when = timeText(ms);
  if (row.alarmId) return `${when} 系统闹钟`;
  return alarm.isFuture(ms) ? `${when} 提醒` : `${when} 已过`;
};

const chatName = row => {
  if (!row.charId) return '';
  return db.characters.get(row.charId)?.name || '已删除的角色';
};

function Row({ row, onOpen }) {
  const done = row.state === todo.DONE;
  return html`
    <${ListItem} multiline title=${row.text}
      subtitle=${[remindText(row), todo.fromLabel(row.from), chatName(row), row.dueAt,
        done ? `完成于 ${dayText(row.doneAt)}` : ''].filter(Boolean).join(' · ')}
      left=${html`
        <button class="press todo-tick" aria-label=${done ? '标为未完成' : '标为已完成'}
          onClick=${e => { e.stopPropagation(); todo.setState(row.id, done ? todo.OPEN : todo.DONE); }}>
          <${Icon} name=${done ? 'check' : 'clock'} size=${18}/>
        </button>`}
      arrow onClick=${() => onOpen(row)}/>`;
}

function MainPage() {
  useStore(db.todos.store);
  useStore(db.characters.store);
  useStore(db.settings.store);
  const [tab, setTab] = useState('open');
  const [editing, setEditing] = useState(null);

  const ask = todo.pendingAll();
  const open = todo.openOnes();
  const done = todo.doneOnes();
  const list = tab === 'done' ? done : open;

  const add = async () => {
    const t = await prompt({ title: '添加待办', placeholder: '要做的事' });
    const row = todo.addMine(t);
    if (row) setEditing(row);
  };

  return html`
    <${Page} title="待办"
      right=${html`
        <${IconButton} name="bell" label="系统闹钟"
          onClick=${() => nav.push('/alarm')}/>
        <${IconButton} name="settings" label="识别设置"
          onClick=${() => nav.push('/detect')}/>
        <button class="nav-text press" onClick=${add}>添加</button>`}>

      ${ask.length ? html`
        <${List} title=${`等待确认 ${ask.length} 条`}>
          ${ask.map(r => html`
            <${ListItem} key=${r.id} multiline title=${r.text}
              subtitle=${[todo.fromLabel(r.from), chatName(r)].filter(Boolean).join(' · ')}
              right=${html`
                <span class="todo-acts">
                  <button class="nav-text press"
                    onClick=${() => todo.accept(r.id)}>计入</button>
                  <button class="nav-text press is-off"
                    onClick=${() => todo.ignore(r.id)}>忽略</button>
                </span>`}/>`)}
        <//>
        <div class="pad-x">
          <div class="hint-box">
            对话中识别到的与角色提出的均先列在此处，计入之后才成为待办。
            忽略的条目不再重复提示，可在识别设置中清除。
          </div>
        </div>` : null}

      <div class="pad-x pad-t">
        <div class="chip-row">
          <button class=${`chip${tab === 'open' ? ' is-active' : ''}`}
            onClick=${() => setTab('open')}>未完成 ${open.length}</button>
          <button class=${`chip${tab === 'done' ? ' is-active' : ''}`}
            onClick=${() => setTab('done')}>已完成 ${done.length}</button>
        </div>
      </div>

      ${list.length ? html`
        <${List}>
          ${list.map(r => html`<${Row} key=${r.id} row=${r} onOpen=${setEditing}/>`)}
        <//>`
      : html`<${EmptyState} icon="check"
          title=${tab === 'done' ? '尚无已完成的待办' : '尚无待办'}
          desc=${tab === 'done' ? '完成的条目会列在此处。'
            : '可在此处添加，或在对话中由系统识别与角色提出，确认后计入。'}
          action=${tab === 'open'
            ? html`<${Button} size="sm" icon="plus" onClick=${add}>添加待办<//>` : null}/>`}

      ${editing ? html`<${EditSheet} id=${editing.id} onClose=${() => setEditing(null)}/>` : null}
    <//>`;
}

function EditSheet({ id, onClose }) {
  useStore(db.todos.store);
  const row = todo.get(id);
  if (!row) return null;
  const patch = p => todo.update(id, p);

  return html`
    <${Sheet} open=${true} onClose=${onClose} title="编辑待办">
        <div class="pad">
          <${Field} label="内容">
            <${Textarea} rows=${2} value=${row.text} onInput=${v => patch({ text: v })}/>
          <//>
          <${Field} label="日期" desc="填写形如 2026-09-30 的日期，留空表示不限定时间。">
            <${Input} value=${row.dueAt || ''} placeholder="2026-09-30"
              onInput=${v => patch({ dueAt: v.trim() })}/>
          <//>
          <${Clock} row=${row}/>
          <${List}>
            <${ListItem} title="已完成"
              right=${html`<${Switch} checked=${row.state === todo.DONE}
                onChange=${v => todo.setState(id, v ? todo.DONE : todo.OPEN)}/>`}/>
          <//>
          <div class="settings-foot">
            来源：${todo.fromLabel(row.from)}${chatName(row) ? ` · ${chatName(row)}` : ''}
          </div>
          <${Button} full variant="danger" onClick=${async () => {
            if (!await confirm({ title: '删除这条待办', danger: true })) return;
            todo.remove(id);
            onClose();
          }}>删除<//>
        </div>
    <//>`;
}

/**
 * 一条待办上的时刻与闹钟。
 *
 * 分两层说清楚，因为它们的可靠程度差很远：
 *   写了时刻          本应用开着的时候到点提醒。关掉就不响 —— 网页没有后台调度
 *   排进系统闹钟      交给系统，关掉也响，穿透静音。要装成 ipa 且系统够新
 */
function Clock({ row }) {
  const ms = alarm.timeOf(row);
  // 输入框里放原话。人写的是「明天七点」，回头再看到的也该是这句话，
  // 不是换算之后的那一串数字
  const [text, setText] = useState(row.whenText || (ms ? when.show(ms) : ''));
  const [busy, setBusy] = useState(false);
  const native = alarm.available();
  const read = when.parse(text);
  const at = read?.hasTime ? read.at : 0;

  const apply = async v => {
    setText(v);
    const got = when.parse(v);
    const next = got?.hasTime ? got.at : 0;
    if (!next) { db.todos.update(row.id, { remindAt: 0, rungAt: 0, whenText: v }); return; }
    setBusy(true);
    try {
      await alarm.reschedule(row.id, next);
      db.todos.update(row.id, { rungAt: 0, whenText: v });
    } catch (err) {
      toast(String(err.message || err), 'error', 5000);
    } finally { setBusy(false); }
  };

  return html`
    <${Field} label="提醒时刻"
      desc=${'可直接填写「明天七点」「后天下午三点半」「周四上午十点」一类的说法，'
        + '也可填写具体日期与时刻。按当前的真实时间折算，与对话中设定的时间无关。'
        + (native
          ? '设定后排入系统闹钟，关闭本应用仍会在该时刻响铃。'
          : '当前环境无法排入系统闹钟，仅在本应用运行时到点提醒。')}>
      <${Input} value=${text} placeholder="明天七点"
        onInput=${v => apply(v)}/>
      <div class="settings-foot">
        ${text.trim()
          ? (at ? `识别为 ${when.show(at)}`
            : (read ? '只识别出日期，没有识别出时刻。补上「七点」一类的说法才能提醒。'
              : '没有识别出时间。'))
          : '留空表示不提醒。'}
      </div>
    <//>
    ${ms ? html`
      <${List}>
        <${ListItem} title=${row.alarmId ? '已排入系统闹钟' : '尚未排入系统闹钟'} multiline
          subtitle=${row.alarmId
            ? `将于 ${timeText(ms)} 响铃，关闭本应用后仍然有效。`
            : (alarm.isFuture(ms)
              ? `将于 ${timeText(ms)} 在本应用内提醒，关闭本应用后不再提醒。`
              : '该时刻已经过去。')}
          left=${html`<${Icon} name="bell" size=${18}/>`}
          right=${busy ? null : html`
            <button class="nav-text press"
              onClick=${async () => {
                if (row.alarmId) { await alarm.cancel(row.id); toast('已撤销系统闹钟', 'ok'); return; }
                const r = await alarm.schedule(row.id);
                toast(r.native ? '已排入系统闹钟' : '当前环境无法排入系统闹钟',
                  r.native ? 'ok' : 'plain', 4000);
              }}>${row.alarmId ? '撤销' : '排入'}</button>`}/>
      <//>` : null}`;
}

function DetectPage() {
  useStore(db.settings.store);
  useStore(db.todos.store);
  const s = db.settings.get();
  const [draft, setDraft] = useState(null);
  const [skipDraft, setSkipDraft] = useState(null);

  const cues = todo.cues();
  const skips = todo.skips();
  const dropped = todo.listOfState(todo.DROP);

  return html`
    <${Page} title="识别设置" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="hint-box">
          两处各看一遍。本地识别比对下方的线索词，不调用接口；
          角色识别由角色在回复中给出，随回复一并返回，同样不额外调用接口。
          两者均先列为等待确认，确认后才成为待办。
        </div>
      </div>

      <${List} title="本地识别">
        <${ListItem} title="在对话中识别待办" multiline
          subtitle=${s.todoDetect === false
            ? '已关闭。发出的消息不再比对线索词。'
            : '发出消息时比对下方线索词，命中后列为等待确认。'}
          right=${html`<${Switch} checked=${s.todoDetect !== false}
            onChange=${v => db.settings.set({ todoDetect: v })}/>`}/>
      <//>

      <div class="pad">
        <${Field} label="线索词" desc="每行一条。消息中出现其中一条即列为等待确认，全部删除即等同于关闭本地识别。">
          <${Textarea} rows=${6} value=${draft ?? cues.join('\n')}
            onInput=${v => {
              setDraft(v);
              db.settings.set({ todoCues: v.split(/\r?\n/).map(x => x.trim()).filter(Boolean) });
            }}
            onBlur=${() => setDraft(null)}/>
        <//>
        <${Field} label="排除词" desc="线索词后紧接这些内容时不计入。例如「我想你」含有线索词「我想」，但并非待办。">
          <${Textarea} rows=${5} value=${skipDraft ?? skips.join('\n')}
            onInput=${v => {
              setSkipDraft(v);
              db.settings.set({ todoSkips: v.split(/\r?\n/).map(x => x.trim()).filter(Boolean) });
            }}
            onBlur=${() => setSkipDraft(null)}/>
        <//>
        <${Button} full variant="ghost" onClick=${() => {
          db.settings.set({ todoCues: null, todoSkips: null });
          setDraft(null); setSkipDraft(null);
          toast('已恢复默认', 'ok');
        }}>恢复默认的线索词与排除词<//>
      </div>

      <${List} title="角色识别">
        <${ListItem} title="由角色提出待办" multiline
          subtitle=${'该项按角色分别设置，位于会话菜单的「能力开关」中。'
            + '开启后角色可在回复中提出待办，随回复一并返回，不额外调用接口。'}/>
      <//>

      ${dropped.length ? html`
        <${List} title=${`已忽略 ${dropped.length} 条`}>
          <${ListItem} title="清除已忽略的条目" multiline arrow
            subtitle="已忽略的条目保留下来是为了不再重复提示。清除之后，同样的内容会重新提示。"
            onClick=${async () => {
              if (!await confirm({ title: '清除已忽略的条目', message: `共 ${dropped.length} 条。` })) return;
              toast(`已清除 ${todo.clearDropped()} 条`, 'ok');
            }}/>
        <//>` : null}
    <//>`;
}

/**
 * 系统闹钟这一页只干一件事：**对账**。
 *
 * 排了没响是这类功能里最难查的一种 —— 屏幕上写着「已排入」，到点没动静，
 * 而你分不清是没排上、没授权、还是系统把它清了。所以把两边的数都摆出来：
 * 本应用以为排了几个，系统那边实际挂着几个。
 */
function AlarmPage() {
  useStore(db.todos.store);
  const [sys, setSys] = useState(null);
  const [busy, setBusy] = useState(false);
  const native = alarm.available();

  const refresh = async () => {
    if (!native) { setSys({ status: 'unsupported' }); return; }
    setBusy(true);
    try {
      const [st, ls] = await Promise.all([alarm.status(), alarm.listNative()]);
      setSys({ ...st, ids: ls.ids || [] });
    } catch (err) {
      setSys({ status: 'error', error: String(err.message || err) });
    } finally { setBusy(false); }
  };

  useEffect(() => { refresh(); }, []);

  const next = alarm.upcoming();
  const mine = db.todos.where(r => r.alarmId);
  const pairs = alarm.reconcile(sys?.ids);
  const statusText = {
    granted: '已授权',
    denied: '已拒绝。可在系统设置中重新开启',
    notDetermined: '尚未询问',
    unsupported: '当前环境不支持',
    error: '读取失败',
  };

  return html`
    <${Page} title="系统闹钟" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${refresh}>刷新</button>`}>
      <div class="pad-x pad-t">
        <div class="hint-box">
          系统闹钟由系统在设定的时刻响铃，关闭本应用后仍然有效，并可穿透静音与专注模式。
          该能力需要将本应用安装为应用，且系统为 iOS 26 或更新的版本。
          不满足时，待办的时刻仅在本应用运行时提醒。
        </div>
      </div>

      <${List} title="当前状态">
        <${ListItem} title="系统闹钟通道" multiline
          subtitle=${native ? '可用' : '不可用。当前为浏览器环境，或系统版本不满足要求'}
          left=${html`<${Icon} name=${native ? 'check' : 'close'} size=${18}/>`}/>
        <${ListItem} title="授权状态" multiline
          subtitle=${busy ? '正在读取' : (statusText[sys?.status] || '未知')
            + (sys?.error ? `：${sys.error}` : '')}
          left=${html`<${Icon} name="lock" size=${18}/>`}
          right=${native && sys?.status !== 'granted' ? html`
            <button class="nav-text press" onClick=${async () => {
              try { await alarm.request(); } catch (err) { toast(String(err.message || err), 'error', 5000); }
              refresh();
            }}>请求授权</button>` : null}/>
        <${ListItem} title="两边对账" multiline
          subtitle=${`本应用记录已排入 ${mine.length} 个`
            + (sys?.ids ? `，系统中实际挂着 ${sys.ids.length} 个。`
              + (sys.ids.length === mine.length ? '两边一致。' : '两边不一致，可逐条撤销后重新排入。')
              : '。系统一侧的数目需要在支持的环境中读取。')}
          left=${html`<${Icon} name="layers" size=${18}/>`}/>
      <//>

      ${pairs.length ? html`
        <${List} title=${`逐条对账 ${pairs.length} 条`}>
          ${pairs.map(r => html`
            <${ListItem} key=${r.id} multiline title=${r.text}
              subtitle=${`${when.show(r.at)} · `
                + (sys?.ids
                  ? (r.known ? '系统中已登记' : '系统中没有这一条。可撤销后重新排入')
                  : '系统一侧的登记情况需要在支持的环境中读取')}
              left=${html`<${Icon} name=${r.known ? 'check' : 'close'} size=${18}/>`}/>`)}
        <//>` : null}

      ${next.length ? html`
        <${List} title=${`即将到时 ${next.length} 条`}>
          ${next.map(r => html`
            <${ListItem} key=${r.id} multiline title=${r.text}
              subtitle=${remindText(r)}
              left=${html`<${Icon} name="bell" size=${18}/>`}/>`)}
        <//>`
      : html`<${EmptyState} icon="clock" title="没有即将到时的待办"
          desc="在待办的编辑面板中填写提醒时刻后，此处会列出。"/>`}
    <//>`;
}

export default function TodoApp({ route }) {
  if (route === '/detect') return html`<${DetectPage}/>`;
  if (route === '/alarm') return html`<${AlarmPage}/>`;
  return html`<${MainPage}/>`;
}

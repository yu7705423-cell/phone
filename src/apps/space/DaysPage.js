import { html, useState, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Sheet, Button, Field, Input, Switch,
         Icon, IconButton, EmptyState, toast, confirm } from '../../ui/index.js';

const { db, nav, space } = phone;

const BLANK = { id: '', title: '', date: '', yearly: true };

function Editor({ open, chatId, item, onClose }) {
  const [cur, setCur] = useState(BLANK);
  // 每次打开都从头装一次。不这么做的话，标题删空的那一瞬间就分不清
  // 「用户清空了」和「还没开始编辑」，草稿会自己跳回上一条。
  useEffect(() => { if (open) setCur(item ? { ...BLANK, ...item } : BLANK); }, [open, item]);
  const set = patch => setCur(c => ({ ...c, ...patch }));

  const save = () => {
    try {
      if (cur.id) space.updateDay(cur.id, cur);
      else space.addDay({ chatId, title: cur.title, date: cur.date, yearly: cur.yearly });
      onClose();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  return html`
    <${Sheet} open=${open} onClose=${onClose}
      title=${item ? '编辑纪念日' : '添加纪念日'}>
      <div class="pad">
        <${Field} label="名称" desc="显示在空间与上下文中，例如「认识的日子」。">
          <${Input} value=${cur.title} onInput=${v => set({ title: v })}
            placeholder="纪念日名称"/>
        <//>
        <${Field} label="日期">
          <input class="dt-input" type="date" value=${cur.date}
            onInput=${e => set({ date: e.target.value })}/>
        <//>
        <${List}>
          <${ListItem} title="每年重复" multiline
            subtitle="开启后每年的这一天都会提醒，倒计时滚动到下一年。关闭则只在当年生效，过期后排在列表末尾。"
            right=${html`<${Switch} checked=${cur.yearly !== false}
              onChange=${v => set({ yearly: v })}/>`}/>
        <//>
        <div class="pad-t">
          <${Button} full onClick=${save}>保存<//>
        </div>
      </div>
    <//>`;
}

export function DaysPage({ chatId }) {
  useStore(db.spaceItems.store);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const list = space.upcoming(chatId);

  const close = () => { setOpen(false); setEditing(null); };
  const del = async it => {
    if (!await confirm({ title: '删除纪念日', message: `将删除「${it.title}」。`, danger: true })) return;
    space.removeDay(it.id);
  };

  const sub = x => {
    const d = x.item.date;
    const when = x.item.yearly !== false ? `每年 ${d.slice(5)}` : d;
    if (x.left < 0) return `${when} · 已过`;
    if (x.left === 0) return `${when} · 就是今天`;
    return `${when} · 还有 ${x.left} 天`;
  };

  return html`
    <${Page} title="纪念日" onBack=${nav.pop}
      right=${html`<${IconButton} name="plus" label="添加"
        onClick=${() => { setEditing(null); setOpen(true); }}/>`}>
      ${list.length ? html`
        <${List}>
          ${list.map(x => html`
            <${ListItem} key=${x.item.id} title=${x.item.title} subtitle=${sub(x)} multiline
              left=${html`<${Icon} name="calendar" size=${19}/>`}
              right=${html`<${IconButton} name="trash" size=${17} label="删除"
                onClick=${e => { e.stopPropagation(); del(x.item); }}/>`}
              onClick=${() => { setEditing(x.item); setOpen(true); }}/>`)}
        <//>
        <div class="settings-foot">
          开启空间中的「让角色知道这些」后，三十天以内的纪念日会随对话一起告知角色。
        </div>`
      : html`<${EmptyState} icon="calendar" title="还没有纪念日"
          desc="添加后可在空间中查看倒计时。"
          action=${html`<${Button} size="sm"
            onClick=${() => { setEditing(null); setOpen(true); }}>添加纪念日<//>`}/>`}

      <${Editor} open=${open} chatId=${chatId} item=${editing} onClose=${close}/>
    <//>`;
}

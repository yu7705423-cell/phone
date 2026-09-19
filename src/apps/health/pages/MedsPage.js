import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Switch, Icon, Sheet,
         EmptyState, toast, confirm } from '../../../ui/index.js';

const { db, nav, health } = phone;

// 用药。只记「在吃什么、什么时候吃」，到点本地提醒一下。
// **不给任何用药建议**，剂量写什么是你自己的事，这里一个字都不评。
export function MedsPage() {
  useStore(db.meds.store);
  useStore(db.health.store);
  useStore(db.settings.store);
  const [editing, setEditing] = useState(null);

  const list = health.listMeds();
  const s = db.settings.get();

  const save = row => {
    try {
      const times = String(row.times || '').split(/[,，、\s]+/)
        .map(t => t.trim()).filter(t => /^\d{1,2}:\d{2}$/.test(t))
        .map(t => t.padStart(5, '0'));
      if (row.id) health.updateMed(row.id, { name: row.name.trim(), dose: row.dose, times, note: row.note });
      else health.addMed({ name: row.name, dose: row.dose, times, note: row.note });
      setEditing(null);
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const drop = async m => {
    if (!await confirm({ title: `删除「${m.name}」`, danger: true,
      message: '已经记下的服用记录不受影响。' })) return;
    health.removeMed(m.id);
    setEditing(null);
  };

  const blank = { id: '', name: '', dose: '', times: '', note: '' };

  return html`
    <${Page} title="用药" onBack=${nav.pop}
      right=${html`<button class="nav-text press"
        onClick=${() => setEditing(blank)}>添加</button>`}>

      <${List}>
        <${ListItem} title="到点提醒" multiline
          subtitle="到设定的时间且当天还没有记下时，在本机发一条通知。不调用任何接口，也不上传。"
          right=${html`<${Switch} checked=${s.medRemind !== false}
            onChange=${v => db.settings.set({ medRemind: v })}/>`}/>
      <//>

      ${list.length ? html`
        <${List} title=${`共 ${list.length} 项`}>
          ${list.map(m => html`
            <${ListItem} key=${m.id} title=${m.name} arrow multiline
              subtitle=${[m.dose, (m.times || []).join('、'),
                m.active === false ? '已停用' : ''].filter(Boolean).join(' · ') || '没有设定时间'}
              left=${html`<${Icon} name="bookmark" size=${18}/>`}
              onClick=${() => setEditing({ id: m.id, name: m.name, dose: m.dose,
                times: (m.times || []).join(' '), note: m.note })}/>`)}
        <//>`
      : html`
        <${EmptyState} icon="bookmark" title="还没有记录"
          desc="记下在吃什么、什么时候吃。这里只做记录与提醒，不提供任何用药建议。"
          action=${html`<${Button} size="sm" icon="plus"
            onClick=${() => setEditing(blank)}>添加<//>`}/>`}

      <${Sheet} open=${!!editing} onClose=${() => setEditing(null)}
        title=${editing?.id ? '编辑' : '添加'} height="80%">
        ${editing ? html`
          <div class="pad-x">
            <${Field} label="名称">
              <${Input} value=${editing.name} placeholder="名称"
                onInput=${v => setEditing({ ...editing, name: v })}/>
            <//>
            <${Field} label="用量" desc="怎么写都可以，这里只是照原样记下来。">
              <${Input} value=${editing.dose} placeholder="可留空"
                onInput=${v => setEditing({ ...editing, dose: v })}/>
            <//>
            <${Field} label="时间"
              desc="24 小时制，多个时间用空格隔开，例如 08:00 20:00。留空则不提醒。">
              <${Input} value=${editing.times} placeholder="08:00 20:00"
                onInput=${v => setEditing({ ...editing, times: v })}/>
            <//>
            <${Field} label="备注">
              <${Input} value=${editing.note} placeholder="可留空"
                onInput=${v => setEditing({ ...editing, note: v })}/>
            <//>
            ${editing.id ? html`
              <${List} inset=${false}>
                <${ListItem} title="启用" multiline
                  subtitle="停用之后不再出现在今天的清单里，也不再提醒。已记的不受影响。"
                  right=${html`<${Switch}
                    checked=${db.meds.get(editing.id)?.active !== false}
                    onChange=${v => health.updateMed(editing.id, { active: v })}/>`}/>
              <//>` : null}
            <div class="batch-acts pad-b">
              <${Button} disabled=${!editing.name.trim()} onClick=${() => save(editing)}>保存<//>
              ${editing.id ? html`
                <${Button} variant="ghost" danger
                  onClick=${() => drop(db.meds.get(editing.id))}>删除<//>` : null}
            </div>
          </div>` : null}
      <//>
    <//>`;
}

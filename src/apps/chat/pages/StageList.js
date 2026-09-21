import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, IconButton, Button, Input, Textarea, Field,
         Segmented, Avatar, EmptyState, FullSheet, toast, confirm } from '../../../ui/index.js';

const { db, nav, scene: sceneApi } = phone;

// 线下的场次列表。一条就是一篇稿子的目录行，不画卡片。
// 见 ARCHITECTURE 4.107

const dateOf = ts => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

function SetupFields({ v, set, cast, chatChars }) {
  return html`
    <${Field} label="标题" desc="留空时列表中显示地点。">
      <${Input} value=${v.title} onInput=${v => set({ title: v })}
        placeholder="这一场叫什么"/>
    <//>
    <${Field} label="地点" desc="作为这一场的事实进入上下文，也盖在邮戳上。">
      <${Input} value=${v.place} onInput=${v => set({ place: v })}
        placeholder="例如 旧书店"/>
    <//>
    <${Field} label="时刻" desc="这一场从什么时候开始。之后由正文里的时间标记继续推进。">
      <${Input} value=${v.at} onInput=${v => set({ at: v })}
        placeholder="例如 2026-01-01 周三 14:30"/>
    <//>
    <${Field} label="情境" desc="这一场的前提。作为事实进入上下文，不作为写法上的要求。">
      <${Textarea} rows=${3} value=${v.note} onInput=${v => set({ note: v })}
        placeholder="例如 两人约好在这里见面，但对方迟到了四十分钟"/>
    <//>
    ${chatChars.length > 1 ? html`
      <${Field} label="在场角色">
        <${List}>
          ${chatChars.map(c => html`
            <${ListItem} key=${c.id} title=${c.name}
              left=${html`<${Avatar} src=${c.avatar} name=${c.name} size=${32}/>`}
              right=${cast.includes(c.id) ? '在场' : '不在'}
              onClick=${() => set({
    castIds: cast.includes(c.id) ? cast.filter(x => x !== c.id) : [...cast, c.id],
  })}/>`)}
        <//>
      <//>` : null}`;
}

export function StageList({ chatId }) {
  useStore(db.scenes.store);
  useStore(db.beats.store);
  useStore(db.chats.store);
  useStore(db.characters.store);

  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ title: '', place: '', at: '', note: '', castIds: [], opening: 'char' });
  const set = patch => setV(x => ({ ...x, ...patch }));

  const chat = db.chats.get(chatId);
  const chatChars = (chat?.characterIds || []).map(id => db.characters.get(id)).filter(Boolean);
  const list = sceneApi.ofChat(chatId);

  if (!chat) {
    return html`<${Page} title="线下" onBack=${nav.pop}><div class="pad">这段会话已经不在了。</div><//>`;
  }

  const cast = v.castIds.length ? v.castIds : chatChars.map(c => c.id);

  const start = () => {
    const row = sceneApi.create({
      chatId, title: v.title, place: v.place, at: v.at, note: v.note,
      castIds: cast, opening: v.opening,
    });
    setOpen(false);
    setV({ title: '', place: '', at: '', note: '', castIds: [], opening: 'char' });
    nav.push(`/scene/${row.id}`);
  };

  const removeOne = async row => {
    const ok = await confirm({
      title: '删除这一场', message: '这一场的全部正文将一并删除，无法恢复。',
      okText: '删除', danger: true,
    });
    if (ok) { sceneApi.remove(row.id); toast('已删除', 'ok'); }
  };

  return html`
    <${Page} title="线下" onBack=${nav.pop}
      right=${html`<${IconButton} name="plus" onClick=${() => setOpen(true)} label="新建"/>`}>

      ${list.length ? html`
        <${List}>
          ${list.map(row => {
    const n = db.beats.byIndex(row.id).filter(b => b.role !== 'director').length;
    // 标题留空时列表显示地点，那时副标题里就不必再写一遍
    const meta = [row.title ? row.place : '', `${n} 段`,
      dateOf(row.updatedAt || row.createdAt)].filter(Boolean).join(' · ');
    return html`
              <${ListItem} key=${row.id} title=${row.title || row.place || '未命名'}
                subtitle=${meta} arrow
                onClick=${() => nav.push(`/scene/${row.id}`)}
                right=${html`<${IconButton} name="trash" label="删除"
                  onClick=${e => { e.stopPropagation(); removeOne(row); }}/>`}/>`;
  })}
        <//>`
    : html`<${EmptyState} icon="book" title="还没有线下场次"
        desc="线下以成段的文字推进，与线上的消息分开保存。"
        action=${html`<${Button} onClick=${() => setOpen(true)}>新建一场<//>`}/>`}
    <//>
    ${open ? html`
      <${FullSheet} open=${open} onClose=${() => setOpen(false)} title="新建一场"
        right=${html`<${Button} size="sm" onClick=${start}>开始<//>`}>
        <div class="pad">
          <${Field} label="由谁开场">
            <${Segmented} value=${v.opening} onChange=${x => set({ opening: x })}
              items=${[{ value: 'char', label: '让角色开场' }, { value: 'me', label: '我自己写' }]}/>
          <//>
          <${SetupFields} v=${v} set=${set} cast=${cast} chatChars=${chatChars}/>
        </div>
      <//>` : null}`;
}

export function SceneEdit({ sceneId }) {
  useStore(db.scenes.store);
  useStore(db.characters.store);
  useStore(db.chats.store);

  const row = sceneApi.get(sceneId);
  const chat = row ? db.chats.get(row.chatId) : null;
  const chatChars = (chat?.characterIds || []).map(id => db.characters.get(id)).filter(Boolean);

  if (!row) {
    return html`<${Page} title="这一场" onBack=${nav.pop}><div class="pad">这一场已经不在了。</div><//>`;
  }

  const v = {
    title: row.title || '', place: row.place || '', at: row.at || '',
    note: row.note || '', castIds: row.castIds || [],
  };
  const set = patch => sceneApi.update(sceneId, patch);

  return html`
    <${Page} title="这一场" onBack=${nav.pop}>
      <div class="pad">
        <${SetupFields} v=${v} set=${set} cast=${v.castIds} chatChars=${chatChars}/>
        ${row.summary ? html`
          <${Field} label="摘要" desc="收场或压缩时生成。线上也读得到这一段。">
            <${Textarea} rows=${5} value=${row.summary}
              onInput=${v => set({ summary: v })}/>
          <//>` : null}
      </div>
    <//>`;
}

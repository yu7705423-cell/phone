import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, IconButton, Icon, Button, Input, Textarea, Field,
         Segmented, Avatar, EmptyState, Sheet, FullSheet, Switch, toast, confirm } from '../../../ui/index.js';

const { db, nav, scene: sceneApi, tone, ai } = phone;

// 线下的场次列表。一条就是一篇稿子的目录行，不画卡片。
// 见 ARCHITECTURE 4.107

const dateOf = ts => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

// 文风。内置提示词一个字都不写文风（第 16 条），要写也是用户自己写 ——
// 这里就是他写的地方。默认不设定，出厂那几份一份都不启用。可以选多份（4.267）
function ToneField({ v, set }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);

  const presets = tone.list();
  const picked = tone.idsOf(v);
  const label = tone.labelOf(v);
  const flip = id => set({ tones: picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id] });
  const tick = (on, id) => html`<${Switch} checked=${on} onChange=${() => flip(id)}/>`;
  const firstLine = t => String(t || '').split('\n')[0];

  const drop = async row => {
    const ok = await confirm({
      title: `删除「${row.name}」`,
      message: row.builtin ? '内置的这一份将不再出现，可以在下方恢复。' : '删除后无法恢复。',
      okText: '删除', danger: true,
    });
    if (!ok) return;
    tone.remove(row.id);
    if (picked.includes(row.id)) set({ tones: picked.filter(x => x !== row.id) });
  };

  return html`
    <${Field} label="文风"
      desc="写入这一场的提示词，只管怎么写，不管角色是什么人。可以选多份，按选中的顺序依次写入。默认不设定，由角色卡与世界书决定。">
      <${Button} variant="ghost" size="sm" onClick=${() => setOpen(true)}>${label}<//>
    <//>
    ${picked.includes('custom') ? html`
      <${Textarea} rows=${5} value=${v.toneText || ''} onInput=${t => set({ toneText: t })}
        placeholder="写这一场要的文风。可以用 {{charName}} 与 {{userName}} 指代双方。"/>` : null}

    <${Sheet} open=${open} onClose=${() => setOpen(false)} title="文风" height="84%">
      <${List}>
        <${ListItem} title="不设定" multiline
          subtitle="不写入任何关于文风的内容"
          right=${picked.length ? null : '当前'} onClick=${() => set({ tones: [] })}/>
        ${presets.map(p => html`
          <${ListItem} key=${p.id} title=${p.name} subtitle=${firstLine(p.text)} multiline
            right=${html`<div class="row-acts">
              <${IconButton} name="edit" label="编辑"
                onClick=${e => { e.stopPropagation(); setEdit({ ...p }); }}/>
              <${IconButton} name="trash" label="删除"
                onClick=${e => { e.stopPropagation(); drop(p); }}/>
              ${tick(picked.includes(p.id), p.id)}
            </div>`}
            onClick=${() => flip(p.id)}/>`)}
        <${ListItem} title="这一场自己写" multiline
          subtitle="只作用于这一场，不进预设库"
          right=${tick(picked.includes('custom'), 'custom')} onClick=${() => flip('custom')}/>
      <//>
      <${List}>
        <${ListItem} title="新建一份" onClick=${() => setEdit({ id: '', name: '', text: '' })}/>
        <${ListItem} title="恢复出厂的几份" multiline
          subtitle="改过或删掉的内置预设回到原样。自己新建的不受影响"
          onClick=${() => { tone.resetBuiltin(); toast('已恢复', 'ok'); }}/>
      <//>
    <//>

    <${FullSheet} open=${!!edit} onClose=${() => setEdit(null)}
      title=${edit?.id ? '编辑文风' : '新建文风'}
      right=${html`<${Button} size="sm" onClick=${() => {
    const name = String(edit.name || '').trim() || '未命名';
    const text = String(edit.text || '').trim();
    if (edit.id) tone.save(edit.id, { name, text });
    else set({ tones: [...picked, tone.create({ name, text })] });
    setEdit(null);
  }}>保存<//>`}>
      <div class="pad">
        <${Field} label="名称">
          <${Input} value=${edit?.name || ''} placeholder="例如 克制"
            onInput=${x => setEdit(e => ({ ...e, name: x }))}/>
        <//>
        <${Field} label="正文"
          desc="这段话会原样写进提示词。英文写的指令不容易把措辞漏进输出里。
            可以用 {{charName}} 与 {{userName}} 指代双方。">
          <${Textarea} rows=${12} value=${edit?.text || ''}
            onInput=${x => setEdit(e => ({ ...e, text: x }))}/>
        <//>
      </div>
    <//>`;
}

// 这一场用哪几本世界书（4.268）。上半是角色已挂的与全局的，默认开，关掉的记进 offBookIds；
// 下半是库里其余对话用途的书，默认关，打开的记进 bookIds。生图与语音用途的不列。
function BooksField({ v, set, chatChars }) {
  useStore(db.lorebooks.store);
  const [open, setOpen] = useState(false);
  const off = v.offBookIds || [];
  const on = v.bookIds || [];
  const attached = new Set(chatChars.flatMap(c => c.lorebookIds || []));
  const books = db.lorebooks.all().filter(b => ai.lore.purposeOf(b) === 'chat');
  const mine = books.filter(b => b.global || attached.has(b.id));
  const rest = books.filter(b => !(b.global || attached.has(b.id)));
  const nOn = mine.filter(b => !off.includes(b.id)).length + on.filter(id => rest.some(b => b.id === id)).length;
  const nOff = mine.filter(b => off.includes(b.id)).length;
  const label = books.length ? `${nOn} 本生效${nOff ? `，关掉 ${nOff} 本` : ''}` : '没有世界书';
  const flipOff = id => set({ offBookIds: off.includes(id) ? off.filter(x => x !== id) : [...off, id] });
  const flipOn = id => set({ bookIds: on.includes(id) ? on.filter(x => x !== id) : [...on, id] });
  return html`
    <${Field} label="世界书"
      desc="这一场生效的世界书。角色已挂的与全局的默认生效，可以在这一场关掉；库里其余的书可以只在这一场挂上。">
      <${Button} variant="ghost" size="sm" onClick=${() => setOpen(true)}>${label}<//>
    <//>
    <${Sheet} open=${open} onClose=${() => setOpen(false)} title="这一场的世界书" height="84%">
      ${mine.length ? html`
        <${List} title="角色已挂的与全局的">
          ${mine.map(b => html`
            <${ListItem} key=${b.id} title=${b.name || '未命名'} subtitle=${b.global ? '全局' : '角色已挂'}
              right=${html`<${Switch} checked=${!off.includes(b.id)} onChange=${() => flipOff(b.id)}/>`}
              onClick=${() => flipOff(b.id)}/>`)}
        <//>` : null}
      ${rest.length ? html`
        <${List} title="只在这一场挂上">
          ${rest.map(b => html`
            <${ListItem} key=${b.id} title=${b.name || '未命名'}
              right=${html`<${Switch} checked=${on.includes(b.id)} onChange=${() => flipOn(b.id)}/>`}
              onClick=${() => flipOn(b.id)}/>`)}
        <//>` : null}
      ${books.length ? null : html`<${EmptyState} icon="book" title="还没有对话用途的世界书"/>`}
    <//>`;
}

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
      <${Textarea} rows=${3} value=${v.note} onInput=${v2 => set({ note: v2 })}
        placeholder="例如 两人约好在这里见面，但对方迟到了四十分钟"/>
    <//>
    <${ToneField} v=${v} set=${set}/>
    <${BooksField} v=${v} set=${set} chatChars=${chatChars}/>
    ${chatChars.length > 1 ? html`
      <${Field} label="在场角色">
        <${List}>
          ${chatChars.map(c => html`
            <${ListItem} key=${c.id} title=${phone.remark.nameOf(c)}
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
  const [v, setV] = useState({
    title: '', place: '', at: '', note: '', castIds: [], opening: 'char',
    tones: tone.asTones(db.settings.get().sceneToneLast), toneText: '',
    offBookIds: db.settings.get().sceneBooksOffLast || [], bookIds: db.settings.get().sceneBooksOnLast || [],
  });
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
      castIds: cast, opening: v.opening, tones: v.tones, toneText: v.toneText,
      offBookIds: v.offBookIds, bookIds: v.bookIds,
    });
    setOpen(false);
    setV({ title: '', place: '', at: '', note: '', castIds: [], opening: 'char',
      tones: v.tones, toneText: '', offBookIds: v.offBookIds, bookIds: v.bookIds });
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
    tones: tone.idsOf(row), toneText: row.toneText || '',
    offBookIds: row.offBookIds || [], bookIds: row.bookIds || [],
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

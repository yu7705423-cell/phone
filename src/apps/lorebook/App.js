import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, Field, Input, Textarea, Switch,
         Segmented, NumberInput, EmptyState, toast, confirm, prompt } from '../../ui/index.js';

const { db, nav, ai } = phone;

// 世界书的三种用途。见 system/ai/context/lorebook.js 的 purposeOf
const PURPOSE_ITEMS = [
  { value: 'chat', label: '对话' },
  { value: 'image', label: '生图' },
  { value: 'voice', label: '语音' },
];
const PURPOSE_DESC = {
  chat: '注入对话。条目按所属部分与注入深度进入 prompt。',
  image: '仅在生成图片时按画面描述匹配，拼入生图提示词，不注入对话。所属部分与注入深度不生效。',
  voice: '仅在合成语音前写台本时使用，决定哪里停顿、哪里用什么情绪、哪里有叹气之类的声音，不注入对话。'
    + '需在「设置 - 用量与上限」开启「合成语音前先写成台本」。所属部分与注入深度不生效。',
};
const PURPOSE_TAG = { chat: '', image: ' · 只用于生图', voice: ' · 只用于语音' };

const PARTS = [
  { value: 'before', label: '角色前' },
  { value: 'after', label: '角色后' },
];

const partOf = e => (e?.part === 'after' ? 'after' : 'before');
const depthOf = e => Math.max(0, Math.round(Number(e?.depth) || 0));

// 一句话说清这一条会落在哪儿。列表和总览都用它
const placeText = e => (depthOf(e) === 0
  ? `设定区 · ${partOf(e) === 'before' ? '角色前' : '角色后'}`
  : `对话中 · 倒数第 ${depthOf(e)} 条之前`);

function BookList() {
  useStore(db.lorebooks.store);
  const books = db.lorebooks.all().sort((a, b) => b.updatedAt - a.updatedAt);

  const add = async () => {
    const name = await prompt({ title: '新建世界书', placeholder: '例如：校园设定' });
    if (!name) return;
    const b = db.lorebooks.create({ name, description: '', global: false, entries: [] });
    nav.push(`/book/${b.id}`);
  };

  return html`
    <${Page} title="世界书"
      right=${html`<button class="nav-text press" onClick=${add}>新建</button>`}>
      ${books.length ? html`
        <${List}>
          ${books.map(b => html`
            <${ListItem} key=${b.id} title=${b.name}
              subtitle=${`${(b.entries || []).length} 个条目${b.global ? ' · 全局生效' : ''}`
                + PURPOSE_TAG[ai.lore.purposeOf(b)]}
              arrow left=${html`<${Icon} name="book" size=${18}/>`}
              onClick=${() => nav.push(`/book/${b.id}`)}/>`)}
        <//>`
      : html`<${EmptyState} icon="book" title="暂无世界书"
          desc="世界书用于存放不属于特定角色的设定。条目可设为常驻，也可在对话涉及相关内容时才注入。"
          action=${html`<${Button} size="sm" onClick=${add} icon="plus">新建世界书<//>`}/>`}

      <div class="pad-x pad-b">
        <${Button} full variant="ghost" icon="layers"
          onClick=${() => nav.push('/map')}>注入位置总览<//>
        <div class="pad-t">
          <${Button} full variant="ghost" icon="eye"
            onClick=${() => nav.push('/preview')}>激活预览<//>
        </div>
      </div>
    <//>`;
}

function BookPage({ id }) {
  useStore(db.lorebooks.store);
  const book = db.lorebooks.get(id);
  if (!book) return html`<${Page} title="世界书" onBack=${nav.pop}><${EmptyState} title="该世界书已被删除"/><//>`;

  const patchEntry = (eid, patch) => db.lorebooks.update(id, b => ({
    entries: b.entries.map(e => e.id === eid ? { ...e, ...patch } : e),
  }));

  const addEntry = () => {
    const e = {
      id: phone.uid('e'), comment: '', keys: [], secondaryKeys: [], content: '',
      enabled: true, constant: false, priority: 100, order: 0,
      part: 'before', depth: 0, caseSensitive: false, probability: 100,
    };
    db.lorebooks.update(id, b => ({ entries: [...b.entries, e] }));
    nav.push(`/entry/${id}/${e.id}`);
  };

  const purpose = ai.lore.purposeOf(book);
  const forImage = purpose === 'image';
  const bare = purpose !== 'chat';   // 不进对话的那两种，没有「所属部分」与「注入深度」

  const del = async () => {
    if (!await confirm({ title: '删除世界书', message: `将删除「${book.name}」及其全部条目。`, danger: true })) return;
    db.lorebooks.remove(id);
    nav.pop();
  };

  return html`
    <${Page} title=${book.name} onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${addEntry}>加条目</button>`}>
      <div class="pad">
        <${Field} label="名称">
          <${Input} value=${book.name} onInput=${v => db.lorebooks.update(id, { name: v })}/>
        <//>
      </div>
      <${List}>
        <${ListItem} title="全局生效" subtitle="开启后对所有角色注入，无需单独关联"
          right=${html`<${Switch} checked=${book.global}
            onChange=${v => db.lorebooks.update(id, { global: v })}/>`}/>
      <//>
      <div class="pad-x">
        <${Field} label="用途" desc=${PURPOSE_DESC[purpose]}>
          <${Segmented} value=${purpose} items=${PURPOSE_ITEMS}
            onChange=${v => db.lorebooks.update(id, ai.lore.purposePatch(v))}/>
        <//>
      </div>

      <${List} title=${`条目 ${(book.entries || []).length}`}>
        ${(book.entries || []).map(e => html`
          <${ListItem} key=${e.id}
            title=${e.comment || e.content.slice(0, 18) || '未命名条目'}
            subtitle=${`${e.constant ? '常驻' : (e.keys.length ? `关键词：${e.keys.join('、')}` : '未填写关键词，不会触发')}`
              + (bare ? '' : ` · ${placeText(e)}`)}
            multiline
            arrow
            left=${html`<${Switch} checked=${e.enabled}
              onChange=${v => patchEntry(e.id, { enabled: v })}/>`}
            onClick=${() => nav.push(`/entry/${id}/${e.id}`)}/>`)}
      <//>
      ${!(book.entries || []).length ? html`
        <${EmptyState} icon="book" title="暂无条目"
          action=${html`<${Button} size="sm" icon="plus" onClick=${addEntry}>新建条目<//>`}/>` : null}

      <div class="pad">
        <${Button} full variant="danger" onClick=${del}>删除这本世界书<//>
      </div>
    <//>`;
}

function EntryPage({ bookId, entryId }) {
  useStore(db.lorebooks.store);
  const book = db.lorebooks.get(bookId);
  const entry = book?.entries.find(e => e.id === entryId);
  const purpose = ai.lore.purposeOf(book);
  const forImage = purpose === 'image';
  const forVoice = purpose === 'voice';
  if (!entry) return html`<${Page} title="条目" onBack=${nav.pop}><${EmptyState} title="该条目不存在"/><//>`;

  const patch = p => db.lorebooks.update(bookId, b => ({
    entries: b.entries.map(e => e.id === entryId ? { ...e, ...p } : e),
  }));

  const del = async () => {
    if (!await confirm({ title: '删除条目', danger: true })) return;
    db.lorebooks.update(bookId, b => ({ entries: b.entries.filter(e => e.id !== entryId) }));
    nav.pop();
  };

  return html`
    <${Page} title="条目" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="备注" desc="仅供本地识别，不进入 prompt。">
          <${Input} value=${entry.comment} onInput=${v => patch({ comment: v })}
            placeholder="该条目的用途"/>
        <//>

        <${Field} label="内容"
          desc=${forImage
            ? '命中后原样拼入生图提示词。建议使用该生图接口所用的语言。'
            : forVoice
              ? '命中后交给写台本的那一步，用于决定哪里停顿、哪里用什么情绪。'
                + '例如：说到对方名字时停顿半秒；生气时语速加快、句间不停顿。'
              : '命中后原样注入 prompt。'}>
          <${Textarea} rows=${6} value=${entry.content} onInput=${v => patch({ content: v })}/>
        <//>

        <${Field} label="关键词"
          desc=${forImage
            ? '以逗号分隔。生成图片时按画面描述匹配，出现任意一个即命中。'
            : forVoice
              ? '以逗号分隔。按要念的那句话与前几句对话匹配，出现任意一个即命中。通话中整本给出，由模型自行对照。'
              : '以逗号分隔。扫描窗口内出现任意一个即命中。'}>
          <${Input} value=${(entry.keys || []).join('，')}
            placeholder="社团，学生会"
            onInput=${v => patch({ keys: v.split(/[,，]/).map(s => s.trim()).filter(Boolean) })}/>
        <//>

        <${Field} label="二级关键词" desc="填写后须同时命中其中一个，用于收窄触发范围。">
          <${Input} value=${(entry.secondaryKeys || []).join('，')}
            onInput=${v => patch({ secondaryKeys: v.split(/[,，]/).map(s => s.trim()).filter(Boolean) })}/>
        <//>

        ${forImage || forVoice ? null : html`
          <${Field} label="所属部分"
            desc="决定该条目位于角色卡之前还是之后。世界观、时代背景一类置于角色前；角色在该世界中的处境一类置于角色后。">
            <${Segmented} value=${partOf(entry)} items=${PARTS}
              onChange=${v => patch({ part: v })}/>
          <//>

          <${Field} label="注入深度"
            desc=${`填 0 表示留在设定区，位于${partOf(entry) === 'before' ? '角色卡之前' : '角色卡之后'}。`
              + '填 N（N ≥ 1）表示从设定区取出，插入对话历史中倒数第 N 条消息之前。'
              + '数值越小越接近当前对话，模型越不容易忽略；代价是每轮都占据靠近末尾的位置。'
              + '深度超过现有消息条数时，落在对话最前面。'}>
            <${NumberInput} value=${depthOf(entry)} min=${0} unit="条"
              onChange=${v => patch({ depth: Math.max(0, Math.round(v) || 0) })}/>
          <//>
          <div class="field-desc pad-x">当前位置：${placeText(entry)}</div>`}

        <${Field} label=${`优先级　${entry.priority}`}
          desc=${forImage || forVoice
            ? '仅决定多条同时命中时的先后，数值高的在前。这一类不设预算，不会因此丢弃。'
            : '注入预算不足时，从低优先级开始丢弃。'}>
          <input type="range" min="0" max="400" step="10" value=${entry.priority}
            onInput=${e => patch({ priority: parseInt(e.target.value, 10) })}/>
        <//>

        <${Field} label=${`触发概率　${entry.probability}%`}>
          <input type="range" min="10" max="100" step="5" value=${entry.probability}
            onInput=${e => patch({ probability: parseInt(e.target.value, 10) })}/>
        <//>
      </div>

      <${List}>
        <${ListItem} title="常驻"
          subtitle=${forImage ? '无需关键词，每次生成图片时均拼入'
            : forVoice ? '无需关键词，每次写台本时均使用' : '无需关键词，每次均注入'}
          right=${html`<${Switch} checked=${entry.constant} onChange=${v => patch({ constant: v })}/>`}/>
        <${ListItem} title="区分大小写"
          right=${html`<${Switch} checked=${entry.caseSensitive} onChange=${v => patch({ caseSensitive: v })}/>`}/>
        <${ListItem} title="启用"
          right=${html`<${Switch} checked=${entry.enabled} onChange=${v => patch({ enabled: v })}/>`}/>
      <//>

      <div class="pad">
        <${Button} full variant="danger" onClick=${del}>删除条目<//>
      </div>
    <//>`;
}

// 没有这个页面,后期排查 prompt 问题就只能盲猜
function PreviewPage() {
  useStore(db.lorebooks.store);
  useStore(db.characters.store);
  const chars = db.characters.all();
  const [charId, setCharId] = useState(chars[0]?.id || '');
  const [text, setText] = useState('');

  const char = db.characters.get(charId);
  const budget = db.settings.get().contextBudget;
  const result = char ? ai.lore.activate(char, text, Math.round(budget * 0.4)) : { items: [], used: 0 };

  return html`
    <${Page} title="激活预览" onBack=${nav.pop}>
      <div class="pad">
        <div class="hint-box">输入一段对话，看看会激活哪些条目、占多少 token。
          标为「只用于生图」的世界书不注入对话，因此不在此处显示。</div>

        <${Field} label="以哪个角色的视角">
          ${chars.length ? html`
            <div class="chip-row">
              ${chars.map(c => html`
                <button key=${c.id} class=${`chip${charId === c.id ? ' is-active' : ''}`}
                  onClick=${() => setCharId(c.id)}>${phone.remark.nameOf(c)}</button>`)}
            </div>`
          : html`<div class="field-desc">还没有角色卡，先去聊天里建一个。</div>`}
        <//>

        <${Field} label="模拟对话内容">
          <${Textarea} rows=${5} value=${text} onInput=${setText}
            placeholder="粘贴最近几条消息"/>
        <//>
      </div>

      <${List} title=${`命中 ${result.items.length} 条 · 约 ${result.used} tokens`}>
        ${result.items.map(e => html`
          <${ListItem} key=${e.id} multiline
            title=${e.comment || e.content.slice(0, 20)}
            subtitle=${e.content}
            right=${html`<span>${e.constant ? '常驻' : '命中'}</span>`}/>`)}
      <//>
      ${!result.items.length ? html`<${EmptyState} icon="eye" title="无条目被激活"/>` : null}
    <//>`;
}

// 「这一堆条目到底按什么顺序、落在哪儿」—— 没有这一页只能对着代码数。
// 和激活预览不同：预览看的是「这段话会命中谁」，这一页看的是
// **全部条目的位置**，命不命中都列出来。
function MapPage() {
  useStore(db.lorebooks.store);
  useStore(db.characters.store);
  const chars = db.characters.all();
  const [charId, setCharId] = useState(chars[0]?.id || '');
  const char = db.characters.get(charId);
  const attached = new Set(char?.lorebookIds || []);

  const all = [];
  const forImg = [];
  const forVoc = [];
  for (const b of db.lorebooks.all()) {
    const applies = b.global || attached.has(b.id);
    const p = ai.lore.purposeOf(b);
    for (const e of (b.entries || [])) {
      const row = { ...e, bookName: b.name, bookId: b.id, applies };
      // 生图与语音那两种不进对话，按位置分组对它们没有意义，各自单列一组
      (p === 'image' ? forImg : p === 'voice' ? forVoc : all).push(row);
    }
  }
  all.sort(ai.lore.compare);
  forImg.sort(ai.lore.compare);
  forVoc.sort(ai.lore.compare);

  // 分组的顺序就是注入的顺序
  const groups = [
    { key: 'before', title: '设定区 · 角色卡之前',
      desc: '位于角色人设之前。适合世界观、时代背景一类先于角色存在的设定。',
      rows: all.filter(e => depthOf(e) === 0 && partOf(e) === 'before') },
    { key: 'after', title: '设定区 · 角色卡之后',
      desc: '位于角色人设之后。适合角色在该世界中的处境、关系一类依附于角色的设定。',
      rows: all.filter(e => depthOf(e) === 0 && partOf(e) === 'after') },
  ];
  const depths = [...new Set(all.filter(e => depthOf(e) > 0).map(depthOf))].sort((a, b) => b - a);
  for (const d of depths) {
    groups.push({
      key: `d${d}`, title: `对话中 · 倒数第 ${d} 条之前`,
      desc: '以 system 身份插入对话历史。越接近末尾，模型越不容易忽略。',
      rows: all.filter(e => depthOf(e) === d),
    });
  }
  if (forImg.length) {
    groups.push({
      key: 'image', title: '生图提示词',
      desc: '用途为「生图」的条目。生成图片时按画面描述匹配，不注入对话。',
      rows: forImg,
    });
  }
  if (forVoc.length) {
    groups.push({
      key: 'voice', title: '语音台本',
      desc: '用途为「语音」的条目。写台本时决定停顿与情绪，不注入对话。',
      rows: forVoc,
    });
  }

  const row = e => html`
    <${ListItem} key=${`${e.bookId}-${e.id}`} multiline arrow
      title=${e.comment || (e.content || '').slice(0, 20) || '未命名条目'}
      subtitle=${[
        e.bookName,
        e.constant ? '常驻' : (e.keys || []).length ? `关键词：${e.keys.join('、')}` : '无关键词',
        `优先级 ${e.priority ?? 100}`,
        e.enabled ? '' : '已停用',
        e.applies ? '' : '该角色未关联此世界书',
      ].filter(Boolean).join(' · ')}
      onClick=${() => nav.push(`/entry/${e.bookId}/${e.id}`)}/>`;

  return html`
    <${Page} title="注入位置总览" onBack=${nav.pop}>
      <div class="pad">
        <div class="hint-box">
          按注入顺序列出全部条目。角色卡之前的先进入 prompt，其次是角色人设，
          再次是角色卡之后的部分；标注了深度的条目不进设定区，改为插入对话历史。
        </div>
        ${chars.length ? html`
          <${Field} label="以哪个角色的视角">
            <div class="chip-row">
              ${chars.map(c => html`
                <button key=${c.id} class=${`chip${charId === c.id ? ' is-active' : ''}`}
                  onClick=${() => setCharId(c.id)}>${phone.remark.nameOf(c)}</button>`)}
            </div>
          <//>` : null}
      </div>

      ${groups.map(g => html`
        <${List} key=${g.key} title=${`${g.title} · ${g.rows.length}`}>
          ${g.rows.length ? g.rows.map(row) : html`
            <${ListItem} title="此处暂无条目" subtitle=${g.desc} multiline/>`}
        <//>`)}

      ${!all.length ? html`<${EmptyState} icon="book" title="暂无条目"/>` : null}
    <//>`;
}

export default function LorebookApp({ route }) {
  const book = route?.match(/^\/book\/(.+)$/);
  if (book) return html`<${BookPage} id=${book[1]}/>`;
  const entry = route?.match(/^\/entry\/([^/]+)\/(.+)$/);
  if (entry) return html`<${EntryPage} bookId=${entry[1]} entryId=${entry[2]}/>`;
  if (route === '/preview') return html`<${PreviewPage}/>`;
  if (route === '/map') return html`<${MapPage}/>`;
  return html`<${BookList}/>`;
}

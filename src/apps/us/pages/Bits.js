import { html } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Field, Input, Textarea, Segmented, List, ListItem, Switch, IdentityFields } from '../../../ui/index.js';

const { db, work, tone, stage } = phone;

export const dateOf = ts => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/**
 * 扉页。点进一部作品先看到的就是它：一张方形封面、标题、参与的人、体裁与进度。
 *
 * **封面只在这儿出现，不压在正文上面**（见 ARCHITECTURE 4.118）——
 * 读的时候上面顶着一张图，每翻一段都要从它下面绕过去。
 *
 * 这一块用这部作品自己的纸色，不是 app 的底色：它是作品的一部分，
 * 不是列表的表头。
 */
export function Hero({ w }) {
  useStore(db.settings.store);
  const url = useImage(w.cover);
  const c = work.charOf(w);
  const m = work.meOf(w);
  const st = work.statsOf(w.id);
  const unit = w.kind === work.SAGA ? '章' : '则';
  const cfg = stage.get();
  const meta = [work.kindLabel(w.kind),
    st.chapters ? `${st.chapters} ${unit}` : '还没有正文',
    st.chars ? `${st.chars} 字` : ''].filter(Boolean).join(' · ');
  return html`
    <div class="wk-hero" style=${stage.varsOf(cfg)}>
      <div class="wk-hero-art">
        ${url
    ? html`<img src=${url} alt=""/>`
    : html`<span class="wk-hero-glyph">${String(w.title || phone.remark.nameOf(c) || '作').slice(0, 1)}</span>`}
      </div>
      <div class="wk-hero-title">${w.title || '未命名'}</div>
      <div class="wk-hero-names">${[phone.remark.nameOf(c), m.name].filter(Boolean).join('　')}</div>
      <div class="wk-hero-meta">${meta}</div>
    </div>`;
}

/** 一篇在列表上写几个字。长篇按章编号，番外按题目。 */
export const chapterTitle = (w, c) => (w.kind === work.SAGA
  ? `第 ${c.no} 章${c.title ? `　${c.title}` : ''}`
  : (c.title || `第 ${c.no} 则`));

/**
 * 文风。和线下用同一份预设库 —— 那些预设写的是「怎么写一段散文」，
 * 换个体裁不需要换一套（system/tone.js）。
 */
export function TonePick({ value = [], text, onChange }) {
  useStore(db.settings.store);
  const list = tone.list();
  const picked = Array.isArray(value) ? value : tone.asTones(value);
  const flip = id => onChange({ tones: picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id] });
  return html`
    <${List} title="文风">
      <${ListItem} title="不设定" multiline subtitle="不写入任何关于文风的内容"
        right=${picked.length ? null : '当前'} onClick=${() => onChange({ tones: [], toneText: '' })}/>
      ${list.map(t => html`
        <${ListItem} key=${t.id} title=${t.name} multiline
          subtitle=${(t.text || '').slice(0, 40)}
          right=${html`<${Switch} checked=${picked.includes(t.id)} onChange=${() => flip(t.id)}/>`}
          onClick=${() => flip(t.id)}/>`)}
      <${ListItem} title="这一部自己写" multiline
        subtitle="只作用于这一部，不进预设库"
        right=${html`<${Switch} checked=${picked.includes('custom')} onChange=${() => flip('custom')}/>`}
        onClick=${() => flip('custom')}/>
    <//>
    <div class="pad-x field-desc">可以选多份，按选中的顺序依次写入提示词。</div>
    ${picked.includes('custom') ? html`
      <div class="pad-x">
        <${Field} label="这一部的文风" desc="写给模型看的。一律用英文，中文写的指令会把措辞漏进正文。">
          <${Textarea} rows=${5} value=${text || ''}
            onInput=${v => onChange({ toneText: v })}/>
        <//>
      </div>` : null}`;
}

/** 新建与编辑共用的那一组输入框。 */
export function WorkFields({ v, set, kind, onGenerate }) {
  const saga = kind === work.SAGA;
  return html`
    <${Field} label="标题">
      <${Input} value=${v.title} onInput=${x => set({ title: x })}
        placeholder=${saga ? '这部作品叫什么' : '这一则小剧场叫什么'}/>
    <//>
    <${Field} label=${saga ? '主线' : '设定'}
      desc=${saga
    ? '这部作品讲的是什么、在什么世界、两个人是什么关系。每一章都会带上它。'
    : '这一则的前提。例如另一种可能的走向，或者某一天发生的一件小事。'}>
      <${Textarea} rows=${saga ? 6 : 4} value=${v.premise}
        onInput=${x => set({ premise: x })}/>
    <//>
    ${saga ? html`
      <${IdentityFields} who="char" name=${v.charName} persona=${v.charPersona}
        onChange=${p => set({ ...(p.name !== undefined ? { charName: p.name } : {}), ...(p.persona !== undefined ? { charPersona: p.persona } : {}) })}
        onGenerate=${onGenerate ? () => onGenerate('char') : null}/>
      <${IdentityFields} who="me" name=${v.meName} persona=${v.mePersona}
        onChange=${p => set({ ...(p.name !== undefined ? { meName: p.name } : {}), ...(p.persona !== undefined ? { mePersona: p.persona } : {}) })}
        onGenerate=${onGenerate ? () => onGenerate('me') : null}/>` : null}`;
}

/** 两个开关。番外没有第一个 —— 它就是这段关系的小剧场。 */
export function WorkSwitches({ v, set, kind, alone = false }) {
  return html`
    <div class="pad-x">
      <${Field} label="新的一篇由谁开场"
        desc="选择「让它开场」时，新建一篇后立即生成第一段，这会调用一次接口。">
        <${Segmented} value=${v.opening || 'char'} onChange=${x => set({ opening: x })}
          items=${[{ value: 'char', label: '让它开场' }, { value: 'me', label: '我自己写' }]}/>
      <//>
    </div>
    <${List} title="这一部怎么写">
      ${kind === work.SAGA && !alone ? html`
        <${ListItem} title="带上原来的记忆与关系" multiline
          subtitle=${v.carry
    ? '角色记得聊天里发生过的事。适合「还是我们俩，只是换了个世界」。'
    : '角色不知道聊天里发生过什么，也读不到记忆、关系底色与当前时刻。适合完全重新开始。'}
          right=${html`<${Switch} checked=${!!v.carry} onChange=${x => set({ carry: x })}/>`}/>` : null}
      <${ListItem} title="整篇由它写" multiline
        subtitle=${v.solo
    ? '它连「我」这个角色的言行一起写，读起来是小说。你仍然可以自己写一段插进去。'
    : '它只写对方与周围，「我」那一段由你自己写。'}
        right=${html`<${Switch} checked=${!!v.solo} onChange=${x => set({ solo: x })}/>`}/>
    <//>`;
}

/** 挑一段会话。作品挂在关系上，所以先有关系才有作品。 */
export function ChatPick({ value, onChange }) {
  useStore(db.chats.store);
  useStore(db.characters.store);
  const list = db.chats.all()
    .filter(c => (c.characterIds || []).length)
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  return html`
    <${List} title="和谁">
      ${list.map(c => {
    const names = (c.characterIds || []).map(id => db.characters.get(id)?.name)
      .filter(Boolean).join('、');
    return html`
          <${ListItem} key=${c.id} title=${names || '已删除的角色'}
            right=${value === c.id ? '当前' : null}
            onClick=${() => onChange(c.id)}/>`;
  })}
    <//>`;
}

/** 直接从联系里选人物，不经过会话（4.262）。长篇才有这条路 */
export function CastPick({ value = [], onChange }) {
  useStore(db.characters.store);
  const list = db.characters.all().filter(c => !c.parentId)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
  const flip = id => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  return html`
    <${List} title="人物">
      ${list.map(c => html`
        <${ListItem} key=${c.id} title=${phone.remark.nameOf(c)} subtitle=${c.signature || ''}
          right=${html`<${Switch} checked=${value.includes(c.id)} onChange=${() => flip(c.id)}/>`}
          onClick=${() => flip(c.id)}/>`)}
      ${list.length ? null : html`<${ListItem} title="还没有角色" subtitle="先在「联系」中创建角色"/>`}
    <//>`;
}

export const KindPick = ({ value, onChange }) => html`
  <${Field} label="体裁" desc=${(work.KINDS.find(k => k.id === value) || {}).desc || ''}>
    <${Segmented} value=${value} onChange=${onChange}
      items=${work.KINDS.map(k => ({ value: k.id, label: k.label }))}/>
  <//>`;

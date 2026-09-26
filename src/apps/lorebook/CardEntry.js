import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, Field, Input, Textarea, Switch, Segmented,
         NumberInput, EmptyState, CardFrame, Sheet, confirm } from '../../ui/index.js';

// 世界书里的卡片条目（ARCHITECTURE 4.250）。
//
// 一张卡片两半：「说明」进 prompt，告诉角色这是什么、每个字段填什么；「模板」是 HTML 与 CSS，
// 一个字都不进 prompt。字段从模板里的占位符自动读出来，每个字段可以写说明、限字数、设成长文本（框内滚动）。
// 示例值用角色那种写法（字段：值），预览就拿它填。
const { db, htmlcard } = phone;

const WIDTH_ITEMS = [
  { value: 'bubble', label: `气泡宽 ${htmlcard.WIDTHS.bubble}px` },
  { value: 'full', label: `整行宽 ${htmlcard.WIDTHS.full}px` },
];
const RATIO_ITEMS = Object.entries(htmlcard.RATIOS).map(([value, r]) => ({ value, label: r.label }));

const SYNTAX = [
  ['{{字段}}', '填入角色写的值'],
  ['{{#列表}} … {{/列表}}', '列表，每一项画一遍。里面写 {{.}} 或子字段，如 {{昵称}}'],
  ['{{#字段}} … {{/字段}}', '该字段有值时才显示中间的内容。中间出现别的字段时，按列表处理'],
  ['{{^字段}} … {{/字段}}', '该字段为空时才显示中间的内容'],
  ['{{char}} {{user}}', '角色名与用户名，由应用填入'],
  ['{{char_avatar}} {{user_avatar}}', '头像图片地址，写在 img 的 src 里'],
  ['{{author_avatar}}', '发帖人头像。下方选定「发帖人字段」后，该字段写的是角色或用户的名字时为对应头像，否则为空'],
  ['.eira-dark', '应用为深色模式时加在 html 上，可用 .eira-dark .x { … } 写深色样式'],
  ['.eira-scroll', '加在任意元素上，内容超出时在框内滚动'],
  ['.eira-topic', '字段开启「高亮话题与 @」后，其中的话题与 @ 各包在这个类里，颜色在模板里写，如 .eira-topic { color: #507daf }'],
];

/** 一个字段的设置：说明、字数、长文本 */
function FieldCfg({ name, label, cfg, onPatch, long = true }) {
  return html`
    <div class="hc-field">
      <div class="hc-field-name">${label || name}</div>
      <${Input} value=${cfg.desc || ''} placeholder="说明：该字段填什么（进入 prompt）"
        onInput=${v => onPatch({ desc: v })}/>
      <div class="hc-field-row">
        <span class="hc-field-k">字数上限</span>
        <${NumberInput} value=${Math.round(Number(cfg.max) || 0)} min=${0} unit="字" placeholder="不限"
          onChange=${v => onPatch({ max: Math.max(0, Math.round(v) || 0) })}/>
      </div>
      <div class="hc-field-row">
        <span class="hc-field-k">高亮话题与 @（#话题#、#话题、@名字）</span>
        <${Switch} checked=${!!cfg.topics} onChange=${v => onPatch({ topics: v })}/>
      </div>
      ${long ? html`
        <div class="hc-field-row">
          <span class="hc-field-k">长文本（框内滚动）</span>
          <${Switch} checked=${!!cfg.long} onChange=${v => onPatch({ long: v })}/>
        </div>
        ${cfg.long ? html`
          <div class="hc-field-row">
            <span class="hc-field-k">显示行数</span>
            <${NumberInput} value=${Math.round(Number(cfg.lines) || 6)} min=${1} unit="行"
              onChange=${v => onPatch({ lines: Math.max(1, Math.round(v) || 1) })}/>
          </div>` : null}` : null}
    </div>`;
}

export function CardEntryPage({ bookId, entryId }) {
  useStore(db.lorebooks.store);
  const [syntax, setSyntax] = useState(false);
  const book = db.lorebooks.get(bookId);
  const entry = book?.entries.find(e => e.id === entryId);
  if (!entry) return html`<${Page} title="卡片" onBack=${phone.nav.pop}><${EmptyState} title="该卡片不存在"/><//>`;

  const card = entry.card || {};
  const patch = p => db.lorebooks.update(bookId, b => ({
    entries: b.entries.map(e => e.id === entryId ? { ...e, ...p } : e),
  }));
  const patchCard = p => patch({ card: { ...card, ...p } });
  const patchField = (key, p) => patchCard({ fields: { ...(card.fields || {}), [key]: { ...((card.fields || {})[key] || {}), ...p } } });

  const fields = htmlcard.fieldsOf(card.html, card.fields);
  // 由区块读出、里面带着别的字段的那几个：分不清是列表还是「有值才显示」，给一个开关
  const listy = new Set(htmlcard.fieldsOf(card.html).filter(f => f.list && f.sub.length).map(f => f.name));
  const problems = htmlcard.problemsOf(card.html, { images: !!card.images });
  const sample = htmlcard.parseValues(card.sampleText || '', fields);
  const doc = String(card.html || '').trim() ? htmlcard.docOf(card, sample, htmlcard.sampleSys()) : '';
  const { w, h } = htmlcard.sizeOf(card);
  const name = String(entry.comment || '').trim();

  // 示例值写不出来时，按字段给一份样子
  const fillSample = () => patchCard({
    sampleText: fields.map(f => (f.list
      ? `${f.name}：${f.sub.length ? f.sub.map(s => s).join('｜') : '第一项'}`
      : `${f.name}：${f.name}`)).join('\n'),
  });

  const del = async () => {
    if (!await confirm({ title: '删除卡片', message: '已经发出的卡片将改为显示原始内容。', danger: true })) return;
    db.lorebooks.update(bookId, b => ({ entries: b.entries.filter(e => e.id !== entryId) }));
    phone.nav.pop();
  };

  return html`
    <${Page} title="卡片" onBack=${phone.nav.pop}>
      <div class="pad">
        <div class="hint-box">
          卡片由 HTML 与 CSS 写成，不运行脚本。角色可以在聊天中按字段填写后发送，显示在独立的框内，
          与应用的样式互不影响。「说明」与字段设置进入 prompt，模板本身不进入。
        </div>

        <${Field} label="卡片名称" desc="角色发送时写这个名字。同一角色可用的卡片不要重名。">
          <${Input} value=${entry.comment} placeholder="例如：电影票" onInput=${v => patch({ comment: v })}/>
        <//>

        <${Field} label="说明" desc="进入 prompt，说明这是什么卡片。">
          <${Textarea} rows=${3} value=${entry.content} onInput=${v => patch({ content: v })}
            placeholder="A cinema ticket for a film you are watching together."/>
        <//>

        <${Field} label="触发关键词" desc="以逗号分隔。扫描窗口内出现任意一个时，这张卡片才进入 prompt。开启下方「常驻」则每轮都进入。">
          <${Input} value=${(entry.keys || []).join('，')} placeholder="电影，看片，影院"
            onInput=${v => patch({ keys: v.split(/[,，]/).map(s => s.trim()).filter(Boolean) })}/>
        <//>
      </div>

      <${List}>
        <${ListItem} title="常驻" subtitle="无需关键词，每轮都进入 prompt"
          right=${html`<${Switch} checked=${!!entry.constant} onChange=${v => patch({ constant: v })}/>`}/>
        <${ListItem} title="启用"
          right=${html`<${Switch} checked=${entry.enabled !== false} onChange=${v => patch({ enabled: v })}/>`}/>
      <//>

      <div class="pad">
        <${Field} label="模板" desc="完整的 HTML，样式写在 <style> 里。要角色填的地方写占位符。">
          <${Textarea} rows=${14} class="tb-code" value=${card.html || ''} spellcheck=${false}
            placeholder=${'<style>.ticket { padding: 16px; }</style>\n<div class="ticket">\n  <h1>{{片名}}</h1>\n  <p>{{留言}}</p>\n</div>'}
            onInput=${v => patchCard({ html: v })}/>
        <//>
        ${problems.length ? html`
          <div class="hint-box is-warn">${problems.map(p => html`<div key=${p}>${p}</div>`)}</div>` : null}
        <button class="hc-syntax-toggle press" onClick=${() => setSyntax(v => !v)}>
          ${syntax ? '收起写法说明' : '占位符写法'}
        </button>
        ${syntax ? html`
          <div class="hc-syntax">
            ${SYNTAX.map(([k, v]) => html`<div key=${k} class="hc-syntax-row"><code>${k}</code><span>${v}</span></div>`)}
          </div>` : null}
      </div>

      <${List} title=${`字段 ${fields.length}`}>
        ${fields.length ? null : html`<${ListItem} title="模板中还没有占位符" subtitle="写入 {{字段名}} 后，这里列出每个字段的设置" multiline/>`}
      <//>
      ${fields.length ? html`
        <div class="pad-x">
          ${fields.map(f => html`
            <div key=${f.name} class="hc-field-group">
              <${FieldCfg} name=${f.name} label=${f.list ? `${f.name}（列表）` : f.name}
                cfg=${(card.fields || {})[f.name] || {}} long=${!f.list}
                onPatch=${p => patchField(f.name, p)}/>
              ${listy.has(f.name) ? html`
                <div class="hc-field-row hc-field-kind">
                  <span class="hc-field-k">按列表处理（关闭后按「有值才显示」处理）</span>
                  <${Switch} checked=${f.list} onChange=${v => patchField(f.name, { scalar: !v })}/>
                </div>` : null}
              ${f.sub.map(s => html`
                <div key=${s} class="hc-field-sub">
                  <${FieldCfg} name=${s} label=${`${f.name} · ${s}`}
                    cfg=${(card.fields || {})[`${f.name}.${s}`] || {}}
                    onPatch=${p => patchField(`${f.name}.${s}`, p)}/>
                </div>`)}
            </div>`)}
        </div>` : null}

      ${fields.some(f => !f.list) ? html`
        <div class="pad-x">
          <${Field} label="发帖人字段" desc="该字段写的名字与角色或用户一致时，{{author_avatar}} 填入对应头像。">
            <div class="chip-row">
              <button class=${`chip${!card.authorField ? ' is-active' : ''}`} onClick=${() => patchCard({ authorField: '' })}>不设</button>
              ${fields.filter(f => !f.list).map(f => html`
                <button key=${f.name} class=${`chip${card.authorField === f.name ? ' is-active' : ''}`}
                  onClick=${() => patchCard({ authorField: f.name })}>${f.name}</button>`)}
            </div>
          <//>
        </div>` : null}

      <div class="pad">
        <${Field} label="宽度">
          <${Segmented} value=${card.width || 'bubble'} items=${WIDTH_ITEMS} onChange=${v => patchCard({ width: v })}/>
        <//>
        <${Field} label="形状" desc=${`聊天中显示为 ${w} × ${h}px，内容超出时在卡片内滚动。点击卡片上方的「展开」可全屏查看。`}>
          <div class="chip-row">
            ${RATIO_ITEMS.map(r => html`
              <button key=${r.value} class=${`chip${(card.ratio || '4:3') === r.value ? ' is-active' : ''}`}
                onClick=${() => patchCard({ ratio: r.value })}>${r.label}</button>`)}
          </div>
        <//>
        ${card.ratio === 'custom' ? html`
          <${Field} label="高度">
            <${NumberInput} value=${Math.round(Number(card.height) || 300)} min=${40} unit="px"
              onChange=${v => patchCard({ height: Math.max(40, Math.round(v) || 40) })}/>
          <//>` : null}
      </div>

      <${List}>
        <${ListItem} title="外部图片与字体"
          subtitle="开启后可加载 https 开头的图片与字体。图片地址会被对方服务器记录访问；开启时占位符只能用于正文与 alt、title，不能写进任何地址。"
          multiline
          right=${html`<${Switch} checked=${!!card.images} onChange=${v => patchCard({ images: v })}/>`}/>
      <//>

      <div class="pad">
        <${Field} label="示例值" desc="用角色的写法填写，一行一个字段；列表字段一项一行，子字段用｜分隔。仅用于预览。">
          <${Textarea} rows=${5} value=${card.sampleText || ''} onInput=${v => patchCard({ sampleText: v })}
            placeholder="片名：……"/>
        <//>
        ${fields.length && !String(card.sampleText || '').trim() ? html`
          <${Button} size="sm" variant="ghost" onClick=${fillSample}>按字段生成示例<//>` : null}
      </div>

      <${List} title="预览"><//>
      <div class="pad-x hc-preview">
        ${doc ? html`
          <div class="hc-card" style=${`--hc-w:${w}px`}>
            <div class="hc-bar"><span class="hc-bar-name">卡片 · ${name || '未命名'}</span></div>
            <${CardFrame} doc=${doc} w=${w} h=${h} title=${name || '预览'}/>
          </div>` : html`<div class="field-desc">填写模板后在此预览。</div>`}
      </div>

      <div class="pad">
        <${Button} full variant="danger" onClick=${del}>删除卡片<//>
      </div>
    <//>`;
}

/** 新建一张卡片条目 */
export const blankCard = () => ({
  id: phone.uid('e'), type: htmlcard.TYPE, comment: '', keys: [], secondaryKeys: [], content: '',
  enabled: true, constant: false, priority: 100, order: 0,
  part: 'before', depth: 0, caseSensitive: false, probability: 100,
  card: { html: '', fields: {}, width: 'bubble', ratio: '4:3', images: false, sampleText: '' },
});

// ---- 内置卡片（system/cardkit.js）----
// 只读：能开关、能预览、能复制一份到自己的世界书里改。那本书不在数据库里，跟着应用更新

export function BuiltinPage() {
  useStore(db.settings.store);
  const book = htmlcard.builtinBook();
  const off = htmlcard.builtinState().off || [];
  const toggle = (id, on) => htmlcard.setBuiltin({ off: on ? off.filter(x => x !== id) : [...off, id] });
  return html`
    <${Page} title="内置卡片" onBack=${phone.nav.pop}>
      <div class="pad">
        <div class="hint-box">
          应用自带的帖子卡片，版式与各平台一致，账号处带有 @Eira 标记。随应用更新，不能直接修改；
          需要改动时复制一份到自己的世界书。开启「全局生效」或在角色资料的「关联世界书」中开启后，
          对话中出现对应的关键词时，角色可以发送这些卡片。
        </div>
      </div>
      <${List}>
        <${ListItem} title="全局生效" subtitle="开启后对所有角色生效，无需单独关联"
          right=${html`<${Switch} checked=${book.global} onChange=${v => htmlcard.setBuiltin({ global: v })}/>`}/>
      <//>
      <${List} title=${`卡片 ${book.entries.length}`}>
        ${book.entries.map(e => html`
          <${ListItem} key=${e.id} title=${e.comment} arrow multiline
            subtitle=${`关键词：${(e.keys || []).join('、')}`}
            left=${html`<${Switch} checked=${e.enabled} onChange=${v => toggle(e.id, v)}/>`}
            onClick=${() => phone.nav.push(`/builtin/${e.id}`)}/>`)}
      <//>
    <//>`;
}

export function BuiltinCardPage({ id }) {
  useStore(db.lorebooks.store);
  const [picking, setPicking] = useState(false);
  const entry = htmlcard.builtinBook().entries.find(e => e.id === id);
  if (!entry) return html`<${Page} title="卡片" onBack=${phone.nav.pop}><${EmptyState} title="该卡片不存在"/><//>`;
  const card = entry.card;
  const fields = htmlcard.fieldsOf(card.html, card.fields);
  const doc = htmlcard.docOf(card, htmlcard.parseValues(card.sampleText || '', fields), htmlcard.sampleSys());
  const { w, h } = htmlcard.sizeOf(card);
  const books = db.lorebooks.all().filter(b => phone.ai.lore.purposeOf(b) === 'chat');

  const copyTo = bookId => {
    const { builtin, id: _, bookId: __, ...rest } = entry;
    const e = { ...rest, id: phone.uid('e'), card: JSON.parse(JSON.stringify(card)) };
    let target = bookId;
    if (!target) target = db.lorebooks.create({ name: '我的卡片', description: '', global: false, entries: [] }).id;
    db.lorebooks.update(target, b => ({ entries: [...(b.entries || []), e] }));
    setPicking(false);
    phone.nav.push(`/entry/${target}/${e.id}`);
  };

  return html`
    <${Page} title=${entry.comment} onBack=${phone.nav.pop}>
      <div class="pad hc-preview">
        <div class="hc-card" style=${`--hc-w:${w}px`}>
          <div class="hc-bar"><span class="hc-bar-name">卡片 · ${entry.comment}</span></div>
          <${CardFrame} doc=${doc} w=${w} h=${h} title=${entry.comment}/>
        </div>
        <div class="field-desc pad-t">以上为示例内容。聊天中显示为 ${w} × ${h}px，内容超出时在卡片内滚动。</div>
      </div>
      <${List} title="触发关键词">
        <${ListItem} title=${(entry.keys || []).join('、')} multiline/>
      <//>
      <${List} title=${`字段 ${fields.length}`}>
        ${fields.map(f => html`
          <${ListItem} key=${f.name} multiline
            title=${f.list ? `${f.name}（列表${f.sub.length ? `：${f.sub.join('｜')}` : ''}）` : f.name}
            subtitle=${[(card.fields || {})[f.name]?.max ? `上限 ${card.fields[f.name].max} 字` : '',
              (card.fields || {})[f.name]?.long ? '长文本' : ''].filter(Boolean).join(' · ')}/>`)}
      <//>
      <div class="pad">
        <${Button} full icon="copy" onClick=${() => setPicking(true)}>复制到我的世界书<//>
      </div>
      <${Sheet} open=${picking} onClose=${() => setPicking(false)} title="复制到">
        <${List}>
          ${books.map(b => html`
            <${ListItem} key=${b.id} title=${b.name} arrow onClick=${() => copyTo(b.id)}/>`)}
          <${ListItem} title="新建一本「我的卡片」" arrow onClick=${() => copyTo('')}/>
        <//>
      <//>
    <//>`;
}

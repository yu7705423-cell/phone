import { html, useState, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Button, Icon, Spinner, Switch,
         Sheet, CardFrame, toast } from '../../ui/index.js';
import { CallNote, copyText, useToolState } from './common.js';
import { KINDS, STYLES, PALETTES, FONTS, DECO_USES, EFFECTS, WISH_EXAMPLES } from './cardgendata.js';

// HTML 卡片生成器（ARCHITECTURE 4.252）。
//
// 一步一步选：做什么、风格、配色、字体、尺寸、装饰图片、特效、字段、想实现什么，也可以传一张截图照着做。
// 每一步都能跳过、都能自己写。生成一次、每改一次各调一次接口。
// 生成的是模板和说明两样，存进世界书时连同关键词一起存（用户要求：存的时候也要附带 prompt、要填触发关键词）。
const { db, nav, ai, htmlcard } = phone;
const T = ai.tools;

const DEF = {
  kind: '', kindText: '', styles: [], styleText: '', palette: '', colorText: '', font: '', followDark: true,
  width: 'bubble', ratio: '4:3', height: 300,
  decos: [], effects: [], effectText: '', fieldsText: '', wish: '',
  result: null, change: '', showCode: false,
};

const rid = () => Math.random().toString(36).slice(2, 6);

// 一排可点的，单选或多选。hint 是选中后在下面显示的那句说明
function Chips({ items, value, multi = false, onPick }) {
  const on = x => (multi ? (value || []).includes(x) : value === x);
  const hit = items.find(it => on(it.label || it));
  return html`
    <div class="chip-row">
      ${items.map(it => {
        const x = it.label || it;
        return html`<button key=${x} class=${`chip${on(x) ? ' is-active' : ''}`}
          onClick=${e => { e.preventDefault();
            onPick(multi ? (on(x) ? value.filter(y => y !== x) : [...(value || []), x]) : (on(x) ? '' : x)); }}>${x}</button>`;
      })}
    </div>
    ${!multi && hit?.hint ? html`<div class="field-desc">${hit.hint}</div>` : null}`;
}

// 装饰图片：一行一个网址，配一个用途
function Decos({ list, onChange }) {
  const put = (i, p) => onChange(list.map((d, k) => (k === i ? { ...d, ...p } : d)));
  return html`
    ${list.map((d, i) => html`
      <div key=${i} class="cg-deco">
        <${Input} value=${d.url} placeholder="https://…" onInput=${v => put(i, { url: v.trim() })}/>
        <div class="chip-row">
          ${DECO_USES.map(u => html`<button key=${u} class=${`chip${d.use === u ? ' is-active' : ''}`}
            onClick=${e => { e.preventDefault(); put(i, { use: u }); }}>${u}</button>`)}
        </div>
        <button class="cg-deco-del press" onClick=${() => onChange(list.filter((_, k) => k !== i))}>移除</button>
      </div>`)}
    <div class="btn-row">
      <${Button} size="sm" variant="ghost" icon="plus" onClick=${() => onChange([...list, { url: '', use: '背景' }])}>添加图片地址<//>
      <${Button} size="sm" variant="ghost" icon="image" onClick=${() => phone.intent.open('tools', { route: '/imghost' })}>去图床上传<//>
    </div>`;
}

/** 选好的东西写成交给模型的那一段（是数据，保留中文） */
function requestOf(f) {
  const pal = PALETTES.find(p => p.label === f.palette);
  const lines = [
    (f.kind || f.kindText) && `Card: ${[f.kind, f.kindText].filter(Boolean).join('，')}`,
    (f.styles.length || f.styleText) && `Style: ${[...f.styles, f.styleText].filter(Boolean).join('、')}`,
    pal && `Palette: ${pal.label} ${pal.colors.join(' ')}`,
    f.colorText && `Colors: ${f.colorText}`,
    f.font && `Font: ${f.font}`,
    !f.followDark && 'Dark mode: the card looks the same in dark mode; the .eira-dark variant changes nothing.',
    f.decos.filter(d => d.url).length && `Decoration images: ${f.decos.filter(d => d.url).map(d => `${d.use || '装饰'} ${d.url}`).join('；')}`,
    (f.effects.length || f.effectText) && `Effects: ${[...f.effects, f.effectText].filter(Boolean).join('、')}`,
    f.fieldsText && `Fields wanted: ${f.fieldsText}`,
    f.wish && `What it should be like: ${f.wish}`,
  ].filter(Boolean);
  return lines.join('\n');
}

const needsFonts = f => /手写|像素/.test(f.font || '');

async function shrink(file, max = 1024) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL('image/jpeg', 0.86), mediaType: 'image/jpeg' };
}

export function CardGenPage() {
  useStore(db.lorebooks.store);
  const [f, set] = useToolState('cardgen', DEF);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [image, setImage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [keys, setKeys] = useState('');
  const fileRef = useRef(null);

  const r = f.result;
  const size = htmlcard.sizeOf({ width: f.width, ratio: f.ratio, height: f.height });
  const urls = f.decos.map(d => d.url).filter(u => /^https:\/\//i.test(u));
  const cardOf = res => ({
    html: res.html, fields: res.fields || {}, width: f.width, ratio: f.ratio, height: f.height,
    images: urls.length > 0 || needsFonts(f), sampleText: res.sample || '',
  });
  const card = r ? cardOf(r) : null;
  const fields = card ? htmlcard.fieldsOf(card.html, card.fields) : [];
  const doc = card ? htmlcard.docOf(card, htmlcard.parseValues(card.sampleText, fields), htmlcard.sampleSys()) : '';
  const problems = card ? htmlcard.problemsOf(card.html, { images: card.images }) : [];

  const run = async (label, fn) => {
    if (!ai.isConfigured()) { toast('尚未配置接口', 'error'); return; }
    setBusy(label); setErr('');
    try {
      const out = await fn();
      set({ result: { ...out, prefix: out.prefix || f.result?.prefix } });
      setKeys((out.keywords || []).join('，'));
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(''); }
  };

  const generate = () => {
    const request = requestOf(f);
    if (!request && !image) { toast('请至少选择或填写一项', 'error'); return; }
    const prefix = `c${rid()}-`;
    run('正在生成', async () => ({
      ...await T.cardGenerate({ request: request || 'Recreate the card in the attached screenshot.', width: size.w, height: size.h, prefix, urls, image }),
      prefix,
    }));
  };
  const revise = () => {
    if (!r || !f.change.trim()) return;
    run('正在修改', async () => {
      const out = await T.cardRevise({ meta: { name: r.name, description: r.description, keywords: r.keywords, fields: r.fields, sample: r.sample },
        html: r.html, change: f.change.trim(), urls });
      set({ change: '' });
      return out;
    });
  };

  const pickImage = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { setImage(await shrink(file)); } catch { toast('图片读取失败', 'error'); }
  };

  const books = db.lorebooks.all().filter(b => ai.lore.purposeOf(b) === 'chat');
  const save = bookId => {
    let target = bookId;
    if (!target) target = db.lorebooks.create({ name: '我的卡片', description: '', global: false, entries: [] }).id;
    const e = {
      id: phone.uid('e'), type: htmlcard.TYPE, comment: r.name || '新卡片',
      keys: keys.split(/[,，、]/).map(s => s.trim()).filter(Boolean), secondaryKeys: [],
      content: r.description || '', enabled: true, constant: false, priority: 100, order: 0,
      part: 'before', depth: 0, caseSensitive: false, probability: 100, card,
    };
    db.lorebooks.update(target, b => ({ entries: [...(b.entries || []), e] }));
    setSaving(false);
    toast('已存入世界书');
    phone.intent.open('lorebook', { route: `/entry/${target}/${e.id}` });
  };

  return html`
    <${Page} title="HTML 卡片生成器" onBack=${nav.pop}>
      <div class="pad">
        <div class="hint-box">
          生成只含 HTML 与 CSS 的卡片模板，不运行脚本。以下每一步都可以跳过，也都可以自己填写。
          生成后可以预览、继续修改，满意后连同说明与触发关键词存入世界书，角色即可在聊天中发送。
        </div>
      </div>

      <${List} title="1. 做什么卡片"><//>
      <div class="pad-x cg-sec">
        ${KINDS.map(g => html`
          <div key=${g.group} class="cg-group"><div class="cg-group-name">${g.group}</div>
            <${Chips} items=${g.items} value=${f.kind} onPick=${v => set({ kind: v })}/></div>`)}
        <${Input} value=${f.kindText} placeholder="其他：自己写" onInput=${v => set({ kindText: v })}/>
        <div class="cg-ref">
          <${Button} size="sm" variant="ghost" icon="image" onClick=${() => fileRef.current?.click()}>
            ${image ? '更换参考截图' : '上传参考截图（照着做）'}<//>
          ${image ? html`<button class="cg-deco-del press" onClick=${() => setImage(null)}>移除</button>` : null}
          <input type="file" accept="image/*" ref=${fileRef} onChange=${pickImage} style="display:none"/>
        </div>
        ${image ? html`<img class="cg-ref-img" src=${image.dataUrl} alt="参考截图"/>` : null}
        <div class="field-desc">上传截图时，所用接口需支持识图。截图只随这一次请求发送，不保存。</div>
      </div>

      <${List} title="2. 风格"><//>
      <div class="pad-x cg-sec">
        <${Chips} items=${STYLES} value=${f.styles} multi onPick=${v => set({ styles: v })}/>
        ${f.styles.length ? html`<div class="field-desc">${f.styles.map(s => `${s}：${STYLES.find(x => x.label === s)?.hint || ''}`).join('；')}</div>` : null}
        <${Input} value=${f.styleText} placeholder="其他风格：自己写" onInput=${v => set({ styleText: v })}/>
      </div>

      <${List} title="3. 配色与字体"><//>
      <div class="pad-x cg-sec">
        <div class="cg-pals">
          ${PALETTES.map(p => html`
            <button key=${p.label} class=${`cg-pal press${f.palette === p.label ? ' is-active' : ''}`}
              onClick=${() => set({ palette: f.palette === p.label ? '' : p.label })}>
              <span class="cg-sws">${p.colors.map(c => html`<i key=${c} class="cg-sw" style=${`--sw:${c}`}></i>`)}</span>
              <span>${p.label}</span>
            </button>`)}
        </div>
        <${Input} value=${f.colorText} placeholder="自己指定颜色，例如：主色 #3a6ea5，底色米白" onInput=${v => set({ colorText: v })}/>
        <div class="cg-group-name">字体</div>
        <${Chips} items=${FONTS} value=${f.font} onPick=${v => set({ font: v })}/>
        <div class="hc-field-row"><span class="hc-field-k">深色模式时卡片也变深</span>
          <${Switch} checked=${f.followDark} onChange=${v => set({ followDark: v })}/></div>
      </div>

      <${List} title="4. 尺寸"><//>
      <div class="pad-x cg-sec">
        <${Chips} items=${[{ label: '气泡宽' }, { label: '整行宽' }]} value=${f.width === 'full' ? '整行宽' : '气泡宽'}
          onPick=${v => set({ width: v === '整行宽' ? 'full' : 'bubble' })}/>
        <${Chips} items=${Object.entries(htmlcard.RATIOS).map(([k, x]) => ({ label: x.label, k }))}
          value=${htmlcard.RATIOS[f.ratio]?.label} onPick=${v => {
            const hit = Object.entries(htmlcard.RATIOS).find(([, x]) => x.label === v);
            if (hit) set({ ratio: hit[0] });
          }}/>
        ${f.ratio === 'custom' ? html`
          <${Field} label="高度（px）"><${Input} type="number" value=${f.height} onInput=${v => set({ height: Math.max(40, Number(v) || 300) })}/><//>` : null}
        <div class="field-desc">聊天中显示为 ${size.w} × ${size.h}px，与聊天界面的气泡宽度一致；内容更长时在卡片内滚动，也可以点「展开」全屏查看。</div>
      </div>

      <${List} title="5. 装饰图片"><//>
      <div class="pad-x cg-sec">
        <div class="field-desc">填写 https 开头的图片地址并选择用途。填写后该卡片会开启「外部图片与字体」，图片所在的服务器能看到访问记录。</div>
        <${Decos} list=${f.decos} onChange=${v => set({ decos: v })}/>
      </div>

      <${List} title="6. 特效"><//>
      <div class="pad-x cg-sec">
        <div class="field-desc">全部由 CSS 实现，不运行脚本。「点一下」「按住」类的效果在聊天中直接点卡片即可。</div>
        ${EFFECTS.map(g => html`
          <div key=${g.group} class="cg-group"><div class="cg-group-name">${g.group}</div>
            <${Chips} items=${g.items} value=${f.effects} multi onPick=${v => set({ effects: v })}/></div>`)}
        <${Input} value=${f.effectText} placeholder="其他效果：自己写" onInput=${v => set({ effectText: v })}/>
      </div>

      <${List} title="7. 内容与想法"><//>
      <div class="pad-x cg-sec">
        <${Field} label="需要哪些字段" desc="角色发送时填写的内容，以逗号分隔。留空由模型决定。">
          <${Input} value=${f.fieldsText} placeholder="片名，场次，座位，背面的一句话" onInput=${v => set({ fieldsText: v })}/>
        <//>
        <${Field} label="想实现什么">
          <${Textarea} rows=${4} value=${f.wish} onInput=${v => set({ wish: v })} placeholder="描述想要的效果、质感、交互"/>
        <//>
        <div class="chip-row">
          ${WISH_EXAMPLES.map(x => html`<button key=${x} class="chip cg-example" onClick=${e => { e.preventDefault(); set({ wish: x }); }}>${x}</button>`)}
        </div>
      </div>

      <div class="pad">
        <${Button} full disabled=${!!busy} onClick=${generate}>${busy === '正在生成' ? html`<${Spinner}/> 正在生成` : r ? '重新生成' : '生成'}<//>
        <${CallNote} n=${1}/>
        ${err ? html`<div class="hint-box is-warn">${err}</div>` : null}
      </div>

      ${r ? html`
        <${List} title=${`结果 · ${r.name || '未命名'}`}><//>
        <div class="pad-x hc-preview">
          <div class="hc-card" style=${`--hc-w:${size.w}px`}>
            <div class="hc-bar"><span class="hc-bar-name">卡片 · ${r.name || '未命名'}</span></div>
            <${CardFrame} doc=${doc} w=${size.w} h=${size.h} title=${r.name || '预览'}/>
          </div>
          ${problems.length ? html`<div class="hint-box is-warn">${problems.map(p => html`<div key=${p}>${p}</div>`)}</div>` : null}
        </div>
        <div class="pad-x cg-sec">
          <${Field} label="说明（进入 prompt）"><${Textarea} rows=${2} value=${r.description}
            onInput=${v => set({ result: { ...r, description: v } })}/><//>
          <div class="field-desc">字段：${fields.map(x => (x.list ? `${x.name}（列表）` : x.name)).join('、') || '无'}</div>
          <${Field} label="修改" desc="写下要改的地方，例如：字再大一点；背景换成蓝色；点一下翻到背面。">
            <${Textarea} rows=${2} value=${f.change} onInput=${v => set({ change: v })}/>
          <//>
          <div class="btn-row">
            <${Button} size="sm" disabled=${!!busy || !f.change.trim()} onClick=${revise}>${busy === '正在修改' ? '正在修改' : '按要求修改'}<//>
            <${Button} size="sm" variant="ghost" onClick=${() => set({ showCode: !f.showCode })}>${f.showCode ? '收起代码' : '查看代码'}<//>
            <${Button} size="sm" variant="ghost" icon="copy" onClick=${() => copyText(r.html)}>复制代码<//>
          </div>
          <${CallNote} n=${1} extra="每修改一次调用一次"/>
          ${f.showCode ? html`<${Textarea} rows=${14} class="tb-code" value=${r.html} spellcheck=${false}
            onInput=${v => set({ result: { ...r, html: v } })}/>` : null}
        </div>
        <div class="pad">
          <${Button} full icon="book" onClick=${() => setSaving(true)}>存入世界书<//>
        </div>` : null}

      <${Sheet} open=${saving} onClose=${() => setSaving(false)} title="存入世界书">
        <div class="pad">
          <${Field} label="触发关键词" desc="以逗号分隔。对话中出现任意一个时，这张卡片进入 prompt。存入后可在世界书中修改。">
            <${Input} value=${keys} onInput=${setKeys}/>
          <//>
        </div>
        <${List} title="存到">
          ${books.map(b => html`<${ListItem} key=${b.id} title=${b.name} arrow onClick=${() => save(b.id)}/>`)}
          <${ListItem} title="新建一本「我的卡片」" arrow onClick=${() => save('')}/>
        <//>
      <//>
    <//>`;
}

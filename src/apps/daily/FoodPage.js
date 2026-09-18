import { html, useState, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Sheet, Button, Field, Input, NumberInput, Segmented,
         Switch, Icon, IconButton, Spinner, EmptyState, toast, confirm } from '../../ui/index.js';

const { db, nav, food, ai } = phone;

const MEAL_ITEMS = [{ value: '', label: '不限' },
  ...food.MEALS.map(m => ({ value: m.id, label: m.label }))];
const BLANK = { id: '', name: '', note: '', place: '', meal: '' };

function Editor({ open, region, item, onClose }) {
  const [cur, setCur] = useState(BLANK);
  useEffect(() => { if (open) setCur(item ? { ...BLANK, ...item } : BLANK); }, [open, item]);
  const set = patch => setCur(c => ({ ...c, ...patch }));

  const save = () => {
    try {
      if (cur.id) food.update(cur.id, cur);
      else food.add({ ...cur, region });
      onClose();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  return html`
    <${Sheet} open=${open} onClose=${onClose} title=${item ? '编辑条目' : '添加条目'}>
      <div class="pad">
        <${Field} label="名称">
          <${Input} value=${cur.name} onInput=${v => set({ name: v })} placeholder="例如：担担面"/>
        <//>
        <${Field} label="店" desc="可以不写。写了之后上下文里会带上店名。">
          <${Input} value=${cur.place} onInput=${v => set({ place: v })} placeholder="例如：陈记面馆"/>
        <//>
        <${Field} label="说明" desc="可以不写。一句「什么样的」，不写好吃与否。">
          <${Input} value=${cur.note} onInput=${v => set({ note: v })} placeholder="例如：加了很多花生碎"/>
        <//>
        <${Field} label="哪一顿" desc="选了就只在这一顿被抽到。选「不限」表示哪一顿都可能。">
          <${Segmented} value=${cur.meal || ''} items=${MEAL_ITEMS}
            onChange=${v => set({ meal: v })}/>
        <//>
        <div class="pad-t"><${Button} full onClick=${save}>保存<//></div>
      </div>
    <//>`;
}

function GenSheet({ open, region, onClose }) {
  const [count, setCount] = useState(20);
  const [meal, setMeal] = useState('');
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const canWeb = ai.recipeBatch.canSearch();

  const run = async () => {
    if (!ai.isConfigured() && !web) { toast('尚未配置聊天接口', 'error', 4000); return; }
    setBusy(true);
    try {
      const rows = await ai.recipeBatch.generate({ region, meal, count, web });
      const made = food.addMany(rows, region);
      toast(made.length ? `已入库 ${made.length} 条` : '没有新的条目，可能与已有内容重复',
        made.length ? 'ok' : 'plain', 4000);
      if (made.length) onClose();
    } catch (err) {
      toast(String(err.message || err), 'error', 6000);
    } finally { setBusy(false); }
  };

  return html`
    <${Sheet} open=${open} onClose=${onClose} title="批量生成">
      <div class="pad">
        <${Field} label="条数" desc="没有上限，填多少生成多少。已有的条目会一并发过去以避免重复。">
          <${NumberInput} unit="条" min=${1} value=${count} onChange=${setCount}/>
        <//>
        <${Field} label="哪一顿">
          <${Segmented} value=${meal} items=${MEAL_ITEMS} onChange=${setMeal}/>
        <//>
        <${List}>
          <${ListItem} title="联网搜索真实的店" multiline
            subtitle=${!canWeb
              ? '需先在「设置 - 联网搜索」中配置能联网的接口。未配置时按常见食物生成，不带店名'
              : !region
                ? '需要先填写地区。联网搜索按地区查证，不填地区无从查起'
                : `搜索${region}真实存在的吃处，条目会带上店名。这一档走单独配置的接口，费用另计`}
            right=${canWeb && region
              ? html`<${Switch} checked=${web} onChange=${setWeb}/>`
              : html`<span class="li-hint">不可用</span>`}/>
        <//>
        <div class="pad-t">
          <${Button} full disabled=${busy} onClick=${run}>
            ${busy ? html`<${Spinner} size=${15}/>` : null}${busy ? '正在生成' : '生成'}
          <//>
        </div>
      </div>
    <//>`;
}

export function FoodPage({ region = '' }) {
  useStore(db.recipes.store);
  const [open, setOpen] = useState(false);
  const [gen, setGen] = useState(false);
  const [editing, setEditing] = useState(null);

  const list = food.list({ region });
  const title = region || '不分地区';

  const del = async r => {
    if (!await confirm({ title: '删除条目', message: `将删除「${r.name}」。`, danger: true })) return;
    food.remove(r.id);
  };

  return html`
    <${Page} title=${`吃什么 · ${title}`} onBack=${nav.pop}
      right=${html`
        <${IconButton} name="sparkle" label="批量生成" onClick=${() => setGen(true)}/>
        <${IconButton} name="plus" label="添加"
          onClick=${() => { setEditing(null); setOpen(true); }}/>`}>

      ${list.length ? html`
        <div class="pad-x pad-t">
          <div class="hint-box">
            共 ${list.length} 条。角色吃到的是「所在地区」这一批加上不分地区的那一批。
            最近吃过的会被压一压，但不会被封杀 —— 爱吃的仍然会常出现。
          </div>
        </div>
        <${List}>
          ${list.map(r => html`
            <${ListItem} key=${r.id} title=${r.name} multiline
              subtitle=${[food.mealOf(r.meal)?.label, r.place, r.note].filter(Boolean).join(' · ') || '不限'}
              left=${html`<${Icon} name=${r.off ? 'close' : 'cup'} size=${18}/>`}
              right=${html`
                <${Switch} checked=${!r.off} onChange=${v => food.update(r.id, { off: !v })}/>
                <${IconButton} name="trash" size=${17} label="删除"
                  onClick=${e => { e.stopPropagation(); del(r); }}/>`}
              onClick=${() => { setEditing(r); setOpen(true); }}/>`)}
        <//>`
      : html`<${EmptyState} icon="cup" title="这一批还是空的"
          desc=${region
            ? `${region}的常见食物。可以手动添加，也可以批量生成。`
            : '哪儿都吃得到的那些。所有角色都会从这一批里抽。'}
          action=${html`<${Button} size="sm" onClick=${() => setGen(true)}>批量生成<//>`}/>`}

      <${Editor} open=${open} region=${region} item=${editing}
        onClose=${() => { setOpen(false); setEditing(null); }}/>
      <${GenSheet} open=${gen} region=${region} onClose=${() => setGen(false)}/>
    <//>`;
}

export function FoodHome() {
  useStore(db.recipes.store);
  useStore(db.characters.store);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const counts = food.counts();
  const regions = food.regions();
  // 角色卡上填了、但库里还没有的地区，也列出来，否则得先建一条才找得到入口
  const wanted = [...new Set(db.characters.all().map(c => food.regionOf(c)).filter(Boolean))];
  const all = [...new Set(['', ...regions, ...wanted])];

  const add = () => {
    const r = name.trim().slice(0, 20);
    if (!r) return;
    setName(''); setAdding(false);
    nav.push(`/food/${encodeURIComponent(r)}`);
  };

  return html`
    <${Page} title="吃什么" onBack=${nav.pop}
      right=${html`<${IconButton} name="plus" label="新增地区" onClick=${() => setAdding(true)}/>`}>
      <div class="pad-x pad-t">
        <div class="hint-box">
          吃什么不由模型决定，而是本地从这里抽，抽的时候看一眼最近吃过什么。
          问十次得到十次同一样东西，是因为模型没有记性，不是因为它偷懒。
        </div>
      </div>
      <${List}>
        ${all.map(r => html`
          <${ListItem} key=${r || '_'} title=${r || '不分地区'} arrow
            subtitle=${`${counts[r] || 0} 条`
              + (r ? '' : '。所有角色都会从这一批里抽')}
            multiline
            left=${html`<${Icon} name="cup" size=${19}/>`}
            onClick=${() => nav.push(`/food/${encodeURIComponent(r)}`)}/>`)}
      <//>
      <div class="settings-foot">
        角色吃到的是它「所在地区」这一批加上不分地区的那一批。所在地区在角色卡中填写。
      </div>

      <${Sheet} open=${adding} onClose=${() => setAdding(false)} title="新增地区">
        <div class="pad">
          <${Field} label="地区" desc="和角色卡上的「所在地区」写成一样，两边才对得上。">
            <${Input} value=${name} onInput=${setName} placeholder="例如：成都"/>
          <//>
          <${Button} full onClick=${add}>建立<//>
        </div>
      <//>
    <//>`;
}

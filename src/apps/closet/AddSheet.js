import { html, useState, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Sheet, Button, Field, Input, Icon, toast, confirm } from '../../ui/index.js';
import { Thumb } from './parts.js';

const { db, nav, closet } = phone;
const K = closet.kinds;

// 往衣帽间里放东西。两条路：
//   拍照 / 选图  一次可以选好几张，每张一件；识图按张算，先问一句再调
//   手动添加    先选大类、再选小类、写个名字，两三下就放进去，其余在单品页里慢慢填
// group 给了就直接放进那个大类（从大类页点「添加」进来时）

/** 识图整理这几件。先问一句：几件就是几次接口调用 */
export async function recognizeAsk(ids) {
  if (!ids.length) return;
  if (!closet.ai.isVisionReady()) {
    toast('尚未配置识图接口，已放入衣帽间，可稍后手动整理');
    return;
  }
  if (!await confirm({
    title: `识图整理这 ${ids.length} 件`,
    message: `将调用 ${ids.length} 次识图接口，自动填写分类、颜色、季节、场合与描述。已填写的内容不会被覆盖。`,
    okText: '识图',
  })) return;
  toast(`正在识图，共 ${ids.length} 件`);
  const r = await closet.ai.recognizeMany(ids);
  toast(r.failed.length
    ? `已识别 ${r.done} 件，${r.failed.length} 件失败：${r.failed[0].error}`
    : `已识别 ${r.done} 件`, r.failed.length ? 'error' : 'ok', 5000);
}

export function AddSheet({ open, owner, side, group = '', onClose }) {
  useStore(db.settings.store);
  const fileRef = useRef(null);
  const [step, setStep] = useState('pick');     // pick | manual
  const [g, setG] = useState(group);
  const [sub, setSub] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const close = () => { setStep('pick'); setG(group); setSub(''); setName(''); onClose(); };

  const fromFiles = async e => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      const made = await closet.addPhotos(files, { owner, side, group: g, sub });
      close();
      if (made.length === 1) nav.push(`/item/${made[0].id}`);
      else toast(`已放入 ${made.length} 件${g ? '' : '，在「未整理」中'}`, 'ok');
      await recognizeAsk(made.map(r => r.id));
    } catch (err) { toast('图片处理失败：' + (err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };

  const manual = () => {
    if (!g) { toast('请选择大类'); return; }
    if (!name.trim()) { toast('请填写名称'); return; }
    const row = closet.create({ owner, side, group: g, sub, name });
    close();
    nav.push(`/item/${row.id}`);
  };

  const groups = closet.groupsOf(side);
  return html`
    <${Sheet} open=${true} onClose=${close} title=${`放进${K.sideOf(side).label}`} height="80%">
      ${step === 'pick' ? html`
        <div class="cl-add-ways">
          <button class="cl-add-way press" disabled=${busy} onClick=${() => fileRef.current?.click()}>
            <${Icon} name="camera" size=${22}/>
            <b>拍照或选图</b>
            <span>可一次选择多张，每张一件。识图可自动填写分类与描述</span>
          </button>
          <button class="cl-add-way press" onClick=${() => setStep('manual')}>
            <${Icon} name="edit" size=${22}/>
            <b>手动添加</b>
            <span>选择分类、填写名称。适合没有照片的东西</span>
          </button>
        </div>
        <input type="file" accept="image/*" multiple ref=${fileRef} onChange=${fromFiles} style="display:none"/>`
      : html`
        <${Field} label="大类">
          <div class="chip-row">
            ${groups.map(x => html`
              <button key=${x.id} class=${`chip${g === x.id ? ' is-active' : ''}`}
                onClick=${() => { setG(x.id); setSub(''); }}>${x.label}</button>`)}
          </div>
        <//>
        ${g ? html`
          <${Field} label="小类">
            <div class="chip-row">
              ${closet.subsOf(g).map(s => html`
                <button key=${s.label} class=${`chip${sub === s.label ? ' is-active' : ''}`}
                  onClick=${() => setSub(sub === s.label ? '' : s.label)}>${s.label}</button>`)}
            </div>
          <//>` : null}
        <${Field} label="名称">
          <${Input} value=${name} onInput=${setName} placeholder=${side === 'beauty' ? '例如 某品牌粉底液' : '例如 白色针织衫'}/>
        <//>
        <div class="sheet-acts">
          <${Button} variant="ghost" onClick=${() => setStep('pick')}>返回<//>
          <${Button} onClick=${manual}>放进去<//>
        </div>`}
    <//>`;
}

/** 今天穿的：按大类列出这个人的衣物，勾上就是今天穿着 */
export function TodaySheet({ open, owner, onClose }) {
  useStore(db.closet.store);
  if (!open) return null;
  const rows = closet.itemsOf(owner).filter(r => r.side === 'wear' && closet.live(r) && r.group);
  const d = closet.today();
  const groups = closet.groupsOf('wear').filter(g => rows.some(r => r.group === g.id));
  return html`
    <${Sheet} open=${true} onClose=${onClose} title="今天穿的" height="86%">
      ${groups.length ? groups.map(g => html`
        <div key=${g.id} class="cl-today-group">
          <div class="cl-filter-label">${g.label}</div>
          <div class="cl-today-row">
            ${rows.filter(r => r.group === g.id).map(r => html`
              <button key=${r.id} class=${`cl-today-pick press${r.wornOn === d ? ' is-on' : ''}`}
                onClick=${() => closet.wear(r.id, r.wornOn !== d)}>
                <${Thumb} item=${r}/>
                <span class="ellipsis">${r.name}</span>
                ${r.wornOn === d ? html`<i class="cl-tick"><${Icon} name="check" size=${12}/></i>` : null}
              </button>`)}
          </div>
        </div>`)
      : html`<div class="settings-foot">衣橱里还没有分好类的衣物。</div>`}
      <div class="settings-foot">
        勾选的衣物记为今天穿着，穿着次数加一，第二天自动清空。
        开启「衣帽间」上下文时，角色看得到今天穿的是哪几件，以及其中哪些是谁送的。
      </div>
      <div class="sheet-acts"><${Button} full onClick=${onClose}>完成<//></div>
    <//>`;
}

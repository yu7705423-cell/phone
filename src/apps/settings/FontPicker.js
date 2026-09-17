import { html, useState, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { List, ListItem, Button, Icon, Sheet, toast, confirm, prompt } from '../../ui/index.js';

const { db, fonts } = phone;

const fmt = b => b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;

// 一行预览，直接用那个字体渲染，选之前就能看出长什么样
function Sample({ id }) {
  const fam = id ? fonts.familyOf(id) : null;
  return html`
    <div class="font-sample" style=${fam ? `font-family:${fam}, var(--font)` : ''}>
      小手机 Aa 永 132
    </div>`;
}

function Slot({ label, desc, value, onPick }) {
  const cur = value ? fonts.get(value) : null;
  return html`
    <${ListItem} title=${label} subtitle=${desc} multiline arrow
      right=${html`<span class="font-slot-val ellipsis">${cur?.name || '系统默认'}</span>`}
      onClick=${onPick}/>`;
}

// 自定义字体。放在「主题」里，和别的观感设置在一起，见 CLAUDE.md 第 5 条。
export function FontPicker() {
  const s = useStore(db.settings.store);
  const [busy, setBusy] = useState(false);
  const [slot, setSlot] = useState(null);      // 'fontBody' | 'fontSerif'
  const [held, setHeld] = useState(null);
  const fileRef = useRef(null);

  const list = fonts.list();

  const upload = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const rec = await fonts.add(file);
      // 装完先加载一次，预览那一行立刻就能看到
      await fonts.ensureLoaded(rec.id);
      toast(`装好了 ${rec.name}`, 'ok');
    } catch (err) {
      toast(String(err.message || err), 'error', 5000);
    } finally { setBusy(false); }
  };

  const choose = id => {
    db.settings.set({ [slot]: id });
    setSlot(null);
  };

  const doRename = async rec => {
    setHeld(null);
    const name = await prompt({ title: '改名字', value: rec.name });
    if (name === null) return;
    fonts.rename(rec.id, (name || '').trim());
  };

  const doRemove = async rec => {
    setHeld(null);
    const using = s.fontBody === rec.id || s.fontSerif === rec.id;
    if (!await confirm({
      title: '删掉字体', danger: true, okText: '删掉',
      message: using ? `「${rec.name}」正在用，删了会变回系统默认。` : `「${rec.name}」会被删掉。`,
    })) return;
    await fonts.remove(rec.id);
    toast('删了');
  };

  return html`
    <${List} title="字体">
      <${Slot} label="正文" desc="整个界面的字"
        value=${s.fontBody} onPick=${() => setSlot('fontBody')}/>
      <${Slot} label="衬线" desc="挂件里勾了「衬线」的那几行文字用它"
        value=${s.fontSerif} onPick=${() => setSlot('fontSerif')}/>
    <//>

    ${list.length ? html`
      <div class="look-list">
        ${list.map(f => html`
          <div key=${f.id} class="look-row">
            <div class="look-card">
              <div class="look-meta">
                <div class="look-name ellipsis">${f.name}</div>
                <div class="look-sub">${fmt(f.bytes || 0)}${
                  s.fontBody === f.id ? ' · 正文在用' : ''}${
                  s.fontSerif === f.id ? ' · 衬线在用' : ''}</div>
                <${Sample} id=${f.id}/>
              </div>
            </div>
            <button class="look-more press" onClick=${() => setHeld(f)} aria-label="更多">
              <${Icon} name="more" size=${18}/>
            </button>
          </div>`)}
      </div>` : null}

    <div class="pad">
      <${Button} full variant="ghost" icon="upload" disabled=${busy}
        onClick=${() => fileRef.current?.click()}>${busy ? '正在装' : '传一个字体'}<//>
    </div>
    <input type="file" accept=${fonts.ACCEPT} ref=${fileRef} onChange=${upload} style="display:none"/>

    <div class="settings-foot">
      支持 ttf / otf / woff / woff2，存在本地。<br/>
      中文字体动辄十几 M，装多了会占空间也会拖慢启动。
    </div>

    <${Sheet} open=${!!slot} onClose=${() => setSlot(null)}
      title=${slot === 'fontSerif' ? '衬线用哪个' : '正文用哪个'} height="60%">
      <${List} inset=${false}>
        <${ListItem} title="系统默认" onClick=${() => choose('')}
          right=${!s[slot] ? html`<${Icon} name="check" size=${17}/>` : null}/>
        ${list.map(f => html`
          <${ListItem} key=${f.id} title=${f.name} multiline
            subtitle=${html`<${Sample} id=${f.id}/>`}
            onClick=${() => choose(f.id)}
            right=${s[slot] === f.id ? html`<${Icon} name="check" size=${17}/>` : null}/>`)}
      <//>
      ${list.length ? null : html`
        <div class="settings-foot">还没传过字体，先在下面传一个</div>`}
    <//>

    <${Sheet} open=${!!held} onClose=${() => setHeld(null)} title=${held?.name || ''} height="36%">
      ${held ? html`
        <${List} inset=${false}>
          <${ListItem} title="改名字" arrow
            left=${html`<${Icon} name="edit" size=${18}/>`}
            onClick=${() => doRename(held)}/>
          <${ListItem} title="删掉" danger arrow
            left=${html`<${Icon} name="trash" size=${18}/>`}
            onClick=${() => doRemove(held)}/>
        <//>` : null}
    <//>`;
}

import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Icon, Button, Textarea, List, ListItem, Sheet, FullSheet,
         Switch, NumberInput, Field, toast, confirm } from '../../../ui/index.js';
import { Prose, Sign, Byline, Versions } from './StageBits.js';

const { db, nav, ai, scene: sceneApi, stage } = phone;

// 在聊天里直接演的那种线下。见 ARCHITECTURE 4.110
//
// **整场戏渲染在一条消息里。** 消息流里写一条 kind 为 scene 的锚点，
// 它底下挂着这一场的全部正文。不把段落混进消息列表，是因为那一页的
// 分页（一屏多少条）、多选、引用、搜索全都按「一条消息」算，混流要各改
// 一遍，而它们都在会话页那个一千七百行的文件里。
//
// 翻页与分张在这一档不适用：内联本来就是往下滚的，没有「一张」这回事。

function Divider({ label, mark }) {
  return html`
    <div class=${`sc-div${mark ? ' is-end' : ''}`}>
      <span class="sc-div-line"></span>
      <span class="sc-div-text">${label}</span>
      <span class="sc-div-line"></span>
    </div>`;
}

export function SceneBlock({ sceneId, onSetup }) {
  useStore(db.scenes.store);
  useStore(db.beats.store);
  useStore(db.settings.store);
  const [picked, setPicked] = useState(null);
  const [editing, setEditing] = useState(null);
  const [notes, setNotes] = useState(null);

  const row = sceneApi.get(sceneId);
  if (!row) return html`<${Divider} label="这一场已经删除"/>`;

  const cfg = stage.forScene(row);
  const beats = sceneApi.beatsOf(sceneId);
  const told = beats.filter(b => b.role !== sceneApi.DIRECTOR);
  const head = [row.title || row.place, row.at].filter(Boolean).join(' · ') || '线下';

  const versOf = beat => {
    const list = sceneApi.versionsOf(beat);
    return list.length > 1
      ? { n: list.length, at: Math.min(list.length - 1, Number(beat.swipeIndex) || 0) }
      : null;
  };

  let index = -1;
  let pend = [];

  const rows = beats.map(b => {
    if (b.role === sceneApi.DIRECTOR) { pend = [...pend, b]; return null; }
    index += 1;
    const mine = pend;
    pend = [];
    const sign = sceneApi.signOf(b, row);
    const v = versOf(b);
    let timer = null;
    const start = () => { timer = setTimeout(() => { timer = null; setPicked(b); }, 520); };
    const end = () => { if (timer) { clearTimeout(timer); timer = null; } };
    return html`
      <div key=${b.id} class="sc-beat no-callout"
        onTouchStart=${start} onTouchEnd=${end} onTouchMove=${end} onTouchCancel=${end}
        onContextMenu=${e => { e.preventDefault(); setPicked(b); }}>
        ${mine.length ? html`
          <button class="sg-note press" onClick=${() => setNotes(mine)}>
            场外指示 ${mine.length}
          <//>` : null}
        ${cfg.sign === 'none' ? null
    : cfg.sign === 'line'
      ? html`<${Byline} sign=${sign} no=${index}/>`
      : html`<${Sign} sign=${sign} no=${index} face=${cfg.layout === 'cards'}/>`}
        <${Prose} text=${b.text} marks=${cfg.marks} drop=${cfg.drop}/>
        ${v ? html`<${Versions} ...${v} onPick=${i => sceneApi.pickSwipe(b.id, i)}/>` : null}
      </div>`;
  }).filter(Boolean);

  const drop = async () => {
    const beat = picked;
    setPicked(null);
    if (!beat) return;
    const ok = await confirm({ title: '删除这一段', message: '删除后无法恢复。', okText: '删除', danger: true });
    if (ok) sceneApi.dropBeat(beat.id);
  };

  return html`
    <div class="sc-block" style=${stage.varsOf(cfg)}>
      <${Divider} label=${head}/>
      ${rows}
      ${!told.length ? html`<div class="sg-eyebrow sc-empty">这一场还没有正文。</div>` : null}
      ${row.endedAt
    ? html`<${Divider} label="回到线上" mark/>`
    : html`
        <div class="sc-acts">
          <button class="sc-act press" onClick=${() => onSetup && onSetup("setup", sceneId)}>这一场</button>
          <button class="sc-act press" onClick=${() => onSetup && onSetup("look", sceneId)}>外观</button>
          <button class="sc-act press" onClick=${async () => {
    const ok = await confirm({ title: '收场', message: '收场后输入框回到线上。这一场仍然留在这里。', okText: '收场' });
    if (ok) {
      sceneApi.endScene(sceneId);
      if (db.settings.get().sceneSummary === true) {
        ai.scene.wrap(sceneId).then(t => toast(t ? '已生成摘要' : '没有可供摘要的内容'))
          .catch(err => toast(err.message || '生成失败', 'error'));
      }
    }
  }}>收场</button>
        </div>`}

      <${Sheet} open=${!!picked} onClose=${() => setPicked(null)} title="这一段">
        <${List}>
          <${ListItem} title="复制" onClick=${() => {
    navigator.clipboard?.writeText(picked?.text || '');
    setPicked(null); toast('已复制', 'ok');
  }}/>
          <${ListItem} title="编辑" subtitle="改的是当前这一版"
            onClick=${() => { setEditing({ id: picked.id, text: picked.text }); setPicked(null); }}/>
          <${ListItem} title=${picked?.pinned ? '取消钉住' : '钉住'}
            subtitle="钉住的段落不受窗口与预算限制，始终进入上下文"
            onClick=${() => { sceneApi.togglePin(picked.id); setPicked(null); }}/>
          ${sceneApi.versionsOf(picked).length > 1 ? html`
            <${ListItem} title="删掉当前这一版" danger
              onClick=${() => { sceneApi.dropSwipe(picked.id); setPicked(null); }}/>` : null}
          <${ListItem} title="从这一段分叉" subtitle="删除这一段及其之后的内容"
            onClick=${async () => {
    const beat = picked; setPicked(null);
    const ok = await confirm({ title: '从这一段分叉',
      message: '这一段及其之后的内容将被删除。', okText: '删除', danger: true });
    if (ok && beat) sceneApi.dropFrom(beat.id);
  }}/>
          <${ListItem} title="删除" danger onClick=${drop}/>
        <//>
      <//>

      <${Sheet} open=${!!notes} onClose=${() => setNotes(null)} title="场外指示">
        <${List}>
          ${(notes || []).map(n => html`
            <${ListItem} key=${n.id} title=${n.text} multiline
              subtitle=${n.hold ? '一直有效' : '只作用于紧接着的一段'}
              onClick=${() => { sceneApi.dropBeat(n.id); setNotes(null); }}/>`)}
        <//>
      <//>

      <${FullSheet} open=${!!editing} onClose=${() => setEditing(null)} title="编辑这一段"
        right=${html`<${Button} size="sm" onClick=${() => {
    sceneApi.editBeat(editing.id, editing.text);
    setEditing(null);
  }}>保存<//>`}>
        <div class="pad">
          <${Textarea} rows=${16} value=${editing?.text || ''}
            onInput=${v => setEditing(e => ({ ...e, text: v }))}/>
        </div>
      <//>
    </div>`;
}

// 悬浮窗。内联的时候没有线下那一页的菜单可挂，常用的那几项浮在正文上面。
// 只放**当场就想调**的：主题、字号、署名、首字下沉、对白分色。
// 其余（壁纸、自定义 CSS、字体链接）仍在那一整页里，一按就过去。
export function LookFloat({ sceneId, onClose }) {
  useStore(db.settings.store);
  useStore(db.scenes.store);
  const row = sceneId ? sceneApi.get(sceneId) : null;
  const cfg = stage.forScene(row);
  // **改的是全局那一份，不是这一场的覆盖。** 这是读着读着随手调的那种旋钮，
  // 调完当然该一直是这样；写成场次级覆盖的话，下一场又变回去，而且每用一次
  // 就在那一场上留一份看不见的覆盖。想只改这一场，去完整设置页（第 5 条）。
  const set = patch => stage.set(patch);
  const scoped = !!(row && row.stage && Object.keys(row.stage).length);

  return html`
    <div class="sc-float-wrap" onClick=${onClose}>
      <div class="sc-float" onClick=${e => e.stopPropagation()}>
        <div class="sc-float-head">
          <span>外观</span>
          <button class="sc-float-x press" onClick=${onClose} aria-label="关闭">
            <${Icon} name="close" size=${16}/>
          <//>
        </div>
        <div class="sc-float-body">
          <div class="sc-float-themes">
            ${stage.THEMES.filter(t => t.id !== 'custom').map(t => html`
              <button key=${t.id} class=${`sc-swatch press${cfg.theme === t.id ? ' is-on' : ''}`}
                style=${`background:${t.bg};color:${t.ink};border-color:${t.line}`}
                onClick=${() => stage.useTheme(t.id)}>${t.label}<//>`)}
          </div>
          ${scoped ? html`
            <div class="sc-float-note">这一场另外设过外观，此处的改动被它盖住。
              在完整外观设置中可以清除。</div>` : null}
          <${Field} label="字号">
            <${NumberInput} value=${cfg.fontSize} unit="px"
              onChange=${v => set({ fontSize: Math.max(10, Math.min(40, v || 17)) })}/>
          <//>
          <${List}>
            <${ListItem} title="首字下沉"
              right=${html`<${Switch} checked=${cfg.drop} onChange=${v => set({ drop: v })}/>`}/>
            <${ListItem} title="区分对白与动作"
              right=${html`<${Switch} checked=${cfg.marks} onChange=${v => set({ marks: v })}/>`}/>
            <${ListItem} title="署名" subtitle=${(stage.SIGNS.find(x => x.id === cfg.sign) || {}).label}
              onClick=${() => {
    const at = stage.SIGNS.findIndex(x => x.id === cfg.sign);
    set({ sign: stage.SIGNS[(at + 1) % stage.SIGNS.length].id });
  }}/>
            <${ListItem} title="完整外观设置" arrow
              onClick=${() => { onClose(); nav.push(`/stage/settings${sceneId ? `/${sceneId}` : ''}`); }}/>
          <//>
        </div>
      </div>
    </div>`;
}

import { html, useState, useRef, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, EmptyState, toast, confirm } from '../../ui/index.js';
import { Control } from './Controls.js';

const { db, nav, skin } = phone;
const gen = skin.gen;

// 生成器。见 ARCHITECTURE 4.138
//
// **不挂在任何一段会话上。** 顶上那块是一份手写的复刻页（system/skin-stage.js），
// 把要调的状态一次摆全：同一个人连发三条、一轮拆成两个气泡、引用、表情、
// 时刻与已读。真会话页上凑齐这一屏得先造一段假数据进库。
//
// 分组的顺序就是页面从上到下的顺序。展开一组，预览滚到并放大那一块。

const STAGE_W = 430;
const BOX_H = 330;
const ZOOM = 1.9;

/**
 * 顶上那块预览。
 *
 * 画在 shadow root 里：这份美化的 CSS 直接塞进页面会把整个 app 一起改了。
 * 令牌那一段要挂在 `:host` 上 —— shadow 里没有 `:root`，挂过去整段静静地不生效。
 */
function Stage({ row, focus }) {
  const hostRef = useRef(null);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const base = await skin.stageCss();
      if (!alive || !hostRef.current) return;
      const host = hostRef.current;
      const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${base}\n${skin.STAGE_CSS}\n`
        + `${skin.compile(row, { varsOn: ':host' })}</style>`
        + `<div class="stage-scale">${skin.buildStage()}</div>`;
      setReady(n => n + 1);
    })();
    return () => { alive = false; };
  }, [row?.id, row?.updatedAt]);

  // 放大到某一块。
  //
  // 基准倍率把 430 宽的复刻页缩进这个盒子。聚焦时**按目标的高度算倍率**，
  // 让它占到盒子的一半多一点：顶栏只有几十像素，要放大不少才看得清；
  // 消息区本来就有几百像素高，再放大只会看不到全貌，所以那种情况不放大。
  // 横向也要跟着挪，不然放大之后只看得见左半边。
  useEffect(() => {
    const host = hostRef.current;
    const root = host?.shadowRoot;
    const scaler = root?.querySelector('.stage-scale');
    if (!scaler) return;
    const w = host.clientWidth || STAGE_W;
    const stageH = scaler.offsetHeight || 620;
    // 基准是「整页都看得见」，宽高各算一个取小的。只按宽算的话，
    // 没聚焦时只露出上半截，看不出整体是什么样
    const k0 = Math.min(w / STAGE_W, BOX_H / stageH);
    const base = (w / k0 - STAGE_W) / 2;
    scaler.style.transform = `scale(${k0}) translateX(${base}px)`;
    const target = focus ? root.querySelector(focus) : null;
    if (!target) return;

    const h = target.offsetHeight || 1;
    const want = (BOX_H * 0.55) / (h * k0);
    const k = k0 * Math.max(1, Math.min(ZOOM, want));

    const cx = target.offsetLeft + target.offsetWidth / 2;
    const cy = target.offsetTop + target.offsetHeight / 2;
    const viewW = w / k;
    const viewH = BOX_H / k;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const tx = clamp(viewW / 2 - cx, Math.min(0, viewW - STAGE_W), Math.max(0, viewW - STAGE_W));
    const ty = clamp(viewH / 2 - cy, Math.min(0, viewH - stageH), 0);
    scaler.style.transform = `scale(${k}) translate(${tx}px, ${ty}px)`;
  }, [focus, ready, row?.updatedAt]);

  return html`<div class="gen-stage" ref=${hostRef}></div>`;
}

export function GenPage({ id }) {
  useStore(db.skins.store);
  const [open, setOpen] = useState('');
  const [showCss, setShowCss] = useState(false);
  const row = skin.get(id);
  if (!row) {
    return html`<${Page} title="生成" onBack=${nav.pop}>
      <${EmptyState} title="这一份已经不在了"/><//>`;
  }

  const cur = row.gen || {};
  const set = (groupId, itemId, v) => skin.update(id, {
    gen: { ...cur, [groupId]: { ...gen.groupValues(cur, groupId), [itemId]: v } },
  });

  const made = gen.emit(cur);
  const { n: pics, bytes } = gen.weigh(cur);
  const clashes = gen.conflictsOf(cur);
  const focus = open ? (gen.GROUPS.find(g => g.id === open)?.focus || '') : '';

  const clear = async () => {
    if (!await confirm({
      title: '清空生成的样式', okText: '清空', danger: true,
      message: '所有旋钮恢复默认，自动生成的那一段随之消失。手写的自定义 CSS 不受影响。',
    })) return;
    skin.update(id, { gen: {} });
    toast('已清空', 'ok');
  };

  const copy = () => {
    navigator.clipboard?.writeText(made);
    toast('已复制生成的 CSS', 'ok');
  };

  return html`
    <${Page} title=${row.name} onBack=${nav.pop} noScroll
      headerExtra=${html`
        <div class="gen-stage-wrap">
          <${Stage} row=${row} focus=${focus}/>
        </div>`}>
      <div class="scroll gen-scroll">
        <div class="settings-foot">
          改动即时反映在上方。展开一组会放大对应的那一块。
          生成的样式带 !important，手写的自定义 CSS 若要覆盖它，同样需要写。
        </div>

        ${clashes.length ? html`
          <div class="pad-x">
            <div class="warn-box">
              ${clashes.map(c => html`
                <div key=${c.at}>${c.who.join('、')}都挂在同一个位置，只有一个会生效。
                  请把其中一项换到另一个位置或另一个元素。</div>`)}
            </div>
          </div>` : null}

        ${gen.GROUPS.map(g => {
    const values = gen.groupValues(cur, g.id);
    const on = open === g.id;
    const changed = gen.changedIn(cur, g.id);
    return html`
          <${List} key=${g.id}>
            <${ListItem} title=${g.label} multiline
              subtitle=${changed ? `已修改 ${changed} 项` : '保持默认'}
              left=${html`<${Icon} name=${g.icon} size=${18}/>`}
              right=${html`<${Icon} name=${on ? 'chevronUp' : 'chevronDown'} size=${16}/>`}
              onClick=${() => setOpen(on ? '' : g.id)}/>
          <//>
          ${on ? g.items.filter(it => gen.showItem(it, values)).map(it => html`
            <${Control} key=${it.id} item=${it} value=${values[it.id]}
              onChange=${v => set(g.id, it.id, v)}/>`) : null}`;
  })}

        <${List} title="总样式">
          <${ListItem} multiline
            title=${made ? `共 ${made.split('\n').length} 行` : '还没有生成任何样式'}
            subtitle=${pics
    ? `其中内嵌 ${pics} 张图片，约 ${Math.round(bytes / 1024)} KB，导出时一并带走`
    : '调整上面的旋钮即可生成'}
            right=${html`<${Icon} name=${showCss ? 'chevronUp' : 'chevronDown'} size=${16}/>`}
            onClick=${() => setShowCss(v => !v)}/>
          ${made ? html`
            <${ListItem} title="复制这段 CSS" multiline
              subtitle="可以直接交给别人。对方不装本应用也用得上，类名是公开的"
              left=${html`<${Icon} name="copy" size=${18}/>`}
              onClick=${copy}/>` : null}
          ${gen.touched(cur) ? html`
            <${ListItem} title="清空生成的样式" danger multiline
              subtitle="旋钮全部恢复默认。手写的自定义 CSS 不受影响"
              onClick=${clear}/>` : null}
        <//>

        ${showCss && made ? html`<div class="gen-out">${made}</div>` : null}
        <div class="pad-b"></div>
      </div>
    <//>`;
}

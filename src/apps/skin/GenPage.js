import { html, useState, useRef, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState, toast, confirm } from '../../ui/index.js';
import { Control } from './Controls.js';

const { db, nav, skin } = phone;
const gen = skin.gen;

// 生成器。见 ARCHITECTURE 4.138、4.140
//
// **不挂在任何一段会话上。** 预览是一份手写的复刻页（system/skin-stage.js），
// 把要调的状态一次摆全：同一个人连发三条、一轮拆成两个气泡、引用、表情、
// 时刻与已读。真会话页上凑齐这一屏得先造一段假数据进库。
//
// ---- 为什么是左边一条竖栏 ----
//
// 从前是「预览钉在上面，十一组折叠条一路往下排」。要改哪一组得先滚下去
// 找到它，改完想看效果又要滚回来。现在左边一条竖栏常驻，十一组各一格，
// **任何一组都是一下点到**；右边上半是预览、下半是那一组的旋钮。
// 再点一下当前那一格就把旋钮收起来，预览占满整块。
//
// ---- 从前滚不动是怎么来的 ----
//
// `.page-body` 是 flex 子项（`flex:1; min-height:0`）但**它自己不是 flex 容器**。
// 里面那个 `.scroll` 写了 `flex:1` 等于没写，高度撑成内容那么高，
// 于是它自己不出现滚动条，而外面又没开 overflow —— 下半截够不着。
// 所以这一页从上到下每一层都把高度钉死，见 styles/app.css 里 `.gen` 那一组。

const STAGE_W = 430;
const MAX_ZOOM = 2.4;

/**
 * 预览。
 *
 * 画在 shadow root 里：这份美化的 CSS 直接塞进页面会把整个 app 一起改了。
 * 令牌那一段挂在 `:host` 上 —— shadow 里没有 `:root`。
 */
function Stage({ row, focus, open }) {
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

  // 摆位。
  //
  // 没聚焦时整页看得见：宽高各算一个倍率取小的，再横向居中。
  // 聚焦时**按目标的高度算倍率** —— 顶栏只有几十像素，要放大不少才看得清；
  // 消息区本来几百像素高，再放大只会看不到全貌。横向也跟着挪，
  // 不然放大之后只看得见左半边。
  //
  // 收起旋钮时这一块会变高，所以 `open` 也在依赖里。少了它，收起之后
  // 还按原来那个高度算，上下空一大片。
  useEffect(() => {
    const host = hostRef.current;
    const root = host?.shadowRoot;
    const scaler = root?.querySelector('.stage-scale');
    if (!scaler) return;
    const w = host.clientWidth || STAGE_W;
    const boxH = host.clientHeight || 330;
    const stageH = scaler.offsetHeight || 620;
    const k0 = Math.min(w / STAGE_W, boxH / stageH);
    const base = (w / k0 - STAGE_W) / 2;
    scaler.style.transform = `scale(${k0}) translateX(${base}px)`;
    const target = focus ? root.querySelector(focus) : null;
    if (!target) return;

    const h = target.offsetHeight || 1;
    const want = (boxH * 0.55) / (h * k0);
    const k = k0 * Math.max(1, Math.min(MAX_ZOOM, want));

    const cx = target.offsetLeft + target.offsetWidth / 2;
    const cy = target.offsetTop + target.offsetHeight / 2;
    const viewW = w / k;
    const viewH = boxH / k;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const tx = clamp(viewW / 2 - cx, Math.min(0, viewW - STAGE_W), Math.max(0, viewW - STAGE_W));
    const ty = clamp(viewH / 2 - cy, Math.min(0, viewH - stageH), 0);
    scaler.style.transform = `scale(${k}) translate(${tx}px, ${ty}px)`;
  }, [focus, open, ready, row?.updatedAt]);

  return html`<div class="gen-stage" ref=${hostRef}></div>`;
}

export function GenPage({ id }) {
  useStore(db.skins.store);
  const [open, setOpen] = useState('');
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
  const group = gen.GROUPS.find(g => g.id === open) || null;
  const values = group ? gen.groupValues(cur, group.id) : {};

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

  // 再点一下当前那一格就收起来。收起之后预览占满整块
  const tap = key => setOpen(open === key ? '' : key);

  const railBtn = (key, icon, label, dot) => html`
    <button key=${key} type="button"
      class=${`gen-rail-btn press${open === key ? ' is-on' : ''}`}
      onClick=${() => tap(key)}>
      <${Icon} name=${icon} size=${19}/>
      <span class="gen-rail-label">${label}</span>
      ${dot ? html`<span class="gen-rail-dot"></span>` : null}
    </button>`;

  return html`
    <${Page} title=${row.name} onBack=${nav.pop} noScroll>
      <div class="gen">
        <div class="gen-rail scroll">
          ${gen.GROUPS.map(g => railBtn(g.id, g.icon, g.short || g.label,
    gen.changedIn(cur, g.id) > 0))}
          <div class="gen-rail-sep"></div>
          ${railBtn('css', 'copy', '总样式', false)}
        </div>

        <div class="gen-main">
          <div class=${`gen-stage-wrap${open ? '' : ' is-full'}`}>
            <${Stage} row=${row} focus=${group?.focus || ''} open=${open}/>
          </div>

          ${open ? html`
            <div class="gen-panel scroll">
              <div class="gen-panel-head">
                <span class="gen-panel-title">${group ? group.label : '总样式'}</span>
                <button type="button" class="gen-panel-close press"
                  onClick=${() => setOpen('')}>收起</button>
              </div>

              ${clashes.length ? html`
                <div class="pad-x">
                  <div class="warn-box">
                    ${clashes.map(c => html`
                      <div key=${c.at}>${c.who.join('、')}都挂在同一个位置，只有一个会生效。
                        请把其中一项换到另一个位置或另一个元素。</div>`)}
                  </div>
                </div>` : null}

              ${group ? group.items.filter(it => gen.showItem(it, values)).map(it => html`
                <${Control} key=${it.id} item=${it} value=${values[it.id]}
                  onChange=${v => set(group.id, it.id, v)}/>`) : null}

              ${open === 'css' ? html`
                <${List}>
                  <${ListItem} multiline
                    title=${made ? `共 ${made.split('\n').length} 行` : '还没有生成任何样式'}
                    subtitle=${pics
    ? `其中内嵌 ${pics} 张图片，约 ${Math.round(bytes / 1024)} KB，导出时一并带走`
    : '左边每一组都调得出样式'}/>
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
                ${made ? html`<div class="gen-out">${made}</div>` : null}` : null}

              <div class="settings-foot">
                改动即时反映在上方。生成的样式带 !important，
                手写的自定义 CSS 若要覆盖它，同样需要写。
              </div>
            </div>` : null}
        </div>
      </div>
    <//>`;
}

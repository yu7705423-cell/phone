import { html, useState, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, Segmented, Icon, IconButton, EmptyState, List, ListItem, Switch, toast, prompt } from '../../ui/index.js';
import { OwnerBar, Thumb, ownerNow, sideNow, ownerName } from './parts.js';
import { AddSheet, TodaySheet } from './AddSheet.js';
import { GroupPage } from './GroupPage.js';
import { ItemPage } from './ItemPage.js';
import { SettingsPage } from './SettingsPage.js';
import { OutfitsPage, OutfitPage, FromCard, GeneratePage } from './OutfitPages.js';
import { RememberPage } from './ItemExtras.js';

const { db, nav, closet } = phone;
const K = closet.kinds;

// 衣帽间。见 ARCHITECTURE 4.213
//
// 层次：总览（大类卡片）、大类（小类、筛选）、单品三层。东西再多，第一屏也只有十来张卡片，
// 不会一上来把几百件铺满。找「那件白色的」走「全部」加筛选，比一层层往下点快。

function GroupCard({ group, rows }) {
  const shown = rows.slice(0, 4);
  return html`
    <button class=${`cl-group press${rows.length ? '' : ' is-empty'}`}
      onClick=${() => nav.push(`/g/${group.id}`)}>
      <div class=${`cl-mosaic n${shown.length}`}>
        ${shown.map(r => html`<${Thumb} key=${r.id} item=${r}/>`)}
        ${shown.length ? null : html`<span class="cl-mosaic-empty"><${Icon} name=${group.side === 'beauty' ? 'sparkle' : 'hanger'} size=${20}/></span>`}
      </div>
      <div class="cl-group-foot"><b>${group.label}</b><span>${rows.length}</span></div>
    </button>`;
}

function Home() {
  useStore(db.closet.store);
  useStore(db.settings.store);
  useStore(db.characters.store);
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);
  const [dailyBusy, setDailyBusy] = useState(false);
  const [packing, setPacking] = useState(false);
  const owner = ownerNow();
  const side = sideNow();
  const all = closet.itemsOf(owner).filter(r => r.side === side);
  const live = all.filter(closet.live);
  const unsorted = live.filter(r => !r.group);
  const worn = side === 'wear' ? closet.wornToday(owner) : [];
  const today = worn.filter(r => !closet.isCarry(r));
  const bag = worn.filter(closet.isCarry);
  const showBag = side === 'wear' && !closet.hiddenGroups().has(closet.CARRY);
  const borrowed = side === 'wear' ? closet.borrowedBy(owner) : [];
  const alerts = side === 'beauty' ? closet.alertsOf(owner) : [];
  const who = ownerName(owner);

  const outfits = side === 'wear' ? closet.outfitsOf(owner) : [];
  const saveToday = async () => {
    const name = await prompt({ title: '存为套装', placeholder: '例如 周末出门' });
    if (name == null) return;
    const o = closet.outfitFromToday(owner, name);
    if (o) toast(`已存为套装「${o.name}」`, 'ok');
  };

  const alertText = f => [
    f.low ? `约剩 ${f.low.pct}%，约 ${f.low.daysLeft} 天用完` : '',
    f.exp ? (f.exp.daysLeft < 0 ? '已过期' : `${f.exp.daysLeft} 天后过期`) : '',
  ].filter(Boolean).join('，');

  return html`
    <${Page} title="衣帽间"
      right=${html`
        <${IconButton} name="plus" label="添加" onClick=${() => setAdding(true)}/>
        <${IconButton} name="settings" label="设置" onClick=${() => nav.push('/settings')}/>`}>
      <${OwnerBar}/>
      <div class="pad-x">
        <${Segmented} value=${side} onChange=${v => db.settings.set({ closetSide: v })}
          items=${K.SIDES.map(s => ({ value: s.id, label: s.label }))}/>
      </div>

      ${side === 'wear' ? html`
        <div class="cl-strip">
          <div class="cl-strip-head">
            <b>${owner === closet.ME ? '今天穿的' : `${who}今天穿的`}</b>
            <span class="cl-strip-acts">
              ${today.length ? html`<button class="nav-text press" onClick=${saveToday}>存为套装</button>` : null}
              <button class="nav-text press" onClick=${() => setPicking(true)}>选择</button>
            </span>
          </div>
          ${today.length ? html`
            <div class="cl-strip-row">
              ${today.map(r => html`
                <button key=${r.id} class="cl-strip-item press" onClick=${() => nav.push(`/item/${r.id}`)}>
                  <${Thumb} item=${r}/><span class="ellipsis">${r.name}</span>
                </button>`)}
            </div>`
          : html`<div class="cl-strip-empty">尚未选择。点「选择」从衣橱里勾选今天穿着的几件。</div>`}
        </div>` : null}

      ${showBag ? html`
        <div class="cl-strip">
          <div class="cl-strip-head">
            <b>${owner === closet.ME ? '今天带着' : `${who}今天带着`}</b>
            <button class="nav-text press" onClick=${() => setPacking(true)}>选择</button>
          </div>
          ${bag.length ? html`
            <div class="cl-strip-row">
              ${bag.map(r => html`
                <button key=${r.id} class="cl-strip-item press" onClick=${() => nav.push(`/item/${r.id}`)}>
                  <${Thumb} item=${r}/><span class="ellipsis">${r.name}</span>
                </button>`)}
            </div>`
          : html`<div class="cl-strip-empty">包里带着的伞、耳机、相机这类小物，放在「随身」里，在这里勾选。</div>`}
        </div>` : null}

      ${side === 'wear' && owner !== closet.ME ? (() => {
        // 每日穿搭：开关挂在这个角色的衣帽间上（第 5 条），每天一次模型调用，默认关（第 15 条）
        const char = db.characters.get(owner);
        const on = char?.closetDaily === true;
        const failed = on && char?.closetDailyError && char?.closetDailyAt === closet.today();
        const now = async () => {
          setDailyBusy(true);
          try { toast(`已选好今天的 ${await closet.ai.pickToday(owner)} 件`, 'ok'); }
          catch (err) { toast(String(err.message || err), 'error', 5000); }
          finally { setDailyBusy(false); }
        };
        return html`
          <${List}>
            <${ListItem} title="每日自动穿搭" multiline
              subtitle=${on ? '每天从该角色衣帽间已有的衣物与随身物品里选一次今天穿什么、带什么，调用一次接口。当天已经选过的不再生成。关闭后不再自动选择'
                : '关闭。开启后每天调用一次接口，从该角色衣帽间已有的东西里选出今天穿什么、带什么；所用接口可在「设置 - 任务用哪套接口」中选择'}
              right=${html`<${Switch} checked=${on}
                onChange=${v => db.characters.update(owner, { closetDaily: v, closetDailyAt: '', closetDailyError: '' })}/>`}/>
            <${ListItem} title=${dailyBusy ? '正在选择' : '现在选一次'} multiline
              subtitle="按该角色的设定从衣帽间里选出今天穿什么、带什么，调用一次接口。今天已选的几件保留，另外勾上选出的"
              onClick=${dailyBusy ? null : now}/>
          <//>
          ${failed ? html`<div class="settings-foot is-error">今天的自动选择失败：${char.closetDailyError}</div>` : null}`;
      })() : null}

      ${borrowed.length ? html`
        <div class="cl-strip">
          <div class="cl-strip-head"><b>借来的</b></div>
          <div class="cl-strip-row">
            ${borrowed.map(r => html`
              <button key=${r.id} class="cl-strip-item press" onClick=${() => nav.push(`/item/${r.id}`)}>
                <${Thumb} item=${r}/><span class="ellipsis">${ownerName(r.owner)}的${r.name}</span>
              </button>`)}
          </div>
        </div>` : null}

      ${alerts.length ? html`
        <div class="cl-strip is-warn">
          <div class="cl-strip-head"><b>快用完或快过期</b></div>
          ${alerts.map(({ item, f }) => html`
            <button key=${item.id} class="cl-alert press" onClick=${() => nav.push(`/item/${item.id}`)}>
              <span class="ellipsis">${item.name}</span><em>${alertText(f)}</em>
            </button>`)}
        </div>` : null}

      ${side === 'wear' ? html`
        <button class="cl-unsorted press" onClick=${() => nav.push('/outfits')}>
          <${Icon} name="layers" size=${18}/>
          <span>${outfits.length ? `套装 ${outfits.length} 套` : '套装'}</span>
          <em>${outfits.length ? '查看套装，或选择今天穿哪一套' : '把几件单品存成一套'}</em>
        </button>` : null}

      ${owner !== closet.ME ? html`
        <button class="cl-unsorted press" onClick=${() => nav.push('/generate')}>
          <${Icon} name="sparkle" size=${18}/>
          <span>按角色设定生成</span>
          <em>调用 1 次接口，只生成文字</em>
        </button>` : null}

      ${unsorted.length ? html`
        <button class="cl-unsorted press" onClick=${() => nav.push('/unsorted')}>
          <${Icon} name="layers" size=${18}/>
          <span>未整理 ${unsorted.length} 件</span>
          <em>识图或手动选择分类</em>
        </button>` : null}

      <div class="cl-groups">
        ${closet.groupsOf(side).map(g => html`
          <${GroupCard} key=${g.id} group=${g} rows=${live.filter(r => r.group === g.id)}/>`)}
      </div>

      ${all.length ? html`
        <button class="cl-all press" onClick=${() => nav.push('/all')}>
          <span>全部 ${live.length} 件</span><${Icon} name="chevronRight" size=${16}/>
        </button>`
      : html`<${EmptyState} icon="hanger" title=${`${K.sideOf(side).label}还是空的`}
          desc=${side === 'beauty'
            ? '可拍照或手动添加护肤品、彩妆、香水与工具。填写容量与用量后，自动估算余量与保质期。'
            : '可拍照或手动添加衣物、鞋包与首饰。识图可自动填写分类、颜色与季节。'}/>`}

      <${AddSheet} open=${adding} owner=${owner} side=${side} onClose=${() => setAdding(false)}/>
      <${TodaySheet} open=${picking} owner=${owner} onClose=${() => setPicking(false)}/>
      <${TodaySheet} open=${packing} owner=${owner} carry=${true} onClose=${() => setPacking(false)}/>
    <//>`;
}

/**
 * 从礼物进来（会话里「收进衣帽间」）：收过就打开那一件，没收过就建一件再打开。
 * 分类在单品页里选
 */
function FromGift({ msgId }) {
  useEffect(() => {
    const had = closet.giftItem(msgId);
    if (had) { nav.replace(`/item/${had.id}`); return; }
    const fields = closet.fromGift(db.messages.get(msgId));
    if (!fields) { nav.replace('/'); return; }
    const row = closet.create(fields);
    db.settings.set({ closetOwner: row.owner });
    nav.replace(`/item/${row.id}`);
  }, [msgId]);
  return html`<${Page} title="衣帽间" onBack=${nav.pop}><div class="settings-foot">正在收进衣帽间。</div><//>`;
}

export default function ClosetApp({ route }) {
  if (route === '/settings') return html`<${SettingsPage}/>`;
  if (route === '/all') return html`<${GroupPage} mode="all"/>`;
  if (route === '/unsorted') return html`<${GroupPage} mode="unsorted"/>`;
  const g = route?.match(/^\/g\/(.+)$/);
  if (g) return html`<${GroupPage} groupId=${g[1]}/>`;
  const it = route?.match(/^\/item\/(.+)$/);
  if (it) return html`<${ItemPage} id=${it[1]}/>`;
  if (route === '/outfits') return html`<${OutfitsPage}/>`;
  if (route === '/generate') return html`<${GeneratePage}/>`;
  const of = route?.match(/^\/outfit\/(.+)$/);
  if (of) return html`<${OutfitPage} id=${of[1]}/>`;
  const rem = route?.match(/^\/remember\/(.+)$/);
  if (rem) return html`<${RememberPage} msgId=${rem[1]}/>`;
  const card = route?.match(/^\/fit\/(.+)$/);
  if (card) return html`<${FromCard} msgId=${card[1]}/>`;
  const gift = route?.match(/^\/gift\/(.+)$/);
  if (gift) return html`<${FromGift} msgId=${gift[1]}/>`;
  return html`<${Home}/>`;
}

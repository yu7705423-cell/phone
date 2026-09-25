import { html, useState, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, Segmented, Icon, IconButton, EmptyState } from '../../ui/index.js';
import { OwnerBar, Thumb, ownerNow, sideNow, ownerName } from './parts.js';
import { AddSheet, TodaySheet } from './AddSheet.js';
import { GroupPage } from './GroupPage.js';
import { ItemPage } from './ItemPage.js';
import { SettingsPage } from './SettingsPage.js';

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
  const owner = ownerNow();
  const side = sideNow();
  const all = closet.itemsOf(owner).filter(r => r.side === side);
  const live = all.filter(closet.live);
  const unsorted = live.filter(r => !r.group);
  const today = side === 'wear' ? closet.wornToday(owner) : [];
  const alerts = side === 'beauty' ? closet.alertsOf(owner) : [];
  const who = ownerName(owner);

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
            <button class="nav-text press" onClick=${() => setPicking(true)}>选择</button>
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

      ${alerts.length ? html`
        <div class="cl-strip is-warn">
          <div class="cl-strip-head"><b>快用完或快过期</b></div>
          ${alerts.map(({ item, f }) => html`
            <button key=${item.id} class="cl-alert press" onClick=${() => nav.push(`/item/${item.id}`)}>
              <span class="ellipsis">${item.name}</span><em>${alertText(f)}</em>
            </button>`)}
        </div>` : null}

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
  const gift = route?.match(/^\/gift\/(.+)$/);
  if (gift) return html`<${FromGift} msgId=${gift[1]}/>`;
  return html`<${Home}/>`;
}

import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { List, ListItem, Segmented, Spinner, Avatar } from '../../ui/index.js';
import { Cover, TrackRow, NeedLogin, useRemote, Failed } from './parts.js';

const { db, nav, netease, player } = phone;
const svc = phone.ai.services;

// 个人主页。
//
// 这一页上的数字**全部来自网易云那边**：听歌总数是账号上的 listenSongs，
// 排行是 /user/record 的 playCount。不自己累加 —— 自己算出来的数和客户端里
// 显示的对不上，而对得上正是这一页的意义。
//
// 只有「累计时长」是本地乘出来的：接口不给这个数，它等于排行里每一首的
// 时长乘播放次数再相加。所以页面上写明它是按排行估算的，不含排行以外的曲目。

const TABS = [{ value: 'week', label: '最近一周' }, { value: 'all', label: '所有时间' }];

export function MineTab() {
  useStore(db.settings.store);
  const cfg = svc.neteaseConfig();
  const logged = !!cfg.cookie;
  const [scope, setScope] = useState('week');

  const me = useRemote(() => (logged ? netease.profile('') : Promise.resolve(null)), [logged]);
  const rank = useRemote(
    () => (logged ? netease.record('', { week: scope === 'week' }) : Promise.resolve([])),
    [logged, scope]);
  const lists = useRemote(() => (logged ? netease.playlistsOf('') : Promise.resolve([])), [logged]);

  const gate = NeedLogin({ ready: svc.neteaseReady(), logged });
  if (gate) return gate;
  if (me.loading) return html`<div class="mu-wait"><${Spinner}/></div>`;
  if (me.err) return html`<${Failed} err=${me.err} onRetry=${me.reload}/>`;

  const p = me.data || {};
  const rows = rank.data || [];
  const top = rows[0]?.count || 1;
  const totalSec = rows.reduce((n, r) => n + r.seconds * r.count, 0);
  const mine = (lists.data || []).filter(x => x.mine);
  const faved = (lists.data || []).filter(x => !x.mine);

  return html`
    <div class="mu-page">
      <div class="mu-me">
        <div class="mu-me-face"><${Avatar} src=${p.avatar} name=${p.nickname} size=${72}/></div>
        <div class="mu-me-name">${p.nickname || '未命名'}</div>
        ${p.signature ? html`<div class="mu-me-sign ellipsis">${p.signature}</div>` : null}
        <div class="mu-me-meta">Lv.${p.level} · UID ${p.uid}</div>
      </div>

      <div class="mu-stats">
        <div class="mu-stat"><b>${p.listenSongs}</b><span>累计听歌</span></div>
        <div class="mu-stat"><b>${p.createDays}</b><span>入驻天数</span></div>
        <div class="mu-stat"><b>${p.follows}</b><span>关注</span></div>
        <div class="mu-stat"><b>${p.followeds}</b><span>粉丝</span></div>
      </div>

      <div class="mu-sec"><span>听歌排行</span></div>
      <div class="pad-x">
        <${Segmented} items=${TABS} value=${scope} onChange=${setScope}/>
      </div>

      <div class="mu-total">
        ${scope === 'week' ? '最近一周' : '所有时间'}累计时长约 ${player.hoursText(totalSec)}
        <div class="mu-total-note">按排行中各曲目的时长与播放次数估算，不含排行以外的曲目。</div>
      </div>

      ${rank.loading ? html`<div class="mu-wait"><${Spinner}/></div>` : null}
      ${rank.err ? html`<${Failed} err=${rank.err} onRetry=${rank.reload}/>` : null}

      <div class="mu-list">
        ${rows.slice(0, 50).map((t, i) => html`
          <${TrackRow} key=${t.id} track=${t} index=${i + 1}
            onPlay=${() => player.play(rows, i)}
            right=${html`
              <div class="mu-count">
                <span>${t.count}</span>
                <i style=${`width:${Math.max(4, (t.count / top) * 44)}px`}></i>
              </div>`}/>`)}
      </div>
      ${!rank.loading && !rank.err && !rows.length
        ? html`<div class="settings-foot">该账号在此区间内没有听歌记录。</div>` : null}

      <${List} title=${`创建的歌单 · ${mine.length}`}>
        ${mine.map(x => html`
          <${ListItem} key=${x.id} title=${x.name} subtitle=${`${x.count} 首`} multiline arrow
            left=${html`<${Cover} src=${x.cover} name=${x.name} size=${40}/>`}
            onClick=${() => nav.push(`/list/${x.id}`)}/>`)}
      <//>
      ${faved.length ? html`
        <${List} title=${`收藏的歌单 · ${faved.length}`}>
          ${faved.map(x => html`
            <${ListItem} key=${x.id} title=${x.name} subtitle=${`${x.count} 首`} multiline arrow
              left=${html`<${Cover} src=${x.cover} name=${x.name} size=${40}/>`}
              onClick=${() => nav.push(`/list/${x.id}`)}/>`)}
        <//>` : null}

      <div class="settings-foot">
        以上数据读取自网易云账号，本页不作改写。<br/>
        在本应用中播放的曲目会记入该账号的听歌记录，与在客户端中播放一致。
      </div>
    </div>`;
}

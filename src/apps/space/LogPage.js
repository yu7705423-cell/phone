import { html } from '../../lib.js';
import { phone, useStore, useImage } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState } from '../../ui/index.js';

import { ymdhm as when, hhmm } from './fmt.js';

const { db, nav, space, gift, call, music } = phone;

const META = {
  gift: { title: '礼物墙', icon: 'gift', empty: '还没有送出或收到礼物',
    desc: '对话中送出与收到的礼物都会记在这里。' },
  location: { title: '一起去过的地方', icon: 'map', empty: '还没有位置记录',
    desc: '对话中发送的位置都会记在这里。' },
  listen: { title: '一起听', icon: 'music', empty: '还没有一起听的记录',
    desc: '每结束一场一起听，会记录时长与曲目。' },
  call: { title: '通话记录', icon: 'phone', empty: '还没有通话记录',
    desc: '每通电话结束后会记录方向、结果与时长。' },
};


// 一条记录怎么念。四种记录各有各的字段，标题和副标题在这儿分流，
// 不去动消息本身的正文 —— 正文是给模型读的，这里是给人看的。
function describe(m, kind, names) {
  const from = m.role === 'user' ? names.me : names.char;
  if (kind === 'gift') {
    const state = gift.stateLabel(m.gift);
    const inner = m.gift === gift.OPENED && m.inner && m.inner !== m.cover ? `，拆开是 ${m.inner}` : '';
    return { title: m.cover || '礼物', sub: `${from}送出 · ${state}${inner}` };
  }
  if (kind === 'location') {
    return { title: m.place || '位置', sub: [from, m.address].filter(Boolean).join(' · ') };
  }
  if (kind === 'listen') {
    const tracks = (m.trackIds || []).map(id => db.songs.get(id)).filter(Boolean);
    const titles = tracks.map(x => music.label(x)).filter(Boolean);
    return {
      title: `一起听了 ${hhmm(m.seconds)}`,
      sub: titles.length ? `${(m.trackIds || []).length} 首 · ${titles.join('、')}`
        : `${(m.trackIds || []).length} 首`,
    };
  }
  const dir = m.direction === 'out' ? '拨出' : '来电';
  const kindText = m.callKind === 'video' ? '视频通话' : '语音通话';
  const tail = m.outcome === 'done' ? call.duration(m.seconds) : (m.outcome === 'missed' ? '未接通' : '已取消');
  return { title: `${kindText} · ${dir}`, sub: tail };
}

function GiftThumb({ msg }) {
  const url = useImage(msg.imageId);
  return url
    ? html`<img class="sp-thumb" src=${url} alt=""/>`
    : html`<${Icon} name="gift" size=${19}/>`;
}

export function LogPage({ chatId, kind }) {
  useStore(db.messages.store);
  useStore(db.songs.store);

  const meta = META[kind];
  const sp = space.spaceOf(chatId);
  const names = { me: sp?.persona?.name || '我', char: phone.remark.nameOf(sp?.char) || '角色' };
  const list = meta ? space.recordsOf(chatId, kind).slice().reverse() : [];

  if (!meta) {
    return html`
      <${Page} title="记录" onBack=${nav.pop}>
        <${EmptyState} icon="layers" title="没有这一类记录"/>
      <//>`;
  }

  return html`
    <${Page} title=${meta.title} onBack=${nav.pop}>
      ${list.length ? html`
        <${List}>
          ${list.map(m => {
            const d = describe(m, kind, names);
            return html`
              <${ListItem} key=${m.id} title=${d.title} subtitle=${`${d.sub} · ${when(m.createdAt)}`}
                multiline
                left=${kind === 'gift' ? html`<${GiftThumb} msg=${m}/>`
                  : html`<${Icon} name=${meta.icon} size=${19}/>`}
                onClick=${() => phone.intent.open('chat', { route: `/chat/${chatId}@${m.id}` })}/>`;
          })}
        <//>
        <div class="settings-foot">${meta.desc}点击任意一条可跳转到对话中的原始位置。</div>`
      : html`<${EmptyState} icon=${meta.icon} title=${meta.empty} desc=${meta.desc}/>`}
    <//>`;
}

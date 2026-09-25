import { html, useState, useEffect } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, Input, Spinner,
         Sheet, EmptyState, toast, confirm, prompt } from '../../../ui/index.js';

const { db, nav, music, listen, netease } = phone;
const svc = phone.ai.services;

/**
 * 搜网易云。回车才发请求，每敲一个字查一次是在替接口挨限流。
 * onPick 拿到的是网易云那边的一首（还没进曲库），由调用方决定放还是加进歌单
 */
function NeteaseSearch({ onPick, pickLabel = '', onSide = null }) {
  const [q, setQ] = useState('');
  const [st, setSt] = useState({ list: [], err: '', loading: false, done: false });
  if (!svc.neteaseReady()) return null;
  const go = async () => {
    const k = q.trim();
    if (!k) return;
    setSt({ list: [], err: '', loading: true, done: false });
    try { setSt({ list: await netease.search(k, 20), err: '', loading: false, done: true }); }
    catch (err) { setSt({ list: [], err: String(err.message || err), loading: false, done: true }); }
  };
  return html`
    <div class="pad-x ls-search">
      <${Input} value=${q} onInput=${setQ} placeholder="搜索网易云的歌曲、歌手，按回车搜索"
        onKeyDown=${e => { if (e.key === 'Enter') { e.target.blur(); go(); } }}/>
    </div>
    ${st.loading ? html`<div class="ls-wait"><${Spinner}/></div>` : null}
    ${st.err ? html`<div class="settings-foot">搜索失败：${st.err}</div>` : null}
    ${st.done && !st.err && !st.list.length ? html`<div class="settings-foot">没有匹配的歌曲。</div>` : null}
    ${st.list.length ? html`
      <${List} inset=${false}>
        ${st.list.map(t => html`
          <${ListItem} key=${t.id} title=${t.title} subtitle=${t.artist || '网易云'}
            right=${onSide ? html`<button class="nav-text press"
              onClick=${e => { e.stopPropagation(); onSide(t); }}>加入歌单</button>` : pickLabel ? html`<span class="ls-hint">${pickLabel}</span>` : null}
            onClick=${() => onPick(t)}/>`)}
      <//>` : null}`;
}

/** 自己的网易云歌单。登录了才有 */
function useNeteaseLists() {
  const logged = svc.neteaseLoggedIn();
  const [st, setSt] = useState({ list: [], err: '', loading: logged });
  useEffect(() => {
    if (!logged) return;
    let off = false;
    netease.playlistsOf('')
      .then(list => { if (!off) setSt({ list, err: '', loading: false }); })
      .catch(err => { if (!off) setSt({ list: [], err: String(err.message || err), loading: false }); });
    return () => { off = true; };
  }, [logged]);
  return { logged, ...st };
}

function SongRow({ song, right, onTap }) {
  return html`
    <${ListItem} title=${song.title}
      subtitle=${song.artist
    || (song.source === 'netease' ? '网易云' : song.url ? '外部地址' : '本地文件')}
      right=${right} onClick=${onTap}/>`;
}

export function ListenPage({ chatId }) {
  useStore(db.songs.store);
  useStore(db.playlists.store);
  useStore(db.chats.store);
  const s = useStore(listen.listen);
  const [picking, setPicking] = useState(null);   // 往哪个歌单里加歌
  const [adding, setAdding] = useState(null);     // 搜到的一首，要加进哪个歌单
  const ne = useNeteaseLists();

  const chat = db.chats.get(chatId);
  const char = db.characters.get((chat?.characterIds || [])[0]);
  const lib = music.allSongs();
  const mine = music.allLists(music.LIB_OWNER);
  const hers = char ? music.allLists(char.id) : [];
  const total = listen.totals(chatId);
  const live = listen.inChat(chatId);

  // 曲库归音乐 app 管：加歌、传音频、改歌词都在那边，这里只管挑来一起听。
  // 一个开关只能有一个入口，见 CLAUDE.md 第 5 条。
  const openLib = () => phone.intent.open('music', { route: '/library' });

  const startList = id => {
    try { listen.start({ chatId, listId: id }); nav.pop(); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };
  // 角色的歌单点进去先看里面有什么，一起听的按钮在那一页上
  const openList = id => phone.intent.open('music', { route: `/local/${id}/${chatId}`, back: true });
  // 正在和这一位一起听就只换这一首，不重新开一场
  const startSong = id => {
    try {
      if (live) { listen.play(id); toast('已切换', 'ok'); return; }
      listen.start({ chatId, songId: id }); nav.pop();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };
  // 网易云搜到的：先收进曲库（只存歌名与网易云 id），再放
  const playNetease = t => startSong(music.fromNetease(t).id);
  const openNeteaseList = async p => {
    toast(`正在打开「${p.name}」`);
    try { await listen.startNeteaseList({ chatId, id: p.id, name: p.name }); nav.pop(); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };
  const addTo = (listId, t) => {
    toast(music.addTrack(listId, music.fromNetease(t).id) ? '已加入' : '已在这个歌单里');
  };

  const newList = async () => {
    const name = await prompt({ title: '新建歌单', okText: '创建' });
    if (!name || !name.trim()) return;
    try { music.createList({ name }); } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const dropList = async p => {
    if (!await confirm({ title: '删除歌单', message: p.name, danger: true })) return;
    music.removeList(p.id);
  };

  return html`
    <${Page} title="一起听" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${openLib}>曲库</button>`}>

      ${live && listen.current() ? html`
        <${List} title="正在播放">
          <${ListItem} title=${listen.current().title} arrow
            subtitle=${[listen.current().artist, s.playing ? '播放中' : '已暂停'].filter(Boolean).join(' · ')}
            left=${html`<${Icon} name="music" size=${18}/>`}
            onClick=${() => phone.intent.open('music', { route: '/now/listen', back: true })}/>
        <//>` : null}

      ${svc.neteaseReady() ? html`
        <${List} title="搜索网易云"/>
        <${NeteaseSearch} onPick=${playNetease} onSide=${t => setAdding(t)}/>
        <div class="settings-foot">点击结果即一起听这一首；「加入歌单」可放进你或${phone.remark.nameOf(char) || '角色'}的歌单。</div>` : null}

      ${ne.logged ? html`
        <${List} title="我的网易云歌单">
          ${ne.loading ? html`<div class="ls-wait"><${Spinner}/></div>` : null}
          ${ne.err ? html`<div class="settings-foot">歌单取不到：${ne.err}</div>` : null}
          ${ne.list.map(p => html`
            <${ListItem} key=${p.id} title=${p.name} subtitle=${`${p.count} 首${p.mine ? '' : ' · 收藏'}`} arrow
              onClick=${() => openNeteaseList(p)}/>`)}
        <//>` : null}

      <${List} title="一起听了多久">
        <${ListItem} title="累积" multiline
          subtitle=${total.count
            ? `和${phone.remark.nameOf(char) || '对方'}一共听了 ${listen.fmt(total.seconds)}，${total.count} 首`
            : '还没有一起听过'}/>
        ${live ? html`
          <${ListItem} title="本次" multiline
            subtitle=${`${listen.fmt(s.seconds)}，${s.count} 首`}
            right=${html`<button class="nav-text press"
              onClick=${() => listen.stop()}>结束</button>`}/>` : null}
      <//>

      ${hers.length ? html`
        <${List} title=${`${phone.remark.nameOf(char) || '角色'}建的歌单`}>
          ${hers.map(p => html`
            <${ListItem} key=${p.id} title=${p.name}
              subtitle=${`${(p.trackIds || []).length} 首`}
              right=${html`<button class="nav-text press" onClick=${e => { e.stopPropagation(); setPicking(p.id); }}>加歌</button>`}
              onClick=${() => openList(p.id)}/>`)}
        <//>` : null}

      <${List} title="我的歌单">
        ${mine.map(p => html`
          <${ListItem} key=${p.id} title=${p.name}
            subtitle=${`${(p.trackIds || []).length} 首`}
            right=${html`<span class="row-acts">
              <button class="nav-text press" onClick=${e => { e.stopPropagation(); setPicking(p.id); }}>加歌</button>
              <button class="nav-text press" onClick=${e => { e.stopPropagation(); dropList(p); }}>删除</button>
            </span>`}
            onClick=${() => startList(p.id)}/>`)}
        <${ListItem} title="新建歌单" arrow
          left=${html`<${Icon} name="plus" size=${18}/>`} onClick=${newList}/>
      <//>

      ${lib.length ? html`
        <${List} title=${`曲库 · ${lib.length} 首`}>
          ${lib.map(song => html`
            <${SongRow} key=${song.id} song=${song} onTap=${() => startSong(song.id)}/>`)}
          <${ListItem} title="管理曲库" arrow multiline
            subtitle="在音乐中上传音频、填写播放地址、编辑歌词"
            left=${html`<${Icon} name="database" size=${18}/>`}
            onClick=${openLib}/>
        <//>`
      : svc.neteaseReady() ? null
      : html`<${EmptyState} icon="music" title="曲库是空的"
          desc="曲库在音乐中管理：可上传本机音频、填写播放地址，或收入网易云的曲目。"
          action=${html`<${Button} size="sm" icon="database" onClick=${openLib}>前往曲库<//>`}/>`}

      <div class="settings-foot">
        点击我的歌单或单曲即可开始一起听；角色的歌单点击后先查看曲目，「加歌」可替角色往里放歌。播放期间可在会话顶部控制。
      </div>

      <${Sheet} open=${!!picking} onClose=${() => setPicking(null)} title="选择要加入的歌曲" height="80%">
        <${NeteaseSearch} pickLabel="加入" onPick=${t => addTo(picking, t)}/>
        ${lib.length ? html`<div class="settings-foot">本机曲库</div>` : null}
        <${List} inset=${false}>
          ${lib.map(song => html`
            <${SongRow} key=${song.id} song=${song}
              onTap=${() => { music.addTrack(picking, song.id); toast('已加入'); }}/>`)}
        <//>
        ${lib.length || svc.neteaseReady() ? null : html`<div class="settings-foot">曲库是空的。</div>`}
      <//>

      <${Sheet} open=${!!adding} onClose=${() => setAdding(null)} title=${adding ? `把「${adding.title}」加入` : ''}>
        <${List} inset=${false}>
          ${[...mine, ...hers].map(p => html`
            <${ListItem} key=${p.id} title=${p.name}
              subtitle=${p.owner === music.LIB_OWNER ? '我的歌单' : `${phone.remark.nameOf(char) || '角色'}的歌单`}
              onClick=${() => { addTo(p.id, adding); setAdding(null); }}/>`)}
        <//>
        ${[...mine, ...hers].length ? null : html`<div class="settings-foot">还没有歌单，可在下方「我的歌单」中新建。</div>`}
      <//>
    <//>`;
}

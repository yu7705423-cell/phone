import { html, useState, useRef } from '../../../lib.js';
import { phone, useStore, useFile } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Button, Icon,
         Sheet, EmptyState, toast, confirm, prompt } from '../../../ui/index.js';

const { db, nav, music, listen } = phone;

// 加一首。歌必须真的有东西能响 —— 要么一个地址，要么一个文件。
// 光有歌名的「虚拟歌」不做：一起听要真的有东西在放，计时才有意义。
function AddSheet({ open, onClose }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [url, setUrl] = useState('');
  const [lyric, setLyric] = useState('');
  const [audioId, setAudioId] = useState(null);
  const [name, setName] = useState('');
  const fileRef = useRef(null);
  const lrcRef = useRef(null);

  const close = () => {
    setTitle(''); setArtist(''); setUrl(''); setLyric(''); setAudioId(null); setName('');
    onClose();
  };

  const pickAudio = async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const id = await db.files.put(f, { name: f.name, type: f.type || 'audio/mpeg' });
      setAudioId(id); setName(f.name); setUrl('');
      if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
    } catch (err) { toast('音频存不下：' + (err.message || err), 'error'); }
  };

  const pickLrc = async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setLyric(await f.text());
  };

  const submit = () => {
    try { music.addSong({ title, artist, url, audioId, lyric }); close(); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };

  return html`
    <${Sheet} open=${open} onClose=${close} title="添加歌曲" height="86%">
      <${Field} label="歌曲名称">
        <${Input} value=${title} placeholder="歌名" maxlength=${60} onInput=${setTitle}/>
      <//>
      <${Field} label="歌手" desc="可以不填。">
        <${Input} value=${artist} placeholder="歌手" maxlength=${40} onInput=${setArtist}/>
      <//>

      <${Field} label="播放地址"
        desc="直接指向音频文件的地址。地址与本地文件二选一，填了地址就不必上传文件。">
        <${Input} value=${url} placeholder="https://..."
          onInput=${v => { setUrl(v); if (v) { setAudioId(null); setName(''); } }}/>
      <//>

      <${Field} label="本地音频"
        desc=${audioId ? `已选择：${name}` : '上传后保存在本机，不会上传到任何服务器。'}>
        <div class="wg-edit-cover">
          <${Button} size="sm" variant="ghost" icon="upload"
            onClick=${() => fileRef.current?.click()}>${audioId ? '更换文件' : '选择文件'}<//>
          ${audioId ? html`
            <${Button} size="sm" variant="ghost" icon="trash"
              onClick=${() => { db.files.remove(audioId); setAudioId(null); setName(''); }}>移除<//>` : null}
        </div>
        <input type="file" accept="audio/*" ref=${fileRef} onChange=${pickAudio} style="display:none"/>
      <//>

      <${Field} label="歌词"
        desc="LRC 格式，带时间轴的会跟着播放逐句显示。可以不填。">
        <${Textarea} rows=${4} value=${lyric} placeholder="[00:12.00]第一句"
          onInput=${setLyric}/>
        <div class="pad-t">
          <${Button} size="sm" variant="ghost" icon="upload"
            onClick=${() => lrcRef.current?.click()}>导入 LRC 文件<//>
        </div>
        <input type="file" accept=".lrc,.txt,text/plain" ref=${lrcRef}
          onChange=${pickLrc} style="display:none"/>
      <//>

      <div class="pad-t">
        <${Button} full disabled=${!title.trim() || (!url.trim() && !audioId)}
          onClick=${submit}>添加<//>
      </div>
    <//>`;
}

function SongRow({ song, right, onTap }) {
  return html`
    <${ListItem} title=${song.title}
      subtitle=${song.artist || (song.url ? '外部地址' : '本地文件')}
      right=${right} onClick=${onTap}/>`;
}

export function ListenPage({ chatId }) {
  useStore(db.songs.store);
  useStore(db.playlists.store);
  useStore(db.chats.store);
  const s = useStore(listen.listen);
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(null);   // 往哪个歌单里加歌

  const chat = db.chats.get(chatId);
  const char = db.characters.get((chat?.characterIds || [])[0]);
  const lib = music.allSongs();
  const mine = music.allLists(music.LIB_OWNER);
  const hers = char ? music.allLists(char.id) : [];
  const total = listen.totals(chatId);
  const live = listen.inChat(chatId);

  const startList = id => {
    try { listen.start({ chatId, listId: id }); nav.pop(); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };
  const startSong = id => {
    try { listen.start({ chatId, songId: id }); nav.pop(); }
    catch (err) { toast(String(err.message || err), 'error'); }
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

  const dropSong = async song => {
    if (!await confirm({
      title: '从曲库移除', message: `${song.title}。歌单中的这首歌会一并移除。`, danger: true,
    })) return;
    music.removeSong(song.id);
  };

  return html`
    <${Page} title="一起听" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${() => setAdding(true)}>添加</button>`}>

      <${List} title="一起听了多久">
        <${ListItem} title="累积" multiline
          subtitle=${total.count
            ? `和${char?.name || '对方'}一共听了 ${listen.fmt(total.seconds)}，${total.count} 首`
            : '还没有一起听过'}/>
        ${live ? html`
          <${ListItem} title="本次" multiline
            subtitle=${`${listen.fmt(s.seconds)}，${s.count} 首`}
            right=${html`<button class="nav-text press"
              onClick=${() => listen.stop()}>结束</button>`}/>` : null}
      <//>

      ${hers.length ? html`
        <${List} title=${`${char?.name || '角色'}建的歌单`}>
          ${hers.map(p => html`
            <${ListItem} key=${p.id} title=${p.name}
              subtitle=${`${(p.trackIds || []).length} 首`} arrow
              onClick=${() => startList(p.id)}/>`)}
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
            <${SongRow} key=${song.id} song=${song}
              right=${html`<button class="nav-text press"
                onClick=${e => { e.stopPropagation(); dropSong(song); }}>移除</button>`}
              onTap=${() => startSong(song.id)}/>`)}
        <//>`
      : html`<${EmptyState} icon="music" title="曲库是空的"
          desc="添加歌曲后即可开始一起听。每首歌需要填写播放地址或上传音频文件。"/>`}

      <div class="settings-foot">
        点击歌单或单曲即可开始一起听。播放期间可在会话顶部控制。
      </div>

      <${AddSheet} open=${adding} onClose=${() => setAdding(false)}/>

      <${Sheet} open=${!!picking} onClose=${() => setPicking(null)} title="选择要加入的歌曲" height="70%">
        <${List} inset=${false}>
          ${lib.map(song => html`
            <${SongRow} key=${song.id} song=${song}
              onTap=${() => { music.addTrack(picking, song.id); toast('已加入'); }}/>`)}
        <//>
        ${lib.length ? null : html`<div class="settings-foot">曲库是空的。</div>`}
      <//>
    <//>`;
}

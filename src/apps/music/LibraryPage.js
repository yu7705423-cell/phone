import { html, useState, useRef, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, Field, Input, Textarea, Button,
         Sheet, EmptyState, toast, confirm } from '../../ui/index.js';
import { TrackRow, NowBar } from './parts.js';

const { db, nav, music, player } = phone;

// 本机曲库。
//
// 这里的歌分两种来源，能改的东西不一样：
//   **自己传的**   名称、歌手、播放地址或音频文件、歌词，都归自己管；
//   **网易云收的**  名称、歌手、地址都在那边，改了反而对不上，所以只让改歌词。
//
// 歌词按 LRC 原文存。一起听那边按时间轴对出当前这一句，对不上就当没有歌词。

const sourceText = s => (s.source === 'netease' ? '网易云' : s.url ? '外部地址' : '本机文件');

// 加一首与改一首共用这一张表。song 为空就是新加。
function EditSheet({ open, song, onClose }) {
  const isNew = !song;
  const fromNetease = !!song && song.source === 'netease';
  const fileRef = useRef(null);
  const lrcRef = useRef(null);

  const init = () => ({
    title: song?.title || '', artist: song?.artist || '',
    url: song?.url || '', audioId: song?.audioId || null,
    lyric: song?.lyric || '', name: '',
  });
  const [f, setForm] = useState(init);

  // 每次打开按当前这一首重新铺一份，改到一半关掉不留痕
  useEffect(() => { if (open) setForm(init()); }, [open, song?.id]);

  const set = patch => setForm({ ...f, ...patch });
  const close = () => onClose();

  const pickAudio = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const id = await db.files.put(file, { name: file.name, type: file.type || 'audio/mpeg' });
      set({
        audioId: id, name: file.name, url: '',
        title: f.title.trim() || file.name.replace(/\.[^.]+$/, ''),
      });
    } catch (err) { toast('音频存不下：' + (err.message || err), 'error'); }
  };

  const pickLrc = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    set({ lyric: await file.text() });
  };

  const submit = () => {
    try {
      if (isNew) music.addSong(f);
      else if (fromNetease) music.updateSong(song.id, { lyric: f.lyric });
      else music.updateSong(song.id, f);
      close();
      toast(isNew ? '已加入曲库' : '已保存', 'ok');
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const lines = music.parseLyric(f.lyric).length;

  return html`
    <${Sheet} open=${open} onClose=${close} title=${isNew ? '添加歌曲' : '编辑歌曲'} height="88%">
      ${fromNetease ? html`
        <div class="settings-foot">
          该曲目来自网易云，名称、歌手与播放地址以网易云为准，此处只能编辑歌词。
        </div>` : html`
        <div>
          <${Field} label="歌曲名称">
            <${Input} value=${f.title} placeholder="歌名" maxlength=${60}
              onInput=${v => set({ title: v })}/>
          <//>
          <${Field} label="歌手" desc="可以留空。">
            <${Input} value=${f.artist} placeholder="歌手" maxlength=${40}
              onInput=${v => set({ artist: v })}/>
          <//>
          <${Field} label="播放地址"
            desc="直接指向音频文件的地址。地址与本机文件二选一，填了地址则不需要上传文件。">
            <${Input} value=${f.url} placeholder="https://..."
              onInput=${v => set({ url: v, audioId: v ? null : f.audioId, name: v ? '' : f.name })}/>
          <//>
          <${Field} label="本机音频"
            desc=${f.name ? `已选择：${f.name}`
              : f.audioId ? '已有音频文件。重新选择将替换它。'
                : '文件保存在本机浏览器中，不会上传到任何服务器。'}>
            <div class="wg-edit-cover">
              <${Button} size="sm" variant="ghost" icon="upload"
                onClick=${() => fileRef.current?.click()}>${f.audioId ? '更换文件' : '选择文件'}<//>
              ${f.audioId ? html`
                <${Button} size="sm" variant="ghost" icon="trash"
                  onClick=${() => set({ audioId: null, name: '' })}>移除<//>` : null}
            </div>
            <input type="file" accept="audio/*" ref=${fileRef} onChange=${pickAudio} style="display:none"/>
          <//>
        </div>`}

      <${Field} label="歌词"
        desc=${`LRC 格式，带时间轴的会随播放逐句显示，不带时间轴的不显示。`
          + `${lines ? `当前已识别 ${lines} 句。` : '可以留空。'}`}>
        <${Textarea} rows=${8} value=${f.lyric} placeholder="[00:12.00]第一句"
          onInput=${v => set({ lyric: v })}/>
        <div class="pad-t">
          <${Button} size="sm" variant="ghost" icon="upload"
            onClick=${() => lrcRef.current?.click()}>导入 LRC 文件<//>
        </div>
        <input type="file" accept=".lrc,.txt,text/plain" ref=${lrcRef}
          onChange=${pickLrc} style="display:none"/>
      <//>

      <div class="pad-t">
        <${Button} full onClick=${submit}
          disabled=${!fromNetease && (!f.title.trim() || (!f.url.trim() && !f.audioId))}>
          ${isNew ? '添加' : '保存'}<//>
      </div>
    <//>`;
}

export function LibraryPage() {
  useStore(db.songs.store);
  useStore(db.playlists.store);
  const [editing, setEditing] = useState(undefined);   // undefined 关着，null 新加，对象 改这一首

  const lib = music.allSongs();
  // 本机的歌单：我的在前，角色建的按角色排在后面
  const lists = db.playlists.all()
    .sort((a, b) => (a.owner === music.LIB_OWNER ? 0 : 1) - (b.owner === music.LIB_OWNER ? 0 : 1)
      || String(a.owner).localeCompare(String(b.owner)) || (a.createdAt || 0) - (b.createdAt || 0));
  const ownerText = p => (p.owner === music.LIB_OWNER ? '我的歌单'
    : `${db.characters.get(p.owner)?.name || '已删除的角色'}的歌单`);

  const drop = async song => {
    if (!await confirm({
      title: '从曲库移除', danger: true, okText: '移除',
      message: `将移除「${song.title}」。歌单中的这一首会一并移除，上传的音频文件也会删除。`,
    })) return;
    music.removeSong(song.id);
  };

  return html`
    <${Page} title="曲库" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${() => setEditing(null)}>添加</button>`}>
      <div class="mu-page">
        ${lib.length ? html`
          <div class="mu-sec">
            <span>共 ${lib.length} 首</span>
            <button class="nav-text press" onClick=${() => player.play(lib, 0)}>全部播放</button>
          </div>
          <div class="mu-list">
            ${lib.map(song => html`
              <${TrackRow} key=${song.id}
                track=${{ ...song, album: sourceText(song) }}
                onPlay=${() => player.playOne(song)}
                right=${html`
                  <span class="row-acts">
                    <button class="nav-text press"
                      onClick=${e => { e.stopPropagation(); setEditing(song); }}>编辑</button>
                    <button class="nav-text press"
                      onClick=${e => { e.stopPropagation(); drop(song); }}>移除</button>
                  </span>`}/>`)}
          </div>`
        : html`
          <${EmptyState} icon="music" title="曲库是空的"
            desc="可上传本机音频或填写播放地址，也可在搜索页将网易云的曲目收入此处。"
            action=${html`<${Button} size="sm" icon="plus"
              onClick=${() => setEditing(null)}>添加歌曲<//>`}/>`}

        ${lists.length ? html`
          <div class="mu-sec"><span>歌单</span></div>
          <div class="mu-list">
            ${lists.map(p => html`
              <div key=${p.id} class="mu-row press" onClick=${() => nav.push(`/local/${p.id}`)}>
                <div class="mu-main">
                  <div class="mu-title ellipsis">${p.name}</div>
                  <div class="mu-sub ellipsis">${ownerText(p)} · ${(p.trackIds || []).length} 首</div>
                </div>
              </div>`)}
          </div>` : null}

        <div class="settings-foot">
          曲库中的曲目供会话中的「一起听」选曲使用，也可在此直接播放。<br/>
          网易云收入的曲目只保存标识，播放地址在每次播放时重新获取。
        </div>
      </div>

      <${NowBar} safe/>

      <${EditSheet} open=${editing !== undefined} song=${editing || null}
        onClose=${() => setEditing(undefined)}/>
    <//>`;
}

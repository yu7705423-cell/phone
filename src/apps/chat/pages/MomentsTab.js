import { html, useState, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Avatar, Button, Icon, EmptyState, Sheet, Textarea, Segmented, toast } from '../../../ui/index.js';
import { Photo, MomentCard, CommentSheet } from './MomentBits.js';
import { SongCard, SongPicker } from './SongCard.js';
import { PHOTO_MAX } from '../../../system/db/images.js';

const { db, nav, ai } = phone;

// 顶部是我自己的背景、头像和 ID，发布按钮在右上角。
// **封面就在这里换。** 它只在这一处显示，主页已经不放封面了（见 ARCHITECTURE 4.149），
// 换它的入口跟着它走（CLAUDE.md 第 5 条）
function MomentsHeader({ onPost, onRefresh, busy }) {
  const me = phone.accounts.current() || db.persona.get();
  const cover = useImage(me.cover);
  const avatar = useImage(me.avatar);
  const coverRef = useRef(null);
  const pickCover = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const id = await db.images.put(file, PHOTO_MAX);
      if (me.cover) db.images.remove(me.cover);
      db.personas.update(me.id, { cover: id });
    } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };
  return html`
    <div class="mo-header" style=${cover ? `background-image:url(${cover})` : ''}>
      <div class="mo-header-acts">
        <button class="mo-header-btn press" onClick=${() => coverRef.current?.click()}
          aria-label="更换封面"><${Icon} name="image" size=${17}/></button>
        <button class="mo-header-btn press" onClick=${onRefresh} disabled=${busy}
          aria-label="刷新"><${Icon} name="refresh" size=${17}/></button>
        <button class="mo-header-btn press" onClick=${onPost}
          aria-label="发布"><${Icon} name="camera" size=${17}/></button>
      </div>
      <input type="file" accept="image/*" ref=${coverRef} onChange=${pickCover} style="display:none"/>
      <div class="mo-header-me">
        <div class="mo-header-name">${me.name || '我'}</div>
        <${Avatar} src=${avatar} name=${me.name} size=${62} radius=${14}/>
      </div>
    </div>`;
}

export function MomentsTab() {
  useStore(db.moments.store);
  useStore(db.characters.store);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [imgs, setImgs] = useState([]);
  const [target, setTarget] = useState(null);
  const [song, setSong] = useState(null);         // 这条动态要带的那首
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  // 谁可以看：all 所有角色 / some 选定的几位 / none 仅自己。上一次的选择记着，下一条照用
  const [vis, setVis] = useState(() => db.settings.get().momentVisibility || 'all');
  const [who, setWho] = useState(() => new Set(db.settings.get().momentVisibleIds || []));
  const fileRef = useRef(null);

  const list = db.moments.all().sort((a, b) => b.createdAt - a.createdAt);
  const chars = db.characters.all();

  const addPhotos = async e => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    const room = 9 - imgs.length;
    if (!files.length) return;
    try {
      const ids = [];
      for (const f of files.slice(0, room)) ids.push(await db.images.put(f, PHOTO_MAX));
      setImgs([...imgs, ...ids]);
      if (files.length > room) toast('最多九张图片');
    } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };

  const picked = chars.filter(c => who.has(c.id));
  const viewers = vis === 'all' ? chars : vis === 'some' ? picked : [];
  const toggleWho = id => setWho(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const post = () => {
    if (!text.trim() && !imgs.length && !song) return;
    if (vis === 'some' && !picked.length) { toast('请选择可以看到的角色'); return; }
    const mo = db.moments.create({
      authorId: 'me', text: text.trim(), images: imgs, likes: [], comments: [],
      visibleTo: vis === 'all' ? 'all' : vis === 'some' ? picked.map(c => c.id) : [],
      ...(song ? { songId: song.id } : {}),
    });
    db.settings.set({ momentVisibility: vis, momentVisibleIds: [...who] });
    setText(''); setImgs([]); setSong(null); setComposing(false);
    // 看得见的角色逐个来评论。在后台跑，评论一条出现一条
    if (viewers.length && ai.isConfigured()) {
      ai.moments.reactToMine(mo.id).then(r => {
        if (r.failed.length) toast(`${r.failed.length} 位角色的评论没有生成：${r.failed[0].error}`, 'error', 5000);
      });
    }
  };

  const genMoment = async () => {
    if (!chars.length) { toast('请先创建角色卡'); return; }
    if (!ai.isConfigured()) { toast('尚未配置模型接口', 'error'); return; }
    setBusy(true);
    try {
      const char = chars[Math.floor(Math.random() * chars.length)];
      await ai.moments.createMoment(char.id);
      toast(`${char.name} 发布了一条动态`);
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };

  return html`
    <div class="moments">
      <${MomentsHeader} onPost=${() => setComposing(true)} onRefresh=${genMoment} busy=${busy}/>

      ${list.length ? list.map(mo => html`
        <${MomentCard} key=${mo.id} mo=${mo} onComment=${setTarget}
          onOpen=${m => nav.push(`/moment/${m.id}`)}/>`)
      : html`<${EmptyState} icon="moments" title="暂无动态"
          desc="可自行发布，也可由角色依据人设与近期对话自动生成。图片从本地上传，仅保存在本设备。"/>`}

      <${Sheet} open=${composing} onClose=${() => setComposing(false)} title="发布动态">
        <${Textarea} rows=${4} value=${text} onInput=${setText} placeholder="此刻的想法"/>
        <div class="mo-upload">
          ${imgs.map(id => html`
            <div key=${id} class="mo-thumb">
              <${Photo} id=${id}/>
              <button class="mo-thumb-x press" onClick=${() => {
                db.images.remove(id); setImgs(imgs.filter(x => x !== id));
              }}><${Icon} name="close" size=${12}/></button>
            </div>`)}
          ${imgs.length < 9 ? html`
            <button class="mo-add press" onClick=${() => fileRef.current?.click()}>
              <${Icon} name="plus" size=${20}/></button>` : null}
        </div>
        <input type="file" accept="image/*" multiple ref=${fileRef}
          onChange=${addPhotos} style="display:none"/>
        ${song ? html`
          <div class="mo-song-pick">
            <${SongCard} songId=${song.id} layout="row"/>
            <button class="icon-btn press" aria-label="移除歌曲" onClick=${() => setSong(null)}>
              <${Icon} name="close" size=${16}/></button>
          </div>` : html`
          <div class="mo-song-pick">
            <${Button} variant="ghost" size="sm" icon="music" onClick=${() => setPicking(true)}>分享音乐<//>
          </div>`}
        <div class="mo-vis">
          <div class="mo-vis-title">谁可以看</div>
          <${Segmented} value=${vis} onChange=${setVis}
            items=${[{ value: 'all', label: '所有角色' }, { value: 'some', label: '选择角色' }, { value: 'none', label: '仅自己' }]}/>
          ${vis === 'some' ? html`
            <div class="btn-row is-chips pad-t">
              ${chars.map(c => html`
                <${Button} key=${c.id} size="sm" variant=${who.has(c.id) ? 'primary' : 'ghost'}
                  onClick=${() => toggleWho(c.id)}>${c.name}<//>`)}
            </div>` : null}
          <div class="mo-vis-desc">
            ${viewers.length
              ? `发布后，可以看到的 ${viewers.length} 位角色各写一条评论并点赞，共调用 ${viewers.length} 次接口。聊天时这些角色知道你发了这条动态。`
              : vis === 'some' ? '尚未选择角色。' : '角色看不到这条动态，也不会评论。'}
          </div>
        </div>
        <${Button} full onClick=${post} disabled=${!text.trim() && !imgs.length && !song}>发布<//>
      <//>
      <${SongPicker} open=${picking} onClose=${() => setPicking(false)} onPick=${setSong}/>

      <${CommentSheet} target=${target} onClose=${() => setTarget(null)}/>
    </div>`;
}

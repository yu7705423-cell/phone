import { html, useRef, useState } from '../../../lib.js';
import { phone, useStore, useImage, useThumb } from '../../../sdk/index.js';
import { Page, Avatar, Button, Icon, EmptyState, Sheet, toast, prompt, confirm } from '../../../ui/index.js';
import { chatFor } from '../helpers.js';
import { MomentCard, CommentSheet } from './MomentBits.js';
import { PHOTO_MAX, AVATAR_MAX } from '../../../system/db/images.js';
import { LevelRing, BadgeStrip } from './BadgeBits.js';

const { db, nav, ai } = phone;

// 主页。角色主页与我的主页复用同一个组件，只是 subject 不同。见 ARCHITECTURE 4.149
//
// 版式照 Instagram 的个人页：头像 + 三个数字一行，名字与签名，两个并排的按钮，
// 一排圆形精选，然后是「网格 / 列表」两个分栏。网格一格一条动态，
// 放的是这个人所有动态里的图 —— 从前主页上一张图都不露，动态只有一列文字。
//
// 页面上只出 signature，人设一个字不露（CLAUDE.md 第 6 条）。
// 删除角色不在这里：入口在编辑资料那一页，同一个开关只留一处（第 5 条）。

function Cell({ mo, onOpen }) {
  const url = useThumb(mo.images[0]);
  return html`
    <button class="ig-cell press ph-profile-cell" onClick=${() => onOpen(mo)}
      style=${url ? `--cell-img:url(${url})` : ''} aria-label="打开这条动态">
      ${mo.images.length > 1 ? html`<span class="ig-cell-multi ph-profile-cell-multi"><${Icon} name="layers" size=${13}/></span>` : null}
    </button>`;
}

function Ring({ item, onOpen }) {
  const url = useThumb(item.imageId);
  return html`
    <button class="ig-hl-item press ph-profile-highlight" onClick=${() => onOpen(item)}>
      <div class="ig-hl-ring ph-profile-highlight-ring"><div class="ig-hl-img ph-profile-highlight-img" style=${url ? `--hl-img:url(${url})` : ''}></div></div>
      <span class="ph-profile-highlight-name">${item.title || ' '}</span>
    </button>`;
}

function HighlightSheet({ item, onClose, onRename, onRemove }) {
  const url = useImage(item?.imageId);
  return html`
    <${Sheet} open=${!!item} onClose=${onClose} title=${item?.title || '精选'}>
      ${item ? html`
        <div class="ig-hl-view" style=${url ? `background-image:url(${url})` : ''}></div>
        <div class="btn-row pad-y">
          <${Button} size="sm" variant="ghost" icon="edit" onClick=${onRename}>改名<//>
          <${Button} size="sm" variant="ghost" icon="trash" onClick=${onRemove}>删除<//>
        </div>` : null}
    <//>`;
}

export function Profile({ subjectId, embedded }) {
  useStore(db.characters.store);
  useStore(db.moments.store);
  useStore(db.personas.store);
  const [tab, setTab] = useState('grid');
  const [target, setTarget] = useState(null);   // 正在评论的那条
  const [hl, setHl] = useState(null);           // 打开的那个精选

  const isMe = subjectId === 'me';
  const me = phone.accounts.current() || db.persona.get();
  const subject = isMe ? me : db.characters.get(subjectId);
  const avatar = useImage(subject?.avatar);
  const baseFace = useImage(subject?.avatarBase);
  const avatarRef = useRef(null);
  const hlRef = useRef(null);

  if (!subject) {
    return html`<${Page} title="主页" onBack=${nav.pop}><${EmptyState} title="该角色已不存在"/><//>`;
  }

  const patch = p => (isMe ? db.personas.update(me.id, p) : db.characters.update(subjectId, p));
  // 角色走备注（没备注就是本名），我自己是身份名
  const shownName = isMe ? subject.name : phone.remark.nameOf(subject);

  const mine = db.moments.all()
    .filter(m => m.authorId === subjectId)
    .sort((a, b) => b.createdAt - a.createdAt);
  // 照片格与照片数只算还挂着的；撤回了的只在下面的列表里折成一行
  const live = phone.recall.liveMoments(mine);
  const withPics = live.filter(m => (m.images || []).length);
  const photoCount = live.reduce((n, m) => n + (m.images || []).length, 0);
  // 第三个数字：角色看关系网里有几个人，我看联系人有几个（小号不算）
  const relCount = isMe
    ? db.characters.all().filter(c => !c.parentId).length
    : ai.card.relationsOf(subjectId).length;
  const openRel = () => phone.intent.open('contact', { route: isMe ? '/' : `/net/${subjectId}` });

  const pickAvatar = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const id = await db.images.put(file, AVATAR_MAX);
      // 头像那一张**留着**：原本长什么样是找得回来的（见 system/avatar.js）。
      // 从前换一张就把旧的删了，于是「换回去」这件事根本无从做起
      const keepBase = subject.avatarBase || subject.avatar || '';
      patch({ avatar: id, ...(keepBase ? { avatarBase: keepBase } : {}) });
    } catch (err) { toast('图片处理失败：' + err.message, 'error'); }
  };

  // 原本那张与现在这张。角色在对话里自己换过、或者自己手动换过，两张才不一样。
  //
  // **它挂在头像的右下角，不在按钮那一行里。** 从前挤在「发消息」旁边：
  // 那一块 47 像素高，比 30 像素的按钮高出一截，把整行撑开，还占掉右边
  // 五十多像素 —— 两个按钮于是既不满宽也不居中。它说的本来就是头像的事，
  // 就该贴着头像。
  const faces = phone.avatarLink.facesOf(subject);
  const restore = async () => {
    const old = subject.avatarBase;
    if (!old || old === subject.avatar) return;
    // 角标上没有文字，点下去之前得先说清楚这一下会做什么
    if (!await confirm({
      title: '换回原本的头像', okText: '换回',
      message: '当前头像将被替换为更换之前的那一张，替换后当前这张不再保留。',
    })) return;
    if (subject.avatar) db.images.remove(subject.avatar);
    patch({ avatar: old, avatarBase: '' });
    toast('已换回原本的头像', 'ok');
  };

  // ---- 精选：一张图配一个名字，挂在这个人身上 ----
  const hls = subject.highlights || [];
  const addHl = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let id = '';
    try { id = await db.images.put(file, PHOTO_MAX); }
    catch (err) { toast('图片处理失败：' + err.message, 'error'); return; }
    const title = await prompt({ title: '精选名称', placeholder: '显示在圆圈下方', okText: '保存' });
    if (title === null) { db.images.remove(id); return; }
    patch({ highlights: [...hls, { id: `hl${Date.now().toString(36)}`, imageId: id, title: String(title).trim() }] });
  };
  const renameHl = async () => {
    const title = await prompt({ title: '精选名称', value: hl.title || '', okText: '保存' });
    if (title === null) return;
    const next = hls.map(x => (x.id === hl.id ? { ...x, title: String(title).trim() } : x));
    patch({ highlights: next });
    setHl(next.find(x => x.id === hl.id) || null);
  };
  const removeHl = async () => {
    if (!await confirm({ title: '删除这个精选', danger: true })) return;
    db.images.remove(hl.imageId);
    patch({ highlights: hls.filter(x => x.id !== hl.id) });
    setHl(null);
  };

  const openMoment = m => nav.push(`/moment/${m.id}`);

  // 和这个角色的那段私聊（当前身份下的）。没聊过就没有，标识那一排与那一圈都不画 ——
  // 这里只读，不替人建会话
  const meId = phone.accounts.currentId();
  const pair = isMe ? null : db.chats.all().find(c => c.group !== true && (c.characterIds || []).length === 1
    && c.characterIds[0] === subjectId && (c.personaId || meId) === meId) || null;

  const body = html`
    <div class=${`ig ph-profile${isMe ? ' ph-profile-me' : ''}`}>
      <div class="ig-head ph-profile-head">
        <div class="ig-face ph-profile-face">
          <${LevelRing} chat=${pair} size=${84}>
            <button class="press" onClick=${() => isMe && avatarRef.current?.click()}
              aria-label=${isMe ? '更换头像' : '头像'}>
              <${Avatar} src=${avatar} name=${subject.name} size=${84} radius=${42}/>
            </button>
          <//>
          ${faces.changed ? html`
            <button class="ig-face-base press ph-profile-face-base" onClick=${restore} aria-label="换回原本的头像">
              <${Avatar} src=${baseFace} name=${subject.name} size=${28} radius=${14}/>
            </button>` : null}
        </div>
        <input type="file" accept="image/*" ref=${avatarRef} onChange=${pickAvatar} style="display:none"/>
        <div class="ig-stats ph-profile-stats">
          <button class="ig-stat press ph-profile-stat" onClick=${() => setTab('list')}>
            <b class="ph-profile-stat-num">${mine.length}</b><span class="ph-profile-stat-label">动态</span></button>
          <button class="ig-stat press ph-profile-stat" onClick=${() => setTab('grid')}>
            <b class="ph-profile-stat-num">${photoCount}</b><span class="ph-profile-stat-label">照片</span></button>
          <button class="ig-stat press ph-profile-stat" onClick=${openRel}>
            <b class="ph-profile-stat-num">${relCount}</b><span class="ph-profile-stat-label">${isMe ? '联系人' : '关系'}</span></button>
        </div>
      </div>

      <div class="ig-bio ph-profile-bio">
        <div class="ig-name ph-profile-name">${shownName}</div>
        ${subject.signature ? html`<div class="ig-sign ph-profile-sign">${subject.signature}</div>` : null}
      </div>

      <${BadgeStrip} chat=${pair}/>

      <div class="ig-acts ph-profile-acts">
        ${isMe
          ? html`<${Button} size="sm" variant="ghost"
              onClick=${() => phone.intent.open('contact', { route: `/me/${me.id}` })}>编辑本人人设<//>`
          : html`
            <${Button} size="sm" variant="ghost"
              onClick=${() => { const c = chatFor(subjectId); nav.push(`/chat/${c.id}`); }}>发消息<//>
            <${Button} size="sm" variant="ghost"
              onClick=${() => phone.intent.open('contact', { route: `/edit/${subjectId}` })}>编辑资料<//>`}
      </div>

      <div class="ig-hl ph-profile-highlights">
        ${hls.map(item => html`<${Ring} key=${item.id} item=${item} onOpen=${setHl}/>`)}
        <button class="ig-hl-item press ph-profile-highlight ph-profile-highlight-add" onClick=${() => hlRef.current?.click()} aria-label="新建精选">
          <div class="ig-hl-ring is-add ph-profile-highlight-ring"><div class="ig-hl-img ph-profile-highlight-img"><${Icon} name="plus" size=${20}/></div></div>
          <span class="ph-profile-highlight-name">新建</span>
        </button>
        <input type="file" accept="image/*" ref=${hlRef} onChange=${addHl} style="display:none"/>
      </div>

      <div class="ig-tabs ph-profile-tabs">
        <button class=${`ig-tab press ph-profile-tab${tab === 'grid' ? ' is-on ph-profile-tab-on' : ''}`}
          onClick=${() => setTab('grid')} aria-label="网格"><${Icon} name="grid" size=${20}/></button>
        <button class=${`ig-tab press ph-profile-tab${tab === 'list' ? ' is-on ph-profile-tab-on' : ''}`}
          onClick=${() => setTab('list')} aria-label="列表"><${Icon} name="notes" size=${20}/></button>
      </div>

      ${tab === 'grid'
        ? (withPics.length
          ? html`<div class="ig-grid ph-profile-grid">
              ${withPics.map(m => html`<${Cell} key=${m.id} mo=${m} onOpen=${openMoment}/>`)}
            </div>`
          : html`<${EmptyState} icon="image" title="暂无照片" desc="带图片的动态会显示在这里。"/>`)
        : (mine.length
          ? mine.map(m => html`
              <${MomentCard} key=${m.id} mo=${m} onComment=${setTarget} onOpen=${openMoment}/>`)
          : html`<${EmptyState} icon="moments" title="暂无动态"/>`)}
      <div class="pad-b"></div>

      <${CommentSheet} target=${target} onClose=${() => setTarget(null)}/>
      <${HighlightSheet} item=${hl} onClose=${() => setHl(null)} onRename=${renameHl} onRemove=${removeHl}/>
    </div>`;

  // 作为聊天 app 的一个分区嵌入时不再套一层导航栏，避免出现两条标题栏
  if (embedded) return body;
  return html`<${Page} title=${shownName} onBack=${nav.pop}>${body}<//>`;
}

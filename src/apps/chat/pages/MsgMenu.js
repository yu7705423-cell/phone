import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Sheet, List, ListItem, Button, Icon, EmptyState, Textarea,
         toast, prompt, confirm } from '../../../ui/index.js';

const { db, ai } = phone;

const textOf = m => m.kind === 'image' ? (m.prompt || m.imageDesc || '')
  : m.kind === 'voice' ? (m.voiceText || '')
  : m.kind === 'song' ? `分享歌曲：${m.songQuery || ''}`
  : m.kind === 'tool' ? `调用工具：${m.toolTitle || m.toolName || ''}`
  : (m.content || '');

// 改的是「这条消息的正文」，但正文在哪个字段要看消息类型与是谁发的。
//
// 角色发的图片和语音是按描述生成出来的，改了描述就要重新生成一份。
// 用户发的是自己选的图、自己录的音，媒体本身不动 —— 改的只是角色
// 读到的那段文字（识图描述 / 语音转写）。
async function editMessage(msg) {
  const mine = msg.role === 'user';
  const label = msg.kind === 'image' ? (mine ? '修改角色读到的图片描述' : '修改图片描述')
    : msg.kind === 'voice' ? (mine ? '修改语音转写' : '修改语音文本')
    : '编辑消息';
  const v = await prompt({ title: label, value: textOf(msg), multiline: true });
  if (v == null) return;
  const t = v.trim();
  if (!t) { toast('内容不能为空。如需移除请使用删除'); return; }
  if (t === textOf(msg)) return;

  if (msg.kind === 'image') {
    if (mine) {
      db.messages.update(msg.id, { imageDesc: t, vision: 'done', content: `[图片：${t}]` });
    } else {
      db.messages.update(msg.id, { prompt: t, content: `[图片：${t}]` });
      ai.reply.regenMedia(msg.id);
    }
  } else if (msg.kind === 'voice') {
    if (mine) {
      const tone = (msg.tone || '').trim();
      db.messages.update(msg.id, {
        voiceText: t, asr: 'done',
        content: `[语音：${t}]${tone ? `（听起来${tone}）` : ''}`,
      });
    } else {
      db.messages.update(msg.id, { voiceText: t, content: `[语音：${t}]` });
      ai.reply.regenMedia(msg.id);
    }
  } else {
    db.messages.update(msg.id, { content: t });
  }
}

// 格式修复。列出这条用得上的修法，每条先给出改完的样子；
// **底下永远有一条手动的** —— 本地规则认不出的走形是认不完的，
// 认不出时那一页从前只有一句「未发现格式问题」，人就没有出口了。
function RepairSheet({ msgId, open, onClose }) {
  useStore(db.messages.store);
  const msg = msgId ? db.messages.get(msgId) : null;
  const fixes = msg ? ai.repair.fixesFor(msg) : [];
  const src = msg ? ai.repair.manualSource(msg) : null;
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState('');

  const openManual = () => { setDraft(src?.text || ''); setManual(true); };
  const preview = manual ? ai.repair.previewSplit(draft) : null;
  const doManual = () => {
    try {
      toast(ai.repair.applyManual(msgId, draft));
      onClose();
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
  };

  const one = id => {
    try {
      const note = ai.repair.applyFix(msgId, id);
      toast(note);
      // 分条之后原消息没了，菜单没有落脚点，直接收起来
      if (id === 'rows') onClose();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const all = () => {
    try {
      const done = ai.repair.applyAll(msgId);
      toast(done.length ? done.join('、') : '没有可修正的项');
      onClose();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  return html`
    <${Sheet} open=${open} onClose=${onClose} title="修正格式" height="66%">
      ${fixes.length ? html`
        <div class="fix-head">
          以下问题由本地规则识别，直接修正，无需重新调用接口。
        </div>
        <${List} inset=${false}>
          ${fixes.map(f => html`
            <${ListItem} key=${f.id} multiline title=${f.label} subtitle=${f.desc}
              left=${html`<${Icon} name="sparkle" size=${18}/>`}
              right=${html`<button class="nav-text press" onClick=${() => one(f.id)}>应用</button>`}/>
            <div key=${`p-${f.id}`} class="fix-preview">${f.preview}</div>`)}
        <//>
        <div class="pad">
          <${Button} full onClick=${all}>${`全部修正（${fixes.length} 项）`}<//>
        </div>`
      : html`<${EmptyState} icon="check" title="未发现格式问题"
          desc="本地规则没有识别到可修正的项。可使用下方的手动整理。"/>`}

      ${manual ? html`
        <div class="fix-head">
          下面是模型这一轮交回来的原文。${src?.scope === 'turn'
    ? `修改后将按标记重新分条，替换这一轮的全部 ${src.count} 条消息。`
    : '修改后将按标记重新分条，替换这一条消息。'}
        </div>
        <div class="pad-x">
          <${Textarea} rows=${8} value=${draft} onInput=${setDraft}/>
        </div>
        <div class="fix-preview">${preview?.note || ''}</div>
        <div class="fix-head">
          常用标记：[引用：原话摘录]、[图片：描述]、[视频：描述]、[语音：内容]、[表情：名称]、
          [骰子]、[拍一拍]、[译文：译文内容]。各占一行。
        </div>
        <div class="pad">
          <${Button} full disabled=${!preview?.n} onClick=${doManual}>按这样重新分条<//>
        </div>`
      : html`
        <div class="pad">
          <${Button} full variant="ghost" icon="edit" onClick=${openManual}>
            手动整理
          <//>
          <div class="settings-foot">
            本地规则认不出的写法，可在此直接修改原文后重新分条。
          </div>
        </div>`}
    <//>`;
}

// 把会话里分享的一首歌放进我的歌单。挑一个已有的，或者当场新建一个
function AddToListSheet({ song, onClose }) {
  useStore(db.playlists.store);
  const lists = phone.music.allLists(phone.music.LIB_OWNER);
  const put = p => {
    const added = phone.music.addTrack(p.id, song.id);
    toast(added ? `已加入「${p.name}」` : `已在「${p.name}」中`, added ? 'ok' : 'plain');
    onClose();
  };
  const fresh = async () => {
    const name = await prompt({ title: '新建歌单', okText: '创建' });
    if (!name || !name.trim()) return;
    try { put(phone.music.createList({ name })); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };
  return html`
    <${Sheet} open=${true} onClose=${onClose} title="加入我的歌单">
      <${List} inset=${false}>
        ${lists.map(p => html`
          <${ListItem} key=${p.id} title=${p.name} subtitle=${`${(p.trackIds || []).length} 首`}
            onClick=${() => put(p)}/>`)}
        <${ListItem} title="新建歌单" arrow left=${html`<${Icon} name="plus" size=${18}/>`} onClick=${fresh}/>
      <//>
    <//>`;
}

export function MsgMenu({ msg, char, onClose, onRegenerate, onQuote, onMultiSelect, onDelete }) {
  useStore(db.messages.store);
  const [repairing, setRepairing] = useState(false);
  const [adding, setAdding] = useState(false);     // 歌曲那一条：正在挑放进哪个歌单
  // 修完可能整条被拆掉，每次都从库里重取，别拿着长按那一刻的旧快照
  const fresh = msg ? db.messages.get(msg.id) : null;
  const fixes = fresh ? ai.repair.fixesFor(fresh) : [];

  // 这个组件一直挂着，靠 msg 有没有值来决定显不显示，
  // 所以每条出口都得把 repairing 归零 —— 否则下次长按别的消息，
  // 弹出来的是上一条留下的「修格式」。
  const close = () => { setRepairing(false); setAdding(false); onClose(); };

  if (!msg) return null;
  // 修格式单独占一层，不套在菜单里面 —— 浮层套浮层在 iOS 上定位会飘
  if (repairing) return html`<${RepairSheet} msgId=${msg.id} open=${true} onClose=${close}/>`;
  // 分享的歌。卡片正文是给角色读的标记，对人来说要的是这首歌本身
  const song = fresh?.kind === 'song' && fresh.songId ? db.songs.get(fresh.songId) : null;
  if (adding && song) return html`<${AddToListSheet} song=${song} onClose=${close}/>`;

  const gone = !fresh;
  // 转账、礼物、约定、信这些不给改：正文里写着金额和内容，改了正文，
  // 消息上的字段不会跟着变，落下来就是两套说法。要撤销就整条删掉。
  // 名单和「修格式」共用一份（ai.repair.STRUCTURED），别在两处各抄一遍。
  const canEdit = !gone && !ai.repair.STRUCTURED.has(fresh.kind);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(song
        ? `${song.title}${song.artist ? ` - ${song.artist}` : ''}` : (fresh.content || ''));
      toast('已复制');
    } catch { toast('复制失败：浏览器未授予剪贴板权限', 'error'); }
    close();
  };

  // 图片存进相册。存的是同一个 imageId，不再压一份 —— 库里一张就够，
  // 所以从相册里删掉它时也不会动到消息上那一张（见 album.removePhoto）
  const keep = () => {
    try {
      // 表情那一条上挂的是表情 id，不是图片 id；图在表情行里
      phone.album.saveImage({
        imageId: fresh.imageId || phone.db.stickers.get(fresh.stickerId)?.imageId,
        from: {
          chatId: fresh.chatId, charId: fresh.authorId,
          name: fresh.role === 'user' ? '我' : (char?.name || ''),
          at: fresh.createdAt,
        },
      });
      toast('已存入相册', 'ok');
    } catch (err) { toast(String(err.message || err), 'error'); }
    close();
  };

  // 存成我自己的备忘。和下面那条「记住这句」是两件事：
  // 那一条进角色的记忆、会被注入 prompt；这一条只进我的备忘，角色看不见。
  // 存完跳到那一条的编辑页，接着写几句；退回来还是这段对话。
  const keepNote = () => {
    const body = (textOf(fresh) || '').trim();
    if (!body) { toast('这一条没有可记的正文', 'error'); return; }
    const who = fresh.role === 'user' ? '我' : (char?.name || '对方');
    const row = phone.note.add(`${who}：${body}`, {
      from: phone.note.FROM_CHAT,
      chatId: fresh.chatId, charId: fresh.authorId || char?.id || '',
    });
    close();
    phone.intent.open('todo', { route: `/note/${row.id}`, back: true });
  };

  // 「这句你给我记住」。
  //
  // 最该被记住的那句话，永远是刚刚说完的那句。而从前要记一条得退出对话、
  // 进记忆 app、自己打字 —— 走完那一圈，当时那股劲已经过去了。
  //
  // 不调接口：内容就是这句话本身，等级给 A（长期有效），来源记成手写
  // （召回打分里手写的比自动提取的可信一档）。存完直接跳到那一条的编辑页，
  // 关键词和「一直记着」在那儿现调，退回来还是这段对话。
  const remember = () => {
    const body = (textOf(fresh) || '').trim();
    if (!body) { toast('这一条没有可记的正文', 'error'); return; }
    const charId = fresh.role === 'user' ? (char?.id || '') : (fresh.authorId || char?.id || '');
    if (!charId) { toast('这段对话还没有角色', 'error'); return; }
    const who = fresh.role === 'user' ? '我' : (char?.name || '对方');
    const row = db.memories.create({
      charId,
      personaId: db.chats.get(fresh.chatId)?.personaId || phone.accounts.currentId(),
      content: `${who}说：${body}`.slice(0, 300),
      category: 'fact', rank: 'A', keywords: [], source: 'manual',
      createdAt: fresh.createdAt || Date.now(), updatedAt: Date.now(),
    });
    close();
    phone.intent.open('memory', { route: `/edit/${row.id}`, back: true });
  };

  // 从这一首开始一起听。和一起听页里点一首是同一件事，只是不用先翻过去找
  const chatOf = fresh ? db.chats.get(fresh.chatId) : null;
  const canListen = !!song && chatOf && !phone.group.isGroup(chatOf) && char?.canListen !== false;
  const listenFrom = () => {
    try { phone.listen.start({ chatId: fresh.chatId, songId: song.id }); toast('已开始一起听', 'ok'); }
    catch (err) { toast(String(err.message || err), 'error'); }
    close();
  };

  // 撤回：对方那边折成一行「你撤回了一条消息」，自己这边点开还看得到（见 system/recall.js）
  const canRecall = !gone && phone.recall.canRecall(fresh);
  const takeBack = () => {
    phone.recall.recallMine(fresh.id);
    close();
  };

  const del = async () => {
    if (!await confirm({ title: '删除这条消息', message: '删除后不再进入上下文。', danger: true })) return;
    onDelete(msg.id);
    close();
  };

  return html`
    <${Sheet} open=${true} onClose=${close} title=${gone ? '该消息已不存在' : ''}>
      ${gone ? html`
        <div class="pad"><${Button} full variant="ghost" onClick=${close}>知道了<//></div>`
      : html`
        <div class="msg-menu-quote">${textOf(fresh) || '（空）'}</div>
        <${List} inset=${false}>
          ${onRegenerate ? html`
            <${ListItem} title="重新生成" subtitle="整轮重来，原来那版留作候选，可以左右切回去" arrow multiline
              left=${html`<${Icon} name="refresh" size=${18}/>`}
              onClick=${() => { close(); onRegenerate(); }}/>` : null}
          ${canEdit ? html`
            <${ListItem} title="编辑" arrow
              left=${html`<${Icon} name="edit" size=${18}/>`}
              onClick=${() => { close(); editMessage(fresh); }}/>` : null}
          ${fixes.length ? html`
            <${ListItem} title="修正格式" subtitle=${`识别到 ${fixes.length} 处可修正的问题`} arrow multiline
              left=${html`<${Icon} name="sparkle" size=${18}/>`}
              onClick=${() => setRepairing(true)}/>` : null}
          ${canRecall ? html`
            <${ListItem} title="撤回" multiline arrow
              subtitle="角色看到一行「对方撤回了一条消息」。角色回复过的消息，撤回后角色仍知道原文"
              left=${html`<${Icon} name="undo" size=${18}/>`} onClick=${takeBack}/>` : null}
          <${ListItem} title="引用" subtitle="回复这一条，角色可据此判断你在回应哪句。在消息上左右滑动同样可以引用" arrow multiline
            left=${html`<${Icon} name="reply" size=${18}/>`}
            onClick=${() => { close(); onQuote(fresh); }}/>
          ${canListen ? html`
            <${ListItem} title="从这首开始一起听" arrow
              left=${html`<${Icon} name="headphone" size=${18}/>`} onClick=${listenFrom}/>` : null}
          ${song ? html`
            <${ListItem} title="加入我的歌单" arrow
              left=${html`<${Icon} name="plus" size=${18}/>`} onClick=${() => setAdding(true)}/>` : null}
          <${ListItem} title=${song ? '复制歌名' : '复制'} arrow
            left=${html`<${Icon} name="copy" size=${18}/>`} onClick=${copy}/>
          <${ListItem} title="记住这句" multiline arrow
            subtitle="存成一条记忆，接着可以填关键词，或者钉成一直记着的"
            left=${html`<${Icon} name="brain" size=${18}/>`}
            onClick=${remember}/>
          <${ListItem} title="记到衣帽间" multiline arrow
            subtitle="记成衣帽间里某件东西的回忆。穿着或带着它的那天，角色会读到这一条"
            left=${html`<${Icon} name="hanger" size=${18}/>`}
            onClick=${() => { close(); phone.intent.open('closet', { route: `/remember/${fresh.id}`, back: true }); }}/>
          <${ListItem} title="存成备忘" multiline arrow
            subtitle="存进「待办」中的备忘，供自己查阅。角色不会看到这一条"
            left=${html`<${Icon} name="notes" size=${18}/>`}
            onClick=${keepNote}/>
          ${!gone && (fresh.imageId || fresh.stickerId) ? html`
            <${ListItem} title="保存到相册" arrow multiline
              subtitle="存进相册，可在相册中归类。会话里这一条不受影响"
              left=${html`<${Icon} name="camera" size=${18}/>`}
              onClick=${keep}/>` : null}
          <${ListItem} title="多选" subtitle="选择多条消息后一并删除，或存成一张图片" arrow multiline
            left=${html`<${Icon} name="check" size=${18}/>`}
            onClick=${() => { close(); onMultiSelect(fresh); }}/>
          <${ListItem} title="删除" danger arrow
            left=${html`<${Icon} name="trash" size=${18}/>`} onClick=${del}/>
        <//>`}
    <//>`;
}

import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Sheet, List, ListItem, Button, Icon, EmptyState,
         toast, prompt, confirm } from '../../../ui/index.js';

const { db, ai } = phone;

const textOf = m => m.kind === 'image' ? (m.prompt || '')
  : m.kind === 'voice' ? (m.voiceText || '')
  : (m.content || '');

// 改的是「这条消息的正文」，但正文在哪个字段要看消息类型：
// 图片改的是画面描述，语音改的是要说的话，改完那份媒体得重新生成。
async function editMessage(msg) {
  const label = msg.kind === 'image' ? '改图片描述'
    : msg.kind === 'voice' ? '改语音文字' : '编辑消息';
  const v = await prompt({ title: label, value: textOf(msg), multiline: true });
  if (v == null) return;
  const t = v.trim();
  if (!t) { toast('内容不能为空，想删就用删除'); return; }
  if (t === textOf(msg)) return;

  if (msg.kind === 'image') {
    db.messages.update(msg.id, { prompt: t, content: `[图片：${t}]` });
    ai.reply.regenMedia(msg.id);
  } else if (msg.kind === 'voice') {
    db.messages.update(msg.id, { voiceText: t, content: `[语音：${t}]` });
    ai.reply.regenMedia(msg.id);
  } else {
    db.messages.update(msg.id, { content: t });
  }
}

// 格式修复。列出这条用得上的修法，每条先给出改完的样子。
function RepairSheet({ msgId, open, onClose }) {
  useStore(db.messages.store);
  const msg = msgId ? db.messages.get(msgId) : null;
  const fixes = msg ? ai.repair.fixesFor(msg) : [];

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
      toast(done.length ? done.join('、') : '没什么可改的');
      onClose();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  return html`
    <${Sheet} open=${open} onClose=${onClose} title="修格式" height="66%">
      ${fixes.length ? html`
        <div class="fix-head">
          模型偶尔会把格式写歪。下面这些是按规则认出来的，不用再调一次接口。
        </div>
        <${List} inset=${false}>
          ${fixes.map(f => html`
            <${ListItem} key=${f.id} multiline title=${f.label} subtitle=${f.desc}
              left=${html`<${Icon} name="sparkle" size=${18}/>`}
              right=${html`<button class="nav-text press" onClick=${() => one(f.id)}>应用</button>`}/>
            <div key=${`p-${f.id}`} class="fix-preview">${f.preview}</div>`)}
        <//>
        <div class="pad">
          <${Button} full onClick=${all}>${`全部修一遍（${fixes.length} 项）`}<//>
        </div>`
      : html`<${EmptyState} icon="check" title="这条格式没问题"
          desc="没认出需要修的地方。内容本身不对的话用「编辑」直接改。"/>`}
    <//>`;
}

export function MsgMenu({ msg, char, onClose, onQuote, onMultiSelect, onDelete }) {
  useStore(db.messages.store);
  const [repairing, setRepairing] = useState(false);
  // 修完可能整条被拆掉，每次都从库里重取，别拿着长按那一刻的旧快照
  const fresh = msg ? db.messages.get(msg.id) : null;
  const fixes = fresh ? ai.repair.fixesFor(fresh) : [];

  // 这个组件一直挂着，靠 msg 有没有值来决定显不显示，
  // 所以每条出口都得把 repairing 归零 —— 否则下次长按别的消息，
  // 弹出来的是上一条留下的「修格式」。
  const close = () => { setRepairing(false); onClose(); };

  if (!msg) return null;
  // 修格式单独占一层，不套在菜单里面 —— 浮层套浮层在 iOS 上定位会飘
  if (repairing) return html`<${RepairSheet} msgId=${msg.id} open=${true} onClose=${close}/>`;

  const gone = !fresh;
  const canEdit = !gone && fresh.kind !== 'sticker' && fresh.kind !== 'typing';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fresh.content || '');
      toast('已复制');
    } catch { toast('复制失败，浏览器没给权限', 'error'); }
    close();
  };

  const del = async () => {
    if (!await confirm({ title: '删除这条消息', message: '删掉之后就不再进上下文了。', danger: true })) return;
    onDelete(msg.id);
    close();
  };

  return html`
    <${Sheet} open=${true} onClose=${close} title=${gone ? '这条已经不在了' : ''}>
      ${gone ? html`
        <div class="pad"><${Button} full variant="ghost" onClick=${close}>知道了<//></div>`
      : html`
        <div class="msg-menu-quote">${textOf(fresh) || '（空）'}</div>
        <${List} inset=${false}>
          ${canEdit ? html`
            <${ListItem} title="编辑" arrow
              left=${html`<${Icon} name="edit" size=${18}/>`}
              onClick=${() => { close(); editMessage(fresh); }}/>` : null}
          ${fixes.length ? html`
            <${ListItem} title="修格式" subtitle=${`认出 ${fixes.length} 处可以修的`} arrow multiline
              left=${html`<${Icon} name="sparkle" size=${18}/>`}
              onClick=${() => setRepairing(true)}/>` : null}
          <${ListItem} title="引用" subtitle="回这一条，对方能看到你在接哪句" arrow multiline
            left=${html`<${Icon} name="reply" size=${18}/>`}
            onClick=${() => { close(); onQuote(fresh); }}/>
          <${ListItem} title="复制" arrow
            left=${html`<${Icon} name="copy" size=${18}/>`} onClick=${copy}/>
          <${ListItem} title="多选" subtitle="挑几条一起删" arrow multiline
            left=${html`<${Icon} name="check" size=${18}/>`}
            onClick=${() => { close(); onMultiSelect(fresh); }}/>
          <${ListItem} title="删除" danger arrow
            left=${html`<${Icon} name="trash" size=${18}/>`} onClick=${del}/>
        <//>`}
    <//>`;
}

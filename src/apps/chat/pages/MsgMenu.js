import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Sheet, List, ListItem, Button, Icon, EmptyState,
         toast, prompt, confirm } from '../../../ui/index.js';

const { db, ai } = phone;

const textOf = m => m.kind === 'image' ? (m.prompt || m.imageDesc || '')
  : m.kind === 'voice' ? (m.voiceText || '')
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
          desc="没有识别到可修正的项。如需修改内容本身，请使用「编辑」。"/>`}
    <//>`;
}

export function MsgMenu({ msg, char, onClose, onRegenerate, onQuote, onMultiSelect, onDelete }) {
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
  // 转账和提示行不给改：正文里写着金额，改了正文金额也不会跟着变，
  // 落下来的就是两套说法。要撤销就整条删掉。
  const NO_EDIT = new Set(['sticker', 'typing', 'transfer', 'notice', 'location', 'call']);
  const canEdit = !gone && !NO_EDIT.has(fresh.kind);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fresh.content || '');
      toast('已复制');
    } catch { toast('复制失败：浏览器未授予剪贴板权限', 'error'); }
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
          <${ListItem} title="引用" subtitle="回复这一条，角色可据此判断你在回应哪句" arrow multiline
            left=${html`<${Icon} name="reply" size=${18}/>`}
            onClick=${() => { close(); onQuote(fresh); }}/>
          <${ListItem} title="复制" arrow
            left=${html`<${Icon} name="copy" size=${18}/>`} onClick=${copy}/>
          <${ListItem} title="多选" subtitle="选择多条消息后一并删除" arrow multiline
            left=${html`<${Icon} name="check" size=${18}/>`}
            onClick=${() => { close(); onMultiSelect(fresh); }}/>
          <${ListItem} title="删除" danger arrow
            left=${html`<${Icon} name="trash" size=${18}/>`} onClick=${del}/>
        <//>`}
    <//>`;
}

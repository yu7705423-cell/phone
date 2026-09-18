import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Textarea, Button, Icon,
         EmptyState, toast, confirm } from '../../../ui/index.js';

const { db, nav, ai } = phone;
const bond = ai.bond;

const when = t => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '尚未生成');

// 关系底色。S 级记忆压出来的几句现状，每轮常驻。
// 跟着这段对话走，所以入口在会话菜单里，不在全局设置（CLAUDE.md 第 5 条）
export function BondPage({ chatId }) {
  useStore(db.characters.store);
  useStore(db.memories.store);
  useStore(db.settings.store);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);

  const chat = db.chats.get(chatId);
  const char = db.characters.get((chat?.characterIds || [])[0]);
  if (!chat || !char) {
    return html`<${Page} title="关系底色" onBack=${nav.pop}>
      <${EmptyState} title="该会话已不存在"/><//>`;
  }

  const cur = bond.get(char, chat.personaId);
  const text = draft === null ? bond.textOf(char, chat.personaId) : draft;
  const source = bond.sourceOf(char.id, chat.personaId);
  const stale = bond.stale(char.id, chat.personaId);

  const save = () => {
    bond.set(char.id, chat.personaId, text);
    setDraft(null);
    toast('已保存。自动重新生成已停止', 'ok');
  };

  const regen = async () => {
    if (cur?.manual && !await confirm({
      title: '重新生成', okText: '生成',
      message: '当前内容为手动编辑的版本，重新生成将覆盖它。',
    })) return;
    setBusy(true);
    try {
      const r = await bond.refresh(char.id, chat.personaId, { force: true });
      if (!r) throw new Error('没有可用于生成的关系转折级记忆');
      setDraft(null);
      toast('已重新生成', 'ok');
    } catch (e) {
      toast('生成失败：' + (e.message || e), 'error', 5000);
    } finally { setBusy(false); }
  };

  return html`
    <${Page} title="关系底色" onBack=${nav.pop}>
      <div class="pad">
        <div class="hint-box">
          这段内容每轮都会注入，用于说明你与${char.name}目前处于什么关系。
          它由标记为 S 级的记忆压缩而成。日常对话中不再逐条注入那些记忆，
          需要具体内容时再按相关度召回。
        </div>

        <${Field} label="正文"
          desc="留空则不注入。手动修改后将不再自动重新生成，可随时点击下方按钮恢复。">
          <${Textarea} rows=${6} value=${text}
            placeholder="尚未生成。可以自己写，也可以由模型根据 S 级记忆生成。"
            onInput=${v => setDraft(v)}/>
        <//>
      </div>

      <div class="pad batch-acts">
        <${Button} disabled=${draft === null} onClick=${save}>保存<//>
        <${Button} variant="ghost" disabled=${busy || !ai.isConfigured()} onClick=${regen}>
          ${busy ? '正在生成' : '重新生成'}<//>
      </div>
      ${!ai.isConfigured() ? html`
        <div class="settings-foot">尚未配置聊天接口，无法自动生成，可手动填写。</div>` : null}

      <${List}>
        <${ListItem} title="上次生成" right=${html`<span>${when(cur?.at)}</span>`}/>
        <${ListItem} title="来源记忆" right=${html`<span>${source.length} 条</span>`}/>
        <${ListItem} title="当前状态" multiline
          subtitle=${cur?.manual
            ? '手动编辑的版本。S 级记忆变动时不会自动覆盖。'
            : stale ? 'S 级记忆已有变动，下次发送消息时会自动重新生成。'
              : '与当前的 S 级记忆一致。'}
          left=${html`<${Icon} name=${cur?.manual ? 'lock' : 'refresh'} size=${18}/>`}/>
        ${cur?.manual ? html`
          <${ListItem} title="恢复自动生成" arrow
            subtitle="下次发送消息时按当前的 S 级记忆重新生成，覆盖当前内容" multiline
            left=${html`<${Icon} name="refresh" size=${18}/>`}
            onClick=${() => { bond.unlock(char.id, chat.personaId); toast('已恢复自动生成', 'ok'); }}/>` : null}
      <//>

      <${List} title=${`来源：关系转折级记忆 ${source.length}`}>
        ${source.map(m => html`
          <${ListItem} key=${m.id} title=${m.content} multiline
            subtitle=${ai.memory.CATEGORIES[m.category] || m.category}/>`)}
        ${!source.length ? html`
          <${ListItem} title="暂无" multiline
            subtitle="将记忆的重要级别设为 S，它就会进入这里。S 级用于关系的重大转折。"/>` : null}
      <//>
    <//>`;
}

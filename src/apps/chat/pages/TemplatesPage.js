import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Textarea, Button, Icon, toast, confirm } from '../../../ui/index.js';

const { db, nav, ai } = phone;

const LABELS = {
  'skeleton.opening': '骨架 · 身份开场',
  'skeleton.closing': '骨架 · 回复风格收尾',
  'skeleton.style': '骨架 · 自然表达协议',
  'skeleton.sticker': '骨架 · 可用表情',
  'skeleton.quote': '骨架 · 引用某一句',
  'skeleton.time': '骨架 · 先写出时间',
  'skeleton.translate': '骨架 · 顺带给出译文',
  'skeleton.transfer': '骨架 · 转账',
  'skeleton.location': '骨架 · 位置',
  'skeleton.ring': '骨架 · 打电话',
  'skeleton.call': '骨架 · 通话中',
  'task.call-open': '任务 · 通话接通后开口',
  'skeleton.group': '骨架 · 群聊说明',
  'task.memory-extract': '任务 · 提取记忆',
  'task.memory-import': '任务 · 从文本导入记忆',
  'task.chat-summarize': '任务 · 压缩历史',
  'task.card-import': '任务 · 导入角色卡',
  'task.npc-batch': '任务 · 批量生成 NPC',
  'task.char-alt': '任务 · 角色创建小号',
  'task.proactive': '任务 · 主动发起对话',
  'task.vision-describe': '任务 · 识图描述',
  'task.asr-tone': '任务 · 语音转写与语气',
  'task.moment-create': '任务 · 发朋友圈',
  'task.moment-comment': '任务 · 评论动态',
  'task.moment-reply': '任务 · 回复评论',
  'task.scenario-seeds': '任务 · 生成近况',
};

export function TemplatesPage() {
  const s = useStore(db.settings.store);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');

  const open = id => { setEditing(id); setDraft(ai.template(id)); };
  const save = () => {
    db.settings.set({ promptTemplates: { ...s.promptTemplates, [editing]: draft } });
    setEditing(null);
    toast('已保存');
  };
  const reset = async () => {
    if (!await confirm({ title: '恢复默认', message: '该模板将还原为内置版本。' })) return;
    const next = { ...s.promptTemplates };
    delete next[editing];
    db.settings.replace({ ...s, promptTemplates: next });
    setDraft(ai.templates[editing] || '');
    toast('已恢复默认');
  };

  if (editing) {
    return html`
      <${Page} title=${LABELS[editing] || editing} onBack=${() => setEditing(null)}
        right=${html`<button class="nav-text press" onClick=${save}>保存</button>`}>
        <div class="pad">
          <${Textarea} rows=${18} value=${draft} onInput=${setDraft}/>
          <div class="tpl-vars">可用占位符：${(ai.templates[editing] || '').match(/\{\{\w+\}\}/g)?.join(' ') || '无'}</div>
          <${Button} full variant="ghost" onClick=${reset}>恢复默认<//>
        </div>
      <//>`;
  }

  return html`
    <${Page} title="Prompt 模板" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="hint-box">
          这些提示词不写死在代码里。改语气、改风格都在这里改，不需要动代码。
          每条都可以单独恢复默认。
        </div>
      </div>
      <${List}>
        ${Object.keys(ai.templates).map(id => {
          const custom = s.promptTemplates?.[id] && s.promptTemplates[id] !== ai.templates[id];
          return html`
            <${ListItem} key=${id} title=${LABELS[id] || id}
              subtitle=${custom ? '已修改' : '默认'} arrow
              left=${html`<${Icon} name=${id.startsWith('skeleton') ? 'layers' : 'sparkle'} size=${17}/>`}
              onClick=${() => open(id)}/>`;
        })}
      <//>
    <//>`;
}

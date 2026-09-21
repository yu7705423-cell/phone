import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Textarea, Button, Icon, toast, confirm } from '../../../ui/index.js';

const { db, nav, ai } = phone;

const LABELS = {
  'skeleton.opening': '骨架 · 身份开场',
  'skeleton.scene-opening': '线下 · 开场',
  'skeleton.scene-rules': '线下 · 正文规则',
  'skeleton.scene-length': '线下 · 篇幅',
  'skeleton.scene-setup': '线下 · 场次设定',
  'skeleton.scene-director': '线下 · 场外指示',
  'skeleton.scene-style': '线下 · 文风',
  'skeleton.scene-more': '线下 · 续写',
  'skeleton.scene-tail': '线下 · 收尾提醒（贴着输出）',
  'task.scene-summary': '任务 · 线下收场摘要',
  'skeleton.work-opening': '我们 · 开场',
  'skeleton.work-solo': '我们 · 正文规则（整篇它写）',
  'skeleton.work-premise': '我们 · 这部作品',
  'skeleton.work-identity': '我们 · 这部作品里的身份',
  'skeleton.work-chapter': '我们 · 这一篇',
  'skeleton.work-prev': '我们 · 前面各篇的进展',
  'task.work-summary': '任务 · 我们收篇摘要',
  'task.bond': '任务 · 压缩关系底色',
  'task.core': '任务 · 压缩核心设定',
  'skeleton.gender': '骨架 · 性别锚点',
  'skeleton.world': '骨架 · 世界规则抬头',
  'skeleton.rules': '骨架 · 消息规则',
  'skeleton.core': '骨架 · 核心设定',
  'skeleton.sticker': '骨架 · 可用表情',
  'skeleton.quote': '骨架 · 引用某一句',
  'skeleton.time': '骨架 · 先写出时间',
  'skeleton.ban': '骨架 · 不要写这些',
  'skeleton.todo': '骨架 · 待办',
  'skeleton.translate': '骨架 · 顺带给出译文',
  'skeleton.translate-tail': '骨架 · 译文提醒（贴着输出）',
  'task.translate': '任务 · 单独的翻译接口',
  'skeleton.transfer': '骨架 · 转账',
  'skeleton.location': '骨架 · 位置',
  'skeleton.abilities': '骨架 · 能力清单',
  'skeleton.image': '骨架 · 发图片',
  'skeleton.voice': '骨架 · 发语音',
  'skeleton.gift': '骨架 · 送礼物',
  'skeleton.listen': '骨架 · 一起听歌',
  'skeleton.joint': '骨架 · 共同账户与亲属卡',
  'skeleton.pact': '骨架 · 约定',
  'skeleton.inner': '骨架 · 心声（随回复一起）',
  'task.inner': '任务 · 心声（单独生成）',
  'skeleton.pat': '骨架 · 拍一拍',
  'skeleton.dice': '骨架 · 骰子',
  'skeleton.takeout': '骨架 · 点外卖',
  'skeleton.avatar': '骨架 · 换头像',
  'skeleton.letter': '骨架 · 写信',
  'skeleton.ring': '骨架 · 打电话',
  'skeleton.call': '骨架 · 通话中',
  'task.call-open': '任务 · 通话接通后开口',
  'skeleton.group': '骨架 · 群聊说明',
  'task.memory-extract': '任务 · 提取记忆',
  'task.memory-import': '任务 · 从文本导入记忆',
  'task.chat-summarize': '任务 · 压缩历史',
  'task.card-import': '任务 · 导入角色卡',
  'task.npc-batch': '任务 · 批量生成 NPC',
  'task.event-batch': '任务 · 批量生成随机事件',
  'task.day-plan': '任务 · 排当天的日程',
  'task.recipe-batch': '任务 · 批量生成食谱',
  'task.recipe-search': '任务 · 联网搜索吃处',
  'skeleton.agenda': '骨架 · 今天的安排',
  'task.char-alt': '任务 · 角色创建小号',
  'task.proactive': '任务 · 主动发起对话',
  'task.emo': '任务 · 深夜主动发起',
  'task.vision-describe': '任务 · 识图描述',
  'task.face-describe': '任务 · 读取角色外貌',
  'task.asr-tone': '任务 · 语音转写与语气',
  'task.moment-create': '任务 · 发朋友圈',
  'task.moment-comment': '任务 · 评论动态',
  'task.moment-reply': '任务 · 回复评论',
  'task.scenario-seeds': '任务 · 生成近况',
  'skeleton.watch': '骨架 · 一起看',
  'task.watch-outline': '任务 · 影片分段提纲',
  'task.review': '任务 · 看完之后写观后感',
  'skeleton.trip': '骨架 · 出行',
  'task.trip-tickets': '任务 · 联网找票',
  'task.trip-tickets-guess': '任务 · 估算票价',
  'task.trip-plan': '任务 · 联网检索攻略',
  'task.trip-plan-guess': '任务 · 估算攻略',
  'task.shelf-batch': '任务 · 批量生成读过的书',
  'task.impression': '任务 · 一本书留下的印象',
  'task.read-ahead': '任务 · 挑出想评的段落',
  'task.para-one': '任务 · 对某一段的评论',
  'task.para-crew': '任务 · 同读的几个人的评论',
  'task.para-readers': '任务 · 读者们的评论',
  'skeleton.keepphoto': '骨架 · 存图',
  'task.phone-crop': '任务 · 存图时的裁切',
  'task.phone-lock': '任务 · 角色手机的锁屏密码',
  'task.phone-notes': '任务 · 角色手机的备忘录',
  'task.phone-visits': '任务 · 角色手机的浏览记录',
  'task.phone-album': '任务 · 角色手机的相册',
  'task.phone-chats': '任务 · 角色手机的会话列表',
  'task.phone-chat': '任务 · 角色手机里的某段对话',
  'task.phone-reply': '任务 · 角色手机里对方的回复',
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

  // 旧版把整套模板抄进了 settings，迁移 6 把它们挪到了 legacy 里。
  // 那些文本不一定是用户写的，但也不该直接扔掉，所以留一个找回的入口。
  const legacy = s.promptTemplatesLegacy || {};

  if (editing) {
    const old = legacy[editing];
    return html`
      <${Page} title=${LABELS[editing] || editing} onBack=${() => setEditing(null)}
        right=${html`<button class="nav-text press" onClick=${save}>保存</button>`}>
        <div class="pad">
          <${Textarea} rows=${18} value=${draft} onInput=${setDraft}/>
          <div class="tpl-vars">可用占位符：${(ai.templates[editing] || '').match(/\{\{\w+\}\}/g)?.join(' ') || '无'}</div>
          <${Button} full variant="ghost" onClick=${reset}>恢复默认<//>
          ${old && old !== draft ? html`
            <div class="pad-t">
              <${Button} full variant="ghost" onClick=${() => setDraft(old)}>
                载入升级前的版本<//>
              <div class="tpl-vars">升级到新版内置提示词时，此处保留了替换前的文本。</div>
            </div>` : null}
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

      <div class="settings-foot">
        提示词的编写与修订，感谢 啵茶、我厌 两位老师的帮助。
      </div>
    <//>`;
}

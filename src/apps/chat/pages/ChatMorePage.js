import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, Spinner, EmptyState, toast, confirm } from '../../../ui/index.js';

// 会话菜单的二级页。见 ARCHITECTURE 4.166
//
// 会话菜单从前一口气列了二十几行，一屏翻三下才到底。按「用户多久点一次」分开：
// 天天会点的（角色卡、搜索、总结记忆……）留在菜单里；几个月才点一次的
// （所有角色共用的那几页、接口调用的账、导出与清空）收到这里。
// 仍然从这段对话的菜单进来，入口没有换地方，只是深了一层（CLAUDE.md 第 5 条）。

const { db, nav, ai } = phone;

export function ChatMorePage({ chatId }) {
  useStore(db.chats.store);
  useStore(db.characters.store);
  useStore(db.memories.store);
  useStore(db.settings.store);
  useStore(db.stickers.store);
  const [packing, setPacking] = useState(false);

  const chat = db.chats.get(chatId);
  const isGroup = phone.group.isGroup(chat);
  const char = db.characters.get((chat?.characterIds || [])[0]);
  if (!chat || !char) {
    return html`<${Page} title="更多" onBack=${nav.pop}>
      <${EmptyState} title="该会话已不存在"/><//>`;
  }
  const settings = db.settings.get();

  // 只打包这一个角色。整个库那一份是「设置 - 存储」里的完整备份。
  const exportChar = async () => {
    setPacking(true);
    try {
      const blob = await phone.charpack.build(char.id, { history: true });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = phone.charpack.fileNameFor(char.name);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`已导出 ${phone.backup.sizeText(blob.size)}`, 'ok', 4000);
    } catch (err) {
      toast('导出失败：' + (err.message || err), 'error', 5000);
    } finally { setPacking(false); }
  };

  // 清除数据。三样都删不回来，所以数目先在确认框里摆出来，不让用户蒙着点。
  // 作用范围是这个角色名下的全部会话，不只是眼前这一段 —— 说明里写明了。
  const wipe = async which => {
    const n = phone.purge.counts(char.id);
    const act = {
      history: {
        title: '清空聊天记录',
        message: `将删除 ${n.messages} 条消息，其中的图片与语音一并清除。`
          + '已提取的记忆保留。由聊天记录推算出的账目会随之消失。',
        run: () => { phone.purge.clearHistory(char.id); return `已清空 ${n.messages} 条消息`; },
      },
      memory: {
        title: '清空记忆',
        message: `将删除 ${n.memories} 条记忆。聊天记录保留，`
          + '下次总结时会从现有的聊天记录重新提取。',
        run: () => { phone.purge.clearMemories(char.id); return `已清空 ${n.memories} 条记忆`; },
      },
      both: {
        title: '清空记忆与聊天记录',
        message: `将删除 ${n.messages} 条消息与 ${n.memories} 条记忆，`
          + '消息中的图片与语音一并清除。角色卡本身保留。',
        run: () => {
          phone.purge.clearAll(char.id);
          return `已清空 ${n.messages} 条消息、${n.memories} 条记忆`;
        },
      },
    }[which];
    if (!await confirm({ title: act.title, message: act.message, danger: true })) return;
    toast(act.run(), 'ok');
    // 清完回到会话，那里正是被清掉的东西，一眼看得到结果
    nav.pop();
  };

  // counts 要把这个角色名下所有会话的消息过一遍，estimate 要扫几域。
  // 这一页不订阅消息，所以只在进来时算一遍，不会每来一条消息重算
  const wipeN = isGroup ? null : phone.purge.counts(char.id);
  const packN = isGroup ? null : phone.charpack.estimate(char.id);

  return html`
    <${Page} title="更多" onBack=${nav.pop}>
      <${List} title="所有角色通用">
        <${ListItem} title="上下文与记忆" subtitle="注入顺序、扫描窗口、历史范围、自动总结" arrow multiline
          left=${html`<${Icon} name="layers" size=${18}/>`}
          onClick=${() => nav.push('/context')}/>
        <${ListItem} title="表情包" subtitle=${`共 ${db.stickers.count()} 个，所有角色共用`} arrow multiline
          left=${html`<${Icon} name="image" size=${18}/>`}
          onClick=${() => nav.push('/stickers')}/>
        <${ListItem} title="能力开关" arrow multiline
          subtitle=${(() => {
            const list = ai.caps.switchable();
            const off = ai.caps.offSet(settings);
            const n = list.length - list.filter(c => off.has(c.id)).length;
            return `已开启 ${n} / ${list.length} 项。关闭的不会写进 prompt`;
          })()}
          left=${html`<${Icon} name="filter" size=${18}/>`}
          onClick=${() => nav.push('/caps')}/>
        <${ListItem} title="Prompt 模板" subtitle="骨架与各任务的提示词" arrow multiline
          left=${html`<${Icon} name="sparkle" size=${18}/>`}
          onClick=${() => nav.push('/templates')}/>
      <//>

      <${List} title="用量">
        <${ListItem} title="每轮的接口调用" arrow multiline
          subtitle=${(() => {
            const n = ai.cost.perTurn(chatId);
            const worst = ai.cost.worstPerTurn(chatId);
            const head = n > 1
              ? `这段对话每轮固定调用 ${n} 次接口`
              : '这段对话每轮调用 1 次接口';
            // 重试与换套相乘，失败那一轮的数目和顺利时不是一回事
            const tail = worst > n ? `，请求失败时最多 ${worst} 次` : '';
            return `${head}${tail}${n > 1 || worst > n
              ? '。点击查看是哪几项，并可逐项关闭' : ''}`;
          })()}
          left=${html`<${Icon} name="filter" size=${18}/>`}
          onClick=${() => phone.intent.open('settings', { route: '/limits', back: true })}/>
      <//>

      ${isGroup ? null : html`
      <${List} title="数据">
        <${ListItem} title=${packing ? '正在打包' : '导出这个角色'} arrow multiline
          subtitle=${[
            `${packN.chats} 段会话、${packN.messages} 条消息、${packN.memories} 条记忆`,
            packN.scenes ? `${packN.scenes} 场线下` : '',
            packN.skins ? `${packN.skins} 份美化` : '',
            packN.extras ? `${packN.extras} 条其余记录` : '',
            packN.images ? `${packN.images} 张图片` : '',
            packN.files ? `${packN.files} 段语音` : '',
          ].filter(Boolean).join('、') + '。整库备份在「设置 - 存储」'}
          left=${packing
            ? html`<${Spinner} size=${16}/>`
            : html`<${Icon} name="download" size=${18}/>`}
          onClick=${() => !packing && exportChar()}/>
        <${ListItem} title="导入角色" arrow multiline
          subtitle="装回上面导出的压缩包，或从一份资料整理出新角色。与「联系」右上角的入口是同一页"
          left=${html`<${Icon} name="upload" size=${18}/>`}
          onClick=${() => phone.intent.open('contact', { route: '/import', back: true })}/>
        <${ListItem} title="清空聊天记录" danger arrow multiline
          subtitle=${wipeN.chats > 1
            ? `${wipeN.messages} 条消息，分布在 ${wipeN.chats} 段会话中。已提取的记忆保留`
            : `${wipeN.messages} 条消息。已提取的记忆保留`}
          left=${html`<${Icon} name="trash" size=${18}/>`}
          onClick=${() => wipe('history')}/>
        <${ListItem} title="清空记忆" danger arrow multiline
          subtitle=${`${wipeN.memories} 条记忆。聊天记录保留`}
          left=${html`<${Icon} name="brain" size=${18}/>`}
          onClick=${() => wipe('memory')}/>
        <${ListItem} title="清空记忆与聊天记录" danger arrow multiline
          subtitle="两者一并删除，角色卡本身保留"
          left=${html`<${Icon} name="close" size=${18}/>`}
          onClick=${() => wipe('both')}/>
      <//>
      <div class="settings-foot">
        清除操作针对该角色名下的全部内容。同一角色与多个身份分别聊过的，
        各段会话与各身份下的记忆都会被清除。角色卡、世界书关联与各项设置不受影响。
      </div>`}
    <//>`;
}

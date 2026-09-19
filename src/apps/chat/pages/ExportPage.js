import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, Spinner, EmptyState, toast } from '../../../ui/index.js';

const { db, nav, charpack } = phone;

const fmtSize = b => b < 1024 ? `${b} B`
  : b < 1048576 ? `${(b / 1024).toFixed(1)} KB`
  : `${(b / 1048576).toFixed(1)} MB`;

/**
 * 把**一个角色**打包带走。
 *
 * 和「设置 - 存储」里那个备份是两件事，别混：
 *   那边  整个库。所有角色、所有会话、曲库片库、外观，全都在里面
 *   这里  只有这一个角色，以及与它相关的东西
 * 所以这一页的字里不出现「完整」二字 —— 那个词在这个项目里已经归整库备份了。
 */
export function ExportPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.chats.store);
  useStore(db.messages.store);
  useStore(db.memories.store);
  const [busy, setBusy] = useState('');
  const char = db.characters.get(charId);

  if (!char) {
    return html`<${Page} title="导出角色" onBack=${nav.pop}>
      <${EmptyState} title="该角色已被删除"/><//>`;
  }

  const sum = charpack.estimate(charId);

  const save = async history => {
    setBusy(history ? 'all' : 'card');
    try {
      const blob = await charpack.build(charId, { history });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = charpack.fileNameFor(char.name);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`已导出 ${fmtSize(blob.size)}`, 'ok', 4000);
    } catch (err) {
      toast('导出失败：' + (err.message || err), 'error', 5000);
    } finally { setBusy(''); }
  };

  const icon = (name, on) => (on ? html`<${Spinner} size=${16}/>` : html`<${Icon} name=${name} size=${18}/>`);

  return html`
    <${Page} title=${`导出 ${char.name}`} onBack=${nav.pop}>
      <${List} title="打包内容">
        <${ListItem} title=${busy === 'all' ? '正在打包' : '该角色的全部数据'} arrow multiline
          subtitle=${`角色卡${sum.alts ? `、${sum.alts} 个小号` : ''}`
            + `${sum.books ? `、${sum.books} 本关联世界书` : ''}`
            + `，以及与该角色的 ${sum.chats} 段会话、${sum.messages} 条消息、`
            + `${sum.memories} 条记忆，${sum.images} 张图片`
            + `${sum.files ? `、${sum.files} 个音频` : ''}。用于更换设备。`}
          left=${icon('database', busy === 'all')}
          onClick=${() => !busy && save(true)}/>
        <${ListItem} title=${busy === 'card' ? '正在打包' : '仅角色卡'} arrow multiline
          subtitle=${`只含人设、开场白${sum.books ? '、关联世界书' : ''}与各类图片，`
            + '不含聊天记录与记忆。用于发送给他人。'}
          left=${icon('user', busy === 'card')}
          onClick=${() => !busy && save(false)}/>
      <//>

      <div class="settings-foot">
        两者均只包含与该角色相关的数据，其他角色不在其中。
        接口地址与密钥不进入导出文件。<br/>
        导入在「联系」右上角的「导入角色」。
        需要连同其他角色、曲库与外观一并备份时，使用「设置 - 存储」中的完整备份。
      </div>
    <//>`;
}

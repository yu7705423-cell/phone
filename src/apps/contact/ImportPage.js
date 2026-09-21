import { html, useState, useRef } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Button, Icon, Spinner, toast, confirm } from '../../ui/index.js';

const { db, nav, ai, charpack } = phone;
const card = ai.card;
const ACCEPT = '.txt,.md,.docx';

// 导入一个角色。角色包是无损的那一条，所以排在「从资料整理」前面。
export function ImportPage() {
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState(null);
  const fileRef = useRef(null);
  const packRef = useRef(null);

  // read 只解包不动库，看一眼再装
  const pickPack = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const pack = await charpack.read(file);
      const lines = [
        pack.history
          ? `含 ${pack.chats} 段会话、${pack.messages} 条消息、${pack.memories} 条记忆`
          : '只含角色卡，不含聊天记录与记忆',
        pack.scenes ? `含 ${pack.scenes} 场线下` : '',
        pack.works ? `含 ${pack.works} 部「我们」里的作品` : '',
        pack.skins ? `含 ${pack.skins} 份美化，仅在带进来的会话里生效` : '',
        pack.extras ? `含 ${pack.extras} 条其余记录（出行、动态、日程、那台手机等）` : '',
        pack.alts ? `含 ${pack.alts} 个小号` : '',
        pack.books ? `含 ${pack.books} 本关联世界书，本机已有同名的保持不变` : '',
        pack.exists ? '本机已有同一个角色，将另建一个副本，原有的不受影响' : '',
        pack.history ? '会话与记忆将归入当前账号名下' : '',
      ].filter(Boolean);
      if (!await confirm({ title: `导入「${pack.name}」`, okText: '导入',
        message: lines.join('。') + '。' })) return;
      const got2 = await charpack.install(pack);
      // 影评与段评指着本机没有的书或片子，落不下去
      toast(`已导入 ${pack.name}${got2.copied ? '（副本）' : ''}`
        + (got2.dropped ? `。${got2.dropped} 条书评与段评所指的书籍或影片不在本机，未导入` : ''),
      'ok', got2.dropped ? 6000 : 4000);
      nav.replace(`/char/${got2.charId}`);
    } catch (err) {
      toast(String(err.message || err), 'error', 6000);
    } finally { setBusy(false); }
  };

  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ai.isConfigured()) { toast('尚未配置聊天接口，无法解析', 'error', 4000); return; }
    setBusy(true); setGot(null);
    try {
      setGot(await card.parseCard(file));
    } catch (err) {
      toast(String(err.message || err), 'error', 6000);
    } finally { setBusy(false); }
  };

  const save = async () => {
    const c = db.characters.create({
      name: got.name, age: got.age, gender: got.gender, birthday: got.birthday,
      signature: got.signature, persona: got.persona, scenario: got.scenario,
      firstMessage: got.firstMessage, exampleDialogue: got.exampleDialogue,
      relations: [], lorebookIds: [], canSendVoice: true, canSendImage: true,
    });
    toast(`已创建 ${c.name}`, 'ok');
    nav.replace(`/profile/${c.id}`);
    // 核心设定另跑一次，不挡着建角色。失败也不提示：
    // 角色已经建好了，这一段随时可以在编辑资料里自己写或者重新生成。
    if (db.settings.get().coreAuto !== false && got.persona) {
      card.makeCore(got.persona)
        .then(core => { if (core) db.characters.update(c.id, { core }); })
        .catch(err => console.warn('[card] 核心设定没生成:', err.message || err));
    }
  };

  const rows = got ? [
    ['名字', got.name], ['年龄', got.age], ['性别', got.gender], ['生日', got.birthday],
    ['签名', got.signature], ['人设', got.persona], ['情境', got.scenario],
    ['开场白', got.firstMessage], ['说话示例', got.exampleDialogue],
  ].filter(([, v]) => v) : [];

  return html`
    <${Page} title="导入角色" onBack=${nav.pop}>
      ${got ? html`
        <div class="hint-box">
          以下为解析结果。未填写的字段保持为空，不会补充内容。
          确认后创建角色，并自动生成一份核心设定，可在编辑资料中修改。
        </div>
        <${List}>
          ${rows.map(([k, v]) => html`
            <${ListItem} key=${k} title=${k} subtitle=${v} multiline/>`)}
        <//>
        <div class="pad batch-acts">
          <${Button} onClick=${save}>建成角色<//>
          <${Button} variant="ghost" onClick=${() => setGot(null)}>换一份<//>
        </div>
      ` : html`
        <${List} title="角色包">
          <${ListItem} title="选择角色包" arrow multiline
            subtitle=${'在会话右上角的「导出这个角色」中导出的压缩包，只含一个角色及其相关数据。'
              + '原样装回去，不经过模型，也不消耗接口调用。'}
            left=${html`<${Icon} name="download" size=${18}/>`}
            onClick=${() => !busy && packRef.current?.click()}/>
        <//>

        <div class="list-title">从资料整理</div>
        <div class="pad-x">
          <${Field} label="选一个文件"
            desc="支持 txt、md、docx。直接粘贴整段资料即可，无需排版。">
            <${Button} full variant="ghost" icon="upload" disabled=${busy}
              onClick=${() => fileRef.current?.click()}>
              ${busy ? html`<${Spinner} size=${15}/> 正在读` : '选文件'}
            <//>
          <//>
        </div>
        <div class="settings-foot">
          整理用的是聊天接口那个模型。<br/>
          资料里没写的字段会留空，不会自己编。<br/>
          恢复包含全部角色、曲库与外观的整库备份，使用「设置 - 存储」中的导入。
        </div>
      `}
      <input type="file" accept=${ACCEPT} ref=${fileRef} onChange=${pick} style="display:none"/>
      <input type="file" accept=".zip" ref=${packRef} onChange=${pickPack} style="display:none"/>
    <//>`;
}

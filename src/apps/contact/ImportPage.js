import { html, useState, useRef } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Button, Icon, Spinner, toast } from '../../ui/index.js';

const { db, nav, ai } = phone;
const card = ai.card;
const ACCEPT = '.txt,.md,.docx';

// 把一份 txt / docx 资料读成一张角色卡。
// 先解析给你看，确认了再建角色。
export function ImportPage() {
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState(null);
  const fileRef = useRef(null);

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
    <${Page} title="导入角色卡" onBack=${nav.pop}>
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
        <div class="pad-x pad-t">
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
          资料里没写的字段会留空，不会自己编。
        </div>
      `}
      <input type="file" accept=${ACCEPT} ref=${fileRef} onChange=${pick} style="display:none"/>
    <//>`;
}

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
    if (!ai.isConfigured()) { toast('还没配聊天接口，整理不了', 'error', 4000); return; }
    setBusy(true); setGot(null);
    try {
      setGot(await card.parseCard(file));
    } catch (err) {
      toast(String(err.message || err), 'error', 6000);
    } finally { setBusy(false); }
  };

  const save = () => {
    const c = db.characters.create({
      name: got.name, age: got.age, gender: got.gender, birthday: got.birthday,
      signature: got.signature, persona: got.persona, scenario: got.scenario,
      firstMessage: got.firstMessage, exampleDialogue: got.exampleDialogue,
      relations: [], lorebookIds: [], canSendVoice: true, canSendImage: true,
    });
    toast(`建好了 ${c.name}`, 'ok');
    nav.replace(`/profile/${c.id}`);
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
          读出来是这样。没写的字段会留空，不会瞎编。确认了就建角色。
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
            desc="支持 txt、md、docx。整段资料丢进来就行，不用自己排版">
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

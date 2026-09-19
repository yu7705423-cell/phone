import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Switch, Button, Icon } from '../../../ui/index.js';

const { db, nav, ai } = phone;
const caps = ai.caps;

// 能力开关。
//
// 关掉的那几样**一个字都不进 prompt** —— 不是「写进去但叫它别用」。
// 想要的只是聊天加几样常用功能时，二十来段功能说明堆在人设后面，
// 模型的注意力就被摊薄了，聊天本身反而写不好。
//
// 这是全局的：它决定 prompt 里有什么，不是某个角色的性格。
// 某个角色单独不许发图那种，在角色卡上（第 5 条）。
export function CapsPage() {
  useStore(db.settings.store);
  const s = db.settings.get();
  const off = caps.offSet(s);
  const list = caps.switchable();
  const onCount = list.length - list.filter(c => off.has(c.id)).length;

  const set = (id, want) => {
    const next = new Set(off);
    if (want) next.delete(id); else next.add(id);
    db.settings.set({ capsOff: [...next] });
  };

  const all = want => db.settings.set({
    capsOff: want ? [] : list.map(c => c.id),
  });

  return html`
    <${Page} title="能力开关" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="hint-box">
          关闭的能力不会写进 prompt，角色也就不知道有这回事。
          只想聊天时把用不到的关掉，模型的注意力不必分给二十段功能说明。<br/>
          这里是对所有角色生效的。只让某一个角色不发图、不发语音，
          在该角色的角色卡中设置。
        </div>
        <div class="batch-acts pad-b">
          <${Button} size="sm" variant="ghost" onClick=${() => all(true)}>全部开启<//>
          <${Button} size="sm" variant="ghost" onClick=${() => all(false)}>全部关闭<//>
        </div>
      </div>

      <${List} title=${`已开启 ${onCount} / ${list.length}`}>
        ${list.map(c => html`
          <${ListItem} key=${c.id} title=${c.label || c.id}
            right=${html`<${Switch} checked=${!off.has(c.id)}
              onChange=${v => set(c.id, v)}/>`}/>`)}
      <//>

      <${List} title="始终开启">
        ${caps.CAPS.filter(c => caps.PROTOCOL.has(c.id)).map(c => html`
          <${ListItem} key=${c.id} title=${c.label || c.id} multiline
            subtitle="这一项是解析协议的一部分，关闭后本地读不出模型写的那几行"
            left=${html`<${Icon} name="lock" size=${18}/>`}/>`)}
      <//>

      <div class="settings-foot">
        关闭某项不会删除已有的记录。此前发出的图片、语音、转账都不受影响。
      </div>
    <//>`;
}

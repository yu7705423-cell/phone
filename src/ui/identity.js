import { html, useState } from '../lib.js';
import { Field, Input, Textarea, Button, Spinner } from './basic.js';
import { FullSheet, toast } from './overlay.js';

// 「在这部作品 / 这一场里的身份」：名字、人设，加一个「按世界改写」（ARCHITECTURE 4.283）。
//
// 只画界面，不碰数据：改写那一次请求由调用方给（onGenerate 回一个 { name, persona }）。
// 改写回来的先在一张页上给用户看、改，点「存入」才交回去 —— 这是第 6 条允许人设正文露面的那种确认页。
export function IdentityFields({ who, name, persona, onChange, onGenerate, canGenerate = true }) {
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState(null);
  const label = who === 'me' ? '我' : '角色';
  const generate = async () => {
    if (!onGenerate) return;
    setBusy(true);
    try { setMade(await onGenerate()); }
    catch (err) { toast(String(err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };
  return html`
    <${Field} label=${`${label}在这里的名字`}
      desc=${who === 'me' ? '留空表示沿用当前账号的名字。' : '留空表示沿用角色卡上的名字。'}>
      <${Input} value=${name || ''} onInput=${x => onChange({ name: x })}/>
    <//>
    <${Field} label=${`${label}在这里是谁`}
      desc=${who === 'me' ? '留空表示沿用当前账号的人设。写了就在这里替代它。' : '留空表示沿用角色卡上的人设。写了就在这里替代它。'}>
      <${Textarea} rows=${4} value=${persona || ''} onInput=${x => onChange({ persona: x })}/>
    <//>
    ${onGenerate ? html`
      <div class="pad-b">
        <${Button} full variant="ghost" disabled=${busy || !canGenerate} onClick=${generate}>
          ${busy ? html`<${Spinner} size=${14}/>` : '按这里的世界改写（调用一次接口）'}
        <//>
        <div class="field-desc pad-t">按原来的人设与这里的世界、简介、世界书改写：性格、说话方式与两人的关系不变，职业、出身、时代物件按世界改。改写结果先显示出来，确认后才存入。</div>
      </div>` : null}
    <${FullSheet} open=${!!made} onClose=${() => setMade(null)} title=${`${label}在这里的身份`}
      right=${html`<${Button} size="sm" onClick=${() => { onChange({ name: made.name, persona: made.persona }); setMade(null); toast('已存入', 'ok'); }}>存入<//>`}>
      <div class="pad">
        <${Field} label="名字">
          <${Input} value=${made?.name || ''} onInput=${x => setMade(m => ({ ...m, name: x }))}/>
        <//>
        <${Field} label="人设" desc="可以先改再存入。不存入则原样不动。">
          <${Textarea} rows=${16} value=${made?.persona || ''} onInput=${x => setMade(m => ({ ...m, persona: x }))}/>
        <//>
      </div>
    <//>`;
}

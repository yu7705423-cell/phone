import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Switch, Segmented } from '../../../ui/index.js';

const { db, nav } = phone;

// 常见的几个，够挑就行；要别的直接填
const COMMON = ['中文', '英文', '日文', '韩文', '法文', '德文', '西班牙文', '俄文'];

const OPEN_MODES = [
  { value: 'tap', label: '点击展开' },
  { value: 'always', label: '默认展开' },
];

export function TranslatePage({ chatId }) {
  useStore(db.chats.store);
  const s = useStore(db.settings.store);
  const [draft, setDraft] = useState(null);
  const chat = db.chats.get(chatId);
  if (!chat) return html`<${Page} title="翻译" onBack=${nav.pop}/>`;

  const lang = chat.translateTo || '';
  const on = !!lang;
  const set = patch => db.chats.update(chatId, patch);

  return html`
    <${Page} title="翻译" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title="翻译这段对话" multiline
          subtitle=${on
            ? `角色每说一条，同时给出${lang}译文。译文收在气泡里，不占额外消息`
            : '开启后，角色每说一条会同时给出译文。原文照常按角色自己的语言写'}
          right=${html`<${Switch} checked=${on}
            onChange=${v => { setDraft(null); set({ translateTo: v ? (draft || '中文') : '' }); }}/>`}/>
      <//>

      ${on ? html`
        <div class="pad">
          <${Field} label="译成什么语言" desc="填写语言名称。列表以外的语言可直接填写，例如「粤语」「文言文」。">
            <${Input} value=${draft ?? lang} placeholder="中文"
              onInput=${v => { setDraft(v); if (v.trim()) set({ translateTo: v.trim() }); }}
              onBlur=${() => setDraft(null)}/>
            <div class="chip-row pad-t">
              ${COMMON.map(x => html`
                <button key=${x} class=${`chip${lang === x ? ' is-active' : ''}`}
                  onClick=${() => { setDraft(null); set({ translateTo: x }); }}>${x}</button>`)}
            </div>
          <//>
        </div>

        <div class="pad-x">
          <${Field} label="译文怎么显示"
            desc=${s.translateOpen === 'always'
              ? '译文直接显示在原文下方。'
              : '译文默认收起，点击气泡展开，再次点击收起。'}>
            <${Segmented} value=${s.translateOpen === 'always' ? 'always' : 'tap'}
              items=${OPEN_MODES}
              onChange=${v => db.settings.set({ translateOpen: v })}/>
          <//>
        </div>
        <div class="settings-foot">
          显示方式对所有对话生效，语言只对这一段对话生效。
          开启前已经发出的消息没有译文，需要重新生成才会带上。
        </div>` : null}
    <//>`;
}

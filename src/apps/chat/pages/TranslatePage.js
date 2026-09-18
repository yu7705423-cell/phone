import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Switch, Segmented } from '../../../ui/index.js';

const { db, nav, ai } = phone;

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
  // 译文从哪儿来是全局的事，在「设置 - 翻译」里选。这里只如实说明当前走的是哪条路
  const byApi = ai.translate.ready();

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
          <${Field} label="额外的翻译要求"
            desc=${byApi
              ? '写明这段对话的译文需要遵循的用语习惯，例如地区用语、称呼的处理方式、'
                + '专有名词是否保留原文。该内容会随原文一并发送给翻译接口。留空则只按通用规则翻译。'
              : '当前译文由聊天模型在生成回复时一并给出，此项不生效。'
                + '在「设置 - 翻译」中改用单独的翻译接口后生效。'}>
            <${Textarea} rows=${3} value=${chat.translateRules || ''}
              placeholder="例如：保留原文中的称呼，不要替换为译文语言的习惯称呼"
              onInput=${v => set({ translateRules: v })}/>
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
          显示方式对所有对话生效，语言与额外要求只对这一段对话生效。
          开启前已经发出的消息没有译文，需要重新生成才会带上。<br/>
          ${byApi
            ? '当前译文由单独的翻译接口生成，该接口只收到原文与翻译规则，不接收角色人设与对话历史。'
            : '当前译文由聊天模型在生成回复时一并给出，不额外调用接口。'
              + '在「设置 - 翻译」中可改为单独的翻译接口。'}
        </div>` : null}
    <//>`;
}

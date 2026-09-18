import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Segmented, toast } from '../../ui/index.js';

const { db, nav, ai } = phone;
const svc = ai.services;

// 单独的翻译接口。
//
// 这一页只管「译文从哪儿来」。译成什么语言是每段对话自己的事，
// 在那段对话右上角的「翻译」里填（CLAUDE.md 第 5 条）。

const MODES = [
  { value: 'inline', label: '跟着回复一起给出' },
  { value: 'api', label: '单独的接口' },
];

const SAMPLE = ['English', '日本語', '한국어'];

export function TranslateApiPage() {
  useStore(db.settings.store);
  const [testing, setTesting] = useState(false);
  const [lang, setLang] = useState('English');
  const [result, setResult] = useState('');
  const v = svc.translateConfig();
  const set = patch => svc.setTranslate(patch);
  const mode = v.mode === 'api' ? 'api' : 'inline';

  const run = async () => {
    setTesting(true);
    setResult('');
    try {
      setResult(await ai.translate.test(lang));
      toast('翻译成功', 'ok');
    } catch (err) {
      toast(String(err.message || err), 'error', 6000);
    } finally { setTesting(false); }
  };

  return html`
    <${Page} title="翻译" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="译文从哪儿来"
          desc=${mode === 'api'
            ? '每轮回复另外调用一次下面这套接口，只发送原文与翻译规则。'
              + '角色人设、记忆与对话历史不会发送给它。费用与聊天接口分开计算。'
            : '由聊天模型在生成回复时一并给出，不额外调用接口，也不额外计费。'
              + '该模型在生成译文时同时读到了人设与对话历史，译文会带上角色的语气。'}>
          <${Segmented} value=${mode} items=${MODES} onChange=${m => set({ mode: m })}/>
        <//>
      </div>

      ${mode !== 'api' ? null : html`
      <div class="pad">
        <${Field} label="接口地址" desc="OpenAI 兼容的 chat/completions 端点。留空则使用 https://api.openai.com/v1。中转站填写至 /v1 为止。">
          <${Input} value=${v.baseUrl} onInput=${x => set({ baseUrl: x })}
            placeholder="https://api.openai.com/v1"/>
        <//>

        <${Field} label="API Key" desc="仅保存在本设备的浏览器中。">
          <${Input} type="password" value=${v.apiKey} onInput=${x => set({ apiKey: x })}
            placeholder="sk-..."/>
        <//>

        <${Field} label="模型"
          desc="翻译不需要长上下文，可以选用比聊天接口更小、更便宜的模型。">
          <${Input} value=${v.model} onInput=${x => set({ model: x })} placeholder="模型名称"/>
        <//>
      </div>

      <${List} title="测试">
        <${ListItem} title="试译一句" multiline
          subtitle=${testing ? '翻译中' : '原文为「今天天气很好，适合出门走走。」，结果不会存入任何会话'}
          arrow onClick=${() => !testing && run()}/>
      <//>

      <div class="pad">
        <${Field} label="译成什么语言" desc="仅用于本次测试，不影响各段对话的设置。">
          <${Input} value=${lang} onInput=${setLang} placeholder="English"/>
          <div class="chip-row pad-t">
            ${SAMPLE.map(x => html`
              <button key=${x} class=${`chip${lang === x ? ' is-active' : ''}`}
                onClick=${() => setLang(x)}>${x}</button>`)}
          </div>
        <//>
      </div>

      ${result ? html`
        <div class="pad">
          <div class="fix-preview">${result}</div>
        </div>` : null}

      <div class="pad">
        <${Button} full variant="ghost"
          onClick=${() => { set({ apiKey: '', model: '', baseUrl: '' }); setResult(''); toast('已清空'); }}>
          清空配置<//>
      </div>

      <div class="settings-foot">
        翻译规则在会话右上角「Prompt 模板」的 task.translate 中修改。
        这套接口只会收到待翻译的原文、译文语言，以及该会话中额外填写的翻译要求。
      </div>`}
    <//>`;
}

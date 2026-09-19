import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Button, Segmented, toast } from '../../ui/index.js';
import { ApiSource } from './ApiSource.js';

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

  // 行内译文。用自己模板的人写的形状五花八门，让他自己描述一遍
  const [probe, setProbe] = useState('');
  const forms = String(db.settings.get().translateFormats || '');
  const setForms = v => db.settings.set({ translateFormats: v });
  const addForm = tpl => setForms(forms.trim() ? `${forms.trim()}\n${tpl}` : tpl);
  // 编好的那几条正则。名字不要和上面那个 forms（文本框里的原文）撞
  const shapes = ai.translate.compiled();
  const split = probe.trim() ? ai.translate.splitInline(probe, shapes) : null;
  const tline = probe.trim() && !split ? ai.translate.transLine(probe, shapes) : null;
  const bad = ai.translate.formats().filter(f => !ai.translate.compileFormat(f));

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

      ${mode === 'api' ? null : html`
      <div class="pad-x">
        <${Field} label="行内译文的形状"
          desc=${'内置模板让角色把译文写成带标签的一行。如果你自己改过提示词，'
            + '在这里描述实际的形状，一行一种，可以写多种。其余字符按原样匹配，'
            + '留空则不作此项识别。两种写法：'
            + `同一行填 ${ai.translate.SLOT_SRC}${ai.translate.SLOT_OUT} 两个记号；`
            + `译文单独成行只填 ${ai.translate.SLOT_OUT} 一个记号，该行整行视为译文，`
            + '归入上一条消息。'}>
          <${Textarea} value=${forms} rows=${3}
            placeholder=${ai.translate.FORMAT_PRESETS[0]}
            onInput=${setForms}/>
        <//>
        <div class="chip-row">
          ${ai.translate.FORMAT_PRESETS.map(t => html`
            <button key=${t} class="chip" onClick=${() => addForm(t)}>${t}</button>`)}
        </div>
        ${bad.length ? html`
          <div class="settings-foot">
            以下几行无法识别，已忽略：${bad.join('、')}。
            每行需要恰好各出现一次 ${ai.translate.SLOT_SRC} 与 ${ai.translate.SLOT_OUT}。
          </div>` : null}

        <${Field} label="试一试"
          desc="粘贴角色实际回复中的一行，确认是否按预期拆分。">
          <${Input} value=${probe} placeholder="他说（He said）"
            onInput=${setProbe}/>
        <//>
        ${probe.trim() ? html`
          <div class="settings-foot">
            ${split ? html`原文：${split.text}<br/>译文：${split.translation}`
              : tline ? html`整行为译文：${tline}<br/>将归入上一条消息`
              : '这一行不符合上面任何一种形状，将按正文原样显示。'}
          </div>` : null}
      </div>
      <div class="settings-foot">
        识别出来的译文收在气泡里，与单独一行的写法一致：点原文展开。<br/>
        这项识别有代价：一句正常的「他笑了（大概吧）」同样符合「原文（译文）」的
        形状，也会被拆开。「译文单独成行」那一类代价更大：整行的动作描写
        「（她笑了笑）」与它完全相同，也会被归为译文。只在确实改过提示词时填写。
      </div>`}

      ${mode !== 'api' ? null : html`
      <${ApiSource} cfg=${v} set=${set}/>

      <div class="pad">
        ${v.endpointId ? null : html`
<${Field} label="接口地址" desc="OpenAI 兼容的 chat/completions 端点。留空则使用 https://api.openai.com/v1。中转站填写至 /v1 为止。">
          <${Input} value=${v.baseUrl} onInput=${x => set({ baseUrl: x })}
            placeholder="https://api.openai.com/v1"/>
        <//>

        <${Field} label="API Key" desc="仅保存在本设备的浏览器中。">
          <${Input} type="password" value=${v.apiKey} onInput=${x => set({ apiKey: x })}
            placeholder="sk-..."/>
        <//>
        `}
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

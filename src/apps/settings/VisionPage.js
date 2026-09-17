import { html, useState, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Segmented, toast } from '../../ui/index.js';

const { db, nav, ai } = phone;
const svc = ai.services;

const MODES = [
  { value: 'off', label: '关闭' },
  { value: 'chat', label: '交给聊天模型' },
  { value: 'api', label: '单独的接口' },
];

export function VisionPage() {
  useStore(db.settings.store);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState('');
  const fileRef = useRef(null);
  const v = svc.visionConfig();
  const set = patch => svc.setVision(patch);

  const test = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setTesting(true);
    setResult('');
    try {
      const dataUrl = await phone.audio.toDataUrl(file);
      const text = await ai.vision.describe({ dataUrl, key: `vision-test:${Date.now()}` });
      setResult(text);
      toast('识别成功', 'ok');
    } catch (err) {
      toast(String(err.message || err), 'error', 6000);
    } finally { setTesting(false); }
  };

  const mode = svc.visionMode();

  return html`
    <${Page} title="识图" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="图片怎么让角色看见"
          desc=${mode === 'chat'
            ? '图片随当前这一轮的请求直接发给聊天模型。模型看过之后，由同一个模型把图写成一段描述存回消息，此后各轮只带这段描述，不再重复传图。要求聊天模型本身能看图，否则请求会报错。'
            : mode === 'api'
              ? '图片先交给下面这套接口读成一段描述，描述随消息一起进入上下文。聊天模型本身不能看图时用这一档。'
              : '不识别。图片仍可正常发送与查看，角色只知道你发了一张图，不知道图上有什么。'}>
          <${Segmented} value=${mode} items=${MODES}
            onChange=${m => set({ mode: m })}/>
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

        <${Field} label="模型" desc="须为能看图的多模态模型。填写模型名称，例如 gpt-4o-mini 或中转站提供的同类模型。">
          <${Input} value=${v.model} onInput=${x => set({ model: x })} placeholder="模型名称"/>
        <//>
      </div>

      <${List} title="测试">
        <${ListItem} title="选择一张图片进行测试" multiline
          subtitle=${testing ? '识别中' : '结果只用于验证接口，不会存入任何会话'}
          arrow onClick=${() => !testing && fileRef.current?.click()}/>
      <//>
      <input type="file" accept="image/*" ref=${fileRef} onChange=${test} style="display:none"/>

      ${result ? html`
        <div class="pad">
          <div class="fix-preview">${result}</div>
        </div>` : null}

      <div class="pad">
        <${Button} full variant="ghost"
          onClick=${() => { set({ apiKey: '', model: '', baseUrl: '' }); setResult(''); toast('已清空'); }}>
          清空配置<//>
      </div>`}
    <//>`;
}

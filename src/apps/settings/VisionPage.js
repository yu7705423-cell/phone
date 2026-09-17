import { html, useState, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, toast } from '../../ui/index.js';

const { db, nav, ai } = phone;
const svc = ai.services;

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

  return html`
    <${Page} title="识图" onBack=${nav.pop}>
      <div class="settings-foot">
        聊天接口只收文字，角色看不到你发的图片。配置识图接口后，
        图片会先被读成一段描述，描述随消息一起进入上下文。
        未配置时图片仍可正常发送与查看，角色只是不知道图上有什么。
      </div>

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
      </div>
    <//>`;
}

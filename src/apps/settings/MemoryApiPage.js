import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Segmented, toast } from '../../ui/index.js';

const { db, nav, ai } = phone;
const svc = ai.services;

// 记忆整理那几件单独用哪套接口。
//
// 它们是量最大也最不着急的一批：一段长对话压一次摘要，输入动辄上万字，
// 而结果没有人在盯着等。值得单独挑一个便宜模型。

const MODES = [
  { value: 'spare', label: '跟随副用接口' },
  { value: 'api', label: '单独的接口' },
];

export function MemoryApiPage() {
  useStore(db.settings.store);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState('');
  const v = svc.memoryConfig();
  const set = patch => svc.setMemory(patch);
  const mode = v.mode === 'api' ? 'api' : 'spare';

  const run = async () => {
    setTesting(true);
    setResult('');
    try {
      const out = await ai.runWithPreset(
        { id: 'memory', name: '记忆接口', ...v },
        { system: 'Reply with the single word OK.', user: 'ping', maxTokens: 16 });
      setResult(String(out || '').trim() || '（接口返回了空内容）');
      toast('连接成功', 'ok');
    } catch (err) {
      toast(String(err.message || err), 'error', 6000);
    } finally { setTesting(false); }
  };

  return html`
    <${Page} title="记忆接口" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="记忆整理走哪套接口"
          desc=${mode === 'api'
            ? '自动总结记忆、压缩关系底色、从文本导入记忆、历史压缩这四项走下面这套接口，其余后台任务仍走副用接口。'
            : '与其余后台任务一同走副用接口。副用接口未配置时退回主用接口。'}>
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
          desc="这几项输入长、输出短，且无人等待结果，可以选用比对话接口更便宜的模型。须支持较长的上下文。">
          <${Input} value=${v.model} onInput=${x => set({ model: x })} placeholder="模型名称"/>
        <//>
      </div>

      <${List} title="测试">
        <${ListItem} title="测试连接" multiline
          subtitle=${testing ? '连接中' : '发送一次极短的请求，确认地址、密钥与模型可用'}
          arrow onClick=${() => !testing && run()}/>
      <//>

      ${result ? html`
        <div class="pad"><div class="fix-preview">${result}</div></div>` : null}

      <div class="pad">
        <${Button} full variant="ghost"
          onClick=${() => { set({ apiKey: '', model: '', baseUrl: '' }); setResult(''); toast('已清空'); }}>
          清空配置<//>
      </div>

      <div class="settings-foot">
        走这套接口的四项：自动总结记忆、压缩关系底色、从文本导入记忆、历史压缩。
        其余后台任务仍走副用接口。未填全时自动退回副用接口。
      </div>`}
    <//>`;
}

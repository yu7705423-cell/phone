import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, Field, Input, Button, Segmented, toast } from '../../ui/index.js';
import { PROVIDERS } from '../../system/ai/providers/index.js';

const { db, nav } = phone;

export function ApiPage() {
  const s = useStore(db.settings.store);
  const [testing, setTesting] = useState(false);
  const provider = PROVIDERS[s.provider] || PROVIDERS.anthropic;

  const test = async () => {
    setTesting(true);
    try {
      const out = await phone.ai.runTextTask('ping', {
        system: '你是一个测试端点。',
        user: '只回复两个字：收到',
        key: 'settings:test',
        maxTokens: 32,
      });
      toast(`连接成功：${out.slice(0, 20) || '(空响应)'}`, 'ok');
    } catch (err) {
      toast(String(err.message || err), 'error', 5000);
    } finally { setTesting(false); }
  };

  return html`
    <${Page} title="接口与密钥" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="服务商">
          <${Segmented} value=${s.provider}
            onChange=${v => db.settings.set({
              provider: v,
              model: PROVIDERS[v].defaultModel,
              baseUrl: '',
            })}
            items=${Object.values(PROVIDERS).map(p => ({ value: p.id, label: p.label }))}/>
        <//>

        <${Field} label="API Key"
          desc="密钥只存在这台设备的浏览器里，不会上传。但纯前端直连意味着打开这个页面的人都能拿到它，只适合自己使用。">
          <${Input} type="password" value=${s.apiKey} placeholder="sk-..."
            onInput=${v => db.settings.set({ apiKey: v })}/>
        <//>

        <${Field} label="接口地址"
          desc=${s.provider === 'anthropic'
            ? '留空使用官方地址。浏览器直连会带上 anthropic-dangerous-direct-browser-access 头。'
            : '中转服务填到 /v1 为止，例如 https://api.example.com/v1'}>
          <${Input} value=${s.baseUrl} placeholder=${s.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'}
            onInput=${v => db.settings.set({ baseUrl: v })}/>
        <//>

        <${Field} label="模型">
          <${Input} value=${s.model} placeholder="claude-opus-5"
            onInput=${v => db.settings.set({ model: v })}/>
          ${provider.models.length ? html`
            <div class="chip-row">
              ${provider.models.map(m => html`
                <button key=${m} class=${`chip${s.model === m ? ' is-active' : ''}`}
                  onClick=${() => db.settings.set({ model: m })}>${m}</button>`)}
            </div>` : null}
        <//>

        ${provider.usesEffort ? html`
          <${Field} label="思考深度"
            desc="Opus 5 一族不接受 temperature 参数，传了会报 400。输出深浅改用 effort 控制。日常聊天用 low 就够，又快又省。">
            <${Segmented} value=${s.effort}
              onChange=${v => db.settings.set({ effort: v })}
              items=${[{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]}/>
          <//>` : null}

        ${provider.usesTemperature ? html`
          <${Field} label=${`temperature　${s.temperature}`} desc="越高越发散。角色扮演一般 0.8 到 1.0">
            <input type="range" min="0" max="2" step="0.05" value=${s.temperature}
              onInput=${e => db.settings.set({ temperature: parseFloat(e.target.value) })}/>
          <//>` : null}

        <${Button} full variant="ghost" disabled=${testing || !s.apiKey}
          onClick=${test}>${testing ? '测试中…' : '测试连接'}<//>
      </div>
    <//>`;
}

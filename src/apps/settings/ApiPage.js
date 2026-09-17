import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Icon, Segmented,
         Sheet, Switch, EmptyState, toast, confirm } from '../../ui/index.js';
import { ModelPicker } from './ModelPicker.js';

const { db, nav, ai } = phone;
const svc = ai.services;

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI 兼容' },
];

function Editor({ id, onClose }) {
  useStore(db.settings.store);
  const [picking, setPicking] = useState(false);
  const [testing, setTesting] = useState(false);
  const preset = svc.chatPresets().find(p => p.id === id);
  if (!preset) return null;

  const set = patch => svc.updateChatPreset(id, patch);

  const test = async () => {
    setTesting(true);
    try {
      const out = await ai.runWithPreset(preset, {
        system: '你是一个测试端点。', user: '只回复两个字：收到',
      });
      toast(`连接成功：${String(out).slice(0, 20) || '(空响应)'}`, 'ok');
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setTesting(false); }
  };

  const del = async () => {
    if (!await confirm({ title: '删除该接口', message: preset.name, danger: true })) return;
    svc.removeChatPreset(id);
    onClose();
  };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${preset.name || '接口'} height="88%">
      <${Field} label="名称" desc="仅用于本地识别，例如「官方」「中转站 A」。">
        <${Input} value=${preset.name} onInput=${v => set({ name: v })}/>
      <//>

      <${Field} label="接口类型">
        <${Segmented} value=${preset.provider} items=${PROVIDERS}
          onChange=${v => set({ provider: v, model: '' })}/>
      <//>

      <${Field} label="API Key"
        desc="仅保存在本设备的浏览器中。纯前端直连意味着能打开此页面的人均可读取该密钥。">
        <${Input} type="password" value=${preset.apiKey} placeholder="sk-..."
          onInput=${v => set({ apiKey: v })}/>
      <//>

      <${Field} label="接口地址"
        desc=${preset.provider === 'anthropic'
          ? '留空则使用官方地址。浏览器直连时会附带 anthropic-dangerous-direct-browser-access 请求头。'
          : '中转站地址填写至 /v1 为止，例如 https://api.example.com/v1'}>
        <${Input} value=${preset.baseUrl} onInput=${v => set({ baseUrl: v })}
          placeholder=${preset.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'}/>
      <//>

      <${Field} label="模型" desc="可从接口获取列表后选择，也可直接填写。">
        <${Input} value=${preset.model} onInput=${v => set({ model: v })} placeholder="模型名称"/>
        <div class="pad-t">
          <${Button} size="sm" variant="ghost" icon="search"
            onClick=${() => setPicking(true)}>获取并选择<//>
        </div>
      <//>

      ${preset.provider === 'anthropic' ? html`
        <${Field} label="思考深度"
          desc="Opus 5 系列不接受 temperature 参数，传入会返回 400，输出深度改由 effort 控制。日常对话选择「低」即可。">
          <${Segmented} value=${preset.effort || 'low'} onChange=${v => set({ effort: v })}
            items=${[{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]}/>
        <//>`
      : html`
        <${Field} label=${`temperature　${preset.temperature ?? 0.9}`} desc="数值越高输出越发散。角色扮演建议 0.8 至 1.0。">
          <input type="range" min="0" max="2" step="0.05" value=${preset.temperature ?? 0.9}
            onInput=${e => set({ temperature: parseFloat(e.target.value) })}/>
        <//>`}

      <div class="sheet-acts">
        <${Button} variant="ghost" onClick=${del}>删除<//>
        <${Button} variant="ghost" disabled=${testing || !preset.apiKey}
          onClick=${test}>${testing ? '测试中' : '测试'}<//>
        <${Button} onClick=${onClose}>完成<//>
      </div>

      <${ModelPicker} open=${picking} preset=${preset}
        onPick=${m => set({ model: m })} onClose=${() => setPicking(false)}/>
    <//>`;
}

export function ApiPage() {
  const s = useStore(db.settings.store);
  const [editing, setEditing] = useState(null);
  const chat = svc.services().chat;
  const presets = chat.presets;
  const incomplete = p => !(p.apiKey || '').trim() || !(p.model || '').trim();

  const add = provider => {
    const p = svc.newChatPreset({
      provider,
      name: provider === 'anthropic' ? 'Anthropic' : '新接口',
    });
    setEditing(p.id);
  };

  return html`
    <${Page} title="接口" onBack=${nav.pop}>
      ${presets.length ? html`
        <${List} title="已保存的接口">
          ${presets.map(p => {
            const isMain = p.id === chat.activeId;
            const isSpare = p.id === chat.fallbackId;
            const tag = isMain ? '主用' : isSpare ? '副用' : '';
            return html`
              <${ListItem} key=${p.id} title=${p.name}
                subtitle=${`${p.provider === 'anthropic' ? 'Anthropic' : '兼容接口'} · ${p.model || '未选择模型'}`}
                arrow
                left=${html`<div class=${`svc-dot${isMain ? ' is-main' : isSpare ? ' is-spare' : ''}`}></div>`}
                right=${tag ? html`<span class="svc-tag">${tag}</span>` : null}
                onClick=${() => setEditing(p.id)}/>`;
          })}
        <//>

        <${List} title="主用" >
          ${presets.map(p => html`
            <${ListItem} key=${p.id} title=${p.name}
              subtitle=${incomplete(p) ? '配置不完整，无法使用' : ''} multiline=${incomplete(p)}
              right=${html`<${Switch} checked=${chat.activeId === p.id}
                onChange=${v => svc.setActiveChat(v ? p.id : null)}/>`}/>`)}
        <//>
        ${chat.activeId ? null : html`
          <div class="settings-foot">未指定主用接口，对话无法发送。</div>`}

        <${List} title="副用" >
          ${presets.map(p => html`
            <${ListItem} key=${p.id} title=${p.name}
              subtitle=${p.id === chat.activeId ? '可与主用为同一接口' : incomplete(p) ? '配置不完整，无法使用' : ''}
              multiline=${p.id === chat.activeId || incomplete(p)}
              right=${html`<${Switch} checked=${chat.fallbackId === p.id}
                onChange=${v => svc.setFallbackChat(v ? p.id : null)}/>`}/>`)}
        <//>
        <div class="settings-foot">
          主用接口报错时自动改用副用重试一次。主动取消不计为失败，不会触发。<br/>
          如不需要副用，将以上开关全部关闭即可。
        </div>

        ${chat.fallbackId ? html`
          <${List} title="后台任务的接口">
            <${ListItem} title="优先使用副用接口" multiline
              subtitle="整理记忆、导入角色卡、生成 NPC 等无需即时等待的任务优先走副用接口，
                副用不可用时退回主用。主用接口保留给对话回复与主动消息。"
              right=${html`<${Switch} checked=${s.backgroundSpare !== false}
                onChange=${v => db.settings.set({ backgroundSpare: v })}/>`}/>
          <//>
          <div class="settings-foot">
            走副用：自动总结记忆、历史压缩、从文本导入记忆、导入角色卡、
            批量生成 NPC、角色创建小号。<br/>
            走主用：对话回复、主动消息、朋友圈动态与评论。
          </div>` : null}`
      : html`<${EmptyState} icon="key" title="尚未配置接口"
          desc="可保存多个接口随时切换，并指定一个副用接口，在主用报错时自动接替。"/>`}

      <div class="pad">
        <div class="btn-row">
          <${Button} variant="ghost" icon="plus" onClick=${() => add('anthropic')}>Anthropic<//>
          <${Button} variant="ghost" icon="plus" onClick=${() => add('openai')}>兼容接口<//>
        </div>
      </div>

      ${editing ? html`<${Editor} id=${editing} onClose=${() => setEditing(null)}/>` : null}
    <//>`;
}

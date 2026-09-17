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
    if (!await confirm({ title: '删除这个接口', message: preset.name, danger: true })) return;
    svc.removeChatPreset(id);
    onClose();
  };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${preset.name || '接口'} height="88%">
      <${Field} label="名称" desc="给自己看的，比如「官方」「中转站A」">
        <${Input} value=${preset.name} onInput=${v => set({ name: v })}/>
      <//>

      <${Field} label="接口类型">
        <${Segmented} value=${preset.provider} items=${PROVIDERS}
          onChange=${v => set({ provider: v, model: '' })}/>
      <//>

      <${Field} label="API Key"
        desc="只存在这台设备的浏览器里。纯前端直连意味着打开这个页面的人都能拿到它。">
        <${Input} type="password" value=${preset.apiKey} placeholder="sk-..."
          onInput=${v => set({ apiKey: v })}/>
      <//>

      <${Field} label="接口地址"
        desc=${preset.provider === 'anthropic'
          ? '留空用官方地址。浏览器直连会带上 anthropic-dangerous-direct-browser-access 头。'
          : '中转站填到 /v1 为止，例如 https://api.example.com/v1'}>
        <${Input} value=${preset.baseUrl} onInput=${v => set({ baseUrl: v })}
          placeholder=${preset.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'}/>
      <//>

      <${Field} label="模型" desc="可以从接口拉列表来选，也可以直接填">
        <${Input} value=${preset.model} onInput=${v => set({ model: v })} placeholder="模型名"/>
        <div class="pad-t">
          <${Button} size="sm" variant="ghost" icon="search"
            onClick=${() => setPicking(true)}>拉取并选择<//>
        </div>
      <//>

      ${preset.provider === 'anthropic' ? html`
        <${Field} label="思考深度"
          desc="Opus 5 一族不接受 temperature，传了会 400，输出深浅改用 effort 控制。日常聊天 low 就够。">
          <${Segmented} value=${preset.effort || 'low'} onChange=${v => set({ effort: v })}
            items=${[{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]}/>
        <//>`
      : html`
        <${Field} label=${`temperature　${preset.temperature ?? 0.9}`} desc="越高越发散，角色扮演一般 0.8 到 1.0">
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
                subtitle=${`${p.provider === 'anthropic' ? 'Anthropic' : '兼容接口'} · ${p.model || '未选模型'}`}
                arrow
                left=${html`<div class=${`svc-dot${isMain ? ' is-main' : isSpare ? ' is-spare' : ''}`}></div>`}
                right=${tag ? html`<span class="svc-tag">${tag}</span>` : null}
                onClick=${() => setEditing(p.id)}/>`;
          })}
        <//>

        <${List} title="主用">
          ${presets.map(p => html`
            <${ListItem} key=${p.id} title=${p.name}
              right=${html`<${Switch} checked=${chat.activeId === p.id}
                onChange=${() => svc.setActiveChat(p.id)}/>`}/>`)}
        <//>

        <${List} title="副用" >
          <${ListItem} title="不设副用" multiline
            subtitle="主用报错时自动改用副用再试一次。取消不算失败，不会触发。"
            right=${html`<${Switch} checked=${!chat.fallbackId}
              onChange=${() => svc.setFallbackChat(null)}/>`}/>
          ${presets.filter(p => p.id !== chat.activeId).map(p => html`
            <${ListItem} key=${p.id} title=${p.name}
              right=${html`<${Switch} checked=${chat.fallbackId === p.id}
                onChange=${() => svc.setFallbackChat(p.id)}/>`}/>`)}
        <//>

        ${chat.fallbackId ? html`
          <${List} title="后台活儿走哪条">
            <${ListItem} title="交给副用" multiline
              subtitle="整理记忆、导入角色卡、生成 NPC 这些你不会盯着等的活儿，
                优先走副用接口，副用挂了再退回主用。主用留给聊天回复和主动消息。"
              right=${html`<${Switch} checked=${s.backgroundSpare !== false}
                onChange=${v => db.settings.set({ backgroundSpare: v })}/>`}/>
          <//>
          <div class="settings-foot">
            归副用的：自动总结记忆、历史压缩、从文字导入记忆、导入角色卡、
            批量生成 NPC、角色自己琢磨开小号。<br/>
            归主用的：聊天回复、主动消息、朋友圈动态与评论。
          </div>` : null}`
      : html`<${EmptyState} icon="key" title="还没有配置接口"
          desc="可以存多个接口随时切换，并指定一个副用，主用报错时自动顶上。"/>`}

      <div class="pad">
        <div class="btn-row">
          <${Button} variant="ghost" icon="plus" onClick=${() => add('anthropic')}>Anthropic<//>
          <${Button} variant="ghost" icon="plus" onClick=${() => add('openai')}>兼容接口<//>
        </div>
      </div>

      ${editing ? html`<${Editor} id=${editing} onClose=${() => setEditing(null)}/>` : null}
    <//>`;
}

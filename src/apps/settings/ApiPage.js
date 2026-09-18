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

      <${Field} label="接口地址"
        desc=${preset.provider === 'anthropic'
          ? '留空则使用官方地址。浏览器直连时会附带 anthropic-dangerous-direct-browser-access 请求头。'
          : '中转站地址填写至 /v1 为止，例如 https://api.example.com/v1'}>
        <${Input} value=${preset.baseUrl} onInput=${v => set({ baseUrl: v })}
          placeholder=${preset.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'}/>
      <//>

      <${Field} label="API Key"
        desc="仅保存在本设备的浏览器中。纯前端直连意味着能打开此页面的人均可读取该密钥。">
        <${Input} type="password" value=${preset.apiKey} placeholder="sk-..."
          onInput=${v => set({ apiKey: v })}/>
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
  const mem = svc.memoryConfig();
  const memDesc = svc.memoryMode() === 'api'
    ? `单独的接口 · ${mem.model}`
    : mem.mode === 'api' ? '选了单独的接口，但还没填全' : '跟随副用接口';
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
      <div class="pad-x pad-t">
        <div class="btn-row">
          <${Button} variant="ghost" icon="plus" onClick=${() => add('anthropic')}>新建 Anthropic<//>
          <${Button} variant="ghost" icon="plus" onClick=${() => add('openai')}>新建兼容接口<//>
        </div>
      </div>

      ${presets.length ? html`
        <${List} title=${`已保存的接口 ${presets.length}`} cap>
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

        <${List} title="主用" cap>
          ${presets.map(p => html`
            <${ListItem} key=${p.id} title=${p.name}
              subtitle=${incomplete(p) ? '配置不完整，无法使用' : ''} multiline=${incomplete(p)}
              right=${html`<${Switch} checked=${chat.activeId === p.id}
                onChange=${v => svc.setActiveChat(v ? p.id : null)}/>`}/>`)}
        <//>
        ${chat.activeId ? null : html`
          <div class="settings-foot">未指定主用接口，对话无法发送。</div>`}

        <${List} title="副用" cap>
          ${presets.map(p => html`
            <${ListItem} key=${p.id} title=${p.name}
              subtitle=${p.id === chat.activeId ? '可与主用为同一接口' : incomplete(p) ? '配置不完整，无法使用' : ''}
              multiline=${p.id === chat.activeId || incomplete(p)}
              right=${html`<${Switch} checked=${chat.fallbackId === p.id}
                onChange=${v => svc.setFallbackChat(v ? p.id : null)}/>`}/>`)}
        <//>
        <div class="settings-foot">
          对话回复与通话之外的全部任务都走副用接口，副用未配置时退回主用。
          该切换不产生额外调用。<br/>
          走主用：对话回复、通话。<br/>
          走副用：整理记忆、历史压缩、排当日日程、生成随机事件与食谱、
          导入角色卡、批量生成 NPC、主动消息、朋友圈动态与评论、心声、识图描述。<br/>
          主用接口报错时改用另一套重试，属于额外调用，默认关闭，
          可在「用量与上限」中开启。
        </div>

        <${List} title="记忆整理的接口">
          <${ListItem} title="记忆接口" subtitle=${memDesc} arrow multiline
            onClick=${() => nav.push('/memoryapi')}/>
        <//>
        <div class="settings-foot">
          自动总结记忆、压缩关系底色、从文本导入记忆、历史压缩这四项可以再单独
          指定一套接口。它们量最大也最不着急，适合选用更便宜的模型。
          未单独配置时跟随副用接口。
        </div>`
      : html`<${EmptyState} icon="key" title="尚未配置接口"
          desc="可保存多个接口随时切换，并指定一个副用接口，在主用报错时自动接替。"/>`}

      ${editing ? html`<${Editor} id=${editing} onClose=${() => setEditing(null)}/>` : null}
    <//>`;
}

import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Button, Switch, Segmented,
         Sheet, EmptyState, toast, confirm } from '../../ui/index.js';
import { ModelPicker } from './ModelPicker.js';

const { db, nav, ai } = phone;
const svc = ai.services;

const fmtDesc = v => (ai.image.FORMATS.find(f => f.id === (v || '')) || ai.image.FORMATS[0]).desc;

const SIZES = [
  { value: '1024x1024', label: '1:1' },
  { value: '1024x1536', label: '2:3' },
  { value: '1536x1024', label: '3:2' },
];

function Editor({ id, onClose }) {
  useStore(db.settings.store);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const preset = svc.imagePresets().find(p => p.id === id);
  if (!preset) return null;
  const set = patch => svc.updateImagePreset(id, patch);

  const test = async () => {
    setBusy(true);
    try {
      const blob = await ai.image.generate({ prompt: 'a single small black circle on white', preset, key: 'img:test' });
      const imgId = await ai.image.toLibrary(blob, 512);
      toast('生成成功，已存入图片库');
      set({ lastTest: imgId });
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setBusy(false); }
  };

  const del = async () => {
    if (!await confirm({ title: '删除该生图接口', message: preset.name, danger: true })) return;
    svc.removeImagePreset(id);
    onClose();
  };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${preset.name || '生图接口'} height="86%">
      <${Field} label="名称">
        <${Input} value=${preset.name} onInput=${v => set({ name: v })}/>
      <//>

      <${Field} label="类型"
        desc=${preset.kind === 'nai'
          ? '密钥填写 NovelAI 网站用户设置中生成的持久 token，不是账号密码。'
            + '模型填写 nai-diffusion-3 一类。参考图暂不支持。'
          : '官方直连，或填写中转站地址。'}>
        <${Segmented} value=${preset.kind} onChange=${v => set({ kind: v, baseUrl: '' })}
          items=${[{ value: 'openai', label: 'OpenAI 官方' },
            { value: 'relay', label: '中转站' }, { value: 'nai', label: 'NovelAI' }]}/>
      <//>

      <${Field} label="API Key">
        <${Input} type="password" value=${preset.apiKey} onInput=${v => set({ apiKey: v })}/>
      <//>

      ${preset.kind === 'relay' ? html`
        <${Field} label="接口地址" desc="填写至 /v1 为止。">
          <${Input} value=${preset.baseUrl} placeholder="https://api.example.com/v1"
            onInput=${v => set({ baseUrl: v })}/>
        <//>` : null}

      ${preset.kind === 'nai' ? html`
        <${Field} label="接口地址" desc="留空则使用 https://image.novelai.net。">
          <${Input} value=${preset.baseUrl} placeholder="https://image.novelai.net"
            onInput=${v => set({ baseUrl: v })}/>
        <//>
        <${Field} label="负面提示词" desc="每次生成都会带上，用来排除不想要的画面元素。">
          <${Input} value=${preset.negative || ''} placeholder="lowres, bad anatomy"
            onInput=${v => set({ negative: v })}/>
        <//>` : null}

      <${Field} label="模型">
        <${Input} value=${preset.model} onInput=${v => set({ model: v })} placeholder="生图模型名称"/>
        <div class="pad-t">
          <${Button} size="sm" variant="ghost" icon="search"
            onClick=${() => setPicking(true)}>拉取并选择<//>
        </div>
      <//>

      <${Field} label="尺寸">
        <${Segmented} value=${preset.size || '1024x1024'} items=${SIZES}
          onChange=${v => set({ size: v })}/>
      <//>

      ${preset.kind === 'nai' ? null : html`
        <${Field} label="返回格式" desc=${fmtDesc(preset.respFormat)}>
          <${Segmented} value=${preset.respFormat || ''}
            items=${ai.image.FORMATS.map(f => ({ value: f.id, label: f.label }))}
            onChange=${v => set({ respFormat: v })}/>
        <//>`}

      <${List} inset=${false}>
        <${ListItem} title="支持参考图" multiline
          subtitle=${`开启后，角色锁脸将把脸部照片随请求一并发送（images/edits 端点）。`
            + `接口不支持时会自动退回「读成外貌描述」的方式。`}
          right=${html`<${Switch} checked=${preset.ref === 'edits'}
            onChange=${v => set({ ref: v ? 'edits' : 'off' })}/>`}/>
      <//>

      <div class="sheet-acts">
        <${Button} variant="ghost" onClick=${del}>删除<//>
        <${Button} variant="ghost" disabled=${busy || !preset.apiKey || !preset.model}
          onClick=${test}>${busy ? '生成中' : '试生成'}<//>
        <${Button} onClick=${onClose}>完成<//>
      </div>

      <${ModelPicker} open=${picking}
        preset=${{ ...preset, provider: 'openai' }}
        onPick=${m => set({ model: m })} onClose=${() => setPicking(false)}/>
    <//>`;
}

export function ImagePage() {
  useStore(db.settings.store);
  const [editing, setEditing] = useState(null);
  const img = svc.services().image;

  const NAMES = { openai: 'OpenAI', relay: '中转站', nai: 'NovelAI' };
  const add = kind => {
    const p = svc.newImagePreset({ kind, name: NAMES[kind] || '生图接口' });
    setEditing(p.id);
  };

  const s = db.settings.get();

  return html`
    <${Page} title="生图" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="全局生图提示词"
          desc=${`每次生成都会拼在画面描述后面，用来固定画风。所有角色共用。`
            + `角色自己的提示词在各自的角色卡中设置。`}>
          <${Textarea} rows=${3} value=${s.imagePrompt || ''}
            placeholder="例如：柔和的自然光，胶片质感，不要文字水印"
            onInput=${v => db.settings.set({ imagePrompt: v })}/>
        <//>
      </div>

      ${img.presets.length ? html`
        <${List} title="已保存的接口">
          ${img.presets.map(p => html`
            <${ListItem} key=${p.id} title=${p.name}
              subtitle=${`${NAMES[p.kind] || '中转站'} · ${p.model || '未选择模型'}`}
              arrow right=${html`<${Switch} checked=${img.activeId === p.id}
                onChange=${() => svc.setActiveImage(p.id)}/>`}
              onClick=${() => setEditing(p.id)}/>`)}
        <//>`
      : html`<${EmptyState} icon="image" title="尚未配置生图接口"
          desc="可同时保存官方直连与中转站两套配置，随时切换。"/>`}

      <div class="pad">
        <div class="btn-row">
          <${Button} variant="ghost" icon="plus" onClick=${() => add('openai')}>OpenAI 官方<//>
          <${Button} variant="ghost" icon="plus" onClick=${() => add('relay')}>中转站<//>
          <${Button} variant="ghost" icon="plus" onClick=${() => add('nai')}>NovelAI<//>
        </div>
      </div>

      ${editing ? html`<${Editor} id=${editing} onClose=${() => setEditing(null)}/>` : null}
    <//>`;
}

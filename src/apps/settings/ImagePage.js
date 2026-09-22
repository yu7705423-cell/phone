import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Button, Switch, Segmented, Slider,
         Sheet, EmptyState, toast, confirm } from '../../ui/index.js';
import { ModelPicker } from './ModelPicker.js';

const { db, nav, ai } = phone;
const svc = ai.services;

const fmtDesc = v => (ai.image.FORMATS.find(f => f.id === (v || '')) || ai.image.FORMATS[0]).desc;

/**
 * 尺寸。常用的那几档点一下就填上，也可以自己填别的。
 *
 * 列出来的是**备选**，不是全部 —— 各家能用的尺寸随模型而变，写死一份清单
 * 挡的是用户自己知道能用的那些（CLAUDE.md 第 13 条）。
 */
const SizePick = ({ kind, value, onChange }) => {
  const list = ai.image.sizesFor(kind);
  const cur = String(value || '');
  const ok = ai.image.okSize(cur);
  return html`
    <div class="chip-row">
      ${list.map(x => html`
        <button key=${x.value} class=${`chip press${cur === x.value ? ' is-active' : ''}`}
          onClick=${() => onChange(x.value)}>${x.label} ${x.value}</button>`)}
    </div>
    <div class="pad-t">
      <${Input} value=${cur} placeholder="1024x1024"
        onInput=${v => onChange(v)}/>
    </div>
    ${cur && !ok ? html`
      <div class="field-warn">格式为「宽x高」，例如 1024x1024。当前填写无法识别，将按 1024x1024 发送。</div>`
    : null}`;
};

function Editor({ id, onClose }) {
  useStore(db.settings.store);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const preset = svc.imagePresets().find(p => p.id === id);
  if (!preset) return null;
  const set = patch => svc.updateImagePreset(id, patch);
  // 自检用的是这一套，发消息用的是「当前生效」的那一套。不是同一套时要说出来
  const isLive = svc.services().image.activeId === id;

  // 一句「失败了」等于什么都没说。底下至少藏着五件事，每一件的下一步都不同，
  // 所以自检把断在哪一步、以及下一步该做什么一起摆出来（见 ai/image.js 的 testImage）
  const test = async () => {
    setBusy(true);
    setReport(null);
    try {
      const r = await ai.image.testImage(preset);
      setReport(r);
      if (r.ok) {
        const blob = await ai.image.generate({ prompt: 'a single small black circle on white',
          preset, key: 'img:test2' });
        set({ lastTest: await ai.image.toLibrary(blob, 512) });
        toast('生成成功，已存入图片库', 'ok');
      }
    } catch (err) { setReport({ ok: false, step: '自检本身出错', detail: String(err.message || err) }); }
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
        <//>` : null}

      <${Field} label="负面提示词"
        desc=${preset.kind === 'nai'
    ? '每次生成都会带上，用来排除不想要的画面元素。'
    : 'OpenAI 兼容的接口标准里没有这一项。写在这里不会被当成要画的内容，'
      + '但也只有下面那个开关打开、且该接口认得 negative_prompt 时才真的发出去。'}>
        <${Textarea} rows=${3} value=${preset.negative || ''}
          placeholder="lowres, bad anatomy" onInput=${v => set({ negative: v })}/>
      <//>
      ${preset.kind !== 'nai' ? html`
        <${List} inset=${false}>
          <${ListItem} title="这套接口认得 negative_prompt" multiline
            subtitle=${'打开才会把上面那段作为单独字段发出去。OpenAI 本身见到不认识的'
    + '字段会直接返回 400，所以默认关着；中转站转给别的模型时常常是认的。'}
            right=${html`<${Switch} checked=${preset.negOn === true}
              onChange=${v => set({ negOn: v })}/>`}/>
        <//>` : null}

      <${Field} label="模型">
        <${Input} value=${preset.model} onInput=${v => set({ model: v })} placeholder="生图模型名称"/>
        <div class="pad-t">
          <${Button} size="sm" variant="ghost" icon="search"
            onClick=${() => setPicking(true)}>拉取并选择<//>
        </div>
      <//>

      <${Field} label="尺寸"
        desc=${preset.kind === 'nai'
          ? 'NovelAI 要求宽高均为 64 的倍数，且总像素有上限，超出时接口会拒绝。'
          : '可点选常用尺寸，也可自行填写。接口不支持的尺寸会被拒绝。'}>
        <${SizePick} kind=${preset.kind} value=${preset.size}
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
          subtitle=${`开启后，角色设了脸图时会先试 images/edits 那条路，`
    + `不认再退回纯文生图。多数中转站没有这个端点，而且常常是挂着不回、`
    + `不是直接报错，所以这一条会先白等一段时间。只想要文生图就关着。`}
          right=${html`<${Switch} checked=${preset.ref === 'edits'}
            onChange=${v => set({ ref: v ? 'edits' : 'off' })}/>`}/>
      <//>

      ${!isLive ? html`
        <div class="pad-x">
          <div class="warn-box">
            这一套不是当前生效的接口。发消息时用的是
            「${svc.activeImage()?.name || '另一套'}」，在这里自检通过也不代表发消息能成。
          </div>
          <div class="pad-t">
            <${Button} size="sm" variant="ghost"
              onClick=${() => { svc.setActiveImage(id); toast('已设为生效', 'ok'); }}>
              把这一套设为生效
            <//>
          </div>
        </div>` : null}

      <${Field} label="等待上限"
        desc="超过这么久还没回应就算失败。生图一张跑一两分钟很常见，所以默认给得宽。
          填 0 表示一直等，不主动放弃。">
        <${Slider} value=${preset.timeout ?? 300} onChange=${v => set({ timeout: v })}
          min=${0} max=${900} step=${10} unit="秒"/>
      <//>

      ${report ? html`
        <${List} title=${report.ok ? '自检通过' : `断在：${report.step}`}>
          <${ListItem} title=${report.ok ? '接口可用' : report.step} multiline
            subtitle=${report.hint || ''}/>
          <${ListItem} title="这一次走的是" subtitle=${report.route || ''}/>
          ${report.base ? html`<${ListItem} title="地址" subtitle=${report.base}/>` : null}
          ${report.detail ? html`
            <${ListItem} title="原始报错" multiline subtitle=${report.detail}/>` : null}
        <//>` : null}

      <div class="sheet-acts">
        <${Button} variant="ghost" onClick=${del}>删除<//>
        <${Button} variant="ghost" disabled=${busy || !preset.apiKey || !preset.model}
          onClick=${test}>${busy ? '自检中' : '自检并试生成'}<//>
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
  // 把 Positive 与 Negative 两大段一起贴进来的，Negative 那几十行会被
  // 当成要画的东西发出去。这件事在界面上没有任何痕迹，所以认出来直接说
  const neg = ai.image.negativeBlock(s.imagePrompt);

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
        ${neg ? html`
          <div class="warn-box">
            这段文字里有一行单独的「${neg.head}」，它后面还有 ${neg.lines} 行。
            OpenAI 兼容的生图接口没有负面提示词这个字段，这些文字会被当成
            <b>要画的内容</b>一并发出去。请把它们移到下面对应接口的
            「负面提示词」一栏，或整段删掉。
          </div>` : null}
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

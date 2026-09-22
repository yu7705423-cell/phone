import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Segmented, Slider,
         Icon, Sheet, EmptyState, toast, confirm } from '../../ui/index.js';

const { db, nav, ai } = phone;
const svc = ai.services;
const vid = ai.video;

// 生成视频。和生图那一页同一个形状：多套配置，一套生效。
// **多套不是为了好看** —— 同一套接口有好几个中转站在转，换一家试试
// 不该是「把原来那套改掉」，改掉就回不去了。

function Editor({ id, onClose }) {
  useStore(db.settings.store);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const p = svc.videoPresets().find(x => x.id === id);
  if (!p) return null;
  const set = patch => svc.updateVideoPreset(id, patch);
  const kind = vid.kindOf(p.kind);
  const model = vid.modelOf(p.model);
  const isLive = svc.services().video.activeId === id;

  const test = async () => {
    setBusy(true); setReport(null);
    try { setReport(await vid.testVideo(p)); }
    catch (err) { setReport({ ok: false, step: '自检本身出错', detail: String(err.message || err) }); }
    finally { setBusy(false); }
  };

  const del = async () => {
    if (!await confirm({ title: '删除该视频接口', message: p.name, danger: true })) return;
    svc.removeVideoPreset(id);
    onClose();
  };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${p.name || '视频接口'} height="86%">
      <${Field} label="名称">
        <${Input} value=${p.name} onInput=${v => set({ name: v })}/>
      <//>
      <${Field} label="类型" desc=${kind.note}>
        <${Segmented} value=${p.kind} onChange=${v => set({ kind: v })}
          items=${vid.KINDS.map(k => ({ value: k.id, label: k.label }))}/>
      <//>
      <${Field} label="接口地址" desc=${`留空则使用 ${kind.base}。填别的中转站地址即可换一家。`}>
        <${Input} value=${p.baseUrl} placeholder=${kind.base} onInput=${v => set({ baseUrl: v })}/>
      <//>
      <${Field} label="API Key">
        <${Input} value=${p.apiKey} type="password" onInput=${v => set({ apiKey: v })}/>
      <//>
      <${Field} label="模型" desc=${model ? model.note : '下面是常用型号，也可以直接填别的名称。'}>
        <${Input} value=${p.model} placeholder="模型名称" onInput=${v => set({ model: v })}/>
        <div class="btn-row pad-t">
          ${vid.MODELS.map(m => html`
            <${Button} key=${m.id} size="sm" variant=${p.model === m.id ? 'primary' : 'ghost'}
              onClick=${() => set({ model: m.id })}>${m.label}<//>`)}
        </div>
      <//>
      <${Field} label="分辨率"
        desc=${model && !vid.resOk(p.model, p.resolution)
          ? `${p.model} 不支持这一档，它支持的是 ${model.res.join(' 与 ')}。`
          : '越高越贵，生成也越慢。'}>
        <${Segmented} value=${p.resolution} onChange=${v => set({ resolution: v })}
          items=${['480P', '768P', '2K'].map(r => ({ value: r, label: r }))}/>
      <//>
      <${Field} label="时长" desc="秒。越长越贵。">
        <${Slider} value=${p.duration ?? 5} onChange=${v => set({ duration: v })}
          min=${4} max=${vid.MAX_DURATION} step=${1} unit="秒"/>
      <//>
      <${Field} label="宽高比" desc="仅在没有首帧图时生效。带首帧图时由那张图决定。">
        <${Segmented} value=${p.ratio} onChange=${v => set({ ratio: v })}
          items=${vid.RATIOS.map(r => ({ value: r, label: r }))}/>
      <//>
      <${Field} label="查询间隔" desc="每隔这么久问一次任务好了没有。问得太密只是白打接口。">
        <${Slider} value=${p.pollEvery ?? 6} onChange=${v => set({ pollEvery: v })}
          min=${2} max=${60} step=${1} unit="秒"/>
      <//>
      <${Field} label="最长等待"
        desc="超过这么久就不再等。任务仍在对方那边运行，没有被取消。填 0 表示一直等。">
        <${Slider} value=${p.maxWait ?? 600} onChange=${v => set({ maxWait: v })}
          min=${0} max=${1800} step=${30} unit="秒"/>
      <//>

      ${isLive ? null : html`
        <div class="pad-x pad-t">
          <${Button} size="sm" variant="ghost" full
            onClick=${() => { svc.setActiveVideo(id); toast('已设为生效', 'ok'); }}>
            把这一套设为生效
          <//>
        </div>`}

      ${report ? html`
        <${List} title=${report.ok ? '自检通过' : `断在：${report.step}`}>
          <${ListItem} title=${report.ok ? '配置可用' : report.step} multiline
            subtitle=${report.hint || ''}/>
          ${report.route ? html`<${ListItem} title="这一次走的是" subtitle=${report.route}/>` : null}
          ${report.base ? html`<${ListItem} title="地址" subtitle=${report.base}/>` : null}
          ${report.detail ? html`
            <${ListItem} title="对方原话" subtitle=${report.detail} multiline/>` : null}
        <//>` : null}

      <div class="sheet-acts">
        <${Button} full disabled=${busy} onClick=${test}>
          ${busy ? '正在自检' : '自检'}<//>
        <${Button} full variant="danger" onClick=${del}>删除这一套<//>
      </div>
    <//>`;
}

export function VideoPage() {
  useStore(db.settings.store);
  const [editing, setEditing] = useState('');
  const list = svc.videoPresets();
  const activeId = svc.services().video.activeId;

  return html`
    <${Page} title="生成视频" onBack=${nav.pop}>
      <div class="settings-foot">
        生成一段视频是一个异步任务，提交之后通常需要一到五分钟。
        任务编号会记在那条消息上，切换页面或重新打开应用都能接着等。
        生成按时长与分辨率计费，失败的任务同样可能计费。
      </div>

      ${list.length ? html`
        <${List} title=${`接口 · ${list.length}`}>
          ${list.map(p => html`
            <${ListItem} key=${p.id} title=${p.name || '未命名'} arrow multiline
              subtitle=${`${vid.kindOf(p.kind).label} · ${p.model || '未填模型'} · ${p.resolution || '768P'} · ${p.duration || 5} 秒`}
              left=${html`<${Icon} name="film" size=${18}/>`}
              right=${p.id === activeId ? html`<span class="tag">生效中</span>` : null}
              onClick=${() => setEditing(p.id)}/>`)}
        <//>`
      : html`<${EmptyState} icon="film" title="还没有视频接口"
          desc="新建一套之后，可在会话中生成视频。"/>`}

      <div class="pad">
        <${Button} full variant="ghost" icon="plus"
          onClick=${() => setEditing(svc.newVideoPreset({ name: `接口 ${list.length + 1}` }).id)}>
          新建一套视频接口
        <//>
      </div>

      ${editing ? html`<${Editor} id=${editing} onClose=${() => setEditing('')}/>` : null}
    <//>`;
}

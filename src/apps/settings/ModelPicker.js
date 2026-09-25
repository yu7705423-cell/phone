import { html, useState, useEffect } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Sheet, Field, Input, Button, Icon, EmptyState, Spinner, toast } from '../../ui/index.js';

// 从接口拉模型列表，可搜索。拉不到就还能手填。
export function ModelPicker({ open, preset, onPick, onClose, initialQuery = '' }) {
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');

  // 一套接口下的模型可能几百个，重排那种一眼扫不到。
  // 打开时先按调用方给的词过一遍，清空搜索框就能看全部
  useEffect(() => { if (open) setQ(initialQuery); }, [open, initialQuery]);

  useEffect(() => {
    if (!open || !preset) return;
    let alive = true;
    setBusy(true); setErr(null); setList([]);
    phone.ai.fetchModels({
      provider: preset.provider === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: preset.baseUrl, apiKey: preset.apiKey,
    }).then(rows => { if (alive) setList(rows); })
      .catch(e => { if (alive) setErr(String(e.message || e)); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [open, preset?.id, preset?.baseUrl, preset?.apiKey, preset?.provider]);

  if (!open) return null;
  const shown = phone.ai.filterModels(list, q);
  // 这一套接口上用过的几个（services.switchModel 记的）。拉列表慢或拉不到时也能直接切
  const recent = preset.recentModels || [];

  return html`
    <${Sheet} open=${true} onClose=${onClose} title="选择模型" height="82%">
      <${Input} value=${q} placeholder="搜索模型" onInput=${setQ}/>

      ${busy ? html`<div class="picker-state"><${Spinner}/><span>正在拉取列表</span></div>` : null}

      ${err ? html`
        <div class="warn-box">
          拉取失败：${err}<br/>
          可以直接在下面手填模型名。
        </div>` : null}

      ${!busy && !err && !list.length ? html`
        <${EmptyState} icon="layers" title="接口没有返回模型列表" desc="直接手填模型名即可。"/>` : null}

      ${recent.length && !q ? html`
        <div class="field-desc">最近用过</div>
        <div class="chip-row model-recent">
          ${recent.map(m => html`
            <button key=${m} class=${`chip press${preset.model === m ? ' is-active' : ''}`}
              onClick=${() => { onPick(m); onClose(); }}>${m}</button>`)}
        </div>` : null}

      ${shown.length ? html`
        <div class="model-list">
          ${shown.map(m => html`
            <button key=${m} class=${`model-row press${preset.model === m ? ' is-active' : ''}`}
              onClick=${() => { onPick(m); onClose(); }}>
              <span class="ellipsis">${m}</span>
              ${preset.model === m ? html`<${Icon} name="check" size=${16}/>` : null}
            </button>`)}
        </div>` : null}

      ${q && !shown.length && list.length ? html`
        <div class="field-desc">没有匹配的模型</div>` : null}

      <div class="sheet-acts">
        <${Button} variant="ghost" full onClick=${() => {
          if (!q.trim()) { toast('先在上面输入模型名'); return; }
          onPick(q.trim()); onClose();
        }}>用输入框里的名字<//>
      </div>
    <//>`;
}

/**
 * 「模型」那一栏：输入框，加一个「拉取并选择」。
 *
 * 各接口页的模型栏都长这样，一律用它，不要各自再接一遍 ModelPicker ——
 * 从前有六个页面只有输入框，拉不了列表也搜不了，就是各写各的漏掉的。
 *
 *   conn   { provider, baseUrl, apiKey }：拉列表用的那一套（已按「接口来源」解析过的）
 *   query  打开时预先填进搜索框的词，例如 "rerank"
 *   children  输入框与拉取按钮之间再放点什么（视频页的常用型号）
 */
export function ModelField({ label = '模型', desc, value, onChange, conn, query = '', placeholder = '模型名称', children }) {
  const [picking, setPicking] = useState(false);
  const ready = !!String(conn?.apiKey || '').trim();
  return html`
    <${Field} label=${label} desc=${desc}>
      <${Input} value=${value || ''} onInput=${v => onChange(v.trim())} placeholder=${placeholder}/>
      ${children || null}
      <div class="pad-t">
        <${Button} size="sm" variant="ghost" icon="search" disabled=${!ready}
          onClick=${() => setPicking(true)}>${ready ? '拉取并选择' : '填写密钥后可拉取列表'}<//>
      </div>
    <//>
    <${ModelPicker} open=${picking} initialQuery=${query}
      preset=${{ provider: conn?.provider === 'anthropic' ? 'anthropic' : 'openai',
        baseUrl: conn?.baseUrl || '', apiKey: conn?.apiKey || '', model: value || '' }}
      onPick=${onChange} onClose=${() => setPicking(false)}/>`;
}

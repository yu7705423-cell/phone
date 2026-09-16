import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Switch, Icon,
         Sheet, EmptyState, Spinner, toast } from '../../ui/index.js';

const { db, nav, ai } = phone;
const svc = ai.services;

function VoiceModelPicker({ open, cfg, onPick, onClose }) {
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');

  const load = async () => {
    setBusy(true); setErr(null);
    try {
      const rows = await ai.fetchModels({ provider: 'openai', baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
      setList(rows);
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  };

  if (!open) return null;
  const shown = ai.filterModels(list, q);

  return html`
    <${Sheet} open=${true} onClose=${onClose} title="选择语音模型" height="80%">
      <${Input} value=${q} placeholder="搜索" onInput=${setQ}/>
      <div class="pad-t">
        <${Button} size="sm" variant="ghost" icon="refresh" disabled=${busy}
          onClick=${load}>${busy ? '拉取中' : '拉取列表'}<//>
      </div>
      ${busy ? html`<div class="picker-state"><${Spinner}/><span>正在拉取</span></div>` : null}
      ${err ? html`<div class="warn-box">拉取失败：${err}<br/>直接手填模型名即可。</div>` : null}
      ${shown.length ? html`
        <div class="model-list">
          ${shown.map(m => html`
            <button key=${m} class=${`model-row press${cfg.model === m ? ' is-active' : ''}`}
              onClick=${() => { onPick(m); onClose(); }}>
              <span class="ellipsis">${m}</span>
              ${cfg.model === m ? html`<${Icon} name="check" size=${16}/>` : null}
            </button>`)}
        </div>` : null}
      <div class="sheet-acts">
        <${Button} variant="ghost" full onClick=${() => {
          if (!q.trim()) { toast('先在上面输入模型名'); return; }
          onPick(q.trim()); onClose();
        }}>用输入框里的名字<//>
      </div>
    <//>`;
}

export function VoicePage() {
  useStore(db.settings.store);
  useStore(db.characters.store);
  const [picking, setPicking] = useState(false);
  const [testing, setTesting] = useState(false);
  const v = svc.voiceConfig();
  const chars = db.characters.all();

  const test = async () => {
    const first = chars.find(c => c.voiceId);
    setTesting(true);
    try {
      const url = await ai.voice.speak({
        text: '这是一段试听。', voiceId: first?.voiceId, key: 'voice:test',
      });
      ai.voice.play(url);
      toast('已开始播放');
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setTesting(false); }
  };

  return html`
    <${Page} title="语音" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title="启用语音" subtitle="关闭后不会调用语音接口"
          left=${html`<${Icon} name="headphone" size=${19}/>`}
          right=${html`<${Switch} checked=${v.enabled} onChange=${b => svc.setVoice({ enabled: b })}/>`}/>
      <//>

      <div class="pad">
        <div class="hint-box">
          MiniMax 的语音合成。接口地址、GroupId、Key 填在这里，
          每个角色用哪个音色写在各自的角色卡里。
        </div>

        <${Field} label="接口地址" desc="留空用 https://api.minimax.chat">
          <${Input} value=${v.baseUrl} placeholder="https://api.minimax.chat"
            onInput=${x => svc.setVoice({ baseUrl: x })}/>
        <//>

        <${Field} label="GroupId">
          <${Input} value=${v.groupId} onInput=${x => svc.setVoice({ groupId: x })}/>
        <//>

        <${Field} label="API Key">
          <${Input} type="password" value=${v.apiKey} onInput=${x => svc.setVoice({ apiKey: x })}/>
        <//>

        <${Field} label="模型">
          <${Input} value=${v.model} placeholder="语音合成模型名"
            onInput=${x => svc.setVoice({ model: x })}/>
          <div class="pad-t">
            <${Button} size="sm" variant="ghost" icon="search"
              onClick=${() => setPicking(true)}>拉取并选择<//>
          </div>
        <//>

        <${Button} full variant="ghost" disabled=${testing || !v.apiKey || !v.groupId}
          onClick=${test}>${testing ? '合成中' : '试听'}<//>
      </div>

      <${List} title="各角色的音色">
        ${chars.length ? chars.map(c => html`
          <${ListItem} key=${c.id} title=${c.name}
            subtitle=${c.voiceId || '还没填音色 ID'}
            right=${html`<${Icon} name=${c.voiceId ? 'check' : 'close'} size=${15}/>`}/>`)
        : html`<${ListItem} title="还没有角色卡"/>`}
      <//>
      <div class="pad-x pad-b">
        <div class="field-desc">音色 ID 在角色卡里填，这里只是汇总查看。</div>
      </div>

      <${VoiceModelPicker} open=${picking} cfg=${v}
        onPick=${m => svc.setVoice({ model: m })} onClose=${() => setPicking(false)}/>
    <//>`;
}

import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Switch, NumberInput,
         Icon, toast } from '../../ui/index.js';
import { ApiSource } from './ApiSource.js';
import { ModelPicker } from './ModelPicker.js';

const { db, nav, ai } = phone;
const svc = ai.services;

// 重排接口。向量粗筛出一批候选之后，再让它按相关度排一遍。
// 整项默认关着 —— 它每一轮多打一次请求（见 CLAUDE.md 第 15 条）。
export function RerankPage() {
  const s = useStore(db.settings.store);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const cfg = svc.rerankConfig();
  const set = patch => svc.setRerank(patch);
  const ready = svc.rerankReady();
  const vecOn = s.memoryVector === true && svc.embedReady();

  const test = async () => {
    setBusy(true);
    try {
      const r = await ai.rerank.probe();
      toast(r.top === 0
        ? `连接成功，${r.count} 条候选排序正确`
        : `连接成功，但排序结果与预期不符（返回 ${r.count} 条）`,
      r.top === 0 ? 'ok' : 'error', 5000);
    } catch (e) {
      toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); }
  };

  return html`
    <${Page} title="重排" onBack=${nav.pop}>
      <div class="hint-box">
        语义检索按向量距离粗筛出一批候选，重排模型再把候选和当前对话一起读一遍，
        按相关度重新排序。向量分不开的条目，它通常分得开。
        用的是 Cohere 那套 /v1/rerank，SiliconFlow、Jina、Voyage 均兼容。
      </div>

      <${ApiSource} cfg=${cfg} set=${set}/>

      <div class="pad-x">
        ${cfg.endpointId ? null : html`
<${Field} label="接口地址" desc="例如 https://api.siliconflow.cn">
          <${Input} value=${cfg.baseUrl} onInput=${v => set({ baseUrl: v.trim() })}
            placeholder="https://api.siliconflow.cn"/>
        <//>
        <${Field} label="密钥">
          <${Input} type="password" value=${cfg.apiKey} onInput=${v => set({ apiKey: v.trim() })}
            placeholder="sk-..."/>
        <//>
        `}
        <${Field} label="模型" desc="例如 Qwen/Qwen3-Reranker-8B">
          <${Input} value=${cfg.model} onInput=${v => set({ model: v.trim() })}
            placeholder="Qwen/Qwen3-Reranker-8B"/>
          <div class="pad-t">
            <${Button} size="sm" variant="ghost" icon="search"
              disabled=${!cfg.baseUrl || !cfg.apiKey}
              onClick=${() => setPicking(true)}>拉取并选择<//>
          </div>
        <//>
      </div>

      <div class="pad">
        <${Button} full variant="ghost" disabled=${busy || !ready}
          onClick=${test}>${busy ? '正在试' : '试一下通不通'}<//>
      </div>

      <${List} title="启用">
        <${ListItem} title="召回之后重排一遍" multiline
          subtitle=${!ready
            ? '接口尚未填全，无法开启。'
            : !vecOn
              ? '需要先开启语义检索（在会话的「上下文与记忆」中），重排只对语义召回的候选生效。'
              : '开启后每一轮额外调用一次重排接口。关闭则只按向量距离排序。'}
          left=${html`<${Icon} name="filter" size=${18}/>`}
          right=${html`<${Switch} checked=${s.rerankOn === true} disabled=${!ready}
            onChange=${v => db.settings.set({ rerankOn: v })}/>`}/>
        <${ListItem} title="送去重排的候选条数" multiline
          subtitle=${'向量先取这么多条交给重排模型。填 0 表示把所有通过相似度门槛的都送去。'
            + '数目越大排得越准，单次请求也越大。最终保留几条由语义检索的「取前几条」决定。'}
          right=${html`<${NumberInput} value=${Number(s.rerankCandidates) || 0} min=${0}
            onChange=${v => db.settings.set({ rerankCandidates: v })}/>`}/>
      <//>

      <div class="settings-foot">
        重排接口失败时不影响聊天，该轮自动退回按向量距离排序。<br/>
        通话不走重排，避免在等对方开口时多一次往返。
      </div>

      <${ModelPicker} open=${picking} initialQuery="rerank"
        preset=${{ provider: 'openai', baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model }}
        onPick=${m => set({ model: m })} onClose=${() => setPicking(false)}/>
    <//>`;
}

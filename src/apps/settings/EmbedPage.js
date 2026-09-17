import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Icon, toast, confirm } from '../../ui/index.js';
import { ModelPicker } from './ModelPicker.js';

const { db, nav, ai } = phone;
const svc = ai.services;

// 向量接口。和聊天、语音、生图一样属于「服务」，是全局的，放设置里。
// 具体某段对话怎么用它，在那段对话的「上下文与记忆」里调。
export function EmbedPage() {
  useStore(db.settings.store);
  useStore(db.memories.store);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const cfg = svc.embedConfig();

  const set = patch => svc.setEmbed(patch);

  const test = async () => {
    setBusy(true);
    try {
      const { dims } = await ai.embed.probe();
      set({ dims });
      toast(`通了，${dims} 维`, 'ok', 4000);
    } catch (e) {
      toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); }
  };

  const total = db.memories.count();
  const indexed = ai.memvec.indexedCount();
  const todo = ai.memvec.pending().length;

  const [prog, setProg] = useState(null);
  const backfill = async () => {
    setBusy(true);
    try {
      const r = await ai.memvec.backfill({ onProgress: (d, t) => setProg(`${d} / ${t}`) });
      toast(r.total ? `补好了 ${r.done} 条` : '没有要补的', 'ok');
    } catch (e) {
      toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); setProg(null); }
  };

  const drop = async () => {
    if (!await confirm({
      title: '清掉所有向量', danger: true, okText: '清掉',
      message: '记忆内容不会动，只是把算好的向量删掉。换了模型之后该这么做。',
    })) return;
    ai.memvec.dropAll();
    ai.embed.clearQueryCache();
    toast('清掉了');
  };

  return html`
    <${Page} title="向量" onBack=${nav.pop}>
      <div class="hint-box">
        配了之后，记忆就按「意思相近」来找，而不是硬碰关键词。
        用的是 OpenAI 那套 /v1/embeddings，中转站和本地 Ollama 一般都兼容。
      </div>

      <div class="pad-x">
        <${Field} label="接口地址" desc="留空就是 https://api.openai.com">
          <${Input} value=${cfg.baseUrl} onInput=${v => set({ baseUrl: v.trim() })}
            placeholder="https://api.openai.com"/>
        <//>
        <${Field} label="密钥">
          <${Input} type="password" value=${cfg.apiKey} onInput=${v => set({ apiKey: v.trim() })}
            placeholder="sk-..."/>
        <//>
        <${Field} label="模型" desc=${cfg.dims ? `上次测出来 ${cfg.dims} 维` : '例如 text-embedding-3-small'}>
          <${Input} value=${cfg.model} onInput=${v => set({ model: v.trim() })}
            placeholder="text-embedding-3-small"/>
          <div class="pad-t">
            <${Button} size="sm" variant="ghost" icon="search"
              onClick=${() => setPicking(true)}>拉取并选择<//>
          </div>
        <//>
      </div>

      <div class="pad">
        <${Button} full variant="ghost" disabled=${busy || !cfg.apiKey || !cfg.model}
          onClick=${test}>${busy ? '正在试' : '试一下通不通'}<//>
      </div>

      <${List} title="记忆索引">
        <${ListItem} title="已建索引" multiline
          subtitle=${`${indexed} / ${total} 条。换了模型旧向量会作废，需要重新补`}
          left=${html`<${Icon} name="brain" size=${18}/>`}
          right=${html`<span>${todo ? `差 ${todo}` : '齐了'}</span>`}/>
      <//>
      <div class="pad batch-acts">
        <${Button} size="sm" disabled=${busy || !todo || !svc.embedReady()}
          onClick=${backfill}>${prog ? `补到 ${prog}` : `补齐 ${todo} 条`}<//>
        <${Button} size="sm" variant="ghost" disabled=${busy || !indexed}
          onClick=${drop}>清掉所有向量<//>
      </div>

      <div class="settings-foot">
        新写进来的记忆会自动补向量，不用每次手动点。<br/>
        向量接口挂了不影响聊天，会自动退回原来的关键词检索。
      </div>

      <${ModelPicker} open=${picking}
        preset=${{ provider: 'openai', baseUrl: cfg.baseUrl, apiKey: cfg.apiKey }}
        onPick=${m => set({ model: m })} onClose=${() => setPicking(false)}/>
    <//>`;
}

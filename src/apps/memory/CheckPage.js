import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, EmptyState, toast, confirm } from '../../ui/index.js';

const { db, nav, memcheck } = phone;

// 记忆体检。
//
// 提取时那道自动的关只处理两种：同一个槽位，以及像到几乎是同一句话。
// 剩下那一档 —— **可能是同一件事，也可能只是句式像** —— 自动合并会误伤
// （「她喜欢猫」与「她喜欢狗」字面上也很像），所以摆到这里来由人裁决。
//
// 这一页也是唯一能修历史遗留的入口：在有这套检查之前攒下的那些重复条目，
// 不来这儿看一眼就永远躺在库里，每次召回都可能一起冒出来。

const short = t => String(t || '（空）').slice(0, 60);

function Pair({ row, onDone }) {
  const pick = async (keep, drop) => {
    if (!await confirm({
      title: '保留这一条',
      message: `「${short(keep.content)}」保留；\n「${short(drop.content)}」让位，不再参与召回，仍可在下方撤回。`,
      okText: '保留',
    })) return;
    memcheck.supersede(drop.id, keep.id);
    onDone();
  };

  return html`
    <div class="list-wrap">
      <div class="list-title">相似度 ${Math.round(row.score * 100)}%</div>
      <div class="capsule">
        <${ListItem} multiline title=${row.a.content} subtitle="点击保留这一条"
          onClick=${() => pick(row.a, row.b)}/>
        <${ListItem} multiline title=${row.b.content} subtitle="点击保留这一条"
          onClick=${() => pick(row.b, row.a)}/>
      </div>
    </div>`;
}

export function CheckPage() {
  useStore(db.memories.store);
  const [n, setN] = useState(0);
  const pairs = memcheck.pairs();
  const gone = memcheck.superseded();
  const over = phone.ai.memory.overdue();

  return html`
    <${Page} title="记忆体检" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="hint-box">
          列出内容高度重合、可能在说同一件事的条目。同一件事留两条时，
          召回可能把两个版本一起送进去，角色无从判断以哪一条为准。<br/>
          保留其一之后，另一条不再参与召回，但仍保存在库中，可以撤回。
        </div>
      </div>

      ${pairs.length
        ? pairs.map(p => html`<${Pair} key=${`${p.a.id}-${p.b.id}-${n}`} row=${p}
            onDone=${() => { setN(n + 1); toast('已保留', 'ok'); }}/>`)
        : html`<${EmptyState} icon="check" title="没有发现重复"
            desc="库中暂时没有内容高度重合的条目。"/>`}

      ${over.length ? html`
        <${List} title=${`过期的待办 ${over.length} 条`}>
          ${over.map(m => html`
            <${ListItem} key=${m.id} multiline title=${m.content}
              subtitle=${`原定 ${m.dueAt}，已经过去。不再当作未了结的事上场，等你确认`}
              right=${html`
                <div class="tk-acts">
                  <${Button} size="sm" variant="ghost" onClick=${() => {
                    db.memories.update(m.id, { content: `${m.content}（已完结）` });
                    toast('已标为完结', 'ok');
                  }}>已完结<//>
                  <${Button} size="sm" variant="ghost" onClick=${() => {
                    db.memories.update(m.id, { dueAt: '' });
                    toast('已取消日期', 'ok');
                  }}>去掉日期<//>
                </div>`}/>`)}
        <//>` : null}

      ${gone.length ? html`
        <${List} title=${`已让位 ${gone.length} 条`}>
          ${gone.map(m => html`
            <${ListItem} key=${m.id} multiline title=${m.content}
              subtitle="不参与召回"
              right=${html`<${Button} size="sm" variant="ghost"
                onClick=${() => { memcheck.restore(m.id); toast('已撤回', 'ok'); }}>撤回<//>`}/>`)}
        <//>` : null}

      <div class="settings-foot">
        挂了日期的待办过期三天后不再作为未了结的事参与召回，列在此处等待确认。<br/>
        提取记忆时会自动处理两种情况：同一槽位（职业、常住地等只有一个值的项）
        的新条目直接取代旧条目；内容几乎完全一致的两条自动合并。
        其余情况一律列在此处，由你决定。
      </div>
    <//>`;
}

import { html } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Page, List, ListItem, EmptyState } from '../../ui/index.js';

const { nav, ai } = phone;

// 上一轮召回的账。
//
// 这一页存在的理由只有一个：**调不出好结果的时候，要能看见是哪一项
// 把它顶上来、又是哪一项把它压下去的。** 打分有九项，全靠感觉调等于盲调。
//
// 只给人看，不进 prompt —— 告诉模型「这条得了 0.8 分」是替它作判断
// （第 16 条），而且它也用不上这个数。
//
// 记在内存里，刷新就没了。和「接口调用记录」那一页同一个道理：
// 这是排查用的，不该在库里长期占地方。

const LABEL = {
  cue: '线索', recent: '新近', strength: '强度', weight: '分量',
  open: '未了结', slot: '时段', manual: '手写', first: '最早', fatigue: '疲劳',
};

const num = n => (Math.round(Number(n) * 100) / 100).toFixed(2);

function Row({ row, weights }) {
  // 只列真的出了力的那几项，一行九个零没有意义
  const parts = Object.entries(row.parts || {})
    .filter(([k, v]) => v > 0.01 && (weights[k] || 0) > 0)
    .sort((a, b) => b[1] * (weights[b[0]] || 0) - a[1] * (weights[a[0]] || 0))
    .map(([k, v]) => `${LABEL[k] || k} ${num(v * (weights[k] || 0))}`);

  const state = row.used ? '已注入' : row.dropped === 'same' ? '同一件事，让位给了更高分的那条' : '未选中';
  return html`
    <${ListItem} multiline title=${row.content || '（空）'}
      subtitle=${`${state} · 合计 ${num(row.score)}　${parts.join('　')}`}
      left=${html`<span class=${`rank ${row.used ? 'rank-S' : 'rank-C'}`}>${num(row.score)}</span>`}
      onClick=${() => nav.push(`/edit/${row.id}`)} arrow/>`;
}

export function LastPage() {
  const last = ai.memory.lastRecall();

  if (!last) {
    return html`
      <${Page} title="上一轮召回" onBack=${nav.pop}>
        <${EmptyState} icon="brain" title="还没有记录"
          desc="与角色对话一轮之后，这里会列出当轮的候选记忆、各自的得分构成，以及最终注入了哪几条。记录只保留在内存中，刷新后清除。"/>
      <//>`;
  }

  const used = last.rows.filter(r => r.used).length;
  return html`
    <${Page} title="上一轮召回" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <div class="hint-box">
          候选 ${last.total} 条，注入 ${used} 条。
          检索方式：${last.mode === 'vector' ? '语义向量' : last.mode === 'rerank' ? '语义向量加重排' : '本地二元组'}。<br/>
          用于计分的那段对话：${last.scanText || '（空）'}
        </div>
      </div>
      <${List} title="按得分排序">
        ${last.rows.map(r => html`<${Row} key=${r.id} row=${r} weights=${last.weights}/>`)}
      <//>
      <div class="settings-foot">
        得分由线索、新近、强度、分量、未了结、时段、手写、最早八项加权得出，
        再减去疲劳一项。权重可在「设置 - 用量与上限」中调整。<br/>
        同一件事只注入一条：内容高度重合的几条中，得分最高的那条出场，
        其余留在库中不参与本轮。
      </div>
    <//>`;
}

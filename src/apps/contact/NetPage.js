import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, EmptyState, Button } from '../../ui/index.js';

const { db, nav, ai } = phone;
const card = ai.card;

const W = 340, H = 340, R1 = 108, R2 = 158;

// 关系网。中心是当前角色，第一圈是直接关系，第二圈是关系的关系。
// 手画 SVG，不引第三方图库 —— 节点数就这么点，力导向属于杀鸡用牛刀。
export function NetPage({ id }) {
  useStore(db.characters.store);
  const char = db.characters.get(id);
  if (!char) {
    return html`<${Page} title="关系网" onBack=${nav.pop}>
      <${EmptyState} title="该角色已被删除"/><//>`;
  }

  const { nodes, edges } = card.graphAround(id, 2);
  if (nodes.length <= 1) {
    return html`
      <${Page} title="关系网" onBack=${nav.pop}>
        <${EmptyState} icon="users" title="暂无关联角色"
          desc=${`${char.name} 目前没有任何关联。添加关联角色后，此处会绘制关系网。`}
          action=${html`<${Button} size="sm" icon="plus"
            onClick=${() => nav.replace(`/npc/${id}`)}>关联角色<//>`}/>
      <//>`;
  }

  // 分圈铺开：中心一个，一圈直接关系，二圈更外面
  const ring = d => nodes.filter(n => n.depth === d);
  const pos = new Map([[id, { x: W / 2, y: H / 2 }]]);
  [[1, R1], [2, R2]].forEach(([d, r]) => {
    const list = ring(d);
    list.forEach((n, i) => {
      // 第二圈整体转半格，免得和第一圈连成一条直线挤在一起
      const a = (i / Math.max(1, list.length)) * Math.PI * 2
        - Math.PI / 2 + (d === 2 ? Math.PI / Math.max(1, list.length) : 0);
      pos.set(n.id, { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r });
    });
  });

  const initial = n => (n.name || '?').slice(0, 1);

  return html`
    <${Page} title="关系网" onBack=${nav.pop}>
      <div class="net-wrap">
        <svg class="net-svg" viewBox=${`0 0 ${W} ${H}`} role="img"
          aria-label=${`${char.name}的关系网，共 ${nodes.length} 个人`}>
          ${edges.map(e => {
            // 让 a 永远是更靠中心的那一端，标签就固定落在靠外的一侧，不会压住中心的名字
            const da = nodes.find(n => n.id === e.a)?.depth ?? 9;
            const dbp = nodes.find(n => n.id === e.b)?.depth ?? 9;
            const [ia, ib] = da <= dbp ? [e.a, e.b] : [e.b, e.a];
            const a = pos.get(ia), b = pos.get(ib);
            if (!a || !b) return null;
            return html`
              <g key=${e.key}>
                <line x1=${a.x} y1=${a.y} x2=${b.x} y2=${b.y}
                  stroke="var(--border-2)" stroke-width="1"/>
                ${e.label ? html`
                  <text class="net-edge-label" text-anchor="middle"
                    x=${a.x + (b.x - a.x) * 0.45} y=${a.y + (b.y - a.y) * 0.45 - 4}
                  >${e.label}</text>` : null}
              </g>`;
          })}
          ${nodes.map(n => {
            const p = pos.get(n.id);
            if (!p) return null;
            const r = n.depth === 0 ? 26 : n.depth === 1 ? 20 : 16;
            return html`
              <g key=${n.id} style="cursor:pointer"
                onClick=${() => n.id !== id && nav.push(`/profile/${n.id}`)}>
                <circle cx=${p.x} cy=${p.y} r=${r}
                  fill=${n.depth === 0 ? 'var(--accent)' : 'var(--surface)'}
                  stroke="var(--border)" stroke-width="1"/>
                <text x=${p.x} y=${p.y + 4} text-anchor="middle"
                  style=${`font-size:${r * 0.62}px;fill:${n.depth === 0 ? 'var(--on-accent)' : 'var(--text)'}`}
                >${initial(n)}</text>
                <text class="net-node-label" x=${p.x} y=${p.y + r + 12}
                  text-anchor="middle">${n.name}</text>
              </g>`;
          })}
        </svg>
      </div>

      <div class="settings-foot">
        一共 ${nodes.length} 个人，${edges.length} 条关系。点圆圈跳到那个人的资料。<br/>
        线上的字是「在${char.name}眼里，那个人是她的什么」。
      </div>

      <div class="pad">
        <${Button} full variant="ghost" icon="plus"
          onClick=${() => nav.push(`/npc/${id}`)}>再关联几个<//>
      </div>
    <//>`;
}

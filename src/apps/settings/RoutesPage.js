import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon } from '../../ui/index.js';

const { db, nav, ai } = phone;
const svc = ai.services;

// 几件事各自用哪套接口（system/ai/engine.js 的 ROUTE_GROUPS）。见 ARCHITECTURE 4.237
//
// 「用哪一套」不是「多打一次」，这一页的任何选择都不增加调用次数（CLAUDE.md 第 15 条）。
// 选的那一套没填全（缺密钥或模型）时照默认走，这一页上写明。

export function RoutesPage() {
  useStore(db.settings.store);
  const routes = db.settings.get().taskRoutes || {};
  const presets = svc.chatPresets();
  const chat = svc.services().chat;
  const nameOf = id => presets.find(p => p.id === id)?.name || '';
  const memOk = svc.memoryMode() === 'api';

  const options = [
    { value: '', label: '默认' },
    { value: 'main', label: `主用${nameOf(chat.activeId) ? `（${nameOf(chat.activeId)}）` : ''}` },
    { value: 'fallback', label: `副用${nameOf(chat.fallbackId) ? `（${nameOf(chat.fallbackId)}）` : '（未指定）'}` },
    { value: 'memory', label: `记忆接口${memOk ? '' : '（未单独配置）'}` },
    ...presets.map(p => ({ value: p.id, label: p.name || '未命名接口' })),
  ];
  const set = (group, value) => db.settings.set({ taskRoutes: { ...routes, [group]: value } });

  return html`
    <${Page} title="任务用哪套接口" onBack=${nav.pop}>
      <div class="settings-foot">
        为下面几项任务单独指定接口。只改变用哪一套，不增加调用次数。
        选定的接口缺少密钥或模型时，按默认方式选择。
      </div>
      ${ai.routeGroups.map(g => {
        const cur = String(routes[g.id] || '');
        return html`
          <${List} key=${g.id} title=${g.label}>
            ${options.map(o => html`
              <${ListItem} key=${o.value || 'def'} title=${o.label}
                subtitle=${o.value === '' ? g.def : ''}
                right=${cur === o.value ? html`<${Icon} name="check" size=${18}/>` : null}
                onClick=${() => set(g.id, o.value)}/>`)}
          <//>`;
      })}
    <//>`;
}

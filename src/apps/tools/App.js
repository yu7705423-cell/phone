import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, EmptyState } from '../../ui/index.js';
import { AddPage, ImportPage, EditPage, RunPromptPage, RunWebPage, RunsPage, RunView,
         draftKey } from './Mine.js';
import { NpcPage, NpcRunView } from './Npc.js';
import { WorldPage, loadWorld } from './World.js';
import { LorePage, loadLore } from './Lore.js';
import { ExtraPage, LexiconPage, loadExtra } from './Extra.js';
import { ImgHostPage } from './ImgHost.js';

const { db, nav, toolbox } = phone;

// 工具箱。一个个小工具，每个工具一块独立的页面。见 ARCHITECTURE 4.247
//
// 内置的五个写在各自的文件里；用户自己加的（提示词工具、网页工具）都在 Mine.js。
// 内置工具生成的东西落进已有的数据域：NPC 进联系人，世界观与世界书进世界书，
// 番外进「我们」—— 工具箱自己只存设置与历史。

function Home() {
  useStore(db.tools.store);
  const mine = toolbox.userTools();
  return html`
    <${Page} title="工具箱"
      right=${html`<button class="nav-text press" onClick=${() => nav.push('/add')}>添加</button>`}>
      <${List} title="内置工具">
        ${toolbox.BUILTINS.map(b => html`
          <${ListItem} key=${b.id} title=${b.name} subtitle=${b.desc} multiline arrow
            left=${html`<${Icon} name=${b.icon} size=${18}/>`}
            onClick=${() => nav.push(b.route)}/>`)}
      <//>
      <${List} title=${`我的工具${mine.length ? ` · ${mine.length}` : ''}`}>
        ${mine.length ? mine.map(t => html`
          <${ListItem} key=${t.id} title=${t.name}
            subtitle=${[t.kind === 'web' ? '网页工具' : '提示词工具', t.desc].filter(Boolean).join(' · ')}
            multiline arrow left=${html`<${Icon} name=${t.icon || 'tool'} size=${18}/>`}
            onClick=${() => nav.push(`/t/${t.id}`)}/>`)
        : html`
          <${ListItem} title="添加工具" multiline arrow
            subtitle="可新建提示词工具或网页工具，也可从文件导入他人分享的工具"
            left=${html`<${Icon} name="plus" size=${18}/>`} onClick=${() => nav.push('/add')}/>`}
      <//>
    <//>`;
}

function RunPage({ id }) {
  useStore(db.tools.store);
  const t = toolbox.get(id);
  if (!t || t.builtin) {
    return html`<${Page} title="工具" onBack=${nav.pop}><${EmptyState} icon="tool" title="该工具已被删除"/><//>`;
  }
  return t.kind === 'web' ? html`<${RunWebPage} key=${t.id} tool=${t}/>` : html`<${RunPromptPage} key=${t.id} tool=${t}/>`;
}

function Runs({ toolId }) {
  const b = toolbox.BUILTINS.find(x => x.id === toolId);
  return html`<${RunsPage} toolId=${toolId} name=${b?.name || toolbox.get(toolId)?.name}/>`;
}

function Run({ id }) {
  useStore(db.toolRuns.store);
  const r = toolbox.getRun(id);
  if (r?.toolId === 'npc') return html`<${NpcRunView} id=${id}/>`;
  // 世界观、世界书、番外：载回生成器接着改。生成器页可能还在栈里，回到根再进，让它按新的设置重挂
  const back = (fn, route) => ({ fn: run => { fn(run); nav.popToRoot(); nav.push(route); } });
  if (r?.toolId === 'world') return html`<${RunView} id=${id} load=${{ label: '载入到世界观生成器', ...back(loadWorld, '/world') }}/>`;
  if (r?.toolId === 'lore') return html`<${RunView} id=${id} load=${{ label: '载入到世界书生成器', ...back(loadLore, '/lore') }}/>`;
  if (r?.toolId === 'extra') return html`<${RunView} id=${id} load=${{ label: '载入到番外生成器', ...back(loadExtra, '/extra') }}/>`;
  return html`<${RunView} id=${id}/>`;
}

export default function ToolsApp({ route }) {
  const r = route || '/';
  let m;
  if (r === '/add') return html`<${AddPage}/>`;
  if (r === '/import') return html`<${ImportPage} key=${draftKey()}/>`;
  if ((m = r.match(/^\/new\/(prompt|web)$/))) return html`<${EditPage} kind=${m[1]}/>`;
  if ((m = r.match(/^\/edit\/(.+)$/))) return html`<${EditPage} key=${m[1]} id=${m[1]}/>`;
  if ((m = r.match(/^\/t\/(.+)$/))) return html`<${RunPage} id=${m[1]}/>`;
  if ((m = r.match(/^\/runs\/(.+)$/))) return html`<${Runs} toolId=${m[1]}/>`;
  if ((m = r.match(/^\/run\/(.+)$/))) return html`<${Run} id=${m[1]}/>`;
  if ((m = r.match(/^\/npc(?:\/char\/(.+))?$/))) return html`<${NpcPage} key=${m[1] || ''} charId=${m[1] || ''}/>`;
  if (r === '/world') return html`<${WorldPage}/>`;
  if (r === '/lore') return html`<${LorePage}/>`;
  if (r === '/extra') return html`<${ExtraPage}/>`;
  if (r === '/extra/lexicon') return html`<${LexiconPage}/>`;
  if (r === '/imghost') return html`<${ImgHostPage}/>`;
  return html`<${Home}/>`;
}

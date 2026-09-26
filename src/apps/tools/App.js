import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, Icon, Input, EmptyState } from '../../ui/index.js';
import { AddPage, ImportPage, EditPage, RunPromptPage, RunWebPage, RunsPage, RunView,
         draftKey } from './Mine.js';
import { NpcPage, NpcRunView } from './Npc.js';
import { WorldPage, loadWorld } from './World.js';
import { LorePage, loadLore } from './Lore.js';
import { ExtraPage, LexiconPage, loadExtra } from './Extra.js';
import { ImgHostPage, SetupPage, HostPage, UploadPage, MovePage } from './ImgHost.js';
import { CardGenPage } from './CardGen.js';

const { db, nav, toolbox } = phone;

// 工具箱。一个个小工具，每个工具一块独立的页面。见 ARCHITECTURE 4.247
//
// 内置的五个写在各自的文件里；用户自己加的（提示词工具、网页工具）都在 Mine.js。
// 内置工具生成的东西落进已有的数据域：NPC 进联系人，世界观与世界书进世界书，
// 番外进「我们」—— 工具箱自己只存设置与历史。

// ---- 首页：应用商店的排法（用户要求）----
//
// 最上面一排横滑的大卡片是内置工具；下面按分类筛、按名字搜，每一行是「图标、名字、说明、打开」。
// 仍是本项目的简约取向：单色图标放在低饱和的方块里，不做彩色渐变（CLAUDE.md 第 4 条）。

const MINE = '我的';

// 一行：图标方块、名字、一句说明、一行小字，右边「打开」
const AppRow = ({ icon, name, desc, meta, onOpen }) => html`
  <div class="tb-app press" onClick=${onOpen}>
    <div class="tb-app-icon"><${Icon} name=${icon || 'tool'} size=${24}/></div>
    <div class="tb-app-body">
      <div class="tb-app-name">${name}</div>
      ${desc ? html`<div class="tb-app-desc">${desc}</div>` : null}
      ${meta ? html`<div class="tb-app-meta">${meta}</div>` : null}
    </div>
    <button class="tb-get press" onClick=${e => { e.stopPropagation(); onOpen(); }}>打开</button>
  </div>`;

const metaOf = t => [t.kind === 'web' ? '网页工具' : '提示词工具',
  t.author ? `作者 ${t.author}` : '',
  t.kind === 'web' && t.allowAI ? '可请求调用接口' : ''].filter(Boolean).join(' · ');

function Home() {
  useStore(db.tools.store);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const mine = toolbox.userTools();
  const key = q.trim().toLowerCase();
  const hit = (...xs) => !key || xs.some(x => String(x || '').toLowerCase().includes(key));
  const tags = [...new Set(toolbox.BUILTINS.map(b => b.tag))];
  const builtins = toolbox.BUILTINS.filter(b => (!tag || tag === b.tag) && hit(b.name, b.desc, b.tag));
  const own = mine.filter(t => (!tag || tag === MINE) && hit(t.name, t.desc, t.author));
  const browsing = !key && !tag;

  return html`
    <${Page} title="工具箱"
      right=${html`<button class="nav-text press" onClick=${() => nav.push('/add')}>添加</button>`}>
      <div class="tb-store">
        <div class="tb-search">
          <${Icon} name="search" size=${16}/>
          <${Input} value=${q} placeholder="搜索工具" onInput=${setQ}/>
        </div>

        <div class="tb-tags">
          ${['', ...tags, MINE].map(x => html`
            <button key=${x || 'all'} class=${`chip${tag === x ? ' is-active' : ''}`}
              onClick=${() => setTag(x)}>${x || '全部'}</button>`)}
        </div>

        ${browsing ? html`
          <div class="tb-hero-row">
            ${toolbox.BUILTINS.map(b => html`
              <div key=${b.id} class="tb-hero press" onClick=${() => nav.push(b.route)}>
                <div class="tb-hero-top">
                  <span class="tb-hero-tag">${b.tag}</span>
                  <div class="tb-hero-icon"><${Icon} name=${b.icon} size=${30}/></div>
                </div>
                <div class="tb-hero-name">${b.name}</div>
                <div class="tb-hero-desc">${b.desc}</div>
                <div class="tb-hero-foot">
                  <span>${b.out}</span>
                  <span class="tb-get">打开</span>
                </div>
              </div>`)}
          </div>` : null}

        ${builtins.length ? html`
          <div class="tb-sec">
            <div class="tb-sec-head"><span>内置工具</span><span class="tb-sec-n">${builtins.length}</span></div>
            ${builtins.map(b => html`<${AppRow} key=${b.id} icon=${b.icon} name=${b.name} desc=${b.desc}
              meta=${`${b.tag} · ${b.out}`} onOpen=${() => nav.push(b.route)}/>`)}
          </div>` : null}

        ${(!tag || tag === MINE) ? html`
          <div class="tb-sec">
            <div class="tb-sec-head"><span>我的工具</span><span class="tb-sec-n">${own.length || ''}</span></div>
            ${own.map(t => html`<${AppRow} key=${t.id} icon=${t.icon} name=${t.name} desc=${t.desc}
              meta=${metaOf(t)} onOpen=${() => nav.push(`/t/${t.id}`)}/>`)}
            ${!key ? html`
              <div class="tb-add press" onClick=${() => nav.push('/add')}>
                <div class="tb-app-icon"><${Icon} name="plus" size=${22}/></div>
                <div class="tb-app-body">
                  <div class="tb-app-name">添加工具</div>
                  <div class="tb-app-desc">新建提示词工具或网页工具，或从文件导入他人分享的工具</div>
                </div>
              </div>` : null}
          </div>` : null}

        ${key && !builtins.length && !own.length ? html`
          <${EmptyState} icon="search" title="没有找到相关工具" desc="可以换一个关键词，或添加自己的工具。"/>` : null}
      </div>
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
  if (r === '/cardgen') return html`<${CardGenPage}/>`;
  if (r === '/imghost') return html`<${ImgHostPage}/>`;
  if ((m = r.match(/^\/imghost\/setup\/([a-z0-9]+)(?:\/(.+))?$/))) return html`<${SetupPage} key=${r} type=${m[1]} hostId=${m[2] || ''}/>`;
  if ((m = r.match(/^\/imghost\/host\/(.+)$/))) return html`<${HostPage} id=${m[1]}/>`;
  if ((m = r.match(/^\/imghost\/upload(?:\/(.+))?$/))) return html`<${UploadPage} key=${r} hostId=${m[1] || ''}/>`;
  if (r === '/imghost/move') return html`<${MovePage}/>`;
  return html`<${Home}/>`;
}

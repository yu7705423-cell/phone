import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, NumberInput, Segmented, Switch,
         Button, Icon, EmptyState, toast, confirm } from '../../ui/index.js';

const { db, nav, ai } = phone;
const svc = ai.services;

// 服务器：连哪几台、每台上哪些工具给角色用。
// 哪个角色能用哪几台，在那个角色的角色卡上勾（CLAUDE.md 第 5 条）。

const GEN = { modern: 'MCP 2026-07-28', http: 'Streamable HTTP', sse: '旧版 HTTP+SSE' };

const statusOf = s => (s.error ? '连接失败'
  : s.checkedAt ? `${(s.tools || []).length - (s.toolsOff || []).length} / ${(s.tools || []).length} 个工具`
  : '未连接');

export const addServer = () => {
  const row = svc.addMcpServer({ name: `服务器 ${svc.mcpServers().length + 1}` });
  nav.push(`/server/${row.id}`);
};

export function ServersTab() {
  useStore(db.settings.store);
  const list = svc.mcpServers();
  return html`
    ${list.length ? html`
      <${List}>
        ${list.map(s => html`
          <${ListItem} key=${s.id} title=${s.name || '未命名'} arrow multiline
            subtitle=${s.url || '未填写地址'} right=${statusOf(s)}
            left=${html`<${Icon} name="plug" size=${18}/>`}
            onClick=${() => nav.push(`/server/${s.id}`)}/>`)}
        <${ListItem} title="添加服务器" arrow left=${html`<${Icon} name="plus" size=${18}/>`} onClick=${addServer}/>
      <//>` : html`
      <${EmptyState} icon="plug" title="尚未添加 MCP 服务器"
        desc="MCP 服务器向角色提供工具，例如查询天气、搜索网页、读写笔记。添加后在角色卡中选择该角色可以使用哪几台。"
        action=${html`<${Button} size="sm" icon="plus" onClick=${addServer}>添加服务器<//>`}/>`}
    <div class="settings-foot">
      仅支持通过 HTTP 访问的服务器（Streamable HTTP 或旧版 SSE），不支持需要在本机启动进程的 stdio 服务器。
      服务器须允许网页跨域访问（CORS），否则浏览器会拦下请求。<br/>
      角色调用工具不额外调用模型接口。结果回来后是否让角色当场接着回复，在「设置 - 用量与上限」中设置，默认关闭。
    </div>
    <div class="pad">
      <${Button} full variant="ghost" icon="settings"
        onClick=${() => phone.intent.open('settings', { route: '/limits', back: true })}>用量与上限<//>
    </div>`;
}

export function ServerPage({ id }) {
  useStore(db.settings.store);
  const s = svc.mcpServer(id);
  const [busy, setBusy] = useState(false);
  if (!s) {
    return html`<${Page} title="MCP 服务器" onBack=${nav.pop}>
      <${EmptyState} icon="plug" title="该服务器已删除"/><//>`;
  }
  // 地址与请求头一改，上次的连接就不作数了
  const set = patch => {
    const reset = 'url' in patch || 'headers' in patch;
    svc.updateMcpServer(id, reset ? { ...patch, error: '' } : patch);
    if (reset) phone.mcp.forget(id);
  };
  const connect = async () => {
    setBusy(true);
    try {
      const r = await phone.mcp.refresh(id);
      toast(`已连接，共 ${r.tools.length} 个工具`, 'ok');
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setBusy(false); }
  };
  const drop = async () => {
    if (!await confirm({ title: '删除服务器', message: `将删除「${s.name || '未命名'}」。已勾选它的角色将不再能使用这些工具。`,
      okText: '删除', danger: true })) return;
    phone.mcp.forget(id);
    svc.removeMcpServer(id);
    nav.pop();
  };
  const off = new Set(s.toolsOff || []);
  const toggle = (name, on) => {
    const next = new Set(off);
    if (on) next.delete(name); else next.add(name);
    set({ toolsOff: [...next] });
  };
  const users = db.characters.all().filter(c => (c.mcpServers || []).includes(id));

  return html`
    <${Page} title=${s.name || 'MCP 服务器'} onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${drop}>删除</button>`}>
      <div class="pad">
        <${Field} label="名称" desc="两台服务器有同名工具时，角色用「名称.工具名」区分它们。">
          <${Input} value=${s.name} onInput=${v => set({ name: v })} placeholder="例如 天气"/>
        <//>
        <${Field} label="地址" desc="服务器的 MCP 端点，通常以 /mcp 或 /sse 结尾。">
          <${Input} value=${s.url} onInput=${v => set({ url: v.trim() })} placeholder="https://example.com/mcp"/>
        <//>
        <${Field} label="请求头" desc="每行一个，写成「名称: 值」，例如 Authorization: Bearer 密钥。仅保存在本设备，备份时与接口密钥同样处理。">
          <${Textarea} rows=${3} value=${s.headers} onInput=${v => set({ headers: v })}
            placeholder="Authorization: Bearer ..."/>
        <//>
        <${Field} label="超时" desc="单次调用超过这么多秒没有结果即记为失败。">
          <${NumberInput} value=${s.timeout} unit="秒" min=${1} onChange=${v => set({ timeout: v || 60 })}/>
        <//>
        <${Field} label="调用前确认"
          desc=${s.approve === 'auto' ? '角色调用这台服务器上的工具时直接执行，不经确认。工具若有副作用（发送、写入、删除），同样直接执行。'
            : s.approve === 'read' ? '服务器标明为只读的工具直接执行，其余工具在会话中等待你允许后执行。'
            : '角色每次调用这台服务器上的工具，都在会话中等待你允许后执行。'}>
          <${Segmented} value=${s.approve || 'ask'} items=${svc.MCP_APPROVE} onChange=${v => set({ approve: v })}/>
        <//>
        <${Button} full icon="refresh" onClick=${connect} disabled=${busy || !s.url}>
          ${busy ? '正在连接' : s.checkedAt ? '重新连接并更新工具' : '连接'}<//>
      </div>

      ${s.error ? html`<div class="settings-foot is-error">连接失败：${s.error}</div>`
        : s.checkedAt ? html`
          <div class="settings-foot">
            ${[s.info?.name ? `${s.info.name}${s.info.version ? ` ${s.info.version}` : ''}` : '',
              GEN[s.gen] || '', s.version || ''].filter(Boolean).join(' · ')}
          </div>` : null}

      ${(s.tools || []).length ? html`
        <${List} title=${`工具 · ${s.tools.length}`}>
          ${s.tools.map(t => html`
            <${ListItem} key=${t.name} title=${t.title || t.name} multiline
              subtitle=${[t.title && t.title !== t.name ? t.name : '', t.readOnly ? '只读' : '', t.description]
                .filter(Boolean).join(' · ')}
              right=${html`<span class="row-acts">
                <button class="nav-text press"
                  onClick=${() => nav.push(`/server/${id}/tool/${encodeURIComponent(t.name)}`)}>试用</button>
                <${Switch} checked=${!off.has(t.name)} onChange=${v => toggle(t.name, v)}/>
              </span>`}/>`)}
        <//>
        <div class="settings-foot">
          关闭的工具不会告知角色。开启的工具连同参数说明会随每一轮请求发送给模型，工具越多请求越长。
          「试用」直接调用一次工具，不经过角色，也不写入任何会话。
        </div>` : null}

      <${List} title="可以使用的角色">
        ${users.length ? users.map(c => html`
          <${ListItem} key=${c.id} title=${c.name} arrow
            onClick=${() => phone.intent.open('chat', { route: `/edit/${c.id}`, back: true })}/>`)
          : html`<${ListItem} title="暂无" multiline subtitle="在角色卡的「MCP 工具」中勾选这台服务器后，该角色即可调用它的工具。"/>`}
      <//>
    <//>`;
}

// 按参数的 schema 先填一个样子，免得从空白开始写 JSON
function sampleOf(schema) {
  const props = schema?.properties || {};
  const out = {};
  Object.keys(props).forEach(k => {
    const t = Array.isArray(props[k].type) ? props[k].type[0] : props[k].type;
    out[k] = props[k].default !== undefined ? props[k].default
      : props[k].enum ? props[k].enum[0]
      : t === 'number' || t === 'integer' ? 0 : t === 'boolean' ? false
      : t === 'array' ? [] : t === 'object' ? {} : '';
  });
  return JSON.stringify(out, null, 2);
}

export function ToolPage({ id, name }) {
  useStore(db.settings.store);
  const s = svc.mcpServer(id);
  const tool = (s?.tools || []).find(t => t.name === name);
  const [args, setArgs] = useState(() => sampleOf(tool?.inputSchema));
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!s || !tool) {
    return html`<${Page} title="工具" onBack=${nav.pop}>
      <${EmptyState} icon="plug" title="该工具已不在这台服务器上"/><//>`;
  }
  const call = async () => {
    let parsed;
    try {
      parsed = JSON.parse(args || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('参数须为一个 JSON 对象');
    } catch (err) { toast(`参数不是合法的 JSON：${err.message}`, 'error', 4000); return; }
    setBusy(true);
    setOut(null);
    try { setOut(await phone.mcp.tryTool(id, name, parsed)); }
    catch (err) { setOut({ text: String(err.message || err), isError: true, failed: true }); }
    finally { setBusy(false); }
  };
  const { $schema, ...schema } = tool.inputSchema || {};

  return html`
    <${Page} title=${tool.title || tool.name} onBack=${nav.pop}>
      <div class="pad mcp-tool">
        <div class="mcp-tool-meta">${s.name} · ${tool.name}${tool.readOnly ? ' · 只读' : ''}</div>
        ${tool.description ? html`<div class="mcp-tool-desc">${tool.description}</div>` : null}
        <${Field} label="参数" desc="一个 JSON 对象，按下方的参数说明填写。">
          <${Textarea} rows=${6} value=${args} onInput=${setArgs}/>
        <//>
        <${Button} full icon="play" onClick=${call} disabled=${busy}>${busy ? '正在调用' : '调用'}<//>
        ${out ? html`
          <div class="mcp-tool-k">${out.failed ? '调用失败' : out.isError ? '工具返回了错误' : `结果 · ${out.ms} 毫秒`}</div>
          <pre class=${`mcp-pre${out.isError ? ' is-error' : ''}`}>${out.text || '（空）'}</pre>` : null}
        <div class="mcp-tool-k">参数说明</div>
        <pre class="mcp-pre">${JSON.stringify(schema, null, 2)}</pre>
      </div>
      <div class="settings-foot">此处的调用直接执行，不经过角色，也不写入任何会话。工具若有副作用，同样会发生。</div>
    <//>`;
}

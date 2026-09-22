import { html, useState, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, Switch,
         EmptyState, toast, confirm, prompt } from '../../ui/index.js';
import { Preview } from './Preview.js';
import { ContractPage } from './ContractPage.js';
import { GenPage } from './GenPage.js';

const { db, nav, skin, intent } = phone;

// 美化库。
//
// **这里不改样式。** 调样式要看着真气泡改，而那个样板间用的是 chat 里真的
// `Bubble` 组件，只在会话里有（第 8 条：app 之间不能互相 import）。
// 把编辑搬过来等于对着一个假样板调，是退步；两边都能改则违反第 5 条
// 「同一个开关只能有一个入口」。
//
// 所以分工是：**这里管「有哪些」，会话里管「长什么样」。**
// 这一页填的是从前真正缺的那几件：导入别人的美化包不必先找一段对话、
// 终于看得到「我所有的美化」、以及删之前知道会影响哪几段会话。

function ListPage() {
  useStore(db.skins.store);
  useStore(db.chats.store);
  const fileRef = useRef(null);
  const rows = skin.all();

  const add = async () => {
    const name = await prompt({ title: '新建一份美化', placeholder: '给它起个名字', okText: '新建' });
    if (name === null) return;
    const row = skin.create({ name: name || '未命名' });
    nav.push(`/one/${row.id}`);
  };

  const importOne = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = skin.unpack(await file.text());
      const a = skin.assetsOf(data.css);
      const warn = a.remote
        ? `该美化引用了 ${a.remote} 处网络地址，套用后打开会话时会向其发起请求。` : '';
      if (!await confirm({
        title: `导入「${data.name}」`, okText: '导入',
        message: `${warn}导入后将新建一份，不会覆盖现有的美化。`,
      })) return;
      const row = skin.install(data);
      toast(`已导入「${row.name}」`, 'ok');
      nav.push(`/one/${row.id}`);
    } catch (err) { toast(String(err.message || err), 'error', 6000); }
  };

  return html`
    <${Page} title="美化"
      right=${html`<button class="nav-text press" onClick=${add}>新建</button>`}>
      ${rows.length ? html`
        <${List} title=${`共 ${rows.length} 份`}>
          ${rows.map(r => {
            const used = skin.chatsUsing(r.id).length;
            return html`
              <${ListItem} key=${r.id} title=${r.name} arrow multiline
                subtitle=${used ? `已用于 ${used} 段会话` : '尚未用于任何会话'}
                left=${html`<${Icon} name="sparkle" size=${18}/>`}
                onClick=${() => nav.push(`/one/${r.id}`)}/>`;
          })}
        <//>`
      : html`<${EmptyState} icon="sparkle" title="还没有任何美化"
          desc="美化用于改变会话页面的样式。新建一份之后，在会话中挂上它即可生效。"
          action=${html`<${Button} size="sm" icon="plus" onClick=${add}>新建一份<//>`}/>`}

      <div class="pad">
        <${Button} full variant="ghost" icon="download"
          onClick=${() => fileRef.current?.click()}>导入美化包<//>
      </div>
      <input type="file" accept=".json,application/json" ref=${fileRef}
        onChange=${importOne} style="display:none"/>

      <${List}>
        <${ListItem} title="写给作者" arrow multiline
          subtitle=${`可用的类名与变量，以及编写须知。契约版本 ${skin.CONTRACT_VERSION}`}
          left=${html`<${Icon} name="book" size=${18}/>`}
          onClick=${() => nav.push('/contract')}/>
      <//>

      <div class="settings-foot">
        调整样式请在会话中进行：那里的样板间是真实的气泡组件，改动即时可见。
      </div>
    <//>`;
}

function OnePage({ id }) {
  useStore(db.skins.store);
  useStore(db.settings.store);
  useStore(db.chats.store);
  useStore(db.characters.store);
  const [picking, setPicking] = useState(false);
  const row = skin.get(id);
  if (!row) {
    return html`<${Page} title="美化" onBack=${nav.pop}>
      <${EmptyState} title="这一份已经不在了"/><//>`;
  }

  const scopes = skin.scopeOf(row);
  const isGlobalNow = db.settings.get().globalSkinId === id;
  // 一份美化可以两档都要，但至少要留一档 —— 一档都不留等于它永远不生效，
  // 而界面上看不出这件事，人会以为是坏了
  const toggleScope = sc => {
    const next = scopes.includes(sc) ? scopes.filter(x => x !== sc) : [...scopes, sc];
    if (!next.length) { toast('至少要保留一档生效范围'); return; }
    skin.update(id, { scope: next });
    if (!next.includes('shell') && isGlobalNow) skin.setGlobal('');
  };

  const used = skin.chatsUsing(id);
  const nameOf = c => db.characters.get((c.characterIds || [])[0])?.name || c.title || '未命名会话';

  const rename = async () => {
    const v = await prompt({ title: '改名', value: row.name });
    if (v !== null) skin.update(id, { name: v.trim() || '未命名' });
  };

  const copy = () => {
    const made = skin.duplicate(id);
    toast(`已复制为「${made.name}」`, 'ok');
    nav.replace(`/one/${made.id}`);
  };

  const exportOne = async () => {
    const a = skin.assetsOf(row.css);
    const lines = [];
    if (a.local.length) lines.push(`其中 ${a.local.length} 处引用的是本机地址，导出后在别人那里显示为空白。`);
    if (a.remote) lines.push(`其中 ${a.remote} 处引用了网络地址，对方需要能访问该地址。`);
    if (a.data) lines.push(`其中 ${a.data} 处图片已内联在文件中，文件体积相应增大。`);
    // 生成器里传进去的图（头像框、角落贴图、各种背景）都内嵌在这一份里
    const pics = skin.gen.weigh(row.gen);
    if (pics.n) {
      lines.push(`其中内嵌 ${pics.n} 张图片，约 ${Math.round(pics.bytes / 1024)} KB，一并带走。`);
    }
    if (lines.length && !await confirm({
      title: '导出美化包', okText: '继续导出',
      message: `${lines.join('')}美化包仅包含名称、尺寸、头像框与样式，`
        + '不包含它挂在哪些会话上。',
    })) return;
    try {
      const blob = new Blob([skin.pack(row)], { type: 'application/json' });
      const a2 = document.createElement('a');
      a2.href = URL.createObjectURL(blob);
      a2.download = `美化-${row.name}.json`;
      a2.click();
      setTimeout(() => URL.revokeObjectURL(a2.href), 4000);
      toast('已导出', 'ok');
    } catch (err) { toast('导出失败：' + (err.message || err), 'error', 5000); }
  };

  const del = async () => {
    if (!await confirm({
      title: `删除「${row.name}」`, okText: '删除', danger: true,
      message: used.length
        ? `挂着它的 ${used.length} 段会话会一并取下，那几段会话恢复为默认样式。删除后无法恢复。`
        : '删除后无法恢复。',
    })) return;
    skin.remove(id);
    nav.pop();
  };

  // 去某段会话里调整。跨 app 一律走 Intent（第 8 条）
  const tune = chat => {
    skin.attach(chat.id, id);
    setPicking(false);
    intent.open('chat', { route: `/skin/${chat.id}`, back: true });
  };

  const chats = db.chats.all()
    .filter(c => (c.characterIds || []).length)
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));

  return html`
    <${Page} title=${row.name} onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${rename}>改名</button>`}>
      <${Preview} row=${row}/>
      <div class="pad">
        <${Button} full icon="edit" onClick=${() => nav.push(`/gen/${id}`)}>打开生成器<//>
      </div>
      <div class="settings-foot">
        这是静态预览，用于辨认这一份大致是什么样子。
        实时效果请在会话中查看：那里的样板间使用真实的气泡组件。
      </div>

      <${List} title="使用情况">
        ${used.length ? used.map(c => html`
          <${ListItem} key=${c.id} title=${nameOf(c)} subtitle="点击前往该会话的美化页" arrow
            left=${html`<${Icon} name="message" size=${18}/>`}
            onClick=${() => intent.open('chat', { route: `/skin/${c.id}`, back: true })}/>`)
        : html`<${ListItem} title="尚未用于任何会话" multiline
            subtitle="挂到一段会话上之后，它只在那段会话的页面里生效"/>`}
        <${ListItem} title="挂到一段会话并前往调整" arrow multiline
          subtitle="样式在会话中调整，那里可以实时看到效果"
          left=${html`<${Icon} name="edit" size=${18}/>`}
          onClick=${() => chats.length ? setPicking(true) : toast('还没有任何会话')}/>
      <//>

      <${List} title="生效范围">
        ${skin.SCOPES.map(sc => html`
          <${ListItem} key=${sc.id} title=${sc.label} multiline subtitle=${sc.desc}
            right=${html`<${Switch} checked=${scopes.includes(sc.id)}
              onChange=${() => toggleScope(sc.id)}/>`}/>`)}
        ${scopes.includes('shell') ? html`
          <${ListItem} title="设为当前的全局美化" multiline
            subtitle=${isGlobalNow ? '已经是当前的全局美化。关闭后恢复默认样式'
    : '整个应用都会套用这一份。同一时间只能有一份'}
            right=${html`<${Switch} checked=${isGlobalNow}
              onChange=${v => { skin.setGlobal(v ? id : ''); }}/>`}/>` : null}
      <//>

      <${List}>
        <${ListItem} title="复制一份" multiline
          subtitle="在现有的基础上改，不必从头写一遍"
          left=${html`<${Icon} name="copy" size=${18}/>`}
          onClick=${copy}/>
        <${ListItem} title="导出美化包" multiline
          subtitle="导出为一个文件，可分享给他人导入。不包含它挂在哪些会话上。"
          left=${html`<${Icon} name="download" size=${18}/>`}
          onClick=${exportOne}/>
      <//>

      <div class="pad">
        <${Button} full variant="danger" onClick=${del}>删除这一份<//>
      </div>

      ${picking ? html`
        <${Page} title="挂到哪段会话" onBack=${() => setPicking(false)} overlay>
          <${List} inset=${false}>
            ${chats.map(c => html`
              <${ListItem} key=${c.id} title=${nameOf(c)} arrow
                subtitle=${c.skinId === id ? '已经挂着这一份' : (c.skinId ? '当前挂着别的美化，将被替换' : '')}
                multiline onClick=${() => tune(c)}/>`)}
          <//>
        <//>` : null}
    <//>`;
}

export default function SkinApp({ route }) {
  if (route === '/contract') return html`<${ContractPage}/>`;
  const g = route?.match(/^\/gen\/(.+)$/);
  if (g) return html`<${GenPage} id=${g[1]}/>`;
  const one = route?.match(/^\/one\/(.+)$/);
  if (one) return html`<${OnePage} id=${one[1]}/>`;
  return html`<${ListPage}/>`;
}

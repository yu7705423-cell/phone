import { html, useState, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, toast, confirm } from '../../ui/index.js';

const { db, nav } = phone;

const fmt = b => b < 1024 ? `${b} B`
  : b < 1048576 ? `${(b / 1024).toFixed(1)} KB`
  : `${(b / 1048576).toFixed(1)} MB`;

function collectUsedImageIds() {
  const used = new Set();
  const add = id => id && used.add(id);
  db.characters.all().forEach(c => { add(c.avatar); add(c.cover); });
  db.moments.all().forEach(m => (m.images || []).forEach(add));
  db.personas.all().forEach(p => { add(p.avatar); add(p.cover); });
  const w = db.layout.get().wallpaper || {}; add(w.home); add(w.lock);
  Object.values(db.settings.get().appIcons || {}).forEach(v => add(v?.imageId));
  (db.layout.get().pages || []).forEach(p =>
    (p.cells || []).forEach(c => add(c.config?.imageId)));
  db.stickers.all().forEach(st => add(st.imageId));
  // 外观预设里的图也算有引用，否则一清理存好的预设就成了空壳
  phone.looks.allImageIds().forEach(add);
  // 字体存在 files 域，不在这一批里，删字体走「主题」那边
  return used;
}

export function StoragePage() {
  useStore(db.characters.store);
  useStore(db.moments.store);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const counts = {
    角色卡: db.characters.count(),
    世界书: db.lorebooks.count(),
    记忆: db.memories.count(),
    会话: db.chats.count(),
    消息: db.messages.count(),
    动态: db.moments.count(),
  };

  const exportAll = () => {
    const data = {
      _format: 'mini-phone-backup',
      _version: 1,
      exportedAt: new Date().toISOString(),
      characters: db.characters.all(),
      lorebooks: db.lorebooks.all(),
      memories: db.memories.all(),
      chats: db.chats.all(),
      messages: db.messages.all(),
      moments: db.moments.all(),
      spaceItems: db.spaceItems.all(),
      events: db.events.all(),
      days: db.days.all(),
      recipes: db.recipes.all(),
      meals: db.meals.all(),
      persona: db.persona.get(),
      personas: db.personas.all(),
      settings: { ...db.settings.get(), apiKey: '' },
      layout: db.layout.get(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `小手机备份-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('备份已导出。图片不包含在内');
  };

  const importAll = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!await confirm({
      title: '导入备份', danger: true,
      message: '当前的角色卡、世界书、记忆与会话将被备份内容覆盖。',
    })) return;
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      if (data._format !== 'mini-phone-backup') throw new Error('不是小手机的备份文件');
      const cols = ['characters', 'lorebooks', 'memories', 'chats', 'messages', 'moments', 'spaceItems', 'events', 'days', 'recipes', 'meals'];
      for (const name of cols) {
        await db[name].clear();
        (data[name] || []).forEach(r => db[name].put(r));
      }
      if (data.persona) db.persona.replace({ ...db.persona.get(), ...data.persona });
      if (Array.isArray(data.personas)) data.personas.forEach(p => db.personas.put ? db.personas.put(p) : db.personas.create(p));
      if (data.settings) db.settings.replace({ ...db.settings.get(), ...data.settings, apiKey: db.settings.get().apiKey });
      toast('导入完成');
    } catch (err) {
      toast('导入失败：' + err.message, 'error', 4000);
    } finally { setBusy(false); }
  };

  const cleanOrphans = async () => {
    const used = collectUsedImageIds();
    const orphans = db.images.ids().filter(id => !used.has(id));
    if (!orphans.length) { toast('没有需要清理的图片'); return; }
    if (!await confirm({ title: '清理无引用图片', message: `将删除 ${orphans.length} 张未被引用的图片。`, danger: true })) return;
    await Promise.all(orphans.map(id => db.images.remove(id)));
    toast(`已清理 ${orphans.length} 张图片`);
  };

  const wipe = async () => {
    if (!await confirm({
      title: '清空全部数据', danger: true, okText: '全部删除',
      message: '角色卡、世界书、记忆、聊天记录、动态与图片将全部删除，且无法恢复。',
    })) return;
    setBusy(true);
    for (const n of ['characters', 'lorebooks', 'memories', 'chats', 'messages', 'moments', 'spaceItems', 'events', 'days', 'recipes', 'meals']) {
      await db[n].clear();
    }
    await Promise.all(db.images.ids().map(id => db.images.remove(id)));
    db.persona.reset();
    db.layout.reset();
    setBusy(false);
    toast('已清空');
  };

  return html`
    <${Page} title="存储与备份" onBack=${nav.pop}>
      <${List} title="占用">
        <${ListItem} title="图片" subtitle=${`${db.images.count()} 张`}
          left=${html`<${Icon} name="image" size=${18}/>`}
          right=${html`<span>${fmt(db.images.totalBytes())}</span>`}/>
        ${Object.entries(counts).map(([k, v]) => html`
          <${ListItem} key=${k} title=${k} right=${html`<span>${v}</span>`}/>`)}
      <//>

      <${List} title="维护">
        <${ListItem} title="清理无引用图片" subtitle="删除未被任何角色或动态引用的图片" arrow
          left=${html`<${Icon} name="filter" size=${18}/>`} onClick=${cleanOrphans}/>
      <//>

      <${List} title="备份">
        <${ListItem} title="导出备份" subtitle="JSON 文件，不含图片与 API 密钥" arrow
          left=${html`<${Icon} name="download" size=${18}/>`} onClick=${exportAll}/>
        <${ListItem} title="导入备份" subtitle="将覆盖当前数据" arrow
          left=${html`<${Icon} name="upload" size=${18}/>`}
          onClick=${() => fileRef.current?.click()}/>
      <//>
      <input type="file" accept="application/json" ref=${fileRef} onChange=${importAll} style="display:none"/>

      <div class="pad">
        <${Button} full variant="danger" disabled=${busy} onClick=${wipe}>清空全部数据<//>
      </div>
    <//>`;
}

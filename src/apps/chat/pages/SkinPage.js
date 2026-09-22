import { html, useState, useEffect, useRef } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Textarea, NumberInput, Segmented, Switch,
         Button, Icon, EmptyState, toast, confirm, prompt } from '../../../ui/index.js';
import { Bubble, ComposerBar } from './Conversation.js';

const { db, nav, skin, receipt } = phone;

// 会话的美化。见 ARCHITECTURE 4.111
//
// 这一页开着的时候就把这份美化挂上，所以下面那个样板间看到的就是真效果。
// 离开就摘掉。

// 样板间**用真的气泡组件**，不另写一份假 HTML。
//
// 另写一份的话，真页面改了 class 它不跟 —— 在这一页调好的东西到聊天页
// 不生效，而且没人会发现。这是这类系统最常见的烂法。
function Sample({ char, chat, hostRef }) {
  const now = Date.now();
  const fake = (id, role, content, ago, extra) => ({
    id, chatId: chat.id, role, authorId: role === 'user' ? 'me' : char.id,
    kind: 'text', content, status: 'done', createdAt: now - ago, ...extra,
  });
  const rows = [
    fake('s1', 'char', '样板间里的这几条是假的，改动会当场反映在这里。', 4000),
    // 中间这条带一个引用块。**样板间要盖住类名那一页列出的每一处** ——
    // 列在那里却在这儿看不到的，等于调了也验不了
    fake('s2', 'user', '底栏和气泡都可以调。', 3000,
      { quoteText: '样板间里的这几条是假的。', quoteRole: 'char' }),
    fake('s3', 'char', '调好之后回到会话里就是这个样子。', 2000),
  ];
  const noop = () => {};
  // 时刻与回执也画进样板间。最后一条是角色说的，所以中间那条显示已读
  const stampAt = receipt.stampMode();
  const readOn = receipt.on();
  return html`
    <div class="skin-sample-wrap" ref=${hostRef}>
      <div class="conv-body ph-chat-body skin-sample">
        ${rows.map(m => html`
          <${Bubble} key=${m.id} msg=${m} char=${char} chat=${chat} frozen
            onRetry=${noop} onSwipe=${noop} onHold=${noop} onToggle=${noop}
            onSettle=${noop} onOpenLog=${noop} onUnwrap=${noop} onPat=${noop}
            selecting=${false} selected=${false} transOpen="never" innerStyle=""
            stampAt=${stampAt} readOn=${readOn} readUpTo=${now - 2000}/>`)}
      </div>
      <${ComposerBar} frozen/>
    </div>`;
}

/**
 * 类名那一页上那个「此刻命中几处」。
 *
 * 这张表（`skin.CLASSES`）是手写的，而页面结构会变。「两张表迟早对不上」
 * 在这个项目里已经反复发生，所以不靠人去核对：每次打开都在样板间里
 * **真的查一遍**。命中 0 处的，要么在那一条上写清楚了需要什么条件，
 * 要么就是这张表该改了 —— 后者在页面上直接说出来。
 */
function useHits(hostRef, deps) {
  const [hits, setHits] = useState(null);
  useEffect(() => {
    const root = hostRef.current;
    if (!root) { setHits(null); return; }
    const next = {};
    skin.CLASSES.forEach(c => {
      const scope = c.where === 'page' ? document : root;
      try { next[c.sel] = scope.querySelectorAll(c.sel).length; } catch { next[c.sel] = -1; }
    });
    setHits(next);
  }, deps);
  return hits;
}

// 时刻与已读回执是**所有会话共用**的一项，不属于某一份美化，所以不存在
// 美化行里，存在设置里。放在这一页是因为要改它的时候人正在这儿看着气泡
// （CLAUDE.md 第 5 条），全项目只有这一个入口。
function MsgGroup() {
  useStore(db.settings.store);
  const s = db.settings.get();
  return html`
    <div class="settings-foot">
      以下两项对所有会话生效，不随美化切换。
    </div>
    <div class="pad-x">
      <${Field} label="消息时刻"
        desc="显示这条消息在本机出现的时刻，与角色写在正文里的时间无关。
          当天只显示时分，隔天带上日期。">
        <${Segmented} value=${receipt.stampMode()}
          onChange=${v => db.settings.set({ msgStamp: v })}
          items=${receipt.STAMPS.map(x => ({ value: x.id, label: x.label }))}/>
      <//>
    </div>
    <${List}>
      <${ListItem} title="显示已读回执" multiline
        subtitle="在自己发出的消息旁标注已读或未读。角色开始生成回复时记为已读，
          一直没有回复则保持未读。关闭后不再标注。"
        right=${html`<${Switch} checked=${s.msgRead === true}
          onChange=${v => db.settings.set({ msgRead: v })}/>`}/>
    <//>`;
}

export function SkinPage({ chatId }) {
  useStore(db.chats.store);
  useStore(db.skins.store);
  useStore(db.characters.store);
  const [tab, setTab] = useState('size');
  // 提前 return 在下面，所有 hook 都要在那之前（doctor 的 hook 顺序那一项）
  const fileRef = useRef(null);
  const sampleRef = useRef(null);

  const chat = db.chats.get(chatId);
  const char = chat ? db.characters.get((chat.characterIds || [])[0]) : null;
  const cur = chatId ? skin.ofChat(chatId) : null;

  // 这一页开着就挂上，改一下重挂一次 —— 样板间看到的才是真的
  useEffect(() => {
    if (cur) skin.mount(cur);
    else skin.unmount();
    const t = setTimeout(() => skin.settle(), 600);
    return () => { clearTimeout(t); skin.unmount(); };
  }, [cur && cur.id, cur && cur.updatedAt]);

  // **要在早退之前调** —— hook 每次渲染都得以同样的顺序走一遍（见 doctor 的
  // 「hook 顺序」那一项）。命中数跟着这份美化、这两个开关与所在页签变
  const hits = useHits(sampleRef,
    [cur && cur.id, cur && cur.updatedAt, receipt.stampMode(), receipt.on(), tab]);

  if (!chat || !char) {
    return html`<${Page} title="美化" onBack=${nav.pop}><${EmptyState} title="该会话已不存在"/><//>`;
  }

  const set = patch => cur && skin.update(cur.id, patch);
  const setToken = (id, v) => set({ tokens: { ...(cur.tokens || {}), [id]: v } });

  const pick = async () => {
    const name = await prompt({ title: '新建一份美化', placeholder: '给它起个名字', okText: '新建' });
    if (name === null) return;
    const row = skin.create({ name: name || '未命名' });
    skin.attach(chatId, row.id);
  };

  // 导出。CSS 里引用的外部东西先摆出来 —— 不说清楚的话，对方打开是空框，
  // 而分享的人以为自己发出去的和屏幕上长得一样
  const exportOne = async () => {
    const a = skin.assetsOf(cur.css);
    const lines = [];
    if (a.local.length) {
      lines.push(`其中 ${a.local.length} 处引用的是本机地址，导出后在别人那里显示为空白。`);
    }
    if (a.remote) lines.push(`其中 ${a.remote} 处引用了网络地址，对方需要能访问该地址。`);
    if (a.data) lines.push(`其中 ${a.data} 处图片已内联在文件中，文件体积相应增大。`);
    // 生成器里传进去的图（头像框、角落贴图、各种背景）都内嵌在这一份里
    const pics = skin.gen.weigh(cur.gen);
    if (pics.n) {
      lines.push(`其中内嵌 ${pics.n} 张图片，约 ${Math.round(pics.bytes / 1024)} KB，一并带走。`);
    }
    if (lines.length && !await confirm({
      title: '导出美化包', okText: '继续导出',
      message: `${lines.join('')}美化包仅包含名称、尺寸、头像框与样式，`
        + '不包含它挂在哪些会话上。',
    })) return;
    try {
      const blob = new Blob([skin.pack(cur)], { type: 'application/json' });
      const a2 = document.createElement('a');
      a2.href = URL.createObjectURL(blob);
      a2.download = `美化-${cur.name}.json`;
      a2.click();
      setTimeout(() => URL.revokeObjectURL(a2.href), 4000);
      toast('已导出', 'ok');
    } catch (err) { toast('导出失败：' + (err.message || err), 'error', 5000); }
  };

  const importOne = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = skin.unpack(await file.text());
      const a = skin.assetsOf(data.css);
      // 远程地址值得先说一句：打开这段会话时那台服务器会知道
      const warn = a.remote
        ? `该美化引用了 ${a.remote} 处网络地址，打开这段会话时会向其发起请求。`
        : '';
      if (!await confirm({
        title: `导入「${data.name}」`, okText: '导入',
        message: `${warn}导入后将新建一份，不会覆盖现有的美化。`,
      })) return;
      const row = skin.install(data);
      skin.attach(chatId, row.id);
      toast(`已导入「${row.name}」`, 'ok');
    } catch (err) { toast(String(err.message || err), 'error', 6000); }
  };

  if (!cur) {
    return html`
      <${Page} title="美化" onBack=${nav.pop}>
        <div class="settings-foot">
          美化按会话生效：挂上之后只在这段会话的页面里起作用，离开即恢复。
          写坏了可以在消息列表长按这段会话，选择清除。
        </div>
        <${List} title="挂一份现成的">
          ${skin.all().length
    ? skin.all().map(x => html`
              <${ListItem} key=${x.id} title=${x.name}
                subtitle=${`已用于 ${skin.usedBy(x.id)} 段会话`}
                onClick=${() => skin.attach(chatId, x.id)}/>`)
    : html`<${ListItem} title="还没有任何美化" subtitle="新建一份开始" multiline/>`}
        <//>
        <div class="pad btn-row">
          <${Button} onClick=${pick}>新建一份<//>
          <${Button} variant="ghost" icon="download"
            onClick=${() => fileRef.current?.click()}>导入美化包<//>
        </div>
        <input type="file" accept=".json,application/json" ref=${fileRef}
          onChange=${importOne} style="display:none"/>
        <${MsgGroup}/>
      <//>`;
  }

  const TABS = [
    { value: 'size', label: '尺寸' },
    { value: 'css', label: '自定义 CSS' },
    { value: 'names', label: '类名' },
  ];

  return html`
    <${Page} title=${cur.name} onBack=${nav.pop}
      right=${html`<${Button} size="sm" variant="ghost" onClick=${async () => {
    const v = await prompt({ title: '改名', value: cur.name });
    if (v !== null) set({ name: v.trim() || '未命名' });
  }}>改名<//>`}>

      <${Sample} char=${char} chat=${chat} hostRef=${sampleRef}/>

      <div class="pad-x pad-t">
        <${Segmented} value=${tab} onChange=${setTab} items=${TABS}/>
      </div>

      ${tab === 'size' ? html`
        <div class="pad-x pad-t">
          <${Field} label="头像形状">
            <${Segmented} value=${cur.shape || ''} onChange=${v => set({ shape: v })}
              items=${skin.SHAPES.map(x => ({ value: x.id, label: x.label }))}/>
          <//>

          <div class="settings-foot">
            头像框在「生成」那一页的「头像」一组，可以为角色与自己各设一张。
          </div>
          ${skin.TOKENS.map(t => html`
            <${Field} key=${t.id} label=${t.label}
              desc=${`${t.desc ? t.desc + '。' : ''}留空表示不改，使用默认值 ${t.def}${t.unit}。`}>
              <${NumberInput} value=${cur.tokens?.[t.id] ?? 0} unit=${t.unit}
                placeholder=${`默认 ${t.def}`} min=${0}
                onChange=${v => setToken(t.id, v || '')}/>
            <//>`)}
          <div class="pad-t">
            <${Button} variant="ghost" onClick=${() => set({ tokens: {}, shape: '' })}>
              尺寸全部恢复默认
            <//>

          </div>
        </div>` : null}

      ${tab === 'css' ? html`
        <div class="pad-x pad-t">
          <${Field} label="自定义 CSS"
            desc="只在这段会话的页面打开时生效，离开立即移除。写坏了不会影响别处，
              也可以在消息列表长按这段会话清除。上方样板间是实时的。
              这一段排在「生成」那一段之后，要覆盖它需要写 !important。">
            <${Textarea} rows=${14} value=${cur.css || ''}
              placeholder=".bubble { box-shadow: none; }"
              onInput=${v => set({ css: v })}/>
          <//>
          ${skin.crashed(cur.id) ? html`
            <${List}>
              <${ListItem} title="上次打开这段会话时没能正常显示" multiline
                subtitle="这一份已被暂停注入。确认改好之后点此恢复"
                onClick=${() => { skin.forgive(); toast('已恢复', 'ok'); }}/>
            <//>` : null}
        </div>` : null}

      ${tab === 'names' ? html`
        <div class="settings-foot">
          这段会话页面里可以用的选择器。点一下复制。
          每一条后面是它此刻在上方样板间里命中的数量。
        </div>
        <${List}>
          ${skin.CLASSES.map(c => {
    const n = hits ? hits[c.sel] : null;
    const sub = n == null ? c.label
      : n > 0 ? `${c.label} · ${c.where === 'page' ? '本页中' : '样板间中'} ${n} 处`
        : c.needs ? `${c.label} · 样板间中暂不可见，需要${c.needs}`
          : `${c.label} · 样板间中未命中，该选择器可能已失效`;
    return html`
            <${ListItem} key=${c.sel} title=${c.sel} subtitle=${sub} multiline
              right=${html`<${Icon} name="copy" size=${16}/>`}
              onClick=${() => {
      navigator.clipboard?.writeText(c.sel);
      toast('已复制', 'ok');
    }}/>`;
  })}
        <//>` : null}

      <${MsgGroup}/>

      <${List}>
        <${ListItem} title="打开生成器" arrow multiline
          subtitle="拖旋钮调顶栏、消息、头像、气泡与底栏，不必手写 CSS"
          left=${html`<${Icon} name="edit" size=${18}/>`}
          onClick=${() => phone.intent.open('skin', { route: `/gen/${cur.id}`, back: true })}/>
        <${ListItem} title="导出美化包" multiline
          subtitle="导出为一个文件，可分享给他人导入。不包含它挂在哪些会话上。"
          left=${html`<${Icon} name="download" size=${18}/>`}
          onClick=${exportOne}/>
        <${ListItem} title="换一份美化" subtitle=${`当前：${cur.name}`} arrow
          onClick=${() => skin.detach(chatId)}/>
        <${ListItem} title="从这段会话取下" subtitle="美化本身保留，其他会话不受影响"
          onClick=${() => { skin.detach(chatId); toast('已取下', 'ok'); }}/>
        <${ListItem} title="删除这一份" danger
          subtitle=${`挂着它的 ${skin.usedBy(cur.id)} 段会话会一并取下`}
          onClick=${async () => {
    const ok = await confirm({ title: `删除「${cur.name}」`, message: '删除后无法恢复。',
      okText: '删除', danger: true });
    if (ok) skin.remove(cur.id);
  }}/>
      <//>
    <//>`;
}

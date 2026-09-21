import { html, useState, useEffect } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, NumberInput, Segmented,
         Button, Icon, EmptyState, toast, confirm, prompt } from '../../../ui/index.js';
import { Bubble } from './Conversation.js';

const { db, nav, skin } = phone;

// 会话的美化。见 ARCHITECTURE 4.111
//
// 这一页开着的时候就把这份美化挂上，所以下面那个样板间看到的就是真效果。
// 离开就摘掉。

// 样板间**用真的气泡组件**，不另写一份假 HTML。
//
// 另写一份的话，真页面改了 class 它不跟 —— 在工坊里调好的东西到聊天页
// 不生效，而且没人会发现。这是这类系统最常见的烂法。
function Sample({ char, chat }) {
  const now = Date.now();
  const fake = (id, role, content, ago) => ({
    id, chatId: chat.id, role, authorId: role === 'user' ? 'me' : char.id,
    kind: 'text', content, status: 'done', createdAt: now - ago,
  });
  const rows = [
    fake('s1', 'char', '样板间里的这几条是假的，改动会当场反映在这里。', 4000),
    fake('s2', 'user', '底栏和气泡都可以调。', 3000),
    fake('s3', 'char', '调好之后回到会话里就是这个样子。', 2000),
  ];
  const noop = () => {};
  return html`
    <div class="conv-body skin-sample">
      ${rows.map(m => html`
        <${Bubble} key=${m.id} msg=${m} char=${char} chat=${chat} frozen
          onRetry=${noop} onSwipe=${noop} onHold=${noop} onToggle=${noop}
          onSettle=${noop} onOpenLog=${noop} onUnwrap=${noop} onPat=${noop}
          selecting=${false} selected=${false} transOpen="never" innerStyle=""/>`)}
    </div>`;
}

export function SkinPage({ chatId }) {
  useStore(db.chats.store);
  useStore(db.skins.store);
  useStore(db.characters.store);
  const [tab, setTab] = useState('size');

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
        <div class="pad">
          <${Button} onClick=${pick}>新建一份<//>
        </div>
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

      <${Sample} char=${char} chat=${chat}/>

      <div class="pad-x pad-t">
        <${Segmented} value=${tab} onChange=${setTab} items=${TABS}/>
      </div>

      ${tab === 'size' ? html`
        <div class="pad-x pad-t">
          <${Field} label="头像形状">
            <${Segmented} value=${cur.shape || ''} onChange=${v => set({ shape: v })}
              items=${skin.SHAPES.map(x => ({ value: x.id, label: x.label }))}/>
          <//>
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
              也可以在消息列表长按这段会话清除。上方样板间是实时的。">
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
        </div>
        <${List}>
          ${skin.CLASSES.map(c => html`
            <${ListItem} key=${c.sel} title=${c.sel} subtitle=${c.label}
              right=${html`<${Icon} name="copy" size=${16}/>`}
              onClick=${() => {
    navigator.clipboard?.writeText(c.sel);
    toast('已复制', 'ok');
  }}/>`)}
        <//>` : null}

      <${List}>
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

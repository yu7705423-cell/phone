# 小手机 Mini Phone - 架构设计

版本: v1 (draft)
状态: 待确认

---

## 0. 这是什么

一个跑在浏览器里的仿手机前端。外壳是手机，里面装各种 app。核心场景是 AI 角色扮演:
角色卡 + 世界书 + 记忆 + 聊天 + 朋友圈，形成一个自洽的闭环。

### 硬性约束

1. **零 emoji**。所有图标一律 SVG。由 CI 脚本扫描源码强制执行，不靠自觉。
2. **简约大方**。统一设计令牌，禁止硬编码颜色与尺寸。
3. **无构建**。不需要 npm install，不需要打包器。
4. **可扩展到几十个 app 而不互相污染**。这是整套架构最主要的设计目标。

### 非目标

- 不追求像素级复刻某款真机
- 不做多用户 / 账号体系
- 不做服务端(第一阶段)

---

## 1. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 模块系统 | 原生 ES Modules | 静态依赖图,天然模块隔离,无全局命名冲突 |
| 渲染 | Preact + htm (vendor 本地文件) | 约 12KB。流式追加、长列表、输入焦点保持这些场景需要成熟的 diff 算法 |
| 样式 | 原生 CSS + CSS 变量令牌 | 主题切换、深浅色、安全区全靠变量 |
| 状态 | 自写轻量 store + hooks | 数据域集中,订阅式更新 |
| 存储 | localStorage (适配层预留 IndexedDB) | 起步够用,适配层保证可替换 |
| 图标 | 自维护 SVG path 表 | 24px 网格, stroke-width 1.5, currentColor |

### 运行方式

ES Modules 在 `file://` 协议下会被 CORS 拦截(origin 为 null),因此**不能双击 index.html 打开**。
需要一个静态服务器:

```
python3 -m http.server 8000
# 或
npx serve .
```

部署到 GitHub Pages / 任意静态托管即可直接访问。

---

## 2. 分层

依赖方向严格单向,不允许反向,不允许跨层跳跃。

```
  shell      设备外壳: 机身、屏幕、状态栏、Home 指示条、安全区
    |
    v
  system     内核: 数据域、AI 引擎、注册表、导航、Intent、存储、通知
    |
    v
  sdk        应用接口: app 唯一能接触到的系统入口
    |
    v
  apps       应用: 每个 app 一个目录,完全自包含
```

横向基建(不依赖任何层,被各层使用):

- `ui/`     设计系统原语
- `icons/`  SVG 图标
- `styles/` 设计令牌与全局样式

### 铁律

```
apps/*  只能 import:  sdk/, ui/, icons/
apps/a  永远不能 import  apps/b
apps/*  永远不能 import  system/  或  vendor 之外的任何外部地址
system/ 可以 import: ui/, icons/, vendor/
```

违反这条就是后期 bug 的源头。新增 app 时对照检查。

---

## 3. 数据域 (最重要的一节)

**跨 app 共享的数据不归任何 app 所有,一律提升到内核。**

常见错误是把角色卡做成"联系人 app 的私有数据",然后聊天 app 要用就互相引用,
朋友圈要用又引用一遍,三个月后没人敢动。

正确做法: 数据在 `system/db/`,app 只是这些数据的视图。
删掉世界书 app,世界书数据还在,聊天照常注入。

### 3.1 characters 角色卡

```js
{
  id: 'char_xxx',
  name: '角色名',
  avatar: '<dataURL or url>',
  cover: '<主页背景图>',
  signature: '个性签名',
  persona: '人设描述,进入 system prompt 的主体',
  scenario: '场景设定',
  firstMessage: '开场白',
  altGreetings: ['备选开场白'],
  exampleDialogue: '对话示例',
  lorebookIds: ['lb_xxx'],      // 关联的世界书
  tags: [],
  pinned: false,
  createdAt, updatedAt
}
```

### 3.2 lorebooks 世界书

```js
{
  id: 'lb_xxx',
  name: '世界书名',
  description: '',
  global: false,                 // true = 对所有角色生效
  entries: [
    {
      id: 'e_xxx',
      comment: '条目备注(仅供人看)',
      keys: ['关键词1', '关键词2'],
      secondaryKeys: [],         // 有则需二次命中
      content: '注入到 prompt 的内容',
      enabled: true,
      constant: false,           // true = 常驻,不需关键词触发
      priority: 100,             // 预算不足时从低优先级开始丢
      order: 0,                  // 同优先级内的排列顺序
      position: 'system',        // system | beforeChat | afterChat | atDepth
      depth: 4,                  // position 为 atDepth 时,插在倒数第几条消息前
      caseSensitive: false,
      probability: 100           // 命中后的触发概率
    }
  ],
  createdAt, updatedAt
}
```

### 3.3 memories 记忆

沿用 rainyword 的 rank + category + keywords 三件套,补上 scope 分层。

```js
{
  id: 'mem_xxx',
  scope: 'global' | 'character:<id>' | 'chat:<id>',
  content: '简洁的第三人称陈述',
  category: 'fact'|'emotion'|'pending'|'pattern'|'relation'|'profile',
  rank: 'S'|'A'|'B'|'C',
  keywords: ['关键词'],        // B 级必须有,用于命中判定
  source: 'auto' | 'manual',
  createdAt, updatedAt
}
```

六类语义(针对陪伴型对话设计,不要换成通用分类):

| category | 含义 |
|---|---|
| `fact` | 关键事实: 姓名、年龄、职业、学校、喜好、经历 |
| `emotion` | 情绪印记: 表达过的情绪、什么让人开心/难过、有效的安慰方式 |
| `pending` | 未完结事项: 提到但没结果的事,如考试、面试、等结果 |
| `pattern` | 互动模式: 说话习惯、称呼偏好、聊天风格偏好 |
| `relation` | 关系阶段: 与角色的关系状态和重要转折 |
| `profile` | 用户画像: 沟通风格、性格特点、价值观 |

`pending` 是让角色能主动追问"上次说的面试怎么样了"的来源,不要省略。

**注入规则**(见 4.5):
- S / A 级全量注入
- B 级在扫描窗口中命中 `keywords` 才注入
- C 级不注入,仅在记忆管理页可见

**记忆缓冲区** `memoryBuffer[chatId]`: 尚未总结的原始对话,与 messages 分开存,
总结完成后清空。上限 200 条,超出丢弃最旧的。

### 3.4 chats / messages 会话与消息

```js
// chat
{
  id: 'chat_xxx',
  characterIds: ['char_xxx'],    // 数组,为群聊预留
  title: '',
  lastMessageAt,
  unread: 0,
  pinned: false,
  muted: false,
  summary: '',                   // 压缩后的历史摘要
  summarizedUpTo: 'msg_xxx',     // 摘要覆盖到哪条消息
  createdAt
}

// message
{
  id: 'msg_xxx',
  chatId: 'chat_xxx',
  role: 'user' | 'char' | 'system',
  authorId: 'char_xxx' | 'me',
  content: '文本',
  attachments: [],
  swipes: ['版本1', '版本2'],     // 重 roll 产生的多个版本
  activeSwipe: 0,
  status: 'sending' | 'done' | 'error',
  error: null,
  createdAt
}
```

### 3.5 moments 朋友圈

```js
{
  id: 'mo_xxx',
  authorId: 'char_xxx' | 'me',
  text: '动态正文',
  images: [],
  location: '',
  createdAt,
  likes: ['char_xxx', 'me'],
  comments: [
    { id, authorId, text, replyTo: null | commentId, createdAt }
  ]
}
```

### 3.6 persona 我是谁

```js
{
  name: '我的名字',
  avatar: '',
  cover: '',
  signature: '',
  description: '我的人设,进入 prompt'
}
```

### 3.7 存储与迁移

- 键名统一 `phone:<collection>` 与 `phone:app:<appId>:<key>`
- 全局 `schemaVersion`,每次数据结构变更写一个 `migrate_N_to_N+1` 函数
- 适配层接口固定为 `get/set/remove/keys`,以后从 localStorage 换到 IndexedDB 不动业务代码
- localStorage 容量约 5MB,消息量大时必须切 IndexedDB,适配层保证这一步是局部改动
- 角色卡、世界书支持单文件 JSON 导入导出

---

## 4. AI 引擎

### 4.1 任务类型

引擎不只会"回一句话",它按任务类型工作:

| 任务 | 说明 | 输出 |
|---|---|---|
| `chat.reply` | 角色回复消息 | 流式文本 |
| `chat.regenerate` | 重 roll,产生新 swipe | 流式文本 |
| `chat.summarize` | 上下文超预算时压缩历史 | 文本 |
| `memory.extract` | 从近期对话提取长期记忆 | JSON 数组 |
| `moment.create` | 角色主动发朋友圈 | JSON |
| `moment.comment` | 角色评论某条动态 | JSON |
| `moment.reply` | 角色回复用户的评论 | JSON |
| `profile.update` | 角色更新签名/状态 | JSON |

### 4.2 三块结构

**A. ContextProvider 上下文提供者** - 每种上下文一个模块,只负责产出自己那一段:

```
persona     我是谁
character   角色卡(人设、场景、对话示例)
lorebook    世界书激活结果
memory      相关记忆检索结果
history     最近消息
moments     最近朋友圈
time        当前时间、距上次对话的间隔
```

**B. TaskSpec 任务定义** - 声明式,一个任务一个文件:

```js
export const momentCreate = {
  id: 'moment.create',
  context: ['persona', 'character', 'memory', 'history', 'moments', 'time'],
  instruction: '...',
  output: 'json',
  schema: { text: 'string', mood: 'string', imagePrompt: 'string|null' },
  budget: { context: 8000, output: 600 }
};
```

**新增一种 AI 行为 = 新增一个 TaskSpec 文件,引擎代码零改动。** 这是防返工的核心机制。

**B2. 可排序注入与容错**(继承自 rainyword 的 PROMPT_BLOCKS)

`chat.reply` 的上下文区块顺序对用户可配,存在 `settings.injectOrder`。
两条防御性写法必须保留,它们是"加功能不炸老数据"的实际保障:

```js
// 1. 读顺序时做清洗: 丢掉不认识的 id,补上配置里缺失的
function getInjectOrder() {
  const known = Object.keys(CONTEXT_BLOCKS);
  const seen = new Set(), out = [];
  (settings.injectOrder || []).forEach(id => {
    if (known.includes(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  });
  DEFAULT_ORDER.forEach(id => { if (!seen.has(id)) { seen.add(id); out.push(id); } });
  return out;
}

// 2. 每个区块单独 try/catch,一个区块出错不拖垮整个 prompt
for (const id of getInjectOrder()) {
  let text = '';
  try { text = CONTEXT_BLOCKS[id].build(ctx) || ''; } catch (e) { text = ''; report(id, e); }
  if (text) prompt += text;
}
```

没有第 1 条,以后每新增一个区块,老用户的 `injectOrder` 里就缺一项,
该区块永远不注入,而且是静默失败,最难排查。

**B3. 骨架的固定段落**

身份开场与风格收尾不参与排序,固定在首尾:

```
开场: 你不是AI助手。你不是在扮演角色。你就是<角色名>，正在用手机和<用户名>发消息。
收尾: 你的每次回复由1条或多条消息组成（\n\n分隔）。
      这是手机聊天。一条消息就是一个念头。
      你有自己的情绪和立场。你的反应忠于你这个人，不迁就对方。
```

"一条消息就是一个念头"直接约束了模型写长段落的倾向,是这段骨架里最有效的一句。

**C. Provider 适配层** - 统一请求与流式解析:

- Anthropic 原生 (默认模型 `claude-opus-5`)
- OpenAI 兼容 (自定义 baseURL,覆盖绝大多数中转服务)

统一的流式接口: `onDelta(text)` / `onDone(full)` / `onError(err)`。
Anthropic SSE 事件流按 `content_block_delta` 逐字追加。
浏览器直连 Anthropic 需要额外请求头 `anthropic-dangerous-direct-browser-access: true`
才能通过 CORS(实现时需实测确认)。

### 4.3 AIQueue 请求队列

**所有 AI 请求必须过队列。** 直接在组件里 fetch 是禁止的。

队列负责:
- 并发上限(默认 1-2,可配)
- 去重(同一 chat 的 reply 不允许重复入队)
- 取消(离开页面时 abort)
- 重试与退避
- 统一错误上报到通知中心

朋友圈下拉刷新可能一次触发 5 条动态生成 + 3 条评论,没有队列会瞬间打爆并发限制。

### 4.4 世界书激活算法

1. 收集候选: 角色关联的世界书 + 标记为 global 的世界书
2. `constant` 条目直接入选
3. `selective` 条目: 在扫描窗口(最近 N 条消息拼接的文本)中匹配 `keys`;
   配了 `secondaryKeys` 则需二次命中;应用 `caseSensitive` 与 `probability`
4. 按 `priority` 降序排序,按 token 预算从低优先级开始丢弃
5. 按 `position` 插入 prompt 的对应位置

世界书 app 必须提供**激活预览**: 输入一段文本,显示会激活哪些条目、各占多少 token。
没有这个调试视图,后期排查 prompt 问题只能盲猜。

### 4.5 记忆注入与提取

**注入**(`context/memory.js`):

1. 按 scope 收集: `global` + `character:<当前角色>` + `chat:<当前会话>`
2. S / A 级直接入选
3. B 级在**扫描窗口**中匹配 `keywords` 才入选
   - 扫描窗口 = 最近 N 条消息拼接的文本,与世界书共用同一个窗口
   - rainyword 原实现只扫最后一条用户消息,窗口过窄:
     上一句说"下周面试"、这一句说"好紧张",记忆就命中不了。必须改
4. C 级不注入
5. 按 rank -> 更新时间排序,**截断到 token 预算内**
   - rainyword 原实现无预算控制,记忆攒到两百条时 prompt 会溢出
   - 记忆管理页需显示"当前注入约 N token"

输出格式:

```
[对话记忆 — 基于历史对话的客观分析结果，请自然地运用这些信息]
[S/事实] ...
[A/情绪] ...
```

**提取**(`tasks/memory-extract.js`):

- 触发: 每累计 N 轮 AI 回复(`settings.autoSummarizeInterval`,0 为关闭),
  或用户在会话菜单手动"立即总结记忆"
- 输入: 记忆缓冲区的原始对话 + **已有记忆档案全文**
- 要求模型以客观第三方视角分析,明确声明"你不是对话中的任何一方"
- 去重靠两条: 提示词里要求"与已有记忆重复的不要输出",
  以及模型可返回 `updateId` 指定更新某条已有记忆而非新增
- `pending` 已有结果的标注"（已完结）",更新过的内容标注"（更新）"
- 输出严格 JSON:

```json
{"memories":[{"content":"","category":"fact","rank":"A","keywords":[],"updateId":""}]}
```

**JSON 解析必须比原实现稳。** rainyword 用 `raw.match(/\{[\s\S]*\}/)` 贪婪匹配,
模型若在 JSON 前后各写一段含大括号的文字就会连带吞掉。正确做法:
先尝试整体 `JSON.parse`,失败再扫描第一个括号平衡的对象,再失败才报错重试。

### 4.6 朋友圈闭环

```
聊天记录 + 记忆 + 角色卡
    |  moment.create
    v
角色发动态
    |  用户点赞 / 评论
    v
moment.reply  角色回复
    |
    v
动态内容写回 memories
    |
    v
影响下一次聊天的 prompt
```

触发时机: 手动下拉刷新 / 聊天结束后按概率触发 / 模拟时间流逝。

---

## 5. App 契约

系统不认识任何具体 app,只认 manifest。

```js
export const manifest = {
  id: 'chat',                    // 全局唯一,同时是 storage 命名空间与路由前缀
  name: '聊天',
  icon: 'message',               // 指向图标注册表,不是图片路径
  accent: 'var(--accent-green)', // 来自令牌
  entry: () => import('./App.js'),   // 懒加载,每个 app 独立 chunk
  permissions: ['ai', 'storage', 'notify'],
  intents: ['open:chat', 'pick:character'],   // 声明能处理什么
  settings: { /* 声明式 schema,系统自动生成设置页 */ },
  showOnHome: true
};
```

`settings` 用 schema 声明而不是每个 app 手写设置页,省掉大量重复代码和样式不一致。

**新增 app = 新建目录 + 在 `apps/index.js` 加一行。其他文件零改动。**

---

## 6. App 之间怎么打交道

只有三条合法通道,没有第四条。

### 6.1 Intent 跳转与请求

```js
phone.intent.open('chat', { chatId });            // 打开别的 app
const c = await phone.intent.request('pick:character');  // 要一个结果,带返回
```

调用方不知道谁来处理,由 manifest 声明。换实现、删 app 都不会连锁崩。

### 6.2 系统服务 共享数据不归任何 app

见第 3 节。角色卡、世界书、记忆、会话、朋友圈全在 `system/db/`。

### 6.3 事件总线 只广播系统级事件

锁屏、解锁、网络变化、通知被点击、主题切换。
业务事件一律不走总线,否则又变成隐式耦合。

---

## 7. 导航模型

双层栈,一开始就做对,否则加返回手势和多任务时必返工。

**系统层栈**: `LockScreen -> Home -> App -> AppSwitcher`
- 后台 app 保留状态不卸载,上限 5 个,超出按 LRU 回收
- 通知点击可直达某 app 的某页面

**应用层栈**: 每个 app 自己的页面栈
```js
phone.nav.push('/character/char_xxx')
phone.nav.pop()
phone.nav.replace('/')
```

chat app 内部是 tab + stack 混合:
```
chat
 |- 消息    列表 -> 会话详情
 |- 联系人  列表 -> 角色主页 -> 编辑角色卡
 |- 朋友圈  信息流 -> 动态详情
 |- 主页    我的人设 -> 我的动态 -> 编辑
```

角色主页与我的主页复用同一个 Profile 组件,只是 subject 不同。

---

## 8. 设计系统

### 8.1 布局原语

所有页面必须包在 `<Page>` 里。`<Page>` 负责 NavBar、滚动容器、安全区、底部 TabBar。
**禁止 app 自己写 overflow 和安全区计算**,这是样式 bug 的主要来源。

```
Page / NavBar / TabBar / List / ListItem / Sheet / Modal
Button / IconButton / Input / Textarea / Switch / Slider / Segmented
Avatar / Badge / Toast / EmptyState / Spinner / Skeleton
```

### 8.2 设计令牌

颜色、圆角、间距、字号、动效曲线全部在 `styles/tokens.css`。
禁止在组件里写死颜色值。深浅色主题靠覆盖变量实现。

### 8.3 尺寸与安全区

- 外壳固定 aspect-ratio,桌面端显示机身外框,移动端自动全屏
- 安全区暴露为 `--safe-top` / `--safe-bottom` 变量,app 不自己算刘海

### 8.4 图标

统一入口:

```js
<Icon name="message" size={24} />
```

- 全部 SVG,24px 网格,`stroke-width: 1.5`,`currentColor`
- path 数据集中在 `icons/paths.js`
- **零 emoji**。`scripts/check-no-emoji.mjs` 扫描全部源码的 emoji 码点,接 CI 与 pre-commit

---

## 9. 工程护栏

| 措施 | 挡住什么 |
|---|---|
| 每个 app 外包 ErrorBoundary | 一个 app 崩溃不会整机白屏,只显示"应用已停止" |
| storage 命名空间 + schema version + migration | 数据结构变更不炸历史数据 |
| 懒加载分包 | app 数量增长不拖慢首屏 |
| 依赖边界检查脚本 | 杜绝 app 互相 import |
| `scripts/new-app.mjs` 脚手架 | 每个 app 结构一致 |
| 开发模式 manifest 校验 | id 重复、图标缺失、权限未声明直接报错 |
| AIQueue 统一出口 | 并发打爆、请求泄漏、无法取消 |
| 世界书激活预览 | prompt 问题可调试而非盲猜 |

---

## 10. 目录结构

```
phone/
├─ index.html
├─ ARCHITECTURE.md
├─ README.md
├─ vendor/
│  ├─ preact.mjs
│  ├─ hooks.mjs
│  └─ htm.mjs
├─ styles/
│  ├─ tokens.css
│  ├─ base.css
│  └─ shell.css
├─ scripts/
│  ├─ check-no-emoji.mjs
│  ├─ check-boundaries.mjs
│  └─ new-app.mjs
└─ src/
   ├─ main.js
   ├─ shell/
   │  ├─ DeviceFrame.js
   │  ├─ StatusBar.js
   │  └─ HomeIndicator.js
   ├─ system/
   │  ├─ registry.js          app 注册与 manifest 校验
   │  ├─ runtime.js           生命周期、前后台、ErrorBoundary
   │  ├─ nav.js               双层导航栈
   │  ├─ intents.js
   │  ├─ bus.js
   │  ├─ notify.js
   │  ├─ store.js
   │  ├─ db/
   │  │  ├─ storage.js        localStorage 适配层
   │  │  ├─ schema.js         版本与迁移
   │  │  ├─ characters.js
   │  │  ├─ lorebooks.js
   │  │  ├─ memories.js
   │  │  ├─ chats.js
   │  │  ├─ moments.js
   │  │  └─ persona.js
   │  └─ ai/
   │     ├─ queue.js
   │     ├─ engine.js
   │     ├─ tokens.js         粗略 token 估算与预算分配
   │     ├─ context/
   │     │  ├─ persona.js
   │     │  ├─ character.js
   │     │  ├─ lorebook.js    激活算法
   │     │  ├─ memory.js      检索算法
   │     │  ├─ history.js
   │     │  ├─ moments.js
   │     │  └─ time.js
   │     ├─ tasks/
   │     │  ├─ chat-reply.js
   │     │  ├─ chat-summarize.js
   │     │  ├─ memory-extract.js
   │     │  ├─ moment-create.js
   │     │  ├─ moment-comment.js
   │     │  └─ moment-reply.js
   │     └─ providers/
   │        ├─ anthropic.js
   │        └─ openai-compat.js
   ├─ sdk/
   │  └─ index.js
   ├─ ui/
   ├─ icons/
   │  ├─ Icon.js
   │  └─ paths.js
   ├─ screens/
   │  ├─ LockScreen.js
   │  ├─ HomeScreen.js
   │  └─ AppSwitcher.js
   └─ apps/
      ├─ index.js             唯一一处列出所有 app
      ├─ chat/
      │  ├─ manifest.js
      │  ├─ App.js
      │  └─ pages/
      │     ├─ MessagesTab.js
      │     ├─ ContactsTab.js
      │     ├─ MomentsTab.js
      │     ├─ ProfileTab.js
      │     ├─ Conversation.js
      │     ├─ CharacterProfile.js
      │     └─ CharacterEdit.js
      ├─ lorebook/
      ├─ memory/
      └─ settings/
```

---

## 11. SDK 接口

app 能接触到的全部系统能力:

```js
const phone = usePhone();

phone.nav.push(path) / pop() / replace(path) / setTitle(s)

phone.storage.get(key) / set(key, v) / remove(key)      // 自动命名空间

phone.db.characters / lorebooks / memories / chats / moments / persona
   .list(filter) / get(id) / create(obj) / update(id, patch) / remove(id)
   .subscribe(fn)

phone.ai.run(taskId, params)          // 入队并返回可取消的句柄
phone.ai.stream(taskId, params, { onDelta, onDone, onError })

phone.intent.open(appId, params)
phone.intent.request(intentId, params)

phone.notify({ title, body, icon, appId, payload })

phone.ui.toast(msg) / sheet(opts) / confirm(opts) / haptic()

phone.settings.get(key) / set(key, v)
```

---

## 12. 路线图

**P0 骨架**
- shell + 内核 + sdk + 令牌 + 图标系统 + Page 原语
- 锁屏 / 桌面 / 多任务
- db 数据域 + 迁移机制
- AI 引擎 + 队列 + Anthropic/OpenAI 兼容双 provider
- 四个 app: settings / chat(四 tab) / lorebook / memory
- 检查脚本: 零 emoji、依赖边界

**P1 打磨聊天**
- 流式回复、重 roll 多版本切换、编辑消息、删除重发
- 世界书激活预览
- 自动记忆提取
- 历史压缩

**P2 朋友圈闭环**
- 动态生成、点赞、评论、回复
- 角色主页与我的主页
- 内容写回记忆

**P3 系统能力**
- 通知中心、控制中心、桌面小组件
- 主题与壁纸
- 数据导入导出

**P4 更多 app**
- 按同一套契约扩展

---

## 13. 从 rainyword 继承的设计

来源: `yu7705423-cell/rainyword`(单词学习陪伴 app,单文件 index.html)。
其 V2 的 prompt 架构与记忆系统已在真实使用中验证过,直接作为本项目的基础。

### 13.1 原样继承

| 设计 | 说明 |
|---|---|
| 可排序 prompt 区块 | 每个上下文一个 `build()`,按用户可配顺序拼接;顺序清洗 + 逐块 try/catch |
| 固定开场与收尾 | 身份声明与"一条消息就是一个念头"的回复风格约束 |
| 记忆 rank S/A/B/C | S/A 全注入,B 关键词命中,C 仅存档。可解释,用户在管理页能看懂为什么某条没生效 |
| 记忆六分类 | fact / emotion / pending / pattern / relation / profile |
| `updateId` 更新机制 | 模型指定更新已有条目而非重复新增,防记忆膨胀 |
| 提取时带入已有档案 | 配合"重复的不要输出",构成去重的另一半 |
| 记忆缓冲区独立存储 | 未总结的对话与 messages 分开,总结后清空 |
| 时间情境注入 | 现在几点 + 距上次聊天多久,转自然语言表述 |

### 13.2 搬运时必须修正

| 问题 | 原实现 | 本项目 |
|---|---|---|
| 记忆无 scope 分层 | `charMemories[charId]` 一个角色一份 | 加 `global` / `character` / `chat` 三层 |
| B 级扫描窗口过窄 | 只扫最后一条用户消息 | 扫最近 N 条消息,与世界书共用窗口 |
| 无 token 预算 | S/A 无条件全注入 | 按 rank 与新近度排序后截断,管理页显示占用 |
| 世界书过于简陋 | 仅 enabled + global/local | 补齐关键词触发、优先级、插入位置、预算(见 3.2 / 4.4) |
| JSON 解析不稳 | 贪婪正则 `/\{[\s\S]*\}/` | 整体 parse -> 括号平衡扫描 -> 报错重试 |
| 硬编码 OpenAI 格式 | 直接拼 `/chat/completions` | 走 provider 适配层 |
| 无请求队列 | 直接 fetch,总结与回复可能并发 | 统一走 AIQueue |

### 13.3 改造复用

`generateScenarioSeeds` 在原项目中为目标词生成"不含该词的话题线索",
其**两步法**(先单独生成角色近况,再由角色自然聊起)正是朋友圈动态该用的套路:

```
第一步  生成角色最近经历了什么(独立调用,产出若干条近况)
第二步  以近况为素材产出朋友圈动态 / 主动发起的聊天话题
```

对应 `tasks/moment-create.js` 与后续的"角色主动发消息"能力。

---

## 14. 待确认

1. 四个 tab 的"主页"理解为**我的**主页(我的人设、我发的动态、设置入口),
   角色主页从联系人进入,两者复用同一 Profile 组件。是否正确?
2. 是否需要群聊(多角色同一会话)。数据结构已用 `characterIds` 数组预留。
3. 朋友圈是否需要图片。若需要,是占位色块还是接图片生成 API。

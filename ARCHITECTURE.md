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
6. **可扩展到几十个 app 而不互相污染**。这是整套架构最主要的设计目标。

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
| 存储 | IndexedDB (小配置走 localStorage) | 朋友圈与头像需要存图片 Blob,localStorage 5MB 上限不够用 |
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
  images: ['img_xxx'],          // 图片 id 数组,数据本身在 images 表
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

### 3.65 stickers 表情包

```js
{
  id: 'stk_xxx',
  name: '开心',
  keywords: ['开心', '笑'],   // 输入时按这些词推荐
  group: '默认',
  imageId: 'img_xxx' | null,  // 缓存到本地后有值
  url: 'https://...' | null,  // 远程链接，二者至少有一个
  useCount: 0,
  createdAt, updatedAt
}
```

三种导入方式,都先进确认页选分组再入库:

- **批量选图** — 一次多张,文件名当名称
- **txt** — 每行一个,支持 `名称|链接`、`名称,链接`、`名称 链接`、纯链接,
  `#` 开头跳过。名称里的分隔符同时拆成关键词
- **docx** — docx 就是 zip,用 `system/unzip.js` 解开:
  正文 `word/document.xml` 按段落取文字后同 txt 解析,
  `word/_rels` 里的外部超链接一并收进来,
  `word/media/` 下的内嵌图片直接入库。
  解压用浏览器自带的 `DecompressionStream('deflate-raw')`,不引第三方库

链接类的先按原样存,页面上提供一键「缓存到本地」;跨域取不回来的保留链接,
并在结果里明确报数,不静默失败。

### 3.7 images 图片

朋友圈配图、角色头像、背景图全部由用户本地上传,不走网络。

```js
// images 表
{ id: 'img_xxx', blob: Blob, w, h, bytes, createdAt }
```

规则:

- **以 Blob 存 IndexedDB,不存 base64。** base64 体积涨约 33%,
  且会让承载它的 JSON 记录变得极大,解析明显变慢
- 上传即压缩: canvas 缩放到长边 1280,`toBlob('image/webp', 0.82)`;
  头像长边 256。原图不保留
- 展示用 `URL.createObjectURL(blob)`,组件卸载时必须 `revokeObjectURL`,
  否则每次滚动朋友圈都在泄漏内存
- 业务记录里只存图片 id,取用时按 id 拉 Blob
- 朋友圈单条最多 9 张
- 设置页提供存储占用统计与清理孤儿图片的入口

### 3.8 layout 主界面布局

主界面的网格摆放、挂件尺寸、分页、Dock 内容都要持久化。

```js
{
  pages: [
    { id: 'p1', cells: [
        { id, kind: 'widget',      ref: 'header',       x: 0, y: 0, w: 4, h: 1 },
        { id, kind: 'app',         ref: 'lorebook',     x: 0, y: 1, w: 1, h: 1 },
        { id, kind: 'app',         ref: 'memory',       x: 1, y: 1, w: 1, h: 1 },
        { id, kind: 'widget',      ref: 'recent-chats', x: 2, y: 1, w: 2, h: 2 },
        { id, kind: 'placeholder', label: '待开发',      x: 0, y: 2, w: 1, h: 1 },
        { id, kind: 'placeholder', label: '待开发',      x: 1, y: 2, w: 1, h: 1 },
        { id, kind: 'widget',      ref: 'moments-peek', x: 0, y: 3, w: 2, h: 2 },
        { id, kind: 'placeholder', label: '待开发',      x: 2, y: 3, w: 1, h: 1 },
        { id, kind: 'placeholder', label: '待开发',      x: 3, y: 3, w: 1, h: 1 },
        { id, kind: 'placeholder', label: '待开发',      x: 2, y: 4, w: 1, h: 1 },
        { id, kind: 'placeholder', label: '待开发',      x: 3, y: 4, w: 1, h: 1 }
    ]},
    { id: 'p2', cells: [] }
  ],
  dock: ['chat', 'settings', 'contacts', 'notes'],
  currentPage: 0,
  wallpaper: { home: 'img_xxx', lock: 'img_xxx' }
}
```

坐标显式存储,`x` 取值 0-3。不使用 CSS 自动流: 混合尺寸下自动流的结果不可预测,
且拖拽排序本来就需要显式坐标。

**自愈规则**(与 4.2 的 `getInjectOrder()` 是同一类问题,同样必须有):

- 单元引用了已不存在的 app 或挂件 -> 转为 placeholder,保住版式不塌
- 已注册但未出现在任何页面、也不在 Dock 里的 app -> 优先占用最近的
  placeholder 位置,没有则追加到最后一页空位,不够则新建一页
- 单元重叠或越界(`x + w > 4`)-> 按顺序重新落位
- Dock 引用了不存在的 app -> 转为 placeholder;Dock 不足 4 个 -> 补 placeholder
- 空页面自动删除,第一页除外;`currentPage` 越界 -> 归零

没有这套自愈,以后每删一个 app 或每加一个挂件,主界面就可能出现空洞、
重叠或漏图标,而且是静默的。

### 3.9 存储与迁移

**主存储是 IndexedDB。** localStorage 仅用于极小的配置(当前主题、上次打开的 app)。

早前曾计划 localStorage 先行、后续再切 IndexedDB,该方案已作废:
本地上传图片使得容量需求远超 localStorage 的 5MB 上限,而超限是抛异常,
会导致该域下所有写入一起失败,不是可以推迟处理的问题。

- 键名统一 `phone:<collection>` 与 `phone:app:<appId>:<key>`
- 全局 `schemaVersion`,每次数据结构变更写一个 `migrate_N_to_N+1` 函数
- 适配层接口固定为 `get/set/remove/list/query`,业务代码不直接碰 IndexedDB API
- 角色卡、世界书支持单文件 JSON 导入导出;
  含图片时打包为 zip 或内联 base64(仅导出时转换)

---

## 4. AI 引擎

### 4.1 任务类型

引擎不只会"回一句话",它按任务类型工作:

| 任务 | 说明 | 输出 |
|---|---|---|
| `chat.reply` | 角色回复消息 | 流式文本,可含图片与语音标记 |
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

身份开场与风格收尾不参与排序,固定在首尾。

```
开场:
你不是AI助手。你不是在扮演角色。你就是<角色名>，正在用手机和<用户名>发消息。

收尾:
你的每次回复由1条或多条消息组成（\n\n 分隔）。

这是手机聊天。真人打字是不均匀的：
有时候一条很长，有时候几个字就发出去；
一句话可能拆成两条，三件事也可能挤在一条里。
说岔了会补一句，想起来还会再补一句。
不是每条消息都有信息量——废话、语气词、没说完的半句，都正常。
对方说了三件事，你可能只接住了其中一件。

你有自己的情绪和立场。你的反应忠于你这个人，不迁就对方。
```

关于收尾这段的取舍: rainyword 原文是"一条消息就是一个念头"。
它确实压住了长段落,但把模型推向了另一个极端——每条消息都成为
干净、完整、有信息量的单元,气泡长度趋于一致,每条都在推进对话。
真人聊天的本质特征是**不均匀**,以及**不周到**(对方说三件事,
真人常常只接住一件)。现在这版针对的是后者。

**B4. prompt 模板可编辑**

骨架的开场、收尾,以及每个 TaskSpec 的 instruction,**一律不写死在代码里**,
而是作为默认值存入 `settings.promptTemplates`,在设置页可编辑,并提供"恢复默认"。

```js
settings.promptTemplates = {
  'skeleton.opening': '...',
  'skeleton.closing': '...',
  'task.memory-extract': '...',
  'task.moment-create': '...'
}
```

这类 prompt 需要长期反复调整,写死意味着每次改语气都要改代码。
代码里只保留 `DEFAULT_TEMPLATES`,运行时一律从 settings 读取,缺失时回落到默认值。

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

朋友圈配图由用户本地上传,不由 AI 生成。`moment.create` 产出的是文字,
是否配图、配什么图由用户在发布时自行选择。

### 4.55 从文字导入记忆

`system/ai/tasks/memory-import.js`。从别处复制一大段文字粘进来，拆成一条条结构化记忆。

**拆分靠聊天模型，不是向量接口** —— 向量接口只负责把文字变成向量。
两件事在界面上也说清楚了，免得误会。

- **分段**：按空行切段再攒到接近 2400 字；单段就超长的按句号切，不在句子中间硬断。
  太长喂给模型它会偷懒漏东西。
- **去重**：把已有记忆和前面几段已经拆出来的都算进去，按「去掉空白后转小写」比对。
- **先预览再入库**：`parse()` 只解析不写库，界面上列出来让人勾掉不要的，
  再 `commit()` 一次性写进去。一大段文字拆出几十条，总有几条是废话。
- 写进去之后 `touchVec()` 排队补向量，配了向量接口就自动索引。

入口在记忆 app 的右上角，以及空列表时的那个按钮 —— 记忆库自己的事放在记忆库里。

### 4.6 向量记忆

记忆检索从「硬碰关键词」换成「按意思找」。`system/ai/embed.js` + `system/ai/memvec.js`。

- **接口**：OpenAI 那套 `/v1/embeddings`，OpenAI 本体、大多数中转站、本地 Ollama
  都是这个形状。配置在 `services.embed`，属于「服务」，和聊天/语音/生图一样放全局设置。
- **向量存在记忆记录自己身上**（`m.vec`），类型是 `Float32Array` ——
  IndexedDB 的结构化克隆原生支持，比存 JSON 数字数组小一半还多。
- **存之前归一化**，检索时余弦相似度就退化成点积，省一半计算。
- **建索引是批量的**，接口本来就收数组，9 条记忆一次请求发完。
- **查询向量按文本缓存**（`embedQuery`），同一个扫描窗口连发几轮不会重复算。

检索规则（`selectByVector`）：

1. **S 级永远钉死** —— 身份级的事实，不该由相似度决定进不进，也不占 topK 名额
2. 其余按相似度排，取前 topK，低于门槛的丢掉
3. **关键词命中的直接算满分** —— 明确信号不该被相似度压下去

**三处回落，任意一处不通都不影响聊天**：接口没配、还没补向量、这一轮取向量失败，
都会落回原来的 `select()`（S/A 全注入 + B 关键词命中）。`queryVecFor()` 只警告不抛。

换了嵌入模型，旧向量和新查询就没法比了，`isStale()` 按 `vecModel` 判定，
界面上直接显示「差 N 条」。

`buildChatSystem` 是同步的，算向量要发请求，所以查询向量由 `queryVecFor()`
在外面先算好、作为 `opts.queryVec` 传进去。

开关分两处，按 CLAUDE.md 第 5 条：接口在 `设置 - 向量`（全局服务），
怎么用它在 `会话菜单 - 上下文与记忆 - 怎么找记忆`（这段对话的检索行为）。

### 4.65 一轮回复如何落成多条消息

真人是一条一条发的,所以一次生成不再是一个大气泡。

**标记**。回复里可以出现两种标记,由模型自己决定什么时候用:

```
[图片：画面的描述]      交给生图接口
[语音：要说的话]        交给语音接口
```

中英文冒号、半角与全角方括号都认。只有在对应接口配好、且角色卡上开了
对应开关时,才会把这段说明加进 system prompt——没配却让它发,只会生成失败。

**拆分与送达**。流式先打进一条临时的「正在输入」,结束后删掉它,
把原文按空行和标记拆成若干条,**逐条插入并按长度停顿**,读起来像真人在打字。

**一轮**。同一次生成的所有消息共用 `turnId`,原文与候选只挂在这一轮的第一条上。

- 重新生成:整轮删掉再生成,新原文追加进候选
- 左右切换候选:**不再调接口**,拿存下来的原文整轮重放,且不停顿

**媒体是异步补上的**。图片和语音消息先以 `media: 'pending'` 落库,
生成完再回填 `imageId` / `audioId`;失败则记 `media: 'error'` 并保留原因,
界面上直接显示为什么没出来,不静默失败。

音频存在独立的 `files` 仓库(images 那边会压缩,音频不能压),
每条语音可以单独存到本地。

### 4.68 主动消息

角色不等你开口，自己挑时间发消息来。`system/ai/proactive.js`。

调度是一个 20 秒一次的轮询，跟着外壳的生命周期跑，所以开着哪个 app 都在数时间。
下一次的落点存在 `localStorage`（设备本地的临时状态，不进 IndexedDB）。

- **随机**：落点在 `平均间隔 x 0.5` 到 `x 1.5` 之间掷。定死间隔会像闹钟，随机才像人。
- **免打扰**：撞进时段里就把落点推到时段结束，不是丢掉。起止填成同一个数表示不设。
- **挑人**：单人会话、角色没关掉 `proactive`、当前没在生成、堆积未读没超上限，几个条件里随机选一个。
- **不灌**：堆了 `maxUnread` 条没看就先停，等你看了再继续。
- **页面关着不跑**。重新打开时如果早就该发了，挪到十几秒到一分钟之后再发，
  像是刚好这会儿想起你，而不是开机就炸一串。

生成走 `task.proactive` 模板，接在正常的聊天 system prompt 后面，
历史末尾补一条「现在由你主动开口」的 user 消息，再用 `renderTurn` 按一条条的节奏送达。
送达后累加 `chat.unread` 并发一条通知；会话开着的时候 Conversation 会立刻把未读清零。

开关按角色单独配，入口在**会话右上角菜单的「主动找我」**，不在全局设置里
（见 CLAUDE.md 第 5 条）。每个角色自己一个落点，存在 `localStorage` 的一张
 charId 到时间戳的表里；角色删掉，落点跟着清。

### 4.69 通知横幅与提示音

`notify()` 只管发出一条通知并广播 `EVENTS.notify`，它不知道会被怎么呈现。
听这个事件的有两处：`shell/NotifyBanner.js` 负责从顶上掉下来的横幅，
`system/sound.js` 负责响一声。锁屏上的通知列表另外直接读 `notifications` 这个 store。

- **提示音不放音频文件**。预设一律用 WebAudio 现场合成（起音 8ms、指数衰减，
  听着像敲出来的而不是蜂鸣器），想要真实录音就自己传一个，存进 `files` 域。
  iOS 上 AudioContext 必须由一次真实触摸唤醒，`installUnlock()` 在外壳挂载时
  就绑好第一次 touch/click。
- **正开着那个会话就不弹**，人就在看，真机也是这么做的。
- 点横幅或点锁屏上的通知，都走 `EVENTS.notificationOpen`，
  由 `system/intents.js` 统一转成 `open(appId, payload)`。通知自己不认识路由。
- 横幅的安全区要在 `.banner-host` 上再让一次：绝对定位是贴着 `.root` 的
  padding box 算的，量不到 `.root` 自己的 `padding-top`。

开关在 `设置 - 通知`（横幅、提示音、音量、试一条）。这是整机行为，不属于某个角色，
所以放全局设置里不违反 CLAUDE.md 第 5 条。

### 4.695 系统通知与 Web Push

`sw.js` 是整个项目唯一的 Service Worker，**故意没有 fetch 处理函数，一个字节都不缓存**。
无构建方案已经被 HTTP 缓存坑过一次（所以才有「强制更新」），再叠一层 SW 缓存只会更难查。
它存在的唯一理由是 Web Push 规定必须要有 SW。

三条通知路径，互不替代：

| | 谁弹 | 什么时候有效 |
|---|---|---|
| 应用内横幅 | `shell/NotifyBanner.js` | 页面在前台 |
| 系统通知 | `sw.registration.showNotification()` | 页面还活着（含刚退到后台的几秒） |
| Web Push | 推送服务把 `push` 事件送到 SW | **app 完全关着也行，但必须有服务器发** |

`system/push.js` 是客户端这一半：注册 SW、申请权限、订阅、退订、点击回跳。
页面不在前台（`document.visibilityState !== 'visible'`）且开了「交给系统弹」时，
`EVENTS.notify` 就转给系统通知，不再弹应用内横幅。

几个踩过的点：

- iOS 只给**添加到主屏幕之后的 PWA** 发系统通知。标签页里授权了也不会响，
  所以设置页会检测 `display-mode: standalone` 并直说。
- **收到 push 却没弹通知，iOS 会直接把订阅作废**。所以 `sw.js` 里三种负载
  （正常 JSON、解析失败、完全为空）都保证走到 `showNotification`。
- iOS 上不能用 `new Notification()`，只有 SW 的 `showNotification` 有效。
- 换了 VAPID 公钥必须先 `unsubscribe` 再订，否则服务器推不动。

**服务器那一半本项目不提供。** 要真正在 app 关着时叫醒手机，需要：
生成一对 VAPID 密钥，公钥填进设置页，订阅对象交给服务器保存，
服务器用 `web-push` 之类的库往 `subscription.endpoint` 发加密负载
（`{ title, body, route, appId }`）。设置页留了「订阅上报地址」和「复制订阅」两条路。

### 4.7 群聊

一个会话可以挂多个角色(`chat.characterIds` 为数组)。

**生成方式**: 默认每个角色独立调用,各自只看到自己的角色卡。

| | A. 独立调用(默认) | B. 一次生成整段 |
|---|---|---|
| 人设纯粹度 | 高,角色之间不串味 | 低,角色容易同质化 |
| token 成本 | 高,N 个角色 N 次请求 | 低 |
| 节奏 | 由调度器决定谁开口 | 由模型自行安排 |

选 A 为默认: 角色人设不互相污染是角色扮演的核心价值,
B 生成出的多个角色往往说话像同一个人。B 作为设置项保留,不改变数据结构。

**发言调度器** (`system/ai/scheduler.js`) 决定一轮里谁开口、开口几个、顺序如何:

- 被 `@` 或被点名的角色必定开口,优先级最高
- 其余角色按话题相关度(关键词命中角色卡与记忆)加随机权重抽取
- 单轮开口角色数有上限,默认 1-2 个,可配
- 同一角色不连续开口两轮,除非被点名

**群聊 prompt 附加**:

- 注入"当前群里有谁"(其他成员的名字与一句话印象,不注入完整角色卡)
- 最近若干条消息需带说话人姓名,角色才知道在跟谁对话
- 记忆 scope 用 `chat:<id>`,群里发生的事不污染与该角色的私聊

---

### 4.9 账号与小号

用户人设从「只有一个」变成一棵两层的树。`system/accounts.js`。

```
大号 A ─┬─ 小号 A2        同一个人的两个身份
        └─ 小号 A3
大号 B                    另一个人，和 A 完全无关
```

数据上：`personas` 集合，`parentId` 为空就是根账号（大号）。
`chats` 和 `memories` 都带 `personaId`。迁移 2 把原来那份单一 `persona` KV
收成根账号，已有会话和记忆全部挂到它名下，等于原封不动地成为大号。

**会话属于「身份 + 角色」这一对**，不是只属于角色。换成小号去找同一个角色，
开的是一段新对话，两边互不相干。

记忆的可见性只有两条规则：

1. **不同根账号之间一条都不给。** 按 `rootIdOf` 过滤，另一个大号的事完全看不到。
2. **同一个根下面互相可见，但会点名是关于谁的。** 大号的记忆对小号可见，
   因为角色还是同一个角色，它确实记得那些事；但注入时会标成「（关于大号）」，
   而不是「关于你现在在聊的这个人」。

和小号说话时，`context/basic.js` 的 user 块额外注入一段关系说明：
你不认识这个人，这是第一次说上话；你自己的经历和你跟大号之间的事都还在；
但没有理由把眼前这个人和大号联系起来；标着「关于某某」的是别人的事，别张口就提。

角色也能开小号，走同一个 `parentId` 字段。角色的小号和本体是两个独立的对话对象，
记忆各算各的（它们的 `scope` 本来就是 `character:<id>`）。

切换入口在「联系」app 首页，小号在各自账号的页面里开。
未读徽标、消息列表、主动消息都按当前账号过滤 —— 换了账号，
别的身份那边的会话不该突然冒出新消息。

### 4.8 「联系」app：人设归它管

`apps/contact/`。一个专门写人设的 app，因为人设是一整页长文，塞在角色卡里
一打开满屏都是它，别的设置全被挤到看不见。

界限是这样划的：

| | 在哪 | 装什么 |
|---|---|---|
| 这个人是谁 | **联系** app | 头像、名字、签名、人设、情境、开场白、说话示例；我的人设也在这儿 |
| 她在对话里怎么表现 | 会话右上角的**角色卡** | 音色、语速、发语音、发图片、主动找我、关联世界书 |

角色卡顶上留一行跳进「联系」，联系里也写明行为设置在哪儿，两边互相指得到。

跨 app 一律走 Intent（`phone.intent.open('contact', { route })`），
聊天 app 不 import 联系 app —— CLAUDE.md 第 6 条。

同一个入口只有一处（第 5 条）：原来「主页」tab 里那个「我的人设」弹层、
联系人长按菜单里的「编辑角色卡」都改成跳转，不再各自复制一份编辑界面。

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

双层栈。一开始就做对,否则加返回手势和多任务时必返工。

**系统层栈**: `LockScreen -> Home -> App -> App 内页面`

- Dock 是快捷方式,不构成导航层级,从 Dock 进 app 与从网格进完全一样
- 后台 app 保留状态不卸载,上限 5 个,超出按 LRU 回收
- 覆盖层不入栈: AppSwitcher / Sheet / Modal / Toast
- 通知点击可直达某 app 的某页面

**应用层栈**: 每个 app 自己的页面栈

```js
phone.nav.push('/character/char_xxx')
phone.nav.pop()
phone.nav.replace('/')
phone.nav.home()          // 回到主界面
```

- 返回手势只在当前 app 的栈内退,退到栈底再返回则回主界面
- 每个 app 的栈独立保存,切走再切回保留原位置

chat app 内部是 tab + stack 混合:

```
chat
 |- 消息    列表 -> 会话详情
 |- 联系人  列表 -> 角色主页 -> 编辑角色卡
 |- 朋友圈  信息流 -> 动态详情
 |- 主页    我的人设 -> 我的动态 -> 编辑
```

chat 的四个 tab 是**应用内**的分区,与系统层无关,各自保留滚动位置与页面栈。
角色主页与我的主页复用同一个 Profile 组件,只是 subject 不同。

---

## 8. 系统界面

手机壳这一层是用户第一眼看到的东西,单独定义清楚,不要留给实现时临时发挥。

整体取向: **黑白,不用灰作为填充色。**
层次靠留白、发丝线和阴影做;次级文字用黑或白降低不透明度,不引入灰色相。
应用图标一律纯白底 + 黑色 SVG,带一点点阴影。大量留白,简约来自克制而非装饰。

### 8.1 全屏根容器

**不画机身外框、不画刘海、不做投影。** 界面直接铺满视口,桌面与移动端一致。

**整个项目只有一处使用视口单位**,在根容器上,而且它只是兜底:

```css
.root { height: var(--app-h, 100vh); }
```

手机浏览器里视口单位算的是地址栏收起后的高度,比实际可视区高一截,
底部内容会被压到屏幕外且无法滚动到(`body` 是 `overflow: hidden`)。
所以由 `shell/Root.js` 量出真实可视高度写进 `--app-h`,
**只在宽度变化(横竖屏切换)时重算**;地址栏显隐只改高度,一律忽略。
这样既不会被切掉,也不会像 `dvh` 那样随滚动抽动。

其余所有高度由 flex 与 grid 按比例分配,不再出现任何视口单位。

```css
.root      { height: 100vh; display: flex; flex-direction: column; }
.statusbar { height: var(--statusbar-h); flex: none; }
.screen    { flex: 1; min-height: 0; overflow: hidden; }
.dock      { height: var(--dock-h); flex: none; }
```

`min-height: 0` 不能省。flex 子项默认 `min-height: auto`,
内容一旦超高就会把容器撑破,导致 Dock 被挤出屏幕。

禁止 `dvh` / `svh` / `lvh`,理由与强制手段见 `CLAUDE.md`。

### 8.2 StatusBar 状态栏

左侧真实时间(HH:MM),右侧信号、Wi-Fi、电量三个 SVG 图标。

**可开关,默认自动。** 移动端浏览器本身就带状态栏,再画一条就是双份。
设置项 `statusBar` 取三个值:

| 值 | 行为 |
|---|---|
| `auto`(默认) | 触摸设备(`pointer: coarse`)自动隐藏,桌面端显示 |
| `on` | 始终显示 |
| `off` | 始终隐藏 |

- 时间每分钟更新,且对齐到下一个整分,不做每秒轮询
- 电量优先读 `navigator.getBattery()`,不可用时不显示数字
- 前景色由当前页面声明: `<Page statusBarStyle="light|dark">`,
  壁纸深浅不同时状态栏需要反色,这个不能写死

### 8.3 LockScreen 锁屏

- 壁纸(用户上传,走 images 域)
- 大时钟 + 日期,字重轻,居上
- 通知列表: 角色发来的消息聚合展示,点击直达该会话
- 上滑解锁。无密码,这不是安全功能,只是一个入口仪式

### 8.4 HomeScreen 主界面

**不是 iOS 式的等距图标海。** 采用横条 + 方形挂件混排的卡片式布局。

```
┌──────────────────────────────┐
│ 状态栏                        │
├──────────────────────────────┤
│ [       横条挂件           ]  │  4 x 1
├─────────────┬────────────────┤
│  app   app  │                │
│             │   方形挂件      │  左 2x2 放四个 app
│  app   app  │                │  右 2x2 一个方形
├─────────────┼────────────────┤
│             │  app   app     │
│  方形挂件    │                │  下一块左右对调
│             │  app   app     │
├─────────────┴────────────────┤
│  [app]  [app]  [app]  [app]  │  底部 Dock,四个 app
└──────────────────────────────┘
```

**网格**

- 4 列,`grid-template-columns: repeat(4, 1fr)`
- 行高由容器均分,`grid-auto-rows: 1fr`,**不写死像素也不用视口单位**
- 单元支持跨格: app 为 1x1,方形挂件 2x2,横条挂件 4x1
- 使用**显式坐标**而非 `auto-flow: dense`。自动流在混合尺寸下结果不可预测,
  且拖拽排序本来就需要显式坐标

**挂件(widget)**

挂件是主界面上的活内容,不是装饰:

| 挂件 | 尺寸 | 内容 |
|---|---|---|
| `player` | 4x2 | 播放器版式:一侧圆角方形封面,旁边三行可各自选字号的文本 |
| `note` | 2x1 / 2x2 / 4x1 / 4x2 | 纯文字块,两行,各自选字号,可切衬线 |
| `photo` | 2x2 / 4x2 / 2x1 | 整块图片,底部可加一行说明 |
| `clock` | 2x1 / 2x2 / 4x1 | 时间与日期 |
| `recent-chats` | 2x2 / 4x2 | 最近会话与未读 |
| `moments-peek` | 2x2 / 4x2 | 最新一条朋友圈预览 |
| `memory-count` | 2x2 / 2x1 | 记忆条数与最近新增 |

每个挂件声明自己支持的尺寸列表(`sizes: [[w, h], ...]`),
放置时按尺寸逐一列出,同一个挂件可以以不同大小出现。

挂件与 app 一样由 manifest 声明(见 5. App 契约的 `widgets` 字段),
主界面不认识具体挂件,只按 id 渲染。新增挂件不改主界面代码。

**挂件可以有自己的配置**,存在所属单元的 `cell.config` 里,`render(cell)` 时读取。
声明 `editable: true` 的挂件在主界面上直接点击即可打开编辑器。
顶部横条就是这样:封面本地上传,三行文字与封面左右位置都可改。

**app 图标可以覆盖**。`settings.appIcons[appId]` 存 `{ icon }`,
`system/look.js` 的 `appLook()` 把 manifest 默认值与用户自定义叠加,
主界面、Dock、多任务卡片统一走它。

**用户自定义 CSS**。`settings.customCSS` 注入到一个独立的 `<style id="user-css">`,
覆盖默认外观,随时可清空恢复。设置页里列出常用类名,并支持从文件导入。
它是最后一道样式,不受令牌约束——这是有意的口子,让你能彻底改外观而不用改代码。

**app 图标**

- 圆角矩形(圆角为边长的 24%),**纯白底 + 黑色 SVG**,带一点点阴影
- SVG 占图标宽度的 58%,比之前明显放大
- 下方名称 11px 单行省略
- 未读角标在右上角,数字超过 99 显示 99+

三项在主题设置里可调,通过根元素的 CSS 变量与标记位统一生效:

| 设置 | 作用 |
|---|---|
| `iconColor` | 所有 SVG 的描边颜色,写进 `--icon-color` |
| `iconShadow` | 图标阴影开关,写进 `data-icon-shadow` |
| `iconLabels` | 图标名称显示与否,写进 `data-icon-label` |

每个 app 还能单独换成图标表里的任意一个(`settings.appIcons[appId].icon`)。
不再有每个 app 各自的底色。

**编辑模式**

长按进入,图标与挂件一起抖动。点任意位置弹出该位置的菜单:

- **放一个小组件** — 按尺寸列出全部挂件
- **放一个应用** — 列出全部已注册的 app
- **和别的位置交换** — 接着点另一个同样大小的位置
- **移除** — 原地留下等大的占位格

放大尺寸时会吃掉被覆盖的占位格;若压到非占位的格子则拒绝并提示。
移除的是主界面上的位置,不删数据。

放好之后,声明了 `editable` 的挂件在**非编辑模式下**直接点它即可改图和文字。

**分页**

- 主界面可以有多页,横向滑动切换
- 页面指示点在网格下方、Dock 上方,当前页高亮
- 编辑模式下拖拽到屏幕边缘停留可翻页;拖到最后一页右缘可新建一页
- 页面为空时自动删除(第一页除外)

**占位 app**

第一版会有大量位置还没有对应的 app。放 `placeholder` 类型的单元占位:
灰色底、虚线描边、点击提示"待开发"。这样主界面从第一天就是完整的版式,
以后往里填真 app 时只是替换单元的 `ref`,布局不动。

### 8.5 底部 Dock

**系统级常驻的四个 app 图标**,不是 tab 栏,不承担导航分区的职责。

- 固定高度 `--dock-h`,不随分页横滑,始终显示同样四个 app
- **背景透明、无边框**,与页面同底。早前给它加过一层衬底与上边框,
  结果在主界面底部切出一条明显的色带;导航栏当时用 `--surface` 也有同样问题,
  在每个 app 页的顶部切出一块白板。两处都改为与页面同底
- 容量固定 4 个。编辑模式下可与网格里的 app 互换;
  拖入第五个时最右侧那个退回网格
- 未读角标同样显示

Dock 只是快捷方式,点击进入 app 的行为与从网格点进去完全一样,
不产生额外的导航层级。

### 8.6 壁纸

- 用户从本地上传,走 images 域,压缩规格同 3.7
- 主界面与锁屏可分别设置
- 内置若干纯色与极简渐变作为默认,不内置照片类壁纸

### 8.7 后续(P3)

控制中心(上滑/下拉面板: 主题切换、字号、勿扰)、通知中心、桌面小组件。
这三项的入口手势在 8.1 的外壳层预留,实现推迟。

---

### 8.75 自定义字体

`system/fonts.js`。字体文件存进 `files` 域（二进制，不压缩），
用 `FontFace` 直接喂 `ArrayBuffer` 注册 —— 比 blob URL 稳，不用猜 `format()`，
ttf / otf / woff / woff2 一视同仁。family 名用记录 id（`uf-<id>`），
保证不和系统里同名字体打架。

两个槽位：`--font`（正文）和 `--font-serif`（挂件里勾了「衬线」的那几行）。
选中之后立刻把 CSS 变量设上去，加载还没完成时浏览器自己会回落到后面的系统字体，
不会白屏；加载失败就把变量摘掉。

- 传进来先 `FontFace.load()` 验一遍，坏文件直接报错，不存进库。
- 删掉正在用的字体会自动把槽位清空并回落，不会指向一个不存在的 family。
- `fontBody` / `fontSerif` 在 `LOOK_KEYS` 里，外观预设会带上。
- 中文字体动辄十几 M，界面里直接标出体积。

入口在 `设置 - 主题`，和别的观感设置在一起。

### 8.8 外观预设

`system/looks.js`。把整套装修拍个快照存进 `looks` 数据域（IndexedDB，DB_VERSION 提到 4），
随时切回去。

存的是**外观**，不是内容：`layout` 整份（图标位置、挂件、底部那一排、壁纸引用）
加上 `settings` 里 `LOOK_KEYS` 列的那几项（深色、图标颜色/阴影/名称、底部上移、
自定义 CSS、状态栏、锁屏）。接口密钥、prompt 模板、上下文参数一概不拍。

两个要当心的地方：

- **预设只存图片 id，不存图片本身。** 所以「清理无引用图片」必须把
  `looks.allImageIds()` 也算进已用集合，否则一清理，存好的预设全成空壳。
  `apply()` 里还兜了一层：图确实没了就当没设过，不会把界面搞成空白，
  并在 toast 里说明少了几张。
- 应用时 `layout` 用 `replace` 整份覆盖，不是 `set` 合并 —— 合并的话
  旧版式里多出来的格子会残留下来。

入口在 `设置 - 主题`，和它存的那些东西在同一页，符合 CLAUDE.md 第 5 条。

## 9. 设计系统

### 9.1 布局原语

所有页面必须包在 `<Page>` 里。`<Page>` 负责 NavBar、滚动容器、安全区,
以及**应用内** TabBar(如 chat 的四个分区)。系统级的 Dock 不归 `<Page>` 管,
它在根容器层,见 8.5。
**禁止 app 自己写 overflow 和安全区计算**,这是样式 bug 的主要来源。

```
Page / NavBar / TabBar / List / ListItem / Sheet / Modal
Button / IconButton / Input / Textarea / Switch / Slider / Segmented
Avatar / Badge / Toast / EmptyState / Spinner / Skeleton
```

### 9.2 设计令牌

颜色、圆角、间距、字号、动效曲线全部在 `styles/tokens.css`。
禁止在组件里写死颜色值。深浅色主题靠覆盖变量实现。

### 9.3 尺寸与安全区

- 全屏铺满,不存在机身外框
- 根容器 `height: 100vh`,是全项目唯一的视口单位
- 其余高度由 flex 与 grid 分配,flex 子项记得 `min-height: 0`
- 安全区用 `env(safe-area-inset-*)` 换算为 `--safe-top` / `--safe-bottom`,
  由根容器统一计算,页面与 app 不自己算

### 9.4 图标

统一入口:

```js
<Icon name="message" size={24} />
```

- 全部 SVG,24px 网格,`stroke-width: 1.5`,`currentColor`
- path 数据集中在 `icons/paths.js`
- **零 emoji**。`scripts/check-no-emoji.mjs` 扫描全部源码的 emoji 码点,接 CI 与 pre-commit

---

## 10. 工程护栏

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
| 图片上传强制压缩 + objectURL 回收 | 存储膨胀与滚动列表的内存泄漏 |
| prompt 模板与代码分离 | 调语气不用改代码,也不会误伤逻辑 |
| 主界面布局自愈 | 增删 app 或挂件后出现空洞、重叠、漏图标 |
| 视口单位检查脚本 | dvh 混入导致地址栏显隐时界面抽动错位 |

---

## 11. 目录结构

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
│  ├─ doctor.mjs           一次跑完下面全部检查
│  ├─ check-no-emoji.mjs
│  ├─ check-units.mjs      拦截 dvh / svh / lvh
│  ├─ check-boundaries.mjs
│  ├─ check-tokens.mjs     拦截硬编码颜色
│  └─ new-app.mjs
└─ src/
   ├─ main.js
   ├─ shell/
   │  ├─ Root.js              100vh 根容器,全项目唯一视口单位
   │  ├─ StatusBar.js         时间、信号、Wi-Fi、电量
   │  ├─ Dock.js              系统级底部四个 app
   │  └─ Gestures.js          上滑、返回手势
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
   │  │  ├─ images.js         图片 Blob 读写与压缩
   │  │  ├─ layout.js         桌面布局
   │  │  └─ persona.js
   │  └─ ai/
   │     ├─ queue.js
   │     ├─ engine.js
   │     ├─ scheduler.js      群聊发言调度
   │     ├─ templates.js      prompt 默认模板
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
   │  ├─ LockScreen.js        时钟、通知、上滑解锁
   │  ├─ home/
   │  │  ├─ HomeScreen.js     4 列网格,显式坐标
   │  │  ├─ Pager.js          多页横滑与指示点
   │  │  ├─ AppIcon.js        图标、角标
   │  │  ├─ WidgetHost.js     按 id 渲染挂件,不认识具体挂件
   │  │  ├─ EditMode.js       长按拖拽、改尺寸
   │  │  └─ layout.js         布局读写与自愈
   │  └─ AppSwitcher.js       多任务卡片
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

## 12. SDK 接口

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

## 13. 路线图

**P0 骨架**
- shell + 内核 + sdk + 令牌 + 图标系统 + Page 原语
- 系统界面: 全屏根容器、状态栏、底部 Dock、锁屏、主界面(4 列网格 + 挂件 + 多页翻页 + 编辑模式)、多任务
- 主界面布局持久化与自愈、挂件宿主、placeholder 占位、壁纸上传
- db 数据域(IndexedDB)+ 迁移机制 + 图片压缩存取
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
- 本地图片上传、九宫格、存储占用统计
- 角色主页与我的主页
- 内容写回记忆
- 群聊与发言调度

**P3 系统能力**
- 通知中心、控制中心、桌面小组件
- 主题与壁纸
- 数据导入导出

**P4 更多 app**
- 按同一套契约扩展

---

## 14. 从 rainyword 继承的设计

来源: `yu7705423-cell/rainyword`(单词学习陪伴 app,单文件 index.html)。
其 V2 的 prompt 架构与记忆系统已在真实使用中验证过,直接作为本项目的基础。

### 14.1 原样继承

| 设计 | 说明 |
|---|---|
| 可排序 prompt 区块 | 每个上下文一个 `build()`,按用户可配顺序拼接;顺序清洗 + 逐块 try/catch |
| 固定开场 | 身份声明: "你不是AI助手...你就是X,正在用手机发消息" |
| 记忆 rank S/A/B/C | S/A 全注入,B 关键词命中,C 仅存档。可解释,用户在管理页能看懂为什么某条没生效 |
| 记忆六分类 | fact / emotion / pending / pattern / relation / profile |
| `updateId` 更新机制 | 模型指定更新已有条目而非重复新增,防记忆膨胀 |
| 提取时带入已有档案 | 配合"重复的不要输出",构成去重的另一半 |
| 记忆缓冲区独立存储 | 未总结的对话与 messages 分开,总结后清空 |
| 时间情境注入 | 现在几点 + 距上次聊天多久,转自然语言表述 |

### 14.2 搬运时必须修正

| 问题 | 原实现 | 本项目 |
|---|---|---|
| 记忆无 scope 分层 | `charMemories[charId]` 一个角色一份 | 加 `global` / `character` / `chat` 三层 |
| B 级扫描窗口过窄 | 只扫最后一条用户消息 | 扫最近 N 条消息,与世界书共用窗口 |
| 无 token 预算 | S/A 无条件全注入 | 按 rank 与新近度排序后截断,管理页显示占用 |
| 世界书过于简陋 | 仅 enabled + global/local | 补齐关键词触发、优先级、插入位置、预算(见 3.2 / 4.4) |
| JSON 解析不稳 | 贪婪正则 `/\{[\s\S]*\}/` | 整体 parse -> 括号平衡扫描 -> 报错重试 |
| 硬编码 OpenAI 格式 | 直接拼 `/chat/completions` | 走 provider 适配层 |
| 无请求队列 | 直接 fetch,总结与回复可能并发 | 统一走 AIQueue |
| 回复风格收尾 | "一条消息就是一个念头" | 改为强调节奏不均匀与不周到,见 4.2 B3 |
| prompt 写死在代码里 | 骨架与分析提示词均为字符串字面量 | 全部移入可编辑模板,代码只留默认值 |

### 14.3 改造复用

`generateScenarioSeeds` 在原项目中为目标词生成"不含该词的话题线索",
其**两步法**(先单独生成角色近况,再由角色自然聊起)正是朋友圈动态该用的套路:

```
第一步  生成角色最近经历了什么(独立调用,产出若干条近况)
第二步  以近况为素材产出朋友圈动态 / 主动发起的聊天话题
```

对应 `tasks/moment-create.js` 与后续的"角色主动发消息"能力。

---

## 15. 已确认的设计决定

1. **主页**指"我的"主页(我的人设、我发的动态);
   角色主页从联系人进入。两者复用同一个 Profile 组件,subject 不同。
   **我的人设只在这里编辑**,设置里不再重复一份入口。
2. **群聊**要做。见 4.7,默认每角色独立调用 + 发言调度器。
3. **朋友圈图片**全部由用户本地上传并本地存储,不接图片生成 API。
   这决定了主存储必须是 IndexedDB,见 3.7 / 3.8。
4. **回复风格 prompt** 不采用 rainyword 的"一条消息就是一个念头",
   改为强调打字节奏的不均匀与不周到,见 4.2 B3。
5. **所有 prompt 模板运行时可编辑**,代码里只留默认值,见 4.2 B4。
6. **全屏,不画机身外壳**,桌面与移动端一致。
7. **视口单位只用 `vh`**,禁止 dvh/svh/lvh 及混用。全项目只在根容器用一次,
   其余走 flex 与 grid。见 `CLAUDE.md` 与 8.1。
8. **主界面为横条 + 方形挂件混排**,4 列显式坐标网格,不是等距图标海。见 8.4。
9. **底部是 Dock,放四个 app 图标**,不是 tab 栏。它只是快捷方式,
   不构成导航层级,因此系统层仍是单一栈。见 7 / 8.5。
10. **主界面支持多页横滑翻页**,空位以 placeholder 单元占住,
    版式从第一天就是完整的,以后填入真 app 只替换 `ref`。见 8.4。

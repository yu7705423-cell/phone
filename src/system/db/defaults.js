import { DEFAULT_TEMPLATES } from '../ai/templates.js';

export const DEFAULT_SETTINGS = {
  theme: 'light',                 // light | dark
  appIcons: {},                   // appId -> { icon }  单独换某个 app 的图标
  iconColor: '#000000',           // SVG 颜色
  iconShadow: true,               // 图标阴影
  glass: false,                   // 毛玻璃。持续的 GPU 合成开销，默认关，见 tokens.css
  iconLabels: true,               // 图标下的名称
  bottomLift: 0,                  // 底部整体上移的像素，见 styles/tokens.css
  fonts: [],                      // 自己传的字体，见 system/fonts.js
  fontBody: '',                   // 正文用哪一个，空 = 系统默认
  fontSerif: '',                  // 衬线槽位用哪一个（挂件里的标题会用到）
  customCSS: '',                  // 用户自定义 CSS，注入到独立 style 节点
  statusBar: 'auto',              // auto | on | off  见 shell/StatusBar.js
  // 返回怎么做。二选一，不并存：
  //   bar   底部一条横条。点一下回主界面，双击开多任务。默认
  //   back  左上角一个悬浮返回键，点一下退回上一级，长按回主界面。
  //         开了它就没有底部横条，页面自己那个返回箭头也让位给它
  navStyle: 'bar',
  showLockScreen: true,

  // 保活。循环播放无声音频，换取后台多活一阵，见 system/keepalive.js
  keepAlive: false,

  // 通知。横幅与提示音，见 system/sound.js
  notify: { banner: true, preview: true, sound: 'ding', soundFileId: null, volume: 0.7, system: false },

  // Web Push。真要在 app 关着时叫醒手机必须有服务器，见 system/push.js
  push: { vapidPublicKey: '', reportUrl: '', endpoint: '' },

  // AI 服务配置。聊天与生图是「预设列表 + 当前选中」，语音只有一份。
  services: {
    chat:  { presets: [], activeId: null, fallbackId: null },
    image: { presets: [], activeId: null },
    voice: { enabled: false, baseUrl: '', groupId: '', apiKey: '', model: '' },
    embed: { baseUrl: '', apiKey: '', model: '', dims: 0 },
    rerank: { baseUrl: '', apiKey: '', model: '' },
    // 自建的接口来源。各服务用 endpointId 指过来，见 ai/services.js
    endpoints: [],
    vision: { mode: 'off', baseUrl: '', apiKey: '', model: '' },
    asr: { baseUrl: '', apiKey: '', model: '', mode: 'text' },
  },

  // 旧版平铺字段，仅用于首次迁移，之后不再读写
  provider: 'anthropic',
  apiKey: '',
  baseUrl: '',
  model: 'claude-opus-5',
  temperature: 0.9,
  effort: 'low',

  // 一次回复只允许一次接口调用。会让它变成两次以上的，一律默认关着。
  // 见 CLAUDE.md 第 15 条，清单在 ai/cost.js
  retryMax: 0,                    // 429 / 5xx 自动重试几次。上限 3，0 为不重试
  chatFallback: false,            // 主用接口失败时改用另一套再试一次

  // 翻译。语言挂在会话上（chat.translateTo），这里只管怎么显示
  translateOpen: 'tap',           // tap | always

  // 回复风格。自然表达协议，见 ai/templates.js 的 skeleton.style
  // 回复怎么拿：'stream' 边生成边显示，'once' 等整段生成完再一次显示
  streamMode: 'stream',
  // 模型回了一整段没分条时，本地照标点断开。填 0 表示不动它，原样落库
  autoSplitAt: 40,
  musicFresh: 120,                // 播放记录超过这么多分钟就不再注入，0 为不限
  watchGap: 90,                   // 一起看时，她两次开口至少隔这么多秒。0 为只在你说话时才回
  watchLines: 8,                  // 每次给她看最近几句台词
  readGap: 1,                     // 一起读时，至少翻过几页她才开口。0 = 只在你说话时
  readChars: 900,                 // 一起读时给她看这一页的多少字。0 = 只给章节与进度
  reviewAuto: false,              // 收场时自动写一篇影评或书评。多一次调用，默认关
  watchAwayEnd: 15,               // 离开播放页这么多分钟后自动收场。0 为一直留着
  bondAuto: false,                // S 级记忆有变动时自动重压关系底色。开了每轮可能多一次调用
  coreAuto: true,                 // 导入角色卡时顺带生成核心设定
  memoryDepth: 1,                 // 本轮相关记忆插在倒数第几条之前，0 为留在设定区

  // 上下文
  injectOrder: ['character', 'lorebook', 'user', 'time', 'memory'],

  // 时间感知，见 system/time.js
  injectTime: true,               // 总开关
  timeStamp: true,                // 让角色每条回复先写出当地时间，显示时过滤掉
  timeMode: 'real',               // real | virtual
  timeVirtualAt: 0,               // 虚拟时刻
  timeSetAt: 0,                   // 设定它时的真实时刻，两者之差就是偏移
  timeFrozen: false,              // 停在那一刻不往下走
  timeZoneUser: 'local',          // 我在哪个时区。角色的在各自角色卡上

  currency: 'CNY',                // 转账用哪种钱。只影响显示与小数位，不换算
  callSpeak: false,               // 通话默认只出字幕，不发声
  callMic: false,                 // 通话默认打字，不开麦克风
  callSelfReal: false,            // 视频通话默认用虚拟头像，不开摄像头

  // ---- 用量与上限。见 CLAUDE.md 第 13 条：0 一律表示「不限 / 全都要」 ----
  callMaxTokens: 400,             // 通话里每轮回复的上限。电话里说一两句就停
  callFrameGap: 8,                // 视频通话最短隔几秒带一帧画面。0 = 每轮都带
  stickerCold: 12,                // 没在用表情时列几个名字给模型。0 = 全列
  stickerHot: 60,                 // 最近用过表情时列几个。0 = 全列
  proactiveMaxUnread: 3,          // 堆了几条没看就不再主动发。0 = 一直发
  chatPage: 60,                   // 会话一次画多少条。0 = 全画。往上翻按同样的数继续加载
  billBook: '',                   // 记账当前看的是哪一本，见 system/ledger.js
  searchLimit: 200,               // 搜索最多给多少条结果。0 = 全给
  scrobbleAfter: 30,              // 一首歌放够几秒才给网易云打卡。0 = 一放就打
  eventDedupeList: 0,             // 批量生成时把已有的多少条发给模型去重。0 = 全给

  // ---- 随机事件（见 system/events.js）----
  eventChance: 0.35,              // 一天撞上一件事的基础概率
  eventCooldown: 12,              // 刚抽过的这么多条先压一压，压不是封杀
  mealCooldown: 8,                // 最近吃过的这么多顿先压一压。0 = 不压

  promptLean: true,               // 功能说明平时只给一张目录，用上了才给细则
  giftBlind: true,                // 礼物拆开之前，里面装什么不进上下文

  historyMode: 'count',           // count 按条数 | turn 按轮次
  historyLimit: 20,               // 按条数时取最近多少条
  historyTurns: 10,               // 按轮次时取最近多少轮。一轮 = 用户发言 + 角色回复
  scanWindow: 6,                  // 世界书与 B 级记忆的扫描窗口(条)
  contextBudget: 6000,            // 注入内容的 token 预算(粗估)

  // 记忆
  memoryEnabled: true,
  memoryVector: false,            // 按语义检索。每轮多取一次查询向量，所以默认关着（第 15 条）
  memoryTopK: 12,                 // 语义检索取前几条
  memoryThreshold: 0.22,          // 相似度低于这个就不要了
  // 召回之后再让重排模型排一遍。每轮多一次请求，所以默认关着（第 15 条）
  rerankOn: false,
  rerankCandidates: 50,           // 送去重排的候选条数。0 = 全都送（第 13 条）
  autoSummarizeInterval: 0,       // 0 = 关闭
  // 总结记忆的输出上限。太小会把 JSON 截断，截断的那一份仍然照付，
  // 所以默认不限 —— max_tokens 只是上限，没用到的部分不计费。
  memoryExtractMaxTokens: 0,      // 0 = 不限
  memoryDedupeList: 0,            // 总结时发多少条已有记忆过去，0 = 全部
  // 一次总结吃掉最早的多少条消息。0 = 一次全吃。
  // 从别处迁进来几万条消息时，不设这个闸会把它们当成一轮拼进一次请求
  memoryBatch: 200,
  memoryImportChunk: 6000,        // 记忆导入一次喂多少字，0 = 不切，一次发完

  // 阅读器外观。和全局主题分开 —— 读书时的纸色字体不该跟着 app 皮肤走
  reader: {},

  // 汇率自己填，不联网取。'CNY>JPY': 20.5 表示 1 人民币折 20.5 日元
  rates: {},

  // 让角色先读一段。一次注入 = 一次调用，注入多少字都一样。
  //
  // 自动续读有两道闸：得先在弹窗里选「一直继续」（默认每次都问，
  // 所以默认不会自动花钱，第 15 条），而且续读次数有上限，到顶再问一次。
  // 行内译文的形状，一行一个，例如「{原文}（{译文}）」。**默认一条都没有**：
  // 一句正常的「他笑了（大概吧）」也符合那个样子，不替任何人默认打开。
  // 见 ai/translate.js
  translateFormats: '',

  weightUnit: 'kg',               // 体重一律按公斤存，这里只管显示

  // 让角色看到你的健康记录。默认关 —— 这是你的身体数据，不默认递出去
  healthInject: false,
  // 经期单独一道开关，上面那个开着也不代表这一项跟着出去
  healthCycleInject: false,
  // 排便同样单独一道。和经期一个道理：比睡眠步数更私密，不跟着总开关走
  healthPoopInject: false,
  medRemind: true,                // 用药到点提醒。本地通知，不调接口

  // 全屏看片默认转成横屏。片子是 16:9 的，竖着全屏等于白全屏。
  //
  // 值是**你要把手机往哪边转**，不是画面往哪边转：
  //   90  向左转（手机左边朝下）    画面 rotate(90deg)
  //  -90  向右转（手机右边朝下）    画面 rotate(-90deg)
  //   0   不转，保持竖屏
  // 两个方向都留着，握持习惯因人而异，也因手机壳和线在哪一头而异。
  watchRotate: 90,

  injectChars: 6000,              // 一次注入多少字。0 = 一直读到书末
  injectMaxRuns: 3,               // 最多自动续几次。0 = 不自动续，每次都问

  // 段评。多人共读默认一次调用写全部；切成一人一次声音更不容易串，
  // 代价是选几个人就是几次调用（第 13 条：把账摆出来，不替用户省）。
  crowdSeparate: false,
  crowdCount: 6,                  // 随机评论一次生成几条

  // 群聊
  groupMode: 'per-character',     // per-character | single-call
  groupSpeakersPerTurn: 2,

  // 只存**改过的那几条**。把整套抄进来会让 DEFAULT_TEMPLATES 彻底失效：
  // template() 优先读这里，于是代码里改了默认值，老库一个字都吃不到。
  // 见 CLAUDE.md 第 11 条 —— 代码里那份是回落，不是初始值。
  // 用户自己关掉的能力（id 清单）。空 = 一样都没关。
  // 关掉的那几样一个字都不进 prompt，见 ai/capabilities.js
  capsOff: [],

  promptTemplates: {},
};

export const DEFAULT_PERSONA = {
  name: '我',
  avatar: null,
  cover: null,
  signature: '',
  // 性别单独一个字段，不塞在人设描述里：它要在 prompt 首尾各锚定一次，
  // 混在一大段自述里模型认不准，而认错性别是最不能接受的一种错
  gender: '',
  description: '',
};

// 主界面默认版式: 顶部横条,其下四个 app 与一个方形并列,左右交替。
// 摆的全是真 app —— 占位应用已经删掉了。没摆上的那几个由 heal() 自己找空位。
export const DEFAULT_LAYOUT = {
  pages: [
    {
      id: 'p1',
      cells: [
        { id: 'c1',  kind: 'widget', ref: 'player',        x: 0, y: 0, w: 4, h: 2 },
        { id: 'c2',  kind: 'app',    ref: 'lorebook',      x: 0, y: 2, w: 1, h: 1 },
        { id: 'c3',  kind: 'app',    ref: 'memory',        x: 1, y: 2, w: 1, h: 1 },
        { id: 'c4',  kind: 'widget', ref: 'recent-chats',  x: 2, y: 2, w: 2, h: 2 },
        { id: 'c5',  kind: 'app',    ref: 'contact',       x: 0, y: 3, w: 1, h: 1 },
        { id: 'c6',  kind: 'app',    ref: 'music',         x: 1, y: 3, w: 1, h: 1 },
        { id: 'c7',  kind: 'widget', ref: 'moments-peek',  x: 0, y: 4, w: 2, h: 2 },
        { id: 'c8',  kind: 'app',    ref: 'theater',       x: 2, y: 4, w: 1, h: 1 },
        { id: 'c9',  kind: 'app',    ref: 'health',        x: 3, y: 4, w: 1, h: 1 },
        { id: 'c10', kind: 'app',    ref: 'daily',         x: 2, y: 5, w: 1, h: 1 },
        { id: 'c11', kind: 'app',    ref: 'bill',          x: 3, y: 5, w: 1, h: 1 },
      ],
    },
    {
      id: 'p2',
      cells: [
        { id: 'd1', kind: 'app', ref: 'space',  x: 0, y: 0, w: 1, h: 1 },
        { id: 'd2', kind: 'widget', ref: 'health', x: 0, y: 1, w: 2, h: 1 },
        { id: 'd3', kind: 'widget', ref: 'clock',  x: 2, y: 0, w: 2, h: 1 },
      ],
    },
  ],
  dock: ['chat', 'settings', null, null],
  currentPage: 0,
  wallpaper: { home: null, lock: null },
};

export const GRID_COLS = 4;
export const DOCK_SIZE = 4;

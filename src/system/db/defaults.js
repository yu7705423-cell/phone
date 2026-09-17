import { DEFAULT_TEMPLATES } from '../ai/templates.js';

export const DEFAULT_SETTINGS = {
  theme: 'light',                 // light | dark
  appIcons: {},                   // appId -> { icon }  单独换某个 app 的图标
  iconColor: '#000000',           // SVG 颜色
  iconShadow: true,               // 图标阴影
  iconLabels: true,               // 图标下的名称
  bottomLift: 0,                  // 底部整体上移的像素，见 styles/tokens.css
  fonts: [],                      // 自己传的字体，见 system/fonts.js
  fontBody: '',                   // 正文用哪一个，空 = 系统默认
  fontSerif: '',                  // 衬线槽位用哪一个（挂件里的标题会用到）
  customCSS: '',                  // 用户自定义 CSS，注入到独立 style 节点
  statusBar: 'auto',              // auto | on | off  见 shell/StatusBar.js
  showLockScreen: true,

  // 保活。循环播放无声音频，换取后台多活一阵，见 system/keepalive.js
  keepAlive: false,

  // 通知。横幅与提示音，见 system/sound.js
  notify: { banner: true, sound: 'ding', soundFileId: null, volume: 0.7, system: false },

  // Web Push。真要在 app 关着时叫醒手机必须有服务器，见 system/push.js
  push: { vapidPublicKey: '', reportUrl: '', endpoint: '' },

  // AI 服务配置。聊天与生图是「预设列表 + 当前选中」，语音只有一份。
  services: {
    chat:  { presets: [], activeId: null, fallbackId: null },
    image: { presets: [], activeId: null },
    voice: { enabled: false, baseUrl: '', groupId: '', apiKey: '', model: '' },
    embed: { baseUrl: '', apiKey: '', model: '', dims: 0 },
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

  // 后台活儿（整理记忆、导入、生成 NPC…）优先走副用接口，见 ai/engine.js
  backgroundSpare: true,

  // 翻译。语言挂在会话上（chat.translateTo），这里只管怎么显示
  translateOpen: 'tap',           // tap | always

  // 回复风格。自然表达协议，见 ai/templates.js 的 skeleton.style
  styleProtocol: true,

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

  promptLean: true,               // 功能说明平时只给一张目录，用上了才给细则
  giftBlind: true,                // 礼物拆开之前，里面装什么不进上下文

  historyMode: 'count',           // count 按条数 | turn 按轮次
  historyLimit: 20,               // 按条数时取最近多少条
  historyTurns: 10,               // 按轮次时取最近多少轮。一轮 = 用户发言 + 角色回复
  scanWindow: 6,                  // 世界书与 B 级记忆的扫描窗口(条)
  contextBudget: 6000,            // 注入内容的 token 预算(粗估)

  // 记忆
  memoryEnabled: true,
  memoryVector: true,             // 配了向量接口就按语义检索，见 system/ai/memvec.js
  memoryTopK: 12,                 // 语义检索取前几条
  memoryThreshold: 0.22,          // 相似度低于这个就不要了
  autoSummarizeInterval: 0,       // 0 = 关闭

  // 群聊
  groupMode: 'per-character',     // per-character | single-call
  groupSpeakersPerTurn: 2,

  promptTemplates: { ...DEFAULT_TEMPLATES },
};

export const DEFAULT_PERSONA = {
  name: '我',
  avatar: null,
  cover: null,
  signature: '',
  description: '',
};

// 主界面默认版式: 顶部横条,其下四个 app 与一个方形并列,左右交替。
// 还没有对应 app 的位置一律用 placeholder 占住,保证版式从第一天就是完整的。
export const DEFAULT_LAYOUT = {
  pages: [
    {
      id: 'p1',
      cells: [
        { id: 'c1',  kind: 'widget', ref: 'player',        x: 0, y: 0, w: 4, h: 2 },
        { id: 'c2',  kind: 'app',    ref: 'lorebook',      x: 0, y: 2, w: 1, h: 1 },
        { id: 'c3',  kind: 'app',    ref: 'memory',        x: 1, y: 2, w: 1, h: 1 },
        { id: 'c4',  kind: 'widget', ref: 'recent-chats',  x: 2, y: 2, w: 2, h: 2 },
        { id: 'c5',  kind: 'app',    ref: 'stub-photos',   x: 0, y: 3, w: 1, h: 1 },
        { id: 'c6',  kind: 'app',    ref: 'stub-music',    x: 1, y: 3, w: 1, h: 1 },
        { id: 'c7',  kind: 'widget', ref: 'moments-peek',  x: 0, y: 4, w: 2, h: 2 },
        { id: 'c8',  kind: 'app',    ref: 'stub-calendar', x: 2, y: 4, w: 1, h: 1 },
        { id: 'c9',  kind: 'app',    ref: 'stub-weather',  x: 3, y: 4, w: 1, h: 1 },
        { id: 'c10', kind: 'app',    ref: 'stub-clock',    x: 2, y: 5, w: 1, h: 1 },
        { id: 'c11', kind: 'app',    ref: 'stub-notes',    x: 3, y: 5, w: 1, h: 1 },
      ],
    },
    {
      id: 'p2',
      cells: [
        { id: 'd1', kind: 'app', ref: 'stub-mail', x: 0, y: 0, w: 1, h: 1 },
        { id: 'd2', kind: 'app', ref: 'stub-map',  x: 1, y: 0, w: 1, h: 1 },
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

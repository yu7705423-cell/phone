import { DEFAULT_TEMPLATES } from '../ai/templates.js';

export const DEFAULT_SETTINGS = {
  theme: 'light',                 // light | dark
  appIcons: {},                   // appId -> { icon }  单独换某个 app 的图标
  iconColor: '#000000',           // SVG 颜色
  iconShadow: true,               // 图标阴影
  iconLabels: true,               // 图标下的名称
  customCSS: '',                  // 用户自定义 CSS，注入到独立 style 节点
  statusBar: 'auto',              // auto | on | off  见 shell/StatusBar.js
  showLockScreen: true,

  // AI 服务配置。聊天与生图是「预设列表 + 当前选中」，语音只有一份。
  services: {
    chat:  { presets: [], activeId: null, fallbackId: null },
    image: { presets: [], activeId: null },
    voice: { enabled: false, baseUrl: '', groupId: '', apiKey: '', model: '' },
  },

  // 旧版平铺字段，仅用于首次迁移，之后不再读写
  provider: 'anthropic',
  apiKey: '',
  baseUrl: '',
  model: 'claude-opus-5',
  temperature: 0.9,
  effort: 'low',

  // 上下文
  injectOrder: ['character', 'lorebook', 'user', 'time', 'memory'],
  injectTime: true,
  historyLimit: 20,
  scanWindow: 6,                  // 世界书与 B 级记忆的扫描窗口(条)
  contextBudget: 6000,            // 注入内容的 token 预算(粗估)

  // 记忆
  memoryEnabled: true,
  autoSummarizeInterval: 0,       // 0 = 关闭

  // 主动消息。角色自己挑时间发来，见 system/ai/proactive.js
  proactive: {
    enabled: false,
    minutes: 60,        // 平均间隔，实际落点 0.5x ~ 1.5x 随机
    quietFrom: 0,       // 免打扰起始小时
    quietTo: 8,         // 免打扰结束小时，两者相等表示不设
    maxUnread: 3,       // 堆了这么多条没看就先不发
  },

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

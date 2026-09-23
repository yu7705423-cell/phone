// 美化契约：允许外部作者写的那一套类名与变量。见 ARCHITECTURE 4.136
//
// ---- 为什么要和内部类名分开 ----
//
// 别人写一份美化，写的是选择器。选择器指向我们的 DOM，而我们的 DOM 会变：
// 某天把 `.msg` 改成 `.row`，那一天所有人写过的美化一起失效，而且是静默失效
// —— 他们只会看到「更新之后我的气泡变回默认的了」。
//
// 所以分两套：
//
//   内部类名   `.msg` `.bubble` `.composer-bar` —— 我们自己的样式用，随便改
//   契约钩子   `.ph-msg` `.ph-bubble` `.ph-composer` —— 一经发布永不改名
//
// 同一个元素上两个都挂：`class="msg is-mine ph-msg ph-msg-mine"`。
// 多一个字符串的代价，换的是「重构不会毁掉别人几个月的活」。
//
// ---- 这张表是唯一的一份 ----
//
// 契约文档从它生成，美化页上「类名」那一页从它生成，`scripts/check-contract.mjs`
// 拿它双向核对：表里写了的钩子必须在源码里真的挂着，源码里挂着的 `ph-`
// 必须在表里登记。两边对不上就报错 —— 手写的表迟早对不上，这个项目已经
// 反复吃过这个亏。
//
// ---- 加钩子可以，改名和删名不可以 ----
//
// `since` 记的是它是哪一版加的。加一个新钩子是向后兼容的；改名或者去掉一个，
// 等于把已经发出去的美化包作废。真要作废，那是一次契约版本号的事，
// 不是一次重构的事。

/** 契约本身的版本。加钩子不动它；改名或删名才动，而且那是个大事。 */
export const CONTRACT_VERSION = 2;

/** 美化能挂在哪一层。美化包自己声明，见 `scope`。 */
export const SCOPES = [
  {
    id: 'chat',
    label: '单段会话',
    desc: '挂在一段会话上，只在那一页打开时注入，离开立即移除。'
      + '写坏了只坏这一页，消息列表不上美化，永远回得去。',
  },
  {
    id: 'shell',
    label: '整个应用',
    desc: '所有页面都注入，主界面与列表也在内。写坏了可能整个应用打不开，'
      + '因此设置页永不注入美化，那里可以一键停用。',
  },
];

export const scopeOf = skin => {
  const raw = Array.isArray(skin?.scope) ? skin.scope : ['chat'];
  const ids = raw.filter(x => SCOPES.some(s => s.id === x));
  return ids.length ? ids : ['chat'];
};

export const isGlobal = skin => scopeOf(skin).includes('shell');

/**
 * 钩子表。
 *
 *   hook   类名，不带 `ph-` 前缀
 *   label  这是什么
 *   on     它出现在哪些层。只写 'shell' 的，`scope` 里没有 shell 就够不着
 *   needs  要满足什么才看得见。没写的，样板间里必须能命中
 *   note   作者要知道的额外一句
 */
export const HOOKS = [
  // ---- 会话：消息 ----
  { hook: 'chat', label: '会话页整体', on: ['chat'], since: 1 },
  { hook: 'chat-body', label: '消息列表', on: ['chat'], since: 1 },
  { hook: 'msg', label: '一条消息（含头像）', on: ['chat'], since: 1 },
  { hook: 'msg-mine', label: '我发的那一条', on: ['chat'], since: 1 },
  { hook: 'msg-theirs', label: '角色发的那一条', on: ['chat'], since: 1 },
  { hook: 'face', label: '头像那一块', on: ['chat'], since: 1,
    note: '头像框挂在它的 ::after 上。它本身没有定位，要自己写 position: relative' },
  { hook: 'avatar', label: '头像本体', on: ['chat', 'shell'], since: 1,
    note: '尺寸与圆角走 --ph-avatar-size 与 --ph-avatar-r，不要直接写 width' },
  { hook: 'col', label: '同一轮的几个气泡', on: ['chat'], since: 1 },
  { hook: 'bubble', label: '气泡', on: ['chat'], since: 1 },
  { hook: 'bubble-mine', label: '我的气泡', on: ['chat'], since: 1 },
  { hook: 'bubble-theirs', label: '角色的气泡', on: ['chat'], since: 1 },
  { hook: 'sticker', label: '表情气泡', on: ['chat'], since: 1,
    needs: '会话中出现表情消息' },
  { hook: 'quote', label: '引用条', on: ['chat'], since: 1,
    needs: '这条消息引用了另一条' },
  { hook: 'meta', label: '气泡上的那行小字', on: ['chat'], since: 1,
    needs: '开启消息时刻或已读回执' },
  { hook: 'stamp', label: '消息时刻', on: ['chat'], since: 1, needs: '开启消息时刻' },
  { hook: 'read', label: '已读回执', on: ['chat'], since: 1, needs: '开启已读回执' },

  // ---- 会话：底栏 ----
  { hook: 'composer', label: '底栏', on: ['chat'], since: 1 },
  { hook: 'composer-input', label: '输入框', on: ['chat'], since: 1 },
  { hook: 'composer-btn', label: '底栏圆按钮', on: ['chat'], since: 1 },
  { hook: 'plus', label: '底栏的加号', on: ['chat'], since: 2,
    note: '图标是内联 svg，换图要先把它藏起来：.ph-plus svg { opacity: 0 }，再给按钮铺背景图' },
  { hook: 'sticker-btn', label: '底栏的表情键', on: ['chat'], since: 2,
    needs: '当前不在线下模式' },
  { hook: 'send', label: '发送键', on: ['chat'], since: 1 },
  { hook: 'panel', label: '底栏展开的面板', on: ['chat'], since: 1,
    needs: '点开底栏左侧的加号或表情' },
  { hook: 'badge', label: '互动标识的小图标', on: ['chat', 'shell'], since: 2,
    needs: '这段对话连续互发满三天，或解锁过标识' },
  { hook: 'award', label: '颁发标识的那一条', on: ['chat'], since: 2,
    needs: '会话中出现颁发标识的消息' },
  { hook: 'level-ring', label: '头像外那一圈亲密度', on: ['shell'], since: 2,
    needs: '角色主页，且该对话显示标识',
    note: '圈是内联 svg，颜色读 currentColor' },
  { hook: 'toolbar', label: '会话里的各种条', on: ['chat'], since: 1,
    note: '多选、待办、节奏这几条共用它。各自另有一个内部类名区分',
    needs: '进入多选，或该会话开了待办与节奏' },

  // ---- 页面外壳：每一页都有 ----
  { hook: 'page', label: '一整页', on: ['chat', 'shell'], since: 1 },
  { hook: 'navbar', label: '顶栏', on: ['chat', 'shell'], since: 1 },
  { hook: 'nav-title', label: '顶栏标题', on: ['chat', 'shell'], since: 1 },
  { hook: 'nav-left', label: '顶栏左侧', on: ['chat', 'shell'], since: 1 },
  { hook: 'nav-right', label: '顶栏右侧', on: ['chat', 'shell'], since: 1 },
  { hook: 'back', label: '顶栏的返回键', on: ['chat', 'shell'], since: 2,
    needs: '这一页能返回', note: '换图同 .ph-plus。设为透明仍然点得到，点击区不变' },
  { hook: 'nav-action', label: '顶栏右上角那个按钮', on: ['chat'], since: 2,
    needs: '会话页，且不在多选中' },
  { hook: 'tabbar', label: '底部标签栏', on: ['shell'], since: 1,
    needs: '当前这个 app 分了几个标签' },
  { hook: 'tab', label: '一个标签', on: ['shell'], since: 1, needs: '同上' },
  { hook: 'tab-on', label: '选中的那个标签', on: ['shell'], since: 1, needs: '同上' },
  { hook: 'list', label: '一组列表', on: ['shell'], since: 1 },
  { hook: 'list-item', label: '列表里的一行', on: ['shell'], since: 1 },
  { hook: 'list-title', label: '列表上方的小标题', on: ['shell'], since: 1 },
  { hook: 'sheet', label: '底部浮层', on: ['shell'], since: 1, needs: '有浮层打开' },
  { hook: 'modal', label: '弹窗', on: ['shell'], since: 1, needs: '有弹窗打开' },

  // ---- 外壳：主界面 ----
  { hook: 'screen', label: '整块屏幕', on: ['shell'], since: 1 },
  { hook: 'statusbar', label: '状态栏', on: ['shell'], since: 1,
    needs: '外观里把状态栏设为显示。触屏设备上默认不显示，那是系统自己那条' },
  { hook: 'wallpaper', label: '壁纸层', on: ['shell'], since: 1,
    needs: '设置了壁纸' },
  { hook: 'home', label: '主界面', on: ['shell'], since: 1 },
  { hook: 'home-grid', label: '图标网格', on: ['shell'], since: 1 },
  { hook: 'tile', label: '一个应用图标', on: ['shell'], since: 1 },
  { hook: 'tile-name', label: '图标下的名称', on: ['shell'], since: 1,
    needs: '外观里开着「显示图标名称」' },
  { hook: 'dock', label: '底部 Dock', on: ['shell'], since: 1 },
];

/** 一个钩子的完整类名。写死 `ph-` 前缀，别处不要再拼。 */
export const cls = hook => `ph-${hook}`;

/** 拼一串。组件里这样用：`class=${'msg ' + phc('msg', mine && 'msg-mine')}` */
export const phc = (...hooks) => hooks.filter(Boolean).map(cls).join(' ');

/**
 * 公开的变量。
 *
 * **内部变量名不对外。** tokens.css 里写的是
 * `--bubble-r: var(--ph-bubble-r, 14px)`，我们自己的样式照旧读 `--bubble-r`，
 * 外面只认 `--ph-bubble-r`。这样内部怎么改名都不碰契约，
 * 而作者写一行变量就能改掉一整类元素，不必去猜选择器。
 */
export const VARS = [
  { name: 'ph-bubble-r', label: '气泡圆角', unit: 'px', def: 14, on: ['chat'], since: 1 },
  { name: 'ph-bubble-px', label: '气泡左右内距', unit: 'px', def: 12, on: ['chat'], since: 1 },
  { name: 'ph-bubble-py', label: '气泡上下内距', unit: 'px', def: 8, on: ['chat'], since: 1 },
  { name: 'ph-bubble-fs', label: '气泡字号', unit: 'px', def: 14, on: ['chat'], since: 1 },
  { name: 'ph-bubble-gap', label: '两轮消息之间', unit: 'px', def: 16, on: ['chat'], since: 1 },
  { name: 'ph-bubble-gap-in', label: '同一轮内间距', unit: 'px', def: 5, on: ['chat'], since: 1 },
  { name: 'ph-avatar-size', label: '头像大小', unit: 'px', def: 36, on: ['chat'], since: 1 },
  { name: 'ph-avatar-r', label: '头像圆角', unit: '', def: '18px', on: ['chat', 'shell'], since: 1,
    note: '写 50% 就是圆的。这一项不带单位，要自己写 px 或 %' },
  { name: 'ph-navbar-h', label: '顶栏高度', unit: 'px', def: 48, on: ['chat', 'shell'], since: 1 },
  { name: 'ph-composer-h', label: '底栏按钮大小', unit: 'px', def: 38, on: ['chat'], since: 1,
    note: '输入框的最小高度也是它' },
  { name: 'ph-composer-pad', label: '底栏内边距', unit: 'px', def: 8, on: ['chat'], since: 1 },
];

/** 这个钩子在这一档 scope 下够不够得着。 */
export const reachable = (item, scopes) => (item.on || []).some(x => scopes.includes(x));

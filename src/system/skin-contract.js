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
 *   group  在类名清单里归哪一组（GROUPS）。由下面的 sec() 统一填，不逐条写
 */
const sec = (group, list) => list.map(h => ({ ...h, group }));

/**
 * 类名清单的分组。只管展示：「写给作者」与「应用美化」两页按它分组列出。
 * 改组名、调顺序都不碰契约，契约只认类名本身。
 */
export const GROUPS = [
  { id: 'convo', label: '会话：消息' },
  { id: 'cards', label: '会话：卡片气泡' },
  { id: 'composer', label: '会话：底栏与其他' },
  { id: 'page', label: '页面外壳' },
  { id: 'home', label: '主界面' },
  { id: 'chats', label: '消息列表' },
  { id: 'contacts', label: '联系人列表' },
  { id: 'moments', label: '朋友圈' },
  { id: 'profile', label: '主页' },
];

export const HOOKS = [
  ...sec('convo', [
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
    needs: '这条消息引用了另一条',
    note: '纯 CSS 就能换位置：默认在气泡上方（order: -1）；写 order: 0 放到气泡下方；'
      + '写 display: none 不显示，只剩正文' },
  { hook: 'quote-in', label: '包在气泡里的引用', on: ['chat'], since: 2,
    needs: '这条消息引用了另一条',
    note: '在第一个文字气泡里面，默认不显示。要把引用包进气泡：'
      + '.ph-col:has(.ph-quote-in) > .ph-quote { display: none } 再给 .ph-quote-in 写 display: flex。'
      + '图片、转账这类没有文字气泡的，外面那一条照旧显示' },
  { hook: 'meta', label: '气泡上的那行小字', on: ['chat'], since: 1,
    needs: '开启消息时刻或已读回执' },
  { hook: 'stamp', label: '消息时刻', on: ['chat'], since: 1, needs: '开启消息时刻' },
  { hook: 'read', label: '已读回执', on: ['chat'], since: 1, needs: '开启已读回执' },
  { hook: 'time-sep', label: '消息之间居中的那行时间', on: ['chat'], since: 2,
    needs: '消息时刻为「按间隔」，且两条消息相隔五分钟以上' },
  { hook: 'recall', label: '撤回后留下的那一行', on: ['chat'], since: 2,
    needs: '会话中有撤回的消息',
    note: '点开后原来那一条接在它下面，另带内部类名 is-recalled' },
  { hook: 'trans', label: '气泡里的译文', on: ['chat'], since: 2,
    needs: '这段会话开启了翻译，并已展开译文',
    note: '文字气泡与语音转写下面的译文共用它' },
  ]),

  ...sec('cards', [
  { hook: 'transfer', label: '转账卡片', on: ['chat'], since: 2, needs: '会话中出现转账',
    note: '已收款、已退还时另带内部类名 is-done' },
  { hook: 'voice', label: '语音气泡', on: ['chat'], since: 2, needs: '会话中出现语音消息' },
  { hook: 'call', label: '通话结束后的那条记录', on: ['chat'], since: 2, needs: '会话中有过通话',
    note: '未接通时另带内部类名 is-miss' },
  { hook: 'location', label: '位置卡片', on: ['chat'], since: 2, needs: '会话中出现位置' },
  { hook: 'gift', label: '礼物卡片', on: ['chat'], since: 2, needs: '会话中出现礼物',
    note: '拆开之后另带内部类名 is-done' },
  { hook: 'outfit', label: '搭配卡片', on: ['chat'], since: 2, needs: '会话中出现衣帽间的搭配',
    note: '自己发的另带内部类名 is-mine；穿搭盲盒里未揭晓的另带 is-sealed' },
  { hook: 'narration', label: '旁白那一行', on: ['chat'], since: 2, needs: '会话的「互动」里开启旁白，并且角色写了旁白' },
  { hook: 'file', label: '文件那一张卡', on: ['chat'], since: 2, needs: '在会话里发一份文件，或角色发回一份' },
  { hook: 'msg-face', label: '线下时的那一条', on: ['chat'], since: 2, needs: '在会话里切到线下之后发出或生成的消息',
    note: '和 msg 挂在同一个元素上，线上的消息没有它' },
  { hook: 'side', label: '线上与线下之间的分隔线', on: ['chat'], since: 2, needs: '在会话里切到线下或切回线上' },
  { hook: 'groom', label: '衣帽间的动作卡片', on: ['chat'], since: 2, needs: '在衣帽间单品页选择「在会话中使用」',
    note: '自己发的另带内部类名 is-mine' },
  { hook: 'slip', label: '包里多出来的东西', on: ['chat'], since: 2, needs: '线下剧情中角色往你包里放了东西，并已收场',
    note: '点开之后另带内部类名 is-done' },
  { hook: 'dresscode', label: '穿搭盲盒的主题卡片', on: ['chat'], since: 2, needs: '在角色的套装页选择「作为穿搭盲盒发出」',
    note: '揭晓之后另带内部类名 is-done' },
  ]),

  ...sec('composer', [
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
  { hook: 'card', label: 'HTML 卡片那一条', on: ['chat'], since: 2,
    note: '只管卡片外面那一圈（细栏与边框）。卡片里面在独立的框里，美化够不着',
    needs: '会话中出现角色发来的 HTML 卡片（世界书的卡片条目）' },
  { hook: 'toolbar', label: '会话里的各种条', on: ['chat'], since: 1,
    note: '多选、待办、节奏这几条共用它。各自另有一个内部类名区分',
    needs: '进入多选，或该会话开了待办与节奏' },
  ]),

  // 每一页都有
  ...sec('page', [
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
  ]),

  ...sec('home', [
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
  ]),

  // 聊天 app 的「消息」分区。以下各组都只在整个应用这一档够得着
  ...sec('chats', [
    { hook: 'chats', label: '消息列表整页', on: ['shell'], since: 2 },
    { hook: 'chats-search', label: '顶部的搜索框', on: ['shell'], since: 2 },
    { hook: 'chats-section', label: '一个分区（置顶、会话等）', on: ['shell'], since: 2, needs: '至少有一段会话' },
    { hook: 'chats-section-title', label: '分区的小标题', on: ['shell'], since: 2, needs: '该分区带标题' },
    { hook: 'chats-group', label: '分区里那一块底板', on: ['shell'], since: 2, needs: '至少有一段会话' },
    { hook: 'chat-row', label: '一段会话那一行', on: ['shell'], since: 2, needs: '至少有一段会话' },
    { hook: 'chat-row-pinned', label: '置顶的那一行', on: ['shell'], since: 2, needs: '有置顶的会话' },
    { hook: 'chat-row-unread', label: '有未读的那一行', on: ['shell'], since: 2, needs: '有未读消息' },
    { hook: 'chat-row-muted', label: '免打扰的那一行', on: ['shell'], since: 2, needs: '有开启免打扰的会话' },
    { hook: 'chat-row-group', label: '群聊那一行', on: ['shell'], since: 2, needs: '有群聊' },
    { hook: 'chat-row-main', label: '行里头像右边的文字区', on: ['shell'], since: 2, needs: '至少有一段会话' },
    { hook: 'chat-row-top', label: '文字区的上一行（名字与时间）', on: ['shell'], since: 2, needs: '至少有一段会话' },
    { hook: 'chat-row-star', label: '名字前的星标', on: ['shell'], since: 2, needs: '角色设为星标' },
    { hook: 'chat-row-name', label: '会话名称', on: ['shell'], since: 2, needs: '至少有一段会话' },
    { hook: 'chat-row-time', label: '最后一条的时间', on: ['shell'], since: 2, needs: '至少有一段会话' },
    { hook: 'chat-row-bottom', label: '文字区的下一行（预览与未读数）', on: ['shell'], since: 2, needs: '至少有一段会话' },
    { hook: 'chat-row-preview', label: '最后一条的预览', on: ['shell'], since: 2, needs: '至少有一段会话' },
    { hook: 'chat-row-count', label: '未读数的小圆点', on: ['shell'], since: 2, needs: '有未读消息' },
    { hook: 'group-face', label: '群聊的拼图头像', on: ['shell'], since: 2, needs: '有群聊',
      note: '大小走内部变量，要改就写 width 与 height' },
  ]),

  // 聊天 app 的「联系人」分区，不是联系 app
  ...sec('contacts', [
    { hook: 'contacts', label: '联系人列表整页', on: ['shell'], since: 2 },
    { hook: 'contacts-search', label: '顶部的搜索框', on: ['shell'], since: 2 },
    { hook: 'contacts-section', label: '一个分组', on: ['shell'], since: 2, needs: '至少有一个角色' },
    { hook: 'contacts-section-title', label: '分组的小标题', on: ['shell'], since: 2, needs: '至少有一个角色' },
    { hook: 'contacts-group', label: '分组里那一块底板', on: ['shell'], since: 2, needs: '至少有一个角色' },
    { hook: 'contact-row', label: '一个联系人那一行', on: ['shell'], since: 2, needs: '至少有一个角色' },
    { hook: 'contact-row-pinned', label: '置顶的联系人', on: ['shell'], since: 2, needs: '有置顶的角色' },
    { hook: 'contact-row-npc', label: 'NPC 那一行', on: ['shell'], since: 2, needs: '有 NPC' },
    { hook: 'contact-row-main', label: '行里头像右边的文字区', on: ['shell'], since: 2, needs: '至少有一个角色' },
    { hook: 'contact-row-name', label: '名字', on: ['shell'], since: 2, needs: '至少有一个角色' },
    { hook: 'contact-row-sign', label: '名字下面的签名', on: ['shell'], since: 2, needs: '至少有一个角色' },
    { hook: 'contact-row-arrow', label: '行尾的箭头', on: ['shell'], since: 2, needs: '至少有一个角色' },
    { hook: 'contacts-add', label: '列表底部新建按钮那一块', on: ['shell'], since: 2 },
  ]),

  ...sec('moments', [
    { hook: 'moments', label: '朋友圈整页', on: ['shell'], since: 2 },
    { hook: 'moments-cover', label: '顶部封面', on: ['shell'], since: 2,
      note: '封面图走内部变量。要换成自己的图，直接写 background-image' },
    { hook: 'moments-cover-acts', label: '封面右上角那排按钮', on: ['shell'], since: 2 },
    { hook: 'moments-cover-btn', label: '封面上的一个圆按钮', on: ['shell'], since: 2 },
    { hook: 'moments-me', label: '封面右下角的头像与名字', on: ['shell'], since: 2 },
    { hook: 'moments-me-name', label: '封面上的名字', on: ['shell'], since: 2 },
    { hook: 'moment', label: '一条动态', on: ['shell'], since: 2, needs: '至少有一条动态',
      note: '主页的列表分栏里也是它' },
    { hook: 'moment-mine', label: '我发的那一条', on: ['shell'], since: 2, needs: '发过动态' },
    { hook: 'moment-main', label: '头像右边的正文区', on: ['shell'], since: 2, needs: '至少有一条动态' },
    { hook: 'moment-name', label: '作者名字', on: ['shell'], since: 2, needs: '至少有一条动态' },
    { hook: 'moment-text', label: '正文', on: ['shell'], since: 2, needs: '动态带文字' },
    { hook: 'moment-photos', label: '九宫格', on: ['shell'], since: 2, needs: '动态带图片',
      note: '另带内部类名 n1 到 n9，表示张数' },
    { hook: 'moment-photo', label: '九宫格里的一张', on: ['shell'], since: 2, needs: '动态带图片',
      note: '发布时的缩略图也是它' },
    { hook: 'moment-song', label: '动态里带的歌', on: ['shell'], since: 2, needs: '动态带歌曲' },
    { hook: 'moment-foot', label: '底部那一行（时间与按钮）', on: ['shell'], since: 2, needs: '至少有一条动态' },
    { hook: 'moment-time', label: '发布时间', on: ['shell'], since: 2, needs: '至少有一条动态' },
    { hook: 'moment-actions', label: '右下角那排按钮', on: ['shell'], since: 2, needs: '至少有一条动态' },
    { hook: 'moment-act', label: '一个按钮（赞、评论、删除）', on: ['shell'], since: 2, needs: '至少有一条动态',
      note: '详情页底部的赞与评论数也是它' },
    { hook: 'moment-like', label: '点赞键', on: ['shell'], since: 2, needs: '至少有一条动态',
      note: '已赞时另带内部类名 is-on' },
    { hook: 'moment-comment-btn', label: '评论键', on: ['shell'], since: 2, needs: '至少有一条动态' },
    { hook: 'moment-delete', label: '删除键', on: ['shell'], since: 2, needs: '至少有一条动态' },
    { hook: 'moment-comments', label: '评论区那一块底', on: ['shell'], since: 2, needs: '动态有评论' },
    { hook: 'moment-comment-list', label: '评论列表', on: ['shell'], since: 2, needs: '动态有评论',
      note: '评论浮层与详情页里也是它' },
    { hook: 'moment-comment', label: '一条评论', on: ['shell'], since: 2, needs: '动态有评论' },
    { hook: 'moment-comment-name', label: '评论者的名字', on: ['shell'], since: 2, needs: '动态有评论' },
    { hook: 'moment-recalled', label: '角色撤回的那一条', on: ['shell'], since: 2, needs: '角色撤回过动态',
      note: '展开后另带内部类名 is-open' },
    { hook: 'moment-recalled-line', label: '撤回留下的那一行', on: ['shell'], since: 2, needs: '角色撤回过动态' },
    { hook: 'moment-detail-author', label: '详情页顶部的作者那一行', on: ['shell'], since: 2, needs: '打开一条动态' },
    { hook: 'moment-detail-name', label: '详情页的作者名字', on: ['shell'], since: 2, needs: '打开一条动态' },
    { hook: 'moment-detail-time', label: '详情页的发布时间', on: ['shell'], since: 2, needs: '打开一条动态' },
    { hook: 'moment-detail-pager', label: '详情页的大图区', on: ['shell'], since: 2, needs: '打开一条带图的动态' },
    { hook: 'moment-detail-slide', label: '大图区里的一张', on: ['shell'], since: 2, needs: '打开一条带图的动态' },
    { hook: 'moment-detail-dots', label: '大图下面的页码点', on: ['shell'], since: 2, needs: '打开一条多图的动态' },
    { hook: 'moment-detail-dot', label: '一个页码点', on: ['shell'], since: 2, needs: '打开一条多图的动态',
      note: '当前那一张另带内部类名 is-on' },
    { hook: 'moment-detail-foot', label: '详情页的赞与评论数那一行', on: ['shell'], since: 2, needs: '打开一条动态' },
    { hook: 'moment-detail-text', label: '详情页的正文', on: ['shell'], since: 2, needs: '打开一条带文字的动态' },
    { hook: 'moment-detail-comments', label: '详情页的评论区', on: ['shell'], since: 2, needs: '打开一条动态' },
    { hook: 'moment-detail-gone', label: '详情页里已撤回的说明', on: ['shell'], since: 2, needs: '打开一条角色撤回的动态' },
  ]),

  // 我的主页与角色主页是同一个组件
  ...sec('profile', [
    { hook: 'profile', label: '主页整页', on: ['shell'], since: 2 },
    { hook: 'profile-me', label: '我自己的主页', on: ['shell'], since: 2, needs: '打开的是我的主页' },
    { hook: 'profile-head', label: '头像与三个数字那一行', on: ['shell'], since: 2 },
    { hook: 'profile-face', label: '头像那一块', on: ['shell'], since: 2 },
    { hook: 'profile-face-base', label: '头像右下角「换回原本的头像」', on: ['shell'], since: 2, needs: '换过头像' },
    { hook: 'level-ring', label: '头像外那一圈亲密度', on: ['shell'], since: 2, needs: '角色主页，且该对话显示标识',
      note: '圈是内联 svg，颜色读 currentColor' },
    { hook: 'profile-stats', label: '三个数字那一组', on: ['shell'], since: 2 },
    { hook: 'profile-stat', label: '一个数字（动态、照片、联系人）', on: ['shell'], since: 2 },
    { hook: 'profile-stat-num', label: '数字本身', on: ['shell'], since: 2 },
    { hook: 'profile-stat-label', label: '数字下面的字', on: ['shell'], since: 2 },
    { hook: 'profile-bio', label: '名字与签名那一块', on: ['shell'], since: 2 },
    { hook: 'profile-name', label: '名字', on: ['shell'], since: 2 },
    { hook: 'profile-sign', label: '签名', on: ['shell'], since: 2, needs: '填写了签名' },
    { hook: 'profile-acts', label: '并排的按钮那一行', on: ['shell'], since: 2 },
    { hook: 'profile-highlights', label: '一排圆形精选', on: ['shell'], since: 2 },
    { hook: 'profile-highlight', label: '一个精选', on: ['shell'], since: 2,
      note: '末尾的「新建」也是它' },
    { hook: 'profile-highlight-add', label: '末尾的「新建」', on: ['shell'], since: 2 },
    { hook: 'profile-highlight-ring', label: '精选外面那一圈', on: ['shell'], since: 2 },
    { hook: 'profile-highlight-img', label: '精选圈里的图', on: ['shell'], since: 2 },
    { hook: 'profile-highlight-name', label: '精选下面的名字', on: ['shell'], since: 2 },
    { hook: 'profile-tabs', label: '网格与列表两个分栏', on: ['shell'], since: 2 },
    { hook: 'profile-tab', label: '一个分栏', on: ['shell'], since: 2 },
    { hook: 'profile-tab-on', label: '选中的那个分栏', on: ['shell'], since: 2 },
    { hook: 'profile-grid', label: '照片网格', on: ['shell'], since: 2, needs: '发过带图的动态' },
    { hook: 'profile-cell', label: '网格里的一格', on: ['shell'], since: 2, needs: '发过带图的动态' },
    { hook: 'profile-cell-multi', label: '多图那一格右上角的标记', on: ['shell'], since: 2, needs: '发过多图的动态' },
  ]),
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
  // 会话自己的「聊天背景」挂在 .ph-page 上的几项（system/chatlook.js）。作者也能写，
  // 但同一段会话里用户自己设了的那一项以用户的为准
  { name: 'ph-chat-bg', label: '聊天背景图', unit: '', def: 'none', on: ['chat'], since: 2,
    note: '写 url(...)。只在页面带 .has-chat-bg 时画' },
  { name: 'ph-narration-color', label: '旁白文字颜色', unit: '', def: 'var(--text-3)', on: ['chat'], since: 2,
    note: '会话「聊天背景」里选了颜色时由应用写上' },
  { name: 'ph-chat-veil', label: '背景遮罩', unit: '', def: '0%', on: ['chat'], since: 2,
    note: '朝主题底色淡过去的比例，写百分数' },
  { name: 'ph-bar-top', label: '顶栏底色', unit: '', def: 'var(--bg)', on: ['chat'], since: 2,
    note: '只在页面带 .look-top 时生效' },
  { name: 'ph-bar-top-blur', label: '顶栏模糊', unit: 'px', def: 0, on: ['chat'], since: 2 },
  { name: 'ph-bar-bottom', label: '输入栏底色', unit: '', def: 'var(--bg)', on: ['chat'], since: 2,
    note: '只在页面带 .look-bottom 时生效' },
  { name: 'ph-bar-bottom-blur', label: '输入栏模糊', unit: 'px', def: 0, on: ['chat'], since: 2 },
  // 「外观 - 图标名称颜色」写的就是它。作者也能写，用户在外观里选了颜色时以用户的为准
  { name: 'ph-tile-name-color', label: '图标名称颜色', unit: '', def: 'var(--text-2)', on: ['shell'], since: 2,
    note: '写颜色值。有壁纸时默认是白色，这一项同样盖得过' },
];

/** 这个钩子在这一档 scope 下够不够得着。 */
export const reachable = (item, scopes) => (item.on || []).some(x => scopes.includes(x));

// 美化生成器：把一堆旋钮变成一段 CSS。见 ARCHITECTURE 4.137、4.138
//
// ---- 分组的顺序就是页面从上到下的顺序 ----
//
// 顶栏、消息区、头像、小尾巴、时刻、气泡、边框、贴图、底栏。
// 调样式的人是照着屏幕从上往下看的，分组跟着走，找东西不必猜。
//
// ---- 三件事在这里反复出现，各有一套写法 ----
//
// **换图标。** 图标是内联 `<svg>`，CSS 改不了它的路径。办法是把 svg 的
// 不透明度压成 0，再给按钮本身铺一张背景图。「设为透明但仍可点击」就是
// 这一招的前半截：svg 藏起来，按钮和点击区一分不动。
//
// **位移。** `transform: translate()`。它不挤开旁边的东西，挪多了会叠在
// 一起 —— 这是 transform 本身的性质，界面上写明了，范围也限住了。
//
// **连着的第一条 / 最后一条。** 相邻兄弟选择器。「第一条」用 `A + A`，
// 哪儿都跑得动；「最后一条」要 `A:has(+ A)`，iOS 15.4 以上才有，
// 所以那一档在界面上单独标一句。
//
// ---- 伪元素的位置是有限的 ----
//
// 一个元素只有 `::before` 与 `::after`。渐变边框、小尾巴、两张贴图都要用，
// 所以贴图与小尾巴各自能选挂在哪个元素（气泡 / 这一轮 / 整行）的哪个位置，
// 撞车了由 `conflictsOf` 报出来，界面上照着显示。**不做隐藏的优先级** ——
// 那样用户只会看到「我明明设了却没出来」。

/** 气泡这一组改哪一边。 */
export const SIDES = [
  { id: 'all', label: '双方', sel: '.ph-bubble' },
  { id: 'theirs', label: '角色', sel: '.ph-bubble-theirs' },
  { id: 'mine', label: '自己', sel: '.ph-bubble-mine' },
];
export const sideSel = id => (SIDES.find(s => s.id === id) || SIDES[0]).sel;

/** 连着的几条里，哪几条要显示这一样。 */
export const RUNS = [
  { id: 'all', label: '每一条' },
  { id: 'first', label: '只有第一条' },
  { id: 'last', label: '只有最后一条' },
];

/** 一轮里拆成几个气泡时，哪几个要显示这一样。 */
export const WHICH = [
  { id: 'all', label: '每一个' },
  { id: 'first', label: '只有第一个' },
  { id: 'last', label: '只有最后一个' },
];

/** 贴图挂在哪个元素上。位置有限，所以要选。 */
export const HOSTS = [
  { id: 'bubble', label: '气泡' },
  { id: 'col', label: '这一轮', sel: '.ph-col' },
  { id: 'row', label: '整行', sel: '.ph-msg' },
];
export const SLOTS = [
  { id: 'after', label: '后一个位置' },
  { id: 'before', label: '前一个位置' },
];

export const ANCHORS = [
  { id: 'tl', label: '左上', css: 'left:0;top:0', mid: '' },
  { id: 'tc', label: '上中', css: 'left:50%;top:0', mid: 'translate(-50%,0)' },
  { id: 'tr', label: '右上', css: 'right:0;top:0', mid: '' },
  { id: 'lc', label: '左中', css: 'left:0;top:50%', mid: 'translate(0,-50%)' },
  { id: 'center', label: '居中', css: 'left:50%;top:50%', mid: 'translate(-50%,-50%)' },
  { id: 'rc', label: '右中', css: 'right:0;top:50%', mid: 'translate(0,-50%)' },
  { id: 'bl', label: '左下', css: 'left:0;bottom:0', mid: '' },
  { id: 'bc', label: '下中', css: 'left:50%;bottom:0', mid: 'translate(-50%,0)' },
  { id: 'br', label: '右下', css: 'right:0;bottom:0', mid: '' },
];
const anchorOf = id => ANCHORS.find(a => a.id === id) || ANCHORS[8];

export const ALIGNS = [
  { id: 'flex-start', label: '顶部' },
  { id: 'center', label: '居中' },
  { id: 'flex-end', label: '底部' },
];

export const METAPOS = [
  { id: 'side', label: '气泡旁边' },
  { id: 'center', label: '整行居中' },
  { id: 'below', label: '气泡下方' },
];

export const FILLS = [
  { id: 'cover', label: '铺满' },
  { id: 'contain', label: '完整显示' },
  { id: 'repeat', label: '平铺' },
];
const fillDecls = id => (id === 'repeat'
  ? ['background-repeat: repeat', 'background-size: auto']
  : ['background-repeat: no-repeat',
    `background-size: ${id === 'contain' ? 'contain' : 'cover'}`,
    'background-position: center']);

// ---- 控件的几个常见组合 ----

/** 一个图标按钮：换图、设为透明、移动、改大小。 */
const iconItems = (key, label, extra = {}) => [
  { id: `${key}Img`, label: `${label}的图片`, type: 'image', def: '',
    desc: '换掉原来那个图标。图标本身是内联的矢量图，换图的做法是把它藏起来再铺上这张图',
    ...extra },
  { id: `${key}Hide`, label: `${label}设为透明`, type: 'switch', def: false,
    desc: '图标不显示，但按钮与点击区不动，原来的位置照样点得到' },
  { id: `${key}Size`, label: `${label}的大小`, type: 'num', unit: 'px', def: '', min: 8, max: 64 },
  { id: `${key}X`, label: `${label}左右移动`, type: 'num', unit: 'px', def: '', min: -120, max: 120 },
  { id: `${key}Y`, label: `${label}上下移动`, type: 'num', unit: 'px', def: '', min: -60, max: 60 },
];

/** 一张贴图：挂哪儿、哪几个、位置姿态。 */
const decoItems = (n) => [
  { id: 'img', label: '图片', type: 'image', def: '' },
  { id: 'host', label: '挂在哪儿', type: 'pick', options: HOSTS, def: 'bubble', when: v => v.img,
    desc: '一个元素只有两个位置可挂。挂满了就换一个元素，或者换另一个位置' },
  { id: 'slot', label: '挂在哪个位置', type: 'pick', options: SLOTS,
    def: n === 1 ? 'after' : 'before', when: v => v.img },
  { id: 'which', label: '一轮里哪几个气泡有', type: 'pick', options: WHICH, def: 'all',
    when: v => v.img && v.host === 'bubble' },
  { id: 'size', label: '大小', type: 'num', unit: 'px', def: 40, min: 8, max: 240, when: v => v.img },
  { id: 'pos', label: '贴在哪个角', type: 'pick', options: ANCHORS,
    def: n === 1 ? 'br' : 'tl', when: v => v.img },
  { id: 'x', label: '左右偏移', type: 'num', unit: 'px', def: 0, min: -160, max: 160, when: v => v.img },
  { id: 'y', label: '上下偏移', type: 'num', unit: 'px', def: 0, min: -160, max: 160, when: v => v.img },
  { id: 'rot', label: '旋转', type: 'num', unit: '度', def: 0, min: -180, max: 180, when: v => v.img },
  { id: 'op', label: '透明度', type: 'num', unit: '%', def: 100, min: 0, max: 100, when: v => v.img },
];

/**
 * 每一组旋钮。界面照着画，`emit` 照着出 CSS，两处读同一份。
 *
 *   focus 展开这一组时，预览滚到并放大哪一块
 */
export const GROUPS = [
  {
    id: 'nav', label: '顶栏', short: '顶栏', icon: 'maximize', focus: '.ph-navbar',
    items: [
      { id: 'bg', label: '底色', type: 'color', def: '' },
      { id: 'img', label: '背景图', type: 'image', def: '' },
      { id: 'imgFill', label: '背景图怎么铺', type: 'pick', options: FILLS, def: 'cover',
        when: v => v.img },
      { id: 'h', label: '高度', type: 'num', unit: 'px', def: '', min: 24, max: 120 },
      { id: 'line', label: '隐藏底部的分隔线', type: 'switch', def: false },
      { id: 'titleColor', label: '标题颜色', type: 'color', def: '' },
      { id: 'titleSize', label: '标题字号', type: 'num', unit: 'px', def: '', min: 8, max: 40 },
      { id: 'titleX', label: '标题左右移动', type: 'num', unit: 'px', def: '', min: -160, max: 160 },
      { id: 'titleY', label: '标题上下移动', type: 'num', unit: 'px', def: '', min: -60, max: 60 },
      ...iconItems('back', '返回键'),
      ...iconItems('act', '右上角按钮'),
    ],
  },
  {
    id: 'navDeco', label: '顶栏挂图', short: '挂图', icon: 'image', focus: '.ph-navbar',
    items: [
      { id: 'img', label: '图片', type: 'image', def: '',
        desc: '挂在顶栏上的一张图。顶栏有两个位置，这是第一个' },
      { id: 'slot', label: '挂在哪个位置', type: 'pick', options: SLOTS, def: 'after',
        when: v => v.img },
      { id: 'size', label: '大小', type: 'num', unit: 'px', def: 40, min: 8, max: 240, when: v => v.img },
      { id: 'pos', label: '贴在哪个角', type: 'pick', options: ANCHORS, def: 'tr', when: v => v.img },
      { id: 'x', label: '左右偏移', type: 'num', unit: 'px', def: 0, min: -220, max: 220, when: v => v.img },
      { id: 'y', label: '上下偏移', type: 'num', unit: 'px', def: 0, min: -120, max: 120, when: v => v.img },
      { id: 'rot', label: '旋转', type: 'num', unit: '度', def: 0, min: -180, max: 180, when: v => v.img },
      { id: 'op', label: '透明度', type: 'num', unit: '%', def: 100, min: 0, max: 100, when: v => v.img },
      { id: 'over', label: '允许盖到顶栏外面', type: 'switch', def: false, when: v => v.img,
        desc: '默认超出顶栏的部分会被裁掉。开启后可以露到消息区里' },
    ],
  },
  {
    id: 'msg', label: '消息区', short: '消息', icon: 'layers', focus: '.ph-chat-body',
    items: [
      { id: 'top', label: '第一条与顶部的距离', type: 'num', unit: 'px', def: '', min: -120, max: 240,
        desc: '顶栏加高或挂了图之后，第一条消息容易被压住，用这一项让开' },
      { id: 'bottom', label: '最后一条与底栏的距离', type: 'num', unit: 'px', def: '', min: -120, max: 240 },
      { id: 'sideP', label: '左右留白', type: 'num', unit: 'px', def: '', min: -40, max: 80,
        desc: '填负数会让消息比容器更宽，气泡可以贴到屏幕边上' },
      { id: 'gap', label: '两条消息之间', type: 'num', unit: 'px', def: '', min: -40, max: 100,
        desc: '填负数会让两条消息叠起来' },
      { id: 'gapIn', label: '同一轮内两个气泡之间', type: 'num', unit: 'px', def: '', min: -20, max: 60 },
      { id: 'align', label: '头像与气泡的对齐', type: 'pick', options: ALIGNS, def: 'flex-start' },
      { id: 'width', label: '气泡最大宽度', type: 'num', unit: '%', def: '', min: 20, max: 100 },
      { id: 'bg', label: '聊天背景色', type: 'color', def: '' },
      { id: 'img', label: '聊天背景图', type: 'image', def: '' },
      { id: 'imgFill', label: '背景图怎么铺', type: 'pick', options: FILLS, def: 'cover',
        when: v => v.img },
    ],
  },
  {
    id: 'avatar', label: '头像', short: '头像', icon: 'user', focus: '.ph-face',
    items: [
      { id: 'size', label: '大小', type: 'num', unit: 'px', def: '', min: 16, max: 120 },
      { id: 'round', label: '圆角', type: 'num', unit: '%', def: '', min: 0, max: 50,
        desc: '50 是正圆，0 表示不改' },
      { id: 'bw', label: '描边粗细', type: 'num', unit: 'px', def: '', min: 0, max: 10 },
      { id: 'bc', label: '描边颜色', type: 'color', def: '', when: v => v.bw > 0 },
      { id: 'gap', label: '与气泡的距离', type: 'num', unit: 'px', def: '', min: -30, max: 60,
        desc: '填负数会让头像和气泡叠起来' },
      { id: 'x', label: '左右移动', type: 'num', unit: 'px', def: '', min: -60, max: 60 },
      { id: 'y', label: '上下移动', type: 'num', unit: 'px', def: '', min: -60, max: 60 },
      { id: 'run', label: '连着的几条里哪几条有头像', type: 'pick', options: RUNS, def: 'all',
        desc: '隐藏的那几条仍然占位，气泡不会跟着左右错开。'
          + '「只有最后一条」需要 iOS 15.4 以上的系统' },
      { id: 'frameTheirs', label: '角色的头像框', type: 'image', def: '',
        desc: '中间要透明，否则会把头像盖住' },
      { id: 'frameMine', label: '自己的头像框', type: 'image', def: '' },
      { id: 'frameScale', label: '头像框大小', type: 'num', unit: '%', def: 160, min: 100, max: 300,
        when: v => v.frameTheirs || v.frameMine },
      { id: 'frameX', label: '头像框左右偏移', type: 'num', unit: 'px', def: 0, min: -60, max: 60,
        when: v => v.frameTheirs || v.frameMine },
      { id: 'frameY', label: '头像框上下偏移', type: 'num', unit: 'px', def: 0, min: -60, max: 60,
        when: v => v.frameTheirs || v.frameMine },
    ],
  },
  {
    id: 'tail', label: '气泡小尾巴', short: '尾巴', icon: 'play', focus: '.ph-bubble-theirs',
    items: [
      { id: 'on', label: '显示小尾巴', type: 'switch', def: false,
        desc: '气泡朝向头像那一侧的小三角。默认没有' },
      { id: 'size', label: '大小', type: 'num', unit: 'px', def: 8, min: 2, max: 24, when: v => v.on },
      { id: 'y', label: '上下位置', type: 'num', unit: 'px', def: 10, min: -30, max: 120, when: v => v.on,
        desc: '从气泡顶部往下算' },
      { id: 'x', label: '往外探出', type: 'num', unit: 'px', def: 0, min: -20, max: 20, when: v => v.on },
      { id: 'which', label: '一轮里哪几个气泡有', type: 'pick', options: WHICH, def: 'first',
        when: v => v.on },
      { id: 'run', label: '连着的几条里哪几条有', type: 'pick', options: RUNS, def: 'all',
        when: v => v.on, desc: '「只有最后一条」需要 iOS 15.4 以上的系统' },
      { id: 'slot', label: '挂在气泡的哪个位置', type: 'pick', options: SLOTS, def: 'before',
        when: v => v.on },
    ],
  },
  {
    id: 'meta', label: '时刻与已读', short: '时刻', icon: 'clock', focus: '.ph-meta',
    items: [
      { id: 'pos', label: '摆在哪儿', type: 'pick', options: METAPOS, def: 'side' },
      { id: 'color', label: '颜色', type: 'color', def: '' },
      { id: 'size', label: '字号', type: 'num', unit: 'px', def: '', min: 6, max: 24 },
      { id: 'x', label: '左右移动', type: 'num', unit: 'px', def: '', min: -120, max: 120 },
      { id: 'y', label: '上下移动', type: 'num', unit: 'px', def: '', min: -60, max: 60 },
      { id: 'hideStamp', label: '隐藏时刻', type: 'switch', def: false },
      { id: 'readText', label: '把「已读」改成', type: 'text', def: '',
        desc: '留空表示不改。填了之后原来的字不显示，换成这里写的' },
      { id: 'readColor', label: '已读的颜色', type: 'color', def: '' },
      { id: 'hideRead', label: '隐藏已读', type: 'switch', def: false },
    ],
  },
  {
    id: 'bubble', label: '气泡', short: '气泡', icon: 'message', focus: '.ph-bubble-theirs',
    items: [
      { id: 'side', label: '改哪一边', type: 'pick', options: SIDES, def: 'all',
        desc: '选定之后，这一组与「边框与阴影」「贴图」都只作用于这一边' },
      { id: 'bg', label: '底色', type: 'color', def: '' },
      { id: 'grad', label: '底色用渐变', type: 'switch', def: false },
      { id: 'bg2', label: '渐变的第二个颜色', type: 'color', def: '', when: v => v.grad },
      { id: 'gradAngle', label: '渐变角度', type: 'num', unit: '度', def: 135, min: 0, max: 360,
        when: v => v.grad },
      { id: 'fg', label: '文字颜色', type: 'color', def: '' },
      { id: 'r', label: '圆角', type: 'num', unit: 'px', def: '', min: 0, max: 48,
        desc: '填 0 就是方的' },
      { id: 'px', label: '左右内距', type: 'num', unit: 'px', def: '', min: 0, max: 60 },
      { id: 'py', label: '上下内距', type: 'num', unit: 'px', def: '', min: 0, max: 60 },
      { id: 'fs', label: '字号', type: 'num', unit: 'px', def: '', min: 8, max: 40 },
      { id: 'lh', label: '行高', type: 'num', unit: '%', def: '', min: 80, max: 300 },
      { id: 'img', label: '气泡底图', type: 'image', def: '' },
      { id: 'imgFill', label: '底图怎么铺', type: 'pick', options: FILLS, def: 'cover',
        when: v => v.img },
    ],
  },
  {
    id: 'border', label: '边框与阴影', short: '边框', icon: 'sparkle', focus: '.ph-bubble-theirs',
    items: [
      { id: 'w', label: '边框粗细', type: 'num', unit: 'px', def: '', min: 0, max: 16 },
      { id: 'c', label: '边框颜色', type: 'color', def: '', when: v => v.w > 0 },
      { id: 'grad', label: '边框用渐变', type: 'switch', def: false, when: v => v.w > 0,
        desc: '渐变边框要占用气泡的一个位置，默认占前一个' },
      { id: 'g2', label: '渐变的第二个颜色', type: 'color', def: '', when: v => v.w > 0 && v.grad },
      { id: 'gAngle', label: '渐变角度', type: 'num', unit: '度', def: 135, min: 0, max: 360,
        when: v => v.w > 0 && v.grad },
      { id: 'gSlot', label: '渐变边框占哪个位置', type: 'pick', options: SLOTS, def: 'before',
        when: v => v.w > 0 && v.grad },
      { id: 'shadow', label: '投影大小', type: 'num', unit: 'px', def: '', min: 0, max: 60 },
      { id: 'shColor', label: '投影颜色', type: 'color', def: '#000000', when: v => v.shadow > 0 },
      { id: 'shOp', label: '投影透明度', type: 'num', unit: '%', def: 20, min: 0, max: 100,
        when: v => v.shadow > 0 },
      { id: 'shY', label: '投影下移', type: 'num', unit: 'px', def: 2, min: -24, max: 24,
        when: v => v.shadow > 0 },
    ],
  },
  { id: 'deco1', label: '贴图一', short: '贴图一', icon: 'star', focus: '.ph-bubble-theirs', items: decoItems(1) },
  { id: 'deco2', label: '贴图二', short: '贴图二', icon: 'star', focus: '.ph-bubble-theirs', items: decoItems(2) },
  {
    id: 'composer', label: '底栏', short: '底栏', icon: 'edit', focus: '.ph-composer',
    items: [
      { id: 'bg', label: '底色', type: 'color', def: '' },
      { id: 'img', label: '背景图', type: 'image', def: '' },
      { id: 'imgFill', label: '背景图怎么铺', type: 'pick', options: FILLS, def: 'cover',
        when: v => v.img },
      { id: 'padTop', label: '上内边距', type: 'num', unit: 'px', def: '', min: 0, max: 60 },
      { id: 'padBottom', label: '下内边距', type: 'num', unit: 'px', def: '', min: -80, max: 80,
        desc: '这一块默认等于内边距加上系统安全区（iPhone 底部那条横杠占的位置），'
          + '所以看着比数字大。填 0 会把安全区一起去掉，填负数继续往下收，'
          + '内容可能被那条横杠压住' },
      { id: 'line', label: '隐藏顶部的分隔线', type: 'switch', def: false },
      { id: 'btn', label: '圆按钮大小', type: 'num', unit: 'px', def: '', min: 20, max: 80 },
      { id: 'btnFg', label: '圆按钮颜色', type: 'color', def: '' },
      { id: 'inH', label: '输入框高度', type: 'num', unit: 'px', def: '', min: 20, max: 120 },
      { id: 'inBg', label: '输入框底色', type: 'color', def: '' },
      { id: 'inFg', label: '输入框文字颜色', type: 'color', def: '' },
      { id: 'inR', label: '输入框圆角', type: 'num', unit: 'px', def: '', min: 0, max: 48 },
      { id: 'inPad', label: '输入框左右内距', type: 'num', unit: 'px', def: '', min: 0, max: 48 },
      { id: 'sendBg', label: '发送键底色', type: 'color', def: '' },
      ...iconItems('plus', '加号'),
      ...iconItems('stk', '表情键'),
      ...iconItems('send', '发送键'),
    ],
  },
];

/** 一组旋钮的默认值。 */
export const defaultsOf = group => {
  const out = {};
  group.items.forEach(it => { out[it.id] = it.def; });
  return out;
};

/** 整份的默认值。 */
export function blank() {
  const out = {};
  GROUPS.forEach(g => { out[g.id] = defaultsOf(g); });
  return out;
}

const groupById = id => GROUPS.find(x => x.id === id);

/** 读一个值，缺了就用默认。存下来的那一份可能是旧版本，少几项是常事。 */
export function valueOf(gen, groupId, itemId) {
  const it = groupById(groupId)?.items.find(x => x.id === itemId);
  const v = gen?.[groupId]?.[itemId];
  if (it && (v === undefined || v === null || v === '')) return it.def;
  return v === undefined || v === null ? '' : v;
}

/** 这一组当前的全部值。 */
export const groupValues = (gen, groupId) => {
  const g = groupById(groupId);
  if (!g) return {};
  const out = {};
  g.items.forEach(it => { out[it.id] = valueOf(gen, g.id, it.id); });
  return out;
};

/** 这一条现在该不该显示。`when` 没写就一直显示。 */
export const showItem = (item, values) =>
  (typeof item.when === 'function' ? !!item.when(values) : true);

// ---- 拼 CSS ----

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 这一项填了没有。
 *
 * **空串才是「不改」，0 是一个正常的值。** 从前拿 0 当哨兵，于是圆角调不成
 * 方的、间距调不到 0 —— 想要的那个值恰好就是哨兵值。负数同理，从前一律
 * 被 `if (num(x))` 挡在外面，其实「两条消息叠起来」正需要它。
 */
const set = v => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
/** 颜色填了没有。空串表示「不改这一项」。 */
const has = v => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim());
/** 能嵌的图。只认 data:，理由和头像框同一条（见 4.134）。 */
const img = v => (/^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+$/.test(String(v || '')) ? String(v) : '');
/** 用户写进 content 的那句话。引号与反斜杠要转义，不然整段 CSS 就断了。 */
const text = v => String(v || '').slice(0, 40).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const pct = v => Math.max(0, Math.min(100, num(v))) / 100;

/** #rrggbb 加透明度。不用 color-mix，老 WebView 上没有。 */
function rgba(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const rule = (sel, decls) => {
  const body = decls.filter(Boolean).map(d => `  ${d} !important;`).join('\n');
  return body ? `${sel} {\n${body}\n}` : '';
};
const note = t => `/* ${t} */`;
const move = (x, y) => (set(x) || set(y)
  ? `transform: translate(${num(x)}px, ${num(y)}px)` : '');

/**
 * 「连着的几条里哪几条」翻成选择器。
 *
 *   all    不加条件
 *   first  后面那些藏起来：`A + A`
 *   last   前面那些藏起来：`A:has(+ A)`，要 iOS 15.4 以上
 *
 * 回的是「要藏起来的那些」的选择器，空串表示一条都不藏。
 */
function runHide(run, base) {
  if (run === 'first') return `${base} + ${base}`;
  if (run === 'last') return `${base}:has(+ ${base})`;
  return '';
}

/** 一轮里「哪几个气泡」翻成选择器。回的是要藏起来的那些。 */
function whichHide(which) {
  if (which === 'first') return '.ph-col > .ph-bubble:not(:first-child)';
  if (which === 'last') return '.ph-col > .ph-bubble:not(:last-child)';
  return '';
}

/** 换图标那一套：藏 svg、铺图、改大小、位移。 */
function iconBlock(v, key, sel, label) {
  const url = img(v[`${key}Img`]);
  const hide = v[`${key}Hide`] === true;
  const hasSize = set(v[`${key}Size`]);
  const size = num(v[`${key}Size`]);
  const out = [];
  if (url || hide) {
    out.push(rule(`${sel} svg`, ['opacity: 0']));
  }
  const btn = [];
  if (url) {
    btn.push(`background-image: url("${url}")`,
      'background-repeat: no-repeat', 'background-position: center',
      `background-size: ${hasSize ? size : 20}px`);
  }
  if (hasSize) btn.push(`width: ${size + 12}px`, `height: ${size + 12}px`);
  const mv = move(v[`${key}X`], v[`${key}Y`]);
  if (mv) btn.push(mv);
  if (btn.length) out.push(rule(sel, btn));
  if (!url && !hide && hasSize) {
    out.push(rule(`${sel} svg`, [`width: ${size}px`, `height: ${size}px`]));
  }
  const body = out.filter(Boolean).join('\n');
  return body ? `${note(label)}\n${body}` : '';
}

/** 一张贴图。`host` 决定挂在哪个元素上。 */
function decoBlock(v, sideOf, label) {
  const url = img(v.img);
  if (!url) return '';
  const host = HOSTS.find(h => h.id === v.host) || HOSTS[0];
  const base = host.id === 'bubble' ? sideOf : host.sel;
  const slot = v.slot === 'before' ? 'before' : 'after';
  const a = anchorOf(v.pos);
  const mid = a.mid ? `${a.mid} ` : '';
  const out = [rule(base, ['position: relative']), rule(`${base}::${slot}`, [
    "content: ''",
    'position: absolute',
    `width: ${num(v.size)}px`,
    `height: ${num(v.size)}px`,
    ...a.css.split(';').map(x => x.replace(':', ': ')),
    `background: url("${url}") center/contain no-repeat`,
    `opacity: ${pct(v.op)}`,
    `transform: ${mid}translate(${num(v.x)}px, ${num(v.y)}px) rotate(${num(v.rot)}deg)`,
    'pointer-events: none',
    'z-index: 2',
  ])];
  if (host.id === 'bubble') {
    const hide = whichHide(v.which);
    if (hide) out.push(rule(`${hide}::${slot}`, ['display: none']));
  }
  return `${note(label)}\n${out.filter(Boolean).join('\n')}`;
}

function navBlocks(gen) {
  const v = groupValues(gen, 'nav');
  const out = [];
  const bar = [];
  if (has(v.bg)) bar.push(`background: ${v.bg}`);
  const bi = img(v.img);
  if (bi) { bar.push(`background-image: url("${bi}")`); fillDecls(v.imgFill).forEach(d => bar.push(d)); }
  if (set(v.h)) bar.push(`height: ${num(v.h)}px`, `min-height: ${num(v.h)}px`);
  if (v.line) bar.push('border-bottom: none', 'box-shadow: none');
  if (bar.length) out.push(`${note('顶栏')}\n${rule('.ph-navbar', bar)}`);

  const title = [];
  if (has(v.titleColor)) title.push(`color: ${v.titleColor}`);
  if (set(v.titleSize)) title.push(`font-size: ${num(v.titleSize)}px`);
  const tmv = move(v.titleX, v.titleY);
  if (tmv) title.push(tmv);
  if (title.length) out.push(`${note('顶栏标题')}\n${rule('.ph-nav-title', title)}`);

  out.push(iconBlock(v, 'back', '.ph-back', '返回键'));
  out.push(iconBlock(v, 'act', '.ph-nav-action', '右上角按钮'));
  return out;
}

function navDecoBlock(gen) {
  const v = groupValues(gen, 'navDeco');
  const url = img(v.img);
  if (!url) return '';
  const slot = v.slot === 'before' ? 'before' : 'after';
  const a = anchorOf(v.pos);
  const mid = a.mid ? `${a.mid} ` : '';
  const bar = ['position: relative'];
  if (v.over) bar.push('overflow: visible', 'z-index: 3');
  return `${note('顶栏挂图')}\n${rule('.ph-navbar', bar)}\n`
    + rule(`.ph-navbar::${slot}`, [
      "content: ''",
      'position: absolute',
      `width: ${num(v.size)}px`,
      `height: ${num(v.size)}px`,
      ...a.css.split(';').map(x => x.replace(':', ': ')),
      `background: url("${url}") center/contain no-repeat`,
      `opacity: ${pct(v.op)}`,
      `transform: ${mid}translate(${num(v.x)}px, ${num(v.y)}px) rotate(${num(v.rot)}deg)`,
      'pointer-events: none',
      'z-index: 3',
    ]);
}

function msgBlocks(gen) {
  const v = groupValues(gen, 'msg');
  const out = [];
  const body = [];
  if (has(v.bg)) body.push(`background: ${v.bg}`);
  const bi = img(v.img);
  if (bi) { body.push(`background-image: url("${bi}")`); fillDecls(v.imgFill).forEach(d => body.push(d)); }
  // **留白与间距都要能填负数。** padding 不接受负值，所以正数走 padding、
  // 负数走 margin：往里让开是留白，往外顶出去是负边距，两件事一个旋钮
  const pad = (n, padSide, marSide) => {
    if (n >= 0) body.push(`${padSide}: ${n}px`);
    else body.push(`${marSide}: ${n}px`);
  };
  if (set(v.top)) pad(num(v.top), 'padding-top', 'margin-top');
  if (set(v.bottom)) pad(num(v.bottom), 'padding-bottom', 'margin-bottom');
  if (set(v.sideP)) {
    pad(num(v.sideP), 'padding-left', 'margin-left');
    pad(num(v.sideP), 'padding-right', 'margin-right');
  }
  // 两条之间从 flex 的 gap 换成 margin。gap 不接受负值，而「两条叠起来」
  // 正是要负值（那个参照的生成器也是为此用的 margin）
  if (set(v.gap)) body.push('gap: 0');
  if (body.length) out.push(`${note('消息区')}\n${rule('.ph-chat-body', body)}`);

  const row = [];
  if (v.align && v.align !== 'flex-start') row.push(`align-items: ${v.align}`);
  if (set(v.gap)) row.push(`margin-bottom: ${num(v.gap)}px`);
  if (row.length) out.push(`${note('每一行消息')}\n${rule('.ph-msg', row)}`);

  const col = [];
  if (set(v.gapIn)) col.push('gap: 0');
  if (set(v.width)) col.push(`max-width: ${num(v.width)}%`);
  if (col.length) out.push(`${note('同一轮的几个气泡')}\n${rule('.ph-col', col)}`);
  if (set(v.gapIn)) {
    out.push(`${note('同一轮里两个气泡之间')}\n`
      + rule('.ph-col > .ph-bubble + .ph-bubble', [`margin-top: ${num(v.gapIn)}px`]));
  }
  return out;
}

function avatarBlocks(gen) {
  const v = groupValues(gen, 'avatar');
  const out = [];
  const av = [];
  if (set(v.size)) av.push(`width: ${num(v.size)}px`, `height: ${num(v.size)}px`);
  if (set(v.round)) av.push(`border-radius: ${num(v.round)}%`);
  if (set(v.bw)) av.push(`border: ${num(v.bw)}px solid ${has(v.bc) ? v.bc : 'currentColor'}`);
  if (av.length) out.push(`${note('头像')}\n${rule('.ph-face .ph-avatar', av)}`);

  const box = [];
  const mv = move(v.x, v.y);
  if (mv) box.push(mv);
  if (box.length) out.push(`${note('头像的位置')}\n${rule('.ph-face', box)}`);
  // 同样从 gap 换成 margin：负数才能让头像和气泡叠起来。
  // 两边方向相反，所以各写一条
  if (set(v.gap)) {
    out.push(`${note('头像与气泡的距离')}\n${rule('.ph-msg', ['gap: 0'])}\n`
      + rule('.ph-msg-theirs .ph-face', [`margin-right: ${num(v.gap)}px`]) + '\n'
      + rule('.ph-msg-mine .ph-face', [`margin-left: ${num(v.gap)}px`]));
  }

  // 连着的几条里藏掉哪几条的头像。**用 opacity 不用 display** ——
  // 去掉盒子会让那几条的气泡整体左移，看着像错位
  if (v.run && v.run !== 'all') {
    const a = runHide(v.run, '.ph-msg-theirs');
    const b = runHide(v.run, '.ph-msg-mine');
    out.push(`${note(`连着的消息${v.run === 'first' ? '只有第一条' : '只有最后一条'}显示头像`)}\n`
      + rule(`${a} .ph-face, ${b} .ph-face`, ['opacity: 0']));
  }

  const frame = (url, sel, label) => {
    const u = img(url);
    if (!u) return '';
    return `${note(label)}\n${rule(sel, ['position: relative'])}\n`
      + rule(`${sel}::after`, [
        "content: ''",
        'position: absolute',
        'left: 50%',
        'top: 50%',
        `width: ${num(v.frameScale)}%`,
        `height: ${num(v.frameScale)}%`,
        `transform: translate(-50%, -50%) translate(${num(v.frameX)}px, ${num(v.frameY)}px)`,
        `background: url("${u}") center/contain no-repeat`,
        'pointer-events: none',
        'z-index: 3',
      ]);
  };
  out.push(frame(v.frameTheirs, '.ph-msg-theirs .ph-face', '角色的头像框'));
  out.push(frame(v.frameMine, '.ph-msg-mine .ph-face', '自己的头像框'));
  return out;
}

function tailBlock(gen) {
  const v = groupValues(gen, 'tail');
  if (v.on !== true) return '';
  const s = num(v.size);
  const slot = v.slot === 'after' ? 'after' : 'before';
  const out = [rule('.ph-bubble', ['position: relative'])];
  // 三角形用 border 画。朝向跟着左右两边各写一条
  const common = [
    "content: ''", 'position: absolute', 'width: 0', 'height: 0',
    `top: ${num(v.y)}px`, 'pointer-events: none',
    `border-top: ${s}px solid transparent`,
    `border-bottom: ${s}px solid transparent`,
  ];
  out.push(rule(`.ph-bubble-theirs::${slot}`, [...common,
    `left: ${-s + num(v.x)}px`,
    `border-right: ${s}px solid currentColor`,
    'border-right-color: inherit',
    'color: inherit',
  ]));
  out.push(rule(`.ph-bubble-mine::${slot}`, [...common,
    `right: ${-s + num(v.x)}px`,
    `border-left: ${s}px solid currentColor`,
    'border-left-color: inherit',
  ]));
  const wh = whichHide(v.which);
  if (wh) out.push(rule(`${wh}::${slot}`, ['display: none']));
  if (v.run && v.run !== 'all') {
    const a = runHide(v.run, '.ph-msg-theirs');
    const b = runHide(v.run, '.ph-msg-mine');
    out.push(rule(`${a} .ph-bubble::${slot}, ${b} .ph-bubble::${slot}`, ['display: none']));
  }
  return `${note('气泡小尾巴。颜色跟着气泡的底色走')}\n${out.filter(Boolean).join('\n')}`;
}

function metaBlocks(gen) {
  const v = groupValues(gen, 'meta');
  const out = [];
  const box = [];
  if (v.pos === 'center') box.push('align-items: center', 'width: 100%', 'justify-content: center');
  if (v.pos === 'below') box.push('align-items: flex-start');
  const mv = move(v.x, v.y);
  if (mv) box.push(mv);
  if (box.length) out.push(`${note('时刻与已读那一行')}\n${rule('.ph-meta', box)}`);

  const both = [];
  if (has(v.color)) both.push(`color: ${v.color}`);
  if (set(v.size)) both.push(`font-size: ${num(v.size)}px`);
  if (both.length) out.push(`${note('时刻与已读的字')}\n${rule('.ph-stamp, .ph-read', both)}`);

  if (v.hideStamp) out.push(`${note('隐藏时刻')}\n${rule('.ph-stamp', ['display: none'])}`);
  if (v.hideRead) out.push(`${note('隐藏已读')}\n${rule('.ph-read', ['display: none'])}`);

  const rt = text(v.readText);
  if (rt && !v.hideRead) {
    // 原来的字压成 0 号，用 ::after 放新的。和那个生成器改转账标题同一招
    out.push(`${note('把「已读」换成别的字')}\n`
      + rule('.ph-read', ['font-size: 0', 'line-height: 0'])
      + '\n' + rule('.ph-read::after', [
        `content: "${rt}"`,
        `font-size: ${set(v.size) ? num(v.size) : 11}px`,
        'line-height: 1.4',
        has(v.readColor) ? `color: ${v.readColor}` : '',
      ]));
  } else if (has(v.readColor)) {
    out.push(`${note('已读的颜色')}\n${rule('.ph-read', [`color: ${v.readColor}`])}`);
  }
  return out;
}

function bubbleBlocks(gen) {
  const v = groupValues(gen, 'bubble');
  const b = groupValues(gen, 'border');
  const sel = sideSel(v.side);
  const out = [];
  const decls = [];

  if (has(v.bg)) {
    decls.push(v.grad && has(v.bg2)
      ? `background: linear-gradient(${num(v.gradAngle)}deg, ${v.bg}, ${v.bg2})`
      : `background: ${v.bg}`);
    // 小尾巴的颜色靠 border-color 继承，所以底色也写一份到 border-color 上
    decls.push(`border-color: ${v.bg}`);
  }
  const bi = img(v.img);
  if (bi) { decls.push(`background-image: url("${bi}")`); fillDecls(v.imgFill).forEach(d => decls.push(d)); }
  if (has(v.fg)) decls.push(`color: ${v.fg}`);
  if (set(v.r)) decls.push(`border-radius: ${num(v.r)}px`);
  if (set(v.px)) decls.push(`padding-left: ${num(v.px)}px`, `padding-right: ${num(v.px)}px`);
  if (set(v.py)) decls.push(`padding-top: ${num(v.py)}px`, `padding-bottom: ${num(v.py)}px`);
  if (set(v.fs)) decls.push(`font-size: ${num(v.fs)}px`);
  if (set(v.lh)) decls.push(`line-height: ${num(v.lh) / 100}`);

  const gradBorder = set(b.w) && num(b.w) > 0 && b.grad && has(b.c) && has(b.g2);
  if (set(b.w) && !gradBorder) {
    decls.push(num(b.w) > 0
      ? `border: ${num(b.w)}px solid ${has(b.c) ? b.c : 'currentColor'}`
      : 'border: none');
  }
  if (set(b.shadow)) {
    decls.push(num(b.shadow) > 0
      ? `box-shadow: 0 ${num(b.shY)}px ${num(b.shadow)}px `
        + rgba(b.shColor || '#000000', pct(b.shOp))
      : 'box-shadow: none');
  }
  if (decls.length) out.push(`${note('气泡')}\n${rule(sel, decls)}`);

  if (gradBorder) {
    const slot = b.gSlot === 'after' ? 'after' : 'before';
    out.push(`${note('渐变边框')}\n${rule(sel, ['position: relative'])}\n`
      + rule(`${sel}::${slot}`, [
        "content: ''", 'position: absolute', `inset: -${num(b.w)}px`,
        'border-radius: inherit', `padding: ${num(b.w)}px`,
        `background: linear-gradient(${num(b.gAngle)}deg, ${b.c}, ${b.g2})`,
        '-webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
        '-webkit-mask-composite: xor', 'mask-composite: exclude',
        'pointer-events: none',
      ]));
  }
  out.push(decoBlock(groupValues(gen, 'deco1'), sel, '贴图一'));
  out.push(decoBlock(groupValues(gen, 'deco2'), sel, '贴图二'));
  return out;
}

function composerBlocks(gen) {
  const v = groupValues(gen, 'composer');
  const out = [];
  const bar = [];
  if (has(v.bg)) bar.push(`background: ${v.bg}`);
  const bi = img(v.img);
  if (bi) { bar.push(`background-image: url("${bi}")`); fillDecls(v.imgFill).forEach(d => bar.push(d)); }
  if (set(v.padTop)) bar.push(`padding-top: ${num(v.padTop)}px`);
  // 底下这一块原本是 `内边距 + 安全区`，所以一旦写了就要整条盖掉，
  // 否则安全区仍然加在后面 —— 用户填了 0 却发现下面还空一大片，正是这么来的。
  // padding 不接受负值，负的那一段走 margin 继续往下收
  if (set(v.padBottom)) {
    const n = num(v.padBottom);
    bar.push(`padding-bottom: ${Math.max(0, n)}px`);
    if (n < 0) bar.push(`margin-bottom: ${n}px`);
  }
  if (v.line) bar.push('border-top: none', 'box-shadow: none');
  if (bar.length) out.push(`${note('底栏')}\n${rule('.ph-composer', bar)}`);

  const input = [];
  if (has(v.inBg)) input.push(`background: ${v.inBg}`);
  if (has(v.inFg)) input.push(`color: ${v.inFg}`);
  if (set(v.inR)) input.push(`border-radius: ${num(v.inR)}px`);
  if (set(v.inH)) input.push(`min-height: ${num(v.inH)}px`, `height: ${num(v.inH)}px`);
  if (set(v.inPad)) input.push(`padding-left: ${num(v.inPad)}px`, `padding-right: ${num(v.inPad)}px`);
  if (input.length) out.push(`${note('输入框')}\n${rule('.ph-composer-input', input)}`);

  const btn = [];
  if (set(v.btn)) btn.push(`width: ${num(v.btn)}px`, `height: ${num(v.btn)}px`);
  if (has(v.btnFg)) btn.push(`color: ${v.btnFg}`);
  if (btn.length) out.push(`${note('底栏圆按钮')}\n${rule('.ph-composer-btn', btn)}`);
  if (has(v.sendBg)) out.push(`${note('发送键底色')}\n${rule('.ph-send', [`background: ${v.sendBg}`])}`);

  out.push(iconBlock(v, 'plus', '.ph-plus', '加号'));
  out.push(iconBlock(v, 'stk', '.ph-sticker-btn', '表情键'));
  out.push(iconBlock(v, 'send', '.ph-send', '发送键'));
  return out;
}

/**
 * 位置撞车了没有。
 *
 * 一个元素只有两个伪元素位置。四五样东西都想用，撞上了就有一样不生效，
 * 而 CSS 不会报错 —— 用户只会看到「我明明设了却没出来」。所以这里数一遍，
 * 界面上照着显示。
 */
export function conflictsOf(gen) {
  const b = groupValues(gen, 'border');
  const t = groupValues(gen, 'tail');
  const v = groupValues(gen, 'bubble');
  const sel = sideSel(v.side);
  const used = new Map();   // `${host}::${slot}` -> [谁]
  const take = (host, slot, who) => {
    const k = `${host}::${slot}`;
    if (!used.has(k)) used.set(k, []);
    used.get(k).push(who);
  };
  if (set(b.w) && num(b.w) > 0 && b.grad && has(b.c) && has(b.g2)) {
    take(sel, b.gSlot === 'after' ? 'after' : 'before', '渐变边框');
  }
  if (t.on === true) take('.ph-bubble', t.slot === 'after' ? 'after' : 'before', '小尾巴');
  [['deco1', '贴图一'], ['deco2', '贴图二']].forEach(([id, label]) => {
    const d = groupValues(gen, id);
    if (!img(d.img)) return;
    const host = HOSTS.find(h => h.id === d.host) || HOSTS[0];
    take(host.id === 'bubble' ? sel : host.sel, d.slot === 'before' ? 'before' : 'after', label);
  });
  const av = groupValues(gen, 'avatar');
  if (img(av.frameTheirs)) take('.ph-msg-theirs .ph-face', 'after', '角色的头像框');
  if (img(av.frameMine)) take('.ph-msg-mine .ph-face', 'after', '自己的头像框');
  const nd = groupValues(gen, 'navDeco');
  if (img(nd.img)) take('.ph-navbar', nd.slot === 'before' ? 'before' : 'after', '顶栏挂图');

  const out = [];
  for (const [k, who] of used) {
    if (who.length > 1) out.push({ at: k, who });
  }
  // 小尾巴挂在 .ph-bubble 上，气泡那一组若选了某一边，仍然是同一批元素
  if (out.length === 0 && t.on === true && sel !== '.ph-bubble') {
    const k = `${sel}::${t.slot === 'after' ? 'after' : 'before'}`;
    if (used.has(k)) out.push({ at: k, who: ['小尾巴', ...used.get(k)] });
  }
  return out;
}

export const HEAD = '/* 以下由「生成」页自动写出，手动改动会在下次生成时被覆盖。 */';
export const TAIL = '/* 自动生成结束 */';

/** 生成那一段 CSS。一项都没调就回空串，不留一段空壳注释。 */
export function emit(gen) {
  const blocks = [
    ...navBlocks(gen), navDecoBlock(gen),
    ...msgBlocks(gen), ...avatarBlocks(gen), tailBlock(gen), ...metaBlocks(gen),
    ...bubbleBlocks(gen), ...composerBlocks(gen),
  ].filter(Boolean);
  if (!blocks.length) return '';
  return [HEAD, ...blocks, TAIL].join('\n\n');
}

/** 这一份用到了多少张内嵌的图，一共多少字节。界面上要说得出账。 */
export function weigh(gen) {
  let n = 0;
  let bytes = 0;
  GROUPS.forEach(g => g.items.forEach(it => {
    if (it.type !== 'image') return;
    const u = img(valueOf(gen, g.id, it.id));
    if (!u) return;
    n += 1;
    bytes += Math.round((u.length - u.indexOf(',') - 1) * 3 / 4);
  }));
  return { n, bytes };
}

/** 这一组改过几项。界面上每一组后面写一句。 */
export function changedIn(gen, groupId) {
  const g = groupById(groupId);
  if (!g) return 0;
  const v = groupValues(gen, groupId);
  return g.items.filter(it => String(v[it.id] ?? '') !== String(it.def ?? '')).length;
}

/** 有没有动过。 */
export const touched = gen => GROUPS.some(g => changedIn(gen, g.id) > 0);

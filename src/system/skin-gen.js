// 美化生成器：把一堆旋钮变成一段 CSS。见 ARCHITECTURE 4.137
//
// ---- 为什么要有它 ----
//
// 写 CSS 的人是少数。绝大多数人想要的是「气泡换个底色、加个渐变边框、
// 角上贴张图」，让他为此去学选择器和伪元素是不合理的。所以这里把常做的
// 那几十件事做成旋钮，生成的 CSS 原样存进那一份美化的自由层。
//
// **生成的仍然是普通 CSS，不是另一种格式。** 生成完还能接着手写，
// 也能整段复制给别人 —— 别人不装这个应用也用得上（见 4.136 的契约）。
//
// ---- 为什么带 !important ----
//
// 应用自己的样式表里有 `.msg.is-mine .bubble` 这种复合选择器，特异度
// 比单个 `.ph-bubble-mine` 高，光靠注入顺序压不住它。生成的这一段是机器
// 写的、随时可以整段重生成，所以在这儿用 `!important` 是合适的 ——
// 手写那一段排在它后面，要盖住它同样写 `!important`。
//
// ---- 加一样东西要改几处 ----
//
// 只改这个文件：`GROUPS` 里加一条控件，`emit` 里加一段输出。界面那一页
// 照着 `GROUPS` 画，不必跟着改。

/** 气泡这一组改哪一边。 */
export const SIDES = [
  { id: 'all', label: '双方', sel: '.ph-bubble' },
  { id: 'theirs', label: '角色', sel: '.ph-bubble-theirs' },
  { id: 'mine', label: '自己', sel: '.ph-bubble-mine' },
];
export const sideSel = id => (SIDES.find(s => s.id === id) || SIDES[0]).sel;

/** 贴图贴在哪个角。 */
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
  { id: 'flex-start', label: '顶部对齐' },
  { id: 'center', label: '居中对齐' },
  { id: 'flex-end', label: '底部对齐' },
];

export const FILLS = [
  { id: 'cover', label: '铺满' },
  { id: 'contain', label: '完整显示' },
  { id: 'repeat', label: '平铺' },
];
const fillCss = id => (id === 'repeat'
  ? 'background-repeat:repeat;background-size:auto'
  : `background-repeat:no-repeat;background-size:${id === 'contain' ? 'contain' : 'cover'};`
    + 'background-position:center');

/**
 * 每一组旋钮。界面那一页照着画，不另写一份。
 *
 *   type  color 取色 / num 数字 / pick 单选 / switch 开关 / image 传图
 *   def   默认值。**「和现在一样」就是这个值** —— 生成的时候会跳过没改过的，
 *         免得一段 CSS 里塞满和默认一模一样的声明
 */
export const GROUPS = [
  {
    id: 'bubble', label: '气泡', icon: 'message',
    items: [
      { id: 'side', label: '改哪一边', type: 'pick', options: SIDES, def: 'all',
        desc: '选定之后，下面这一组只作用于这一边。另一边保持默认' },
      { id: 'bg', label: '底色', type: 'color', def: '' },
      { id: 'grad', label: '底色用渐变', type: 'switch', def: false },
      { id: 'bg2', label: '渐变的第二个颜色', type: 'color', def: '', when: v => v.grad },
      { id: 'gradAngle', label: '渐变角度', type: 'num', unit: '度', def: 135, min: 0, max: 360,
        when: v => v.grad },
      { id: 'fg', label: '文字颜色', type: 'color', def: '' },
      { id: 'r', label: '圆角', type: 'num', unit: 'px', def: 0, min: 0, max: 40 },
      { id: 'px', label: '左右内距', type: 'num', unit: 'px', def: 0, min: 0, max: 40 },
      { id: 'py', label: '上下内距', type: 'num', unit: 'px', def: 0, min: 0, max: 40 },
      { id: 'fs', label: '字号', type: 'num', unit: 'px', def: 0, min: 0, max: 30 },
      { id: 'img', label: '气泡底图', type: 'image', def: '' },
      { id: 'imgFill', label: '底图怎么铺', type: 'pick', options: FILLS, def: 'cover',
        when: v => v.img },
      { id: 'imgOp', label: '底图透明度', type: 'num', unit: '%', def: 100, min: 0, max: 100,
        when: v => v.img },
    ],
  },
  {
    id: 'border', label: '边框与阴影', icon: 'layers',
    items: [
      { id: 'w', label: '边框粗细', type: 'num', unit: 'px', def: 0, min: 0, max: 12 },
      { id: 'c', label: '边框颜色', type: 'color', def: '', when: v => v.w > 0 },
      { id: 'grad', label: '边框用渐变', type: 'switch', def: false, when: v => v.w > 0,
        desc: '渐变边框占用气泡的 ::before。同时开启角落贴图二时，贴图二不生效' },
      { id: 'g2', label: '渐变的第二个颜色', type: 'color', def: '',
        when: v => v.w > 0 && v.grad },
      { id: 'gAngle', label: '渐变角度', type: 'num', unit: '度', def: 135, min: 0, max: 360,
        when: v => v.w > 0 && v.grad },
      { id: 'shadow', label: '投影大小', type: 'num', unit: 'px', def: 0, min: 0, max: 40 },
      { id: 'shColor', label: '投影颜色', type: 'color', def: '#000000', when: v => v.shadow > 0 },
      { id: 'shOp', label: '投影透明度', type: 'num', unit: '%', def: 20, min: 0, max: 100,
        when: v => v.shadow > 0 },
      { id: 'shY', label: '投影下移', type: 'num', unit: 'px', def: 2, min: -20, max: 20,
        when: v => v.shadow > 0 },
    ],
  },
  {
    id: 'deco1', label: '角落贴图一', icon: 'star',
    items: [
      { id: 'img', label: '图片', type: 'image', def: '',
        desc: '贴在气泡的 ::after 上。图中间不透明也没关系，它贴在角上，不盖住文字' },
      { id: 'size', label: '大小', type: 'num', unit: 'px', def: 40, min: 8, max: 200,
        when: v => v.img },
      { id: 'pos', label: '贴在哪个角', type: 'pick', options: ANCHORS, def: 'br',
        when: v => v.img },
      { id: 'x', label: '左右偏移', type: 'num', unit: 'px', def: 0, min: -120, max: 120,
        when: v => v.img },
      { id: 'y', label: '上下偏移', type: 'num', unit: 'px', def: 0, min: -120, max: 120,
        when: v => v.img },
      { id: 'rot', label: '旋转', type: 'num', unit: '度', def: 0, min: -180, max: 180,
        when: v => v.img },
      { id: 'op', label: '透明度', type: 'num', unit: '%', def: 100, min: 0, max: 100,
        when: v => v.img },
    ],
  },
  {
    id: 'deco2', label: '角落贴图二', icon: 'star',
    items: [
      { id: 'img', label: '图片', type: 'image', def: '',
        desc: '贴在气泡的 ::before 上。边框渐变也占用这一处，两者只能取其一' },
      { id: 'size', label: '大小', type: 'num', unit: 'px', def: 40, min: 8, max: 200,
        when: v => v.img },
      { id: 'pos', label: '贴在哪个角', type: 'pick', options: ANCHORS, def: 'tl',
        when: v => v.img },
      { id: 'x', label: '左右偏移', type: 'num', unit: 'px', def: 0, min: -120, max: 120,
        when: v => v.img },
      { id: 'y', label: '上下偏移', type: 'num', unit: 'px', def: 0, min: -120, max: 120,
        when: v => v.img },
      { id: 'rot', label: '旋转', type: 'num', unit: '度', def: 0, min: -180, max: 180,
        when: v => v.img },
      { id: 'op', label: '透明度', type: 'num', unit: '%', def: 100, min: 0, max: 100,
        when: v => v.img },
    ],
  },
  {
    id: 'avatar', label: '头像', icon: 'user',
    items: [
      { id: 'size', label: '大小', type: 'num', unit: 'px', def: 0, min: 0, max: 96 },
      { id: 'round', label: '圆角', type: 'num', unit: '%', def: 0, min: 0, max: 50,
        desc: '50 是正圆，0 表示不改' },
      { id: 'gap', label: '与气泡的距离', type: 'num', unit: 'px', def: 0, min: 0, max: 40 },
      { id: 'frameTheirs', label: '角色的头像框', type: 'image', def: '',
        desc: '中间要透明，否则会把头像盖住' },
      { id: 'frameMine', label: '自己的头像框', type: 'image', def: '' },
      { id: 'frameScale', label: '头像框大小', type: 'num', unit: '%', def: 160, min: 100, max: 300,
        when: v => v.frameTheirs || v.frameMine },
      { id: 'frameX', label: '头像框左右偏移', type: 'num', unit: 'px', def: 0, min: -40, max: 40,
        when: v => v.frameTheirs || v.frameMine },
      { id: 'frameY', label: '头像框上下偏移', type: 'num', unit: 'px', def: 0, min: -40, max: 40,
        when: v => v.frameTheirs || v.frameMine },
    ],
  },
  {
    id: 'nav', label: '顶栏', icon: 'chevronUp',
    items: [
      { id: 'bg', label: '底色', type: 'color', def: '' },
      { id: 'fg', label: '文字颜色', type: 'color', def: '' },
      { id: 'h', label: '高度', type: 'num', unit: 'px', def: 0, min: 0, max: 96 },
      { id: 'img', label: '背景图', type: 'image', def: '' },
      { id: 'imgFill', label: '背景图怎么铺', type: 'pick', options: FILLS, def: 'cover',
        when: v => v.img },
      { id: 'line', label: '隐藏底部那条分隔线', type: 'switch', def: false },
    ],
  },
  {
    id: 'composer', label: '底栏', icon: 'edit',
    items: [
      { id: 'bg', label: '底色', type: 'color', def: '' },
      { id: 'img', label: '背景图', type: 'image', def: '' },
      { id: 'imgFill', label: '背景图怎么铺', type: 'pick', options: FILLS, def: 'cover',
        when: v => v.img },
      { id: 'h', label: '按钮大小', type: 'num', unit: 'px', def: 0, min: 0, max: 72 },
      { id: 'pad', label: '内边距', type: 'num', unit: 'px', def: 0, min: 0, max: 30 },
      { id: 'inBg', label: '输入框底色', type: 'color', def: '' },
      { id: 'inFg', label: '输入框文字颜色', type: 'color', def: '' },
      { id: 'inR', label: '输入框圆角', type: 'num', unit: 'px', def: 0, min: 0, max: 40 },
      { id: 'btnFg', label: '圆按钮颜色', type: 'color', def: '' },
      { id: 'sendBg', label: '发送键底色', type: 'color', def: '' },
      { id: 'sendFg', label: '发送键图标颜色', type: 'color', def: '' },
    ],
  },
  {
    id: 'layout', label: '整体', icon: 'grid',
    items: [
      { id: 'bg', label: '聊天背景色', type: 'color', def: '' },
      { id: 'img', label: '聊天背景图', type: 'image', def: '' },
      { id: 'imgFill', label: '背景图怎么铺', type: 'pick', options: FILLS, def: 'cover',
        when: v => v.img },
      { id: 'gap', label: '两条消息之间', type: 'num', unit: 'px', def: 0, min: 0, max: 60 },
      { id: 'align', label: '头像与气泡的对齐', type: 'pick', options: ALIGNS, def: 'flex-start' },
      { id: 'quoteBg', label: '引用条底色', type: 'color', def: '' },
      { id: 'quoteFg', label: '引用条文字颜色', type: 'color', def: '' },
      { id: 'metaFg', label: '时刻与回执的颜色', type: 'color', def: '' },
      { id: 'barBg', label: '工具栏底色', type: 'color', def: '' },
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

/** 读一个值，缺了就用默认。存下来的那一份可能是旧版本，少几项是常事。 */
export function valueOf(gen, groupId, itemId) {
  const g = GROUPS.find(x => x.id === groupId);
  const it = g?.items.find(x => x.id === itemId);
  const v = gen?.[groupId]?.[itemId];
  if (it && (v === undefined || v === null || v === '')) return it.def;
  return v === undefined || v === null ? '' : v;
}

/** 这一组当前的全部值。 */
export const groupValues = (gen, groupId) => {
  const g = GROUPS.find(x => x.id === groupId);
  if (!g) return {};
  const out = {};
  g.items.forEach(it => { out[it.id] = valueOf(gen, g.id, it.id); });
  return out;
};

/** 这一条现在该不该显示。`when` 没写就一直显示。 */
export const showItem = (item, values) => (typeof item.when === 'function' ? !!item.when(values) : true);

// ---- 拼 CSS ----

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** 颜色是不是填了。空串表示「不改这一项」。 */
const has = v => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim());
/** 图是不是一张能嵌的图。只认 data:，理由和头像框同一条（见 4.134）。 */
const img = v => (/^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+$/.test(String(v || '')) ? String(v) : '');

const pct = v => Math.max(0, Math.min(100, num(v))) / 100;

/** #rrggbb 加透明度。用 color-mix 会把老 WebView 挡在外面，所以自己算。 */
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

function decoRule(sel, v, pseudo) {
  const url = img(v.img);
  if (!url) return '';
  const a = anchorOf(v.pos);
  const mid = a.mid ? `${a.mid} ` : '';
  return rule(`${sel}::${pseudo}`, [
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
  ]);
}

function bubbleBlock(gen) {
  const v = groupValues(gen, 'bubble');
  const b = groupValues(gen, 'border');
  const sel = sideSel(v.side);
  const out = [];
  const decls = [];

  if (has(v.bg)) {
    decls.push(v.grad && has(v.bg2)
      ? `background: linear-gradient(${num(v.gradAngle)}deg, ${v.bg}, ${v.bg2})`
      : `background: ${v.bg}`);
  }
  const bi = img(v.img);
  if (bi) {
    decls.push(`background-image: url("${bi}")`);
    fillCss(v.imgFill).split(';').forEach(x => decls.push(x.replace(':', ': ')));
    if (num(v.imgOp) !== 100) decls.push(`opacity: ${pct(v.imgOp)}`);
  }
  if (has(v.fg)) decls.push(`color: ${v.fg}`);
  if (num(v.r)) decls.push(`border-radius: ${num(v.r)}px`);
  if (num(v.px)) decls.push(`padding-left: ${num(v.px)}px`, `padding-right: ${num(v.px)}px`);
  if (num(v.py)) decls.push(`padding-top: ${num(v.py)}px`, `padding-bottom: ${num(v.py)}px`);
  if (num(v.fs)) decls.push(`font-size: ${num(v.fs)}px`);

  const gradBorder = num(b.w) > 0 && b.grad && has(b.c) && has(b.g2);
  if (num(b.w) > 0 && !gradBorder) {
    decls.push(`border: ${num(b.w)}px solid ${has(b.c) ? b.c : 'currentColor'}`);
  }
  if (num(b.shadow) > 0) {
    decls.push(`box-shadow: 0 ${num(b.shY)}px ${num(b.shadow)}px `
      + rgba(b.shColor || '#000000', pct(b.shOp)));
  }
  // 贴图与渐变边框都要绝对定位的伪元素，父级得先能定位
  const needsPos = gradBorder || img(groupValues(gen, 'deco1').img)
    || img(groupValues(gen, 'deco2').img);
  if (needsPos) decls.push('position: relative');

  if (decls.length) out.push(note('气泡') + '\n' + rule(sel, decls));

  if (gradBorder) {
    out.push(note('渐变边框。占用 ::before，所以此时角落贴图二不生效') + '\n' + rule(`${sel}::before`, [
      "content: ''",
      'position: absolute',
      `inset: -${num(b.w)}px`,
      'border-radius: inherit',
      `padding: ${num(b.w)}px`,
      `background: linear-gradient(${num(b.gAngle)}deg, ${b.c}, ${b.g2})`,
      '-webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
      '-webkit-mask-composite: xor',
      'mask-composite: exclude',
      'pointer-events: none',
    ]));
  }

  const d1 = decoRule(sel, groupValues(gen, 'deco1'), 'after');
  if (d1) out.push(note('角落贴图一') + '\n' + d1);
  if (!gradBorder) {
    const d2 = decoRule(sel, groupValues(gen, 'deco2'), 'before');
    if (d2) out.push(note('角落贴图二') + '\n' + d2);
  }
  return out;
}

function avatarBlock(gen) {
  const v = groupValues(gen, 'avatar');
  const out = [];
  const decls = [];
  if (num(v.size)) decls.push(`width: ${num(v.size)}px`, `height: ${num(v.size)}px`);
  if (num(v.round)) decls.push(`border-radius: ${num(v.round)}%`);
  if (decls.length) out.push(note('头像') + '\n' + rule('.ph-face .ph-avatar', decls));
  if (num(v.gap)) {
    out.push(note('头像与气泡的距离') + '\n'
      + rule('.ph-msg', [`gap: ${num(v.gap)}px`]));
  }

  const frame = (url, sel, label) => {
    const u = img(url);
    if (!u) return '';
    return note(label) + '\n'
      + rule(sel, ['position: relative'])
      + '\n' + rule(`${sel}::after`, [
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
  const t = frame(v.frameTheirs, '.ph-msg-theirs .ph-face', '角色的头像框');
  const m = frame(v.frameMine, '.ph-msg-mine .ph-face', '自己的头像框');
  if (t) out.push(t);
  if (m) out.push(m);
  return out;
}

function navBlock(gen) {
  const v = groupValues(gen, 'nav');
  const out = [];
  const decls = [];
  if (has(v.bg)) decls.push(`background: ${v.bg}`);
  const bi = img(v.img);
  if (bi) {
    decls.push(`background-image: url("${bi}")`);
    fillCss(v.imgFill).split(';').forEach(x => decls.push(x.replace(':', ': ')));
  }
  if (num(v.h)) decls.push(`height: ${num(v.h)}px`);
  if (v.line) decls.push('border-bottom: none', 'box-shadow: none');
  if (decls.length) out.push(note('顶栏') + '\n' + rule('.ph-navbar', decls));
  if (has(v.fg)) {
    out.push(note('顶栏文字与按钮') + '\n'
      + rule('.ph-navbar, .ph-nav-title, .ph-nav-left, .ph-nav-right', [`color: ${v.fg}`]));
  }
  return out;
}

function composerBlock(gen) {
  const v = groupValues(gen, 'composer');
  const out = [];
  const bar = [];
  if (has(v.bg)) bar.push(`background: ${v.bg}`);
  const bi = img(v.img);
  if (bi) {
    bar.push(`background-image: url("${bi}")`);
    fillCss(v.imgFill).split(';').forEach(x => bar.push(x.replace(':', ': ')));
  }
  if (num(v.pad)) bar.push(`padding-top: ${num(v.pad)}px`, `padding-bottom: ${num(v.pad)}px`);
  if (bar.length) out.push(note('底栏') + '\n' + rule('.ph-composer', bar));

  const input = [];
  if (has(v.inBg)) input.push(`background: ${v.inBg}`);
  if (has(v.inFg)) input.push(`color: ${v.inFg}`);
  if (num(v.inR)) input.push(`border-radius: ${num(v.inR)}px`);
  if (num(v.h)) input.push(`min-height: ${num(v.h)}px`);
  if (input.length) out.push(note('输入框') + '\n' + rule('.ph-composer-input', input));

  const btn = [];
  if (num(v.h)) btn.push(`width: ${num(v.h)}px`, `height: ${num(v.h)}px`);
  if (has(v.btnFg)) btn.push(`color: ${v.btnFg}`);
  if (btn.length) out.push(note('底栏圆按钮') + '\n' + rule('.ph-composer-btn', btn));

  const send = [];
  if (has(v.sendBg)) send.push(`background: ${v.sendBg}`);
  if (has(v.sendFg)) send.push(`color: ${v.sendFg}`);
  if (num(v.h)) send.push(`width: ${num(v.h)}px`, `height: ${num(v.h)}px`);
  if (send.length) out.push(note('发送键') + '\n' + rule('.ph-send', send));
  return out;
}

function layoutBlock(gen) {
  const v = groupValues(gen, 'layout');
  const out = [];
  const body = [];
  if (has(v.bg)) body.push(`background: ${v.bg}`);
  const bi = img(v.img);
  if (bi) {
    body.push(`background-image: url("${bi}")`);
    fillCss(v.imgFill).split(';').forEach(x => body.push(x.replace(':', ': ')));
  }
  if (body.length) out.push(note('聊天背景') + '\n' + rule('.ph-chat-body', body));

  const row = [];
  if (num(v.gap)) row.push(`margin-bottom: ${num(v.gap)}px`);
  if (v.align && v.align !== 'flex-start') row.push(`align-items: ${v.align}`);
  if (row.length) out.push(note('每一行消息') + '\n' + rule('.ph-msg', row));

  const q = [];
  if (has(v.quoteBg)) q.push(`background: ${v.quoteBg}`);
  if (has(v.quoteFg)) q.push(`color: ${v.quoteFg}`);
  if (q.length) out.push(note('引用条') + '\n' + rule('.ph-quote', q));

  if (has(v.metaFg)) {
    out.push(note('时刻与已读回执') + '\n'
      + rule('.ph-meta, .ph-stamp, .ph-read', [`color: ${v.metaFg}`]));
  }
  if (has(v.barBg)) out.push(note('工具栏') + '\n' + rule('.ph-toolbar', [`background: ${v.barBg}`]));
  return out;
}

export const HEAD = '/* 以下由「生成」页自动写出，手动改动会在下次生成时被覆盖。 */';
export const TAIL = '/* 自动生成结束 */';

/**
 * 生成那一段 CSS。没动过任何旋钮就回空串 —— 不留一段空壳注释。
 */
export function emit(gen) {
  const blocks = [
    ...bubbleBlock(gen), ...avatarBlock(gen),
    ...navBlock(gen), ...composerBlock(gen), ...layoutBlock(gen),
  ].filter(Boolean);
  if (!blocks.length) return '';
  return [HEAD, ...blocks, TAIL].join('\n\n');
}

/** 这一份用到了多少张内嵌的图，一共多少字节。界面上要说得出账。 */
export function weigh(gen) {
  let n = 0;
  let bytes = 0;
  const eat = v => {
    const u = img(v);
    if (!u) return;
    n += 1;
    bytes += Math.round((u.length - u.indexOf(',') - 1) * 3 / 4);
  };
  GROUPS.forEach(g => g.items.forEach(it => {
    if (it.type === 'image') eat(valueOf(gen, g.id, it.id));
  }));
  return { n, bytes };
}

/** 有没有动过。界面上拿它决定要不要显示「清空」。 */
export const touched = gen => GROUPS.some(g => {
  const v = groupValues(gen, g.id);
  return g.items.some(it => String(v[it.id] ?? '') !== String(it.def ?? ''));
});

import { settings, images } from './db/index.js';
import { applyFont } from './reader.js';

// 线下的外观。**和全局主题、和阅读器都分开存**：线下想要的纸色字号，
// 和读书时想要的不是一回事，改这边不该动那两边。理由同 reader.js 开头那段。
//
// 三套内置主题各是一整组值，选一个就一次性填好，之后随便改哪一项。
// 刻意避开「暖奶油底 + 衬线 + 赤陶色」那一套 —— 那不是杂志感，
// 那是现在满大街的生成感配色。

export const THEMES = [
  { id: 'body',  label: '正文', serif: true,
    bg: '#FCFBF8', ink: '#1C1F24', dim: '#6E737B', line: '#E2E0D9', mark: '#27405E' },
  { id: 'night', label: '夜刊', serif: true,
    bg: '#15171B', ink: '#E6E3DB', dim: '#8B9098', line: '#2A2E35', mark: '#C2A15B' },
  { id: 'plain', label: '素',   serif: false,
    bg: '#FFFFFF', ink: '#101214', dim: '#70757C', line: '#EBEDEF', mark: '#1F6F5C' },
  { id: 'custom', label: '自定义' },
];

export const themeOf = id => THEMES.find(t => t.id === id) || THEMES[0];

// 字体全走系统栈，不联网 —— 项目无构建，也要能离线用。想换字体走
// fonts.js 上传的那些，或者填一个 fontUrl。
export const SERIF = '"Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif';
export const SANS  = '"PingFang SC", "Heiti SC", system-ui, -apple-system, sans-serif';

// 几份现成的字体。**默认那一份不联网**，其余的按一下才去取。
//
// 系统里没有「软」的那一类中文字体 —— iOS 只有宋体和黑体，都偏硬。
// 楷体那一份笔画保留手写的起收，是这里最不生硬的选择。
//
// 链接与字体名都是从各自的仓库文档里抄的，**不是猜的**：字体名猜错的表现
// 和「设置不生效」一模一样（reader.js 开头那段写过这件事）。
export const FONTS = [
  { id: '', label: '系统字体', url: '', family: '',
    note: '不联网。按下面的「衬线字体」在宋体与黑体之间切换' },
  { id: 'kai', label: '霞鹜文楷',
    url: 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-web/style.css',
    family: 'LXGW WenKai Screen',
    note: '楷体，笔画保留手写的起收。需要联网，取自 jsDelivr' },
  { id: 'song', label: '思源宋体',
    url: 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@200..900&display=swap',
    family: 'Noto Serif SC',
    note: '宋体。需要联网，取自 Google Fonts，部分网络环境下取不到' },
  { id: 'hei', label: '思源黑体',
    url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@100..900&display=swap',
    family: 'Noto Sans SC',
    note: '黑体。需要联网，取自 Google Fonts，部分网络环境下取不到' },
];

export const DEFAULTS = {
  theme: 'body',
  placement: 'page',    // page 单开一页 | inline 就在聊天里，划一条线往下演
  layout: 'page',       // page 一张一张翻 | cards 竖着滑的明信片 | bubble 长气泡
  spread: false,        // 正文铺满整屏，还是在固定区域内滚动
  pageChars: 700,       // 一段超过这么多字就续张。0 = 不切，这一张里滚
  effect: 'slide',      // 翻页效果，取值同 reader.EFFECTS
  tapTurn: true,
  sign: 'full',         // 署名：full 编号加细线 | line 只一行 | none 不显示
  marks: true,          // 对白与动作分样式（只是展示层）
  drop: true,           // 首字下沉。一段的第一张才有
  cardGrow: true,       // 明信片跟着内容长；关了每片一样大，文字在片内滚
  cover: true,          // 气泡那一档顶上那张方形封面与署名
  serif: true,
  bgColor: '', ink: '', dim: '', line: '', mark: '',   // theme 为 custom 时用
  bgImage: null,
  fontSize: 17,
  lineHeight: 1.9,
  measure: 34,          // 一行多少个汉字。西文那条 65 字符的老规矩
  paraGap: 1,           // 段距，em
  fontUrl: '', fontFamily: '',
  css: '',              // 自定义 CSS。只在线下页面挂载时注入，离开就移除
};

export const get = () => {
  const raw = { ...DEFAULTS, ...(settings.get().stage || {}) };
  // 从前这一项是个开关（stamp），现在有三档。老设置里关着的，对应「不显示」
  if (raw.stamp === false && !settings.get().stage?.sign) raw.sign = 'none';
  return raw;
};

export const PLACEMENTS = [
  { id: 'page', label: '单开页面', desc: '从功能面板进去，整屏都是线下。可以翻页，可以铺满' },
  { id: 'inline', label: '就在聊天里', desc: '在会话里划一条线，往下就按线下的规则演。翻页与分张在这一档不适用' },
];

// 前两档是刊物的排法（阅读），第三档是另一种读法。见 ARCHITECTURE 4.118
export const LAYOUTS = [
  { id: 'page', label: '翻页', desc: '一次一张，点左右两侧翻。一段太长自动续张' },
  { id: 'cards', label: '明信片', desc: '竖着滑，一张一张排下去。这一档会显示头像' },
  { id: 'bubble', label: '气泡',
    desc: '竖着滚，一段一个长气泡。顶上一张方形封面与署名，气泡内按句断行' },
];

export const SIGNS = [
  { id: 'full', label: '完整', desc: '一行名字，一行地点、时刻与编号，下面一道细线。明信片版式下另带头像' },
  { id: 'line', label: '一行', desc: '只有一行名字、地点与时刻' },
  { id: 'none', label: '不显示', desc: '正文之外什么都不写' },
];

export function set(patch) {
  settings.set({ stage: { ...get(), ...patch } });
}

/** 换一套内置主题：把那一组颜色一次性填进去，之后改哪一项都还是改得动。 */
export function useTheme(id) {
  const t = themeOf(id);
  if (id === 'custom') { set({ theme: 'custom' }); return; }
  set({ theme: id, bgColor: t.bg, ink: t.ink, dim: t.dim, line: t.line, mark: t.mark, serif: t.serif });
}

export async function setBgImage(file) {
  const id = await images.put(file, 1600);
  const old = get().bgImage;
  set({ bgImage: id });
  if (old) images.remove(old);
  return id;
}

export function clearBgImage() {
  const old = get().bgImage;
  set({ bgImage: null });
  if (old) images.remove(old);
}

export const reset = () => settings.set({ stage: { ...DEFAULTS } });

/** 某一场单独换过外观的话，用它那一份盖在全局上。 */
export const forScene = scene => ({ ...get(), ...(scene?.stage || {}) });

// 标记色兑淡一点，给邮戳当底。CSS 那边 color-mix 不是每台机器都有，
// 而且用户填进来的可能是任何写法 —— 认不出来就退回透明，不猜。
function soften(hex, alpha) {
  const m = String(hex || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return 'transparent';
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 这一套配下来底色是什么。外壳那条也要跟着染，见 mountChrome */
export const bgOf = cfg => cfg.bgColor || themeOf(cfg.theme).bg || '#FCFBF8';

/** 线下那一层要用的 CSS 变量。颜色是用户自己挑的，不是设计令牌。 */
export function varsOf(cfg, bgUrl = '') {
  const t = themeOf(cfg.theme);
  const v = {
    '--sg-bg': cfg.bgColor || t.bg || '#FCFBF8',
    '--sg-ink': cfg.ink || t.ink || '#1C1F24',
    '--sg-dim': cfg.dim || t.dim || '#6E737B',
    '--sg-line': cfg.line || t.line || '#E2E0D9',
    '--sg-mark': cfg.mark || t.mark || '#27405E',
    '--sg-mark-soft': soften(cfg.mark || t.mark || '#27405E', 0.08),
    '--sg-fs': `${cfg.fontSize}px`,
    '--sg-lh': String(cfg.lineHeight),
    '--sg-gap': `${cfg.paraGap}em`,
    '--sg-measure': `${cfg.measure}em`,
    '--sg-font': cfg.fontFamily ? `"${cfg.fontFamily}", ${cfg.serif ? SERIF : SANS}` : (cfg.serif ? SERIF : SANS),
  };
  if (bgUrl) v['--sg-bg-image'] = `url(${bgUrl})`;
  return Object.entries(v).map(([k, val]) => `${k}:${val}`).join(';');
}

// ---- 自定义 CSS ----
//
// 只在线下页面挂着的时候插进去，离开就摘掉 —— 全局那份 customCSS 是一直在的，
// 这一份不该漏到别的 app 上去。

// ---- 外壳那条也要染 ----
//
// 线下是整屏接管的，可外壳的状态栏那一条在 .page-body 之外，仍然是 app 的
// 底色。深色主题下上方就留一条白边 —— 那就不是「整个页面进入线下」了。
// 挂着的时候把底色写到 :root 上，离开就撤掉。

export function mountChrome(bg) {
  const el = document.documentElement;
  el.dataset.stage = 'on';
  el.style.setProperty('--sg-chrome', String(bg || ''));
}

export function unmountChrome() {
  const el = document.documentElement;
  delete el.dataset.stage;
  el.style.removeProperty('--sg-chrome');
}

// ---- 字体 ----
//
// 光把字体名写进 --sg-font 是不够的，还得真把那份样式表挂上去 ——
// 不挂的话填了字体链接什么也不会发生，表现和「设置不生效」一模一样。
// 和阅读器共用 reader.applyFont，各用各的标签，互不拆对方的。

const FONT_TAG = 'stage-font';

export const mountFont = cfg => applyFont(cfg, FONT_TAG);
export const unmountFont = () =>
  document.querySelectorAll(`[data-${FONT_TAG}]`).forEach(el => el.remove());

const NODE_ID = 'stage-css';

export function mountCSS(css) {
  let el = document.getElementById(NODE_ID);
  const text = String(css || '');
  if (!text.trim()) { unmountCSS(); return; }
  if (!el) {
    el = document.createElement('style');
    el.id = NODE_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== text) el.textContent = text;
}

export function unmountCSS() {
  document.getElementById(NODE_ID)?.remove();
}

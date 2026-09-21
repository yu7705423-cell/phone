import { settings, images } from './db/index.js';

// 阅读器的外观。**和全局主题分开存**：读书时想要的纸色、字体、字号，
// 和整个 app 的皮肤本来就不是一回事，改这边不该动那边。
//
// 参考 read 项目里那一套阅读设置。两处经验直接照搬：
//   一、字体链接有两种，样式表和字体文件本身，按扩展名分流；
//   二、字体名不能从 URL 猜，猜出来是空字符串，表现和「设置不生效」一样。

export const EFFECTS = [
  { id: 'instant',  label: '无动画',   desc: '直接换页' },
  { id: 'slide',    label: '左右平移', desc: '向左滑出，新的一页从右侧进来' },
  { id: 'fade',     label: '淡入淡出', desc: '淡出之后换页，再淡入' },
  { id: 'vertical', label: '上下翻页', desc: '向上滑出，新的一页从下方进来' },
];

// 不做「覆盖」和「仿真卷曲」：那两种要同屏出现两页，而这里只有一份正文。
// 复制一份出来就得复制 DOM，代价不值。理由和 read 项目里写的是同一条。

export const PAPERS = [
  { id: 'theme',  label: '跟随主题' },
  { id: 'paper',  label: '纸白' },
  { id: 'sepia',  label: '米黄' },
  { id: 'night',  label: '夜间' },
  { id: 'custom', label: '自定义' },
];

export const DEFAULTS = {
  effect: 'slide',
  fullscreen: false,
  paper: 'theme',
  bgColor: '',          // paper 为 custom 时用
  bgImage: null,        // 图片 id
  textColor: '',        // 空 = 跟随纸色
  fontSize: 17,
  lineHeight: 1.85,
  fontUrl: '',
  fontFamily: '',
  tapTurn: true,        // 点左右两侧翻页
};

export const get = () => ({ ...DEFAULTS, ...(settings.get().reader || {}) });

export function set(patch) {
  settings.set({ reader: { ...get(), ...patch } });
}

export async function setBgImage(file) {
  const id = await images.put(file, 1600);
  const old = get().bgImage;
  set({ bgImage: id, paper: 'custom' });
  if (old) images.remove(old);
  return id;
}

export function clearBgImage() {
  const old = get().bgImage;
  set({ bgImage: null });
  if (old) images.remove(old);
}

export const reset = () => settings.set({ reader: { ...DEFAULTS } });

const FONT_FILE = /\.(ttf|otf|woff2?|ttc)(\?|#|$)/i;

/** 这个链接是字体文件，还是声明 @font-face 的样式表。 */
export const isFontFile = url => FONT_FILE.test(String(url || '').trim());

/**
 * 字体文件的链接能推出一个可读的名字；样式表的推不出来，得用户自己填。
 * 猜不出来时返回空字符串，由界面提示填写。
 */
export function familyFromUrl(url) {
  const u = String(url || '').trim();
  if (!isFontFile(u)) return '';
  const last = u.split(/[?#]/)[0].split('/').pop() || '';
  const base = last.replace(FONT_FILE, '').replace(/[_-]+/g, ' ').trim();
  return base || '';
}

const formatOf = url => {
  const m = String(url).toLowerCase().match(/\.(ttf|otf|woff2|woff|ttc)(\?|#|$)/);
  return ({ ttf: 'truetype', ttc: 'truetype', otf: 'opentype',
    woff: 'woff', woff2: 'woff2' })[m?.[1]] || 'truetype';
};

const TAG = 'reader-font';

/**
 * 把字体挂上去。样式表走 <link>，字体文件自己生成一段 @font-face。
 * 挂错种类什么也不会发生 —— 浏览器拿二进制当 CSS 解析，然后就没有然后了，
 * 表现和「设置不生效」一模一样，所以这里必须分流。
 */
export function applyFont({ fontUrl, fontFamily }, tag = TAG) {
  // 按标签清自己那一份。阅读器和线下各挂各的，共用一个标签会互相拆掉
  document.querySelectorAll(`[data-${tag}]`).forEach(el => el.remove());
  const url = String(fontUrl || '').trim();
  const family = String(fontFamily || '').trim();
  if (!url || !family) return;

  const el = isFontFile(url)
    ? Object.assign(document.createElement('style'), {
      textContent: `@font-face{font-family:"${family}";`
        + `src:url("${url}") format("${formatOf(url)}");font-display:swap;}`,
    })
    : Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url });
  el.setAttribute(`data-${tag}`, '1');
  document.head.appendChild(el);
}

/**
 * 字体到底加载上没有。名字填了、文字没变，最容易让人以为是 app 坏了，
 * 所以界面上要明说。取字体被 CORS 拒掉是最常见的原因。
 */
export async function fontStatus(family) {
  const f = String(family || '').trim();
  if (!f) return null;
  try {
    await document.fonts.ready;
    return document.fonts.check(`16px "${f}"`);
  } catch { return null; }
}

/** 阅读区那一层要用的 CSS 变量。颜色是用户自己挑的，不是设计令牌。 */
export function varsOf(cfg, bgUrl = '') {
  const v = {};
  if (cfg.paper === 'custom') {
    if (cfg.bgColor) v['--rd-bg'] = cfg.bgColor;
    if (bgUrl) v['--rd-bg-image'] = `url(${bgUrl})`;
  }
  if (cfg.textColor) v['--rd-ink'] = cfg.textColor;
  v['--rd-fs'] = `${cfg.fontSize}px`;
  v['--rd-lh'] = String(cfg.lineHeight);
  if (cfg.fontFamily) v['--rd-font'] = `"${cfg.fontFamily}"`;
  return Object.entries(v).map(([k, val]) => `${k}:${val}`).join(';');
}

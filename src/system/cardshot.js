import { images } from './db/index.js';

// 把几条消息渲染成一张「截图」。
//
// ---- 为什么不直接光栅化了事 ----
//
// 浏览器没有 DOM 转图片的原生 API。唯一不引第三方库的办法是把 HTML 塞进
// SVG 的 foreignObject 再画到 canvas 上，而这条路有几处硬限制：
//
//   · SVG 当作图片加载时是**不取外部资源**的。所以里面每一张图都得先变成
//     data URL，blob: 地址一概加载不到
//   · 同理，网络字体也不会加载。用户自己设了字体链接时，光栅出来的那张
//     会退回系统字体
//   · Safari 对 foreignObject 光栅化一直有毛病
//
// 所以**快照才是主，光栅图是副**：卡片永远存得下可重新渲染的那一份，
// 光栅失败只是少一张能导出的 png，不影响相册里看。

const SHEETS = ['styles/base.css', 'styles/app.css'];

let cssOnce = null;

/** app 自带的那几张样式表，取一次缓存住。 */
export function appCss() {
  if (!cssOnce) {
    cssOnce = Promise.all(SHEETS.map(u => fetch(u)
      .then(r => (r.ok ? r.text() : ''))
      .catch(() => ''))).then(parts => parts.join('\n'));
  }
  return cssOnce;
}

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const blobToDataUrl = blob => new Promise(res => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result || ''));
  fr.onerror = () => res('');
  fr.readAsDataURL(blob);
});

async function srcOf(id, dataUrls) {
  if (!id) return '';
  if (!dataUrls) return (await images.url(id)) || '';
  const b = await images.blob(id);
  return b ? blobToDataUrl(b) : '';
}

const initial = name => esc(String(name || '?').trim().slice(0, 1) || '?');

function face(url, name) {
  return url
    ? `<div class="msg-face"><img class="avatar" src="${esc(url)}"
        style="width:36px;height:36px;border-radius:18px" alt=""/></div>`
    : `<div class="msg-face"><div class="avatar avatar-fallback"
        style="width:36px;height:36px;border-radius:18px">${initial(name)}</div></div>`;
}

// 常见那几种各有样子，别的一律退回一个普通气泡按正文显示 ——
// 认不出来也要看得见，不能空一块
function body(m, imgUrl) {
  if (m.kind === 'image' && imgUrl) {
    return `<div class="bubble bubble-media"><img src="${esc(imgUrl)}"
      style="max-width:220px;border-radius:10px;display:block" alt=""/></div>`;
  }
  if (m.kind === 'sticker' && imgUrl) {
    return `<div class="bubble-sticker"><img src="${esc(imgUrl)}"
      style="width:112px;display:block" alt=""/></div>`;
  }
  const text = esc(m.content || '').replace(/\n/g, '<br/>');
  return `<div class="bubble">${text}</div>`;
}

/**
 * 拼出这几条消息的 HTML。
 * dataUrls 为真时图片全部内联成 data URL —— 光栅那一路必须这样。
 */
export async function buildHtml(msgs, { dataUrls = false, meName = '我' } = {}) {
  const rows = [];
  for (const m of msgs || []) {
    if (!m) continue;
    const mine = m.role === 'user';
    const avatar = await srcOf(m._avatar, dataUrls);
    const img = await srcOf(m.imageId || m.stickerId || m._img, dataUrls);
    rows.push(`<div class="msg${mine ? ' is-mine' : ''}">`
      + face(avatar, mine ? meName : m._name)
      + `<div class="msg-col">${body(m, img)}</div></div>`);
  }
  return `<div class="shot">${rows.join('')}</div>`;
}

/** 卡片那一层自己的排版。气泡样式全部来自 app.css，这里只管外面这一圈。 */
export const SHOT_CSS = `
.shot { padding: 16px 14px; display: flex; flex-direction: column; gap: 10px;
        background: var(--bg, #fff); }
.shot .msg { opacity: 1; }
`;

/**
 * 画成 png。**失败返回 null，不抛** —— 快照那一份已经存下了，
 * 这里只是锦上添花，不该让整个保存跟着失败。
 */
/**
 * 这张图能画到几倍。
 *
 * MAX_AREA 取一千两百万，留在 iOS 那条线（约一千六百万）下面一截 —— 那条线
 * 各代机型并不一样，卡着画等于赌。
 */
export const MAX_AREA = 12e6;

/**
 * 单边最长到哪儿。**这一条是补上的，从前只限面积。**
 *
 * 面积守住了不等于画得出来：画布每条边另有一个硬上限（iOS 上大约 16384，
 * 各代不一样）。而这里的高度是跟着选了多少条走的 —— 量过，
 * 二百条算出来 18300、四百条 25880，面积都压在 12M 以内，高度却早就越界了。
 * 越界的后果不是画糊一点，是画布根本分配不出来，渲染进程被系统收走：
 * 屏幕白掉，app 看着像闪退。相册里点「重新生成图片」闪退就是这一条。
 *
 * 取 8192，比那条线再退一半 —— 赌不起。
 */
export const MAX_SIDE = 8192;

/**
 * 缩到这个倍率以下就别画了。
 *
 * 一张四百条的卡片要压到 0.34 倍才装得下，那时候字已经完全看不清 ——
 * 交出去一张糊得没法用的图，比明说「这张太长画不了」更糟：
 * 用户会以为功能坏了，而实际上是他要的东西本来就不该是一张图。
 */
export const MIN_SCALE = 0.5;

/** 那张内嵌一切的 data URL 最长到哪儿。八兆的字符串已经够一张很满的卡片了。 */
export const MAX_URL = 8e6;

export function fitScale(w, h) {
  const want = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const area = Math.max(1, w * h);
  // 面积与单边各算一个，取最紧的那个
  const byArea = area * want * want <= MAX_AREA ? want : Math.sqrt(MAX_AREA / area);
  const bySide = Math.min(MAX_SIDE / Math.max(1, w), MAX_SIDE / Math.max(1, h));
  return Math.min(want, byArea, bySide);
}

/** 这张画得出来吗。画不出来的时候要说得出是为什么，不能只回一个 null。 */
export function checkSize(w, h) {
  const scale = fitScale(w, h);
  if (scale < MIN_SCALE) {
    return { ok: false, scale,
      reason: `这张卡片有 ${Math.round(h)} 像素高，压到能画的尺寸之后字已经看不清了。`
        + '可以分几次保存成多张卡片。' };
  }
  return { ok: true, scale };
}

export async function raster({ html, css, width, height }) {
  try {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const doc = `<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
      + `<foreignObject x="0" y="0" width="${w}" height="${h}">`
      + `<style xmlns="http://www.w3.org/1999/xhtml">${css}</style>${doc}`
      + `</foreignObject></svg>`;

    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    // 同一类的第二处：卡片里每张图都是内嵌的 dataURL，十来张照片就是几兆，
    // 转义完再翻两三倍，然后整个字符串还要被解码成一张图。画布那边压住了，
    // 这边照样能把内存顶穿。顶穿的后果同样是白屏。
    //
    // 太大就不画了，回 null。**卡片本身不受影响** —— 那份快照早存好了，
    // 相册里照常打得开，只是少一张顺带光栅出来的 png。
    if (url.length > MAX_URL) return null;
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('foreignObject 画不出来'));
      i.src = url;
    });

    // **画布有硬上限，超了不是画不好，是整个页面没了。**
    //
    // iOS 上 canvas 的面积超过一千多万像素就画不出来：轻则得到一张纯白图，
    // 重则内存一紧，渲染进程被系统收走 —— 屏幕整个白掉，app 看着像退出了。
    // 而这里的高度是**跟着选了多少条走的**，选一百条就是两万像素高，
    // 再乘上二倍屏，三千四百万像素，稳稳超过。
    //
    // 所以按面积反推倍率：能画到二倍就二倍，画不下就一路降到刚好装得下。
    // 降倍率只是这张图糊一点，不降就是没有这张图、而且把人踢出去
    // —— 而卡片本身（那份快照）早就存好了，这张 png 本来就是顺带的。
    const fit = checkSize(w, h);
    if (!fit.ok) return null;
    const scale = fit.scale;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * scale));
    cv.height = Math.max(1, Math.round(h * scale));
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise(res => cv.toBlob(b => res(b), 'image/png'));
  } catch {
    return null;
  }
}

/**
 * 不经界面地画一张出来：离屏挂一个 shadow host，渲染、量高、光栅，量完就拆。
 *
 * 为什么要真的挂进文档：高度得由排版算出来，凭字数猜一定不准。
 * 挂在屏幕外而不是 display:none —— 后者不参与布局，量出来是 0。
 */
/**
 * 上一次没画成是为什么。空字符串表示没有特别的原因（多半是这台设备不支持）。
 *
 * 不改 `rasterCard` 的返回类型：它回 null 这件事有两处调用方都在依赖，
 * 为了带一句话把契约改掉，得让两边都跟着改。
 */
let lastReason = '';
export const whyNot = () => lastReason;

export async function rasterCard({ msgs, css }) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:430px;pointer-events:none;';
  document.body.appendChild(host);
  try {
    const root = host.attachShadow({ mode: 'open' });
    const [base, body] = await Promise.all([
      appCss(), buildHtml(msgs, { dataUrls: true }),
    ]);
    const full = `${base}\n${SHOT_CSS}\n${css || ''}`;
    root.innerHTML = `<style>${full}</style>${body}`;
    // 图没解完就量，高度会少算一截
    await Promise.all([...root.querySelectorAll('img')]
      .map(i => (i.decode ? i.decode().catch(() => {}) : Promise.resolve())));
    await new Promise(r => requestAnimationFrame(r));
    const box = root.querySelector('.shot');
    if (!box || !box.offsetHeight) return null;
    const w = box.offsetWidth || 430;
    const h = box.offsetHeight;
    // 太长的那一种，调用方要能说出原因，不能笼统地说「这台设备画不出来」
    const fit = checkSize(w, h);
    if (!fit.ok) { lastReason = fit.reason; return null; }
    lastReason = '';
    return await raster({ html: body, css: full, width: w, height: h });
  } catch {
    return null;
  } finally {
    host.remove();
  }
}

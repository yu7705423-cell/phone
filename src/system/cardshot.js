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
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('foreignObject 画不出来'));
      i.src = url;
    });

    const scale = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas');
    cv.width = w * scale;
    cv.height = h * scale;
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
    return await raster({ html: body, css: full, width: box.offsetWidth || 430, height: box.offsetHeight });
  } catch {
    return null;
  } finally {
    host.remove();
  }
}

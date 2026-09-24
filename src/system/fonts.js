import { settings } from './db/index.js';
import { files } from './db/files.js';

// 自定义字体。字体文件存进 files 域（二进制，不压缩），
// 用 FontFace 直接喂 ArrayBuffer 注册 —— 比 blob URL 稳，
// 不用猜 format()，woff2 / woff / ttf / otf 一视同仁。

export const ACCEPT = '.ttf,.otf,.woff,.woff2,font/*,application/font-woff,application/x-font-ttf';

const loaded = new Map();   // 记录 id -> FontFace，避免重复注册

export function list() {
  return settings.get().fonts || [];
}

export function get(id) {
  return list().find(f => f.id === id) || null;
}

// family 名用记录 id，保证唯一，不会和系统里同名字体打架。
// 在线字体（CSS 网址）例外：样式表里写死了 family，只能照它的叫
export const familyOf = id => get(id)?.family || `uf-${id}`;

// 手写体那一槽的默认：系统里有楷体、行楷就用，没有回落到 cursive
export const HAND_STACK = '"Xingkai SC", "STXingkai", "Kaiti SC", "STKaiti", "KaiTi", "BiauKai", cursive';

// 几款常见的中文手写体（Google Fonts）。点一下按网址添加，需要联网才显示
export const HAND_PRESETS = [
  { name: '马善政楷书', family: 'Ma Shan Zheng' },
  { name: '志莽行书', family: 'Zhi Mang Xing' },
  { name: '龙藏体', family: 'Long Cang' },
  { name: '刘建毛草', family: 'Liu Jian Mao Cao' },
].map(x => ({ ...x, url: `https://fonts.googleapis.com/css2?family=${x.family.replace(/ /g, '+')}&display=swap` }));

// 在线字体：挂一个 <link>，等浏览器按需去取
function linkCss(rec) {
  const id = `font-css-${rec.id}`;
  if (document.getElementById(id)) return;
  const el = document.createElement('link');
  el.id = id; el.rel = 'stylesheet'; el.href = rec.css;
  document.head.appendChild(el);
}

export async function ensureLoaded(id) {
  if (!id || loaded.has(id)) return loaded.get(id) || null;
  const rec = get(id);
  if (!rec) return null;
  if (rec.css) {
    linkCss(rec);
    await document.fonts.load(`20px "${rec.family}"`, '永').catch(() => {});
    loaded.set(id, true);
    return true;
  }
  const blob = await files.blob(rec.fileId);
  if (!blob) throw new Error('字体文件不见了');
  const face = new FontFace(familyOf(id), await blob.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  loaded.set(id, face);
  return face;
}

function stackFor(id, fallbackVar) {
  return id ? `${familyOf(id)}, ${fallbackVar}` : fallbackVar;
}

// 把当前选中的字体应用到两个槽位。没选就用回令牌里的默认值。
export async function apply(s = settings.get()) {
  const root = document.documentElement;
  const jobs = [];

  const slot = (id, prop, fallback) => {
    if (!id || !get(id)) { root.style.removeProperty(prop); return; }
    // 先设上去，加载完之前浏览器自己会回落到后面的系统字体，不会白屏
    root.style.setProperty(prop, stackFor(id, fallback));
    jobs.push(ensureLoaded(id).catch(err => {
      console.warn('[fonts] 装不上:', err.message || err);
      root.style.removeProperty(prop);
    }));
  };

  slot(s.fontBody, '--font',
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif');
  slot(s.fontSerif, '--font-serif',
    '"Songti SC", "Times New Roman", Georgia, serif');
  slot(s.fontHand, '--font-hand', HAND_STACK);

  await Promise.all(jobs);
}

export async function add(file) {
  const name = (file.name || '字体').replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, '');
  const buf = await file.arrayBuffer();
  // 先验一遍能不能用，别把坏文件存进去
  const probe = new FontFace('uf-probe', buf);
  try {
    await probe.load();
  } catch {
    throw new Error('这个文件解析不出字体，换一个 ttf / otf / woff / woff2');
  }
  const fileId = await files.put(file, { name: file.name, type: file.type || 'font/ttf' });
  const rec = { id: 'fnt-' + Date.now().toString(36), name, fileId, bytes: file.size };
  settings.set({ fonts: [...list(), rec] });
  return rec;
}

/**
 * 按网址添加。两种网址：
 *
 *   字体文件（.woff2 / .ttf …）  下载下来存进本机，和传文件一样，离线也能用
 *   样式表（Google Fonts 那种）   存网址，用的时候挂一个 <link>。中文字体被切成上百片，
 *                                浏览器只取用得到的那几片，整份下载下来反而几十兆
 *
 * 读不到（对方不允许跨域读取、网址不对）时说清楚，不存一个用不了的记录。
 */
export async function addUrl(url, name = '') {
  const u = String(url || '').trim();
  if (!/^https:\/\//i.test(u)) throw new Error('请填写 https 开头的网址');
  if (list().some(f => f.css === u || f.source === u)) throw new Error('这个网址已经添加过');
  let res;
  try { res = await fetch(u); } catch {
    throw new Error('无法读取该网址。字体文件需允许跨域读取；也可以下载后以文件添加');
  }
  if (!res.ok) throw new Error(`该网址返回 ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (/css/i.test(type) || /\/css2?\?/.test(u)) {
    const text = await res.text();
    const fam = (text.match(/font-family:\s*['"]?([^;'"]+)['"]?\s*;/) || [])[1];
    if (!fam || !/@font-face/.test(text)) throw new Error('该样式表里没有字体');
    const rec = { id: 'fnt-' + Date.now().toString(36), name: name || fam, css: u, family: fam.trim() };
    settings.set({ fonts: [...list(), rec] });
    return rec;
  }
  const blob = await res.blob();
  const file = new File([blob], decodeURIComponent(u.split('/').pop().split('?')[0] || 'font'),
    { type: blob.type || 'font/ttf' });
  const rec = await add(file);
  const named = { ...rec, source: u, ...(name ? { name } : {}) };
  settings.set({ fonts: list().map(f => (f.id === rec.id ? named : f)) });
  return named;
}

export async function remove(id) {
  const rec = get(id);
  if (!rec) return;
  const s = settings.get();
  const patch = { fonts: list().filter(f => f.id !== id) };
  // 正在用就先摘下来，否则界面会指向一个不存在的字体
  if (s.fontBody === id) patch.fontBody = '';
  if (s.fontSerif === id) patch.fontSerif = '';
  if (s.fontHand === id) patch.fontHand = '';
  settings.set(patch);
  loaded.delete(id);
  document.getElementById(`font-css-${id}`)?.remove();
  if (rec.fileId) await files.remove(rec.fileId);
  await apply();
}

export function rename(id, name) {
  settings.set({ fonts: list().map(f => f.id === id ? { ...f, name: name || f.name } : f) });
}

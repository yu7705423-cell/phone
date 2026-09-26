// objectURL 失效之后自己恢复。
//
// 图片、语音都以 Blob 存在 IndexedDB 里，画到屏幕上要先换成 blob: 地址（images.url / files.url），
// 换出来的地址缓存着反复用。**这个地址不是永远有效的**：
//
//   · iOS 把应用放到后台久了，浏览器会把 blob: 地址背后的那一份数据收走。回到前台，
//     缓存里的地址全成了死链：头像、图标、壁纸变成白的或者干脆没了。数据还好好地在库里，
//     重新读一遍、换一个新地址就回来了。
//   · 从前还在 pagehide 时主动把它们全部 revoke 掉。页面没被销毁、只是被藏起来（切走、
//     被后退缓存留着）再回来时，屏幕上的每一张图都指着已经作废的地址。整页真被销毁时浏览器
//     自己会收回这些地址，那一句只有坏处，已删掉。
//
// 所以回到前台时抽查一个缓存着的地址：读不出来，就把所有缓存清掉、换新的一批，并通知
// useImage / useThumb / useFile 重新取。一张 img 自己加载失败时也抽查一次。
// 抽查只读本机的一个 blob，不发网络请求。

const caches = [];          // { sample(): url|null, owns(url): bool, reset() }
const subs = new Set();
let epoch = 0;
let checking = null;
let lastReset = 0;
// 加载失败触发的换新，两次之间至少隔这么久。库里那份数据本身坏了的话，换了新地址照样加载失败，
// 不隔开就是「失败、换新、再失败」转个不停
const ERROR_GAP = 10000;

/** images、files 各登记一份自己的地址缓存 */
export function registerBlobCache(c) { caches.push(c); }

/** 第几代地址。每重建一次加一，hook 拿它当依赖 */
export const blobEpoch = () => epoch;

export function onBlobReset(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

async function readable(url) {
  try {
    const r = await fetch(url);
    await r.arrayBuffer();
    return true;
  } catch { return false; }
}

/** 全部作废、换新。hook 收到通知后各自从库里重读 */
export function resetBlobUrls() {
  caches.forEach(c => c.reset());
  lastReset = Date.now();
  epoch += 1;
  subs.forEach(fn => { try { fn(epoch); } catch { /* 一个订阅者出错不拦别的 */ } });
}

/**
 * 抽查一个地址（给了 url 就查它，否则从缓存里挑一个）。死了就整体重建，给回 true。
 * 同一时间只查一次
 */
export function checkBlobUrls(url) {
  if (checking) return checking;
  const u = url || caches.map(c => c.sample()).find(Boolean);
  if (!u) return Promise.resolve(false);
  checking = readable(u)
    .then(ok => { if (!ok) resetBlobUrls(); return !ok; })
    .finally(() => { checking = null; });
  return checking;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkBlobUrls();
  });
  window.addEventListener('pageshow', () => checkBlobUrls());
  // 某一张图、某一段声音自己加载失败：查的就是它那个地址。error 不冒泡，要在捕获阶段接
  document.addEventListener('error', e => {
    const t = e.target;
    const src = t && /^(IMG|AUDIO|VIDEO|SOURCE)$/.test(t.tagName || '') ? String(t.currentSrc || t.src || '') : '';
    // 只管缓存里还在用的地址。删掉的图作废了地址，那是故意的，不该因此整体重建
    if (src.startsWith('blob:') && caches.some(c => c.owns(src)) && Date.now() - lastReset > ERROR_GAP) checkBlobUrls(src);
  }, true);
}


// ---- 存进库之前，把切片抄成独立的 Blob（ARCHITECTURE 4.273）----
//
// 恢复备份、装角色包时拿到的图片是整个 ZIP 上切出来的一段（blob.slice）。WebKit 把这种切片
// 写进 IndexedDB 时，存的是**父文件开头的那一段**，长度对、内容不对：库里每张图都是同一个 ZIP 的开头，
// 记录在、字节在、解不出图。用户报的「只有图没了」第六次就是它。
// 所以凡是往库里存的 Blob，先真读一遍、抄成一份自己持有字节的 Blob，切片的出身就断掉了。
// 小的整个进内存；大的（视频）走 Response 流一遍，不整个进内存。
const SOLID_MAX = 64 * 1024 * 1024;
export async function solidBlob(blob) {
  if (!blob) return blob;
  const type = blob.type || '';
  if (blob.size <= SOLID_MAX) return new Blob([await blob.arrayBuffer()], { type });
  const copy = await new Response(blob).blob();
  return copy.type === type ? copy : new Blob([copy], { type });
}

/** 头几个字节是 ZIP：这不是图片，是上面那条路留下的坏数据 */
export async function looksZip(blob) {
  if (!blob || blob.size < 4) return false;
  const u8 = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04;
}

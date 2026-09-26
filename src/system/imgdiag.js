import { idb } from './db/idb.js';
import { images, setDiagLog } from './db/images.js';
import { characters, personas, chats, settings, layout } from './db/index.js';
import { blobEpoch, resetBlobUrls } from './db/blobs.js';
import { BUILD } from '../version.js';

// 图片诊断与删图日志。见 ARCHITECTURE 4.272
//
// 「图没了」已经报过六次，每次原因都不一样，而每次拿到手的只有一句「没了」。
// 这里做两件事，让下一次一眼看得出是哪条路：
//
//   日志   每一次真正删图（images.destroy）记一笔：哪张、谁删的、什么时候。存在 kv 里，只留最近两百条。
//          图被清理、被恢复备份清空、被换头像换掉，都在这里留痕。没有记录而图没了，就不是删的。
//   检查   记录还在不在、引用着的图在不在库里、库里的数据读不读得出来（记录在而数据是空的，
//          是浏览器把 blob 背后的文件收走了，这是第六条路，代码删不掉也救不回来，只能靠备份）。

const KEY = 'imglog';
const CAP = 200;

let queue = Promise.resolve();
/** 记一笔。不等它写完，也不让它的失败影响删图本身 */
export function log(kind, id, why = '') {
  const at = Date.now();
  // 调用栈只留头三行，够认出是哪一处
  const from = String(new Error().stack || '').split('\n').slice(2, 5).map(s => s.trim().replace(/^at\s+/, '')).join(' < ');
  queue = queue.then(async () => {
    const row = await idb.get('kv', KEY);
    const list = Array.isArray(row?.v) ? row.v : [];
    list.push({ at, kind, id, why: String(why || ''), from });
    while (list.length > CAP) list.shift();
    await idb.put('kv', { k: KEY, v: list });
  }).catch(() => {});
}

setDiagLog(log);

export async function entries() {
  const row = await idb.get('kv', KEY);
  return Array.isArray(row?.v) ? row.v.slice().reverse() : [];
}

/** 用户最先看见的那几处引用：图标、壁纸、头像、聊天背景。返回 [{ id, where }] */
export function refs() {
  const out = [];
  const add = (id, where) => { if (id) out.push({ id, where }); };
  const s = settings.get();
  Object.entries(s.appIcons || {}).forEach(([app, v]) => add(v?.imageId, `图标 ${app}`));
  const w = layout.get().wallpaper || {};
  add(w.home, '主屏壁纸'); add(w.lock, '锁屏壁纸');
  characters.all().forEach(c => { add(c.avatar, `头像 ${c.name || ''}`); add(c.cover, `封面 ${c.name || ''}`); });
  personas.all().forEach(p => { add(p.avatar, `我的头像 ${p.name || ''}`); add(p.cover, `我的封面 ${p.name || ''}`); });
  chats.all().forEach(c => add(c.look?.bg, '聊天背景'));
  return out;
}

/**
 * 检查。抽查引用着的那几张加上库里前几张：记录在不在、数据读不读得出来。
 *   records     库里的记录数（开机时读到的索引）
 *   inStore     现在直接数库里有几条（和 records 对不上说明开机后被删过或读失败）
 *   missing     引用着、但库里没有记录的：[{ id, where }]
 *   empty       记录在、数据是空的：[{ id, where }]
 *   unreadable  读的时候报错的：[{ id, where, err }]
 *   sampled     抽查了几张
 */
export async function check(limit = 40) {
  const list = refs();
  const seen = new Set();
  const targets = [];
  for (const r of list) if (!seen.has(r.id)) { seen.add(r.id); targets.push(r); }
  for (const id of images.ids().slice(0, 12)) if (!seen.has(id)) { seen.add(id); targets.push({ id, where: '库里' }); }
  const missing = [], empty = [], unreadable = [];
  let sampled = 0;
  let keys = null;
  try { keys = await idb.all('images'); } catch { keys = null; }
  const inStore = keys ? keys.length : -1;
  const present = keys ? new Set(keys.map(r => r.id)) : null;
  for (const t of targets.slice(0, limit)) {
    if (present && !present.has(t.id)) { missing.push(t); continue; }
    sampled += 1;
    try {
      const row = await idb.get('images', t.id);
      if (!row) { missing.push(t); continue; }
      const blob = row.blob;
      let size = blob ? blob.size : 0;
      // size 是元数据，文件真没了时它照样有值；真读一遍才知道
      if (size > 0) { try { size = (await blob.slice(0, 64).arrayBuffer()).byteLength; } catch (e) { unreadable.push({ ...t, err: String(e?.message || e) }); continue; } }
      if (!size) empty.push(t);
    } catch (e) { unreadable.push({ ...t, err: String(e?.message || e) }); }
  }
  // 直接从库里读几张、现做地址、真解码一次：这一步过了，数据、地址、解码整条链在这个页面里都是通的
  const shown = [];
  const decodeFail = [];
  for (const t of targets.filter(x => !missing.includes(x) && !empty.includes(x) && !unreadable.includes(x)).slice(0, 8)) {
    try {
      const row = await idb.get('images', t.id);
      if (!row?.blob) continue;
      let bmp;
      try { bmp = await createImageBitmap(row.blob); } catch (e) {
        // 解不出来：看头几个字节长什么样，才知道是哪一种坏法
        decodeFail.push({ ...t, err: String(e?.message || e), head: await headOf(row.blob), size: row.blob.size, type: row.blob.type || '' });
        continue;
      }
      bmp.close && bmp.close();
      shown.push({ id: t.id, where: t.where, url: URL.createObjectURL(row.blob) });
    } catch (e) { decodeFail.push({ ...t, err: String(e?.message || e) }); }
  }
  return { records: images.count(), inStore, referenced: list.length, missing, empty, unreadable, decodeFail, shown, sampled,
    urlsCached: images.cachedUrls(), epoch: blobEpoch(), versions: versions() };
}

/** 头 16 个字节：十六进制，加一句判断（PNG / WebP / JPEG / 全零 / 文本 / 其他） */
async function headOf(blob) {
  try {
    const u8 = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const hex = [...u8].map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...u8].map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    let kind = '其他';
    if (u8[0] === 0x89 && u8[1] === 0x50) kind = 'PNG';
    else if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') kind = 'WebP';
    else if (u8[0] === 0xff && u8[1] === 0xd8) kind = 'JPEG';
    else if (u8.every(b => b === 0)) kind = '全零';
    else if ([...u8].every(b => b >= 32 && b < 127)) kind = `文本「${ascii}」`;
    return `${kind} ${hex}`;
  } catch (e) { return `读不出头几个字节：${e?.message || e}`; }
}

/** 页面、脚本、样式表、Service Worker 各是哪一版。对不上就是新旧混着（第 20 条第五路） */
export function versions() {
  const page = document.querySelector('meta[name="build"]')?.content || '';
  const css = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .map(l => (String(l.getAttribute('href') || '').match(/[?&]v=([^&]+)/) || [])[1] || '').filter(Boolean);
  const cssSet = [...new Set(css)];
  const sw = (String(navigator.serviceWorker?.controller?.scriptURL || '').match(/[?&]b=([^&]+)/) || [])[1] || '';
  return { page, script: BUILD, css: cssSet.join(' / '), sw };
}

/** 把所有 blob 地址作废重取。显示那一层坏了时用它，数据不动 */
export const reload = () => resetBlobUrls();

/** 检查结果写成几行给人看 */
export function summary(r) {
  if (!r) return '';
  const lines = [`库里记录 ${r.records} 张${r.inStore >= 0 && r.inStore !== r.records ? `（直接数库里是 ${r.inStore} 条）` : ''}`,
    `图标、壁纸、头像、聊天背景引用着 ${r.referenced} 处，抽查 ${r.sampled} 张`];
  if (r.missing.length) lines.push(`记录不在库里 ${r.missing.length} 处：${r.missing.slice(0, 6).map(x => x.where).join('、')}`);
  if (r.empty.length) lines.push(`记录在、数据是空的 ${r.empty.length} 张：${r.empty.slice(0, 6).map(x => x.where).join('、')}`);
  if (r.unreadable.length) lines.push(`读不出来 ${r.unreadable.length} 张：${r.unreadable.slice(0, 3).map(x => `${x.where}（${x.err}）`).join('、')}`);
  if (r.decodeFail?.length) {
    lines.push(`数据在但解不出图 ${r.decodeFail.length} 张：`);
    r.decodeFail.slice(0, 4).forEach(x => lines.push(`  ${x.where}：${x.size ?? '?'} 字节，类型「${x.type || '空'}」，头几个字节 ${x.head || '?'}`));
    // 几张的头几个字节一模一样、而且是 ZIP 头：恢复备份时切片存坏了（4.273）
    const heads = r.decodeFail.map(x => String(x.head || ''));
    if (heads.length >= 2 && heads.every(h => h.startsWith('其他 50 4b 03 04')) && new Set(heads).size === 1) {
      lines.push('  这几张的内容是同一个 ZIP 的开头：是恢复备份时切片存坏了（ARCHITECTURE 4.273）。'
        + '更新到 2026-09-26.224 之后用同一份备份再恢复一次即可复原，备份文件本身是好的');
    }
  }
  if (!r.missing.length && !r.empty.length && !r.unreadable.length) lines.push('抽查的图全部读得出来。看不见图的话是显示那一层，点「重新读取图片」');
  lines.push(`地址缓存 ${r.urlsCached} 个，重建过 ${r.epoch} 次`);
  const v = r.versions || {};
  const same = v.page && v.page === v.script && (!v.css || v.css === v.page) && (!v.sw || v.sw === v.page);
  lines.push(`版本：页面 ${v.page || '?'}，脚本 ${v.script || '?'}，样式表 ${v.css || '?'}，Service Worker ${v.sw || '无'}${same ? '' : '。对不上：新旧混着'}`);
  return lines.join('\n');
}

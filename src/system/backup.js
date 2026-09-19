import { db } from './db/index.js';
import { DATA_VERSION, KV, runMigrations } from './db/schema.js';
import { idb } from './db/idb.js';
import { images } from './db/images.js';
import { files } from './db/files.js';
import { zip, unzip } from './zip.js';

// 备份。
//
// **图片、音频、视频也要在里面。** 原来那一份只导 JSON，头像、聊过的照片、
// 曲库里的音频、片库里的片子一个都不带 —— 而这些东西全躺在浏览器的
// IndexedDB 里，清一次站点数据就没了，导出的备份也救不回来。
//
// 所以打成 ZIP：JSON 一份，图片与文件各原样放一份。ZIP 是流着拼的，
// 不像 base64 那样要把五百兆变成六百兆的字符串再握在手里。
//
// **哪些数据域进备份，只在这一处列。** 漏一个的后果是安静的：导出看着成功，
// 恢复之后发现片库空了 —— 而那时候原始数据已经被覆盖掉了。

const COLLECTIONS = [
  'characters', 'lorebooks', 'memories', 'chats', 'messages', 'moments',
  'stickers', 'looks', 'personas', 'songs', 'playlists', 'videos',
  'spaceItems', 'events', 'days', 'recipes', 'meals',
  'books', 'entries',
];

const FORMAT = 'mini-phone-backup';
const VERSION = 2;                 // 备份文件的格式版本

// 另外还要记一个数据结构的版本号（_data）。开机时那句
// from < DATA_VERSION 看的是本机的记号，不是备份的，老备份灌回来不会补迁移。

const extOf = (type, fallback) => {
  const t = String(type || '').toLowerCase();
  const m = t.match(/^(?:image|audio|video|application)\/([a-z0-9.+-]+)/);
  if (!m) return fallback;
  return m[1].replace(/^x-/, '').replace(/\+.*$/, '').slice(0, 8);
};

/** 备份里会有什么、各有多大。界面上要先把账摆出来再让人点。 */
export function estimate() {
  const rows = COLLECTIONS.reduce((n, name) => n + (db[name]?.count?.() || 0), 0);
  return {
    rows,
    images: { count: images.count(), bytes: images.totalBytes() },
    files: { count: files.count(), bytes: files.totalBytes() },
  };
}

/**
 * 打一份备份出来。
 *
 * media 为 false 时只导 JSON —— 想发给别人看看角色卡、或者只要一份小的
 * 存着，都用这一档。密钥一律不进备份，那是这台设备的事。
 */
export async function build({ media = true, onProgress } = {}) {
  const data = {
    _format: FORMAT,
    _version: VERSION,
    _data: DATA_VERSION,
    _media: !!media,
    exportedAt: new Date().toISOString(),
    persona: db.persona.get(),
    settings: { ...db.settings.get(), services: undefined, apiKey: '' },
    layout: db.layout.get(),
  };
  COLLECTIONS.forEach(name => { data[name] = db[name]?.all?.() || []; });

  // 只要 JSON 的那一档就给一份真的 JSON。从前两档都打成 ZIP，而界面按
  // media 把文件名写成 .json，再导回去按扩展名解析直接炸在第一个字符。
  if (!media) {
    onProgress && onProgress(1);
    return new Blob([JSON.stringify(data)], { type: 'application/json' });
  }

  const entries = [{ name: 'backup.json', text: JSON.stringify(data) }];
  {
    for (const id of images.ids()) {
      const blob = await images.blob(id);
      if (blob) entries.push({ name: `images/${id}.${extOf(blob.type, 'bin')}`, blob });
    }
    for (const id of files.ids()) {
      const blob = await files.blob(id);
      if (blob) entries.push({ name: `files/${id}.${extOf(blob.type, 'bin')}`, blob });
    }
  }
  return zip(entries, { onProgress });
}

/**
 * 恢复。**先把包整个读出来确认没问题，再动现有数据** ——
 * 读到一半发现是坏包，而库已经清了一半，那是最糟的一种失败。
 */
// 按内容认格式，不按扩展名 —— 文件名是界面写的，已经写错过一次。
async function looksZip(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b;
}

export async function restore(file, { onProgress } = {}) {
  const isJson = !(await looksZip(file));

  let data = null;
  let media = new Map();
  if (isJson) {
    data = JSON.parse(await file.text());
  } else {
    const found = await unzip(file);
    const json = found.get('backup.json');
    if (!json) throw new Error('包里没有 backup.json，可能不是小手机的备份');
    data = JSON.parse(await json.text());
    media = found;
  }
  if (data._format !== FORMAT) throw new Error('不是小手机的备份文件');

  // 备份比本机新：里面的结构这个版本还不认识，灌进来只会坏得更难查。
  // 宁可在这儿停住，也不要恢复出一份半懂不懂的库。
  const from = Number(data._data) || 0;
  if (from > DATA_VERSION) {
    throw new Error(`这份备份来自更新的版本（数据版本 ${from}，本机 ${DATA_VERSION}）。`
      + '请先更新到最新版本再恢复。');
  }

  let done = 0;
  const total = COLLECTIONS.length + media.size;
  const step = () => { done += 1; if (onProgress) onProgress(done / total); };

  for (const name of COLLECTIONS) {
    if (!db[name]) { step(); continue; }
    await db[name].clear();
    (data[name] || []).forEach(row => db[name].put(row));
    step();
  }

  // 图片与文件按**原来的 id** 放回去：消息、角色卡里存的都是那个 id，
  // 换一个新 id 就全对不上了。
  for (const [name, blob] of media) {
    const m = name.match(/^(images|files)\/([^./]+)/);
    if (!m) { step(); continue; }
    const [, kind, id] = m;
    try {
      if (kind === 'images') await images.putRaw(id, blob);
      else await files.putRaw(id, blob);
    } catch (err) { console.warn('[backup] 放回失败', name, err.message || err); }
    step();
  }

  if (data.persona) db.persona.replace({ ...db.persona.get(), ...data.persona });
  if (data.settings) {
    const now = db.settings.get();
    // 接口配置留着这台设备自己的：备份里本来就没有，覆盖过去只会把它清空
    db.settings.replace({ ...now, ...data.settings, services: now.services, apiKey: now.apiKey });
  }
  if (data.layout) db.layout.replace(data.layout);

  // 老备份补迁移，放在最后：要改的就是上面刚灌进去的那些行。
  // 没有 _data 的从 0 跑一遍 —— 迁移都是幂等的，多跑不会坏，少跑会。
  let migrated = 0;
  if (from < DATA_VERSION) {
    const to = runMigrations(from, {
      characters: db.characters, lorebooks: db.lorebooks, memories: db.memories,
      chats: db.chats, messages: db.messages, moments: db.moments, stickers: db.stickers,
      looks: db.looks, personas: db.personas, songs: db.songs, playlists: db.playlists,
      videos: db.videos, spaceItems: db.spaceItems, events: db.events, days: db.days,
      recipes: db.recipes, meals: db.meals, books: db.books, entries: db.entries,
      settings: db.settings, persona: db.persona, layout: db.layout,
    });
    await idb.put('kv', { k: KV.schemaVersion, v: to });
    migrated = to - from;
  }

  return {
    rows: COLLECTIONS.reduce((n, name) => n + ((data[name] || []).length), 0),
    media: media.size,
    migrated,
  };
}

/** 浏览器还剩多少地方。拿不到就给 null，不猜。 */
export async function quota() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const { usage = 0, quota: total = 0 } = await navigator.storage.estimate();
    if (!total) return null;
    return { usage, quota: total, ratio: usage / total };
  } catch { return null; }
}

export function sizeText(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

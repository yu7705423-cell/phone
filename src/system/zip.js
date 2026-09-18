// 最小的 ZIP 读写。
//
// 为什么要它：备份里有图片、音频、视频。塞进 JSON 就得转 base64，
// 一份五百兆的片子会变成六百多兆的**字符串**，还得整个握在内存里 —— 必炸。
// ZIP 的好处是**每一份文件原样躺在里面**，写的时候可以一段一段拼 Blob，
// 从头到尾没有哪一刻需要把全部内容读进内存。
//
// 只做 store（method 0，不压缩）。图片、音频、视频本来就是压过的，
// 再压一遍省不下几个百分点，却要把每一个字节都过一遍 CPU。
// **读的时候认 deflate**：别的工具打的包也能导进来，解压交给浏览器自带的
// DecompressionStream，同样不自己实现。
//
// 不做 ZIP64。超过四个吉字节的包这里直接拒绝 —— 那个规格要另写一套头，
// 而到那个体量，浏览器这条路本来也该换成在电脑上做。

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const LIMIT = 0xffffffff;

// ---- CRC32。ZIP 每一条都要带，躲不掉 ----
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

// 分片算，一片四兆。整份读进来算 CRC 等于没躲开内存那个坎。
async function crc32(blob) {
  const STEP = 4 * 1024 * 1024;
  let c = 0xffffffff;
  for (let at = 0; at < blob.size; at += STEP) {
    const chunk = new Uint8Array(await blob.slice(at, Math.min(blob.size, at + STEP)).arrayBuffer());
    for (let i = 0; i < chunk.length; i++) c = TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

// 把几段字节接成一段
function bytes(list) {
  const out = new Uint8Array(list.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of list) { out.set(x, at); at += x.length; }
  return out;
}

const u16 = n => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
const u32 = n => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);

// DOS 时间。分辨率是两秒，这里不在乎，取个当前时刻就行。
function dosTime(d = new Date()) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

/**
 * 打包。entries 每一条是 { name, blob } 或 { name, text }。
 * 回来的是一个 Blob，可以直接下载。
 */
export async function zip(entries, { onProgress } = {}) {
  const parts = [];
  const central = [];
  const { time, date } = dosTime();
  let at = 0;
  let done = 0;

  for (const entry of entries) {
    const blob = entry.blob || new Blob([enc.encode(String(entry.text || ''))]);
    const name = enc.encode(entry.name);
    const crc = await crc32(blob);
    const size = blob.size;
    if (at + size > LIMIT) throw new Error('备份超过 4 GB，请去掉视频后重试');

    parts.push(bytes([
      u32(LOCAL), u16(20), u16(0x0800), u16(0),      // 0x0800：文件名按 UTF-8
      u16(time), u16(date), u32(crc), u32(size), u32(size),
      u16(name.length), u16(0), name,
    ]));
    parts.push(blob);

    central.push(bytes([
      u32(CENTRAL), u16(20), u16(20), u16(0x0800), u16(0),
      u16(time), u16(date), u32(crc), u32(size), u32(size),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(at), name,
    ]));
    at += 30 + name.length + size;
    done += 1;
    if (onProgress) onProgress(done / entries.length);
  }

  const dir = bytes(central);
  parts.push(dir);
  parts.push(bytes([
    u32(END), u16(0), u16(0), u16(central.length), u16(central.length),
    u32(dir.length), u32(at), u16(0),
  ]));
  return new Blob(parts, { type: 'application/zip' });
}

// ---- 读 ----

async function view(blob, from, len) {
  return new DataView(await blob.slice(from, Math.min(blob.size, from + len)).arrayBuffer());
}

/**
 * 解包。回来的是 Map：文件名 -> Blob。
 * 只认识 store 与 deflate；别的压缩方式跳过，不假装读得懂。
 */
export async function unzip(blob) {
  // 结尾那条记录在最后，前面可能还有注释，所以从尾巴往回找
  const tailLen = Math.min(blob.size, 66000);
  const tail = await view(blob, blob.size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === END) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('这不是一个 ZIP 文件');

  const count = tail.getUint16(eocd + 10, true);
  const dirSize = tail.getUint32(eocd + 12, true);
  const dirAt = tail.getUint32(eocd + 16, true);
  const dir = await view(blob, dirAt, dirSize);
  const dec = new TextDecoder();

  const out = new Map();
  let at = 0;
  for (let i = 0; i < count && at + 46 <= dir.byteLength; i++) {
    if (dir.getUint32(at, true) !== CENTRAL) break;
    const method = dir.getUint16(at + 10, true);
    const size = dir.getUint32(at + 20, true);
    const nameLen = dir.getUint16(at + 28, true);
    const extraLen = dir.getUint16(at + 30, true);
    const commentLen = dir.getUint16(at + 32, true);
    const localAt = dir.getUint32(at + 42, true);
    const name = dec.decode(new Uint8Array(dir.buffer, dir.byteOffset + at + 46, nameLen));
    at += 46 + nameLen + extraLen + commentLen;

    // 本地头里的两个长度可能和中央目录里的不一样，数据起点得按本地头算
    const local = await view(blob, localAt, 30);
    if (local.getUint32(0, true) !== LOCAL) continue;
    const dataAt = localAt + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    const raw = blob.slice(dataAt, dataAt + size);

    if (method === 0) out.set(name, raw);
    else if (method === 8 && typeof DecompressionStream === 'function') {
      out.set(name, await new Response(
        raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob());
    }
  }
  return out;
}

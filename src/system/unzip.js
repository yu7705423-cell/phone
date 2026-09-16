// 最小 zip 解包。docx 就是一个 zip，只需要取出其中几个条目。
// 压缩项用浏览器自带的 DecompressionStream('deflate-raw') 解，不引第三方库。

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

export async function readZip(blob) {
  const buf = await blob.arrayBuffer();
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const dec = new TextDecoder();

  // 从尾部找中央目录结束记录，注释最长 65535
  let eocd = -1;
  const from = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= from; i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('这不是一个有效的 zip 或 docx 文件');

  const count = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (u32(view, p) !== 0x02014b50) break;
    const nameLen = u16(view, p + 28);
    entries.push({
      name: dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      method: u16(view, p + 10),
      compressedSize: u32(view, p + 20),
      size: u32(view, p + 24),
      offset: u32(view, p + 42),
    });
    p += 46 + nameLen + u16(view, p + 30) + u16(view, p + 32);
  }

  async function raw(entry) {
    const h = entry.offset;
    if (u32(view, h) !== 0x04034b50) throw new Error(`条目损坏：${entry.name}`);
    const start = h + 30 + u16(view, h + 26) + u16(view, h + 28);
    const slice = bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return slice;
    if (entry.method !== 8) throw new Error(`暂不支持的压缩方式：${entry.method}`);
    const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const find = name => entries.find(e => e.name === name);

  return {
    entries,
    has: name => !!find(name),
    async text(name) {
      const e = find(name);
      return e ? dec.decode(await raw(e)) : null;
    },
    async blob(name, type) {
      const e = find(name);
      return e ? new Blob([await raw(e)], type ? { type } : undefined) : null;
    },
    list: prefix => entries.filter(e => e.name.startsWith(prefix) && e.size > 0),
  };
}

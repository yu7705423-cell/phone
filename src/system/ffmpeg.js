// ffmpeg.wasm。**只为一件事存在：把浏览器放不了的片子变成放得了的。**
//
// MKV 是最常见的那一类：里面多半是 H.264 加 AAC，浏览器全都认得，
// 偏偏不认 Matroska 这个壳（canPlayType('video/x-matroska') 给的是空串）。
// 所以要做的不是转码，是**换个壳**：-c copy 把音视频原样搬进 MP4，
// 顺手把字幕轨转成 mov_text —— 换完那份字幕 mp4subs.js 就读得到了。
//
// 三件事必须说在前面：
//
// **三十二兆，按需加载。** 核心文件放在 vendor/ffmpeg 下，平时一个字节都不读，
// 用户点了才去取。取一次之后浏览器自己会缓存。
//
// **wasm 切成了两块。** Cloudflare Pages（测试版，CLAUDE.md 第 19 条）单个文件上限 25 MB，
// 整个的 30.7 MB 放不上去，整站部署失败。这里把两块取回来拼好，经 wasmBinary 交给核心，
// 核心就不再自己去取那个整的。
//
// **路径从本文件算，不写成 `/vendor/...`。** 正式版挂在 github.io/phone/ 下面，
// 开头一个斜杠就指到 github.io/vendor/ 去了 —— 线上一直加载失败，而测试在根目录下跑，查不出来
//
// **单线程版。** 多线程快一倍，但要 COOP/COEP 两个响应头，而本项目是个静态
// 目录，加不了（第 9 条）。转封装不重编码，单线程完全够。
//
// **文件有上限。** MEMFS 在内存里，wasm32 的地址空间总共四个吉字节，
// 进去一份出来一份，实际能过的比这小得多。超过上限直接说不行，
// 不要跑到一半崩掉 —— 那时候用户已经等了十分钟。

const DIR = new URL('../../vendor/ffmpeg/', import.meta.url).href;
const CORE = DIR + 'ffmpeg-core.js';
const WASM_PARTS = ['ffmpeg-core.wasm.1', 'ffmpeg-core.wasm.2'];
const MAX_BYTES = 700 * 1024 * 1024;

let core = null;
let loading = null;

export const MAX_MB = Math.round(MAX_BYTES / 1024 / 1024);
export const tooBig = blob => !!blob && blob.size > MAX_BYTES;
export const isLoaded = () => !!core;

/** 把核心拉起来。重复调用只加载一次。 */
export function load() {
  if (core) return Promise.resolve(core);
  if (loading) return loading;
  loading = Promise.all([import(CORE), wasmBytes()])
    .then(([mod, wasmBinary]) => mod.default({
      wasmBinary,
      locateFile: name => DIR + name,
      print: () => {},
      printErr: () => {},
    }))
    .then(made => { core = made; loading = null; return core; })
    .catch(err => {
      loading = null;
      throw new Error('ffmpeg 核心加载失败：' + (err.message || err));
    });
  return loading;
}

async function wasmBytes() {
  const parts = await Promise.all(WASM_PARTS.map(async name => {
    const res = await fetch(DIR + name);
    if (!res.ok) throw new Error(`${name} ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// 每次跑之前把上一次的痕迹清掉：MEMFS 是常驻的，留着只会白占内存
function wipe(names) {
  names.forEach(n => { try { core.FS.unlink(n); } catch { /* 本来就没有 */ } });
}

async function writeIn(blob, name) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  core.FS.writeFile(name, buf);
  return name;
}

// 跑一条命令，顺便把日志收下来。ffmpeg 的流信息是打在 stderr 上的。
function run(args, { onProgress } = {}) {
  const log = [];
  core.setLogger(({ message }) => { if (message) log.push(message); });
  core.setProgress(onProgress ? ({ progress }) => onProgress(Math.min(1, progress || 0)) : () => {});
  const code = core.exec(...args);
  core.setLogger(() => {});
  core.setProgress(() => {});
  return { code, log };
}

const STREAM = /^\s*Stream #0:(\d+)(?:\[[^\]]*\])?(?:\((\w+)\))?:\s*(Video|Audio|Subtitle):\s*([^\s,(]+)/;

/**
 * 这个文件里有什么。只读头，不解码。
 * 返回 { video, audio, subs: [{ index, codec, lang }] }。
 */
export async function probe(blob) {
  await load();
  if (tooBig(blob)) throw new Error(`文件超过 ${MAX_MB} MB，浏览器里处理不了`);
  await writeIn(blob, 'probe.bin');
  // 只给输入不给输出，ffmpeg 会打完流信息就退出，返回码非零是正常的
  const { log } = run(['-i', 'probe.bin', '-hide_banner']);
  wipe(['probe.bin']);

  const out = { video: '', audio: '', subs: [] };
  for (const line of log) {
    const m = line.match(STREAM);
    if (!m) continue;
    const [, index, lang, kind, codec] = m;
    if (kind === 'Video' && !out.video) out.video = codec;
    else if (kind === 'Audio' && !out.audio) out.audio = codec;
    else if (kind === 'Subtitle') out.subs.push({ index: Number(index), codec, lang: lang || '' });
  }
  return out;
}

/**
 * 抽字幕。图形字幕（PGS、VOBSUB 那些）抽不成文字，直接说不行 ——
 * 它们是图片，转成文字要过一遍 OCR，那是另一件事。
 */
export async function extractSubs(blob, { stream = 0, onProgress } = {}) {
  await load();
  if (tooBig(blob)) throw new Error(`文件超过 ${MAX_MB} MB，浏览器里处理不了`);
  await writeIn(blob, 'subs.bin');
  const { code } = run(['-i', 'subs.bin', '-map', `0:s:${stream}`, '-c:s', 'srt', 'subs.srt'],
    { onProgress });
  let text = '';
  if (code === 0) {
    try { text = new TextDecoder().decode(core.FS.readFile('subs.srt')); } catch { text = ''; }
  }
  wipe(['subs.bin', 'subs.srt']);
  if (!text.trim()) throw new Error('这一轨抽不出文字字幕，可能是图形字幕');
  return text;
}

/**
 * 换壳成 MP4。**不重编码**：音视频原样搬过去，字幕转成 mov_text。
 * 换完之后浏览器放得了，字幕也能由 mp4subs 直接读出来。
 */
export async function toMp4(blob, { onProgress } = {}) {
  await load();
  if (tooBig(blob)) throw new Error(`文件超过 ${MAX_MB} MB，浏览器里处理不了`);
  await writeIn(blob, 'in.bin');

  const info = await probeFromMemory();
  const args = ['-i', 'in.bin', '-c:v', 'copy', '-c:a', 'copy'];
  // 有字幕就一并带过去；没有就明确关掉，免得 ffmpeg 为一条空轨报错
  if (info.subs.length) args.push('-c:s', 'mov_text');
  else args.push('-sn');
  args.push('-movflags', 'faststart', 'out.mp4');

  const { code, log } = run(args, { onProgress });
  let out = null;
  if (code === 0) {
    try { out = core.FS.readFile('out.mp4'); } catch { out = null; }
  }
  const tail = log.slice(-3).join(' ');
  wipe(['in.bin', 'out.mp4']);
  if (!out || !out.length) throw new Error('转换失败' + (tail ? `：${tail.slice(0, 120)}` : ''));
  return new Blob([out], { type: 'video/mp4' });
}

// toMp4 已经把文件写进去了，别再写一遍
async function probeFromMemory() {
  const { log } = run(['-i', 'in.bin', '-hide_banner']);
  const subs = [];
  for (const line of log) {
    const m = line.match(STREAM);
    if (m && m[3] === 'Subtitle') subs.push({ index: Number(m[1]), codec: m[4], lang: m[2] || '' });
  }
  return { subs };
}

/** 这个壳浏览器放得了吗。放得了就不必惊动 ffmpeg。 */
export function playable(type, name = '') {
  const t = String(type || '').toLowerCase();
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (/matroska|x-msvideo|quicktime|x-flv|mpeg$|x-ms-wmv/.test(t)) return false;
  if (['mkv', 'avi', 'flv', 'wmv', 'ts', 'mov', 'rmvb', 'm2ts'].includes(ext)) return false;
  return true;
}

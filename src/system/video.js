import { videos, files } from './db/index.js';
import * as subtitle from './subtitle.js';
import * as mp4subs from './mp4subs.js';

// 片库。和曲库（music.js）同一套：片子要么是一个地址，要么是一个存在本机的
// 文件，不做「只有片名」的虚拟片 —— 一起看要真的有东西在放，进度才有意义。
//
// 字幕单独存原文，用的时候现解析（subtitle.parse）。解析结果不入库：
// 那是一份可以随时从原文再算出来的东西，存两份只会不一致。
//
// offset 是字幕的整体偏移，秒，可正可负。下回来的字幕和手里这一版片源对不上
// 是常事（片头 logo、导演剪辑版），差的几乎总是一个固定的量。
// **偏移只在读出来的时候加**，不改原文 —— 改坏了还能调回来。
//
// outline 是**开看之前一次性**让模型读完整份字幕写出的分段提纲，
// 形如 [{ from, to, text }]，秒为单位。注入时只给已经看到的那几段，
// 后面的一律不给 —— 给了她就会剧透，而且是「第一次看却知道结局」那种穿帮。

export function allVideos() {
  return videos.all().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export const get = id => videos.get(id) || null;

export function addVideo({ title, url = '', fileId = null, subtitle: sub = '', seconds = 0 }) {
  const t = String(title || '').trim().slice(0, 80);
  if (!t) throw new Error('请填写片名');
  if (!url && !fileId) throw new Error('请填写播放地址或上传视频文件');
  return videos.create({
    title: t,
    url: String(url || '').trim(),
    fileId,
    subtitle: String(sub || ''),
    seconds: Math.max(0, Math.round(seconds) || 0),
    offset: 0,
    outline: [],
    outlineAt: 0,
  });
}

export function updateVideo(id, patch = {}) {
  const row = videos.get(id);
  if (!row) throw new Error('这部片已不在片库中');
  const next = {};

  if (patch.title !== undefined) {
    const t = String(patch.title).trim().slice(0, 80);
    if (!t) throw new Error('请填写片名');
    next.title = t;
  }
  if (patch.seconds !== undefined) next.seconds = Math.max(0, Math.round(patch.seconds) || 0);
  if (patch.offset !== undefined) next.offset = offsetOf({ offset: patch.offset });

  // 字幕换了，原来那份提纲就对不上了，一并作废
  if (patch.subtitle !== undefined) {
    next.subtitle = String(patch.subtitle || '');
    if (next.subtitle !== row.subtitle) { next.outline = []; next.outlineAt = 0; }
  }
  if (patch.outline !== undefined) {
    next.outline = Array.isArray(patch.outline) ? patch.outline : [];
    next.outlineAt = Date.now();
  }

  if (patch.url !== undefined || patch.fileId !== undefined) {
    const url = String(patch.url ?? row.url ?? '').trim();
    const fileId = patch.fileId !== undefined ? patch.fileId : row.fileId;
    if (!url && !fileId) throw new Error('请填写播放地址或上传视频文件');
    // 换了文件就把旧的删掉：文件躺在 IndexedDB 里，没人引用也不会自己消失
    if (patch.fileId !== undefined && row.fileId && row.fileId !== patch.fileId) {
      files.remove(row.fileId);
    }
    next.url = url;
    next.fileId = fileId;
  }
  return videos.update(id, next);
}

export function removeVideo(id) {
  const row = videos.get(id);
  if (!row) return false;
  if (row.fileId) files.remove(row.fileId);
  return videos.remove(id);
}

/** 这一部从哪儿放。和曲库一个规矩：有地址用地址，有文件用文件。 */
export async function srcOf(video) {
  if (!video) return '';
  if (video.url) return video.url;
  if (video.fileId) return (await files.url(video.fileId)) || '';
  return '';
}

// 偏移取整到十分之一秒。再细人耳也听不出来，而浮点尾数会让界面上的数字很难看。
// 上限一分钟：再多就不是「对不齐」而是拿错了字幕，该换一份。
export function offsetOf(video) {
  const n = Math.round((Number(video?.offset) || 0) * 10) / 10;
  if (!Number.isFinite(n)) return 0;
  return Math.max(-60, Math.min(60, n));
}

export function linesOf(video) {
  const lines = subtitle.parse(video?.subtitle || '');
  const off = offsetOf(video);
  if (!off) return lines;
  // 偏移之后跑到零之前的那几句，夹在 0 上而不是丢掉：它们仍然是这部片的台词
  return lines.map(l => ({
    ...l,
    at: Math.max(0, l.at + off),
    end: Math.max(0, l.end + off),
  }));
}

/**
 * 到这一刻为止的提纲。**严格截断**：只给已经播过去的那些段，
 * 正在演的这一段也给（它是「现在在发生什么」），后面的一段都不给。
 */
export function outlineSoFar(video, sec) {
  const all = Array.isArray(video?.outline) ? video.outline : [];
  return all.filter(seg => Number(seg.from) <= sec + 1);
}

/**
 * 从片子自己带的字幕轨里读一份出来，写成 SRT 交回去。
 *
 * **只对 MP4 有用**，而且只对本机上传的文件：填地址那种拿不到文件本身，
 * MKV 浏览器本来也播不了。读不到给 null —— 多数片子就是没有内封字幕，
 * 这不算出错，界面上不必报红。
 *
 * 写不写进片库由调用方决定：编辑表里那一份是草稿，要用户按了保存才算数。
 */
export async function subtitleFromFile(blob) {
  if (!blob) return null;
  const tracks = await mp4subs.extract(blob);
  if (!tracks.length) return null;
  // 有好几轨就取句数最多的那一轨：双语轨里通常它才是正片台词
  const best = tracks.slice().sort((a, b) => b.lines.length - a.lines.length)[0];
  return {
    srt: mp4subs.toSrt(best.lines),
    lines: best.lines.length,
    tracks: tracks.length,
    lang: best.lang,
    format: best.format,
  };
}

/** 片库里这一部有没有可用的字幕。界面上要据此提示。 */
export const hasSubtitle = video => linesOf(video).length > 0;

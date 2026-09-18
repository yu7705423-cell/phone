import { videos, files } from './db/index.js';
import * as subtitle from './subtitle.js';

// 片库。和曲库（music.js）同一套：片子要么是一个地址，要么是一个存在本机的
// 文件，不做「只有片名」的虚拟片 —— 一起看要真的有东西在放，进度才有意义。
//
// 字幕单独存原文，用的时候现解析（subtitle.parse）。解析结果不入库：
// 那是一份可以随时从原文再算出来的东西，存两份只会不一致。
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

export const linesOf = video => subtitle.parse(video?.subtitle || '');

/**
 * 到这一刻为止的提纲。**严格截断**：只给已经播过去的那些段，
 * 正在演的这一段也给（它是「现在在发生什么」），后面的一段都不给。
 */
export function outlineSoFar(video, sec) {
  const all = Array.isArray(video?.outline) ? video.outline : [];
  return all.filter(seg => Number(seg.from) <= sec + 1);
}

/** 片库里这一部有没有可用的字幕。界面上要据此提示。 */
export const hasSubtitle = video => linesOf(video).length > 0;

import * as video from '../../video.js';
import * as subtitle from '../../subtitle.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask } from '../engine.js';

// 分段提纲。
//
// **一部片只调一次。** 开看之前把整份字幕交出去，让它按时间切成若干段，
// 每段写这一段发生了什么。看的时候按进度注入已经看过的那几段。
//
// 为什么值得单独调这一次：只给「最近八句台词」，角色拿到的是几句孤立对白，
// 它不知道这几句挂在什么事情上。提纲把上下文补上，而代价是一次调用，
// 不是每隔几秒一次。
//
// **注入时必须按进度截断**（见 video.outlineSoFar）。整份提纲是全片的，
// 原样给出去，她就会说出还没演到的事。

export const outlineKey = videoId => `watch-outline:${videoId}`;

// 字幕原文太长会撑爆上下文，所以送去的是**压过的**：
// 每 15 秒只留一句，时间戳保留。剧情靠得住，token 省下来。
function digestOf(lines, everySec = 15) {
  const out = [];
  let last = -everySec;
  for (const l of lines) {
    if (l.at - last < everySec) continue;
    last = l.at;
    out.push(`[${subtitle.stamp(l.at)}] ${l.text}`);
  }
  return out.join('\n');
}

export function canOutline(row) {
  return !!row && video.linesOf(row).length >= 10;
}

/** 已经有一份，而且字幕没换过，就不再调。 */
export const hasOutline = row => Array.isArray(row?.outline) && row.outline.length > 0;

export async function generate(videoId, { signal } = {}) {
  const row = video.get(videoId);
  if (!row) throw new Error('这部片已不在片库中');
  const lines = video.linesOf(row);
  if (lines.length < 10) throw new Error('这部片还没有可用的字幕');

  const last = lines[lines.length - 1];
  const system = fillTemplate(template('task.watch-outline'), {
    title: row.title,
    length: subtitle.stamp(last.end || last.at),
    digest: digestOf(lines),
  });

  const r = await runJSONTask('watch.outline', {
    system, key: outlineKey(videoId), maxTokens: 3000, signal,
  });

  const rows = Array.isArray(r?.segments) ? r.segments : [];
  const segs = rows.map(x => ({
    from: subtitle.toSeconds(x.from),
    to: subtitle.toSeconds(x.to),
    text: String(x.text || '').trim(),
  })).filter(x => x.from !== null && x.text)
    .sort((a, b) => a.from - b.from);

  if (!segs.length) throw new Error('模型没有给出可用的分段');
  video.updateVideo(videoId, { outline: segs });
  return segs;
}

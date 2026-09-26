import { characters, lorebooks } from '../../db/index.js';
import { template, runJSONTask } from '../engine.js';
import { fillTemplate } from '../templates.js';
import * as work from '../../work.js';
import { volumesFor, ONE_SHOT_CHAPTERS } from '../../novel-tags.js';

// 长篇的几次请求（ARCHITECTURE 4.263）。全部由用户点按钮触发，按钮下写明次数：
//   简介   按人设、世界观、体裁、篇幅、灵感写一段（一次）
//   大纲   总纲 + 卷纲一次；章数少的连章纲一起要
//   卷纲   写到哪一卷补哪一卷（每卷一次）
//   走向   章末给几个候选（一次），见 4.264
//   重排   按已经写出来的走向重排后续大纲（一次）

const str = v => String(v || '').trim();
const clip = (s, n) => { const t = str(s); return t.length > n ? t.slice(0, n) + '…' : t; };

/** 这部作品的固定材料：人物、世界观、体裁、篇幅。几次请求共用 */
export function contextOf(w) {
  const c = work.charOf(w);
  const m = work.meOf(w);
  const cast = [`- ${c.name}: ${clip(c.persona, 1200) || '(no persona)'}`];
  if (w.solo || true) cast.push(`- ${m.name}: ${clip(m.persona, 600) || '(no persona)'}`);
  (w.castIds || []).slice(1).forEach(id => {
    const x = characters.get(id);
    if (x) cast.push(`- ${x.name}: ${clip(x.persona, 600) || '(no persona)'}`);
  });
  const world = (w.lorebookIds || []).map(id => lorebooks.get(id)).filter(Boolean)
    .flatMap(b => (b.entries || []).filter(e => e.enabled !== false && e.type !== 'card')
      .map(e => `${e.comment ? `${e.comment}: ` : ''}${clip(e.content, 800)}`));
  const len = w.length || {};
  return {
    cast: cast.join('\n'),
    world: world.length ? clip(world.join('\n'), 6000) : '(none)',
    genres: (w.genres || []).join(', ') || '(none)',
    chapters: Math.max(0, Math.round(Number(len.chapters) || 0)),
    perChapter: Math.max(0, Math.round(Number(len.perChapter) || 0)),
    title: str(w.title), synopsis: str(w.premise), secret: str(w.secret), inspiration: str(w.inspiration),
  };
}

/**
 * 按这部作品的世界改写身份（4.283）。who 是 'char' 或 'me'。
 * 回来的是 { name, persona }，先给用户看、改，再存进 charAs / meAs；这里不写库。
 * w 可以是向导里的草稿；线下那一场传一个作品形状的对象过来也行
 */
export async function identity(w, { who = 'char', key } = {}) {
  const ctx = contextOf(w);
  const c = work.charOf(w);
  const m = work.meOf(w);
  const self = who === 'me' ? m : c;
  const other = who === 'me' ? c : m;
  // 改写的是原来那份（角色卡 / 账号资料），不是已经改过一次的
  const base = who === 'me' ? str(m.base?.description) : str(c.base?.persona);
  const baseName = who === 'me' ? str(m.base?.name) || '我' : str(c.base?.name) || self.name;
  if (!base) throw new Error(who === 'me' ? '当前账号还没有写人设' : '这个角色还没有写人设');
  const r = await runJSONTask('work.identity', {
    system: fillTemplate(template('task.novel-identity'), {
      name: baseName, persona: clip(base, 4000),
      title: ctx.title || '(untitled)', premise: ctx.synopsis || '(none)', genres: ctx.genres,
      world: ctx.world, other: other.name,
    }),
    key: key || `novel-identity:${w.id}:${who}:${Date.now()}`, maxTokens: 2000,
  });
  return { name: str(r?.name) || baseName, persona: str(r?.persona) };
}

const lengthText = ctx => (ctx.chapters
  ? `${ctx.chapters} chapters${ctx.perChapter ? `, about ${ctx.perChapter} Chinese characters each` : ''}`
  : '(length not fixed)');

/** 简介。隐藏大纲的那一档另要一份作者私纲（含谜底），读者简介里不剧透 */
export async function synopsis(w, { hidden = false, key } = {}) {
  const ctx = contextOf(w);
  const r = await runJSONTask('work.synopsis', {
    system: fillTemplate(template('task.novel-synopsis'), {
      cast: ctx.cast, world: ctx.world, genres: ctx.genres, length: lengthText(ctx),
      inspiration: ctx.inspiration || '(none)', title: ctx.title || '(not chosen yet)',
      secret: hidden ? 'Also write "secret": the author-only plan with the twists and the answers, which the reader synopsis must not reveal.' : '',
    }),
    key: key || `novel-synopsis:${w.id}:${Date.now()}`, maxTokens: 1200,
  });
  return { title: str(r?.title), synopsis: str(r?.synopsis), secret: hidden ? str(r?.secret) : '' };
}

/** 总纲 + 卷纲。章数不多就连章纲一起 */
export async function outline(w, { key } = {}) {
  const ctx = contextOf(w);
  const chapters = ctx.chapters || 24;
  const volumes = volumesFor(chapters);
  const withChapters = chapters <= ONE_SHOT_CHAPTERS;
  const r = await runJSONTask('work.outline', {
    system: fillTemplate(template('task.novel-outline'), {
      cast: ctx.cast, world: ctx.world, genres: ctx.genres, length: lengthText(ctx),
      title: ctx.title || '(untitled)', synopsis: ctx.synopsis || '(none)',
      secret: ctx.secret ? `## Author-only plan (twists and answers)\n${ctx.secret}` : '',
      chapters, volumes,
      chapterRule: withChapters
        ? 'This book is short, so also list every chapter: each volume gets "chapters": [{"no": 1, "title": "...", "line": "one sentence: what happens and what changes"}], covering every chapter number from "from" to "to".'
        : 'Do not list individual chapters; they are planned volume by volume later.',
    }),
    key: key || `novel-outline:${w.id}:${Date.now()}`, maxTokens: withChapters ? 4000 : 2600,
  });
  const vols = Array.isArray(r?.volumes) ? r.volumes : [];
  if (!r?.master || !vols.length) throw new Error('模型没有给出可用的大纲');
  return { master: r.master, volumes: vols };
}

/** 某一卷的章纲 */
export async function volume(w, vol, { key } = {}) {
  const ctx = contextOf(w);
  const o = w.outline || {};
  const done = (o.volumes || []).filter(v => v.no < vol.no)
    .map(v => `Volume ${v.no}${v.title ? ` ${v.title}` : ''}: ${v.goal}`).join('\n');
  const written = work.chaptersOf(w.id).filter(c => c.no < vol.from).slice(-3)
    .map(c => `Chapter ${c.no}: ${clip(work.digestOf(c.id, 300), 300)}`).join('\n');
  const r = await runJSONTask('work.outline', {
    system: fillTemplate(template('task.novel-volume'), {
      cast: ctx.cast, genres: ctx.genres, title: ctx.title || '(untitled)', synopsis: ctx.synopsis || '(none)',
      secret: ctx.secret ? `## Author-only plan\n${ctx.secret}` : '',
      master: masterText(o.master), before: done || '(this is the first volume)', written: written || '(nothing written yet)',
      no: vol.no, vtitle: vol.title || '', goal: vol.goal, from: vol.from, to: vol.to, reveal: vol.reveal || '(nothing in particular)',
    }),
    key: key || `novel-volume:${w.id}:${vol.no}:${Date.now()}`, maxTokens: 3000,
  });
  const list = Array.isArray(r?.chapters) ? r.chapters : (Array.isArray(r) ? r : []);
  if (!list.length) throw new Error('模型没有给出这一卷的章纲');
  return list.map((c, i) => ({ no: Math.round(Number(c.no)) || (vol.from + i), title: str(c.title), line: str(c.line) }));
}

function masterText(master) {
  if (!master) return '(none)';
  return [`Main line: ${str(master.mainline)}`, master.subline ? `Hidden line: ${str(master.subline)}` : '',
    master.ending ? `Ending: ${str(master.ending)}` : '',
    (master.twists || []).length ? `Turns: ${master.twists.map(str).join('; ')}` : ''].filter(Boolean).join('\n');
}

/** 章末：给几个走向（4.264）。count 由用户定 */
export async function branches(w, chapter, { count = 3, key } = {}) {
  const ctx = contextOf(w);
  const o = w.outline || {};
  const next = (chapter?.no || 0) + 1;
  const vol = (o.volumes || []).find(v => next >= v.from && next <= v.to);
  const line = vol ? ((o.chapters || {})[vol.no] || []).find(c => c.no === next) : null;
  const recent = work.chaptersOf(w.id).filter(c => c.no <= (chapter?.no || 0)).slice(-2)
    .map(c => `Chapter ${c.no}${c.title ? ` ${c.title}` : ''}: ${clip(work.digestOf(c.id, 600), 600)}`).join('\n');
  const r = await runJSONTask('work.branch', {
    system: fillTemplate(template('task.novel-branches'), {
      cast: ctx.cast, genres: ctx.genres, title: ctx.title || '(untitled)', synopsis: ctx.synopsis || '(none)',
      secret: ctx.secret ? `## Author-only plan\n${ctx.secret}` : '',
      master: masterText(o.master), recent: recent || '(nothing written yet)',
      volume: vol ? `Volume ${vol.no}: ${vol.goal}` : '(no volume plan)',
      planned: line ? `${line.title ? `${line.title}: ` : ''}${line.line}` : '(no chapter plan)',
      next, count: Math.max(1, Math.round(Number(count) || 3)),
    }),
    key: key || `novel-branch:${w.id}:${next}:${Date.now()}`, maxTokens: 1600,
  });
  const list = Array.isArray(r?.options) ? r.options : (Array.isArray(r) ? r : []);
  if (!list.length) throw new Error('模型没有给出走向');
  return list.map(x => ({ title: str(x.title), line: str(x.line), follows: x.follows !== false })).filter(x => x.line);
}

/** 剧情偏离大纲之后：从下一章起重排后续的卷与章（一次） */
export async function replan(w, fromNo, { key } = {}) {
  const ctx = contextOf(w);
  const o = w.outline || {};
  const written = work.chaptersOf(w.id).filter(c => c.no < fromNo)
    .map(c => `Chapter ${c.no}${c.title ? ` ${c.title}` : ''}: ${clip(work.digestOf(c.id, 240), 240)}`).join('\n');
  const chapters = ctx.chapters || 24;
  const left = Math.max(1, chapters - fromNo + 1);
  const r = await runJSONTask('work.outline', {
    system: fillTemplate(template('task.novel-replan'), {
      cast: ctx.cast, genres: ctx.genres, title: ctx.title || '(untitled)', synopsis: ctx.synopsis || '(none)',
      secret: ctx.secret ? `## Author-only plan\n${ctx.secret}` : '',
      master: masterText(o.master), written: clip(written, 8000) || '(nothing written yet)',
      from: fromNo, to: chapters, volumes: volumesFor(left),
      chapterRule: left <= ONE_SHOT_CHAPTERS
        ? 'Also list every remaining chapter inside each volume as "chapters": [{"no", "title", "line"}].'
        : 'Do not list individual chapters; they are planned volume by volume later.',
    }),
    key: key || `novel-replan:${w.id}:${fromNo}:${Date.now()}`, maxTokens: 3600,
  });
  const vols = Array.isArray(r?.volumes) ? r.volumes : [];
  if (!vols.length) throw new Error('模型没有给出可用的大纲');
  return { master: r.master || o.master || null, volumes: vols };
}

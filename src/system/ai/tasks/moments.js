import { moments, characters, persona, images, songs, settings } from '../../db/index.js';
import * as player from '../../player.js';
import * as imageSvc from '../image.js';
import * as imgPrompt from '../imageprompt.js';
import { template, runJSONTask } from '../engine.js';
import { notify } from '../../notify.js';
import * as extras from '../../extras.js';
import * as remark from '../../remark.js';
import { fillTemplate } from '../templates.js';
import { listFor } from '../context/memory.js';
import { neteaseReady } from '../services.js';
import * as music from '../../music.js';
import { recallMoment } from '../../recall.js';

// 该角色能不能带歌：和聊天里「一起听」那一项同一个条件（capabilities.js 的 listen）
const canSong = char => char.canListen !== false && (music.allSongs().length > 0 || neteaseReady());

// 动态里带的那首歌，写成一句给评论、回复的人看。方括号标记与聊天里分享歌曲那一条同形，
// 后面同样附上歌词（「用量与上限」里那两项管着），取不到歌词就只有歌名
async function songLine(mo) {
  const song = mo.songId ? songs.get(mo.songId) : null;
  if (!song) return '';
  const st = settings.get();
  const on = st.songLyric !== false;
  const got = on ? await player.lyricOf(song).catch(() => null) : null;
  const tail = got ? music.lyricBlock(music.lyricFields(got), { on, lines: Number(st.songLyricLines) || 0 }) : '';
  return `\n[分享歌曲：${song.title}${song.artist ? ` - ${song.artist}` : ''}]${tail}`;
}

function charContext(char) {
  const mems = listFor(char.id)
    .filter(m => m.rank === 'S' || m.rank === 'A')
    .slice(0, 12)
    .map(m => `- ${m.content}`).join('\n');
  return [char.persona, mems ? `What you remember lately:\n${mems}` : ''].filter(Boolean).join('\n\n');
}

export async function createMoment(charId) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const withSong = canSong(char);
  const system = fillTemplate(template('task.moment-create'), {
    charName: char.name,
  }) + (withSong ? `\n\n${template('task.moment-song')}` : '')
    + `\n\n## Your own settings\n${charContext(char)}`;

  const r = await runJSONTask('moment.create', { system, key: `moment-create:${charId}`, maxTokens: 500 });
  if (!r?.text) throw new Error('模型没有返回动态内容');
  const mo = moments.create({
    authorId: charId, text: String(r.text).trim(), mood: r.mood || '',
    images: [], likes: [], comments: [],
  });

  // 带了歌：先挂上「正在找」，再去曲库、网易云找。找不到就摘掉 ——
  // 动态上挂一张放不出来的卡片没有意义，正文照样成立
  const q = withSong && typeof r.song === 'string' ? r.song.trim() : '';
  if (q && q !== 'null') {
    moments.update(mo.id, { songQuery: q, songState: 'pending' });
    music.resolveSong(q)
      .then(song => moments.update(mo.id, song ? { songId: song.id, songState: 'done' } : { songQuery: '', songState: '' }))
      .catch(() => moments.update(mo.id, { songQuery: '', songState: '' }));
  }

  // 模型给了画面描述且配了生图接口，就顺带配一张图
  const prompt = (r.imagePrompt || '').trim();
  if (prompt && prompt !== 'null' && imageSvc.isImageReady()) {
    moments.update(mo.id, { imagePending: true, imagePrompt: prompt });
    // 走 compose：全局生图提示词那一栏写的是「每次生成都会拼在画面描述后面」，
    // 从前这一条不走它，朋友圈的图就不按那句话画（生图世界书同理）
    imageSvc.generate({ prompt: imgPrompt.compose({ prompt, char }), key: `moment-img:${mo.id}` })
      .then(async blob => {
        const id = await images.put(new File([blob], 'moment.png', { type: blob.type || 'image/png' }), 1024);
        moments.update(mo.id, { images: [id], imagePending: false });
      })
      .catch(err => moments.update(mo.id, { imagePending: false, imageError: String(err.message || err) }));
  }
  // 特别关心的角色发了动态就弹一下。不是特别关心的不弹 ——
  // 朋友圈本来就是「你想起来才去看」的东西，每条都弹就成了骚扰。
  if (extras.isStarred(char)) {
    notify({
      title: extras.starTitle(char, remark.nameOf(char) || '新动态'),
      body: String(mo.text || '').slice(0, 40),
      icon: 'moments', appId: 'chat', avatar: char.avatar,
      payload: { route: '/moments' },
    });
  }
  return mo;
}

export async function commentMoment(momentId, charId) {
  const mo = moments.get(momentId);
  const char = characters.get(charId);
  if (!mo || !char) throw new Error('数据不存在');
  const author = mo.authorId === 'me' ? persona.get().name : characters.get(mo.authorId)?.name;

  const system = fillTemplate(template('task.moment-comment'), {
    charName: char.name, authorName: author || '对方', momentText: mo.text + await songLine(mo),
  }) + `\n\n## Your own settings\n${charContext(char)}`;

  const r = await runJSONTask('moment.comment', { system, key: `moment-comment:${momentId}:${charId}`, maxTokens: 300 });
  if (!r?.text) throw new Error('模型没有返回评论');
  const c = addComment(momentId, charId, String(r.text).trim());
  // 看过、评论了，也顺手点个赞（不另调接口）
  if (!(moments.get(momentId)?.likes || []).includes(charId)) toggleLike(momentId, charId);
  return c;
}

/**
 * 用户自己那条动态，哪些角色看得见。
 *   visibleTo 'all'（或没有这个字段的老动态）  所有角色
 *   visibleTo [id, …]                         只有这几位
 *   visibleTo []                              仅自己
 * 角色自己发的动态不走这里。
 */
export function canSee(mo, charId) {
  if (!mo || mo.authorId !== 'me') return true;
  const v = mo.visibleTo;
  if (v === undefined || v === null || v === 'all') return true;
  return Array.isArray(v) && v.includes(charId);
}
export const viewersOf = mo => characters.all().filter(c => canSee(mo, c.id)).map(c => c.id);

/**
 * 发布之后：看得见的角色逐个来看，各写一条评论并点赞。一位一次接口调用，
 * 发布时的可见范围就是用户点头的范围（发布页上写明了共几次）。
 * 一位失败不拦着后面的；给回失败的那几位。
 */
export async function reactToMine(momentId) {
  const mo = moments.get(momentId);
  if (!mo || mo.authorId !== 'me') return { done: 0, failed: [] };
  let done = 0;
  const failed = [];
  for (const id of viewersOf(mo)) {
    if (!moments.get(momentId)) break;            // 发完就删了
    try { await commentMoment(momentId, id); done += 1; }
    catch (err) { failed.push({ id, error: String(err.message || err) }); }
  }
  return { done, failed };
}

export async function replyComment(momentId, charId, commentText) {
  const mo = moments.get(momentId);
  const char = characters.get(charId);
  if (!mo || !char) throw new Error('数据不存在');

  // 撤回是这一次回复顺带交回来的一个字段，不另调接口（见 system/recall.js）
  const canTake = char.canRecall !== false && mo.authorId === charId && !mo.recalled;
  const system = fillTemplate(template('task.moment-reply'), {
    charName: char.name, userName: persona.get().name,
    momentText: mo.text + await songLine(mo), commentText,
  }) + (canTake ? `\n\n${template('task.moment-recall')}` : '')
    + `\n\n## Your own settings\n${charContext(char)}`;

  const r = await runJSONTask('moment.reply', { system, key: `moment-reply:${momentId}`, maxTokens: 300 });
  if (!r?.text) throw new Error('模型没有返回回复');
  const c = addComment(momentId, charId, String(r.text).trim());
  if (canTake && r.recall === true) recallMoment(momentId);
  return c;
}

export function addComment(momentId, authorId, text, replyTo = null) {
  const mo = moments.get(momentId);
  if (!mo) return null;
  const comment = {
    id: `cm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    authorId, text, replyTo, createdAt: Date.now(),
  };
  moments.update(momentId, { comments: [...(mo.comments || []), comment] });
  return comment;
}

export function toggleLike(momentId, who = 'me') {
  const mo = moments.get(momentId);
  if (!mo) return;
  const likes = mo.likes || [];
  moments.update(momentId, {
    likes: likes.includes(who) ? likes.filter(x => x !== who) : [...likes, who],
  });
}

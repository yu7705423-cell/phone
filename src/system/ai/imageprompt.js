import { settings, characters, images } from '../db/index.js';
import { template, fillTemplate } from './templates.js';
import { runTextTask } from './engine.js';
import { visionConfig, visionReady, visionMode } from './services.js';
import { describe as visionDescribe } from './vision.js';
import { toDataUrl } from '../audio.js';
import { activateImage, textOf } from './context/lorebook.js';
import { negativeBlock } from './image.js';

// 生图提示词的拼装，外加锁脸。
//
// 拼出来的顺序是：**画面描述、这个角色的固定提示词、全局提示词**。
// 画面在最前面，因为那是这一张要画什么；后面两段是「一直都这么画」。
//
// 锁脸解决的是同一个角色每次生成长得都不一样。两条路：
//   A 读成外貌描述。把脸图交给能看图的模型读成一段话，缓存在角色卡上，
//     以后每次生成都把这段话拼进提示词。**任何生图接口都能用**，
//     而且只花一次识图调用。
//   B 直传参考图。把脸图本身塞进生图请求（OpenAI 兼容的 images/edits）。
//     像不像取决于接口支不支持，支持的话比 A 准得多。
// 两条可以同时开：先试 B，接口不认就退回 A。

// 什么算「涉及脸部」。把角色自己的名字也算进去 ——
// 模型写「阿岚站在窗边」时画的就是她本人。
const SELFISH = /自拍|自照|正脸|我的脸|我的样子|镜子|镜头|selfie|头像|证件照/i;

export function faceApplies(char, prompt) {
  const mode = char?.faceLock || 'self';
  if (mode === 'off' || !char?.faceImage) return false;
  if (mode === 'always') return true;
  const p = String(prompt || '');
  return SELFISH.test(p) || (!!char.name && p.includes(char.name));
}

/**
 * 把脸读成一段外貌描述，缓存在角色卡上。
 * 只在第一次需要时跑一次，之后直接用缓存；换了脸图会把缓存清掉（见角色卡）。
 */
export async function ensureFaceDesc(char) {
  if (!char?.faceImage) return '';
  const cached = String(char.faceDesc || '').trim();
  if (cached) return cached;
  // 识图那一档关着或者没配全，就没法读 —— 不报错，安静地退回没有描述
  if (visionMode() === 'off' || (visionMode() === 'api' && !visionReady())) return '';

  const blob = await images.blob(char.faceImage);
  if (!blob) return '';
  const dataUrl = await toDataUrl(blob);
  let text = '';
  if (visionMode() === 'api') {
    text = await visionDescribe({ dataUrl, key: `face:${char.id}` });
  } else {
    // 交给聊天模型那一档：它自己能看图，用同一条路
    text = await runTextTask('chat.face-describe', {
      system: fillTemplate(template('task.face-describe'), { sample: langSample(char) }),
      user: 'Describe this person as instructed.',
      image: { dataUrl, mediaType: blob.type || 'image/png' },
      key: `face:${char.id}`, maxTokens: 400,
    });
  }
  const out = String(text || '').trim();
  if (out) characters.update(char.id, { faceDesc: out });
  return out;
}

// 一小段角色卡原文，告诉模型「这个角色是什么语言」。图上没有字，
// 描述图片本身没有语言线索，而写死中文是替用户拿主意（CLAUDE.md 第 16 条）。
const langSample = char =>
  String(char?.persona || char?.scenario || char?.name || '').slice(0, 200);

/**
 * 生图世界书命中的那几条。拿**画面描述**去扫，不是拿对话。
 *
 * 标了「只用于生图」的书才进这里，普通世界书一条都不进 —— 反过来也一样
 * （见 context/lorebook.js）。角色卡上关联的书与「全局生效」的书都算，
 * 和聊天那边同一套归属规则。
 */
export const loreFor = (char, prompt) => textOf(activateImage(char, prompt));

/**
 * 拼最终提示词。
 *
 * 顺序是：**画面描述、这一张命中的生图世界书、这个角色的固定提示词、全局提示词**。
 * 越靠前越是「这一张要画什么」，越靠后越是「一直都这么画」。生图世界书排在
 * 角色与全局之前，因为它是按这一张的内容命中的，比那两个更贴着这一张。
 */
/**
 * 一段提示词里如果写了「Negative」那一行，就在那儿切开。
 *
 * **不是提醒，是真的摘出来。** `images/generations` 没有负面提示词这个字段，
 * 于是照着别处习惯把 Positive 与 Negative 两大段一起贴进来的人，
 * 那几十行会被原样当成**要画的东西**发出去：写着
 * `selfie, portrait, Ghibli style`，模型就照着画自拍、棚拍、吉卜力。
 *
 * 人已经写了「Negative」这三个字，意思没有任何含糊 —— 照它办不是替谁做决定，
 * 是读懂他写的东西。摘出来之后走负面那一栏（发不发由那一栏自己的开关定）。
 */
// 单独成行的「Positive」也是个抬头，不是要画的东西。和 Negative 成对出现
const POS_HEAD = /(^|\n)\s*(positive(\s*prompt)?|正面(提示词)?)\s*[:：]?\s*(\n|$)/i;

export function cut(text) {
  const t = String(text || '').trim();
  const hit = negativeBlock(t);
  // 切到那一行本身的前面，不然「Negative」这三个字会留在正向的末尾
  const pos = (hit ? t.slice(0, hit.start) : t).replace(POS_HEAD, '$1').trim();
  return { pos, neg: hit ? t.slice(hit.at).trim() : '' };
}

export function parts({ prompt, char, face = '' }) {
  const text = String(prompt || '').trim();
  const raw = [{ from: '画面描述', text }];
  if (face) raw.push({ from: '角色外貌（锁脸读出来的）', text: `The appearance of the person in frame: ${face}` });
  const lore = loreFor(char, text);
  if (lore) raw.push({ from: '生图世界书', text: lore });
  const own = String(char?.imagePrompt || '').trim();
  if (own) raw.push({ from: '这个角色的固定提示词', text: own });
  const global = String(settings.get().imagePrompt || '').trim();
  if (global) raw.push({ from: '全局生图提示词', text: global });

  const out = [];
  for (const seg of raw) {
    const { pos, neg } = cut(seg.text);
    if (pos) out.push({ ...seg, text: pos, kind: 'pos' });
    if (neg) out.push({ from: `${seg.from} 里的负面部分（已从正向里摘出来）`, text: neg, kind: 'neg' });
  }
  return out;
}

export const compose = args => parts(args).filter(x => x.kind === 'pos').map(x => x.text).join('\n');

/** 从各段里摘出来的负面提示词。和接口自己那一栏合并后交给 generate。 */
export const negativeOf = args => parts(args).filter(x => x.kind === 'neg').map(x => x.text).join('\n');

/**
 * 拼出来的每一段各是从哪儿来的。
 *
 * **最终发出去的那一串常常不止「画面描述」。** 后面还接着锁脸读出来的外貌、
 * 生图世界书、角色自己的固定提示词、全局提示词 —— 画出来不对劲时，
 * 十有八九是后面这几段里写了什么，而它们平时一个字都不露。
 * 抓包里逐段标出来，一眼就看得出是哪一段带进去的。
 */
export function explain(args) {
  return parts(args).map(x => `【${x.from}】\n${x.text}`).join('\n\n');
}

// 这一次要不要把脸图本身传过去
export function wantsRef(char, preset) {
  return !!(char?.faceImage && preset?.ref === 'edits');
}

export async function faceBlob(char) {
  if (!char?.faceImage) return null;
  return images.blob(char.faceImage);
}

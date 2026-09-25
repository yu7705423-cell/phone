import { settings, characters, images } from '../db/index.js';
import { template, fillTemplate } from './templates.js';
import { runTextTask } from './engine.js';
import { visionConfig, visionReady, visionMode } from './services.js';
import { describe as visionDescribe } from './vision.js';
import { toDataUrl } from '../audio.js';
import { activateImage, textOf } from './context/lorebook.js';
import { negativeBlock } from './image.js';
import * as closet from '../closet.js';
import * as accounts from '../accounts.js';

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
  // 这张脸图已经读失败过：不再自动读。不记的话，之后每画一张锁脸的图都再读一次、
  // 再扣一次识图的钱。换脸图、或在角色卡上点「重新读取」会清掉这个记号
  if (char.faceDescFailed && char.faceDescFailed === char.faceImage) return '';
  // 识图那一档关着或者没配全，就没法读 —— 不报错，安静地退回没有描述
  if (visionMode() === 'off' || (visionMode() === 'api' && !visionReady())) return '';

  const blob = await images.blob(char.faceImage);
  if (!blob) return '';
  const dataUrl = await toDataUrl(blob);
  const failed = () => characters.update(char.id, { faceDescFailed: char.faceImage });
  let text = '';
  try {
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
  } catch (err) {
    // 取消不算读失败：人不要这张图了，不是脸图读不出来
    if (!(err?.name === 'AbortError' || /已取消/.test(err?.message || ''))) failed();
    throw err;
  }
  const out = String(text || '').trim();
  if (out) characters.update(char.id, { faceDesc: out, faceDescFailed: '' });
  else failed();
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

/**
 * 画面描述里点了谁的名字，就把谁的外貌一并发过去。
 *
 * **这是这一整件事的根。** 生图与视频模型收不到这段对话：角色写
 * `[图片：乃木绿实在窗边]`，「乃木绿实」对它来说只是四个字，画出来当然不是她。
 * 从前对此只有两道防线，而两道都不顶用：
 *
 *   一道是在提示词里叫角色**自己写清楚长什么样** —— 它记不住，照样写名字；
 *   一道是 `promptwrite` 另调一次接口改写 —— 那个**默认关着**，
 *     而且要多花一次钱。
 *
 * 所以加一道**本地的、免费的、默认就开着的**：名字在描述里出现过，
 * 就把那张卡上写的外貌接在后面。不改描述本身 —— 用户写的那句话原样保留，
 * 只是后面多了一段「这个名字长这样」。
 *
 * **不止当前这个角色。** 相册里、故事里常出现别人：另一张角色卡、
 * 一只做成卡片的猫。任何一张卡的名字出现在描述里，都把它的外貌带上 ——
 * 不然「乃木喵」和「乃木绿实」是同一种问题，只修一半没有意义。
 *
 * 名字短的（一个字）不做匹配：那种名字在任何一句话里都撞得上。
 */
export function appearanceOf(text, char) {
  const t = String(text || '');
  if (!t) return [];
  const out = [];
  const seen = new Set();
  const take = c => {
    if (!c || seen.has(c.id)) return;
    const name = String(c.name || '').trim();
    const look = String(c.appearance || '').trim() || String(c.faceDesc || '').trim();
    if (!name || name.length < 2 || !look || !t.includes(name)) return;
    seen.add(c.id);
    out.push({ from: `「${name}」的外貌`, text: `${name}: ${look}` });
  };
  // 当前这个角色先来：它最常出现，排在前面读起来也顺
  take(char);
  characters.all().forEach(take);
  return out;
}

/**
 * 画面里有谁，就把谁今天穿的（衣帽间里勾了的那几件）接在后面。
 *
 * **只传文字，衣物的照片永远不当参考图发给生图接口。** 存衣服的照片常常是模特穿着的，
 * 参考图一旦带上它，画出来的就是模特的脸。描述也先过一遍 garmentOnly，提到人的句子去掉
 * （ARCHITECTURE 4.215）。
 * 衣帽间设置里「生图时参考今天穿的」打开才有，默认关着 —— 不多调接口，
 * 但会改变画出来的衣服，开不开是用户的事。
 *
 * 认人和外貌那一段同一个办法：点了名就算。另外写着「合照」「我们」这类词的，
 * 两个人都带上；角色的自拍带角色自己的
 */
const PAIR = /合照|合影|我们|两个人|俩人|一起|together|couple|both of us/i;
function wearOf(text, char) {
  if (!settings.get().closetInImage) return [];
  const t = String(text || '');
  const pair = PAIR.test(t);
  const line = (name, rows) => (rows.length
    ? `${name} is wearing: ${rows.map(r => [r.name, closet.garmentOnly(r.desc)]
      .filter(Boolean).join(', ')).join('; ')}`
    : '');
  const out = [];
  const cn = String(char?.name || '').trim();
  if (char && (pair || SELFISH.test(t) || (cn.length >= 2 && t.includes(cn)))) {
    const l = line(cn || 'The character', closet.wornToday(char.id).filter(r => !closet.isCarry(r)));
    if (l) out.push({ from: `「${cn}」今天穿的（衣帽间）`, text: l });
  }
  const mn = String(accounts.current()?.name || '').trim();
  if (pair || (mn.length >= 2 && t.includes(mn))) {
    const l = line(mn || 'The other person', closet.wornToday(closet.ME).filter(r => !closet.isCarry(r)));
    if (l) out.push({ from: '我今天穿的（衣帽间）', text: l });
  }
  // 衣服的照片多半是模特穿着的。这一句钉死：这几行只管衣服，脸和身形按上面的外貌来
  if (out.length) {
    out.push({ from: '衣帽间：只取衣物', text: 'The clothing lines above describe garments only.'
      + ' Faces, hair and bodies follow the appearance of each named person, never a model the garments were photographed on.' });
  }
  return out;
}

/**
 * 内置的生图预设。**默认全关**，开哪个由用户决定。
 *
 * 一个预设分两段，因为「画得好」这件事落在两个不同的地方：
 *
 *   `ask`   描述里要写到什么。加在**写描述的那一方**身上 —— 角色写
 *           `[图片：…]` 的时候、以及改写那一步。光有画风没有内容，
 *           画出来的还是一句话那么空。
 *   `tail`  看起来像什么。拼在**最终提示词**末尾，和全局提示词并排。
 *
 * 正文存在模板里（第 11 条），可以改；改语气不该需要改代码。
 *
 * 这和第 16 条不冲突：那一条管的是**内置提示词不替角色作判断**，
 * 而这里是用户自己打开的一档画风，默认关着，开不开是他的事。
 */
export const STYLES = [
  {
    id: 'daily',
    label: '日常拍照分享',
    desc: '要求描述写明场景、环境、构图、光线；画面里有人时写明穿着，'
      + '并与场景相称。成片看起来像随手拍下来分享的照片，不像棚拍或海报。',
    ask: 'style.daily.ask',
    tail: 'style.daily.tail',
  },
];

/** 开着的那几个。存的是 id 清单，没有就是一个都没开。 */
export function stylesOn() {
  const on = settings.get().imageStyles;
  const set = new Set(Array.isArray(on) ? on : []);
  return STYLES.filter(x => set.has(x.id));
}

/** 加在写描述那一方身上的那几句。角色与改写那一步共用。 */
export const styleAsk = () =>
  stylesOn().map(x => template(x.ask)).filter(Boolean).join('\n');

export function parts({ prompt, char, face = '' }) {
  const text = String(prompt || '').trim();
  const raw = [{ from: '画面描述', text }];
  // 描述里点了名的那几位，各自的外貌
  raw.push(...appearanceOf(text, char));
  if (face) raw.push({ from: '角色外貌（锁脸读出来的）', text: `The appearance of the person in frame: ${face}` });
  raw.push(...wearOf(text, char));
  const lore = loreFor(char, text);
  if (lore) raw.push({ from: '生图世界书', text: lore });
  const own = String(char?.imagePrompt || '').trim();
  if (own) raw.push({ from: '这个角色的固定提示词', text: own });
  // 画风预设排在全局提示词前面：全局那一段是用户自己写的，让它有最后一句
  stylesOn().forEach(x => {
    const t = String(template(x.tail) || '').trim();
    if (t) raw.push({ from: `生图预设「${x.label}」`, text: t });
  });
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

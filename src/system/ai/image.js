import { baseOf } from './url.js';
import { activeImage } from './services.js';
import { enqueue } from './queue.js';
import { unzip } from '../zip.js';
import { nfetch, routeOf, canNative, reachable } from '../net.js';
import { images } from '../db/index.js';
import * as trace from './trace.js';

/**
 * 生图。两套接口，一套一个 kind：
 *
 *   openai   POST {base}/images/generations，回 b64 或者一个 URL。
 *            OpenAI 本身与绝大多数中转站都是这一套，是默认。
 *   nai      NovelAI。POST {base}/ai/generate-image，body 是
 *            {input, model, action, parameters}，**回来的是一个 zip**，
 *            png 在里头。这一条是照它自己的接口写的，不是猜的。
 *
 * NovelAI 那套用的是「持久 token」（网站的用户设置里生成），不是订阅密码。
 */

export const KINDS = [
  { id: 'openai', label: 'OpenAI 兼容', base: 'https://api.openai.com/v1',
    note: 'OpenAI 本身与绝大多数中转站。模型填 gpt-image-1、dall-e-3 一类。' },
  { id: 'nai', label: 'NovelAI', base: 'https://image.novelai.net',
    note: '密钥填网站用户设置里生成的持久 token。模型填 nai-diffusion-3 一类。' },
];
export const kindOf = id => KINDS.find(k => k.id === id) || KINDS[0];

/**
 * 回来的是 base64 还是一个链接。
 *
 * **默认那一档整个字段都不发。** 这个参数惹的麻烦比它解决的多：
 * `gpt-image-1` 根本不认它，发了直接 400（而且报错里看不出是哪个字段）；
 * 中转站转到别家模型时同样常常 400。不发的话，服务端用它自己的默认值。
 *
 * 只有一种情形需要手动指定：接口默认给链接，而那个链接跨域取不回来 ——
 * 那时候选 base64。取不回来时的报错里写了这句话。
 */
export const FORMATS = [
  { id: '', label: '自动', desc: '不指定，由接口自己决定。gpt-image-1 一类只认这一档' },
  { id: 'b64_json', label: 'base64', desc: '图片直接随响应回来。接口给的链接取不回来时选它' },
  { id: 'url', label: '链接', desc: '接口返回图片链接，由本机再取一次。跨域可能取不到' },
];

/**
 * 常用尺寸。**这是备选，不是全部** —— 想填别的自己填（CLAUDE.md 第 13 条）。
 *
 * 两家的常用值不一样，所以分开列：
 *
 *   openai  `gpt-image-1` 只认这三档（以及 auto）。`dall-e-3` 是
 *           1024x1024 / 1024x1792 / 1792x1024，所以那两个也列上。
 *   nai     NovelAI 自己那套。边长要是 64 的倍数，总像素也有上限，
 *           超了它会自己拒 —— 这一条写在界面上，不在代码里拦。
 */
export const SIZES = {
  openai: [
    { value: '1024x1024', label: '1:1' },
    { value: '1024x1536', label: '2:3' },
    { value: '1536x1024', label: '3:2' },
    { value: '1024x1792', label: '9:16' },
    { value: '1792x1024', label: '16:9' },
  ],
  nai: [
    { value: '832x1216', label: '竖向' },
    { value: '1216x832', label: '横向' },
    { value: '1024x1024', label: '方形' },
    { value: '1024x1536', label: '大竖向' },
    { value: '1536x1024', label: '大横向' },
    { value: '1472x1472', label: '大方形' },
    { value: '512x768', label: '小竖向' },
    { value: '768x512', label: '小横向' },
    { value: '640x640', label: '小方形' },
  ],
};
export const sizesFor = kind => SIZES[kind === 'nai' ? 'nai' : 'openai'];

/** 填的是不是一个认得出的尺寸。界面拿它决定要不要标出来。 */
export const okSize = v => /^\s*\d{2,5}\s*[x×]\s*\d{2,5}\s*$/.test(String(v || ''));

/**
 * 发出去的那个尺寸。
 *
 * 自己填的那一栏什么都可能出现：全角的「×」、中间的空格、一串汉字。
 * 认得出就规整成 `宽x高` 发出去，认不出就退回 1024 见方 —— 把一句
 * 「大一点」原样发过去，对面回的是一个看不出原因的 400。
 */
export function sizeText(v) {
  const m = /^\s*(\d{2,5})\s*[x×]\s*(\d{2,5})\s*$/.exec(String(v || ''));
  return m ? `${m[1]}x${m[2]}` : '1024x1024';
}

/**
 * 这段提示词里像不像塞了一整段「负面提示词」。
 *
 * **OpenAI 兼容那一档的 `images/generations` 没有负面提示词这个字段。**
 * 于是很多人照着别处的习惯，把 Positive 与 Negative 两大段一起贴进
 * 「全局生图提示词」—— 结果 Negative 那几十行被原样当成**要画的东西**
 * 发过去：写着 `selfie, portrait, studio lighting, Ghibli style`，
 * 模型就照着画自拍、棚拍、吉卜力。
 *
 * 这件事在界面上一点痕迹都没有，图画出来只是「不对劲」，没人会想到是这儿。
 * 所以认出来，直接说。
 */
const NEG_HEAD = /(^|\n)\s*(negative(\s*prompt)?|负面(提示词)?|反向(提示词)?)\s*[:：]?\s*(\n|$)/i;

export function negativeBlock(text) {
  const t = String(text || '');
  const m = NEG_HEAD.exec(t);
  if (!m) return null;
  const at = m.index + m[0].length;
  const tail = t.slice(at).trim();
  if (!tail) return null;
  // start 是那一行本身的起点。切正向的时候要切到它前面，
  // 切到 at 会把「Negative」这三个字留在正向的末尾
  return { start: m.index, at, lines: tail.split(/\n/).filter(x => x.trim()).length, head: m[2] };
}

export function isImageReady() {
  const p = activeImage();
  return !!(p && p.apiKey && p.model);
}

/** 「1024x1024」拆成两个数。拆不出来按 1024 见方。 */
function sizeOf(preset) {
  const [w, h] = sizeText(preset.size).split('x');
  return { w: +w, h: +h };
}

/**
 * NovelAI 那条。回来的 zip 里通常只有一张，取第一张 png。
 *
 * 它的 parameters 项很多，这里只给必需的那几个加一个负面词 —— 其余用它自己的
 * 默认。**不替用户调参**：采样器、步数这些是各人自己的偏好，写死在代码里
 * 反而挡路，要调的人会去改 size 和模型，再细的以后按需要开。
 */
async function novelai(p, { prompt, signal }) {
  const base = baseOf(p.baseUrl, 'https://image.novelai.net');
  const tr = track({ p, url: `${base}/ai/generate-image`, prompt });
  try {
    return await naiCall(p, base, prompt, signal, tr);
  } catch (err) { tr.fail(err); throw err; }
}

async function naiCall(p, base, prompt, signal, tr) {
  const { w, h } = sizeOf(p);
  const res = await ask(`${base}/ai/generate-image`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({
      input: prompt,
      model: p.model,
      action: 'generate',
      parameters: {
        width: w, height: h,
        n_samples: 1,
        qualityToggle: true,
        ucPreset: 0,
        negative_prompt: String(p.negative || ''),
      },
    }),
  }, p);
  if (!res.ok) await asError(res);
  const files = await unzip(await res.blob());
  const png = [...files.entries()].find(([name]) => /\.png$/i.test(name));
  if (!png) throw new Error('接口回来的压缩包里没有图片');
  const out = new Blob([await png[1].arrayBuffer()], { type: 'image/png' });
  tr.done(`取回 ${out.size} 字节`);
  return out;
}

/**
 * 把这一次生图记进抓包。
 *
 * **从前一条都不记。** 聊天那边记得清清楚楚，生图这边发出去什么、
 * 走的哪个端点、带没带参考图，屏幕上一点痕迹都没有 —— 于是「画出来的
 * 东西不对」这件事既没法自己查，也没法说给别人听。
 *
 * 记的是**拼完的最终提示词**：画面描述之外还接了外貌描述、生图世界书、
 * 角色固定提示词、全局提示词，出问题的常常正是后面这几段。
 */
function track({ p, url, prompt, withRef, parts }) {
  return trace.begin({
    taskId: withRef ? '生图 · 带参考图' : '生图',
    preset: p?.name || '生图接口',
    model: p?.model || '',
    system: `${url}\n尺寸 ${sizeText(p?.size)}`
      + (p?.respFormat ? `\n返回格式 ${p.respFormat}` : '\n返回格式 自动')
      + (withRef ? '\n这一次带了参考图（走 images/edits）' : '\n这一次是纯文生图'),
    messages: [
      { role: '最终发出去的提示词', content: prompt },
      ...(parts ? [{ role: '它由哪几段拼成', content: parts }] : []),
    ],
  });
}

/**
 * 发一个请求，连不上时把话说清楚。
 *
 * **`fetch` 失败时抛的永远是同一句 `Failed to fetch`。** 域名解析不了是它，
 * 连接被拒是它，**跨域被拦也是它** —— 而绝大多数生图中转站压根没考虑过
 * 浏览器直连，不会回那个允许跨域的响应头。于是在网页里生图，十有八九
 * 第一下就死在这里，而屏幕上只有一句 `Failed to fetch`，
 * 既不提跨域、也不提该怎么办。
 *
 * 语音那边早就有这一套（见 ai/voice.js 的 `ask`），生图这边一直没有。
 * 「一次都没成功过」多半就是这么来的。
 */
/** 这一次的负面提示词：接口自己那一栏，加上从正向里摘出来的那几段。 */
export const negText = (p, extra) =>
  [String(p?.negative || '').trim(), String(extra || '').trim()].filter(Boolean).join('\n');

/** 这套接口等多久。填 0 表示一直等（第 13 条）。 */
export const timeoutOf = p => {
  const n = Math.round(Number(p?.timeout));
  if (!Number.isFinite(n) || n < 0) return 300000;
  return n * 1000;                     // 0 原样传下去，表示不设期限
};

/**
 * 参考图那条路等多久。
 *
 * **它是一次「试试看」，不该花掉整份预算。** 失败了上层会退回纯文生图
 * （见 ai/reply.js），所以早点失败反而好。很多中转站没有 images/edits，
 * 而它们不回 404，是直接把连接挂在那儿 —— 于是一张图先白等两分钟，
 * 再从头画一次。这里给它一个短得多的期限。
 */
export const REF_TIMEOUT = 45000;
export const refTimeoutOf = p => {
  const full = timeoutOf(p);
  return full === 0 ? REF_TIMEOUT : Math.min(full, REF_TIMEOUT);
};

async function ask(url, init, p, ms) {
  try {
    return await nfetch(url, { ...init, timeout: ms == null ? timeoutOf(p) : ms });
  } catch (err) {
    // 超时和「连不上」要分开：前者多半只是这个模型慢，把期限调大就行；
    // 后者要去查地址和网络。混成一句，人只会反复检查地址
    if (err?.timedOut) {
      throw new Error(`生图接口等了 ${Math.round(err.seconds)} 秒还没有回应。`
        + '生图本来就慢，一张跑一两分钟很常见。'
        + '可在该接口的「等待上限」里调大，或填 0 表示一直等。'
        + `原始错误：${err.message || err}`);
    }
    const native = routeOf(url) === 'native';
    throw new Error(`连不上生图接口（${url}）。`
      + (native
        ? '本次请求已交由外壳发出，与跨域无关。请检查地址是否填写正确、网络是否可达。'
        : '请检查地址是否填写正确、网络是否可达。'
          + '若是浏览器拦下的跨域请求，需改填一个允许跨域的中转地址，'
          + '或安装为应用后重试。')
      + `原始错误：${err.message || err}`);
  }
}

function endpoint(preset) {
  const base = baseOf(preset.baseUrl, 'https://api.openai.com/v1');
  return /\/v\d+$/.test(base) ? `${base}/images/generations` : `${base}/v1/images/generations`;
}

/**
 * 对面在要一张输入图。
 *
 * 有些中转站把生图转给一个**对话式的多模态模型**，那种模型收到纯文字时
 * 会回一句「请上传你希望参考或编辑的图片」，而不是画一张。这不是本机
 * 发错了，是那个模型根本不做纯文生图 —— 而原样转出来的那句话，
 * 看的人只会以为是自己少填了什么。
 */
const WANTS_IMAGE = /上传.{0,6}图片|提供.{0,6}图片|参考或编辑|upload .{0,20}image|provide .{0,20}image|image[_ ]?url is required|reference image/i;

async function asError(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || JSON.stringify(j).slice(0, 400);
  } catch { detail = await res.text().catch(() => ''); }
  const said = detail || res.statusText;
  if (WANTS_IMAGE.test(said)) {
    throw new Error(`生图接口 ${res.status}: ${said}\n`
      + '这一家在要一张输入图，多半是把生图转给了一个只做图像编辑的'
      + '对话式模型，它不做纯文生图。换一个真正的生图模型，'
      + '或者换一套接口。');
  }
  throw new Error(`生图接口 ${res.status}: ${said}`);
}

function editEndpoint(preset) {
  const base = baseOf(preset.baseUrl, 'https://api.openai.com/v1');
  return /\/v\d+$/.test(base) ? `${base}/images/edits` : `${base}/v1/images/edits`;
}

// 带参考图的那条路。走 multipart 的 images/edits —— 文生图那个端点收不了图，
// 想让它照着一张脸画就只能换端点。接口不认的话由调用方退回纯文字那条路。
export function generateWithRef({ prompt, refBlob, preset, key, parts }) {
  const p = preset || activeImage();
  if (!p || !p.apiKey) throw new Error('还没有配置生图接口');
  const text = needPrompt(prompt);

  return enqueue(key || `imgref:${Date.now()}`, async signal => {
    // NovelAI 那套的「照着一张脸画」是另一条路（img2img / vibe transfer），
    // 参数和这条完全不同。还没接，所以照实抛 —— 上层会退回纯文字那条
    if (kindOf(p.kind).id === 'nai') throw new Error('NovelAI 这一档还不支持参考图');
    const form = new FormData();
    form.append('model', p.model);
    form.append('prompt', text);
    form.append('n', '1');
    form.append('size', sizeText(p.size));
    form.append('image', new File([refBlob], 'face.png', { type: refBlob.type || 'image/png' }));
    const tr = track({ p, url: editEndpoint(p), prompt: text, withRef: true, parts });
    try {
      const res = await ask(editEndpoint(p), {
        method: 'POST', signal,
        headers: { authorization: `Bearer ${p.apiKey}` },   // multipart 的 content-type 交给浏览器带边界
        body: form,
      }, p, refTimeoutOf(p));
      if (!res.ok) await asError(res);
      const out = await pickImage(await res.json(), signal);
      tr.done(`取回 ${out.size} 字节`);
      return out;
    } catch (err) { tr.fail(err); throw err; }
  }, { retries: 0 });
}

/**
 * 提示词是空的就别发出去。
 *
 * **这一条栽过。** 空提示词发过去，接口那边通常不会说「提示词是空的」，
 * 而是把它当成没收到，报一句上游的 400，里面是它自己那套字段
 *（`{"prompt":null,...}`）—— 看半天也不知道是本机没填。
 * `undefined` 更糟：`JSON.stringify` 会把整个键丢掉，对面收到的是「没这个字段」。
 */
export const needPrompt = text => {
  const t = String(text || '').trim();
  if (!t) throw new Error('这一张没有提示词，没有可画的内容');
  return t;
};

// 返回一个 Blob，交给 images 域压缩入库，和其他图片一样存本地
export function generate({ prompt, preset, key, parts, negative }) {
  const p = preset || activeImage();
  if (!p || !p.apiKey) throw new Error('还没有配置生图接口');
  const text = needPrompt(prompt);

  return enqueue(key || `img:${Date.now()}`, async signal => {
    if (kindOf(p.kind).id === 'nai') return novelai(p, { prompt: text, signal });
    const tr = track({ p, url: endpoint(p), prompt: text, parts });
    try {
      const res = await ask(endpoint(p), {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${p.apiKey}` },
        body: JSON.stringify({
          model: p.model, prompt: text,
          n: 1, size: sizeText(p.size),
          // 空字符串那一档整个字段不发，见 FORMATS
          ...(p.respFormat ? { response_format: p.respFormat } : {}),
          // **默认不发。** `images/generations` 的标准里没有这个字段，
          // OpenAI 本身见到不认识的键直接 400，而那个 400 里看不出是哪个键。
          // 有些中转站认它，所以留一个开关，由用的人自己说这套认不认
          // 接口自己那一栏，加上从提示词里摘出来的那几段
          ...(p.negOn && negText(p, negative)
            ? { negative_prompt: negText(p, negative) } : {}),
        }),
      }, p);
      if (!res.ok) await asError(res);
      const out = await pickImage(await res.json(), signal);
      tr.done(`取回 ${out.size} 字节`);
      return out;
    } catch (err) { tr.fail(err); throw err; }
  }, { retries: 0 });
}

/**
 * 从回包里把那张图取出来。
 *
 * **中转站的回包形状比官方文档多得多。** 下面这几种都真见过，而且它们失败时
 * 的样子都一样（一句「接口没有返回图片」），所以逐种认，认不出的把原文截一段
 * 带出来 —— 猜不出形状的时候，原文是唯一能往下查的东西。
 */
async function pickImage(j, signal) {
  // 有些中转站 200 也带 error。这时候它自己那句话比我们任何猜测都准
  const said = j?.error?.message || j?.message;
  const row = j?.data?.[0] || j?.images?.[0] || (Array.isArray(j) ? j[0] : null);
  // 只认字符串。有的回包里 `image` 是个对象，`String()` 一转就成了
  // 「[object Object]」，再往下报的是「不是有效的 base64」，指错了地方
  const str = v => (typeof v === 'string' && v.trim() ? v : '');
  const b64 = str(row?.b64_json) || str(row?.b64) || str(row?.image) || str(row);
  if (b64) return b64ToBlob(b64);

  const url = str(row?.url) || str(row?.image_url) || str(j?.url);
  if (url) {
    // 中转站常只给 URL。**用 nfetch**：装成 app 时这一取也要交给外壳，
    // 否则接口那条过了桥、取图这条还卡在浏览器的跨域上，白忙一趟
    const img = await nfetch(url, { signal }).catch(() => null);
    if (!img || !img.ok) {
      throw new Error('接口只返回了图片链接，且取不回来。'
        + '可在该生图接口的「返回格式」中改为 base64');
    }
    const got = await img.blob();
    // **200 不等于取到了图。** 链接过期、要登录、被挡在网关后面，回来的常是
    // 一页 HTML 或一段 JSON，状态码照样 200。不看一眼就存进去，等到
    // createImageBitmap 那一步才炸，报的是「源图像无法解码」—— 与链接无关，
    // 查不出是这儿
    if (!/^image\//.test(got.type || '')) {
      const peek = (await got.text().catch(() => '')).trim().slice(0, 120);
      throw new Error(`那个图片链接回来的不是图片${peek ? `：${peek}` : ''}`);
    }
    return got;
  }
  if (said) throw new Error(String(said));
  throw new Error(`接口没有返回图片。回包是：${JSON.stringify(j).slice(0, 200)}`);
}

/**
 * base64 转成 Blob。
 *
 * **两样要先摘掉。** 一是 `data:image/png;base64,` 这个前缀 —— 不少中转站
 * 直接把整个 data URL 塞进 `b64_json`；二是换行与空白 —— 有些接口按 76 列
 * 折行。两样都会让 `atob` 抛一句 `InvalidCharacterError`，而那句话既不提图片
 * 也不提接口，看见的人无从下手。
 */
function b64ToBlob(raw) {
  const s = String(raw || '');
  const m = /^data:([^;,]*)[^,]*,(.*)$/s.exec(s);
  const type = (m && m[1]) || 'image/png';
  const clean = (m ? m[2] : s).replace(/\s+/g, '');
  let bin;
  try { bin = atob(clean); }
  catch { throw new Error('接口回来的图片数据不是有效的 base64'); }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * 自检：一步一步指出是哪儿断的。
 *
 * 「生图失败」底下至少藏着五件不同的事：没填密钥、地址填错、被浏览器的
 * 跨域挡下、密钥或模型不对、接口给了链接但取不回来 —— 每一件的下一步都不同。
 * 一句笼统的失败等于什么都没说。
 *
 * 和语音那边的 `testVoice` 是同一套（见 ai/voice.js）。
 */
export async function testImage(preset) {
  const p = preset || activeImage();
  const k = kindOf(p?.kind);
  const base = baseOf(p?.baseUrl, k.base);
  const live = activeImage();
  const out = {
    kind: k.label, base,
    route: canNative() ? '外壳转发' : '浏览器直连',
    // **自检用的是你正在编辑的这一套，发消息用的是「当前生效」的那一套。**
    // 两者不是同一套时，自检通过了消息照样失败 —— 而屏幕上看不出区别
    active: live?.name || '',
    isActive: !live || !p || live.id === p.id,
  };

  if (!p) return { ...out, ok: false, step: '没有接口', hint: '先新建一套生图接口。' };
  if (!p.apiKey) return { ...out, ok: false, step: '没填密钥', hint: '先填 API Key。' };
  if (!p.model) return { ...out, ok: false, step: '没填模型', hint: '先填模型名称。' };

  try {
    const blob = await generate({ prompt: 'a single small black circle on white',
      preset: p, key: `img:test:${Date.now()}` });
    return { ...out, ok: true, step: '连通', bytes: blob.size,
      hint: `接口可用，取回 ${Math.round(blob.size / 1024)} KB 的图片。`
        + (out.isActive ? ''
          : `但发消息时用的是「${out.active}」那一套，不是这一套。`
            + '把这一套设为生效，或去那一套里自检。') };
  } catch (err) {
    const msg = String(err.message || err);
    if (/还没有回应/.test(msg)) {
      return { ...out, ok: false, step: '等超时了', detail: msg,
        hint: '请求发出去了，只是对面在期限内没回完。生图本来就慢，'
          + '一张跑一两分钟很常见。把这套接口的「等待上限」调大，'
          + '或填 0 表示一直等；若调到很大仍然如此，再查接口本身。' };
    }
    if (!/连不上生图接口/.test(msg)) {
      const linked = /只返回了图片链接/.test(msg);
      const wants = /这一家在要一张输入图/.test(msg);
      return { ...out, ok: false,
        step: wants ? '这个模型不做纯文生图' : linked ? '图片链接取不回来' : '接口报错',
        detail: msg,
        hint: wants
          ? '这一家要求先给一张输入图，多半是把生图转给了一个只做图像编辑的'
            + '对话式模型。换一个真正的生图模型（例如 gpt-image-1、dall-e-3 一类），'
            + '或者换一套接口。'
          : linked
            ? '接口本身是通的，但它给的那个图片链接本机取不到。'
              + '把「返回格式」改成 base64，让图片随响应一起回来。'
            : '已经连上了，是对方拒绝了这次请求。多半是密钥、模型名或尺寸不对。' };
    }
    if (canNative()) {
      return { ...out, ok: false, step: '没连上', detail: msg,
        hint: '请求由外壳发出，与跨域无关。多半是地址填错或网络不通。' };
    }
    // 浏览器那句 Failed to fetch 三种情况共用，再问一次才分得清（见 net.js）
    const live = await reachable(base);
    return {
      ...out, ok: false,
      step: live ? '被跨域拦下' : '没连上',
      detail: msg,
      hint: live
        ? '服务器是通的，但它没有允许网页直接调用。生图接口大多如此。'
          + '这一条我们改不了：需改填一个允许跨域的中转地址，'
          + '或把本应用安装到主屏幕后用外壳发送。'
        : '没有联系上这个地址。请检查地址是否填写正确、域名是否可解析、网络是否可达。',
    };
  }
}

/**
 * 把生成回来的那张存进图片库。
 *
 * **不直接用 `images.put`**，因为它解码失败时抛的是浏览器那句
 * 「The source image could not be decoded.」—— 既不提图片，也不提接口，
 * 更不提是哪一步。而走到这里的数据全都来自对面：返回一张截断的图、
 * 一段 base64 过的 HTML、一种浏览器不认的格式，都会落在这句话上。
 *
 * 带上字节数与类型：那两个数字一眼就能分出「对面压根没给图」
 * 和「给了但传坏了」。
 */
export async function toLibrary(blob, maxEdge = 1024) {
  try {
    return await images.put(new File([blob], 'gen.png', { type: blob.type || 'image/png' }), maxEdge);
  } catch {
    throw new Error(`接口回来的数据存不成图片：${blob.size} 字节，`
      + `类型 ${blob.type || '不明'}。多半不是一张完整的图片`);
  }
}

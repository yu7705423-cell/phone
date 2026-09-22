import { baseOf } from './url.js';
import { activeImage } from './services.js';
import { enqueue } from './queue.js';
import { unzip } from '../zip.js';
import { nfetch } from '../net.js';
import { images } from '../db/index.js';

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

export function isImageReady() {
  const p = activeImage();
  return !!(p && p.apiKey && p.model);
}

/** 「1024x1024」拆成两个数。拆不出来按 1024 见方。 */
function sizeOf(preset) {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(String(preset.size || '').trim());
  return m ? { w: +m[1], h: +m[2] } : { w: 1024, h: 1024 };
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
  const { w, h } = sizeOf(p);
  const res = await nfetch(`${base}/ai/generate-image`, {
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
  });
  if (!res.ok) await asError(res);
  const files = await unzip(await res.blob());
  const png = [...files.entries()].find(([name]) => /\.png$/i.test(name));
  if (!png) throw new Error('接口回来的压缩包里没有图片');
  return new Blob([await png[1].arrayBuffer()], { type: 'image/png' });
}

function endpoint(preset) {
  const base = baseOf(preset.baseUrl, 'https://api.openai.com/v1');
  return /\/v\d+$/.test(base) ? `${base}/images/generations` : `${base}/v1/images/generations`;
}

async function asError(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || JSON.stringify(j).slice(0, 200);
  } catch { detail = await res.text().catch(() => ''); }
  throw new Error(`生图接口 ${res.status}: ${detail || res.statusText}`);
}

function editEndpoint(preset) {
  const base = baseOf(preset.baseUrl, 'https://api.openai.com/v1');
  return /\/v\d+$/.test(base) ? `${base}/images/edits` : `${base}/v1/images/edits`;
}

// 带参考图的那条路。走 multipart 的 images/edits —— 文生图那个端点收不了图，
// 想让它照着一张脸画就只能换端点。接口不认的话由调用方退回纯文字那条路。
export function generateWithRef({ prompt, refBlob, preset, key }) {
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
    form.append('size', p.size || '1024x1024');
    form.append('image', new File([refBlob], 'face.png', { type: refBlob.type || 'image/png' }));
    const res = await nfetch(editEndpoint(p), {
      method: 'POST', signal,
      headers: { authorization: `Bearer ${p.apiKey}` },   // multipart 的 content-type 交给浏览器带边界
      body: form,
    });
    if (!res.ok) await asError(res);
    return pickImage(await res.json(), signal);
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
export function generate({ prompt, preset, key }) {
  const p = preset || activeImage();
  if (!p || !p.apiKey) throw new Error('还没有配置生图接口');
  const text = needPrompt(prompt);

  return enqueue(key || `img:${Date.now()}`, async signal => {
    if (kindOf(p.kind).id === 'nai') return novelai(p, { prompt: text, signal });
    const res = await nfetch(endpoint(p), {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({
        model: p.model, prompt: text,
        n: 1, size: p.size || '1024x1024',
        // 空字符串那一档整个字段不发，见 FORMATS
        ...(p.respFormat ? { response_format: p.respFormat } : {}),
      }),
    });
    if (!res.ok) await asError(res);
    return pickImage(await res.json(), signal);
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

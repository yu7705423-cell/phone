import { baseOf } from './url.js';
import { activeImage } from './services.js';
import { enqueue } from './queue.js';
import { unzip } from '../zip.js';

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
  const res = await fetch(`${base}/ai/generate-image`, {
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

  return enqueue(key || `imgref:${Date.now()}`, async signal => {
    // NovelAI 那套的「照着一张脸画」是另一条路（img2img / vibe transfer），
    // 参数和这条完全不同。还没接，所以照实抛 —— 上层会退回纯文字那条
    if (kindOf(p.kind).id === 'nai') throw new Error('NovelAI 这一档还不支持参考图');
    const form = new FormData();
    form.append('model', p.model);
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', p.size || '1024x1024');
    form.append('image', new File([refBlob], 'face.png', { type: refBlob.type || 'image/png' }));
    const res = await fetch(editEndpoint(p), {
      method: 'POST', signal,
      headers: { authorization: `Bearer ${p.apiKey}` },   // multipart 的 content-type 交给浏览器带边界
      body: form,
    });
    if (!res.ok) await asError(res);
    return pickImage(await res.json(), signal);
  }, { retries: 0 });
}

// 返回一个 Blob，交给 images 域压缩入库，和其他图片一样存本地
export function generate({ prompt, preset, key }) {
  const p = preset || activeImage();
  if (!p || !p.apiKey) throw new Error('还没有配置生图接口');

  return enqueue(key || `img:${Date.now()}`, async signal => {
    if (kindOf(p.kind).id === 'nai') return novelai(p, { prompt, signal });
    const res = await fetch(endpoint(p), {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({
        model: p.model, prompt,
        n: 1, size: p.size || '1024x1024',
        response_format: 'b64_json',
      }),
    });
    if (!res.ok) await asError(res);
    return pickImage(await res.json(), signal);
  }, { retries: 0 });
}

async function pickImage(j, signal) {
  const row = j?.data?.[0];
  if (row?.b64_json) return b64ToBlob(row.b64_json);
  if (row?.url) {
    // 中转站常只给 URL。跨域可能取不回来，取不到就把 URL 抛出去让上层提示
    const img = await fetch(row.url, { signal }).catch(() => null);
    if (!img || !img.ok) throw new Error('接口只返回了图片链接，且跨域取不回来');
    return img.blob();
  }
  throw new Error('接口没有返回图片');
}

function b64ToBlob(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

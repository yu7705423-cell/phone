import { baseOf } from './url.js';
import { activeImage } from './services.js';
import { enqueue } from './queue.js';


export function isImageReady() {
  const p = activeImage();
  return !!(p && p.apiKey && p.model);
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

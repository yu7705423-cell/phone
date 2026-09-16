import { activeImage } from './services.js';
import { enqueue } from './queue.js';

const trim = u => String(u || '').replace(/\/+$/, '');

export function isImageReady() {
  const p = activeImage();
  return !!(p && p.apiKey && p.model);
}

function endpoint(preset) {
  const base = trim(preset.baseUrl) || 'https://api.openai.com/v1';
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
    const j = await res.json();
    const row = j?.data?.[0];
    if (row?.b64_json) return b64ToBlob(row.b64_json);
    if (row?.url) {
      // 中转站常只给 URL。跨域可能取不回来，取不到就把 URL 抛出去让上层提示
      const img = await fetch(row.url, { signal }).catch(() => null);
      if (!img || !img.ok) throw new Error('接口只返回了图片链接，且跨域取不回来');
      return img.blob();
    }
    throw new Error('接口没有返回图片');
  }, { retries: 0 });
}

function b64ToBlob(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

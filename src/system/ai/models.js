// 从服务端拉模型列表。各家路径不同，但返回都能归一成一串 id。
import { baseOf } from './url.js';

async function asError(res, label) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || j?.message || JSON.stringify(j).slice(0, 200);
  } catch { detail = await res.text().catch(() => ''); }
  const err = new Error(`${label} ${res.status}: ${detail || res.statusText}`);
  err.status = res.status;
  throw err;
}

function normalize(json) {
  const rows = json?.data || json?.models || (Array.isArray(json) ? json : []);
  return rows
    // model_id 是 ElevenLabs 那一家的写法。少认这一个，取到的就是它的显示名
    //（「Eleven Multilingual v2」），而接口要的是 id（eleven_multilingual_v2）
    .map(m => (typeof m === 'string' ? m : m.id || m.model_id || m.name || m.model))
    .filter(Boolean)
    .map(String);
}

export async function fetchModels({ provider, baseUrl, apiKey, signal }) {
  if (!apiKey) throw new Error('先填 API Key');

  if (provider === 'anthropic') {
    const base = baseOf(baseUrl, 'https://api.anthropic.com');
    const res = await fetch(`${base}/v1/models?limit=200`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }, signal,
    });
    if (!res.ok) await asError(res, 'Anthropic');
    return normalize(await res.json());
  }

  // OpenAI 兼容：中转站大多也实现了 /models
  const base = baseOf(baseUrl, 'https://api.openai.com/v1');
  const url = /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` }, signal });
  if (!res.ok) await asError(res, '接口');
  return normalize(await res.json());
}

// 简单的模糊匹配：按出现顺序给分，支持不连续的子序列
export function filterModels(list, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return list;
  const scored = [];
  for (const id of list) {
    const s = id.toLowerCase();
    if (s.includes(q)) { scored.push([0, id]); continue; }
    let i = 0;
    for (const ch of q) {
      i = s.indexOf(ch, i);
      if (i < 0) break;
      i++;
    }
    if (i > 0) scored.push([1, id]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).map(x => x[1]);
}

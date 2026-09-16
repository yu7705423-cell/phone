import { voiceConfig } from './services.js';
import { enqueue } from './queue.js';

const trim = u => String(u || '').replace(/\/+$/, '');

// MiniMax 语音合成。按其 T2A 接口的常见形态实现：
// POST {base}/v1/t2a_v2?GroupId=xxx ，Bearer 鉴权，音色在 voice_setting.voice_id。
// 不同账号/版本路径可能不同，设置页里可以改 URL，并提供试听来验证。
export function isVoiceReady() {
  const v = voiceConfig();
  return !!(v.enabled && v.apiKey && v.groupId && v.model);
}

async function asError(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.base_resp?.status_msg || j?.error?.message || JSON.stringify(j).slice(0, 200);
  } catch { detail = await res.text().catch(() => ''); }
  throw new Error(`语音接口 ${res.status}: ${detail || res.statusText}`);
}

export function speak({ text, voiceId, speed = 1, key }) {
  const v = voiceConfig();
  if (!v.apiKey) throw new Error('还没有配置语音接口');
  const base = trim(v.baseUrl) || 'https://api.minimax.chat';

  return enqueue(key || `tts:${Date.now()}`, async signal => {
    const res = await fetch(`${base}/v1/t2a_v2?GroupId=${encodeURIComponent(v.groupId)}`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${v.apiKey}` },
      body: JSON.stringify({
        model: v.model,
        text,
        stream: false,
        voice_setting: { voice_id: voiceId || '', speed, vol: 1, pitch: 0 },
        audio_setting: { format: 'mp3', sample_rate: 32000 },
      }),
    });
    if (!res.ok) await asError(res);
    const j = await res.json();
    if (j?.base_resp && j.base_resp.status_code !== 0) {
      throw new Error(`语音接口：${j.base_resp.status_msg || j.base_resp.status_code}`);
    }
    const hex = j?.data?.audio;
    if (!hex) throw new Error('接口没有返回音频数据');
    return hexToBlobUrl(hex);
  }, { retries: 0 });
}

function hexToBlobUrl(hex) {
  const clean = String(hex).trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
}

let current = null;
export function play(url) {
  stop();
  current = new Audio(url);
  current.play().catch(() => {});
  return current;
}
export function stop() {
  if (current) { current.pause(); current = null; }
}

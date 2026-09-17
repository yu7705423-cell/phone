import { asrConfig, asrReady } from './services.js';
import { enqueue } from './queue.js';
import { template } from './engine.js';
import { parseJSON } from './sse.js';
import { toWav, toBase64, speechSupported } from '../audio.js';

// 把用户发的语音读成文字。两档：
//
//   text  只转文字。走 OpenAI 兼容的 /v1/audio/transcriptions（whisper 那一类）。
//         覆盖面最广，绝大多数中转站都有。
//
//   tone  连语气一起读。走 chat/completions，把音频当成一个 input_audio 内容块
//         直接喂给能听声音的多模态模型，让它同时给出文字、语气、情绪、语速。
//         这一档要求模型本身能收音频，普通的 whisper 端点不行。
//
// 两档都先把录音转成 16k 单声道 wav：MediaRecorder 在各浏览器上给出的
// 格式不一样（webm / m4a），而 input_audio 只认 wav 和 mp3。

const trim = u => String(u || '').replace(/\/+$/, '');

export { asrReady as isAsrReady };
export function asrMode() { return asrConfig().mode === 'tone' ? 'tone' : 'text'; }

// 能不能发语音：配了接口，或者浏览器自己能识别。两个都没有才真发不了。
export function canSendVoice() { return asrReady() || speechSupported(); }

function base(a) {
  const b = trim(a.baseUrl) || 'https://api.openai.com/v1';
  return /\/v\d+$/.test(b) ? b : `${b}/v1`;
}

async function asError(res, label) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || JSON.stringify(j).slice(0, 200);
  } catch { detail = await res.text().catch(() => ''); }
  throw new Error(`${label} ${res.status}: ${detail || res.statusText}`);
}

async function transcribeOnly(a, wav, signal) {
  const form = new FormData();
  form.append('file', new File([wav], 'speech.wav', { type: 'audio/wav' }));
  form.append('model', a.model);
  // 不传 language，让它自己判断。中英混说的时候写死反而会错
  const res = await fetch(`${base(a)}/audio/transcriptions`, {
    method: 'POST', signal,
    headers: { authorization: `Bearer ${a.apiKey}` },
    body: form,
  });
  if (!res.ok) await asError(res, '语音识别接口');
  const j = await res.json().catch(() => null);
  const text = (j?.text || '').trim();
  if (!text) throw new Error('没有识别出内容');
  return { text, tone: '' };
}

async function transcribeWithTone(a, wav, signal) {
  const res = await fetch(`${base(a)}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${a.apiKey}` },
    body: JSON.stringify({
      model: a.model,
      max_tokens: 600,
      messages: [
        { role: 'system', content: template('task.asr-tone') },
        {
          role: 'user',
          content: [
            { type: 'text', text: '这是一段语音，按要求输出 JSON。' },
            { type: 'input_audio', input_audio: { data: await toBase64(wav), format: 'wav' } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) await asError(res, '语音识别接口');
  const j = await res.json();
  const raw = j?.choices?.[0]?.message?.content;
  const parsed = parseJSON(typeof raw === 'string' ? raw : '');
  if (!parsed) {
    // 模型没按格式来，至少把它说的话当转写用上，别整条丢掉
    const text = String(raw || '').trim();
    if (!text) throw new Error('语音识别接口没有返回内容');
    return { text, tone: '' };
  }
  const bits = [parsed.tone, parsed.emotion, parsed.pace, parsed.notes]
    .map(v => String(v || '').trim()).filter(Boolean);
  return {
    text: String(parsed.text || '').trim(),
    tone: [...new Set(bits)].join('、'),
  };
}

// 返回 { text, tone }。tone 只在进阶档有值。
export function listen({ blob, key }) {
  const a = asrConfig();
  if (!asrReady()) throw new Error('尚未配置语音识别接口');

  return enqueue(key || `asr:${Date.now()}`, async signal => {
    const wav = await toWav(blob);
    return asrMode() === 'tone'
      ? transcribeWithTone(a, wav, signal)
      : transcribeOnly(a, wav, signal);
  }, { retries: 1 });
}

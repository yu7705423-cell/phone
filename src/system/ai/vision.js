import { baseOf } from './url.js';
import { visionConfig, visionReady } from './services.js';
import { enqueue } from './queue.js';
import { template } from './engine.js';
import { images } from '../db/images.js';
import { toDataUrl } from '../audio.js';

// 识图。用户发来的图片，角色本身是看不见的 —— 聊天接口只收文字。
// 这里把图片交给一个能看图的模型读成一段描述，描述再随消息进上下文。
//
// 走 OpenAI 兼容的 chat/completions，内容块里带一个 image_url。
// 这是目前覆盖面最广的形态，官方和多数中转站都认。


export { visionReady as isVisionReady };

function endpoint(v) {
  const base = baseOf(v.baseUrl, 'https://api.openai.com/v1');
  return /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

async function asError(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || JSON.stringify(j).slice(0, 200);
  } catch { detail = await res.text().catch(() => ''); }
  throw new Error(`识图接口 ${res.status}: ${detail || res.statusText}`);
}

// dataUrl 直接内联，不上传到任何中转存储 —— 图片只在这一次请求里出现
/**
 * 拿一张图去问一句话。describe 是它的一个用法（问「这是什么」），
 * 裁图那边问的是「该留哪一块」。
 *
 * 拆出来是因为这一层只有 prompt 不一样，其余（端点、鉴权、队列、取回文本）
 * 一模一样 —— 复制一份迟早会有一处忘了同步。
 */
export async function ask({ dataUrl, prompt, key, maxTokens = 500 }) {
  const v = visionConfig();
  if (!visionReady()) throw new Error('尚未配置识图接口');

  return enqueue(key || `vision:${Date.now()}`, async signal => {
    const res = await fetch(endpoint(v), {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${v.apiKey}` },
      body: JSON.stringify({
        model: v.model,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
      }),
    });
    if (!res.ok) await asError(res);
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content;
    const out = (typeof text === 'string' ? text : '').trim();
    if (!out) throw new Error('识图接口没有返回内容');
    return out;
  }, { retries: 1 });
}

/** 问「这张是什么」。原来那个用法，保持不变。 */
export const describe = ({ dataUrl, key }) =>
  ask({ dataUrl, prompt: template('task.vision-describe'), key });

// 按消息里的图片 id 取图去识别
export async function describeImage(imageId, key) {
  const blob = await images.blob(imageId);
  if (!blob) throw new Error('图片已不存在');
  return describe({ dataUrl: await toDataUrl(blob), key });
}

/** 按图片 id 问一句话。裁图那边要用。 */
export async function askImage(imageId, prompt, key) {
  const blob = await images.blob(imageId);
  if (!blob) throw new Error('图片已不存在');
  return ask({ dataUrl: await toDataUrl(blob), prompt, key, maxTokens: 200 });
}

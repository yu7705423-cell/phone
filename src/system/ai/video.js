import { baseOf } from './url.js';
import { activeVideo } from './services.js';
import { enqueue } from './queue.js';
import { nfetch, routeOf, canNative, reachable } from '../net.js';
import * as trace from './trace.js';

/**
 * 生成视频。
 *
 * ---- 它和生图不是一条路 ----
 *
 * 生图是「发一次、等一个响应」。视频是**异步任务**：
 *
 *   POST {base}/v2/video_generation        回一个 { task_id }
 *   GET  {base}/v2/query/video_generation/{task_id}
 *        回一个 { task: { status, content: { url }, error } }
 *   status 依次是 queued、running，然后 succeeded 或 failed 或 cancelled
 *
 * 整个过程通常一到五分钟。所以：
 *
 * **只有「提交」那一下走 AIQueue。** 轮询是几个很便宜的 GET，把它塞进队列
 * 会占着并发位五分钟，聊天那边就排在后面动不了（队列一共两个位）。
 *
 * **task_id 必须落库。** 提交完就写回那条消息，切页面、锁屏、重开应用
 * 都能接着等。不落库的话，等了三分钟一刷新，这笔钱就白花了。
 *
 * **产物链接是限时的。** 文档写明「请及时下载或转存，过期后可重新查询获取」，
 * 所以拿到就立刻取回来存进本地，不把那个链接记下来当结果。
 */

export const KINDS = [
  { id: 'minimax', label: 'MiniMax（海螺）', base: 'https://api.minimax.cn',
    note: '走 /v2/video_generation。填自己的地址即可换成别的中转站，只要它转的是同一套接口。' },
];
export const kindOf = id => KINDS.find(k => k.id === id) || KINDS[0];

/**
 * 备选的模型与档位。**这是备选，不是上限**（CLAUDE.md 第 13 条）：
 * 模型名自己填得进去，新型号不必等这张表更新。
 *
 * 两档的限制不一样，写在这里是为了在界面上直接说出来，
 * 而不是等接口回一个 400 再让人自己猜是哪一项不对。
 */
export const MODELS = [
  { id: 'MiniMax-H3', label: 'MiniMax-H3', res: ['768P', '2K'], minDur: 4,
    note: '分辨率 768P 或 2K，时长 4 到 15 秒。' },
  { id: 'MiniMax-H3-Max', label: 'MiniMax-H3-Max', res: ['480P', '768P'], minDur: 5,
    note: '极速档。分辨率 480P 或 768P，不支持 2K；时长 5 到 15 秒。' },
];
export const modelOf = id => MODELS.find(m => m.id === id) || null;

export const RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
export const MAX_DURATION = 15;

/** 这一档认不认这个分辨率。认不出的模型（自己填的）一律放行。 */
export const resOk = (model, res) => {
  const m = modelOf(model);
  return !m || m.res.includes(res);
};

export const isVideoReady = () => {
  const p = activeVideo();
  return !!(p && p.apiKey && p.model);
};

/** 这套接口等多久（秒）。填 0 表示一直等（第 13 条）。 */
export const waitOf = p => {
  const n = Math.round(Number(p?.maxWait));
  if (!Number.isFinite(n) || n < 0) return 600;
  return n;
};

/** 隔多久问一次。太密只是白打接口，太疏白等。 */
export const everyOf = p => {
  const n = Math.round(Number(p?.pollEvery));
  return Number.isFinite(n) && n >= 2 ? n : 6;
};

/**
 * 拼端点。
 *
 * **这里的路径自带版本号**（`/v2/video_generation`），所以 base 上如果也带着
 * 一个（`https://…/v1`，照着生图那套配置抄过来很自然），要先把它摘掉 ——
 * 不摘的话打出去的是 `/v1/video_generation`，那不是 V2 的端点。
 *
 * 生图那边的路径不带版本号（`/images/generations`），所以它的拼法是反过来的：
 * base 没有版本号时补一个。两处形状不同，不能照抄。
 */
const api = (p, path) => {
  const base = baseOf(p.baseUrl, kindOf(p.kind).base).replace(/\/v\d+$/, '');
  return `${base}${path}`;
};

/** 对面那句话。它是 OpenAI 那种形状，错误码在 message 结尾的括号里。 */
async function asError(res) {
  let said = '';
  try {
    const j = await res.json();
    said = j?.error?.message || j?.base_resp?.status_msg || JSON.stringify(j).slice(0, 300);
  } catch { said = (await res.text().catch(() => '')).slice(0, 300); }
  throw new Error(`视频接口 ${res.status}：${said || res.statusText}`);
}

async function ask(url, init, p, ms) {
  try {
    return await nfetch(url, { ...init, timeout: ms == null ? 60000 : ms });
  } catch (err) {
    if (err?.timedOut) {
      throw new Error(`视频接口等了 ${Math.round(err.seconds)} 秒还没有回应。`
        + '这一步只是提交任务，本来很快；等这么久多半是地址或网络的问题。'
        + `原始错误：${err.message || err}`);
    }
    const native = routeOf(url) === 'native';
    throw new Error(`连不上视频接口（${url}）。`
      + (native
        ? '本次请求已交由外壳发出，与跨域无关。请检查地址是否填写正确、网络是否可达。'
        : '请检查地址是否填写正确、网络是否可达。'
          + '若是浏览器拦下的跨域请求，需改填一个允许跨域的中转地址，'
          + '或安装为应用后重试。')
      + `原始错误：${err.message || err}`);
  }
}

export const needPrompt = text => {
  const t = String(text || '').trim();
  if (!t) throw new Error('这一段没有画面描述，没有可生成的内容');
  return t;
};

/**
 * 提交一个任务，拿 task_id。**这一下走队列**，它是一次真的接口调用。
 *
 * `first` 是首帧图的 data URL，给了就是图生视频。文档里那一条：图生视频的
 * 宽高比由那张图决定，`ratio` 恒为 adaptive —— 所以有首帧时不发 ratio，
 * 发过去也只会被忽略。文生视频反过来，ratio 必填且不能是 adaptive。
 */
export function submit({ prompt, preset, first = '', key }) {
  const p = preset || activeVideo();
  if (!p || !p.apiKey) throw new Error('还没有配置视频接口');
  if (!p.model) throw new Error('这套视频接口还没有填模型名称');
  const text = needPrompt(prompt);
  const url = api(p, '/v2/video_generation');

  return enqueue(key || `video:${Date.now()}`, async signal => {
    const content = [{ type: 'text', text }];
    if (first) content.push({ type: 'image_url', image_url: { url: first }, role: 'first_frame' });
    const body = {
      model: p.model,
      content,
      resolution: p.resolution || '768P',
      duration: Math.max(1, Math.round(Number(p.duration) || 5)),
      ...(first ? {} : { ratio: p.ratio || '16:9' }),
    };
    const tr = trace.begin({
      taskId: first ? '生成视频 · 带首帧' : '生成视频',
      preset: p.name || '视频接口',
      model: p.model,
      system: `${url}\n${body.resolution} · ${body.duration} 秒`
        + (first ? '\n这一次带了首帧图' : `\n宽高比 ${body.ratio}`),
      messages: [{ role: '画面描述', content: text }],
    });
    try {
      const res = await ask(url, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${p.apiKey}` },
        body: JSON.stringify(body),
      }, p);
      if (!res.ok) await asError(res);
      const j = await res.json();
      const taskId = j?.task_id || j?.task?.id;
      if (!taskId) throw new Error(`接口没有返回 task_id。回包是：${JSON.stringify(j).slice(0, 200)}`);
      tr.done(`任务已提交：${taskId}`);
      return String(taskId);
    } catch (err) { tr.fail(err); throw err; }
  }, { retries: 0 });
}

/**
 * 问一次这个任务怎么样了。**不走队列** —— 它是个便宜的 GET，
 * 塞进队列会占着并发位，聊天那边就排在后面动不了。
 */
export async function look(taskId, preset, signal) {
  const p = preset || activeVideo();
  const res = await ask(api(p, `/v2/query/video_generation/${encodeURIComponent(taskId)}`), {
    method: 'GET', signal, headers: { authorization: `Bearer ${p.apiKey}` },
  }, p, 30000);
  if (!res.ok) await asError(res);
  const t = (await res.json())?.task || {};
  const state = String(t.status || '');
  return {
    state,
    done: state === 'succeeded',
    dead: state === 'failed' || state === 'cancelled',
    url: t?.content?.url || '',
    duration: Number(t.duration) || 0,
    error: t?.error ? `${t.error.message || '生成失败'}${t.error.code ? `（${t.error.code}）` : ''}` : '',
  };
}

// 报错里写「任务失败了」不如写「任务已取消」。气泡上那一行在 system/clip.js
const STATE_TEXT = { failed: '失败', cancelled: '已取消' };
const stateText = s => STATE_TEXT[s] || '未能完成';

/**
 * 一直问到有结果为止，回一个视频 Blob。
 *
 * `onTick` 每问一次叫一下，界面拿它显示「排队中 / 生成中」。
 * 超过 `maxWait` 就不再问了 —— **任务还在对面跑着**，所以报错里说明
 * 它没被取消，可以回头再查，别让人以为钱白花了。
 */
export async function wait({ taskId, preset, onTick, signal }) {
  const p = preset || activeVideo();
  const every = everyOf(p) * 1000;
  const limit = waitOf(p) * 1000;
  const at = Date.now();
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' });
    const r = await look(taskId, p, signal);
    onTick?.(r);
    if (r.done) {
      if (!r.url) throw new Error('任务完成了，但接口没有给出视频链接');
      return await fetchVideo(r.url, signal);
    }
    if (r.dead) throw new Error(r.error || `任务${stateText(r.state)}`);
    if (limit > 0 && Date.now() - at > limit) {
      throw new Error(`等了 ${Math.round((Date.now() - at) / 1000)} 秒还没有生成完。`
        + `任务仍在对方那边运行，没有被取消，编号 ${taskId}，可稍后重新查询。`
        + '可在该接口的「最长等待」里调大，或填 0 表示一直等。');
    }
    await new Promise(r2 => setTimeout(r2, every));
  }
}

/**
 * 把产物取回来。
 *
 * **链接是限时的**，所以拿到就立刻取，不把它当结果记下来。
 * 取回来的东西要看一眼是不是视频：链接过期、被网关挡住时回的常是一页 HTML，
 * 状态码照样 200 —— 不看就存，等到播放那一步才炸，而那时候看不出是这儿。
 */
async function fetchVideo(url, signal) {
  const res = await nfetch(url, { signal, timeout: 180000 }).catch(err => {
    throw new Error(`视频生成好了，但取不回来：${err.message || err}`);
  });
  if (!res.ok) throw new Error(`视频生成好了，但取回来时接口回了 ${res.status}`);
  const blob = await res.blob();
  const type = blob.type || '';
  if (type && !/^video\//.test(type)) {
    const peek = (await blob.text().catch(() => '')).trim().slice(0, 120);
    throw new Error(`那个链接回来的不是视频${peek ? `：${peek}` : ''}`);
  }
  return new Blob([blob], { type: type || 'video/mp4' });
}

/**
 * 自检：一步一步指出是哪儿断的。和生图、语音那两处同一套。
 *
 * **只提交，不等它跑完。** 跑完要几分钟，而这一页要回答的是
 * 「这套配置对不对」—— 提交成功就说明地址、密钥、模型、参数都过了关。
 * 真去等一遍还要花一次生成的钱。
 */
export async function testVideo(preset) {
  const p = preset || activeVideo();
  const k = kindOf(p?.kind);
  const base = baseOf(p?.baseUrl, k.base);
  const live = activeVideo();
  const out = {
    kind: k.label, base,
    route: canNative() ? '外壳转发' : '浏览器直连',
    active: live?.name || '',
    isActive: !live || !p || live.id === p.id,
  };

  if (!p) return { ...out, ok: false, step: '没有接口', hint: '先新建一套视频接口。' };
  if (!p.apiKey) return { ...out, ok: false, step: '没填密钥', hint: '先填 API Key。' };
  if (!p.model) return { ...out, ok: false, step: '没填模型', hint: '先填模型名称。' };
  if (!resOk(p.model, p.resolution)) {
    return { ...out, ok: false, step: '分辨率这一档不支持',
      hint: `${p.model} 支持的是 ${modelOf(p.model).res.join(' 与 ')}。请先改分辨率。` };
  }

  try {
    const taskId = await submit({ prompt: 'A white paper boat floating on calm water.',
      preset: p, key: `video:test:${Date.now()}` });
    return { ...out, ok: true, step: '已提交', taskId,
      hint: `配置可用，任务已提交，编号 ${taskId}。`
        + '生成要一到五分钟，自检到此为止，不等它跑完。'
        + (out.isActive ? ''
          : `注意：发消息时用的是「${out.active}」那一套，不是这一套。`) };
  } catch (err) {
    const msg = String(err.message || err);
    if (!/连不上视频接口/.test(msg)) {
      return { ...out, ok: false, step: '接口报错', detail: msg,
        hint: '已经连上了，是对方拒绝了这次请求。'
          + '多半是密钥、模型名、分辨率或时长不对；余额不足也报在这里。' };
    }
    if (canNative()) {
      return { ...out, ok: false, step: '没连上', detail: msg,
        hint: '请求由外壳发出，与跨域无关。多半是地址填错或网络不通。' };
    }
    const alive = await reachable(base);
    return { ...out, ok: false, step: alive ? '被跨域拦下' : '没连上', detail: msg,
      hint: alive
        ? '服务器是通的，但它没有允许网页直接调用。'
          + '需改填一个允许跨域的中转地址，或安装为应用后由外壳发送。'
        : '没有联系上这个地址。请检查地址是否填写正确、域名是否可解析、网络是否可达。' };
  }
}

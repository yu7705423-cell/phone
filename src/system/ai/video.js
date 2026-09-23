import { baseOf } from './url.js';
import { activeVideo } from './services.js';
import { enqueue } from './queue.js';
import { nfetch, routeOf, canNative, reachable } from '../net.js';
import * as trace from './trace.js';
import { note } from './usage.js';

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
  { id: 'openai', label: 'OpenAI 视频格式', base: 'https://api.openai.com',
    note: '走 /v1/videos（Sora 2 的官方格式）。许多中转站把别家视频模型也挂在这一套下面，'
      + '填中转站地址与它列出的模型名即可。时长与尺寸按对方支持的填，Sora 2 是 4、8、12 秒。' },
  { id: 'unified', label: '中转站统一格式', base: '',
    note: '走 /v1/video/generations，new-api、one-api 一系的中转站常用这一套，'
      + '可灵、即梦、Vidu 等都从这里转。必须填中转站地址。' },
  { id: 'chat', label: '聊天接口出视频', base: '',
    note: '走 /v1/chat/completions：把描述当成一句话发过去，对方等视频生成完，在回复里给一个链接。'
      + '一次请求要等到出结果，中途关掉应用这一段就接不回来。必须填中转站地址。' },
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
  { id: 'MiniMax-H3', label: 'MiniMax-H3', kind: 'minimax', res: ['768P', '2K'], minDur: 4,
    note: '分辨率 768P 或 2K，时长 4 到 15 秒。' },
  { id: 'MiniMax-H3-Max', label: 'MiniMax-H3-Max', kind: 'minimax', res: ['480P', '768P'], minDur: 5,
    note: '极速档。分辨率 480P 或 768P，不支持 2K；时长 5 到 15 秒。' },
  { id: 'sora-2', label: 'sora-2', kind: 'openai',
    note: '时长 4、8 或 12 秒；尺寸 1280x720 或 720x1280。' },
  { id: 'sora-2-pro', label: 'sora-2-pro', kind: 'openai',
    note: '时长 4、8 或 12 秒；尺寸另支持 1792x1024 与 1024x1792。' },
];
/** 这一类接口的常用型号。中转站格式与聊天格式各家叫法不同，不列，照对方列表填 */
export const modelsFor = kind => MODELS.filter(m => m.kind === (kind || 'minimax'));
export const modelOf = id => MODELS.find(m => m.id === id) || null;

export const RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
export const MAX_DURATION = 15;

/** 这一档认不认这个分辨率。认不出的模型（自己填的）一律放行。 */
export const resOk = (model, res) => {
  const m = modelOf(model);
  return !m || !m.res || m.res.includes(res);
};

/** 尺寸（宽x高）。OpenAI 与中转站统一格式用它，海螺那一套用分辨率加宽高比 */
export const SIZES = ['1280x720', '720x1280', '1792x1024', '1024x1792', '1920x1080', '1080x1920'];
const sizeOf = p => {
  const m = String(p?.size || '1280x720').match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
  return m ? { w: Number(m[1]), h: Number(m[2]), text: `${m[1]}x${m[2]}` } : { w: 1280, h: 720, text: '1280x720' };
};

export const isVideoReady = () => {
  const p = activeVideo();
  return !!(p && p.apiKey && p.model && (p.baseUrl || kindOf(p.kind).base));
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

// ---- 四种接口各自怎么提交、怎么问 ----
//
// 对外只有 submit / look / wait 三个，不管是哪一种：提交拿到一个编号、拿编号问状态、
// 问到有结果就把视频取回来。编号落在消息上，重开应用接着问（见 reply.resumeClips）。
//
// 状态统一成三个词：queued（排队）、running（生成中）、succeeded（好了），
// 失败另有 dead。各家原话五花八门（in_progress、processing、completed、success……），
// 在这里翻一次，气泡上那一行（system/clip.js）只认这三个。
const RUNNING = /^(in_progress|processing|running|generating|pending_generation)$/i;
const DONE = /^(succeeded|success|completed|complete|done|finished)$/i;
const DEAD = /^(failed|failure|error|cancelled|canceled|expired|rejected)$/i;
function norm(raw) {
  const state = String(raw || '');
  if (DONE.test(state)) return { state: 'succeeded', done: true, dead: false };
  if (DEAD.test(state)) return { state: /cancel/i.test(state) ? 'cancelled' : 'failed', done: false, dead: true };
  return { state: RUNNING.test(state) ? 'running' : 'queued', done: false, dead: false };
}
const errOf = e => (e ? `${e.message || (typeof e === 'string' ? e : '生成失败')}${e.code ? `（${e.code}）` : ''}` : '');

const auth = p => ({ authorization: `Bearer ${p.apiKey}` });
const json = p => ({ 'content-type': 'application/json', ...auth(p) });

const DRIVERS = {
  // 海螺。宽高比 ratio 只在文生视频时发，带首帧时由图决定（adaptive）
  minimax: {
    path: '/v2/video_generation',
    body(p, text, first) {
      const content = [{ type: 'text', text }];
      if (first) content.push({ type: 'image_url', image_url: { url: first }, role: 'first_frame' });
      return {
        model: p.model, content,
        resolution: p.resolution || '768P',
        duration: Math.max(1, Math.round(Number(p.duration) || 5)),
        ...(first ? {} : { ratio: p.ratio || '16:9' }),
      };
    },
    idOf: j => j?.task_id || j?.task?.id,
    async look(p, id, signal) {
      const j = await getJson(p, `/v2/query/video_generation/${encodeURIComponent(id)}`, signal);
      const t = j?.task || {};
      return { ...norm(t.status), url: t?.content?.url || '', error: errOf(t.error) };
    },
  },

  // OpenAI /v1/videos。seconds 是字符串；成品从 /content 取，要带密钥
  openai: {
    path: '/v1/videos',
    body(p, text, first) {
      return {
        model: p.model, prompt: text,
        seconds: String(Math.max(1, Math.round(Number(p.duration) || 4))),
        size: sizeOf(p).text,
        ...(first ? { input_reference: { image_url: first } } : {}),
      };
    },
    idOf: j => j?.id || j?.video_id || j?.task_id,
    async look(p, id, signal) {
      const j = await getJson(p, `/v1/videos/${encodeURIComponent(id)}`, signal);
      const r = norm(j?.status);
      // 有的中转站在查询结果里直接给链接；没给就走官方那个取文件的端点
      const direct = j?.url || j?.video_url || j?.output?.url || '';
      return { ...r, url: direct || api(p, `/v1/videos/${encodeURIComponent(id)}/content`),
        headers: direct ? null : auth(p), error: errOf(j?.error) };
    },
  },

  // new-api 一系的统一格式
  unified: {
    path: '/v1/video/generations',
    body(p, text, first) {
      const { w, h } = sizeOf(p);
      return {
        model: p.model, prompt: text,
        duration: Math.max(1, Math.round(Number(p.duration) || 5)),
        width: w, height: h,
        ...(first ? { image: first } : {}),
      };
    },
    idOf: j => j?.task_id || j?.id || j?.data?.task_id,
    async look(p, id, signal) {
      const j = await getJson(p, `/v1/video/generations/${encodeURIComponent(id)}`, signal);
      const d = j?.data && !j.status ? j.data : j;
      return { ...norm(d?.status), url: d?.url || d?.video_url || d?.output?.url || '', error: errOf(d?.error) };
    },
  },
};

async function getJson(p, path, signal) {
  const res = await ask(api(p, path), { method: 'GET', signal, headers: auth(p) }, p, 30000);
  if (!res.ok) await asError(res);
  return res.json();
}

// ---- 聊天接口出视频 ----
//
// 它不是任务，是一次长请求：发过去一句描述，对方把视频生成完才回话，回话里带一个链接。
// 这一下要等几分钟，**不进 AIQueue** —— 队列一共两个位，被它占着几分钟，
// 聊天就排在后面动不了（和海螺那边「只有提交走队列」是同一个理由）。
// 花钱照样记账（usage.note），也照样能取消。
//
// 编号是本地造的，请求挂在内存里。所以**关掉应用就接不回来** —— 类型说明里写明了。
const live = new Map();   // 编号 -> { promise, abort, done, url, error }
const URL_RE = /https?:\/\/[^\s)"'<>\]]+/g;

function pickUrl(text) {
  const all = String(text || '').match(URL_RE) || [];
  return all.find(u => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u)) || all[0] || '';
}

function chatSubmit(p, text, first, key) {
  const id = `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const ctl = new AbortController();
  const wait = waitOf(p);
  const tr = trace.begin({ taskId: '生成视频 · 聊天接口', preset: p.name || '视频接口', model: p.model,
    system: api(p, '/v1/chat/completions'), messages: [{ role: '描述', content: text }] });
  note('video');
  const content = first ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: first } }] : text;
  const job = { done: false, url: '', error: '', abort: () => ctl.abort() };
  job.promise = ask(api(p, '/v1/chat/completions'), {
    method: 'POST', signal: ctl.signal, headers: json(p),
    body: JSON.stringify({ model: p.model, stream: false, messages: [{ role: 'user', content }] }),
  }, p, wait > 0 ? wait * 1000 : 0).then(async res => {
    if (!res.ok) await asError(res);
    const j = await res.json();
    const said = j?.choices?.[0]?.message?.content || '';
    const url = pickUrl(typeof said === 'string' ? said : JSON.stringify(said));
    if (!url) throw new Error(`回复里没有视频链接：${String(said).slice(0, 120) || '空的'}`);
    job.url = url;
    tr.done(url);
  }).catch(err => { job.error = String(err.message || err); tr.fail(err); })
    .finally(() => { job.done = true; });
  live.set(id, job);
  void key;
  return id;
}

function chatLook(id) {
  const job = live.get(id);
  if (!job) {
    return { state: 'failed', done: false, dead: true, url: '',
      error: '应用重新打开过。聊天接口出视频是一次长请求，中途离开就断了，这一段接不回来' };
  }
  if (!job.done) return { state: 'running', done: false, dead: false, url: '' };
  if (job.error) return { state: 'failed', done: false, dead: true, url: '', error: job.error };
  return { state: 'succeeded', done: true, dead: false, url: job.url };
}

/**
 * 提交一个任务，拿编号。**这一下走队列**，它是一次真的接口调用（聊天那一种例外，见上）。
 *
 * `first` 是首帧图的 data URL，给了就是图生视频。
 */
export function submit({ prompt, preset, first = '', key, parts = '' }) {
  const p = preset || activeVideo();
  if (!p || !p.apiKey) throw new Error('还没有配置视频接口');
  if (!p.model) throw new Error('这套视频接口还没有填模型名称');
  if (!p.baseUrl && !kindOf(p.kind).base) throw new Error('这一类视频接口必须填中转站地址');
  const text = needPrompt(prompt);
  const kind = kindOf(p.kind).id;
  if (kind === 'chat') return Promise.resolve(chatSubmit(p, text, first, key));

  const d = DRIVERS[kind];
  const url = api(p, d.path);
  return enqueue(key || `video:${Date.now()}`, async signal => {
    note('video');
    const body = d.body(p, text, first);
    const tr = trace.begin({
      taskId: first ? '生成视频 · 带首帧' : '生成视频',
      preset: p.name || '视频接口',
      model: p.model,
      // 首帧图是一整串 data URL，记账那一页只留个头
      system: `${url}\n${JSON.stringify({ ...body, prompt: undefined, content: undefined },
        (k, v) => (typeof v === 'string' && v.length > 120 ? `${v.slice(0, 40)}…` : v))}`,
      messages: [
        { role: '最终发出去的描述', content: text },
        ...(parts ? [{ role: '它由哪几段拼成', content: parts }] : []),
      ],
    });
    try {
      const res = await ask(url, { method: 'POST', signal, headers: json(p), body: JSON.stringify(body) }, p);
      if (!res.ok) await asError(res);
      const j = await res.json();
      const taskId = d.idOf(j);
      if (!taskId) throw new Error(`接口没有返回任务编号。回包是：${JSON.stringify(j).slice(0, 200)}`);
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
  if (kindOf(p?.kind).id === 'chat') return chatLook(taskId);
  return DRIVERS[kindOf(p?.kind).id].look(p, taskId, signal);
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
  const chat = kindOf(p?.kind).id === 'chat';
  // 聊天那一种是在等本地那一个请求，问得勤一点不花钱
  const every = (chat ? 2 : everyOf(p)) * 1000;
  const limit = waitOf(p) * 1000;
  const at = Date.now();
  for (;;) {
    if (signal?.aborted) {
      if (chat) live.get(taskId)?.abort();
      throw Object.assign(new Error('已取消'), { name: 'AbortError' });
    }
    const r = await look(taskId, p, signal);
    onTick?.(r);
    if (r.done) {
      if (!r.url) throw new Error('任务完成了，但接口没有给出视频链接');
      if (chat) live.delete(taskId);
      return await fetchVideo(r.url, signal, r.headers);
    }
    if (r.dead) { if (chat) live.delete(taskId); throw new Error(r.error || `任务${stateText(r.state)}`); }
    // 聊天那一种的超时由请求自己管，这里不另外截断
    if (!chat && limit > 0 && Date.now() - at > limit) {
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
 *
 * OpenAI 那一种的成品端点要带密钥（headers），别家给的是公开链接。
 */
async function fetchVideo(url, signal, headers) {
  const res = await nfetch(url, { signal, timeout: 180000, ...(headers ? { headers } : {}) }).catch(err => {
    throw new Error(`视频生成好了，但取不回来：${err.message || err}`);
  });
  if (!res.ok) throw new Error(`视频生成好了，但取回来时接口回了 ${res.status}`);
  const blob = await res.blob();
  const type = blob.type || '';
  if (type && !/^video\//.test(type) && !/octet-stream/.test(type)) {
    const peek = (await blob.text().catch(() => '')).trim().slice(0, 120);
    throw new Error(`那个链接回来的不是视频${peek ? `：${peek}` : ''}`);
  }
  return new Blob([blob], { type: /^video\//.test(type) ? type : 'video/mp4' });
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
  if (!base) return { ...out, ok: false, step: '没填地址', hint: '这一类接口必须填中转站地址。' };
  // 聊天那一种一提交就是一整段视频的钱，自检不提交：只问一下模型列表，
  // 看密钥对不对、这个模型在不在
  if (k.id === 'chat') {
    try {
      const j = await getJson(p, '/v1/models');
      const ids = (j?.data || []).map(m => m.id);
      const has = !ids.length || ids.includes(p.model);
      return { ...out, ok: has, step: has ? '已连上' : '模型不在列表里',
        hint: has
          ? '密钥可用。聊天接口出视频的自检不真的生成（那要花一段视频的钱），第一次在会话里生成时才知道对方给不给链接。'
          : `对方的模型列表里没有 ${p.model}。列表里有：${ids.slice(0, 12).join('、')}${ids.length > 12 ? '……' : ''}` };
    } catch (err) {
      return { ...out, ok: false, step: '接口报错', detail: String(err.message || err),
        hint: '多半是地址或密钥不对。' };
    }
  }
  if (k.id === 'minimax' && !resOk(p.model, p.resolution)) {
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

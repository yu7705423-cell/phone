/**
 * 语音台本：在要念的那句话里标出哪里停顿、哪里换什么情绪。
 *
 * 像给配音演员的台本那样写在句子里：
 *
 *   <情绪 平静>你回来了。<停顿 0.8><情绪 生气>今天怎么这么晚？
 *
 * 两个标记，**都是协议**（和 `[图片：…]` 同一类，第 14 条留中文）：
 *
 *   <停顿 秒数>   在这里停这么久。不写秒数按 0.5
 *   <情绪 词>     从这里起用这种情绪念，直到下一个情绪标记
 *
 * 用尖括号不用方括号：台本常常写在 `[语音：…]` 里面，方括号会把外面那一层
 * 提前收口（reply.js 的 MARK 以第一个 `]` 为界）。
 *
 * ---- 为什么要拆成段 ----
 *
 * 三家语音接口认的东西不一样：
 *
 *   MiniMax     停顿写成 `<#0.8#>` 夹在两段能念的字之间；情绪是整次请求一个值
 *               （voice_setting.emotion），只认几个固定的词
 *   OpenAI 兼容 没有停顿的写法，用省略号代替；情绪写进 instructions，自由文本
 *   ElevenLabs  停顿写成 `<break time="0.8s" />`；没有情绪参数
 *
 * 情绪是「一次请求一个」，而一句台本里可能换好几次 —— 所以**按情绪切段**，
 * 一段一次请求，回来的音频按顺序接上。三家都按字数计费，切段不多花钱，
 * 只是多等一点。
 *
 * **这里只管翻译成各家的写法，不管标记放哪儿。** 放哪儿由写台本的那一步决定
 * （promptwrite.scriptFor，或者通话里模型自己写），依据是用户写的语音世界书。
 */

const TAG = /<\s*(停顿|情绪)\s*([^<>]*?)\s*>/g;
// 流式输出时句尾可能停在半个标记上，字幕里不该露出来
const HALF = /<[^<>]*$/;

const DEFAULT_PAUSE = 0.5;

/** 有没有标记。没有的话整条路和从前一模一样。 */
export const hasTags = raw => { TAG.lastIndex = 0; return TAG.test(String(raw || '')); };

/** 去掉所有标记之后的那句话 —— 字幕、历史、翻译用的都是它。 */
export function plain(raw) {
  return String(raw || '').replace(TAG, '').replace(HALF, '').replace(/[ \t]{2,}/g, ' ').trim();
}

const secondsOf = v => {
  const n = Number(String(v || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PAUSE;
};

/** 这一段里最后一个情绪标记写的是什么。没有就是空串。 */
export function lastMood(raw) {
  const moods = tokens(raw).filter(x => x.t === 'mood');
  return moods.length ? moods[moods.length - 1].v : '';
}

/** 拆成一串记号：`{ t: 'text', v }`、`{ t: 'pause', s }`、`{ t: 'mood', v }`。 */
export function tokens(raw) {
  const s = String(raw || '');
  const out = [];
  let last = 0;
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(s))) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    if (m[1] === '停顿') out.push({ t: 'pause', s: secondsOf(m[2]) });
    else if (m[2].trim()) out.push({ t: 'mood', v: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out.filter(x => x.t !== 'text' || x.v.trim());
}

/**
 * 按情绪切段。每段 `{ mood, parts }`，parts 里只有 text 与 pause。
 *
 * 连着的停顿合成一个（MiniMax 不许连写两个间隔）；段首段尾的停顿去掉 ——
 * 那个位置两边没有能念的字，MiniMax 会拒；而段与段之间两次请求的音频
 * 本来就隔着一点空白，丢掉的那一下停顿听不太出来。
 */
export function segments(raw, baseMood = '') {
  const segs = [];
  let cur = { mood: baseMood, parts: [] };
  for (const tk of tokens(raw)) {
    if (tk.t === 'mood') {
      if (cur.parts.some(p => p.t === 'text')) segs.push(cur);
      cur = { mood: tk.v, parts: [] };
    } else if (tk.t === 'pause') {
      const prev = cur.parts[cur.parts.length - 1];
      if (prev && prev.t === 'pause') prev.s += tk.s;
      else cur.parts.push({ t: 'pause', s: tk.s });
    } else {
      cur.parts.push({ t: 'text', v: tk.v });
    }
  }
  if (cur.parts.some(p => p.t === 'text')) segs.push(cur);
  for (const sg of segs) {
    while (sg.parts[0]?.t === 'pause') sg.parts.shift();
    while (sg.parts[sg.parts.length - 1]?.t === 'pause') sg.parts.pop();
  }
  return segs;
}

const clampMm = s => Math.min(99.99, Math.max(0.01, Math.round(s * 100) / 100));

/**
 * 一段写成这一家认的文字。
 *
 *   minimax  `<#0.8#>`（两位小数，0.01 到 99.99）
 *   eleven   `<break time="0.8s" />`
 *   openai   没有停顿的写法，写一个省略号
 */
export function textFor(kind, seg) {
  return seg.parts.map(p => {
    if (p.t === 'text') return p.v;
    if (kind === 'minimax') return `<#${clampMm(p.s)}#>`;
    if (kind === 'eleven') return ` <break time="${Math.min(3, Math.round(p.s * 10) / 10)}s" /> `;
    return '……';
  }).join('').trim();
}

/**
 * ElevenLabs 没有情绪参数，按情绪切段只是多发几次请求、什么也换不来。
 * 所以那一家整句一段，情绪标记丢掉、停顿留着。
 */
export function plan(kind, raw, baseMood = '') {
  const segs = segments(raw, baseMood);
  if (kind !== 'eleven' || segs.length < 2) return segs;
  return [{ mood: baseMood, parts: segs.flatMap(s => s.parts) }];
}

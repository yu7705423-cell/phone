/**
 * 语音台本：在要念的那句话里标出哪里停顿、哪里换什么情绪、哪里有一声叹气。
 *
 * 像给配音演员的台本那样写在句子里：
 *
 *   <情绪 平静>你回来了。<停顿 0.8><声音 叹气><情绪 生气>今天怎么这么晚？
 *
 * 三个标记，**都是协议**（和 `[图片：…]` 同一类，第 14 条留中文）：
 *
 *   <停顿 秒数>   在这里停这么久。不写秒数按 0.5
 *   <情绪 词>     从这里起用这种情绪念，直到下一个情绪标记
 *   <声音 词>     在这里发出一声不是字的声音：叹气、笑、吸气、咳嗽
 *
 * 用尖括号不用方括号：台本常常写在 `[语音：…]` 里面，方括号会把外面那一层
 * 提前收口（reply.js 的 MARK 以第一个 `]` 为界）。
 *
 * ---- 各家认什么（2026-09 查过文档）----
 *
 *   MiniMax        停顿 `<#0.8#>`，0.01 到 99.99，两个停顿之间必须有字。
 *                  情绪是整次请求一个值（voice_setting.emotion），只认
 *                  happy sad angry fearful disgusted surprised calm；
 *                  fluent 与 whisper 只有 speech-2.6 认。
 *                  声音 `(sighs)` 这种，只有 speech-2.8 认，只认固定的十几个
 *   OpenAI 兼容    没有停顿写法，用省略号代替；情绪写进 instructions，自由文本；
 *                  声音没有写法，丢掉
 *   ElevenLabs     `<break time="0.8s" />`，最长 3 秒；没有情绪参数；声音丢掉
 *   ElevenLabs v3  **不认 `<break>`**。停顿、情绪、声音都写成方括号标签，
 *                  夹在句子里：`[pause]` `[angry]` `[sighs]`，自由文本
 *
 * 情绪是「一次请求一个」的那几家，一句台本里可能换好几次 —— 所以**按情绪切段**，
 * 一段一次请求，回来的音频按顺序接上。都按字数计费，切段不多花钱，只是多等一点。
 * v3 的情绪写在句子里，不用切。
 *
 * **这里只管翻译成各家的写法，不管标记放哪儿。** 放哪儿由写台本的那一步决定
 * （promptwrite.scriptFor，或者通话里模型自己写），依据是用户写的语音世界书。
 */

const TAG = /<\s*(停顿|情绪|声音)\s*([^<>]*?)\s*>/g;
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

/** 拆成一串记号：`{ t: 'text', v }`、`{ t: 'pause', s }`、`{ t: 'mood', v }`、`{ t: 'sound', v }`。 */
export function tokens(raw) {
  const s = String(raw || '');
  const out = [];
  let last = 0;
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(s))) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    if (m[1] === '停顿') out.push({ t: 'pause', s: secondsOf(m[2]) });
    else if (m[2].trim()) out.push({ t: m[1] === '情绪' ? 'mood' : 'sound', v: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out.filter(x => x.t !== 'text' || x.v.trim());
}

// ---- 词表 ----
//
// 情绪与声音在台本里写中文（用户的世界书是中文写的），送出去要换成各家认的词。
// 认不出来的：MiniMax 不送（送一个它不认的值，整个请求会被退回来），
// v3 原样放进方括号（它收自由文本）。

const MOODS = {
  happy: 'happy', 高兴: 'happy', 开心: 'happy',
  sad: 'sad', 难过: 'sad', 伤心: 'sad', 低落: 'sad',
  angry: 'angry', 生气: 'angry', 愤怒: 'angry',
  fearful: 'fearful', 害怕: 'fearful', 恐惧: 'fearful',
  disgusted: 'disgusted', 厌恶: 'disgusted',
  surprised: 'surprised', 惊讶: 'surprised', 吃惊: 'surprised',
  calm: 'calm', 平静: 'calm', 冷静: 'calm', 平淡: 'calm',
  fluent: 'fluent', 流畅: 'fluent',
  whisper: 'whisper', 耳语: 'whisper', 低语: 'whisper', 悄声: 'whisper',
};
// 只有 speech-2.6 认的那两个。别的型号收到会整个退回来
const MM_26_ONLY = new Set(['fluent', 'whisper']);

const SOUNDS = {
  笑: 'laughs', 大笑: 'laughs', 轻笑: 'chuckle', 咳嗽: 'coughs', 清嗓子: 'clear-throat',
  呻吟: 'groans', 呼吸: 'breath', 喘气: 'pant', 喘息: 'pant', 吸气: 'inhale', 呼气: 'exhale',
  倒吸气: 'gasps', 吸鼻子: 'sniffs', 抽鼻子: 'sniffs', 叹气: 'sighs', 叹息: 'sighs',
  嗤笑: 'snorts', 哼: 'snorts', 咂嘴: 'lip-smacking', 哼歌: 'humming', 嘘: 'hissing',
  嗯: 'emm', 呃: 'emm', 打喷嚏: 'sneezes', 打嗝: 'burps',
};
// MiniMax 认的全部。上面那张表只是把中文翻过来，这里才是它的边界
const MM_SOUNDS = new Set(['laughs', 'chuckle', 'coughs', 'clear-throat', 'groans', 'breath',
  'pant', 'inhale', 'exhale', 'gasps', 'sniffs', 'sighs', 'snorts', 'burps', 'lip-smacking',
  'humming', 'hissing', 'emm', 'sneezes']);

const lookup = (table, t) => {
  const k = String(t || '').trim();
  return table[k.toLowerCase()] || table[k] || '';
};

/** MiniMax 的 emotion。认不出、或者这个型号不认，就是空串 —— 空串就不送。 */
export function mmEmotion(word, model = '') {
  const e = lookup(MOODS, word);
  if (!e) return '';
  if (MM_26_ONLY.has(e) && !/2\.6/.test(String(model))) return '';
  return e;
}

const mmSound = w => { const e = lookup(SOUNDS, w) || String(w || '').trim().toLowerCase(); return MM_SOUNDS.has(e) ? e : ''; };
const english = (table, w) => lookup(table, w) || String(w || '').trim();

// ---- 各家的写法 ----

/**
 * 这一家、这个型号怎么写台本。
 *
 *   pause  停顿写成什么      mm `<#x#>` / break `<break>` / tag `[pause]` / dots 省略号
 *   sound  声音写成什么      paren `(sighs)` / tag `[sighs]` / null 丢掉
 *   mood   情绪怎么送        param 切段、每段一个参数 / tag 写在句子里 / null 没有
 */
export function dialectOf(kind, model = '') {
  const m = String(model || '').toLowerCase();
  if (kind === 'minimax') {
    return { pause: 'mm', sound: /speech-(2\.[89]|[3-9])/.test(m) ? 'paren' : null, mood: 'param', model: m };
  }
  if (kind === 'eleven') {
    return /v3/.test(m)
      ? { pause: 'tag', sound: 'tag', mood: 'tag', model: m }
      : { pause: 'break', sound: null, mood: null, model: m };
  }
  return { pause: 'dots', sound: null, mood: 'param', model: m };
}

const clampMm = s => Math.min(99.99, Math.max(0.01, Math.round(s * 100) / 100));

function pauseText(d, s) {
  if (d.pause === 'mm') return `<#${clampMm(s)}#>`;
  if (d.pause === 'break') return ` <break time="${Math.min(3, Math.round(s * 10) / 10)}s" /> `;
  if (d.pause === 'tag') return s < 0.6 ? ' [short pause] ' : s < 1.5 ? ' [pause] ' : ' [long pause] ';
  return '……';
}

function soundText(d, w) {
  if (d.sound === 'paren') { const e = mmSound(w); return e ? `(${e})` : ''; }
  if (d.sound === 'tag') return ` [${english(SOUNDS, w)}] `;
  return '';
}

/**
 * 切段。每段 `{ mood, parts }`，parts 里是 text / pause / sound，
 * 情绪写在句子里的那一家还有 mood。
 *
 * 情绪走参数的，**遇到情绪标记就另起一段**；不走参数的，整句一段。
 *
 * 连着的停顿合成一个（MiniMax 不许连写两个间隔）；段首段尾的停顿去掉 ——
 * 那个位置两边没有能念的字，MiniMax 会拒；而段与段之间两次请求的音频
 * 本来就隔着一点空白，丢掉的那一下停顿听不太出来。
 */
export function plan(kind, raw, baseMood = '', model = '') {
  const d = dialectOf(kind, model);
  const segs = [];
  let cur = { mood: baseMood, parts: [] };
  const spoken = sg => sg.parts.some(p => p.t === 'text' || p.t === 'sound');
  for (const tk of tokens(raw)) {
    if (tk.t === 'mood') {
      if (d.mood === 'param') {
        if (spoken(cur)) segs.push(cur);
        cur = { mood: tk.v, parts: [] };
      } else if (d.mood === 'tag') {
        cur.parts.push(tk);
      }
    } else if (tk.t === 'pause') {
      const prev = cur.parts[cur.parts.length - 1];
      if (prev && prev.t === 'pause') prev.s += tk.s;
      else cur.parts.push({ t: 'pause', s: tk.s });
    } else {
      cur.parts.push(tk);
    }
  }
  if (spoken(cur)) segs.push(cur);
  for (const sg of segs) {
    while (sg.parts[0]?.t === 'pause') sg.parts.shift();
    while (sg.parts[sg.parts.length - 1]?.t === 'pause') sg.parts.pop();
  }
  return segs;
}

/** 一段写成这一家认的文字。 */
export function textFor(kind, seg, model = '') {
  const d = dialectOf(kind, model);
  return seg.parts.map(p => {
    if (p.t === 'text') return p.v;
    if (p.t === 'pause') return pauseText(d, p.s);
    if (p.t === 'sound') return soundText(d, p.v);
    if (p.t === 'mood') return ` [${english(MOODS, p.v)}] `;
    return '';
  }).join('').replace(/ {2,}/g, ' ').trim();
}

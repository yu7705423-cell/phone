// 录音与音频转码。识别接口普遍只收 wav / mp3，而 MediaRecorder 在不同浏览器
// 上给出的是 webm 或 m4a，所以存下来的原件照旧，送去识别前临时转一份 wav。
// 转码走 WebAudio，不引第三方库（规约第 9 条）。

const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

export function canRecord() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    && typeof MediaRecorder !== 'undefined');
}

function pickMime() {
  if (!MediaRecorder.isTypeSupported) return '';
  return MIMES.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

// 返回一个把手：stop() 拿到录好的 Blob，cancel() 直接丢弃。
export async function record() {
  if (!canRecord()) throw new Error('这个浏览器不支持录音');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.start();
  const startedAt = Date.now();

  const release = () => stream.getTracks().forEach(t => t.stop());

  return {
    startedAt,
    stop() {
      return new Promise((resolve, reject) => {
        mr.onerror = e => { release(); reject(e.error || new Error('录音出错')); };
        mr.onstop = () => {
          release();
          resolve({
            blob: new Blob(chunks, { type: mr.mimeType || 'audio/webm' }),
            seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
          });
        };
        if (mr.state === 'inactive') mr.onstop();
        else mr.stop();
      });
    },
    cancel() {
      mr.onstop = null;
      try { if (mr.state !== 'inactive') mr.stop(); } catch { /* 已经停了 */ }
      release();
    },
  };
}

// 解码后降到单声道并重采样。OfflineAudioContext 的通道数写 1，
// 多声道会自动混下来，不用自己算。
async function toMono(blob, rate) {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(buf.slice(0));
  } finally {
    ctx.close && ctx.close();
  }

  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const build = r => new Off(1, Math.max(1, Math.ceil(decoded.duration * r)), r);
  let off;
  // 老版本 Safari 对采样率挑剔，退回原始采样率重试一次
  try { off = build(rate); } catch { off = build(decoded.sampleRate); }

  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

function encodeWav(buffer) {
  const pcm = buffer.getChannelData(0);
  const out = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(out);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  str(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);          // PCM 头长度
  view.setUint16(20, 1, true);           // 1 = 无压缩 PCM
  view.setUint16(22, 1, true);           // 单声道
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, pcm.length * 2, true);

  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7FFF, true);
  }
  return new Blob([out], { type: 'audio/wav' });
}

export async function toWav(blob, rate = 16000) {
  return encodeWav(await toMono(blob, rate));
}

export function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('读取音频失败'));
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.readAsDataURL(blob);
  });
}

export function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('读取文件失败'));
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}


// ---- 浏览器自带的语音识别 ----
//
// 没配语音识别接口时的保底。Safari 与 Chrome 都有，只是要加前缀，
// 而且它是**边说边识别**的：不录文件，直接给文字。
// 所以走这条路时得同时开着录音（留一份音频给气泡播放）和它（拿文字）。
//
// 它的账算在浏览器身上，不花接口的钱，代价是只有文字，没有语气，
// 而且识别质量取决于系统，中英混说时常常只认一种。
const SR = typeof window !== 'undefined'
  && (window.SpeechRecognition || window.webkitSpeechRecognition);

export function speechSupported() { return !!SR; }

// 返回一个把手：stop() 拿到目前识别出来的整段文字。
export function listenLocally(lang = 'zh-CN') {
  if (!SR) throw new Error('这个浏览器不支持本机语音识别');
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;

  let settled = '';
  let interim = '';
  let failed = null;

  rec.onresult = e => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) settled += r[0].transcript;
      else interim += r[0].transcript;
    }
  };
  rec.onerror = e => { failed = e.error || 'unknown'; };

  try { rec.start(); } catch { /* 已经在跑了 */ }

  return {
    text: () => (settled + interim).trim(),
    stop() {
      return new Promise(resolve => {
        const done = () => resolve({ text: (settled + interim).trim(), error: failed });
        rec.onend = done;
        try { rec.stop(); } catch { done(); }
        // 有些实现不触发 onend，兜一个超时
        setTimeout(done, 1200);
      });
    },
    cancel() { try { rec.abort(); } catch { /* 没在跑 */ } },
  };
}

// ---- 浏览器自带的合成。通话里用它做保底 ----
//
// 机械是机械，但不花钱、没有等待，而且不需要任何配置。
// 配了语音接口且角色有音色时走接口，那才是「这个角色的声音」。
const TTS = typeof window !== 'undefined' && window.speechSynthesis;

export function speakSupported() { return !!TTS; }

export function stopSpeaking() { try { TTS && TTS.cancel(); } catch { /* 有的实现会抛 */ } }

// 念一句，念完了 resolve。念不出来也 resolve —— 通话不能卡在这儿。
export function speakLocally(text, { lang = 'zh-CN', rate = 1 } = {}) {
  return new Promise(resolve => {
    if (!TTS || !String(text || '').trim()) { resolve(false); return; }
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = lang;
    u.rate = rate;
    let done = false;
    const end = ok => { if (!done) { done = true; resolve(ok); } };
    u.onend = () => end(true);
    u.onerror = () => end(false);
    try { TTS.speak(u); } catch { end(false); }
  });
}

// ---- 一直听着，静下来一会儿就算说完一句 ----
//
// 通话里不能让人按住说话 —— 真人打电话没有这个动作。所以识别常开，
// 靠静音断句：识别结果停止增长 silenceMs，就把攒下的这段当成一句交出去。
//
// 用 continuous + interimResults 是因为 isFinal 的到达时机各浏览器差别很大，
// 光等 isFinal 有时候要等好几秒。自己数静音更准。
export function listenStream({ lang = 'zh-CN', silenceMs = 1300, onUtterance } = {}) {
  if (!SR) throw new Error('这个浏览器不支持本机语音识别');
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;

  let buf = '';
  let interim = '';
  let timer = null;
  let alive = true;

  const flush = () => {
    const text = (buf + interim).trim();
    buf = ''; interim = '';
    if (text && alive) onUtterance && onUtterance(text);
  };
  const arm = () => { clearTimeout(timer); timer = setTimeout(flush, silenceMs); };

  rec.onresult = e => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) buf += r[0].transcript;
      else interim += r[0].transcript;
    }
    arm();
  };
  // 识别引擎自己会在静默一段后停掉，通话还没结束就再拉起来
  rec.onend = () => { if (alive) { try { rec.start(); } catch { /* 正在起 */ } } };
  rec.onerror = () => { /* 交给 onend 重来 */ };

  try { rec.start(); } catch { /* 已经在跑了 */ }

  return {
    // 现在听到一半的那一点，给界面显示用
    partial: () => (buf + interim).trim(),
    stop() {
      alive = false;
      clearTimeout(timer);
      rec.onend = null;
      try { rec.abort(); } catch { /* 没在跑 */ }
    },
  };
}

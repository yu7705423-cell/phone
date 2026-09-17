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

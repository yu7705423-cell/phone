// 会话里那段短视频：海报与时长。
//
// **和 system/video.js 不是一回事。** 那一个是剧场的片库（一起看、字幕、
// 转封装），这一个只管聊天气泡里那几秒。
//
// 会话里的视频气泡先摆一张静态图，点一下才播 —— **长按已经是消息菜单**
//（CLAUDE.md 第 12 条），两者不能抢同一个手势。所以每一段视频都要配一张海报，
// 取的是它开头的一帧。
//
// **取帧只能靠浏览器自己解码。** ffmpeg.wasm 有三十二兆，为一张海报把它拉起来
// 不值得（见 system/ffmpeg.js）。代价是浏览器不认的编码取不出帧 —— 那时候
// 不报错，海报留空，气泡上摆一个占位；能不能播同样是浏览器说了算，这两件事
// 本来就是一回事。

const POSTER_MAX = 720;
const PROBE_TIMEOUT = 10000;

/**
 * 等着的时候那一行写什么。
 *
 * 生成一段要一到五分钟，**一个光转圈的气泡在这种长度上说明不了任何事** ——
 * 分不出「还在排队」和「已经卡死」。接口自己会说，照着写出来即可。
 * 这几个词是从 ai/video.js 那边传过来的接口状态，翻成一句中文。
 */
const STATE = { queued: '排队中', running: '生成中', succeeded: '即将完成' };
export const stateText = s => STATE[s] || '正在生成视频';

/** 秒数写成 0:03 那种。**不四舍五入**：3.9 秒写成 0:03，写 0:04 会比进度条长。 */
export function clock(sec) {
  const n = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

function draw(video, w, h) {
  const k = Math.min(1, POSTER_MAX / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * k));
  cv.height = Math.max(1, Math.round(h * k));
  cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
  return new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82));
}

/**
 * 读一段视频：时长、宽高，以及开头那一帧。
 *
 * 取不出帧时回的是 `poster: null`，**不抛异常** —— 海报只是好看，
 * 没有它这段视频照样存得下、放得出，为它把整条路断掉不值得。
 */
export function probe(blob) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    // iOS 上这两项缺一不可：不静音、不内联，就不许在没有点击的情况下解码
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.src = url;

    let done = false;
    const finish = out => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve(out);
    };
    // 认不出的编码会一直停在那儿，既不 loadeddata 也不 error
    const timer = setTimeout(() => finish({ poster: null, duration: 0, width: 0, height: 0 }), PROBE_TIMEOUT);

    v.onerror = () => finish({ poster: null, duration: 0, width: 0, height: 0 });
    v.onloadeddata = () => {
      const duration = Number.isFinite(v.duration) ? v.duration : 0;
      const width = v.videoWidth || 0;
      const height = v.videoHeight || 0;
      if (!width || !height) return finish({ poster: null, duration, width, height });
      // 第 0 秒常常是黑的（淡入、或者编码器的第一帧），往后挪一点点
      const at = Math.min(0.1, duration > 0 ? duration / 4 : 0);
      v.onseeked = async () => finish({ poster: await draw(v, width, height), duration, width, height });
      // 挪不动（时长读不出来）就直接画当前这一帧
      if (at <= 0) draw(v, width, height).then(poster => finish({ poster, duration, width, height }));
      else v.currentTime = at;
    };
  });
}

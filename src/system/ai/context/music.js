import { settings } from '../../db/index.js';

// 她在听什么。
//
// 数据来自角色那个网易云账号的真实播放记录（见 system/netease.js）。
// 电脑上用那个号登着客户端，放的每一首都会记进去，这里读回来。
//
// **过期的不注入。** 三天前的那首歌写成「她正在听」比不写更糟：
// 用户一问就穿帮，而且模型会顺着这个假前提往下编。
// 带时间戳的那条路还会逐条判断，只留够新的。

export const freshMinutes = () => {
  const n = Math.round(Number(settings.get().musicFresh) ?? 120);
  return Number.isFinite(n) && n >= 0 ? n : 120;
};

const line = s => `${s.title}${s.artist ? ` — ${s.artist}` : ''}`;

export function build({ char }) {
  const got = char?.nowPlaying;
  if (!got || !Array.isArray(got.songs) || !got.songs.length) return '';

  const keep = freshMinutes();
  const ms = keep * 60000;
  // 填 0 表示不限时效，读到什么就注入什么
  if (keep && got.at && Date.now() - got.at > ms) return '';

  if (got.kind === 'recent') {
    const fresh = keep
      ? got.songs.filter(s => !s.at || Date.now() - s.at <= ms)
      : got.songs;
    if (!fresh.length) return '';
    const [now, ...rest] = fresh;
    let out = `\n\n[你在听的歌]\n刚刚在听：${line(now)}`;
    if (rest.length) out += `\n再往前：${rest.map(line).join('；')}`;
    return out + '\n这是你自己的播放记录。被问起时照此回答，不要换成别的歌。';
  }

  return `\n\n[你在听的歌]\n最近常听：${got.songs.map(line).join('；')}`
    + '\n这是你自己的播放记录。被问起时照此回答，不要换成别的歌。'
    + '\n记录中没有时间，不要说成「正在听」。';
}

export const meta = {
  id: 'music', label: '她在听什么',
  desc: '角色那个音乐账号的真实播放记录，过期的不注入',
};

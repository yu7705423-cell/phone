import { settings, moments, songs, characters } from '../../db/index.js';
import * as when from '../../when.js';

// 用户自己发的朋友圈。
//
// **从前角色一条都看不到。** 发布只是存进 moments，聊天时没有任何区块读它，
// 于是用户发了「今天去海边了」配三张图，转头在聊天里问「你看到我发的了吗」，角色一无所知。
//
// 给的是事实：什么时候发的、写了什么、几张图、配了哪首歌、这个角色点没点赞、评论过什么。
// 怎么接这个话题（提不提、怎么提）不写，那是角色自己的事（CLAUDE.md 第 16 条）。
// 图片本身不给：这里不花识图的钱，只说有几张。

export const meta = {
  id: 'moments',
  label: '对方的朋友圈',
  desc: '你最近发的几条朋友圈。条数在「用量与上限」里，填 0 为全给',
};

const limit = () => Math.max(0, Math.round(Number(settings.get().momentsCount ?? 3) || 0));

export function build({ char, persona }) {
  const n = limit();
  const rows = moments.all()
    .filter(m => m.authorId === 'me')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, n || Infinity);
  if (!rows.length) return '';

  const now = Date.now();
  const lines = rows.map(m => {
    const parts = [`${when.show(m.createdAt, now)}　${String(m.text || '').trim() || '（没有文字）'}`];
    const pics = (m.images || []).length;
    if (pics) parts.push(`[图片 ${pics} 张]`);
    const song = m.songId ? songs.get(m.songId) : null;
    if (song) parts.push(`[分享的歌：《${song.title}》${song.artist ? ` ${song.artist}` : ''}]`);
    if (char && (m.likes || []).includes(char.id)) parts.push('[你已点赞]');
    const mine = (m.comments || []).filter(c => char && c.authorId === char.id).map(c => c.text).filter(Boolean);
    if (mine.length) parts.push(`[你的评论：${mine.join(' / ')}]`);
    const others = (m.comments || []).filter(c => c.authorId !== 'me' && (!char || c.authorId !== char.id))
      .map(c => `${characters.get(c.authorId)?.name || '某人'}：${c.text}`);
    if (others.length) parts.push(`[其他人的评论：${others.join(' / ')}]`);
    return parts.join(' ');
  });
  const who = persona?.name || '对方';
  return `\n\n[对方的朋友圈]\n${lines.join('\n')}\n`
    + `These are the most recent posts ${who} published on their moments feed, newest first, `
    + 'with the time, the text, how many photos were attached, and whether you have liked or commented.\n';
}

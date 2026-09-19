import * as watchStore from '../../watch.js';
import * as readStore from '../../read.js';
import * as subtitle from '../../subtitle.js';

// 「你们正在看」那一段。
//
// 只在**这一场正开着**的时候出现，看完就没了。
//
// 里面三样东西，各有各的道理：
//   **进度与片名**  她得知道看到哪儿了，「倒回去」那类话才说得出口。
//   **提纲**        只给已经看过的那几段。后面的一段都不给 —— 给了就会剧透。
//   **最近的台词**  这是主力。模型看不见画面，但它读得到台词。
//
// **不再给「这一带该不该说话」那一句。** 那是在替角色决定什么时候闭嘴，
// 属于倾向，按 CLAUDE.md 第 16 条删掉了。疏密仍然算，但只用来决定
// 「要不要发起这一轮」（见 watch.due），不写进 prompt。

export const meta = {
  id: 'watch',
  label: '正在一起看 / 一起读',
  desc: '片名或书名、进度、已看过的剧情提纲、最近的台词或这一页的原文。仅在进行中注入',
};

// 一起读那一段。和上面共用一个槽位：两者同时只可能开着一个
function buildRead() {
  const c = readStore.context();
  if (!c) return '';
  const lines = [`You are reading 《${c.title}》 together with the other party.`];
  if (c.author) lines.push(`Written by ${c.author}.`);
  lines.push(c.chapter
    ? `They are on ${c.chapter}, ${c.percent}% into the book.`
    : `They are ${c.percent}% into the book.`);
  if (c.away) lines.push('The other party has left the reading page.');
  lines.push('You know only what has been read so far; do not mention anything that'
    + ' comes later in the book.');
  if (c.page) {
    lines.push('', '[这一页]', c.page);
  } else {
    lines.push('', 'The text on the page is not being shown to you. You know only the'
      + ' title and the position.');
  }
  return `\n\n[你们正在读]\n${lines.join('\n')}`;
}

export function build() {
  const c = watchStore.context();
  if (!c) return buildRead();

  const lines = [`You are watching 《${c.title}》 together with the other party.`];
  lines.push(c.duration
    ? `Current position ${c.stamp}, of a total running time of ${subtitle.stamp(c.duration)}.`
    : `Current position ${c.stamp}.`);
  if (c.away) {
    lines.push('The other party has stepped away from the playback page. Playback is'
      + ' paused and the position is held at the moment given above.');
  } else if (!c.playing) lines.push('Playback is paused at this moment.');

  lines.push(c.seen
    ? 'You have seen this film before and know what is coming, but do not give it away.'
    : 'You are watching this film for the first time. You know only what has played so'
      + ' far; do not mention anything that has not yet happened.');

  if (c.outline.length) {
    lines.push('', '[到目前为止的剧情]');
    c.outline.forEach(seg => lines.push(`${subtitle.stamp(seg.from)}　${seg.text}`));
  }

  if (c.recent.length) {
    lines.push('', '[刚刚的台词]');
    c.recent.forEach(t => lines.push(t));
  } else if (!c.hasLines) {
    lines.push('', 'This film has no subtitles. You cannot hear the dialogue and know'
      + ' only the position. Do not invent plot.');
  }

  lines.push('');
  lines.push('To pause, resume, or go back, write a line on its own in the form given'
    + ' under [一起看].');

  return `\n\n[你们正在看]\n${lines.join('\n')}`;
}

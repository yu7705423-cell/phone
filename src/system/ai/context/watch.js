import * as watchStore from '../../watch.js';
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
// 另外给一句「这一带是密还是疏」。密的时候少说，是本地算出来的，
// 不是让模型自己感觉（见 subtitle.density）。

export const meta = {
  id: 'watch',
  label: '正在一起看',
  desc: '片名、进度、已看过的剧情提纲与最近的台词。仅在一起看进行中注入',
};

export function build() {
  const c = watchStore.context();
  if (!c) return '';

  const lines = [`你正在和对方一起看《${c.title}》。`];
  lines.push(c.duration
    ? `当前进度 ${c.stamp}，全片 ${subtitle.stamp(c.duration)}。`
    : `当前进度 ${c.stamp}。`);
  if (!c.playing) lines.push('画面此刻是暂停的。');

  lines.push(c.seen
    ? '你以前看过这部片，知道后面会发生什么，但不要说破。'
    : '你是第一次看这部片，只知道到目前为止演了什么，不要说出尚未发生的情节。');

  if (c.outline.length) {
    lines.push('', '[到目前为止的剧情]');
    c.outline.forEach(seg => lines.push(`${subtitle.stamp(seg.from)}　${seg.text}`));
  }

  if (c.recent.length) {
    lines.push('', '[刚刚的台词]');
    c.recent.forEach(t => lines.push(t));
  } else if (!c.hasLines) {
    lines.push('', '这部片没有字幕，你听不到台词，只知道进度。不要编造剧情。');
  }

  lines.push('');
  lines.push(c.talky
    ? '这一段台词密集，正在演对手戏。此时少说或不说，不要盖过正在进行的对白。'
    : c.quiet
      ? '这一段没有台词。此时可以开口。'
      : '这一段台词不密。可以说一两句。');
  lines.push('说的是看片时的即时反应：对刚才那句台词、对人物、对正在发生的事。'
    + '不复述剧情，不解说，不总结。');
  lines.push('需要暂停、继续或倒回时，按[一起看]中给出的写法单独写一行。');

  return `\n\n[你们正在看]\n${lines.join('\n')}`;
}

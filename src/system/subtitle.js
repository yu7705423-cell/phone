// 字幕。
//
// 一起看这件事的要害在这儿：**模型看不见画面，但它读得到台词**。
// 所以字幕不是附属功能，它就是角色「在看」的那一路输入。
//
// 认三种格式：SRT、ASS/SSA、WebVTT。三种都按同一个形状拆出来：
//   { at, end, text }   秒为单位，text 已经去掉样式标记
//
// 解不出来就给空数组，界面上直说这份字幕读不出东西，不假装有。

const clean = s => String(s || '')
  .replace(/\{[^}]*\}/g, '')            // ASS 的样式块 {\an8}
  .replace(/<[^>]+>/g, '')              // VTT / SRT 里的 <i> <b>
  .replace(/\\N|\\n/gi, ' ')            // ASS 的换行
  .replace(/\s+/g, ' ')
  .trim();

// 0:01:02.35 / 00:01:02,350 / 01:02.35 都认
function toSec(t) {
  const m = String(t || '').trim().match(/^(?:(\d+):)?(\d+):(\d+)(?:[.,](\d+))?$/);
  if (!m) return null;
  const frac = m[4] ? Number(`0.${m[4]}`) : 0;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac;
}

function parseSrtLike(text) {
  const out = [];
  // 一段里第一行可能是序号，也可能直接是时间行，两种都认
  for (const block of String(text).split(/\r?\n\r?\n+/)) {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const at = lines.findIndex(l => l.includes('-->'));
    if (at < 0) continue;
    const [from, to] = lines[at].split('-->').map(x => x.trim().split(' ')[0]);
    const a = toSec(from);
    const b = toSec(to);
    if (a === null) continue;
    const body = clean(lines.slice(at + 1).join(' '));
    if (body) out.push({ at: a, end: b === null ? a + 3 : b, text: body });
  }
  return out;
}

function parseAss(text) {
  const out = [];
  let fields = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (/^Format\s*:/i.test(line) && !fields.length) {
      fields = line.slice(line.indexOf(':') + 1).split(',').map(x => x.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue\s*:/i.test(line)) continue;
    const rest = line.slice(line.indexOf(':') + 1);
    // 正文里可能有逗号，所以按字段数切，最后一段整个留给 text
    const cols = rest.split(',');
    const idx = k => fields.indexOf(k);
    const iStart = idx('start') < 0 ? 1 : idx('start');
    const iEnd = idx('end') < 0 ? 2 : idx('end');
    const iText = idx('text') < 0 ? fields.length - 1 : idx('text');
    const a = toSec(cols[iStart]);
    const b = toSec(cols[iEnd]);
    const body = clean(cols.slice(iText).join(','));
    if (a === null || !body) continue;
    out.push({ at: a, end: b === null ? a + 3 : b, text: body });
  }
  return out;
}

export function parse(text) {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  const lines = /^\s*\[Script Info\]|^Dialogue\s*:/im.test(raw) ? parseAss(raw) : parseSrtLike(raw);
  return lines
    .filter(l => l.text)
    .sort((a, b) => a.at - b.at);
}

/** 这一刻正在说的那一句。没有就空字符串。 */
/** 这一刻正在显示的那一句，整条给出来 —— 段评要挂在它的起始秒上。 */
export function cueAt(lines, sec) {
  if (!lines || !lines.length) return null;
  for (const l of lines) {
    if (l.at > sec) break;
    if (sec <= l.end) return l;
  }
  return null;
}


/** 到这一刻为止的最后 n 句。角色读的就是这一小段。 */
export function recentLines(lines, sec, n = 8) {
  if (!lines || !lines.length) return [];
  const out = [];
  for (const l of lines) {
    if (l.at > sec) break;
    out.push(l);
  }
  return out.slice(-Math.max(1, n));
}

/**
 * 这一带是密集还是安静。**纯本地算，不问模型。**
 *
 * 往前后各看一个窗口，数这段时间里有几句台词：
 *   密集  正在演对手戏，这时候插话最讨嫌
 *   安静  没人说话，这才是开口的时机
 *
 * 一起看时该不该说话，判据就是它。
 */
export function density(lines, sec, window = 20) {
  if (!lines || !lines.length) return { count: 0, talky: false, quiet: true, gap: Infinity };
  const from = sec - window;
  const to = sec + window;
  const near = lines.filter(l => l.end >= from && l.at <= to);

  // 距离上一句说完过了多久。空窗越长越安静
  let gap = Infinity;
  for (const l of lines) {
    if (l.at > sec) break;
    gap = sec - l.end;
  }
  if (gap < 0) gap = 0;

  return {
    count: near.length,
    talky: near.length >= 6,
    quiet: near.length <= 1 || gap >= 8,
    gap,
  };
}

/** 秒写成 01:23:45 或 12:34。提纲与倒回的那一行都按这个写。 */
export function stamp(sec) {
  const n = Math.max(0, Math.round(sec) || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  const pad = x => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 反过来：01:23:45 / 12:34 / 83 都读成秒。模型写的时间戳要靠它认。 */
export function toSeconds(text) {
  const t = String(text || '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(':').map(x => Number(x.trim()));
  if (parts.some(x => !Number.isFinite(x))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

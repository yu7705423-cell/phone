import { services } from './ai/services.js';

// 按书名查一下这本书长什么样：书名、作者、年份、封面。
//
// **只查元数据，不碰书的文件。** 书始终是用户自己导入的，这里只负责让
// 书架上的封面好看、信息对得上。
//
// 两家都开放且带 CORS，浏览器直接请求得到，都不需要密钥：
//   openlibrary  互联网档案馆的。英文书全，中文书少
//   google       Google Books。中文书收录好得多
//
// 连不连得上只有在你自己的浏览器里问才算数，所以给一个探测器（probe），
// 和音乐接口那个同一个路子。

// minQ：这一家最短能查几个字符。Open Library 不收短于 3 个的，
// 而《家》《雨》这样的书名到处都是 —— 拦在发出去之前，别让人对着
// 一句英文报错猜是怎么回事
export const PROVIDERS = [
  { id: 'openlibrary', name: 'Open Library', host: 'openlibrary.org', minQ: 3 },
  { id: 'google', name: 'Google Books', host: 'www.googleapis.com', minQ: 1 },
];

export const providerOf = id =>
  PROVIDERS.find(p => p.id === (id || config().provider)) || PROVIDERS[0];

// 探测用的样本。要够长（Open Library 的下限），而且一定查得到、一定有封面
const SAMPLE = 'Dune';

export const config = () => services().books;
export const ready = () => !!config().provider;

const https = u => String(u || '').replace(/^http:\/\//i, 'https://');

function urlFor(provider, q, limit) {
  const query = encodeURIComponent(String(q || '').trim());
  if (provider === 'google') {
    // 不带密钥时按出口 IP 限流，共用出口的手机网络很容易撞上 429。
    // 密钥是免费的，填了就按密钥计额度
    const key = String(config().apiKey || '').trim();
    return `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=${limit}`
      + (key ? `&key=${encodeURIComponent(key)}` : '');
  }
  // 不再带 fields：那个参数挑剔，写法稍有出入就是 422，而不带它返回的
  // 完整记录里本来就有要用的那几项
  return `https://openlibrary.org/search.json?q=${query}&limit=${limit}`;
}

// 接口说了什么。状态码之外的那句话才是能照着改的东西
function said(r) {
  const b = r.body;
  const msg = b?.error?.message || b?.error || b?.message || b?.detail || '';
  const text = String(typeof msg === 'string' ? msg : JSON.stringify(msg) || r.raw || '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 120) + (text.length > 120 ? '…' : '') : '';
}

// 这个状态码是怎么回事。说人话，并且说清楚下一步该干什么
const WHY = {
  429: '请求过于频繁，被接口限流',
  422: '接口不接受这次查询的写法',
  403: '接口拒绝了这次请求',
  404: '这个地址不存在',
};

function parse(provider, body) {
  if (provider === 'google') {
    return (body?.items || []).map(it => {
      const v = it.volumeInfo || {};
      return {
        title: v.title || '',
        author: (v.authors || []).join('、'),
        year: String(v.publishedDate || '').slice(0, 4),
        coverUrl: https(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || ''),
      };
    }).filter(b => b.title);
  }
  return (body?.docs || []).map(d => ({
    title: d.title || '',
    author: (d.author_name || []).join('、'),
    year: d.first_publish_year ? String(d.first_publish_year) : '',
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
  })).filter(b => b.title);
}

async function ask(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  const at = Date.now();
  try {
    const res = await fetch(url, { signal: ctl.signal });
    const raw = await res.text().catch(() => '');
    let body = null;
    try { body = JSON.parse(raw); } catch { /* 不是 JSON */ }
    return { ok: res.ok, status: res.status, body, raw, ms: Date.now() - at };
  } catch (err) {
    // 跨域被拦、连不上、超时，在浏览器里都是一个 TypeError，分不开
    return { ok: false, status: 0, raw: '', ms: Date.now() - at,
      err: err.name === 'AbortError' ? '超时' : '请求发不出去' };
  } finally { clearTimeout(t); }
}

export async function search(q, { limit = 10, provider = config().provider } = {}) {
  const text = String(q || '').trim();
  if (!text) return [];
  const min = providerOf(provider).minQ || 1;
  if (text.length < min) {
    throw new Error(`${providerOf(provider).name} 不接受短于 ${min} 个字符的查询。`
      + '可以换一家，或者直接自己填书名。');
  }
  const r = await ask(urlFor(provider, text, limit));
  if (r.status === 0) throw new Error(r.err);
  if (!r.ok) {
    const why = WHY[r.status] || `接口返回 ${r.status}`;
    throw new Error(`${why}${said(r) ? `：${said(r)}` : ''}`);
  }
  return parse(provider, r.body);
}

/** 逐项探一遍。和音乐接口那个探测器同一个写法，界面一行一行显示。 */
export async function probe(provider = config().provider, onStep) {
  const out = [];
  const step = row => { out.push(row); if (onStep) onStep(row, out); return row; };

  const r = await ask(urlFor(provider, SAMPLE, 3));
  // **收到任何一个状态码，都说明地址通、跨域也放行了。**
  // 422、429 是接口在回话，不是连不上 —— 判成连不上，人就会去查网络，
  // 而真正要改的是下一项。
  const reach = step({
    id: 'reach', label: '连得上',
    desc: '地址通，而且允许这个页面跨域读取。两者缺一个，浏览器里都用不了',
    pass: r.status !== 0,
    note: r.status === 0 ? r.err
      : r.ok ? `${r.ms} 毫秒`
      : `${r.ms} 毫秒。接口回了 ${r.status}`,
  });
  if (!reach.pass) return out;

  const rows = r.ok ? parse(provider, r.body) : [];
  const why = WHY[r.status] || (r.ok ? '' : `接口返回 ${r.status}`);
  step({
    id: 'search', label: '查得到书',
    desc: r.status === 429
      ? '被限流时换一家，或给 Google Books 填一个免费密钥'
      : `用《${SAMPLE}》试一下，能不能返回书名与作者`,
    pass: rows.length > 0,
    note: rows.length ? `查到 ${rows.length} 本，例如《${rows[0].title}》`
      : r.ok ? '接口通，但没有结果'
      : `${why}${said(r) ? `：${said(r)}` : ''}`,
  });

  const withCover = rows.find(b => b.coverUrl);
  if (!withCover) {
    step({ id: 'cover', label: '有封面', desc: '书架上那张图从这里来',
      pass: false, note: '这几本都没有封面地址' });
    return out;
  }
  const img = await new Promise(res => {
    const el = new Image();
    el.onload = () => res(true);
    el.onerror = () => res(false);
    el.src = withCover.coverUrl;
    setTimeout(() => res(false), 10000);
  });
  step({
    id: 'cover', label: '有封面', desc: '书架上那张图从这里来',
    pass: img, note: img ? '取得到图' : '有地址，但图加载不出来',
  });
  return out;
}

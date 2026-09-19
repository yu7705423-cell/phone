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

export const PROVIDERS = [
  { id: 'openlibrary', name: 'Open Library', host: 'openlibrary.org' },
  { id: 'google', name: 'Google Books', host: 'www.googleapis.com' },
];

export const config = () => services().books;
export const ready = () => !!config().provider;

const https = u => String(u || '').replace(/^http:\/\//i, 'https://');

function urlFor(provider, q, limit) {
  const query = encodeURIComponent(String(q || '').trim());
  if (provider === 'google') {
    return `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=${limit}`;
  }
  return 'https://openlibrary.org/search.json'
    + `?q=${query}&limit=${limit}&fields=title,author_name,first_publish_year,cover_i`;
}

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
  if (!String(q || '').trim()) return [];
  const r = await ask(urlFor(provider, q, limit));
  if (r.status === 0) throw new Error(r.err);
  if (!r.ok) throw new Error(`书目接口返回 ${r.status}`);
  return parse(provider, r.body);
}

/** 逐项探一遍。和音乐接口那个探测器同一个写法，界面一行一行显示。 */
export async function probe(provider = config().provider, onStep) {
  const out = [];
  const step = row => { out.push(row); if (onStep) onStep(row, out); return row; };

  const r = await ask(urlFor(provider, '雨', 3));
  const reach = step({
    id: 'reach', label: '连得上',
    desc: '地址通，而且允许这个页面跨域读取。两者缺一个，浏览器里都用不了',
    pass: r.status !== 0 && r.ok,
    note: r.status === 0 ? r.err : r.ok ? `${r.ms} 毫秒` : `返回 ${r.status}`,
  });
  if (!reach.pass) return out;

  const rows = parse(provider, r.body);
  step({
    id: 'search', label: '查得到书',
    desc: '用一个常见的字查一下，能不能返回书名与作者',
    pass: rows.length > 0,
    note: rows.length ? `查到 ${rows.length} 本，例如《${rows[0].title}》` : '没有结果',
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

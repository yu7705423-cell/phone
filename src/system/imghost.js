// 图床：我的图床、搭建、传图、搬家。见 ARCHITECTURE 4.248
//
// 大部分逻辑移植自用户自己的「图床搬家工具」（changephoto 仓库）：各家图床的上传与连接测试、
// 可选的 Cloudflare Worker 中转、从代码里挖图片链接并按字符区间原样替换、探活与图像指纹、新旧配对。
//
// 配置（含各家的 token）存在工具箱 'imghost' 那一份设置里（tools 域，随备份走，和接口密钥同一待遇）。
// 传图、测试都是用户点了才发的请求，打到用户自己填的图床上，不经过任何别人的服务器
// （配了中转的话，只经过用户自己部署的 Worker）。不调模型接口，与第 15 条无关。
import { stateOf, setState } from './toolbox.js';

const str = v => String(v ?? '').trim();

// ---- 我的图床 ----

const KEY = 'imghost';
const read = () => ({ hosts: [], defaultId: '', relay: { url: '', token: '' }, ...stateOf(KEY) });
const write = patch => setState(KEY, { ...read(), ...patch });

export const hosts = () => read().hosts;
export const getHost = id => read().hosts.find(h => h.id === id) || null;
export const defaultHost = () => {
  const s = read();
  return s.hosts.find(h => h.id === s.defaultId) || s.hosts.find(h => h.ok) || s.hosts[0] || null;
};
export const relay = () => read().relay || { url: '', token: '' };

export function setRelay({ url = '', token = '' } = {}) {
  write({ relay: { url: str(url).replace(/\/+$/, ''), token: str(token) } });
}

/** 存一个图床。id 为空就新建一个。回来的是存好的那一条 */
export function saveHost({ id = '', type, name = '', cfg = {}, ok = false, msg = '' }) {
  const s = read();
  const row = {
    id: id || `ih${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    type, name: str(name), cfg: { ...cfg }, ok: !!ok, msg: str(msg), testedAt: ok ? Date.now() : 0,
  };
  const list = s.hosts.some(h => h.id === row.id) ? s.hosts.map(h => (h.id === row.id ? row : h)) : [...s.hosts, row];
  write({ hosts: list, defaultId: s.defaultId || row.id });
  return row;
}

export function removeHost(id) {
  const s = read();
  const list = s.hosts.filter(h => h.id !== id);
  write({ hosts: list, defaultId: s.defaultId === id ? (list[0]?.id || '') : s.defaultId });
}

export const setDefault = id => write({ defaultId: id });

// 搭建到一半的草稿：一步步填的东西先存在这里，测试通过才进「我的图床」。
// 跳去别的页面复制东西再回来，填过的还在
export const draftOf = type => read().drafts?.[type] || {};
export function setDraft(type, cfg) {
  const s = read();
  write({ drafts: { ...(s.drafts || {}), [type]: cfg } });
}

// ---- 网络 ----

// fetch 在网络不通、被拦截时一律抛 TypeError，原样显示没人看得懂
function netErr(e, who) {
  if (e instanceof TypeError) {
    return new Error(`无法连接 ${who}：网络不通、被防火墙拦截，或请求被浏览器拦下（跨域）。可更换网络，或配置中转 Worker 后重试`);
  }
  return e;
}

async function asJson(r) {
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 不是 JSON 就留着原文 */ }
  return { status: r.status, ok: r.ok, json, text };
}

function dig(obj, path) {
  if (!obj || !path) return undefined;
  return String(path).split('.').reduce((o, k) => {
    if (o == null) return undefined;
    const m = /^(\w+)\[(\d+)\]$/.exec(k);
    if (m) return (o[m[1]] || [])[+m[2]];
    return o[k];
  }, obj);
}

function fail(res, fallback) {
  const j = res.json;
  const msg = (j && ((j.error && (j.error.message || j.error)) || j.message || j.msg))
    || (res.text || '').slice(0, 160) || fallback;
  return new Error(`HTTP ${res.status}：${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
}

// ImgBB、S.EE 一般只收位图。传 SVG 失败时把原因说清楚
function svgHint(filename, e) {
  if (/\.svgz?$/i.test(filename || '')) {
    return new Error(`${e.message || e}。该图床通常不接收 SVG 矢量图，请改用 GitHub + jsDelivr 或 Cloudflare R2`);
  }
  return e;
}

const b64Of = blob => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]*,/, ''));
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});

const stem = name => String(name || '').replace(/\.[^.]{1,6}$/, '');

// 经自己的 Worker 转发，绕开图床接口的跨域限制
function forward(target, init, headerAuth) {
  const r = relay();
  if (!r.url) throw new Error('该选项需要先在「我的图床」中填写中转 Worker 地址');
  const u = `${r.url}/forward${r.token ? `?key=${encodeURIComponent(r.token)}` : ''}`;
  const headers = { ...(init.headers || {}), 'X-Target-Url': target };
  if (headerAuth) { headers['X-Forward-Authorization'] = headerAuth; delete headers.Authorization; }
  return fetch(u, { ...init, headers });
}

function post(target, init, cfg, headerAuth) {
  if (cfg && cfg.viaRelay) return forward(target, init, headerAuth);
  const headers = { ...(init.headers || {}) };
  if (headerAuth) headers.Authorization = headerAuth;
  return fetch(target, { ...init, headers });
}

// 用户名与仓库名拼成 owner/repo。整串网址、把 user/repo 粘进任一个框、多余斜杠与 .git 都认
export function ghRepo(cfg) {
  const clean = v => str(v).replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  let owner = clean(cfg.owner);
  let name = clean(cfg.repo);
  if (owner.includes('/')) { const a = owner.split('/'); owner = a[0]; if (!name) name = a[1]; }
  if (name.includes('/')) { const b = name.split('/'); if (!owner) owner = b[0]; name = b[b.length - 1]; }
  if (!owner || !name) throw new Error('GitHub 用户名与仓库名都需要填写');
  return `${owner}/${name}`;
}

// ---- 各家图床：上传 ----

const UPLOAD = {
  async github(blob, filename, cfg) {
    const repo = ghRepo(cfg);
    const branch = str(cfg.branch) || 'main';
    const dir = str(cfg.dir).replace(/^\/|\/$/g, '');
    const b64 = await b64Of(blob);
    const build = path => {
      const p = path.split('/').map(encodeURIComponent).join('/');
      if (cfg.linkStyle === 'raw') return `https://raw.githubusercontent.com/${repo}/${branch}/${p}`;
      if (cfg.linkStyle === 'statically') return `https://cdn.statically.io/gh/${repo}/${branch}/${p}`;
      return `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${p}`;
    };
    let name = filename;
    for (let attempt = 0; attempt < 3; attempt++) {
      const path = (dir ? `${dir}/` : '') + name;
      const res = await asJson(await fetch(`https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${str(cfg.token)}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `upload ${name}`, content: b64, branch }),
      }));
      if (res.ok) return { url: build(path) };
      // 同名文件已存在：换个名字再传，不覆盖已有的
      if (res.status === 422 || res.status === 409 || /sha|already exists/i.test(res.text || '')) {
        name = `${stem(name)}-${Math.random().toString(36).slice(2, 7)}${name.slice(stem(name).length)}`;
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new Error(`Token 未通过验证（${res.status}）：请检查权限与仓库名`);
      throw fail(res, '上传失败');
    }
    throw new Error('同名文件过多，未能上传');
  },

  async imgbb(blob, filename, cfg) {
    const fd = new FormData();
    fd.append('key', str(cfg.key));
    fd.append('image', await b64Of(blob));
    fd.append('name', stem(filename));
    const url = `https://api.imgbb.com/1/upload${cfg.expiration ? `?expiration=${cfg.expiration}` : ''}`;
    const res = await asJson(await post(url, { method: 'POST', body: fd }, cfg));
    const link = dig(res.json, 'data.url') || dig(res.json, 'data.display_url');
    if (res.ok && link) return { url: link, deleteUrl: dig(res.json, 'data.delete_url') };
    throw svgHint(filename, fail(res, '上传失败'));
  },

  async smms(blob, filename, cfg) {
    if (blob.size > 5 * 1024 * 1024) throw new Error('该图床单张上限 5 MB');
    const base = (str(cfg.base) || 'https://s.ee').replace(/\/+$/, '');
    const fd = new FormData();
    fd.append('smfile', blob, filename);
    fd.append('format', 'json');
    const res = await asJson(await post(`${base}/api/v2/upload`, { method: 'POST', body: fd }, cfg, str(cfg.token)));
    const j = res.json;
    if (j && j.success && dig(j, 'data.url')) return { url: j.data.url, deleteUrl: dig(j, 'data.delete') };
    // 同一张图之前传过，它会直接给回原链接
    if (j && j.code === 'image_repeated' && j.images) return { url: j.images, note: '该图片之前上传过，沿用原链接' };
    throw svgHint(filename, fail(res, (j && j.message) || '上传失败'));
  },

  async r2(blob, filename, cfg) {
    const r = relay();
    if (!r.url) throw new Error('Cloudflare R2 需要先在「我的图床」中填写中转 Worker 地址');
    const dir = str(cfg.dir).replace(/^\/|\/$/g, '');
    const key = (dir ? `${dir}/` : '') + filename;
    const u = `${r.url}/upload?key_name=${encodeURIComponent(key)}${r.token ? `&key=${encodeURIComponent(r.token)}` : ''}`
      + (cfg.publicBase ? `&base=${encodeURIComponent(str(cfg.publicBase))}` : '');
    const res = await asJson(await fetch(u, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob }));
    if (res.ok && res.json && res.json.url) return { url: res.json.url };
    throw fail(res, '上传失败（请检查 Worker 是否绑定了 R2）');
  },

  async custom(blob, filename, cfg) {
    const fd = new FormData();
    fd.append(str(cfg.field) || 'file', blob, filename);
    const res = await asJson(await post(str(cfg.endpoint), { method: 'POST', headers: { Accept: 'application/json' }, body: fd },
      cfg, str(cfg.auth)));
    const link = dig(res.json, str(cfg.jsonPath) || 'data.links.url');
    if (typeof link === 'string' && link) return { url: link };
    if (res.ok) throw new Error(`上传似乎已成功，但按「${cfg.jsonPath}」取不到链接。返回内容：${(res.text || '').slice(0, 200)}`);
    throw fail(res, '上传失败');
  },
};

// S.EE 每分钟限 20 张，连传时每张之间停一会儿
export const THROTTLE = { smms: 3200 };

export async function upload(host, blob, filename) {
  const fn = UPLOAD[host?.type];
  if (!fn) throw new Error('未知的图床类型');
  try { return await fn(blob, safeName(filename), host.cfg || {}); }
  catch (e) { throw netErr(e, host.name || host.type); }
}

/** 文件名只留字母数字、短横线、下划线与点，中文与空格换掉，免得地址要转码 */
export function safeName(name) {
  const n = String(name || 'image.png');
  const ext = (n.match(/\.[A-Za-z0-9]{1,6}$/) || ['.png'])[0].toLowerCase();
  const base = stem(n).normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${base || `img-${Date.now().toString(36)}`}${ext}`;
}

// ---- 各家图床：测试连接 ----

const PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const TEST = {
  async github(cfg) {
    const repo = ghRepo(cfg);
    if (!str(cfg.token)) throw new Error('尚未填写 Token');
    const r = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Authorization: `Bearer ${str(cfg.token)}`, Accept: 'application/vnd.github+json' },
    });
    if (r.ok) {
      const d = await r.json();
      if (d.private) throw new Error('已连接，但该仓库是私有的，jsDelivr 无法读取。请在仓库 Settings 中改为 Public');
      return '已连接，仓库为公开仓库，可以使用';
    }
    if (r.status === 404) throw new Error('找不到该仓库：用户名或仓库名有误，或 Token 没有访问它的权限');
    if (r.status === 401) throw new Error('Token 无效或已过期');
    if (r.status === 403) throw new Error('Token 权限不足，请重新生成并勾选 repo');
    throw new Error(`连接失败（HTTP ${r.status}）`);
  },
  async imgbb(cfg) {
    if (!str(cfg.key)) throw new Error('尚未填写 API Key');
    // ImgBB 没有单独的校验接口，传一张 1×1 的透明图，60 秒后自动删除
    const fd = new FormData();
    fd.append('image', PX);
    const d = await (await fetch(`https://api.imgbb.com/1/upload?expiration=60&key=${encodeURIComponent(str(cfg.key))}`, { method: 'POST', body: fd })).json();
    if (d && d.success) return '已连接，API Key 有效（已上传一张 1×1 的测试图，60 秒后自动删除）';
    throw new Error((d && d.error && d.error.message) || 'API Key 无效');
  },
  async smms(cfg) {
    if (!str(cfg.token)) throw new Error('尚未填写 API Token');
    const base = (str(cfg.base) || 'https://s.ee').replace(/\/+$/, '');
    const d = await (await post(`${base}/api/v2/profile`, { method: 'POST' }, cfg, str(cfg.token))).json();
    if (d && d.success) return `已连接${d.data?.username ? `（账号 ${d.data.username}）` : ''}`;
    throw new Error((d && d.message) || 'Token 无效');
  },
  async r2(cfg) {
    const r = { url: str(cfg._relayUrl || relay().url).replace(/\/+$/, ''), token: str(cfg._relayToken || relay().token) };
    if (!r.url) throw new Error('尚未填写 Worker 地址');
    const res = await fetch(`${r.url}/ping${r.token ? `?key=${encodeURIComponent(r.token)}` : ''}`);
    if (res.status === 401) throw new Error('口令不正确：请检查 ACCESS_TOKEN 是否与 Worker 中一致');
    if (!res.ok) throw new Error(`Worker 返回 HTTP ${res.status}`);
    const d = await res.json();
    if (!d.r2) throw new Error('Worker 已连接，但尚未绑定 R2 存储桶：绑定时变量名须为 BUCKET');
    if (!d.publicBase && !str(cfg.publicBase)) return 'Worker 与 R2 均已连接。尚未设置公开域名，请填写 PUBLIC_BASE';
    return 'Worker 已连接，R2 已绑定，可以开始上传';
  },
  async relay(cfg) {
    const url = str(cfg.url).replace(/\/+$/, '');
    if (!url) throw new Error('尚未填写 Worker 地址');
    const res = await fetch(`${url}/ping${str(cfg.token) ? `?key=${encodeURIComponent(str(cfg.token))}` : ''}`);
    if (res.status === 401) throw new Error('口令不正确：请检查 ACCESS_TOKEN 是否与 Worker 中一致');
    if (!res.ok) throw new Error(`Worker 返回 HTTP ${res.status}`);
    await res.json();
    return 'Worker 已连接，可以作为中转使用';
  },
  async custom(cfg) {
    if (!str(cfg.endpoint)) throw new Error('尚未填写接口地址');
    // 自定义接口没有统一的校验方式，传一张 1×1 的图，看能不能拿回链接
    const bin = atob(PX);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const got = await UPLOAD.custom(new Blob([bytes], { type: 'image/png' }), 'eira-test.png', cfg);
    return `已连接，测试图上传成功：${got.url}`;
  },
};

export async function test(type, cfg) {
  const fn = TEST[type];
  if (!fn) throw new Error('未知的图床类型');
  try { return await fn(cfg || {}); }
  catch (e) { throw netErr(e, type); }
}

// ---- 链接格式 ----

export const FORMATS = [
  { id: 'url', label: '纯链接' },
  { id: 'md', label: 'Markdown' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'bb', label: 'BBCode' },
];

export function formatLinks(list, fmt = 'url') {
  return (list || []).filter(x => x && x.url).map(x => {
    const alt = stem(x.name || '').replace(/[[\]"<>]/g, '');
    if (fmt === 'md') return `![${alt}](${x.url})`;
    if (fmt === 'html') return `<img src="${x.url}" alt="${alt}">`;
    if (fmt === 'css') return `url("${x.url}")`;
    if (fmt === 'bb') return `[img]${x.url}[/img]`;
    return x.url;
  }).join('\n');
}

// ---- 搬家：从代码里挖图片链接，按字符区间原样替换 ----

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|tiff?|heic)(?=$|[?#])/i;
const looksLikeImage = u => IMG_EXT.test(String(u || '').split('#')[0]) || /^data:image\//i.test(u || '');

const TAG_RE = /<([a-zA-Z][-\w:]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR_RE = /([-\w:.]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+))/g;
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/gi;
const MD_RE = /!\[[^\]]*\]\(\s*<?([^)\s<>]+)>?/g;
const BARE_RE = /https?:\/\/[^\s"'<>(){}[\]|\\^`]+/gi;
const LAZY = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-actualsrc', 'data-echo', 'data-url',
  'data-image', 'data-bg', 'data-background', 'data-background-image', 'data-thumb', 'data-large', 'data-origin', 'data-hi-res-src'];
const IMG_TAGS = new Set(['img', 'source', 'image', 'amp-img', 'input']);
const SKIP_SRC = new Set(['script', 'iframe', 'frame', 'embed', 'audio', 'track']);

function accept(tag, attr, value) {
  const a = attr.toLowerCase();
  const t = tag.toLowerCase();
  if (!value || /^(#|javascript:|mailto:|tel:|\{\{|\{%|\$\{)/i.test(value.trim())) return false;
  if (LAZY.includes(a)) return looksLikeImage(value) || /^(https?:)?\/\//.test(value) || /^\.{0,2}\//.test(value);
  if (a === 'src' || a === 'lowsrc') return !SKIP_SRC.has(t) && (IMG_TAGS.has(t) || looksLikeImage(value));
  if (a === 'poster') return t === 'video';
  if (a === 'href' || a === 'xlink:href') {
    if (t === 'image' || t === 'use') return true;
    return (t === 'a' || t === 'link') && looksLikeImage(value);
  }
  if (a === 'content') return t === 'meta' && looksLikeImage(value);
  return false;
}

function decodeEntities(s) {
  if (!s.includes('&')) return s;
  const ta = document.createElement('textarea');
  ta.innerHTML = s;
  return ta.value;
}

function resolve(raw, base) {
  const r = String(raw || '').trim();
  if (!r) return null;
  if (/^(data|blob):/i.test(r)) return r;
  try {
    if (/^https?:\/\//i.test(r)) return new URL(r).href;
    if (/^\/\//.test(r)) return new URL((base && /^http:/i.test(base) ? 'http:' : 'https:') + r).href;
    if (base) return new URL(r, base).href;
  } catch { /* 解析不了 */ }
  return null;
}

/**
 * 从一段或几段代码里挖出所有图片链接。
 * sources: [{ name, text }]。同一个链接只算一条，每处出现都记下属于哪个文件、在哪个区间。
 * 回来 { items: [{ id, index, url, raw, kind, resolved, isData, occurrences: [{ f, start, end }] }], total, unresolved }
 */
export function extract(sources, { baseUrl = '' } = {}) {
  const base = str(baseUrl);
  const hits = [];
  (sources || []).forEach((src, f) => {
    const text = String(src.text || '');
    const mask = new Uint8Array(text.length);
    const taken = (a, b) => { for (let i = a; i < b; i++) if (mask[i]) return true; return false; };
    const push = (start, end, raw, kind) => {
      if (start < 0 || end > text.length || end <= start || taken(start, end)) return;
      for (let i = start; i < end; i++) mask[i] = 1;
      hits.push({ f, start, end, raw, kind });
    };
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(text))) {
      const tag = m[1];
      const attrs = m[2] || '';
      const attrsBase = m.index + 1 + tag.length;
      let am;
      ATTR_RE.lastIndex = 0;
      while ((am = ATTR_RE.exec(attrs))) {
        const attr = am[1];
        let val; let off;
        if (am[2] !== undefined) { val = am[2]; off = am[0].indexOf('"') + 1; }
        else if (am[3] !== undefined) { val = am[3]; off = am[0].indexOf("'") + 1; }
        else { val = am[4] || ''; off = am[0].length - val.length; }
        if (!val) continue;
        const vs = attrsBase + am.index + off;
        if (/^(data-)?srcset$|^imagesrcset$/i.test(attr)) {
          let cur = 0;
          val.split(',').forEach(part => {
            const ps = cur;
            cur += part.length + 1;
            const lead = part.length - part.replace(/^\s+/, '').length;
            const u = part.trim().split(/\s+/)[0];
            if (u) push(vs + ps + lead, vs + ps + lead + u.length, u, 'srcset');
          });
          continue;
        }
        if (accept(tag, attr, val)) push(vs, vs + val.length, val, `${tag.toLowerCase()}[${attr.toLowerCase()}]`);
      }
    }
    CSS_URL_RE.lastIndex = 0;
    while ((m = CSS_URL_RE.exec(text))) {
      const raw = m[1] ?? m[2] ?? m[3];
      if (!raw) continue;
      const off = m[0].indexOf(raw, 3);
      if (off < 0 || /\.(woff2?|ttf|otf|eot|mp4|webm|css|js)(?=$|[?#])/i.test(raw.split('#')[0])) continue;
      push(m.index + off, m.index + off + raw.length, raw, 'css');
    }
    MD_RE.lastIndex = 0;
    while ((m = MD_RE.exec(text))) {
      const u = m[1];
      const o = m[0].lastIndexOf(u);
      push(m.index + o, m.index + o + u.length, u, 'markdown');
    }
    BARE_RE.lastIndex = 0;
    while ((m = BARE_RE.exec(text))) {
      const u = m[0].replace(/[.,;:!)]+$/, '');
      if (looksLikeImage(u)) push(m.index, m.index + u.length, u, 'text');
    }
  });

  hits.sort((a, b) => a.f - b.f || a.start - b.start);
  const byKey = new Map();
  const items = [];
  let unresolved = 0;
  hits.forEach(h => {
    const decoded = decodeEntities(h.raw).trim();
    const url = resolve(decoded, base);
    if (!url) unresolved += 1;
    const key = url || `!rel!${decoded}`;
    if (!byKey.has(key)) {
      const it = { id: `i${items.length}`, index: items.length + 1, url, raw: decoded, kind: h.kind, resolved: !!url,
        isData: /^data:/i.test(decoded), occurrences: [], status: 'unknown', w: 0, h: 0, newUrl: '' };
      byKey.set(key, it);
      items.push(it);
    }
    byKey.get(key).occurrences.push({ f: h.f, start: h.start, end: h.end });
  });
  return { items, total: hits.length, unresolved };
}

/** 按记下的区间把旧链接换成新链接（只换 fileIdx 那一个文件），从后往前换，下标不串位 */
export function replaceAll(text, items, fileIdx = 0) {
  const edits = [];
  (items || []).forEach(it => {
    if (!it.newUrl || it.newUrl === it.url) return;
    it.occurrences.forEach(o => { if ((o.f || 0) === fileIdx) edits.push({ start: o.start, end: o.end, text: it.newUrl }); });
  });
  edits.sort((a, b) => b.start - a.start);
  let out = String(text || '');
  edits.forEach(e => { out = out.slice(0, e.start) + e.text + out.slice(e.end); });
  return { text: out, count: edits.length };
}

// ---- 图片：探活、取回、指纹 ----

/** 用 <img> 加载，不受跨域限制，顺带拿到原始宽高 */
export function probe(url, timeout = 20000) {
  return new Promise(resolveP => {
    if (!url) { resolveP({ ok: false, reason: '链接无法解析' }); return; }
    const img = new Image();
    let done = false;
    const end = r => { if (done) return; done = true; clearTimeout(timer); resolveP(r); };
    const timer = setTimeout(() => { img.src = ''; end({ ok: false, reason: '超时' }); }, timeout);
    img.onload = () => end({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => end({ ok: false, reason: '加载失败' });
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}

export const relayFetchUrl = target => {
  const r = relay();
  return r.url ? `${r.url}/fetch?url=${encodeURIComponent(target)}${r.token ? `&key=${encodeURIComponent(r.token)}` : ''}` : null;
};

/** 取回图片本身。配了中转就走中转（能绕开跨域与防盗链），没配就直接取 */
export async function fetchBlob(url) {
  if (!url) return { ok: false, error: '链接无法解析' };
  if (/^data:/i.test(url)) {
    try { return { ok: true, blob: await (await fetch(url)).blob() }; }
    catch { return { ok: false, error: '内嵌图片解析失败' }; }
  }
  const via = relayFetchUrl(url);
  try {
    const r = via ? await fetch(via, { cache: 'no-store' })
      : await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer', cache: 'no-store' });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      let msg = `HTTP ${r.status}`;
      if (/NoSuchKey|not\s*found/i.test(t)) msg += '（源站上该图片已不存在）';
      else if (r.status === 403) msg += '（防盗链或没有权限）';
      return { ok: false, error: msg };
    }
    const blob = await r.blob();
    return blob.size ? { ok: true, blob } : { ok: false, error: '返回了空文件' };
  } catch (e) {
    return { ok: false, error: via ? String(e.message || e) : '跨域被拦截（对方未开放 CORS），配置中转 Worker 后可以取回' };
  }
}

// dHash：缩到 9×8 灰度，比较左右相邻像素，得到 64 位指纹
function hashOf(src) {
  const W = 9; const H = 8;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(src, 0, 0, W, H);
  let data;
  try { data = ctx.getImageData(0, 0, W, H).data; } catch { return null; }
  let bits = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i = (y * W + x) * 4; const j = i + 4;
      const a = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const b = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
      bits += a > b ? '1' : '0';
    }
  }
  return bits;
}

// 读完即释放：这里的临时地址只用来把图画到画布上算指纹，不存、不给界面用（CLAUDE.md 第 20 条）
export function hashFromBlob(blob) {
  return new Promise(resolveP => {
    const u = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { let h = null; try { h = hashOf(img); } catch { /* 读不了像素 */ } resolveP({ hash: h, w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(u); };
    img.onerror = () => { resolveP({ hash: null }); URL.revokeObjectURL(u); };
    img.src = u;
  });
}

/** 从链接算指纹：先试跨域读像素，不行再取回图片本身（通常需要中转） */
export function hashFromUrl(url) {
  return new Promise(resolveP => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    let settled = false;
    const fallback = async (w = 0, h = 0) => {
      if (settled) return;
      settled = true;
      const r = await fetchBlob(url);
      if (!r.ok) { resolveP({ hash: null, w, h }); return; }
      const x = await hashFromBlob(r.blob);
      resolveP({ hash: x.hash, w: x.w || w, h: x.h || h });
    };
    const timer = setTimeout(() => fallback(), 20000);
    img.onload = () => {
      if (settled) return;
      clearTimeout(timer);
      let hash = null;
      try { hash = hashOf(img); } catch { /* 画布被污染 */ }
      if (hash) { settled = true; resolveP({ hash, w: img.naturalWidth, h: img.naturalHeight }); }
      else fallback(img.naturalWidth, img.naturalHeight);
    };
    img.onerror = () => { clearTimeout(timer); fallback(); };
    img.src = url;
  });
}

export const hamming = (a, b) => {
  if (!a || !b || a.length !== b.length) return 999;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d += 1;
  return d;
};

// ---- 新旧配对：图像指纹 > 文件名 > 尺寸 > 顺序，每一对给出依据与可信度 ----

const normName = n => String(n || '').toLowerCase().replace(/\.[^.]{1,6}$/, '').replace(/[^a-z0-9一-龥]+/g, '');
const fileOf = u => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop() || ''); } catch { return ''; } };

function score(o, n, oi, ni) {
  let s = 0;
  const why = [];
  if (o.hash && n.hash) {
    const d = hamming(o.hash, n.hash);
    if (d <= 4) { s += 120; why.push('图像内容一致'); }
    else if (d <= 10) { s += 50; why.push('图像内容接近'); }
    else if (d >= 18) { s -= 80; why.push('图像内容不同'); }
  }
  const on = normName(o.filename || fileOf(o.url));
  const nn = normName(n.filename || fileOf(n.url));
  if (on && nn) {
    if (on === nn) { s += 60; why.push('文件名相同'); }
    else if (on.length >= 4 && nn.includes(on)) { s += 50; why.push('文件名包含'); }
    else if (nn.length >= 4 && on.includes(nn)) { s += 45; why.push('文件名包含'); }
    else if (nn.includes(String(oi + 1).padStart(3, '0'))) { s += 38; why.push('序号一致'); }
  }
  if (o.w && o.h && n.w && n.h) {
    if (o.w === n.w && o.h === n.h) { s += 30; why.push('尺寸相同'); } else { s -= 70; why.push('尺寸不同'); }
  }
  if (oi === ni) { s += 15; why.push('顺序对应'); } else if (Math.abs(oi - ni) <= 1) s += 4;
  return { s, why };
}

export const CONF = { high: '高', mid: '中', low: '低', manual: '手动' };
const level = s => (s >= 115 ? 'high' : s >= 50 ? 'mid' : 'low');

/** 回来 { pairs: { 旧图 id: { ni, why, conf } }, pool: [没配上的新图下标] } */
export function matchAuto(olds, news) {
  const cand = [];
  olds.forEach((o, oi) => news.forEach((n, ni) => { const r = score(o, n, oi, ni); cand.push({ oi, ni, ...r }); }));
  cand.sort((a, b) => b.s - a.s);
  const usedO = new Set(); const usedN = new Set(); const pairs = {};
  cand.forEach(c => {
    if (usedO.has(c.oi) || usedN.has(c.ni) || c.s < 20) return;
    usedO.add(c.oi); usedN.add(c.ni);
    pairs[olds[c.oi].id] = { ni: c.ni, why: c.why.slice(0, 2), conf: level(c.s) };
  });
  const freeO = olds.map((_, i) => i).filter(i => !usedO.has(i));
  const freeN = news.map((_, i) => i).filter(i => !usedN.has(i));
  for (let i = 0; i < Math.min(freeO.length, freeN.length); i++) {
    pairs[olds[freeO[i]].id] = { ni: freeN[i], why: ['仅按顺序推测'], conf: 'low' };
    usedN.add(freeN[i]);
  }
  return { pairs, pool: news.map((_, i) => i).filter(i => !usedN.has(i)) };
}

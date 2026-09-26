/**
 * 来自用户的「图床搬家工具」（changephoto 仓库），原样收录。Eira 的「图床」工具里复制的就是这一份。
 *
 * 图床搬家工具 —— Cloudflare Worker 中转
 *
 * 干三件事：
 *   GET  /ping                     健康检查，顺便告诉前端有没有绑 R2
 *   GET  /fetch?url=...            服务器端去取图，绕开跨域和防盗链
 *   POST /upload?key_name=...      上传到 R2（需要绑定 BUCKET）
 *   POST /forward                  转发上传请求到图床 API（绕开图床的跨域限制）
 *
 * 部署见同目录 README.md。
 */

const ALLOW_FORWARD = [
  's.ee', 'sm.ms', 'api.imgbb.com', 'api.github.com', 'smms.app'
];

const MAX_BYTES = 40 * 1024 * 1024;   // 单张 40MB 上限

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return preflight();

    const auth = checkToken(request, url, env);
    if (auth) return auth;

    try {
      if (path === '/ping' || path === '/') {
        return json({ ok: true, r2: !!env.BUCKET, publicBase: env.PUBLIC_BASE || null });
      }
      if (path === '/fetch') return handleFetch(request, url, env);
      if (path === '/upload') return handleUpload(request, url, env);
      if (path === '/forward') return handleForward(request, env);
      return json({ error: '未知路径：' + path }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  }
};

/* ---------------- 通用 ---------------- */

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Target-Url,X-Forward-Authorization,Authorization',
    'Access-Control-Max-Age': '86400',
    ...extra
  };
}

function preflight() {
  return new Response(null, { status: 204, headers: cors() });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: cors({ 'Content-Type': 'application/json; charset=utf-8' })
  });
}

/* 设了 ACCESS_TOKEN 就必须带对口令，防止被人当成公共代理白嫖 */
function checkToken(request, url, env) {
  const want = env.ACCESS_TOKEN;
  if (!want) return null;
  const got = url.searchParams.get('key') ||
              (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (got === want) return null;
  return json({ error: '口令不对' }, 401);
}

/* 挡掉内网地址，别让自己的 Worker 变成内网扫描器 */
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  if (/^\[?::1\]?$/.test(h)) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/* ---------------- /fetch ---------------- */

async function handleFetch(request, url, env) {
  const target = url.searchParams.get('url');
  if (!target) return json({ error: '缺少 url 参数' }, 400);

  let t;
  try { t = new URL(target); } catch { return json({ error: '链接格式不对' }, 400); }
  if (t.protocol !== 'http:' && t.protocol !== 'https:') {
    return json({ error: '只支持 http/https' }, 400);
  }
  if (isBlockedHost(t.hostname)) return json({ error: '不允许访问内网地址' }, 403);

  // 不带 Referer 去取，很多防盗链就是看这个
  const upstream = await fetch(t.href, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; image-mover/1.0)',
      'Accept': 'image/*,*/*;q=0.8'
    },
    redirect: 'follow',
    cf: { cacheTtl: 300, cacheEverything: true }
  });

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '');
    return new Response(body.slice(0, 500) || ('上游返回 ' + upstream.status), {
      status: upstream.status,
      headers: cors({ 'Content-Type': 'text/plain; charset=utf-8' })
    });
  }

  const len = parseInt(upstream.headers.get('Content-Length') || '0', 10);
  if (len && len > MAX_BYTES) {
    return json({ error: '文件太大（' + (len / 1048576).toFixed(1) + 'MB），超过 40MB 上限' }, 413);
  }

  const type = upstream.headers.get('Content-Type') || 'application/octet-stream';
  return new Response(upstream.body, {
    status: 200,
    headers: cors({
      'Content-Type': type,
      'Cache-Control': 'public, max-age=300',
      'X-Proxied-From': t.hostname
    })
  });
}

/* ---------------- /upload（R2） ---------------- */

async function handleUpload(request, url, env) {
  if (request.method !== 'POST') return json({ error: '要用 POST' }, 405);
  if (!env.BUCKET) {
    return json({ error: 'Worker 还没绑定 R2 存储桶（变量名要叫 BUCKET）' }, 500);
  }

  const key = (url.searchParams.get('key_name') || '').replace(/^\/+/, '');
  if (!key) return json({ error: '缺少 key_name 参数' }, 400);
  if (key.includes('..')) return json({ error: '路径不合法' }, 400);

  const body = await request.arrayBuffer();
  if (!body.byteLength) return json({ error: '空文件' }, 400);
  if (body.byteLength > MAX_BYTES) return json({ error: '文件太大' }, 413);

  await env.BUCKET.put(key, body, {
    httpMetadata: {
      contentType: request.headers.get('Content-Type') || 'application/octet-stream',
      cacheControl: 'public, max-age=31536000'
    }
  });

  const base = (url.searchParams.get('base') || env.PUBLIC_BASE || '').replace(/\/+$/, '');
  if (!base) {
    return json({
      error: '上传成功了，但不知道公开访问地址。请在 Worker 里设置 PUBLIC_BASE，或在前端填「公开访问域名」',
      key
    }, 500);
  }
  return json({
    url: base + '/' + key.split('/').map(encodeURIComponent).join('/'),
    key,
    size: body.byteLength
  });
}

/* ---------------- /forward（转发图床 API） ---------------- */

async function handleForward(request, env) {
  if (request.method !== 'POST') return json({ error: '要用 POST' }, 405);

  const target = request.headers.get('X-Target-Url');
  if (!target) return json({ error: '缺少 X-Target-Url 头' }, 400);

  let t;
  try { t = new URL(target); } catch { return json({ error: '目标地址格式不对' }, 400); }
  if (t.protocol !== 'https:') return json({ error: '只允许 https 目标' }, 400);
  if (isBlockedHost(t.hostname)) return json({ error: '不允许访问内网地址' }, 403);

  const extra = (env.ALLOW_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
  const allow = ALLOW_FORWARD.concat(extra);
  const okHost = allow.some(h => t.hostname === h || t.hostname.endsWith('.' + h));
  if (!okHost) {
    return json({
      error: '不在允许转发的域名里：' + t.hostname +
             '（要加的话，在 Worker 环境变量 ALLOW_HOSTS 里补上，逗号分隔）'
    }, 403);
  }

  const headers = new Headers();
  const ct = request.headers.get('Content-Type');
  if (ct) headers.set('Content-Type', ct);
  const fwdAuth = request.headers.get('X-Forward-Authorization');
  if (fwdAuth) headers.set('Authorization', fwdAuth);
  headers.set('Accept', 'application/json');
  headers.set('User-Agent', 'Mozilla/5.0 (compatible; image-mover/1.0)');

  const upstream = await fetch(t.href, {
    method: 'POST',
    headers,
    body: request.body
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: cors({
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8'
    })
  });
}

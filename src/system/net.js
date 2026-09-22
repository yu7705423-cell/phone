/**
 * 往第三方接口发请求这件事，在浏览器里不是我们说了算。
 *
 * ---- 跨域 ----
 *
 * 网页发出去的跨域请求，要对方在响应头里点头（Access-Control-Allow-Origin）
 * 才读得到。**点不点头是对方的事，我们改不了。** 很多语音、生图接口压根没考虑
 * 过浏览器直连，于是请求连发都发不出去 —— 浏览器给的错只有一句含糊的
 * 「Failed to fetch」，看不出是地址错了、网断了、还是被跨域拦了。
 *
 * ---- 装成 app 就没这回事 ----
 *
 * 跨域是**浏览器**的规矩，不是 HTTP 的规矩。外壳那一层用系统自己的网络栈发，
 * 一样的请求照样通。所以装了 ipa 的时候把这类请求交给外壳转发
 * （见 ios/Sources/NetBridge.swift），浏览器里则照常直连 —— 通不通看对方。
 *
 * 出口只有 nfetch 一个。哪些调用走它，由调用方决定：聊天那几家本来就允许
 * 浏览器直连，不必绕；语音和生图这种十有八九不允许的，绕。
 */

const BRIDGE = () => window.webkit?.messageHandlers?.net;

/** 这台设备能不能让外壳代发。 */
export const canNative = () => !!(window.phoneNet && BRIDGE());

const b64ToBytes = b64 => {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const bytesToB64 = bytes => {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(s);
};

/**
 * `FormData` 自己拼成 multipart 的字节。
 *
 * **这一条栽过，而且栽得特别安静。** 过桥的只是一串 base64，浏览器那套
 * 「FormData 交给 fetch，由它生成分界串并配好 content-type」在这里没人做 ——
 * 从前这个分支不存在，`bodyB64` 就停在空串上，外壳照发，对面收到一个
 * **没有请求体**的 POST。生图带参考图那条正是这样：relay 报
 * `{"prompt":null,"referenced_image_ids":null}`，看起来像是本机没填提示词，
 * 其实是整个 body 在过桥时没了。
 *
 * 分界串要跟着 content-type 一起交出去，对面才拆得开。
 */
async function formBytes(form) {
  const boundary = `----phone${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const parts = [];
  const enc = new TextEncoder();
  for (const [name, value] of form.entries()) {
    const isFile = value instanceof Blob;
    const filename = isFile ? (value.name || 'blob') : '';
    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"`
      + (isFile ? `; filename="${filename}"\r\nContent-Type: ${value.type || 'application/octet-stream'}` : '')
      + '\r\n\r\n'));
    parts.push(isFile ? new Uint8Array(await value.arrayBuffer()) : enc.encode(String(value)));
    parts.push(enc.encode('\r\n'));
  }
  parts.push(enc.encode(`--${boundary}--\r\n`));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  parts.forEach(p => { out.set(p, at); at += p.length; });
  return { bytes: out, contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * 交给外壳发。回来的东西**长得像 Response**，但不是真的 Response ——
 * 只做调用方真正用得上的那几样，免得为了像而像。
 */
async function viaNative(url, init = {}) {
  const body = init.body;
  const headers = { ...(init.headers || {}) };
  let bodyB64 = '';
  if (typeof body === 'string') bodyB64 = bytesToB64(new TextEncoder().encode(body));
  else if (body instanceof ArrayBuffer) bodyB64 = bytesToB64(new Uint8Array(body));
  else if (body instanceof Uint8Array) bodyB64 = bytesToB64(body);
  else if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const { bytes, contentType } = await formBytes(body);
    bodyB64 = bytesToB64(bytes);
    // 分界串是现生成的，只有这里知道。调用方给的那个（如果有）一定是错的
    headers['content-type'] = contentType;
  } else if (body instanceof Blob) bodyB64 = bytesToB64(new Uint8Array(await body.arrayBuffer()));
  else if (body !== undefined && body !== null) {
    // 认不出来的请求体**不许静静地发一个空的出去**。上面那条就是这么栽的：
    // 对面报的是「你没填提示词」，而本机看什么都正常
    throw new TypeError(`这种请求体过不了外壳那座桥：${body.constructor?.name || typeof body}`);
  }

  const got = await BRIDGE().postMessage({
    action: 'fetch',
    url,
    method: init.method || 'GET',
    headers,
    body: bodyB64,
  });
  if (got?.error) throw new TypeError(got.error);

  const bytes = b64ToBytes(got.body || '');
  const type = got.headers?.['content-type'] || got.headers?.['Content-Type'] || '';
  const text = () => new TextDecoder().decode(bytes);
  return {
    ok: got.status >= 200 && got.status < 300,
    status: got.status,
    headers: got.headers || {},
    native: true,
    text: async () => text(),
    json: async () => JSON.parse(text()),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    blob: async () => new Blob([bytes], { type: type || 'application/octet-stream' }),
    clone() { return this; },
  };
}

const sameOrigin = url => {
  try { return new URL(url, location.href).origin === location.origin; }
  catch { return false; }
};

/**
 * 这个地址根本不必过桥。
 *
 * `data:` 与 `blob:` 的内容就在本机，浏览器自己取得到，而外壳那层是
 * `URLSession`，它对这两种一律取不了。它们的 origin 是 "null"，
 * 和本页不同源，光看同源会把它们送上桥，送过去就是必然失败。
 */
const localUrl = url => /^(data|blob):/i.test(String(url || ''));

/**
 * 发一个请求。装了 app 且是跨域的就交给外壳，否则照常直连。
 *
 * `prefer` 填 'direct' 可以强制走浏览器 —— 测试那一页要能分别试两条路，
 * 好告诉用户「直连不通但外壳通」还是「两条都不通」。
 */
export function nfetch(url, init = {}, { prefer = 'auto' } = {}) {
  if (prefer !== 'direct' && canNative() && !sameOrigin(url) && !localUrl(url)) {
    return viaNative(url, init);
  }
  return fetch(url, init);
}

/** 这一次会走哪条路。界面上要说清楚，别让人猜。 */
export const routeOf = url =>
  (canNative() && !sameOrigin(url) && !localUrl(url) ? 'native' : 'direct');

/**
 * 浏览器里发失败之后，再问一句：**到底是连不上，还是连上了不让读？**
 *
 * `fetch` 失败时抛的永远是同一句 `Failed to fetch` —— 域名解析不了是它，
 * 连接被拒是它，跨域被拦也是它。可这三种的下一步完全不同，混成一句等于没说。
 *
 * 分辨的办法是再发一次 `mode: 'no-cors'`。那种请求浏览器不要求对方点头，
 * 回来的东西读不了（opaque），但**发得出去就说明服务器是活的**：
 *
 *   no-cors 成了  服务器可达，是跨域被拦下了 —— 换中转地址，或者装成 app
 *   no-cors 也败  根本没联系上 —— 地址错了、域名解析不了、或者网不通
 *
 * 只在浏览器直连那条路上问。外壳那条本来就没有跨域一说。
 */
export async function reachable(url) {
  try {
    await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
    return true;
  } catch { return false; }
}

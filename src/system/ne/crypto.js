import { md5 } from '../md5.js';

// 网易云接口的两种加密，照 NeteaseCloudMusicApi（MIT）的 util/crypto.js 写成浏览器版。
//
//   weapi  网页端用的：JSON 先用固定密钥 AES-CBC 一层，再用随机 16 位密钥 AES-CBC 一层；
//          随机密钥倒过来用网易云的公钥做无填充 RSA，得 encSecKey
//   eapi   客户端用的：「网址 + JSON + 两者的 MD5」拼起来，AES-ECB，十六进制大写
//
// 浏览器的 crypto.subtle 只有 CBC 没有 ECB：ECB 一块一块做，每块用全零 IV 的 CBC 加密、
// 取头 16 字节 —— CBC 第一块就是 E(P xor IV)，IV 为零时正好是 E(P)。
// RSA 用 BigInt 做模幂。
//
// 这些常量都是网易云客户端里公开写死的，不是谁的密钥。
// 与原项目逐字节对照过（tests/necrypto.test.mjs），改这里之前先跑那个测试。

const IV = '0102030405060708';
const PRESET = '0CoJUm6Qyw8W8jud';
const EAPI_KEY = 'e82ckenh8dichen8';
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
// 原项目 publicKey 那段 PEM 里的模数（1024 位）与指数
const MODULUS = BigInt('0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7');
const EXPONENT = 65537n;

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

const toB64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

async function cbc(bytes, key, iv) {
  const k = await subtle().importKey('raw', enc.encode(key), { name: 'AES-CBC' }, false, ['encrypt']);
  return new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: enc.encode(iv) }, k, bytes));
}

// AES-128-ECB + PKCS7，给回十六进制大写
async function ecbHex(bytes, key) {
  const pad = 16 - (bytes.length % 16);
  const padded = new Uint8Array(bytes.length + pad);
  padded.set(bytes);
  padded.fill(pad, bytes.length);
  const k = await subtle().importKey('raw', enc.encode(key), { name: 'AES-CBC' }, false, ['encrypt']);
  const zero = new Uint8Array(16);
  const out = new Uint8Array(padded.length);
  for (let i = 0; i < padded.length; i += 16) {
    const c = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: zero }, k, padded.subarray(i, i + 16)));
    out.set(c.subarray(0, 16), i);
  }
  return toHex(out).toUpperCase();
}

function modPow(base, exp, mod) {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

// 无填充 RSA：明文当大端整数，结果补足 256 位十六进制（1024 位密钥）
function rsaNoPad(text) {
  const m = BigInt(`0x${toHex(enc.encode(text)) || '0'}`);
  return modPow(m, EXPONENT, MODULUS).toString(16).padStart(256, '0');
}

export function randomKey() {
  const r = new Uint8Array(16);
  globalThis.crypto.getRandomValues(r);
  return Array.from(r, x => BASE62[x % 62]).join('');
}

/** weapi。secretKey 只在测试里指定（对照原项目时要固定它），平时随机 */
export async function weapi(object, secretKey = randomKey()) {
  const text = JSON.stringify(object);
  const first = toB64(await cbc(enc.encode(text), PRESET, IV));
  const params = toB64(await cbc(enc.encode(first), secretKey, IV));
  return { params, encSecKey: rsaNoPad(secretKey.split('').reverse().join('')) };
}

/** eapi。url 是 /api/... 那一段 */
export async function eapi(url, object) {
  const text = typeof object === 'object' ? JSON.stringify(object) : String(object);
  const digest = md5(`nobody${url}use${text}md5forencrypt`);
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  return { params: await ecbHex(enc.encode(data), EAPI_KEY) };
}

// 游客注册时的设备编号那一段：设备号与一个固定串逐字异或，取 MD5 的 base64
const ID_XOR_KEY = '3go8&$8*3*3h0k(2)2';
export function encodeDeviceId(deviceId) {
  let x = '';
  for (let i = 0; i < deviceId.length; i++) {
    x += String.fromCharCode(deviceId.charCodeAt(i) ^ ID_XOR_KEY.charCodeAt(i % ID_XOR_KEY.length));
  }
  const hex = md5(x);
  const digest = new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));
  return toB64(enc.encode(`${deviceId} ${toB64(digest)}`));
}

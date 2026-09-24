// Cloudflare Worker（worker/netease.js）单测：直接在 Node 里跑它，上游的网易云换成假的。
// 只转发到网易云的域名；Cookie、UA、Referer、国内 IP 照请求设上；Set-Cookie 放进返回体并去掉 Domain；
// CORS；填了来源白名单时别的网站用不了
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT } from './_env.mjs';

const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const worker = (await import('../worker/netease.js')).default;

const upstream = [];
globalThis.fetch = async (url, init) => {
  upstream.push({ url, init });
  const h = new Headers({ 'Content-Type': 'application/json' });
  h.append('Set-Cookie', 'MUSIC_U=abc; Max-Age=100; Domain=.music.163.com; Path=/');
  h.append('Set-Cookie', '__csrf=xyz; Domain=.music.163.com; Path=/');
  return new Response('{"code":200,"x":1}', { status: 200, headers: h });
};
const call = (w, init) => w.fetch(new Request('https://w.example.workers.dev/', init));
const post = (w, job, origin = 'https://phone.example.com') => call(w, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(job),
});

let r = await call(worker, { method: 'OPTIONS', headers: { Origin: 'https://phone.example.com' } });
ok('预检：204，允许这个来源、POST 与 Content-Type', r.status === 204 && r.headers.get('access-control-allow-origin') === 'https://phone.example.com'
  && /POST/.test(r.headers.get('access-control-allow-methods')) && /Content-Type/.test(r.headers.get('access-control-allow-headers')));
r = await call(worker, { method: 'GET' });
let b = await r.json();
ok('GET：报出自己是谁、第几版', b.name === 'mini-phone-netease' && b.version === 2, JSON.stringify(b));

r = await post(worker, { url: 'https://evil.example.com/steal', body: 'a=1' });
ok('目标不是网易云：拒绝，一个请求都不发', r.status === 400 && upstream.length === 0, r.status);
r = await post(worker, { url: 'http://music.163.com/weapi/x', body: 'a=1' });
ok('网易云但不是 https：拒绝', r.status === 400 && upstream.length === 0);
r = await post(worker, { url: 'https://music.163.com.evil.com/x', body: 'a=1' });
ok('长得像网易云的别的域名：拒绝', r.status === 400 && upstream.length === 0);

r = await post(worker, { url: 'https://interface.music.163.com/eapi/cloudsearch/pc', body: 'params=ABC',
  cookie: 'MUSIC_A=guest; os=iPhone OS', ua: 'NeteaseMusic 9.0.90', referer: 'https://music.163.com', ip: '116.25.1.2' });
b = await r.json();
const up = upstream[0];
ok('转发到网易云：POST 表单，正文原样', up?.url === 'https://interface.music.163.com/eapi/cloudsearch/pc' && up.init.method === 'POST'
  && up.init.body === 'params=ABC' && up.init.headers['Content-Type'] === 'application/x-www-form-urlencoded', JSON.stringify(up?.init));
ok('Cookie、UA、Referer 照请求设上', up.init.headers.Cookie === 'MUSIC_A=guest; os=iPhone OS' && up.init.headers['User-Agent'] === 'NeteaseMusic 9.0.90'
  && up.init.headers.Referer === 'https://music.163.com');
ok('国内 IP 放进 X-Real-IP 与 X-Forwarded-For', up.init.headers['X-Real-IP'] === '116.25.1.2' && up.init.headers['X-Forwarded-For'] === '116.25.1.2');
ok('回复原样交回，Set-Cookie 进返回体并去掉 Domain', b.status === 200 && b.body === '{"code":200,"x":1}'
  && b.cookies.length === 2 && b.cookies[0] === 'MUSIC_U=abc; Max-Age=100; Path=/' && !b.cookies.some(c => /Domain/i.test(c)), JSON.stringify(b.cookies));
ok('回复带 CORS 头', r.headers.get('access-control-allow-origin') === 'https://phone.example.com');

upstream.length = 0;
await post(worker, { url: 'https://music.163.com/weapi/x', body: '', ip: '999.1.1.1' });
await post(worker, { url: 'https://music.163.com/weapi/x', body: '', ip: '1.2.3.4; rm -rf' });
ok('不像 IP 的值不设进请求头', upstream.every(u => !u.init.headers['X-Real-IP']), JSON.stringify(upstream.map(u => u.init.headers['X-Real-IP'])));

globalThis.fetch = async () => { throw new Error('network down'); };
r = await post(worker, { url: 'https://music.163.com/weapi/x', body: '' });
b = await r.json();
ok('连不上网易云：返回 502 与原因，不抛', b.status === 502 && /连不上网易云/.test(b.error), JSON.stringify(b));

// 填了来源白名单的那一份
const src = readFileSync(new URL('../worker/netease.js', import.meta.url), 'utf8')
  .replace('const ALLOW_ORIGINS = [];', "const ALLOW_ORIGINS = ['https://phone.example.com'];");
const file = join(OUT, `worker-allow-${Date.now()}.mjs`);
writeFileSync(file, src);
const locked = (await import(file)).default;
globalThis.fetch = async () => new Response('{"code":200}', { status: 200 });
r = await post(locked, { url: 'https://music.163.com/weapi/x', body: '' }, 'https://other.example.com');
ok('填了白名单：别的网站被拒（403）', r.status === 403);
r = await post(locked, { url: 'https://music.163.com/weapi/x', body: '' }, 'https://phone.example.com');
ok('填了白名单：自己的网站照常', r.status === 200 && r.headers.get('access-control-allow-origin') === 'https://phone.example.com');

const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);

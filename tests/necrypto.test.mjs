// 网易云加密层（system/ne/crypto.js）与原项目 NeteaseCloudMusicApi 4.32.0 逐字节一致。
//
// 标准答案在 fixtures/ne-golden.json，是拿原项目自己的 util/crypto.js（crypto-js 与 node-forge）
// 在固定随机密钥下算出来的：weapi 的 params 与 encSecKey、eapi 的 params、游客注册的 username，
// 以及原项目那段公钥 PEM 解析出来的模数。这里只跑本项目的实现，不依赖原项目。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIX } from './_env.mjs';
import { weapi, eapi, encodeDeviceId } from '../src/system/ne/crypto.js';

const G = JSON.parse(readFileSync(join(FIX, 'ne-golden.json'), 'utf8'));
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const src = readFileSync(new URL('../src/system/ne/crypto.js', import.meta.url), 'utf8');
const mod = src.match(/BigInt\('0x0*([0-9a-f]+)'\)/)[1];
ok('写死的公钥模数与原项目 PEM 解析出来的一致', mod === G.modulus && G.exponent === '10001', mod.slice(0, 32));

for (const w of G.weapi) {
  const got = await weapi(w.obj, w.key);
  ok(`weapi params 一致（${JSON.stringify(w.obj).slice(0, 30)}）`, got.params === w.params, `${got.params.slice(0, 40)} / ${w.params.slice(0, 40)}`);
  ok(`weapi encSecKey 一致（密钥 ${w.key}）`, got.encSecKey === w.encSecKey, `${got.encSecKey.slice(0, 40)} / ${w.encSecKey.slice(0, 40)}`);
}
for (const e of G.eapi) {
  const got = await eapi(e.url, e.obj);
  ok(`eapi params 一致（${e.url}）`, got.params === e.params, `${got.params.slice(0, 40)} / ${e.params.slice(0, 40)}`);
}
for (const d of G.device) {
  ok(`游客注册 username 一致（${d.id.slice(0, 8)}…）`, encodeDeviceId(d.id) === d.username, `${encodeDeviceId(d.id)} / ${d.username}`);
}

const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);

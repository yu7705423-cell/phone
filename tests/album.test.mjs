// 角色手机的相册：生成描述、分本子、密码本挡得住、挂真图不会被清理掉。
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });

let calls = [];
await page.route('**/*', async route => {
  const u = route.request().url();
  if (u.startsWith(`${BASE}`)) return route.continue();
  if (!u.includes('/v1/messages') && !u.includes('/chat/completions')) return route.abort();
  const sys = String(route.request().postDataJSON?.()?.system || '');
  calls.push(sys);
  const n = Number((sys.match(/- (\d+) photos/) || [])[1] || 3);
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text:
      JSON.stringify({ photos: Array.from({ length: n }, (_, i) => ({ note: `照片 ${calls.length}-${i}` })) }) }] }) });
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  svc.newChatPreset({ name: 'T', provider: 'anthropic', apiKey: 'k', model: 'm' });
  acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '季怜喻', persona: '人设正文' });
  // 锁屏挡着每一页（见 lock.mjs），这一份测的不是锁，先解开
  (await import('/src/system/theirs.js')).open(a.id);
  return { a: a.id };
});
const go = async route => {
  await page.evaluate(async ([r]) => {
    const n = await import('/src/system/nav.js');
    n.openApp('theirs', r);
    if (r === '/') n.popToRoot();
  }, [route]);
  await page.waitForTimeout(700);
};
const txt = () => page.evaluate(() => document.body.innerText);
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);
const T = fn => page.evaluate(async ([f, id]) => {
  const t = await import('/src/system/theirs.js');
  return (new Function('t', 'id', `return (${f})(t, id)`))(t, id);
}, [fn.toString(), ids.a]);

// ---- 1 生成 ----
await go(`/make/${ids.a}`);
check(/相册/.test(await txt()), '生成页里有相册这一项');
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith('相册'));
  [...row.querySelectorAll('button')].find(b => b.innerText.trim() === '生成').click();
});
await page.waitForTimeout(1300);
check(await T((t, id) => t.photosOf(id).length) === 8, '生成了 8 张');
check(/photos/.test(calls[0]) && /- 8 photos/.test(calls[0]), '按填的张数要的');
check(await T((t, id) => t.photosOf(id).every(p => p.note && !p.imageId)),
  '生成的是描述，没有图 —— 模型手里本来就没有照片');

// ---- 2 主屏与页面 ----
await go(`/home/${ids.a}`);
check(/相册/.test(await txt()) && /8 张/.test(await txt()), '主屏上多了相册一格');
await go(`/album/${ids.a}`);
let body = await txt();
check(/未归类 8/.test(body), '默认在「未归类」这一本里');
check(/照片 1-0/.test(body), '照片列出来了');

// ---- 3 新建一本、把照片挪进去 ----
await page.evaluate(() => {
  [...document.querySelectorAll('.chip')].find(c => c.innerText.trim() === '新建').click();
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  const inp = [...document.querySelectorAll('.overlay input, .sheet input')][0]
    || [...document.querySelectorAll('input')].find(e => e.placeholder === '例如 去年夏天');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, '去年夏天');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '保存')?.click();
});
await page.waitForTimeout(600);
const albums = await T((t, id) => t.albumsOf(id));
check(albums.length === 1 && albums[0].name === '去年夏天', `建了一本（${JSON.stringify(albums)}）`);

const pid = await T((t, id) => t.photosOf(id)[0].id);
await page.evaluate(async ([id, p, a]) => {
  const t = await import('/src/system/theirs.js');
  t.updatePhoto(id, p, { albumId: a });
}, [ids.a, pid, albums[0].id]);
await page.waitForTimeout(400);
check(await T((t, id) => t.inAlbum(id, t.albumsOf(id)[0].id).length) === 1, '挪进去一张');
check(await T((t, id) => t.inAlbum(id, '').length) === 7, '未归类少了一张');

// ---- 4 密码本 ----
await page.evaluate(async ([id, a]) => {
  const t = await import('/src/system/theirs.js');
  t.updateAlbum(id, a, { code: '0412' });
}, [ids.a, albums[0].id]);
await go(`/album/${ids.a}`);
await page.evaluate(() => {
  [...document.querySelectorAll('.chip')].find(c => c.innerText.includes('去年夏天')).click();
});
await page.waitForTimeout(500);
body = await txt();
check(/这一本设了密码/.test(body), '密码本挡住了');
check(!/照片 1-0/.test(body), '挡住的时候看不到里面的照片');
check(/不是加密/.test(body), '如实写明这不是加密');

const typeCode = async v => page.evaluate(([x]) => {
  const inp = [...document.querySelectorAll('input[type="password"]')][0];
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, x);
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}, [v]);
await typeCode('9999');
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '打开')?.click());
await page.waitForTimeout(600);
check(/这一本设了密码/.test(await txt()), '密码不对打不开');
await typeCode('0412');
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '打开')?.click());
await page.waitForTimeout(600);
check(/照片 1-0/.test(await txt()), '密码对了打得开');

// 刷新之后重新锁上（和锁屏一个道理，不落库）
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
check(!await T((t, id) => t.albumOpen(id, t.albumsOf(id)[0].id)), '刷新之后密码本重新锁上');
// 手机那道锁同样不落库，刷新之后也回来了。这一份测的不是它，解开继续
await T((t, id) => t.open(id));

// ---- 5 删本子不删照片 ----
const before = await T((t, id) => t.photosOf(id).length);
await page.evaluate(async ([id]) => {
  const t = await import('/src/system/theirs.js');
  t.removeAlbum(id, t.albumsOf(id)[0].id);
}, [ids.a]);
await page.waitForTimeout(400);
check(await T((t, id) => t.photosOf(id).length) === before, '删本子不删照片');
check(await T((t, id) => t.inAlbum(id, '').length) === before, '里面那张退回了未归类');

// ---- 6 挂了真图之后，「清理无引用图片」不能把它删掉 ----
const kept = await page.evaluate(async ([id]) => {
  const db = await import('/src/system/db/index.js');
  const t = await import('/src/system/theirs.js');
  const purge = await import('/src/system/purge.js');
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  // 直接塞一条 image 记录，绕开压缩（那要真的图才解得开）
  const imgId = 'img_test_1';
  await db.images.putRaw(imgId, blob, {});
  t.updatePhoto(id, t.photosOf(id)[0].id, { imageId: imgId });
  const orphans = purge.orphanImageIds();
  return { orphan: orphans.includes(imgId), has: db.images.has(imgId) };
}, [ids.a]);
check(kept.has && !kept.orphan,
  `相册里挂的真图不算无引用（${JSON.stringify(kept)}）`);

// ---- 7 备份带得走 ----
const rt = await page.evaluate(async ([id]) => {
  const t = await import('/src/system/theirs.js');
  const b = await import('/src/system/backup.js');
  const db = await import('/src/system/db/index.js');
  t.addAlbum(id, { name: '私密', code: '1111' });
  const blob = await b.build();
  db.phones.all().forEach(r => db.phones.remove(r.id));
  await b.restore(blob);
  return { photos: t.photosOf(id).length, albums: t.albumsOf(id).length,
    code: t.albumsOf(id)[0]?.code };
}, [ids.a]);
check(rt.photos === before && rt.albums === 1 && rt.code === '1111',
  `备份来回一趟，照片与相册都在（${JSON.stringify(rt)}）`);

// ---- 8 角色自己存图：默认关着 ----
check(!await T((t, id) => t.keepOn(id)), '「角色自己存」默认关着');
const capOff = await page.evaluate(async ([id]) => {
  const db = await import('/src/system/db/index.js');
  const caps = await import('/src/system/ai/capabilities.js');
  const char = db.characters.get(id);
  return caps.CAPS.find(c => c.id === 'keepphoto').on({ char, msgs: [], settings: db.settings.get() });
}, [ids.a]);
check(!capOff, '关着的时候提示词里根本没有这一条');

await go(`/album/${ids.a}`);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.list-item')]
    .find(e => e.innerText.startsWith('允许该角色在对话中存照片'));
  row.querySelector('.switch, input[type="checkbox"], button')?.click();
});
await page.waitForTimeout(500);
check(await T((t, id) => t.keepOn(id)), '开关打得开');
const capOn = await page.evaluate(async ([id]) => {
  const db = await import('/src/system/db/index.js');
  const caps = await import('/src/system/ai/capabilities.js');
  return caps.CAPS.find(c => c.id === 'keepphoto').on({ char: db.characters.get(id) });
}, [ids.a]);
check(capOn, '开了之后那一条能力才出现');

// ---- 9 回复里那一行：存进相册，只留一行提示，不占气泡 ----
const kept2 = await page.evaluate(async ([id]) => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const r = await import('/src/system/ai/reply.js');
  const t = await import('/src/system/theirs.js');
  const me = acc.roots()[0];
  const chat = db.chats.create({ characterIds: [id], personaId: me.id, lastMessageAt: Date.now() });
  const before = t.photosOf(id).length;
  const parts = r.splitReply('刚拍到了\n[存图：窗外那棵树]\n你看');
  const kinds = parts.map(p => p.type);
  // 真的落一遍
  const made = [];
  for (const p of parts) {
    const m = await r.materialize(p, { chatId: chat.id, role: 'char', createdAt: Date.now() },
      db.characters.get(id));
    if (m) made.push({ kind: m.kind, content: m.content });
  }
  return { kinds, before, after: t.photosOf(id).length,
    note: t.photosOf(id)[0]?.note, made };
}, [ids.a]).catch(e => ({ err: String(e.message || e) }));
if (kept2.err) {
  check(false, `落一遍那一步跑不起来：${kept2.err}`);
} else {
  check(kept2.kinds.includes('keep'), `[存图：…] 解析成了一个动作：${JSON.stringify(kept2.kinds)}`);
  check(kept2.after === kept2.before + 1, '存进相册了');
  check(kept2.note === '窗外那棵树', `存的是那一句：${kept2.note}`);
  check(kept2.made.some(m => m.kind === 'notice' && /存了一张照片/.test(m.content)),
    '对话里只留一行提示，不占气泡');
  check(!kept2.made.some(m => /存图/.test(m.content || '')), '标记本身没被当正文发出去');
}

// ---- 10 存的是用户刚发过来的那张图 ----
const got = await page.evaluate(async ([id]) => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const r = await import('/src/system/ai/reply.js');
  const t = await import('/src/system/theirs.js');
  const me = acc.roots()[0];
  const chat = db.chats.create({ characterIds: [id], personaId: me.id, lastMessageAt: Date.now() });
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  await db.images.putRaw('img_user_1', blob, {});

  const out = {};
  const run = async raw => {
    window.__turn = 't' + Math.random().toString(36).slice(2);   // 一次生成算一轮
    const parts = r.splitReply(raw);
    const made = [];
    for (const p of parts) {
      const m = await r.materialize(p,
        { chatId: chat.id, role: 'char', authorId: id, turnId: window.__turn, status: 'done' },
        db.characters.get(id));
      if (m) made.push({ kind: m.kind, content: m.content });
    }
    return made;
  };

  // 甲：用户刚发了一张合照，角色只留下其中一部分
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'image',
    imageId: 'img_user_1', content: '', status: 'done' });
  out.made = await run('[存图：把旁边那些人切掉，只留你]');
  const p1 = t.photosOf(id)[0];
  out.first = { note: p1.note, imageId: p1.imageId, from: p1.from };

  // 乙：角色自己那边又存了一张，这一次没有新照片过来
  //     —— 上一条已经被自己的消息隔开了，不该再把那张翻出来
  out.made2 = await run('[存图：路上那只猫]');
  const p2 = t.photosOf(id)[0];
  out.second = { note: p2.note, imageId: p2.imageId, from: p2.from };

  // 丙：用户再发一张，又能接上
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text',
    content: '这张呢', status: 'done' });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'image',
    imageId: 'img_user_1', content: '', status: 'done' });
  await run('[存图：这张你笑得好看]');
  const p3 = t.photosOf(id)[0];
  out.third = { note: p3.note, imageId: p3.imageId, from: p3.from };
  return out;
}, [ids.a]);

check(got.first.imageId === 'img_user_1' && got.first.from === 'you',
  `用户刚发的那张接上了（${JSON.stringify(got.first)}）`);
check(got.first.note === '把旁边那些人切掉，只留你', '描述是角色自己写的那一句');
check(got.made.some(m => /把这张照片存了下来/.test(m.content)),
  `提示行写的是「这张」而不是泛指：${JSON.stringify(got.made)}`);
check(!got.second.imageId && !got.second.from,
  `隔了一条自己的消息之后就不再翻旧图（${JSON.stringify(got.second)}）`);
check(got.third.imageId === 'img_user_1' && got.third.from === 'you',
  '用户再发一张又接得上（中间夹一句文字也认）');

// 相册里标出来
await go(`/album/${ids.a}`);
check(/你发的/.test(await txt()), '相册里标明了哪张是你发的');
check(/把旁边那些人切掉/.test(await txt()), '角色自己写的那句描述显示出来了');

await go(`/album/${ids.a}`);
await page.screenshot({ path: `${OUT}/album.png`, fullPage: true });

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);

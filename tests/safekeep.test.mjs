// 防丢：备份提醒、持久存储、备份到 GitHub（一次一个提交、图片只传新增的、删掉的跟着删、
// 公开仓库拒绝、令牌不进备份）、从 GitHub 恢复
import { BASE, OUT, EXE, chromium, PNG_B64 } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });

// ---- 一个假的 GitHub：只实现用到的那几个接口 ----
const git = { blobs: new Map(), trees: new Map(), commits: new Map(), ref: null, private: true, n: 0, calls: [] };
const sha = () => `s${(++git.n).toString(16).padStart(8, '0')}`;
const treeOf = sh => git.trees.get(sh) || new Map();
await ctx.route('https://api.github.com/**', async route => {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const m = req.method();
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const J = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
  git.calls.push(`${m} ${p}`);
  if (req.headers().authorization !== 'Bearer tok-123') return J({ message: 'Bad credentials' }, 401);
  if (p === '/repos/me/bk' && m === 'GET') return J({ private: git.private, default_branch: 'main' });
  if (p === '/repos/me/bk/git/ref/heads/main') return git.ref ? J({ object: { sha: git.ref } }) : J({ message: 'Git Repository is empty.' }, 409);
  if (p.startsWith('/repos/me/bk/contents/') && m === 'PUT') {
    const path = decodeURIComponent(p.slice('/repos/me/bk/contents/'.length));
    const b = sha(); git.blobs.set(b, body.content);
    const t = sha(); git.trees.set(t, new Map([[path, b]]));
    const c = sha(); git.commits.set(c, { tree: t, parents: [] });
    git.ref = c;
    return J({ commit: { sha: c } }, 201);
  }
  let mm;
  if ((mm = p.match(/^\/repos\/me\/bk\/git\/commits\/(\w+)$/)) && m === 'GET') {
    const c = git.commits.get(mm[1]);
    return J({ sha: mm[1], tree: { sha: c.tree }, committer: { date: '2026-01-01T00:00:00Z' } });
  }
  if ((mm = p.match(/^\/repos\/me\/bk\/git\/trees\/(\w+)$/)) && m === 'GET') {
    return J({ tree: [...treeOf(mm[1]).entries()].map(([path, s]) => ({ path, sha: s, type: 'blob' })) });
  }
  if (p === '/repos/me/bk/git/blobs' && m === 'POST') {
    const b = sha();
    git.blobs.set(b, body.encoding === 'base64' ? body.content : Buffer.from(body.content, 'utf8').toString('base64'));
    return J({ sha: b }, 201);
  }
  if ((mm = p.match(/^\/repos\/me\/bk\/git\/blobs\/(\w+)$/)) && m === 'GET') {
    return J({ content: git.blobs.get(mm[1]), encoding: 'base64' });
  }
  if (p === '/repos/me/bk/git/trees' && m === 'POST') {
    const next = new Map(treeOf(body.base_tree));
    body.tree.forEach(e => { if (e.sha === null) next.delete(e.path); else next.set(e.path, e.sha); });
    const t = sha(); git.trees.set(t, next);
    return J({ sha: t }, 201);
  }
  if (p === '/repos/me/bk/git/commits' && m === 'POST') {
    const c = sha(); git.commits.set(c, { tree: body.tree, parents: body.parents, message: body.message });
    return J({ sha: c }, 201);
  }
  if (p === '/repos/me/bk/git/refs/heads/main' && m === 'PATCH') { git.ref = body.sha; return J({ object: { sha: body.sha } }); }
  return J({ message: 'Not Found' }, 404);
});

const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async (png) => {
  const db = (await import('/src/system/db/index.js'));
  const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
  const img1 = await db.images.put(new File([bytes], 'a.png', { type: 'image/png' }));
  const ch = db.characters.create({ name: '小林', persona: '花店店员。', avatar: img1 });
  const chat = db.chats.create({ characterIds: [ch.id], personaId: 'me', title: '' });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '要记住的一句话', status: 'done', createdAt: Date.now() - 20 * 86400000 });
  return { ch: ch.id, chat: chat.id, img1 };
}, PNG_B64);

// ---- 一、提醒与持久存储 ----
const keep = await page.evaluate(async () => {
  const k = (await import('/src/system/safekeep.js'));
  const n = (await import('/src/system/notify.js'));
  const before = n.notifications.get().items.length;
  k.tick(); k.tick();
  const got = n.notifications.get().items.slice(0, n.notifications.get().items.length - before).map(x => x.body);
  return { days: k.daysSince(), got, persisted: await k.persisted(), remind: k.remindDays() };
});
ok('从没备份过：按最早那条消息算，20 天', keep.days === 20, JSON.stringify(keep));
ok('超过默认的 7 天：提醒一次，同一天不再提醒', keep.got.length === 1 && /尚未备份过/.test(keep.got[0]), JSON.stringify(keep.got));
ok('持久存储的状态读得到', keep.persisted === true || keep.persisted === false, String(keep.persisted));

// ---- 二、公开仓库拒绝 ----
git.private = false;
const pub = await page.evaluate(async () => {
  const g = (await import('/src/system/ghbackup.js'));
  g.setConfig({ token: 'tok-123', repo: 'https://github.com/me/bk', images: true });
  try { await g.upload(); return 'uploaded'; } catch (e) { return e.message; }
});
ok('仓库地址整段粘进来也认得；公开仓库直接拒绝', /公开的/.test(pub) && git.blobs.size === 0, pub);
git.private = true;

// ---- 三、第一次备份 ----
const up1 = await page.evaluate(async () => {
  const g = (await import('/src/system/ghbackup.js'));
  const k = (await import('/src/system/safekeep.js'));
  const r = await g.upload();
  return { r, last: k.lastBackupAt(), cfg: g.configOf() };
});
const tree1 = treeOf(git.commits.get(git.ref).tree);
const json1 = Buffer.from(git.blobs.get(tree1.get('phone-backup/backup.json')) || '', 'base64').toString('utf8');
ok('空仓库：先放一个说明文件让分支存在，再提交备份', tree1.has('phone-backup/README.md') && tree1.has('phone-backup/backup.json'), [...tree1.keys()].join(', '));
ok('图片一张一个文件', [...tree1.keys()].some(p => p.startsWith(`phone-backup/images/${ids.img1}.`)), [...tree1.keys()].join(', '));
ok('数据里有那句话', json1.includes('要记住的一句话'));
ok('令牌不在上传的数据里', !json1.includes('tok-123'));
ok('一次备份是一次提交，父提交是上一次', git.commits.get(git.ref).parents.length === 1 && /^备份 /.test(git.commits.get(git.ref).message));
ok('记下了备份时刻', up1.last > 0 && up1.cfg.lastAt === up1.last && !up1.cfg.lastError, JSON.stringify(up1));

// ---- 四、再备份：图片不再传；删掉的图片跟着删 ----
const blobsBefore = git.blobs.size;
const up2 = await page.evaluate(async () => (await (await import('/src/system/ghbackup.js')).upload()));
ok('第二次备份：图片不再重传（只传数据那一份）', up2.added === 0 && git.blobs.size === blobsBefore + 1, JSON.stringify(up2));
const img2 = await page.evaluate(async (o) => {
  const db = (await import('/src/system/db/index.js'));
  const g = (await import('/src/system/ghbackup.js'));
  db.images.remove(o.img1);
  db.characters.update(o.ch, { avatar: '' });
  return g.upload();
}, ids);
const tree3 = treeOf(git.commits.get(git.ref).tree);
ok('本机删掉的图片，新的提交里一并删去', img2.removed === 1 && ![...tree3.keys()].some(p => p.includes('/images/')), JSON.stringify(img2));

// ---- 五、导出的文件同样不带令牌 ----
const local = await page.evaluate(async () => {
  const b = (await import('/src/system/backup.js'));
  return (await b.build({ media: false, keys: false }).then(x => x.text())).includes('tok-123');
});
ok('本地导出的备份也不带 GitHub 令牌', local === false);

// ---- 六、从 GitHub 恢复 ----
const back = await page.evaluate(async (o) => {
  const db = (await import('/src/system/db/index.js'));
  const g = (await import('/src/system/ghbackup.js'));
  db.characters.remove(o.ch);
  db.messages.removeWhere(m => m.chatId === o.chat);
  const r = await g.restoreLatest();
  await new Promise(res => setTimeout(res, 300));
  return {
    r, name: db.characters.get(o.ch)?.name,
    said: db.messages.all().some(m => m.content === '要记住的一句话'),
    token: g.configOf().token,
  };
}, ids);
ok('恢复回来：角色与消息都在', back.name === '小林' && back.said, JSON.stringify(back));
ok('恢复之后令牌与仓库设置还在，不用重填', back.token === 'tok-123');

// ---- 七、令牌错了说清楚 ----
const bad = await page.evaluate(async () => {
  const g = (await import('/src/system/ghbackup.js'));
  g.setConfig({ token: 'wrong' });
  try { await g.test(); return 'ok'; } catch (e) { return e.message; } finally { g.setConfig({ token: 'tok-123' }); }
});
ok('令牌不对：说「令牌无效」', /令牌无效/.test(bad), bad);

// ---- 八、界面 ----
await page.evaluate(async () => {
  const n = await import('/src/system/nav.js');
  n.unlock(); n.openApp('settings', '/storage');
});
await page.waitForTimeout(800);
const st = await page.locator('.page').last().innerText();
ok('存储与备份页最上面是「防丢」：上次备份、不自动清理、提醒、GitHub', ['防丢', '上次备份', '浏览器不自动清理', '备份提醒', '备份到 GitHub'].every(k => st.includes(k)), st.slice(0, 300));
await page.screenshot({ path: `${OUT}/safekeep-storage.png` });
await page.locator('.list-item', { hasText: '备份到 GitHub' }).click();
await page.waitForTimeout(500);
const gp = await page.locator('.page').last().innerText();
ok('GitHub 页：仓库、令牌、包含、自动备份、立即备份、恢复', ['仓库', '令牌', '音频与视频', '自动备份', '立即备份', '从 GitHub 恢复'].every(k => gp.includes(k)), gp.slice(0, 300));
await page.screenshot({ path: `${OUT}/safekeep-github.png` });

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const badN = R.filter(r => !r.pass).length;
console.log(`\n${R.length - badN}/${R.length} 通过`);
process.exit(badN ? 1 : 0);

import { settings } from './db/index.js';
import { images } from './db/images.js';
import { files } from './db/files.js';
import * as backup from './backup.js';
import { zip } from './zip.js';
import { markBackedUp } from './safekeep.js';
import { notify } from './notify.js';

/**
 * 备份到 GitHub。见 ARCHITECTURE 4.165
 *
 * 路线图 N4 一直卡在「要一个后端」上。其实不用：GitHub 的接口允许网页直接调
 *（带 CORS），一个私有仓库加一个只能写这个仓库的令牌，就是一个不会丢的备份地。
 *
 * ---- 存成什么样 ----
 *
 *   <目录>/backup.json      角色卡、世界书、记忆、会话、设置（不含密钥）
 *   <目录>/images/<id>.<ext> 图片，一张一个文件
 *   <目录>/files/<id>.<ext>  音频与视频（默认不传，见 media）
 *
 * 和导出的 ZIP 是同一套文件名，恢复时拼回一个 ZIP 交给 backup.restore，
 * 不另写一套恢复逻辑。
 *
 * **每次备份是一次提交**（Git Data 接口：先传 blob，再拼一棵树，再提交）。
 * 仓库的提交历史就是版本历史：哪天的备份都找得回来。
 * 图片的 id 就是内容，传过一次就不再传；删掉的图片在新的树里一并删去。
 *
 * **只认私有仓库。** 备份里是全部聊天记录，传进一个公开仓库等于公开发布。
 * 每次上传之前都查一遍，公开的直接拒绝。
 *
 * 令牌存在设置里，**不进任何备份**（backup.build 那边剥掉，这里上传的也是剥过的）。
 */

const API = 'https://api.github.com';
// GitHub 单个文件的上限是 100 MB，留一点余量
const MAX_BLOB = 95 * 1024 * 1024;

export function configOf() {
  const c = settings.get().githubBackup || {};
  return {
    token: String(c.token || '').trim(),
    repo: String(c.repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, ''),
    branch: String(c.branch || '').trim(),
    dir: String(c.dir || 'phone-backup').trim().replace(/^\/+|\/+$/g, '') || 'phone-backup',
    images: c.images !== false,
    media: c.media === true,
    autoDays: Math.max(0, Math.round(Number(c.autoDays) || 0)),
    lastAt: Number(c.lastAt) || 0,
    lastError: String(c.lastError || ''),
  };
}

export function setConfig(patch) {
  settings.set({ githubBackup: { ...(settings.get().githubBackup || {}), ...patch } });
}

export const ready = () => { const c = configOf(); return !!(c.token && /^[\w.-]+\/[\w.-]+$/.test(c.repo)); };

async function gh(path, { method = 'GET', body, token = configOf().token } = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`连不上 GitHub：${err.message || err}`);
  }
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json())?.message || ''; } catch { /* 不是 JSON */ }
    const e = new Error(res.status === 401 ? '令牌无效或已过期'
      : res.status === 403 ? `令牌没有这个仓库的写入权限${msg ? `（${msg}）` : ''}`
        : res.status === 404 ? '找不到这个仓库。请检查仓库名，或令牌是否有权访问它'
          : `GitHub ${res.status}${msg ? `：${msg}` : ''}`);
    e.status = res.status;
    e.detail = msg;
    throw e;
  }
  return res.status === 204 ? null : res.json();
}

const b64OfText = text => {
  const bytes = new TextEncoder().encode(text);
  return b64OfBytes(bytes);
};
function b64OfBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const bytesOfB64 = b64 => {
  const s = atob(String(b64 || '').replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

/** 仓库信息，顺带确认是私有的 */
async function repoInfo(c) {
  const r = await gh(`/repos/${c.repo}`);
  if (!r.private) throw new Error('这个仓库是公开的。备份里是全部聊天记录，只能存进私有仓库');
  return { branch: c.branch || r.default_branch || 'main' };
}

/** 分支最新的那次提交。仓库还是空的就先放一个说明文件，让分支存在 */
async function head(c, branch) {
  try {
    const ref = await gh(`/repos/${c.repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    return ref.object.sha;
  } catch (err) {
    if (err.status !== 404 && err.status !== 409) throw err;
    await gh(`/repos/${c.repo}/contents/${c.dir}/README.md`, {
      method: 'PUT',
      body: {
        message: 'Eira 备份',
        branch,
        content: b64OfText('Eira 的备份。backup.json 是数据，images 与 files 是图片与音视频。\n'
          + '在「设置 - 存储与备份 - 备份到 GitHub」里恢复。\n'),
      },
    });
    const ref = await gh(`/repos/${c.repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    return ref.object.sha;
  }
}

/** 测连接：令牌能不能读这个仓库、是不是私有的 */
export async function test() {
  const c = configOf();
  if (!ready()) throw new Error('请先填写令牌与仓库');
  const { branch } = await repoInfo(c);
  return { branch };
}

let running = false;
export const isRunning = () => running;

/**
 * 备份一次。onProgress(已完成, 总数, 这一步在做什么)
 * 返回 { commit, added, removed, skipped, bytes }
 */
export async function upload({ onProgress } = {}) {
  if (running) throw new Error('上一次备份还没结束');
  const c = configOf();
  if (!ready()) throw new Error('请先填写令牌与仓库');
  running = true;
  try {
    const { branch } = await repoInfo(c);
    const parent = await head(c, branch);
    const commit = await gh(`/repos/${c.repo}/git/commits/${parent}`);
    const tree = await gh(`/repos/${c.repo}/git/trees/${commit.tree.sha}?recursive=1`);
    const have = new Map((tree.tree || []).filter(x => x.type === 'blob').map(x => [x.path, x.sha]));

    // 要传的：数据一份，加上还没传过的图片与音视频
    const want = [];
    if (c.images) {
      for (const id of images.ids()) want.push({ kind: 'images', id, get: () => images.blob(id) });
    }
    if (c.media) {
      for (const id of files.ids()) want.push({ kind: 'files', id, get: () => files.blob(id) });
    }
    const total = want.length + 1;
    let done = 0;
    const tick = what => { done += 1; onProgress && onProgress(done, total, what); };

    const entries = [];
    const keep = new Set();
    const json = await backup.build({ media: false, keys: false });
    const jsonBlob = await gh(`/repos/${c.repo}/git/blobs`, {
      method: 'POST', body: { content: await json.text(), encoding: 'utf-8' },
    });
    entries.push({ path: `${c.dir}/backup.json`, mode: '100644', type: 'blob', sha: jsonBlob.sha });
    keep.add(`${c.dir}/backup.json`);
    tick('数据');

    let added = 0, skipped = 0, bytes = 0;
    for (const w of want) {
      const blob = await w.get();
      if (!blob) { tick(w.kind); continue; }
      const path = `${c.dir}/${w.kind}/${w.id}.${backup.extOf(blob.type, 'bin')}`;
      keep.add(path);
      if (have.has(path)) { tick(w.kind); continue; }
      if (blob.size > MAX_BLOB) { skipped += 1; tick(w.kind); continue; }
      const b = await gh(`/repos/${c.repo}/git/blobs`, {
        method: 'POST', body: { content: b64OfBytes(new Uint8Array(await blob.arrayBuffer())), encoding: 'base64' },
      });
      entries.push({ path, mode: '100644', type: 'blob', sha: b.sha });
      added += 1;
      bytes += blob.size;
      tick(w.kind);
    }
    // 本机已经删掉的图片与音视频，在新的树里一并删去。没开的那一类不动
    let removed = 0;
    for (const path of have.keys()) {
      const m = path.match(new RegExp(`^${c.dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(images|files)/`));
      if (!m || keep.has(path)) continue;
      if ((m[1] === 'images' && !c.images) || (m[1] === 'files' && !c.media)) continue;
      entries.push({ path, mode: '100644', type: 'blob', sha: null });
      removed += 1;
    }

    const next = await gh(`/repos/${c.repo}/git/trees`, {
      method: 'POST', body: { base_tree: commit.tree.sha, tree: entries },
    });
    const made = await gh(`/repos/${c.repo}/git/commits`, {
      method: 'POST',
      body: { message: `备份 ${new Date().toLocaleString('zh-CN', { hour12: false })}`, tree: next.sha, parents: [parent] },
    });
    await gh(`/repos/${c.repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH', body: { sha: made.sha },
    });
    const at = Date.now();
    setConfig({ lastAt: at, lastError: '' });
    markBackedUp(at);
    return { commit: made.sha, added, removed, skipped, bytes };
  } catch (err) {
    setConfig({ lastError: String(err.message || err) });
    throw err;
  } finally {
    running = false;
  }
}

/**
 * 从 GitHub 恢复最新一次备份。**会覆盖本机数据**，界面上要先确认。
 * 拼回一个 ZIP 交给 backup.restore —— 读包、校验、写库都是那一套。
 * 令牌与仓库设置在恢复之后放回去：备份里不带它们，不放回去就得重填一遍。
 */
export async function restoreLatest({ onProgress } = {}) {
  const c = configOf();
  if (!ready()) throw new Error('请先填写令牌与仓库');
  const { branch } = await repoInfo(c);
  const parent = await head(c, branch);
  const commit = await gh(`/repos/${c.repo}/git/commits/${parent}`);
  const tree = await gh(`/repos/${c.repo}/git/trees/${commit.tree.sha}?recursive=1`);
  const prefix = `${c.dir}/`;
  const mine = (tree.tree || []).filter(x => x.type === 'blob' && x.path.startsWith(prefix)
    && (x.path === `${prefix}backup.json` || /\/(images|files)\//.test(x.path)));
  if (!mine.some(x => x.path === `${prefix}backup.json`)) throw new Error('这个仓库里还没有备份');

  const entries = [];
  let done = 0;
  for (const x of mine) {
    const b = await gh(`/repos/${c.repo}/git/blobs/${x.sha}`);
    const name = x.path.slice(prefix.length);
    const bytes = bytesOfB64(b.content);
    entries.push(name === 'backup.json'
      ? { name, text: new TextDecoder().decode(bytes) }
      : { name, blob: new Blob([bytes]) });
    done += 1;
    onProgress && onProgress(done / (mine.length + 1) * 0.5);
  }
  const pack = await zip(entries);
  const keepCfg = settings.get().githubBackup;
  await backup.restore(new File([pack], 'github-backup.zip', { type: 'application/zip' }),
    { onProgress: p => onProgress && onProgress(0.5 + p * 0.5) });
  settings.set({ githubBackup: keepCfg });
  return { files: mine.length, at: commit.committer?.date || '' };
}

/** 挂在 proactive.tick 上：开了自动备份、到了间隔，就在后台备份一次。失败了发一条通知 */
export function tick(now = Date.now()) {
  const c = configOf();
  if (!c.autoDays || !ready() || running) return;
  if (c.lastAt && now - c.lastAt < c.autoDays * 86400000) return;
  // 失败之后别每一轮都重试：一天最多试一次
  const tried = Number(settings.get().githubBackup?.triedAt) || 0;
  if (now - tried < 86400000) return;
  setConfig({ triedAt: now });
  upload().catch(err => notify({
    title: '备份到 GitHub 失败', icon: 'download', appId: 'settings', payload: { route: '/github' },
    body: String(err.message || err),
  }));
}

import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Switch, Button, Icon, NumberInput,
         Spinner, toast, confirm } from '../../ui/index.js';

// 备份到 GitHub。逻辑在 system/ghbackup.js，这里只是填写与按钮。

const { db, nav } = phone;

export function GitHubPage() {
  useStore(db.settings.store);
  const [busy, setBusy] = useState('');
  const [prog, setProg] = useState('');
  const gh = phone.ghbackup;
  const c = gh.configOf();
  const set = patch => gh.setConfig(patch);

  const run = async (label, fn) => {
    setBusy(label);
    try { await fn(); }
    catch (err) { toast(String(err.message || err), 'error', 6000); }
    finally { setBusy(''); setProg(''); }
  };

  const test = () => run('test', async () => {
    const r = await gh.test();
    toast(`连接成功，私有仓库，分支 ${r.branch}`, 'ok', 4000);
  });
  const upload = () => run('upload', async () => {
    const r = await gh.upload({ onProgress: (d, t, what) => setProg(`${d} / ${t}${what ? ` · ${what}` : ''}`) });
    toast(`已备份。新传 ${r.added} 个文件${r.removed ? `，删去 ${r.removed} 个` : ''}`
      + (r.skipped ? `，${r.skipped} 个超过 95 MB 未上传` : ''), 'ok', 5000);
  });
  const restore = () => run('restore', async () => {
    if (!await confirm({
      title: '从 GitHub 恢复', danger: true, okText: '恢复',
      message: '取回仓库里最新的一次备份，覆盖这台设备上的全部数据。当前数据不会保留，建议先备份一次。',
    })) return;
    const r = await gh.restoreLatest({ onProgress: p => setProg(`${Math.round(p * 100)}%`) });
    toast(`已恢复，共 ${r.files} 个文件`, 'ok', 5000);
  });

  return html`
    <${Page} title="备份到 GitHub" onBack=${nav.pop}>
      <div class="hint-box">
        备份存进你自己的一个私有仓库。每次备份是一次提交，提交历史即版本历史，
        任意一次都可以在 GitHub 上找回。仓库必须是私有的，公开仓库会被拒绝。
      </div>

      <div class="pad-x">
        <${Field} label="仓库" desc="格式为「用户名/仓库名」。请先在 GitHub 上新建一个私有仓库">
          <${Input} value=${c.repo} placeholder="yourname/phone-backup" onInput=${v => set({ repo: v })}/>
        <//>
        <${Field} label="令牌" desc="在 GitHub 的 Settings - Developer settings - Fine-grained tokens 中创建，只授权这一个仓库的 Contents 读写。令牌只存在这台设备上，不写入任何备份">
          <${Input} type="password" value=${c.token} placeholder="github_pat_…" onInput=${v => set({ token: v })}/>
        <//>
        <${Field} label="分支" desc="留空使用仓库的默认分支">
          <${Input} value=${c.branch} placeholder="main" onInput=${v => set({ branch: v })}/>
        <//>
        <${Field} label="目录" desc="备份放在仓库里的哪个目录下">
          <${Input} value=${c.dir} onInput=${v => set({ dir: v })}/>
        <//>
      </div>

      <${List} title="包含">
        <${ListItem} title="图片" multiline
          subtitle="头像、照片、表情包与生成的图片。每张只传一次，之后的备份只传新增的"
          right=${html`<${Switch} checked=${c.images} onChange=${v => set({ images: v })}/>`}/>
        <${ListItem} title="音频与视频" multiline
          subtitle=${`语音、通话录音、短视频与书籍正文。当前共 ${phone.backup.sizeText(phone.files.totalBytes())}，单个超过 95 MB 的不上传`}
          right=${html`<${Switch} checked=${c.media} onChange=${v => set({ media: v })}/>`}/>
      <//>

      <${List} title="自动备份">
        <${ListItem} title="间隔" multiline
          subtitle=${c.autoDays
            ? `应用打开期间，距上次备份超过 ${c.autoDays} 天时在后台备份一次。失败时发一条通知，一天最多重试一次`
            : '已关闭，只在点击时备份。填写天数后开启'}/>
        <div class="pad-x pad-b">
          <${NumberInput} value=${c.autoDays} min=${0} unit="天" placeholder="0"
            onChange=${v => set({ autoDays: v })}/>
        </div>
      <//>

      <${List}>
        <${ListItem} title="测试连接" arrow
          left=${busy === 'test' ? html`<${Spinner} size=${16}/>` : html`<${Icon} name="signal" size=${18}/>`}
          onClick=${() => !busy && test()}/>
        <${ListItem} title=${busy === 'upload' ? `正在备份 ${prog}` : '立即备份'} arrow multiline
          subtitle=${c.lastAt ? `上次成功：${new Date(c.lastAt).toLocaleString('zh-CN', { hour12: false })}` : '尚未备份过'}
          left=${busy === 'upload' ? html`<${Spinner} size=${16}/>` : html`<${Icon} name="upload" size=${18}/>`}
          onClick=${() => !busy && upload()}/>
        <${ListItem} title=${busy === 'restore' ? `正在恢复 ${prog}` : '从 GitHub 恢复'} arrow danger multiline
          subtitle="取回最新的一次备份，覆盖这台设备上的全部数据"
          left=${busy === 'restore' ? html`<${Spinner} size=${16}/>` : html`<${Icon} name="download" size=${18}/>`}
          onClick=${() => !busy && restore()}/>
      <//>
      ${c.lastError ? html`<div class="settings-foot">上次失败：${c.lastError}</div>` : null}
    <//>`;
}

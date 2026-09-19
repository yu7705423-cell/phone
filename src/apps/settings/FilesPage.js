import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, Button, EmptyState, toast, confirm } from '../../ui/index.js';

const { db, nav, purge, backup } = phone;

// 「占地方的文件」。
//
// 存储页原来只给一个总数「音频与视频 X GB」，看不到是哪几个、各多大、
// 还在不在用 —— 想清理都不知道从哪下手。这一页把它们摊开，大的在前。
//
// **图片不在这一页。** 图片存进来的时候就转成 WebP、长边压到 1280 了，
// 那边挤不出什么；这一页里的是原样存的音视频、字体与书的正文。
//
// 每一行写清楚三件事：多大、被谁用着、删了会怎样。
// 没人引用的那些单独标出来 —— 那是最安全的一批。

const ICONS = {
  video: 'film', song: 'music', voice: 'mic',
  book: 'book', font: 'notes', sound: 'bell',
};

export function FilesPage() {
  useStore(db.settings.store);
  useStore(db.videos.store);
  useStore(db.songs.store);
  const [tick, setTick] = useState(0);

  const rows = purge.fileReport();
  const orphans = rows.filter(r => !r.use);
  const orphanBytes = orphans.reduce((n, r) => n + (r.bytes || 0), 0);
  const total = rows.reduce((n, r) => n + (r.bytes || 0), 0);

  const drop = async row => {
    const used = row.use;
    if (!await confirm({
      title: '删除这个文件', danger: true, okText: '删除',
      message: used
        ? `这个文件正被「${used.label}」使用，删除后该处将无法播放或显示。此操作不可恢复。`
        : '没有任何地方引用这个文件，删除不影响其他内容。此操作不可恢复。',
    })) return;
    await db.files.remove(row.id);
    setTick(tick + 1);
    toast(`已删除，释放 ${backup.sizeText(row.bytes)}`, 'ok');
  };

  const dropOrphans = async () => {
    if (!orphans.length) { toast('没有无引用的文件'); return; }
    if (!await confirm({
      title: '清理无引用文件', danger: true, okText: '删除',
      message: `将删除 ${orphans.length} 个没有任何地方引用的文件，`
        + `释放 ${backup.sizeText(orphanBytes)}。此操作不可恢复。`,
    })) return;
    for (const r of orphans) await db.files.remove(r.id);
    setTick(tick + 1);
    toast(`已清理 ${orphans.length} 个，释放 ${backup.sizeText(orphanBytes)}`, 'ok');
  };

  if (!rows.length) {
    return html`<${Page} title="占地方的文件" onBack=${nav.pop}>
      <${EmptyState} icon="film" title="还没有这类文件"
        desc="音频、视频、字体与书籍正文会显示在这里。图片不在此列，图片存入时已经过压缩。"/>
    <//>`;
  }

  return html`
    <${Page} title="占地方的文件" onBack=${nav.pop}>
      ${orphans.length ? html`
        <${List} title="无引用">
          <${ListItem} title=${`${orphans.length} 个文件没有任何地方引用`} multiline
            subtitle=${`共 ${backup.sizeText(orphanBytes)}。删除它们不影响其他内容。`}
            left=${html`<${Icon} name="filter" size=${18}/>`}
            right=${html`<${Button} size="sm" variant="ghost" onClick=${dropOrphans}>清理<//>`}/>
        <//>` : null}

      <${List} title=${`共 ${rows.length} 个，${backup.sizeText(total)}`}>
        ${rows.map(r => html`
          <${ListItem} key=${r.id} title=${r.name || '未命名'} multiline
            subtitle=${[
              backup.sizeText(r.bytes),
              r.use ? `${purge.FILE_KINDS[r.use.kind] || '使用中'}：${r.use.label}` : '没有地方引用它',
            ].join(' · ')}
            left=${html`<${Icon} name=${r.use ? (ICONS[r.use.kind] || 'database') : 'filter'} size=${18}/>`}
            right=${html`
              <button class="press" aria-label=${`删除 ${r.name || '这个文件'}`}
                onClick=${() => drop(r)}><${Icon} name="trash" size=${16}/></button>`}/>`)}
      <//>

      <div class="settings-foot">
        按占用从大到小排列。删除只移除文件本身，引用它的那条记录仍然在，
        只是无法再播放或显示。<br/>
        图片不在此列：图片存入时已转换为 WebP 并限制尺寸，此处列出的是按原样保存的内容。
      </div>
    <//>`;
}

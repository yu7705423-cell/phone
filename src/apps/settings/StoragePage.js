import { html, useState, useRef, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, Icon, Sheet, toast, confirm } from '../../ui/index.js';

const { db, nav, backup } = phone;

export const fmtBytes = b => b < 1024 ? `${b} B`
  : b < 1048576 ? `${(b / 1024).toFixed(1)} KB`
  : `${(b / 1048576).toFixed(1)} MB`;

export function StoragePage() {
  useStore(db.characters.store);
  useStore(db.moments.store);
  const [busy, setBusy] = useState(false);
  const [work, setWork] = useState(null);
  const [picking, setPicking] = useState(false);
  const [room, setRoom] = useState(null);      // 浏览器还剩多少地方
  const fileRef = useRef(null);

  useEffect(() => { backup.quota().then(setRoom); }, []);

  const counts = {
    角色卡: db.characters.count(),
    世界书: db.lorebooks.count(),
    记忆: db.memories.count(),
    会话: db.chats.count(),
    消息: db.messages.count(),
    动态: db.moments.count(),
  };

  // 导出。两档：整份（含图片、音频、视频，打成 ZIP）和只要 JSON。
  // 账先摆出来 —— 五百兆的片库打包要等，事先不知道会以为卡死了。
  const exportAll = async media => {
    setPicking(false);
    setBusy(true);
    setWork({ text: media ? '正在打包' : '正在导出', pct: 0 });
    try {
      const blob = await backup.build({
        media,
        onProgress: pct => setWork({ text: media ? '正在打包' : '正在导出', pct }),
      });
      const day = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = media ? `小手机备份-${day}.zip` : `小手机备份-${day}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`已导出 ${backup.sizeText(blob.size)}`, 'ok', 4000);
    } catch (err) { toast('导出失败：' + (err.message || err), 'error', 5000); }
    finally { setBusy(false); setWork(null); }
  };

  const importAll = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!await confirm({
      title: '导入备份', danger: true,
      message: '当前的角色卡、世界书、记忆、会话与曲库片库将被备份内容覆盖。'
        + '备份中包含的图片与文件会按原编号放回。接口配置与密钥不受影响。',
    })) return;
    setBusy(true);
    setWork({ text: '正在读取', pct: 0 });
    try {
      const got = await backup.restore(file, {
        onProgress: pct => setWork({ text: '正在恢复', pct }),
      });
      toast(`已恢复 ${got.rows} 条记录${got.media ? `，${got.media} 个文件` : ''}`
        + `${got.migrated ? `，并升级了 ${got.migrated} 个版本的数据结构` : ''}`, 'ok', 5000);
    } catch (err) {
      toast('导入失败：' + (err.message || err), 'error', 5000);
    } finally { setBusy(false); setWork(null); }
  };

  // 「谁还引用着图片」这张单子在 system/purge.js。从前写在这里，
  // 漏掉了聊天记录里的图、通话背景、脸部参考与头像池 —— 按那张单子清一遍
  // 会把它们全删了。这种单子必须和存图的地方放在一起维护。
  const cleanOrphans = async () => {
    const orphans = phone.purge.orphanImageIds();
    if (!orphans.length) { toast('没有需要清理的图片'); return; }
    if (!await confirm({ title: '清理无引用图片', message: `将删除 ${orphans.length} 张未被引用的图片。`, danger: true })) return;
    await Promise.all(orphans.map(id => db.images.remove(id)));
    toast(`已清理 ${orphans.length} 张图片`);
  };

  const wipe = async () => {
    if (!await confirm({
      title: '清空全部数据', danger: true, okText: '全部删除',
      message: '角色卡、世界书、记忆、聊天记录、动态与图片将全部删除，且无法恢复。',
    })) return;
    setBusy(true);
    for (const n of ['characters', 'lorebooks', 'memories', 'chats', 'messages', 'moments', 'spaceItems', 'events', 'days', 'recipes', 'meals']) {
      await db[n].clear();
    }
    await Promise.all(db.images.ids().map(id => db.images.remove(id)));
    db.persona.reset();
    db.layout.reset();
    setBusy(false);
    toast('已清空');
  };

  return html`
    <${Page} title="存储与备份" onBack=${nav.pop}>
      ${room ? html`
        <${List} title="浏览器给的空间">
          <${ListItem} title=${`已用 ${backup.sizeText(room.usage)}`} multiline
            subtitle=${`共 ${backup.sizeText(room.quota)}，占 ${Math.round(room.ratio * 100)}%`
              + (room.ratio > 0.8
                ? '。空间不足时写入会失败，消息与图片可能存不下，建议导出备份后清理'
                : '')}
            left=${html`<${Icon} name="database" size=${18}/>`}
            right=${html`<span>${Math.round(room.ratio * 100)}%</span>`}/>
          <div class="pad-x pad-b">
            <div class="vd-work-line"><i style=${`width:${Math.min(100, room.ratio * 100)}%`}></i></div>
          </div>
        <//>` : null}

      <${List} title="占用">
        <${ListItem} title="图片" subtitle=${`${db.images.count()} 张`}
          left=${html`<${Icon} name="image" size=${18}/>`}
          right=${html`<span>${fmtBytes(db.images.totalBytes())}</span>`}/>
        <${ListItem} title="音频与视频" subtitle=${`${phone.files.count()} 个文件`}
          left=${html`<${Icon} name="film" size=${18}/>`}
          right=${html`<span>${backup.sizeText(phone.files.totalBytes())}</span>`}/>
        ${Object.entries(counts).map(([k, v]) => html`
          <${ListItem} key=${k} title=${k} right=${html`<span>${v}</span>`}/>`)}
      <//>

      <${List} title="维护">
        <${ListItem} title="清理无引用图片" subtitle="删除未被任何角色或动态引用的图片" arrow
          left=${html`<${Icon} name="filter" size=${18}/>`} onClick=${cleanOrphans}/>
      <//>

      <${List} title="备份">
        <${ListItem} title="导出备份" multiline arrow
          subtitle="可选择是否包含图片、音频与视频。接口密钥不会写入备份"
          left=${html`<${Icon} name="download" size=${18}/>`}
          onClick=${() => setPicking(true)}/>
        <${ListItem} title="导入备份" subtitle="ZIP 或 JSON。将覆盖当前数据" arrow
          left=${html`<${Icon} name="upload" size=${18}/>`}
          onClick=${() => fileRef.current?.click()}/>
      <//>
      ${work ? html`
        <div class="pad-x pad-b">
          <div class="vd-work">
            <div class="vd-work-line"><i style=${`width:${Math.round((work.pct || 0) * 100)}%`}></i></div>
            <span>${work.text}${work.pct ? ` ${Math.round(work.pct * 100)}%` : ''}</span>
          </div>
        </div>` : null}
      <div class="settings-foot">
        所有数据都保存在这台设备的浏览器中。清除站点数据、更换设备或系统回收存储后
        无法找回，请定期导出。
      </div>
      <input type="file" accept=".zip,.json,application/zip,application/json"
        ref=${fileRef} onChange=${importAll} style="display:none"/>

      <${Sheet} open=${picking} onClose=${() => setPicking(false)} title="导出备份">
        <${List} inset=${false}>
          <${ListItem} title="完整备份" multiline arrow
            subtitle=${`包含图片、音频与视频，约 ${backup.sizeText(
              db.images.totalBytes() + phone.files.totalBytes())}。打包需要一些时间`}
            left=${html`<${Icon} name="database" size=${18}/>`}
            onClick=${() => exportAll(true)}/>
          <${ListItem} title="仅数据" multiline arrow
            subtitle="角色卡、世界书、记忆、会话与设置。体积小，但头像与照片不在其中"
            left=${html`<${Icon} name="notes" size=${18}/>`}
            onClick=${() => exportAll(false)}/>
        <//>
        <div class="settings-foot">
          完整备份为 ZIP，其中的图片与文件按原编号存放，恢复后引用不会错位。
        </div>
      <//>

      <div class="pad">
        <${Button} full variant="danger" disabled=${busy} onClick=${wipe}>清空全部数据<//>
      </div>

      <${List} title="排查">
        <${ListItem} title="请求记录" arrow multiline
          subtitle="记录每一轮向模型发出的完整请求，用于排查提示词。默认关闭，关闭时不记录任何内容。"
          left=${html`<${Icon} name="notes" size=${18}/>`}
          onClick=${() => nav.push('/trace')}/>
      <//>
    <//>`;
}

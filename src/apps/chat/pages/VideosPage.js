import { html, useState, useRef, useEffect } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, Field, Input, Textarea, Button, Icon, Sheet, List, ListItem,
         NumberInput, EmptyState, toast, confirm } from '../../../ui/index.js';

const { db, nav, video, subtitle, ai } = phone;

// 片库。和曲库同一套：片子要么一个地址，要么一个本机文件。
//
// 这一页比曲库多两样，都是一起看的要害：
//   **字幕**  模型看不见画面，台词是它唯一读得到的东西。没有字幕也能放，
//             但角色只知道进度，不知道演了什么，界面上直说。
//   **提纲**  开看前一次性读完整份字幕，生成分段剧情。花一次接口调用，
//             所以要用户自己点，不自动跑（见 CLAUDE.md 第 13 条）。

const linesOf = row => video.linesOf(row).length;

function EditSheet({ open, row, onClose }) {
  const isNew = !row;
  const fileRef = useRef(null);
  const subRef = useRef(null);

  const init = () => ({
    title: row?.title || '', url: row?.url || '',
    fileId: row?.fileId || null, subtitle: row?.subtitle || '',
    offset: row?.offset || 0, name: '',
  });
  const [f, setForm] = useState(init);
  useEffect(() => { if (open) setForm(init()); }, [open, row?.id]);
  const set = patch => setForm({ ...f, ...patch });

  const pickFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const id = await db.files.put(file, { name: file.name, type: file.type || 'video/mp4' });
      set({
        fileId: id, name: file.name, url: '',
        title: f.title.trim() || file.name.replace(/\.[^.]+$/, ''),
      });
    } catch (err) { toast('视频存不下：' + (err.message || err), 'error'); }
  };

  const pickSub = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    set({ subtitle: await file.text() });
  };

  const submit = () => {
    try {
      if (isNew) video.addVideo(f);
      else video.updateVideo(row.id, f);
      onClose();
      toast(isNew ? '已加入片库' : '已保存', 'ok');
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const count = subtitle.parse(f.subtitle).length;

  return html`
    <${Sheet} open=${open} onClose=${onClose} title=${isNew ? '添加影片' : '编辑影片'} height="88%">
      <${Field} label="片名">
        <${Input} value=${f.title} placeholder="片名" maxlength=${80}
          onInput=${v => set({ title: v })}/>
      <//>
      <${Field} label="播放地址"
        desc="直接指向视频文件的地址。地址与本机文件二选一，填了地址则不需要上传文件。">
        <${Input} value=${f.url} placeholder="https://..."
          onInput=${v => set({ url: v, fileId: v ? null : f.fileId, name: v ? '' : f.name })}/>
      <//>
      <${Field} label="本机视频"
        desc=${f.name ? `已选择：${f.name}`
          : f.fileId ? '已有视频文件。重新选择将替换它。'
            : '文件保存在本机浏览器中，不会上传到任何服务器。'}>
        <div class="wg-edit-cover">
          <${Button} size="sm" variant="ghost" icon="upload"
            onClick=${() => fileRef.current?.click()}>${f.fileId ? '更换文件' : '选择文件'}<//>
          ${f.fileId ? html`
            <${Button} size="sm" variant="ghost" icon="trash"
              onClick=${() => set({ fileId: null, name: '' })}>移除<//>` : null}
        </div>
        <input type="file" accept="video/*" ref=${fileRef} onChange=${pickFile} style="display:none"/>
      <//>

      <${Field} label="字幕"
        desc=${`支持 SRT、ASS 与 WebVTT。${count ? `当前已识别 ${count} 句。` : ''}`
          + '角色看不到画面，台词是它唯一能读到的内容。没有字幕时它只知道进度。'}>
        <${Textarea} rows=${6} value=${f.subtitle}
          placeholder=${'1\n00:00:12,000 --> 00:00:14,500\n第一句'}
          onInput=${v => set({ subtitle: v })}/>
        <div class="pad-t">
          <${Button} size="sm" variant="ghost" icon="upload"
            onClick=${() => subRef.current?.click()}>导入字幕文件<//>
        </div>
        <input type="file" accept=".srt,.ass,.ssa,.vtt,.txt,text/plain" ref=${subRef}
          onChange=${pickSub} style="display:none"/>
      <//>

      <${Field} label="字幕偏移"
        desc=${'字幕整体提前或推迟这么多秒，用于字幕与手中片源版本不一致的情况。'
          + '填正数表示字幕推迟出现，负数表示提前。观看时也可以随时调整。'}>
        <${NumberInput} value=${f.offset} unit="秒" placeholder="0"
          min=${-60} max=${60} step=${0.5}
          onChange=${v => set({ offset: v })}/>
      <//>

      <div class="pad-t">
        <${Button} full onClick=${submit}
          disabled=${!f.title.trim() || (!f.url.trim() && !f.fileId)}>
          ${isNew ? '添加' : '保存'}<//>
      </div>
      ${isNew ? null : html`
        <div class="settings-foot">更换字幕后，原有的剧情提纲会一并作废，需要重新生成。</div>`}
    <//>`;
}

export function VideosPage() {
  useStore(db.videos.store);
  const [editing, setEditing] = useState(undefined);
  const [busy, setBusy] = useState('');

  const list = video.allVideos();

  const drop = async row => {
    if (!await confirm({
      title: '从片库移除', danger: true, okText: '移除',
      message: `将移除「${row.title}」。上传的视频文件会一并删除。`,
    })) return;
    video.removeVideo(row.id);
  };

  const outline = async row => {
    setBusy(row.id);
    try {
      const segs = await ai.watchOutline.generate(row.id);
      toast(`已生成 ${segs.length} 段剧情提纲`, 'ok');
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setBusy(''); }
  };

  return html`
    <${Page} title="片库" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${() => setEditing(null)}>添加</button>`}>
      ${list.length ? html`
        <${List} title=${`共 ${list.length} 部`}>
          ${list.map(row => {
            const n = linesOf(row);
            const segs = (row.outline || []).length;
            return html`
              <${ListItem} key=${row.id} title=${row.title} multiline
                subtitle=${[
                  n ? `字幕 ${n} 句` : '没有字幕',
                  video.offsetOf(row) ? `偏移 ${video.offsetOf(row) > 0 ? '+' : ''}${video.offsetOf(row)} 秒` : '',
                  segs ? `提纲 ${segs} 段` : '未生成提纲',
                ].filter(Boolean).join(' · ')}
                left=${html`<${Icon} name="film" size=${18}/>`}
                right=${html`
                  <span class="row-acts">
                    ${ai.watchOutline.canOutline(row) ? html`<button class="nav-text press" disabled=${!!busy}
                      onClick=${() => outline(row)}>${busy === row.id
                        ? '生成中'
                        : ai.watchOutline.hasOutline(row) ? '重新生成' : '生成提纲'}</button>` : null}
                    <button class="nav-text press" onClick=${() => setEditing(row)}>编辑</button>
                    <button class="nav-text press" onClick=${() => drop(row)}>移除</button>
                  </span>`}/>`;
          })}
        <//>`
      : html`
        <${EmptyState} icon="film" title="片库是空的"
          desc="可上传本机视频或填写播放地址，并为其导入字幕。"
          action=${html`<${Button} size="sm" icon="plus"
            onClick=${() => setEditing(null)}>添加影片<//>`}/>`}

      <div class="settings-foot">
        剧情提纲需要调用一次模型接口，读完整份字幕后按时间切分。<br/>
        观看时只注入已经播放过的段落，尚未演到的部分不会出现在角色可见的内容中。
      </div>

      <${EditSheet} open=${editing !== undefined} row=${editing || null}
        onClose=${() => setEditing(undefined)}/>
    <//>`;
}

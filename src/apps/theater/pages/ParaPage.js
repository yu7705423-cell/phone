import { html, useState, useEffect } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Textarea, Button, Icon, IconButton, Sheet,
         Spinner, Switch, Avatar, EmptyState, toast, confirm } from '../../../ui/index.js';

const { db, nav, book, video, subtitle, para, ai } = phone;
const task = ai.paraComment;

// 某一处的评论页。书里从段落旁的气泡进来，影片里从台词旁的气泡进来。
export function ParaPage({ kind, id, at }) {
  useStore(db.readnotes.store);
  useStore(db.ebooks.store);
  useStore(db.videos.store);
  useStore(db.characters.store);
  useStore(db.settings.store);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [mine, setMine] = useState('');
  const [writing, setWriting] = useState(false);
  const [crewing, setCrewing] = useState(false);

  const isVideo = kind === para.VIDEO;

  useEffect(() => {
    if (isVideo) return undefined;
    let alive = true;
    book.textOf(id).then(t => { if (alive) setText(t); });
    return () => { alive = false; };
  }, [id, isVideo]);

  const subject = para.subjectOf(kind, id);
  const row = isVideo ? db.videos.get(id) : db.ebooks.get(id);
  if (!row) {
    return html`<${Page} title=${isVideo ? '这一处' : '这一段'} onBack=${nav.pop}>
      <${EmptyState} title=${isVideo ? '这部影片已经不在了' : '这本书已经不在了'}/><//>`;
  }

  const passage = isVideo
    ? subtitle.recentLines(video.linesOf(row), at, 5).map(l => l.text).join('\n')
    : (text ? book.paragraphAt(text, at) : '');
  const list = para.listFor(subject, at);
  const crew = para.crewOf(subject);

  const run = async (what, fn) => {
    if (busy) return;
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return; }
    setBusy(what);
    try {
      const rows = await fn();
      if (!rows.length) { toast('这一次没有写出内容', 'plain', 4000); return; }
      task.keep(subject, at, rows);
      toast(`新增 ${rows.length} 条`, 'ok');
    } catch (err) { toast(String(err.message || err), 'error', 6000); }
    finally { setBusy(''); }
  };

  const writeMine = () => {
    try {
      para.add({ subject, at, text: mine, kind: para.ME, authorName: '我' });
      setMine(''); setWriting(false);
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  const drop = async n => {
    if (!await confirm({ title: '删除这一条', danger: true })) return;
    para.remove(n.id);
  };

  const calls = task.callsForCrew(crew.map(c => c.id));

  return html`
    <${Page} title=${isVideo ? subtitle.stamp(at) : '这一段'} onBack=${nav.pop}
      right=${list.length ? html`
        <button class="nav-text press" onClick=${async () => {
          if (!await confirm({ title: '清空这一段的评论', danger: true })) return;
          para.clearAt(subject, at);
        }}>清空</button>` : null}>

      <div class="pad-x pad-t">
        <div class="pr-passage">${passage || html`<${Spinner} size=${16}/>`}</div>
        <div class="settings-foot pr-from">
          ${isVideo ? `《${row.title}》 · ${subtitle.stamp(at)}`
            : `《${row.title}》${row.author ? ` · ${row.author}` : ''}`}
        </div>
      </div>

      ${list.length ? html`
        <${List} title=${`${list.length} 条评论`}>
          ${list.map(n => html`
            <${ListItem} key=${n.id} multiline
              title=${n.authorName || '未署名'}
              subtitle=${n.text}
              left=${n.kind === para.CHAR && n.authorId
                ? html`<${Avatar} src=${db.characters.get(n.authorId)?.avatar}
                    name=${n.authorName} size=${32}/>`
                : html`<${Avatar} name=${n.authorName || '读'} size=${32}/>`}
              right=${html`<${IconButton} name="trash" label="删除"
                onClick=${() => drop(n)}/>`}/>`)}
        <//>`
      : html`<div class="settings-foot">这一段还没有评论。</div>`}

      <${List} title="让谁来评">
        <${ListItem} title=${isVideo ? '多人同看' : '多人共读'} arrow multiline
          subtitle=${crew.length
            ? `${crew.map(c => c.name).join('、')} 各写一条 · 本次调用 ${calls} 次`
            : '先选定参与共读的角色，之后每一段点一下即可'}
          left=${busy === 'crew' ? html`<${Spinner} size=${16}/>` : html`<${Icon} name="users" size=${18}/>`}
          onClick=${() => (crew.length
            ? run('crew', () => task.crew({ subject, at, charIds: crew.map(c => c.id) }))
            : setCrewing(true))}/>
        <${ListItem} title="随机评论" arrow multiline
          subtitle=${`临时生成 ${task.crowdCount()} 位读者的评论，调用 1 次。`
            + '这些读者不会存入联系人'}
          left=${busy === 'readers' ? html`<${Spinner} size=${16}/>` : html`<${Icon} name="message" size=${18}/>`}
          onClick=${() => run('readers', () => task.readers({ subject, at }))}/>
        <${ListItem} title="自己写一条" arrow multiline
          subtitle="写下你自己的想法，不调用接口"
          left=${html`<${Icon} name="edit" size=${18}/>`}
          onClick=${() => setWriting(true)}/>
        <${ListItem} title="共读名单" arrow multiline
          subtitle=${crew.length ? `${crew.length} 人` : '尚未选择'}
          left=${html`<${Icon} name="settings" size=${18}/>`}
          onClick=${() => setCrewing(true)}/>
      <//>

      <${Sheet} open=${writing} onClose=${() => setWriting(false)} title="写一条">
        <div class="pad-x">
          <${Field} label="你的想法">
            <${Textarea} rows=${5} value=${mine} onInput=${setMine} placeholder="写下来"/>
          <//>
          <div class="pad-b">
            <${Button} full disabled=${!mine.trim()} onClick=${writeMine}>写好了<//>
          </div>
        </div>
      <//>

      <${CrewSheet} open=${crewing} subject=${subject} onClose=${() => setCrewing(false)}/>
    <//>`;
}

// 共读名单。存在书上，挑一次之后每一段都用它
function CrewSheet({ open, subject, onClose }) {
  useStore(db.ebooks.store);
  useStore(db.videos.store);
  useStore(db.settings.store);
  if (!open) return null;
  const picked = new Set(para.crewOf(subject).map(c => c.id));
  const all = para.candidates();
  const s = db.settings.get();

  const toggle = id => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    para.setCrew(subject, [...next]);
  };

  return html`
    <${Sheet} open=${true} onClose=${onClose} title="共读名单" height="80%">
      <${List} inset=${false}>
        ${all.map(c => html`
          <${ListItem} key=${c.id} title=${c.name} subtitle=${c.signature || ''}
            left=${html`<${Avatar} src=${c.avatar} name=${c.name} size=${34}/>`}
            right=${picked.has(c.id) ? html`<${Icon} name="check" size=${16}/>` : null}
            onClick=${() => toggle(c.id)}/>`)}
        ${all.length ? null : html`<${ListItem} title="还没有角色" multiline
          subtitle="先在「联系」里建一个角色"/>`}
      <//>
      <${List} title="生成方式" inset=${false}>
        <${ListItem} title="一人一次调用" multiline
          subtitle=${'关闭时一次调用写出所有人的评论，较为省钱，但同一次里几个人'
            + '容易写得相似。开启后每人单独调用一次，选几个人就是几次。'}
          right=${html`<${Switch} checked=${s.crowdSeparate === true}
            onChange=${v => db.settings.set({ crowdSeparate: v })}/>`}/>
      <//>
    <//>`;
}

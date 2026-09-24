import { html, useState, useEffect } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Button, Sheet, Icon, Spinner,
  EmptyState, toast, confirm } from '../../ui/index.js';

const { nav, auth } = phone;

// 登录账号（本站开了账号功能时才出现在设置里）。账号由运营方在下面的管理页里手动添加，不开放注册。
// 新账号与重置后的密码统一是初始密码（Worker 里的 INITIAL_PASSWORD），登录后各自修改。

export function SigninPage() {
  const name = auth.currentName();
  const [changing, setChanging] = useState(null);   // { old, next, again }
  const [busy, setBusy] = useState(false);
  const [initial, setInitial] = useState(auth.isInitial());

  const out = async () => {
    if (!await confirm({ title: '退出登录', message: `退出后需要重新输入账号与密码。本机的数据不受影响。`, danger: true })) return;
    await auth.logout();
    location.reload();
  };

  const save = async () => {
    setBusy(true);
    try {
      await auth.changePassword(changing.old, changing.next, changing.again);
      setChanging(null);
      setInitial(false);
      toast('密码已修改。该账号在其他设备上的登录已退出', 'ok', 3500);
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };

  return html`
    <${Page} title="登录账号" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title=${name || '未登录'} subtitle=${initial ? '当前仍是初始密码，建议修改' : '当前登录的账号'}
          left=${html`<${Icon} name="user" size=${18}/>`}/>
        ${auth.isAdmin() ? null : html`
          <${ListItem} title="修改密码" subtitle="修改后，该账号在其他设备上的登录会退出" arrow
            left=${html`<${Icon} name="lock" size=${18}/>`}
            onClick=${() => setChanging({ old: '', next: '', again: '' })}/>`}
        <${ListItem} title="退出登录" danger onClick=${out}/>
      <//>
      <div class="settings-foot">
        登录只决定能不能进入本应用。角色卡、聊天记录等数据仍只保存在这台设备上，不随账号同步。
        一个账号最多同时在两台设备上登录，第三台登录时最早登录的那一台会退出。
        ${auth.isAdmin() ? '' : '忘记密码时，请联系添加账号的人重置为初始密码。'}
      </div>
      ${auth.isAdmin() ? html`
        <${List}>
          <${ListItem} title="管理账号" subtitle="添加、停用账号与重置密码。需要管理员密码" arrow
            left=${html`<${Icon} name="key" size=${18}/>`} onClick=${() => nav.push('/signin/admin')}/>
        <//>` : null}

      ${changing ? html`
        <${Sheet} open=${true} onClose=${() => !busy && setChanging(null)} title="修改密码">
          <${Field} label="原密码">
            <${Input} type="password" value=${changing.old} autocomplete="current-password"
              onInput=${v => setChanging(c => ({ ...c, old: v }))}/>
          <//>
          <${Field} label="新密码" desc="至少 6 位，不能与初始密码相同。">
            <${Input} type="password" value=${changing.next} autocomplete="new-password"
              onInput=${v => setChanging(c => ({ ...c, next: v }))}/>
          <//>
          <${Field} label="再输入一次新密码">
            <${Input} type="password" value=${changing.again} autocomplete="new-password"
              onInput=${v => setChanging(c => ({ ...c, again: v }))}/>
          <//>
          <div class="sheet-acts">
            <${Button} variant="ghost" onClick=${() => setChanging(null)}>取消<//>
            <${Button} disabled=${busy} onClick=${save}>${busy ? '正在修改' : '修改'}<//>
          </div>
        <//>` : null}
    <//>`;
}

// ---- 管理页 ----

const ADMIN_KEY = 'eira-admin';
const readPw = () => { try { return sessionStorage.getItem(ADMIN_KEY) || ''; } catch { return ''; } };
const keepPw = v => { try { v ? sessionStorage.setItem(ADMIN_KEY, v) : sessionStorage.removeItem(ADMIN_KEY); } catch { /* 隐私模式 */ } };
const dateOf = t => (t ? new Date(t).toLocaleDateString('zh-CN') : '');
// 批量添加时贴进来的名单：一行一个，去掉空行与重复
const namesOf = text => [...new Set(String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean))];

export function AdminPage() {
  const [pw, setPw] = useState(readPw);
  const [draft, setDraft] = useState('');
  const [users, setUsers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [making, setMaking] = useState(null);     // { name, note } 添加一个
  const [batch, setBatch] = useState(null);       // { text, note, done, total } 批量添加
  const [report, setReport] = useState(null);     // { added: [], failed: [{ name, error }], password }
  const [picked, setPicked] = useState(null);     // 点开的那个账号

  const call = (op, extra) => auth.admin(pw, op, extra);
  // 只有用 admin 登录时才有这一页的入口（见上面的 SigninPage）。直接打开地址的也只看到这一句
  const allowed = auth.isAdmin();

  const load = async (withPw = pw) => {
    setBusy(true);
    try {
      const r = await auth.admin(withPw, 'list');
      setUsers(r.users || []);
      return true;
    } catch (err) {
      toast(String(err.message || err), 'error', 4000);
      return false;
    } finally { setBusy(false); }
  };

  useEffect(() => { if (allowed && pw) load(pw).then(ok => { if (!ok) { setPw(''); keepPw(''); } }); }, []);

  const unlock = async () => {
    const v = draft.trim();
    if (!v) return;
    if (await load(v)) { setPw(v); keepPw(v); setDraft(''); }
  };

  if (!allowed) {
    return html`
      <${Page} title="管理账号" onBack=${nav.pop}>
        <${EmptyState} icon="lock" title="仅管理员可用" desc="用管理员账号登录后，才能添加与管理账号。"/>
      <//>`;
  }

  if (!pw || users === null) {
    return html`
      <${Page} title="管理账号" onBack=${nav.pop}>
        <div class="pad">
          <${Field} label="管理员密码" desc="即部署账号服务时在 Cloudflare 后台设置的 ADMIN_PASSWORD。只保存在本次打开的页面中，关闭应用后需要重新输入。">
            <${Input} type="password" value=${draft} onInput=${setDraft} placeholder="管理员密码"/>
          <//>
          <${Button} full disabled=${busy || !draft.trim()} onClick=${unlock}>${busy ? '正在验证' : '进入'}<//>
        </div>
      <//>`;
  }

  const create = async () => {
    const name = making.name.trim();
    if (!name) { toast('请填写账号名'); return; }
    setBusy(true);
    try {
      const r = await call('create', { name, note: making.note.trim() });
      setMaking(null);
      toast(`已添加「${r.name}」，初始密码 ${r.password}`, 'ok', 4000);
      load();
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };

  // 一个一个加：每加一个都要算一次密码哈希，一次请求里加一批会超出 Worker 的 CPU 限额
  const createMany = async () => {
    const names = namesOf(batch.text);
    if (!names.length) { toast('请填写账号名，一行一个'); return; }
    setBusy(true);
    const added = [];
    const failed = [];
    let password = '';
    for (let i = 0; i < names.length; i++) {
      try {
        const r = await call('create', { name: names[i], note: batch.note.trim() });
        added.push(r.name);
        password = r.password;
      } catch (err) {
        failed.push({ name: names[i], error: String(err.message || err) });
      }
      setBatch(b => ({ ...b, done: i + 1, total: names.length }));
    }
    setBusy(false);
    setBatch(null);
    setReport({ added, failed, password });
    load();
  };

  const act = async (op, extra, confirmMsg) => {
    if (confirmMsg && !await confirm({ title: confirmMsg.title, message: confirmMsg.message, danger: true })) return;
    setBusy(true);
    try {
      const r = await call(op, { name: picked.name, ...extra });
      if (op === 'remove') setPicked(null);
      else if (op === 'reset') toast(`已重置为初始密码 ${r.password}`, 'ok', 4000);
      else toast('已完成', 'ok');
      await load();
      if (op !== 'remove') {
        setPicked(p => (p ? { ...p, disabled: r.disabled ?? p.disabled,
          devices: op === 'kick' || op === 'reset' ? 0 : p.devices, initial: op === 'reset' ? true : p.initial } : p));
      }
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };

  const key = q.trim().toLowerCase();
  const shown = key ? users.filter(u => `${u.name} ${u.note || ''}`.toLowerCase().includes(key)) : users;
  const lockOut = () => { setPw(''); keepPw(''); setUsers(null); };
  const reportText = r => [...r.added, r.password ? `初始密码：${r.password}` : ''].filter(Boolean).join('\n');

  return html`
    <${Page} title="管理账号" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${lockOut}>锁定</button>`}>
      <div class="pad btn-row">
        <${Button} icon="plus" onClick=${() => setMaking({ name: '', note: '' })}>添加账号<//>
        <${Button} variant="ghost" icon="layers" onClick=${() => setBatch({ text: '', note: '', done: 0, total: 0 })}>批量添加<//>
      </div>
      <div class="pad-x">
        <${Input} value=${q} onInput=${setQ} placeholder=${`搜索账号或备注（共 ${users.length} 个）`}/>
      </div>
      ${busy && !making && !batch ? html`<div class="picker-state"><${Spinner}/></div>` : null}
      ${shown.length ? html`
        <${List}>
          ${shown.map(u => html`
            <${ListItem} key=${u.name} title=${u.name}
              subtitle=${[u.initial ? '初始密码' : '', u.note, dateOf(u.createdAt)].filter(Boolean).join(' · ')}
              right=${u.disabled ? '已停用' : u.devices ? `${u.devices} 台设备` : '未登录'}
              arrow onClick=${() => setPicked(u)}/>`)}
        <//>` : html`<${EmptyState} icon="users" title=${users.length ? '没有匹配的账号' : '还没有账号'}
          desc=${users.length ? '' : '点「添加账号」添加第一个。'}/>`}
      <div class="settings-foot">
        新账号的密码统一是初始密码，对方登录后可以在「设置 - 登录账号」里自己修改。
        列表里标着「初始密码」的，是还没改过的账号。对方忘记密码时，在这里重置即可，
        密码回到初始密码，原来登录的设备会退出。
      </div>

      ${making ? html`
        <${Sheet} open=${true} onClose=${() => setMaking(null)} title="添加账号">
          <${Field} label="账号名" desc="1 到 32 个字，不能含空格，不能是 admin。对方登录时输入它。">
            <${Input} value=${making.name} onInput=${v => setMaking(m => ({ ...m, name: v }))} placeholder="账号名"
              autocapitalize="off" autocorrect="off" spellcheck="false"/>
          <//>
          <${Field} label="备注" desc="只有管理页能看到，例如对方的昵称或购买渠道。">
            <${Input} value=${making.note} onInput=${v => setMaking(m => ({ ...m, note: v }))}/>
          <//>
          <div class="sheet-acts">
            <${Button} variant="ghost" onClick=${() => setMaking(null)}>取消<//>
            <${Button} disabled=${busy || !making.name.trim()} onClick=${create}>${busy ? '正在添加' : '添加'}<//>
          </div>
        <//>` : null}

      ${batch ? html`
        <${Sheet} open=${true} onClose=${() => !busy && setBatch(null)} title="批量添加">
          <${Field} label="账号名" desc="一行一个。空行与重复的会跳过，已经存在的会列在结果里。一次添加很多个需要一点时间，过程中请不要离开这一页。">
            <${Textarea} rows=${8} value=${batch.text} onInput=${v => setBatch(b => ({ ...b, text: v }))}
              placeholder=${'小林\n阿岚\n……'}/>
          <//>
          <${Field} label="备注" desc="这一批共用的备注，例如「第二批」。">
            <${Input} value=${batch.note} onInput=${v => setBatch(b => ({ ...b, note: v }))}/>
          <//>
          <div class="sheet-acts">
            <${Button} disabled=${busy} onClick=${createMany}>
              ${busy ? `正在添加 ${batch.done} / ${batch.total}` : `添加 ${namesOf(batch.text).length} 个`}<//>
          </div>
        <//>` : null}

      ${report ? html`
        <${Sheet} open=${true} onClose=${() => setReport(null)} title=${`已添加 ${report.added.length} 个账号`}>
          ${report.added.length ? html`
            <pre class="acct-out selectable">${reportText(report)}</pre>` : null}
          ${report.failed.length ? html`
            <div class="warn-box">
              以下 ${report.failed.length} 个没有添加：<br/>
              ${report.failed.map(f => html`<div key=${f.name}>${f.name}：${f.error}</div>`)}
            </div>` : null}
          <div class="sheet-acts">
            <${Button} variant="ghost" onClick=${() => setReport(null)}>关闭<//>
          </div>
        <//>` : null}

      ${picked ? html`
        <${Sheet} open=${true} onClose=${() => setPicked(null)} title=${picked.name}>
          <${List}>
            <${ListItem} title="状态" right=${picked.disabled ? '已停用' : '正常'}/>
            <${ListItem} title="密码" right=${picked.initial ? '初始密码' : '已自行修改'}/>
            <${ListItem} title="登录中的设备" right=${`${picked.devices || 0} 台`}/>
            ${picked.note ? html`<${ListItem} title="备注" subtitle=${picked.note}/>` : null}
            <${ListItem} title="重置密码" subtitle="密码恢复为初始密码，原来登录的设备会退出" arrow
              onClick=${() => act('reset', {}, { title: '重置密码', message: `「${picked.name}」的密码将恢复为初始密码。` })}/>
            <${ListItem} title="全部下线" subtitle="该账号在所有设备上退出，密码不变" arrow
              onClick=${() => act('kick', {}, { title: '全部下线', message: `「${picked.name}」将在所有设备上退出。` })}/>
            <${ListItem} title=${picked.disabled ? '恢复使用' : '停用'}
              subtitle=${picked.disabled ? '恢复后可以用原密码登录' : '停用后无法登录，已登录的设备会退出'} arrow
              onClick=${() => act('disable', { on: !picked.disabled },
                picked.disabled ? null : { title: '停用账号', message: `「${picked.name}」将无法登录。` })}/>
            <${ListItem} title="删除账号" danger
              onClick=${() => act('remove', {}, { title: '删除账号', message: `「${picked.name}」将被删除，无法恢复。` })}/>
          <//>
        <//>` : null}
    <//>`;
}

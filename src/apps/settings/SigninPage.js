import { html, useState, useEffect } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, NumberInput, Button, Sheet, Icon, Spinner,
  EmptyState, toast, confirm } from '../../ui/index.js';

const { nav, auth } = phone;

// 登录账号（本站开了账号功能时才出现在设置里）。账号由运营方在下面的管理页里发放，不开放注册。

const copy = async text => {
  try { await navigator.clipboard.writeText(text); toast('已复制', 'ok'); }
  catch { toast('复制失败：浏览器未授予剪贴板权限', 'error'); }
};

export function SigninPage() {
  const name = auth.currentName();
  const out = async () => {
    if (!await confirm({ title: '退出登录', message: `退出后需要重新输入账号与密码。本机的数据不受影响。`, danger: true })) return;
    await auth.logout();
    location.reload();
  };
  return html`
    <${Page} title="登录账号" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title=${name || '未登录'} subtitle="当前登录的账号"
          left=${html`<${Icon} name="user" size=${18}/>`}/>
        <${ListItem} title="退出登录" danger onClick=${out}/>
      <//>
      <div class="settings-foot">
        登录只决定能不能进入本应用。角色卡、聊天记录等数据仍只保存在这台设备上，不随账号同步。
        一个账号最多同时在两台设备上登录，第三台登录时最早登录的那一台会退出。
      </div>
      <${List}>
        <${ListItem} title="管理账号" subtitle="发放、停用账号与重置密码。需要管理员密码" arrow
          left=${html`<${Icon} name="key" size=${18}/>`} onClick=${() => nav.push('/signin/admin')}/>
      <//>
    <//>`;
}

// ---- 管理页 ----

const ADMIN_KEY = 'eira-admin';
const readPw = () => { try { return sessionStorage.getItem(ADMIN_KEY) || ''; } catch { return ''; } };
const keepPw = v => { try { v ? sessionStorage.setItem(ADMIN_KEY, v) : sessionStorage.removeItem(ADMIN_KEY); } catch { /* 隐私模式 */ } };
const dateOf = t => (t ? new Date(t).toLocaleDateString('zh-CN') : '');
const linesOf = rows => rows.map(r => `账号：${r.name}　密码：${r.password}`).join('\n');

export function AdminPage() {
  const [pw, setPw] = useState(readPw);
  const [draft, setDraft] = useState('');
  const [users, setUsers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [making, setMaking] = useState(null);     // { name, note } 新建一个
  const [batch, setBatch] = useState(null);       // { count, note, done } 批量
  const [result, setResult] = useState(null);     // [{ name, password }] 刚发出去的
  const [picked, setPicked] = useState(null);     // 点开的那个账号

  const call = (op, extra) => auth.admin(pw, op, extra);

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

  useEffect(() => { if (pw) load(pw).then(ok => { if (!ok) { setPw(''); keepPw(''); } }); }, []);

  const unlock = async () => {
    const v = draft.trim();
    if (!v) return;
    if (await load(v)) { setPw(v); keepPw(v); setDraft(''); }
  };

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
    setBusy(true);
    try {
      const r = await call('create', { name: making.name.trim(), note: making.note.trim() });
      setMaking(null);
      setResult([r]);
      load();
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };

  // 一个一个建：每建一个都要算一次密码哈希，一次请求里建一批会超出 Worker 的 CPU 限额
  const createMany = async () => {
    const n = Math.max(0, Math.floor(Number(batch.count) || 0));
    if (!n) { toast('请填写数量'); return; }
    setBusy(true);
    const made = [];
    try {
      for (let i = 0; i < n; i++) {
        made.push(await call('create', { note: batch.note.trim() }));
        setBatch(b => ({ ...b, done: i + 1 }));
      }
    } catch (err) {
      toast(`建到第 ${made.length + 1} 个时失败：${err.message || err}`, 'error', 5000);
    } finally {
      setBusy(false);
      setBatch(null);
      if (made.length) setResult(made);
      load();
    }
  };

  const act = async (op, extra, confirmMsg) => {
    if (confirmMsg && !await confirm({ title: confirmMsg.title, message: confirmMsg.message, danger: true })) return;
    setBusy(true);
    try {
      const r = await call(op, { name: picked.name, ...extra });
      if (op === 'reset') setResult([r]);
      if (op === 'remove') setPicked(null);
      else toast('已完成', 'ok');
      await load();
      if (op !== 'remove') setPicked(p => (p ? { ...p, disabled: r.disabled ?? p.disabled, devices: op === 'kick' || op === 'reset' ? 0 : p.devices } : p));
    } catch (err) { toast(String(err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };

  const key = q.trim().toLowerCase();
  const shown = key ? users.filter(u => `${u.name} ${u.note || ''}`.toLowerCase().includes(key)) : users;
  const lockOut = () => { setPw(''); keepPw(''); setUsers(null); };

  return html`
    <${Page} title="管理账号" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${lockOut}>锁定</button>`}>
      <div class="pad btn-row">
        <${Button} icon="plus" onClick=${() => setMaking({ name: '', note: '' })}>新建账号<//>
        <${Button} variant="ghost" icon="layers" onClick=${() => setBatch({ count: 10, note: '', done: 0 })}>批量新建<//>
      </div>
      <div class="pad-x">
        <${Input} value=${q} onInput=${setQ} placeholder=${`搜索账号或备注（共 ${users.length} 个）`}/>
      </div>
      ${busy && !making && !batch ? html`<div class="picker-state"><${Spinner}/></div>` : null}
      ${shown.length ? html`
        <${List}>
          ${shown.map(u => html`
            <${ListItem} key=${u.name} title=${u.name}
              subtitle=${[u.note, dateOf(u.createdAt)].filter(Boolean).join(' · ')}
              right=${u.disabled ? '已停用' : u.devices ? `${u.devices} 台设备` : '未登录'}
              arrow onClick=${() => setPicked(u)}/>`)}
        <//>` : html`<${EmptyState} icon="users" title=${users.length ? '没有匹配的账号' : '还没有账号'}
          desc=${users.length ? '' : '点「新建账号」发放第一个。'}/>`}
      <div class="settings-foot">
        账号名可自定，留空则自动生成。密码一律随机生成，只在生成时显示一次，请当场复制发给对方。
        对方忘记密码时，在这里重置即可，重置后原来登录的设备会退出。
      </div>

      ${making ? html`
        <${Sheet} open=${true} onClose=${() => setMaking(null)} title="新建账号">
          <${Field} label="账号名" desc="1 到 32 个字，不能含空格。留空则自动生成。">
            <${Input} value=${making.name} onInput=${v => setMaking(m => ({ ...m, name: v }))} placeholder="自动生成"/>
          <//>
          <${Field} label="备注" desc="只有管理页能看到，例如对方的昵称或购买渠道。">
            <${Input} value=${making.note} onInput=${v => setMaking(m => ({ ...m, note: v }))}/>
          <//>
          <div class="sheet-acts">
            <${Button} variant="ghost" onClick=${() => setMaking(null)}>取消<//>
            <${Button} disabled=${busy} onClick=${create}>${busy ? '正在生成' : '生成'}<//>
          </div>
        <//>` : null}

      ${batch ? html`
        <${Sheet} open=${true} onClose=${() => !busy && setBatch(null)} title="批量新建">
          <${Field} label="数量" desc="账号名自动生成。一次建很多个需要一点时间，过程中请不要离开这一页。">
            <${NumberInput} value=${batch.count} min=${1} unit="个" onChange=${v => setBatch(b => ({ ...b, count: v }))}/>
          <//>
          <${Field} label="备注" desc="这一批共用的备注，例如「第二批」。">
            <${Input} value=${batch.note} onInput=${v => setBatch(b => ({ ...b, note: v }))}/>
          <//>
          <div class="sheet-acts">
            <${Button} disabled=${busy} onClick=${createMany}>
              ${busy ? `正在生成 ${batch.done} / ${batch.count}` : '生成'}<//>
          </div>
        <//>` : null}

      ${result ? html`
        <${Sheet} open=${true} onClose=${() => setResult(null)} title=${result.length > 1 ? `已生成 ${result.length} 个账号` : '账号与密码'}>
          <div class="warn-box">密码只显示这一次。关闭之前请复制保存。</div>
          <pre class="acct-out selectable">${linesOf(result)}</pre>
          <div class="sheet-acts">
            <${Button} icon="copy" onClick=${() => copy(linesOf(result))}>全部复制<//>
            <${Button} variant="ghost" onClick=${() => setResult(null)}>关闭<//>
          </div>
        <//>` : null}

      ${picked ? html`
        <${Sheet} open=${true} onClose=${() => setPicked(null)} title=${picked.name}>
          <${List}>
            <${ListItem} title="状态" right=${picked.disabled ? '已停用' : '正常'}/>
            <${ListItem} title="登录中的设备" right=${`${picked.devices || 0} 台`}/>
            ${picked.note ? html`<${ListItem} title="备注" subtitle=${picked.note}/>` : null}
            <${ListItem} title="重置密码" subtitle="生成新密码，原来登录的设备会退出" arrow
              onClick=${() => act('reset', {}, { title: '重置密码', message: `「${picked.name}」原来的密码将失效。` })}/>
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

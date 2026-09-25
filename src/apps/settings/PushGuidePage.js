import { html, useState, useEffect } from '../../lib.js';
import { phone } from '../../sdk/index.js';
import { Page, Button, Markdown, EmptyState, toast } from '../../ui/index.js';

const { nav } = phone;

// 后台消息的部署教程（worker/PUSH.md），在应用里直接看。
// 教程要用户整段复制 Worker 代码和建表 SQL，这一页顶上给两个按钮直接复制 ——
// 在手机上去翻代码仓库、找文件、全选，太难了。
// 三样都从本站自己取（站点整个仓库都部署着），和应用永远是同一版。

async function grab(path) {
  const res = await fetch(new URL(path, location.href), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`取不到 ${path}（${res.status}）`);
  return res.text();
}

export function PushGuidePage() {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    grab('worker/PUSH.md').then(setText).catch(e => setErr(String(e.message || e)));
  }, []);

  const copy = async (path, what) => {
    try {
      await navigator.clipboard.writeText(await grab(path));
      toast(`${what}已复制`, 'ok', 3000);
    } catch (e) {
      toast(`复制失败：${e.message || e}`, 'error', 5000);
    }
  };

  return html`
    <${Page} title="部署教程" onBack=${nav.pop}>
      <div class="pad batch-acts">
        <${Button} size="sm" onClick=${() => copy('worker/push.js', 'Worker 代码')}>复制 Worker 代码<//>
        <${Button} size="sm" onClick=${() => copy('worker/push.sql', '建表 SQL')}>复制建表 SQL<//>
      </div>
      ${err ? html`<${EmptyState} icon="book" title="教程载入失败" desc=${err}/>`
        : text ? html`<div class="pad-x pad-b"><${Markdown} text=${text}/></div>`
        : html`<div class="pad"><span class="spinner"></span></div>`}
    <//>`;
}

import { html, useState, useEffect, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { List, ListItem, Icon, Sheet, Button, EmptyState, toast } from '../../ui/index.js';

const { db, toolbox } = phone;

// 工具箱里几处共用的小件：选角色、选世界书、结果框、复制。

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text ?? ''));
    toast('已复制', 'ok');
    return true;
  } catch {
    toast('复制失败，请长按文字手动选择', 'error');
    return false;
  }
}

/** 一个角色交给模型或工具时的样子。人设原文照给：这里不是显示，是输入 */
export function charText(c) {
  if (!c) return '';
  return [
    `姓名：${c.name}`,
    c.gender ? `性别：${c.gender}` : '',
    c.age ? `年龄：${c.age}` : '',
    c.birthday ? `生日：${c.birthday}` : '',
    c.persona ? `\n${c.persona}` : '',
  ].filter(Boolean).join('\n');
}

export function bookText(b) {
  if (!b) return '';
  return [`# ${b.name || '未命名世界书'}`,
    ...(b.entries || []).filter(e => e.enabled !== false).map(e =>
      `## ${e.comment || (e.keys || []).join('、') || '条目'}\n${String(e.content || '').trim()}`),
  ].join('\n\n');
}

/** 交给网页工具的角色：只有这几项，一份副本 */
export const charCopy = c => (c ? {
  name: c.name || '', gender: c.gender || '', age: c.age || '', birthday: c.birthday || '',
  signature: c.signature || '', persona: c.persona || '',
} : null);

export const bookCopy = b => (b ? {
  name: b.name || '',
  entries: (b.entries || []).filter(e => e.enabled !== false).map(e => ({
    title: e.comment || '', keys: [...(e.keys || [])], content: e.content || '',
  })),
} : null);

// 选一个（或几个）角色。列表里只露签名（CLAUDE.md 第 6 条）
export function CharPicker({ open, onClose, onPick, multi = false, picked = [], exclude = [], title }) {
  useStore(db.characters.store);
  const [sel, setSel] = useState(null);
  const chosen = sel || picked;
  const list = db.characters.all().filter(c => !exclude.includes(c.id))
    .sort((a, b) => (a.isNpc ? 1 : 0) - (b.isNpc ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
  const close = () => { setSel(null); onClose(); };
  const tap = c => {
    if (!multi) { onPick(c); close(); return; }
    setSel(chosen.includes(c.id) ? chosen.filter(x => x !== c.id) : [...chosen, c.id]);
  };
  return html`
    <${Sheet} open=${open} onClose=${close} title=${title || (multi ? '选择角色' : '选择一个角色')} height="76%">
      ${list.length ? html`
        <${List} inset=${false}>
          ${list.map(c => html`
            <${ListItem} key=${c.id} title=${phone.remark.nameOf(c)}
              subtitle=${[c.isNpc ? 'NPC' : '', c.signature || ''].filter(Boolean).join(' · ')}
              left=${html`<${Icon} name="user" size=${18}/>`}
              right=${multi && chosen.includes(c.id) ? html`<${Icon} name="check" size=${18}/>` : null}
              onClick=${() => tap(c)}/>`)}
        <//>
        ${multi ? html`
          <div class="sheet-acts">
            <${Button} variant="ghost" onClick=${close}>取消<//>
            <${Button} onClick=${() => { onPick(chosen); close(); }}>选定 ${chosen.length} 个<//>
          </div>` : null}`
      : html`<${EmptyState} icon="users" title="暂无角色" desc="可在「联系」中新建角色。"/>`}
    <//>`;
}

export function BookPicker({ open, onClose, onPick, multi = false, picked = [], title }) {
  useStore(db.lorebooks.store);
  const [sel, setSel] = useState(null);
  const chosen = sel || picked;
  const list = db.lorebooks.all().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const close = () => { setSel(null); onClose(); };
  const tap = b => {
    if (!multi) { onPick(b); close(); return; }
    setSel(chosen.includes(b.id) ? chosen.filter(x => x !== b.id) : [...chosen, b.id]);
  };
  return html`
    <${Sheet} open=${open} onClose=${close} title=${title || (multi ? '选择世界书' : '选择一本世界书')} height="70%">
      ${list.length ? html`
        <${List} inset=${false}>
          ${list.map(b => html`
            <${ListItem} key=${b.id} title=${b.name || '未命名世界书'}
              subtitle=${`${(b.entries || []).length} 个条目`}
              left=${html`<${Icon} name="book" size=${18}/>`}
              right=${multi && chosen.includes(b.id) ? html`<${Icon} name="check" size=${18}/>` : null}
              onClick=${() => tap(b)}/>`)}
        <//>
        ${multi ? html`
          <div class="sheet-acts">
            <${Button} variant="ghost" onClick=${close}>取消<//>
            <${Button} onClick=${() => { onPick(chosen); close(); }}>选定 ${chosen.length} 本<//>
          </div>` : null}`
      : html`<${EmptyState} icon="book" title="暂无世界书" desc="可在「世界书」中新建。"/>`}
    <//>`;
}

/** 生成出来的一段文字。可以选中，右上角复制 */
export const OutBox = ({ text, title = '结果', actions }) => html`
  <div class="tb-out-wrap">
    <div class="tb-out-head">
      <span>${title}</span>
      <button class="tb-out-copy press" onClick=${() => copyText(text)}>
        <${Icon} name="copy" size=${15}/>复制
      </button>
    </div>
    <div class="tb-out">${text}</div>
    ${actions ? html`<div class="btn-row tb-out-acts">${actions}</div>` : null}
  </div>`;

/** 生成按钮下面那一行：这一下调用几次接口 */
export const CallNote = ({ n = 1, extra = '' }) => html`
  <div class="tb-call">点一次调用 ${n} 次接口${extra ? `。${extra}` : ''}</div>`;

export const fmtTime = t => {
  const d = new Date(t || 0);
  const p = v => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ---- 内置工具的设置：填的东西随手存下，离开再回来还在 ----
//
// loadNo 防的是这一种覆盖：从历史里「载入到生成器」时，生成器页可能还在栈里，
// 它卸载时会把自己手上那份旧的写回去。载入时 loadNo 加一，页面写回前先比一比，
// 库里的已经是更新的一次载入，就不写。
export function useToolState(id, def) {
  const [f, setF] = useState(() => ({ ...def, ...toolbox.stateOf(id) }));
  const ref = useRef(f);
  ref.current = f;
  const save = v => {
    if ((toolbox.stateOf(id).loadNo || 0) !== (v.loadNo || 0)) return;
    toolbox.setState(id, v);
  };
  useEffect(() => {
    const t = setTimeout(() => save(f), 500);
    return () => clearTimeout(t);
  }, [f]);
  useEffect(() => () => save(ref.current), []);
  const set = patch => setF(s => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));
  return [f, set, ref];
}

export function loadToolState(id, next) {
  const no = (toolbox.stateOf(id).loadNo || 0) + 1;
  toolbox.setState(id, { ...next, loadNo: no });
}

// ---- 改这个工具用的提示词模板 ----
//
// 存进 settings.promptTemplates（CLAUDE.md 第 11 条）。「对话 - 提示词模板」里那一行是同一份，
// 两处改的是同一个东西，不是两份。
export function TemplateSheet({ id, open, onClose, title = '提示词模板' }) {
  useStore(db.settings.store);
  const cur = phone.ai.template(id);
  const [text, setText] = useState(null);
  const shown = text ?? cur;
  const def = phone.ai.templates[id] || '';
  const close = () => { setText(null); onClose(); };
  const save = () => {
    const pt = { ...(db.settings.get().promptTemplates || {}) };
    if (String(shown).trim() && shown !== def) pt[id] = shown; else delete pt[id];
    db.settings.set({ promptTemplates: pt });
    toast('已保存', 'ok');
    close();
  };
  return html`
    <${Sheet} open=${open} onClose=${close} title=${title} height="90%">
      <div class="hint-box">
        模型收到的指令骨架。双花括号中的名称会在生成时替换为本次的内容，请保留。
        ${shown !== def ? '当前为修改过的版本。' : '当前为默认版本。'}
      </div>
      <textarea class="tb-code tb-tpl" rows="16" value=${shown} spellcheck="false"
        onInput=${e => setText(e.target.value)}></textarea>
      <div class="sheet-acts">
        <${Button} variant="ghost" onClick=${() => setText(def)}>恢复默认<//>
        <${Button} onClick=${save}>保存<//>
      </div>
    <//>`;
}

/** 本次实际发出的提示词：看一眼、复制，改模板 */
export function PromptPreview({ open, onClose, text, templateId }) {
  const [tpl, setTpl] = useState(false);
  return html`
    <${Sheet} open=${open && !tpl} onClose=${onClose} title="本次提示词" height="86%">
      <${OutBox} text=${text} title="发给模型的指令"/>
      <div class="sheet-acts">
        <${Button} variant="ghost" onClick=${() => setTpl(true)}>修改模板<//>
        <${Button} onClick=${onClose}>关闭<//>
      </div>
    <//>
    <${TemplateSheet} id=${templateId} open=${open && tpl} onClose=${() => setTpl(false)}/>`;
}

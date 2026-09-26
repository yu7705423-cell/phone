import { settings } from './db/index.js';

// 线下的文风。
//
// **内置提示词一个字都不写文风**（CLAUDE.md 第 16 条）—— 写了，所有角色的
// 散文就变成同一个人写的，而那个人是写规则的人。但「这一场写成什么样」
// 本来就该有人决定，那个人是用户。这里就是他决定的地方。
//
// 所以：出厂带几份预设，**一份都不默认启用**；选中哪一份是一场一场定的，
// 每一份都能改、能删、能自己新建。和「不要写这些」同一个道理：
// 内置那份是空的，装它的句子由代码提供，内容全是用户填的。
//
// 正文一律英文。中文指令会把自己的措辞漏进输出里（第 14 条）—— 文风这一段
// 尤其如此：用中文写「句子要短」，模型交回来的就是说明书腔的短句。
// 用户自己改成什么语言是他的事，出厂这几份按规矩来。

export const BUILTIN = [
  {
    id: 'lean',
    name: '克制',
    text: `Short sentences. Concrete nouns and verbs.
No metaphor, no simile.
Interior states are shown through action and through what is said, and are
not named directly.`,
  },
  {
    id: 'dense',
    name: '绵密',
    text: `Long sentences carrying subordinate clauses.
Sensory detail is sustained across several lines before the passage moves on.
Interior states are written out at length.`,
  },
  {
    id: 'script',
    name: '剧本式',
    text: `Present tense throughout.
Action and dialogue are on separate lines.
Only what a camera in the room could record is written: no interior states.`,
  },
  {
    id: 'second',
    name: '第二人称',
    text: `Address {{userName}} in the second person throughout the passage.
{{charName}} is still written in the third person.`,
  },
];

// 用户改过的那些。id 指向 { name, text }；值为 null 表示这一份删掉了。
const overrides = () => settings.get().tonePresets || {};

export function list() {
  const ov = overrides();
  const out = BUILTIN
    .filter(b => ov[b.id] !== null)
    .map(b => ({ ...b, ...(ov[b.id] || {}), builtin: true }));
  Object.entries(ov).forEach(([id, v]) => {
    if (v && !BUILTIN.some(b => b.id === id)) out.push({ id, name: v.name || '未命名', text: v.text || '' });
  });
  return out;
}

export const get = id => list().find(x => x.id === id) || null;
export const textOf = id => get(id)?.text || '';

export function save(id, patch) {
  const ov = { ...overrides() };
  const cur = get(id);
  ov[id] = { name: patch.name ?? cur?.name ?? '未命名', text: patch.text ?? cur?.text ?? '' };
  settings.set({ tonePresets: ov });
  return ov[id];
}

export function create({ name = '未命名', text = '' } = {}) {
  const id = `tone${Date.now().toString(36)}`;
  save(id, { name, text });
  return id;
}

/** 删掉。内置那几份删不干净，只能记一个 null 把它盖住，否则下次又冒出来。 */
export function remove(id) {
  const ov = { ...overrides() };
  if (BUILTIN.some(b => b.id === id)) ov[id] = null;
  else delete ov[id];
  settings.set({ tonePresets: ov });
}

/** 恢复出厂的那几份，用户自己新建的不动。 */
export function resetBuiltin() {
  const ov = { ...overrides() };
  BUILTIN.forEach(b => { delete ov[b.id]; });
  settings.set({ tonePresets: ov });
}

/**
 * 这一场（或这一部）选了哪几份。可以多选（ARCHITECTURE 4.267）：新数据存 `tones` 数组，
 * 老数据只有一个 `tone` 字符串，照读成一项。`custom` 也是其中一项，正文在 `toneText`。
 */
export function idsOf(row) {
  if (Array.isArray(row?.tones)) return row.tones.map(x => String(x || '').trim()).filter(Boolean);
  const one = String(row?.tone || '').trim();
  return one ? [one] : [];
}

/** 入库前整理：去重、去空。字符串也收（老调用方还传单个 id） */
export const asTones = v => [...new Set((Array.isArray(v) ? v : [v]).map(x => String(x || '').trim()).filter(Boolean))];

/** 这一场实际要用的那段文字。选了几份就几段，按选的顺序空行隔开；custom 用这一场自己写的。 */
export function forScene(scene) {
  const out = [];
  for (const id of idsOf(scene)) {
    const t = id === 'custom' ? String(scene?.toneText || '').trim() : textOf(id);
    if (t) out.push(t);
  }
  return out.join('\n\n');
}

/** 列表上写几个字：选了哪几份的名字。 */
export function labelOf(row) {
  const names = idsOf(row).map(id => (id === 'custom' ? '自己写' : get(id)?.name || '')).filter(Boolean);
  return names.join('、') || '不设定';
}

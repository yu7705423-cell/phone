import { template, runJSONTask, runTextTask } from '../engine.js';
import { fillTemplate } from '../templates.js';
import { parseJSON } from '../sse.js';

// 工具箱内置工具的那几次请求。见 ARCHITECTURE 4.247
//
// 每一个函数就是一次请求，都由用户点了才发（第 15 条）：没有自动重试之外的第二次，
// 没有定时，也不顺带做别的。要多次的（世界观逐个模块写、世界书分阶段）由页面一次次地调，
// 页面上先写明这一下总共几次。
//
// 篇幅不封顶（第 13 条）：maxTokens 按用户要的字数往上算，没填字数就给一个宽的默认值。

const str = v => String(v ?? '').trim();
const tokensFor = (chars, floor = 3000) => Math.max(floor, Math.round((Number(chars) || 0) * 2.2) + 1200);
const section = (title, body) => (str(body) ? `## ${title}\n${str(body)}` : '');

// ---- 世界观 ----

// 九个模块。title 是输出里的标题，也是切分结果时认的标记；covers 进 prompt，所以是英文。
// 内容来自用户给的世界观拆法（从世界基础到日常质感），见 ARCHITECTURE 4.247
export const WORLD_MODULES = [
  { id: 'basis', title: '世界基础',
    covers: 'Era; geography, including countries, cities, regions and important places; the form of society; the level of technology or magic; any supernatural rules; and exactly how this world differs from the real one. One sentence that pins down the basic shape of the world is worth more than pages of history.' },
  { id: 'history', title: '历史因果',
    covers: 'Only the history that shapes the present: major events, who changed the world, wars, disasters, revolutions, breakthroughs; why current institutions exist; why certain customs formed; why people fear, worship or shun certain things. Follow each chain of cause and effect down to what an ordinary person notices today.' },
  { id: 'society', title: '社会运行',
    covers: 'How ordinary people live day to day: money, work, education, medicine, law, government, religion, family structure, class, marriage, crime, consumption, media, networks, transport, entertainment. Focus on what stories touch. For example: a character is late; how do they travel, what does it cost, how does the employer respond, can they take leave.' },
  { id: 'culture', title: '文化习俗',
    covers: 'What people believe: what counts as normal, what is shameful, what earns pride; views of family, love, death, wealth and work; gender norms; religion and taboos; etiquette and forms of address; festivals, food, aesthetics, popular culture. These decide how characters speak and choose.' },
  { id: 'power', title: '权力结构',
    covers: 'Who holds power, who depends on whom, who controls resources, who fears whom, who makes the rules, who can break them, and whether ordinary people have room to push back. Short and concrete, not a political science report.' },
  { id: 'resources', title: '核心资源',
    covers: 'What is scarce and important in this world: money, land, energy, magic, information, identity, education, medicine, a special ability, a rare material, time. For each one: who holds it, who wants it, who profits from it, who is held back by it.' },
  { id: 'rules', title: '世界规则',
    covers: 'How the supernatural, technological or other special mechanisms work: where the power comes from, who can use it, what it costs, what it can and cannot do, whether it has levels, how it is countered, whether ordinary people know about it, how the state manages it. The limits matter most.' },
  { id: 'people', title: '人物处境',
    covers: 'For the main characters: class, family background, education, occupation, social identity, rights they enjoy, resources they lack, how they see this society, what the world expects of them, and whether they go against those expectations.' },
  { id: 'texture', title: '日常质感',
    covers: 'Small concrete details of daily life that do not drive the plot but make the place feel lived in: light and weather at certain hours, what people do at certain places, smells, sounds, the habits of a season.' },
];

const moduleOf = id => WORLD_MODULES.find(m => m.id === id);

/**
 * 按「## 标题」把一段输出切回各模块。认不出的标题并进上一块；第一个标题之前的字丢掉。
 * 回来的是 { 模块 id: 正文 }
 */
export function splitModules(text, ids) {
  const want = (ids || WORLD_MODULES.map(m => m.id)).map(moduleOf).filter(Boolean);
  const norm = s => String(s).replace(/[#*\s：:。.、0-9一二三四五六七八九十]/g, '');
  const out = {};
  let cur = null;
  for (const line of String(text || '').split('\n')) {
    const h = line.match(/^#{1,4}\s*(.+?)\s*$/);
    const hit = h && want.find(m => norm(h[1]).includes(norm(m.title)));
    if (hit) { cur = hit.id; out[cur] = out[cur] || ''; continue; }
    if (cur) out[cur] += `${line}\n`;
  }
  Object.keys(out).forEach(k => { out[k] = out[k].trim(); });
  return out;
}

function worldSystem({ premise, notes, existing, people, modules, length }) {
  const list = modules.map(m => {
    const d = moduleOf(m.id);
    return [`### ${d.title}`, `What it covers: ${d.covers}`,
      str(m.picks) ? `Elements the user picked for this module. Every one of them appears in the module:\n${str(m.picks)}` : '',
      str(m.note) ? `The user's notes for this module:\n${str(m.note)}` : ''].filter(Boolean).join('\n');
  }).join('\n\n');
  return fillTemplate(template('task.world-build'), {
    premise: str(premise) || '(not given; infer a coherent world from the notes below)',
    notes: section('Further requirements from the user', notes),
    existing: section('Existing setting to stay consistent with', existing),
    people: section('Main characters whose situation the module on characters must cover', people),
    modules: list,
    length: Number(length) > 0
      ? `Each module runs to about ${Math.round(length)} characters`
      : 'Write each module at the length its content needs',
  });
}

/** 一次写完所勾选的全部模块。一次请求 */
export async function worldBuild(input, { key } = {}) {
  const modules = (input.modules || []).filter(m => moduleOf(m.id));
  if (!modules.length) throw new Error('尚未勾选任何模块');
  const raw = await runTextTask('tool.world', {
    system: worldSystem({ ...input, modules }),
    key: key || `tool-world:${Date.now()}`,
    maxTokens: tokensFor((Number(input.length) || 0) * modules.length, 8000),
  });
  const got = splitModules(raw, modules.map(m => m.id));
  if (!Object.keys(got).length) {
    const err = new Error('没能从模型的回复中读出任何模块');
    err.raw = raw;
    throw err;
  }
  return got;
}

/** 只写一个模块（逐个模块写的那一种，以及单独重写一块）。一次请求 */
export async function worldModule({ id, worldText, instruction, picks, length }, { key } = {}) {
  const d = moduleOf(id);
  if (!d) throw new Error('未知的模块');
  const raw = await runTextTask('tool.world', {
    system: fillTemplate(template('task.world-module'), {
      world: str(worldText) || '(nothing written yet)',
      title: d.title,
      covers: d.covers,
      instruction: [
        section('Elements the user picked for this module. Every one of them appears in the module', picks),
        section('The user\'s instruction for this module', instruction),
      ].filter(Boolean).join('\n\n'),
      length: Number(length) > 0 ? `About ${Math.round(length)} characters` : 'Write at the length the content needs',
    }),
    key: key || `tool-world-${id}:${Date.now()}`,
    maxTokens: tokensFor(length, 3000),
  });
  return str(raw).replace(/^#{1,4}\s*.+\n/, (m) => (m.includes(d.title) ? '' : m)).trim();
}

/**
 * 给世界观的某个模块、某一小类批量生成标签。一次请求。
 * 回来的是一串短标签（已去掉与现有重复的）
 */
export async function worldTags({ id, group, premise, existing = [], theme, count }, { key } = {}) {
  const d = moduleOf(id);
  if (!d) throw new Error('未知的模块');
  const raw = await runTextTask('tool.world', {
    system: fillTemplate(template('task.world-tags'), {
      module: d.title, covers: d.covers, group: str(group) || '(any part of this module)',
      premise: str(premise) || '(not given)', theme: str(theme) || '(no direction given)',
      existing: existing.join(', ') || '(none)', count: Math.max(1, Math.round(Number(count) || 10)),
    }),
    key: key || `tool-world-tags:${Date.now()}`, maxTokens: 2000,
  });
  const arr = parseJSON(raw);
  const list = Array.isArray(arr) ? arr : (Array.isArray(arr?.tags) ? arr.tags : []);
  const seen = new Set(existing);
  return list.map(x => str(typeof x === 'string' ? x : x?.tag)).filter(t => t && !seen.has(t) && seen.add(t));
}

// ---- NPC ----

/**
 * 一批 NPC。一次请求。
 * 回来的每一个：name gender age birthday signature relation reverse，外加 fields（用户勾选的那几项）
 */
/** NPC 生成器这一次的 system prompt。生成器页上的「本次提示词」看的也是它 */
export function npcSystem(input) {
  const count = Math.max(1, Math.round(Number(input.count) || 1));
  const fields = (input.fields || []).filter(Boolean);
  return fillTemplate(template('task.npc-tool'), {
    main: str(input.main) || '(not given; write people for an unnamed main character)',
    cast: section('Other characters present in the story. The people you write may relate to them too', input.cast),
    world: section('World background', input.world),
    existing: section('People who already exist. Do not repeat them', input.existing),
    requirements: str(input.requirements) || '(no further requirements)',
    banned: section('Must not appear in any of the people you write. These are hard limits', input.banned),
    fields: fields.join(', ') || 'appearance, personality, background',
    length: Number(input.length) > 0
      ? `The fields of one person together run to about ${Math.round(input.length)} characters.`
      : '',
    count,
  });
}

export async function npcGenerate(input, { key, system } = {}) {
  const count = Math.max(1, Math.round(Number(input.count) || 1));
  const r = await runJSONTask('tool.npc', {
    system: str(system) || npcSystem(input),
    key: key || `tool-npc:${Date.now()}`,
    maxTokens: tokensFor((Number(input.length) || 400) * count, 4000),
  });
  const rows = Array.isArray(r?.npcs) ? r.npcs : (Array.isArray(r) ? r : []);
  const out = rows.map(n => ({
    name: str(n?.name), gender: str(n?.gender), age: str(n?.age), birthday: str(n?.birthday),
    signature: str(n?.signature), relation: str(n?.relation), reverse: str(n?.reverse),
    fields: Object.fromEntries(Object.entries(n?.fields && typeof n.fields === 'object' ? n.fields : {})
      .map(([k, v]) => [str(k), str(typeof v === 'string' ? v : JSON.stringify(v))]).filter(([k, v]) => k && v)),
  })).filter(n => n.name);
  if (!out.length) throw new Error('模型没有给出可用的 NPC');
  return out;
}

// ---- 世界书 ----

// 写作契约。进 prompt 的那份在 task.lore-body 里；这里是自检、审查、修订时拿去对照的同一份
export const LORE_CONTRACT = [
  'R1 Guidance before prohibition: write what to do; keep prohibitions for real red lines, each with the thing to do instead',
  'R2 Root cause, grouped by kind: one rule covers a family of problems',
  'R3 Do not copy the user\'s wording: translate symptoms into executable rules',
  'R4 Structure: one responsibility per section, each constraint in one place, consistent format',
  'R6 Outline first: every outline node is covered in the body',
  'R7 Executable sentences: condition, action, degree; not atmosphere prose',
  'R8 No stock phrasing: specific to this world, not formulaic',
].join('\n');

const FORMAT_LINE = {
  natural: '- Format: natural language, organised by "## " headings',
  yaml: '- Format: YAML inside each section. No code fence, and no explanation outside the YAML',
  xml: '- Format: XML inside each section. No code fence, and no explanation outside the XML',
};

function loreRequest(f) {
  return [
    str(f.inject) ? `## Written by the user. This outranks everything below; where they conflict, follow it\n${str(f.inject)}` : '',
    `## What the lorebook must solve\n${str(f.question) || '(not given)'}`,
    section('Further requirements', f.tuning),
    str(f.language) ? `## Language\nWrite the lorebook in ${str(f.language)}.` : '## Language\nWrite in the same language as the request.',
    str(f.target) ? `## Target model\nThis lorebook will be injected into ${str(f.target)}.` : '',
    section('Lorebooks already in this series. Do not repeat or contradict what they already govern', f.series),
  ].filter(Boolean).join('\n\n');
}

const loreLength = n => (Number(n) > 0
  ? `- Length: about ${Math.round(n)} characters. Do not pad`
  : '- Length: as much as the rules need. Do not pad');

export async function loreOutline(f, { key } = {}) {
  return str(await runTextTask('tool.lore', {
    system: fillTemplate(template('task.lore-outline'), { request: loreRequest(f) }),
    key: key || `tool-lore-outline:${Date.now()}`, maxTokens: 3000,
  }));
}

export async function loreBody(f, outline, { key } = {}) {
  return str(await runTextTask('tool.lore', {
    system: fillTemplate(template('task.lore-body'), {
      request: loreRequest(f),
      outline: section('The outline to follow, section by section', outline),
      format: FORMAT_LINE[f.format] || FORMAT_LINE.natural,
      length: loreLength(f.length),
    }),
    key: key || `tool-lore-body:${Date.now()}`, maxTokens: tokensFor(f.length, 8000),
  }));
}

export async function loreExamples(body, count, { key } = {}) {
  return str(await runTextTask('tool.lore', {
    system: fillTemplate(template('task.lore-examples'), { body, count: Math.max(1, Math.round(Number(count) || 2)) }),
    key: key || `tool-lore-ex:${Date.now()}`, maxTokens: 4000,
  }));
}

export async function loreSelfCheck(body, { key } = {}) {
  const raw = await runTextTask('tool.lore', {
    system: fillTemplate(template('task.lore-selfcheck'), { body, contract: LORE_CONTRACT }),
    key: key || `tool-lore-check:${Date.now()}`, maxTokens: 2000,
  });
  return parseJSON(raw) || { raw: str(raw) };
}

export async function loreReview(f, body, auditText, { key } = {}) {
  const raw = await runTextTask('tool.lore', {
    system: fillTemplate(template('task.lore-review'), {
      request: loreRequest(f), body, contract: LORE_CONTRACT, audit: str(auditText) || '(none)',
    }),
    key: key || `tool-lore-review:${Date.now()}`, maxTokens: 3000,
  });
  return parseJSON(raw) || { raw: str(raw) };
}

/** 修订：先写根因，再给整篇。回来的是 { causes, body } */
export async function loreRevise(f, body, feedback, auditText, { key } = {}) {
  const raw = str(await runTextTask('tool.lore', {
    system: fillTemplate(template('task.lore-revise'), {
      request: loreRequest(f), body, feedback: str(feedback) || '(see the checks below)',
      audit: section('Checks already run on this version', auditText), contract: LORE_CONTRACT,
    }),
    key: key || `tool-lore-revise:${Date.now()}`, maxTokens: tokensFor(f.length, 8000),
  }));
  const at = raw.search(/^#{1,3}\s*正文\s*$/m);
  if (at < 0) return { causes: '', body: raw };
  const causes = raw.slice(0, at).replace(/^#{1,3}\s*根因\s*$/m, '').trim();
  const rest = raw.slice(at).replace(/^#{1,3}\s*正文\s*\n?/, '');
  // 正文里的小节在修订稿中写成了 ###，放回 ##，与别的版本同一个格式
  return { causes, body: rest.replace(/^###\s/gm, '## ').trim() };
}

// ---- 番外 ----

const LEVEL = {
  raw: 'Compile strength: as written. Barely rewrite the user\'s wording; tidy the format only and add no new detail',
  polish: 'Compile strength: light polish. Clarify the wording so every requirement is executable; add only the detail that is needed; do not extend the plot',
  deep: 'Compile strength: detailed. Expand abstract tags into concrete behaviour, ways of interacting and scene requirements, so the target model knows what counts as done; still leave the plot to the user',
  bold: 'Compile strength: bold. Without changing the core idea, add layers, hooks and optional ways forward that give the target model more room',
};

export async function extraCompile(material, level = 'polish', { key } = {}) {
  const r = await runJSONTask('tool.extra', {
    system: fillTemplate(template('task.extra-compile'), { level: LEVEL[level] || LEVEL.polish, material }),
    key: key || `tool-extra-compile:${Date.now()}`, maxTokens: 6000,
  });
  if (!str(r?.prompt)) throw new Error('模型没有给出整理后的提示词');
  return { title: str(r.title), understanding: str(r.understanding), direction: str(r.direction), prompt: str(r.prompt) };
}

export async function extraStoryline(material, { key } = {}) {
  const raw = await runTextTask('tool.extra', {
    system: fillTemplate(template('task.extra-storyline'), { material }),
    key: key || `tool-extra-story:${Date.now()}`, maxTokens: 1500,
  });
  return str(raw).replace(/^["「『]|["」』]$/g, '');
}

export async function extraTags({ category, theme, existing, count }, { key } = {}) {
  const raw = await runTextTask('tool.extra', {
    system: fillTemplate(template('task.extra-tags'), {
      category, theme: str(theme) || '(no direction given)',
      existing: (existing || []).join(', ') || '(none)',
      count: Math.max(1, Math.round(Number(count) || 8)),
    }),
    key: key || `tool-extra-tags:${Date.now()}`, maxTokens: 3000,
  });
  const arr = parseJSON(raw);
  const list = Array.isArray(arr) ? arr : (Array.isArray(arr?.tags) ? arr.tags : []);
  return list.map(x => ({ tag: str(x?.tag), meaning: str(x?.meaning) })).filter(x => x.tag);
}

// ---- HTML 卡片生成器（ARCHITECTURE 4.252）----
//
// 一次生成、一次修改，各是一次请求，都是用户点了才发。模板很长，塞进 JSON 字符串里转义容易坏，
// 所以让模型分两段交：<card-meta> 里是 JSON，<card-html> 里是原样的模板。

const IMAGES_OFF = 'Nothing is loaded from the network: draw with CSS, inline SVG and data: URIs only.';
const imagesRule = urls => (urls.length
  ? `These image addresses may be used exactly as given, in src or url(): ${urls.join(' , ')}. Nothing else is loaded from the network.`
  : IMAGES_OFF);

/** 模型交回来的两段拆开。拆不出模板就报错，原文挂在 err.raw 上 */
export function splitCard(raw) {
  const text = String(raw || '');
  const metaText = (text.match(/<card-meta>([\s\S]*?)<\/card-meta>/i) || [])[1] || '';
  const html = ((text.match(/<card-html>([\s\S]*?)(?:<\/card-html>|$)/i) || [])[1] || '').trim();
  if (!html) {
    const err = new Error('没能从模型的回复中读出卡片模板');
    err.raw = text;
    throw err;
  }
  const meta = parseJSON(metaText) || {};
  const fields = {};
  if (meta.fields && typeof meta.fields === 'object') {
    for (const [k, v] of Object.entries(meta.fields)) {
      fields[str(k)] = {
        desc: str(v?.desc), max: Math.max(0, Math.round(Number(v?.max) || 0)), long: v?.long === true,
      };
    }
  }
  return {
    name: str(meta.name), description: str(meta.description),
    keywords: (Array.isArray(meta.keywords) ? meta.keywords : []).map(str).filter(Boolean),
    fields, sample: str(meta.sample), html,
  };
}

export async function cardGenerate({ request, width, height, prefix, urls = [], image = null }, { key } = {}) {
  const raw = await runTextTask('tool.card', {
    system: fillTemplate(template('task.cardgen'), {
      request, width, height, prefix, images: imagesRule(urls),
    }),
    image: image || undefined,
    key: key || `tool-card:${Date.now()}`, maxTokens: 9000,
  });
  return splitCard(raw);
}

export async function cardRevise({ meta, html, change, urls = [] }, { key } = {}) {
  const raw = await runTextTask('tool.card', {
    system: fillTemplate(template('task.cardgen-edit'), {
      meta: JSON.stringify(meta), html, change, images: imagesRule(urls),
    }),
    key: key || `tool-card-edit:${Date.now()}`, maxTokens: 9000,
  });
  return splitCard(raw);
}

/**
 * 用户自己发卡片时的「帮我填」（ARCHITECTURE 4.253）。用户点了才发，一次请求。
 * 交回来的是角色那种写法，取出方括号之间那几行交给 htmlcard.parseValues 读
 */
export async function cardFill({ card, name, idea, charName, userName, recent }, { key } = {}) {
  const raw = await runTextTask('card.fill', {
    system: fillTemplate(template('task.card-fill'), {
      card, name, idea: str(idea) || '(nothing specific; fit the recent chat)',
      char: charName || 'the character', user: userName || 'the user', recent: str(recent) || '(none)',
    }),
    key: key || `card-fill:${Date.now()}`, maxTokens: 2000,
  });
  const text = String(raw || '');
  const m = text.match(/[[【]\s*(?:卡片|card)\s*[:：][^\]】\n]*[\]】]([\s\S]*?)(?:[[【]\s*\/\s*(?:卡片|card)\s*[\]】]|$)/i);
  return (m ? m[1] : text).trim();
}

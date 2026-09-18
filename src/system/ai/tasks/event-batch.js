import { settings } from '../../db/index.js';
import * as events from '../../events.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask } from '../engine.js';

// 批量生成随机事件。
//
// 这是一次**单独的调用**，和聊天没有任何关系 —— 不带人设、不带历史、
// 不占会话的上下文预算。生成出来的东西也不属于任何一个角色：
// 「路上堵车」是可能落在任何人头上的一件事。
//
// 一格一次调用。格子就是 领域 × 色彩，用户在每个格子里自己填要几条。
// 分格生成比一次要一大堆强得多：同一次调用里混着「好事」和「坏事」，
// 模型会不自觉地凑成对，写出来的东西全是「虽然……但是……」。
//
// 去重做两道：
//   **生成前** 把这一格已经有的发过去，明说不要重复；
//   **落库时** 再按去标点的形比一遍 —— 模型换个说法照样会重。
// 第二道才是真正兜底的那一道，第一道只是让它少浪费几条。

const str = v => String(v ?? '').trim();

// 发给模型的「已经有的」。默认全给（CLAUDE.md 第 13 条），
// 库大到觉得费钱可以在「设置 - 用量与上限」里改成只给最近若干条。
function existingFor(domain, tone) {
  const n = Math.max(0, settings.get().eventDedupeList || 0);
  const rows = events.list({ domain, tone });
  const use = n > 0 ? rows.slice(-n) : rows;
  return use.map(e => `- ${e.text}`).join('\n');
}

export const batchKey = (domain, tone) => `event-batch:${domain}:${tone}`;

/**
 * 生成一格。返回的是**还没入库**的行，交给界面先让人看一眼。
 * 这是 CLAUDE.md 第 6 条里那个例外：不看内容就没法判断，而且东西还没入库。
 */
export async function generateCell({ domain, tone, rarity = 'common', count }) {
  const d = events.domainOf(domain);
  const t = events.toneOf(tone);
  const r = events.rarityOf(rarity);
  if (!d || !t) throw new Error('领域或色彩不对');
  const n = Math.max(1, Math.round(count) || 0);

  const system = fillTemplate(template('task.event-batch'), {
    domain: d.label, domainHint: d.hint,
    tone: t.label, toneHint: t.hint,
    rarity: r.label, rarityHint: r.hint,
    count: n,
    existing: existingFor(domain, tone) || '（这一格还是空的）',
  });

  const out = await runJSONTask('event.batch', {
    system,
    key: batchKey(domain, tone),
    // 一条二十来字，给足了余量。不封顶：想要几百条是用户的事（第 13 条）
    maxTokens: 400 + n * 60,
  });

  const rows = Array.isArray(out?.events) ? out.events : [];
  const seen = new Set();
  return rows
    .map(x => str(typeof x === 'string' ? x : x?.text).slice(0, 60))
    .filter(text => {
      const key = events.normalize(text);
      if (!key || seen.has(key)) return false;       // 同一批里自己重了
      if (events.has(text, { domain, tone })) return false;  // 和库里已有的重了
      seen.add(key);
      return true;
    })
    .map(text => ({ domain, tone, rarity: r.id, text }));
}

/**
 * 跑一整张表。plan 是 { 'env:good': 10, ... }，只跑填了数的那几格。
 * onStep 每跑完一格调一次，界面照着它显示进度。
 *
 * 一格失败不拖垮整张表 —— 九格里有一格接口抽风，不该把另外八格也扔掉。
 */
export async function generatePlan(plan, { rarity = 'common', onStep } = {}) {
  const jobs = Object.entries(plan || {})
    .map(([cell, count]) => {
      const [domain, tone] = String(cell).split(':');
      return { cell, domain, tone, count: Math.max(0, Math.round(count) || 0) };
    })
    .filter(j => j.count > 0 && events.domainOf(j.domain) && events.toneOf(j.tone));

  const out = [];
  const failed = [];
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    onStep && onStep({ done: i, total: jobs.length, cell: j.cell, phase: 'start' });
    try {
      const rows = await generateCell({ ...j, rarity });
      out.push(...rows);
      onStep && onStep({ done: i + 1, total: jobs.length, cell: j.cell, phase: 'done', got: rows.length });
    } catch (err) {
      failed.push({ cell: j.cell, message: String(err.message || err) });
      onStep && onStep({ done: i + 1, total: jobs.length, cell: j.cell, phase: 'fail' });
    }
  }
  return { rows: out, failed, cells: jobs.length };
}

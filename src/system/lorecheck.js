// 世界书生成器的本地审查。不调接口，每一版生成完当场跑一遍。见 ARCHITECTURE 4.247
//
// 查的是写作契约里机械可查的那几条（R1 R2 R3 R4 R6 R7 R8）。查不到的（句子是不是真的
// 可判定、约束是不是打中了根因）留给「独立审查」那一次请求，由用户决定开不开。
//
// 词表来自用户给的世界书生成器。这里的词是被检查的**内容**，不是界面文案。

// 套路化表达。写进世界书，生成时会被放大成整篇的腔调
const STOCK_HARD = ['我就在这', '我一直都在', '我会一直在', '我哪儿也不去', '有我在', '稳稳接住', '稳稳地接住',
  '破碎感', '心脏漏了一拍', '心跳漏了一拍', '瞳孔地震', '揉进骨血', '刻进骨子里', '宣示主权',
  '而这一切才刚刚开始', '故事还在继续', '未完待续', '空气仿佛凝固', '时间仿佛静止'];
const STOCK_SOFT = ['接住', '钝痛', '安全感', '喉结', '指尖微颤', '指腹摩挲', '尾音', '勾唇', '勾了勾唇', '挑眉',
  '眯起眼', '危险地', '呼吸一滞', '掌心的温度', '仿佛整个世界', '某种意义上', '在这一刻', '下一秒', '与此同时',
  '不容拒绝', '命令般', '低沉沙哑', '蛊惑', '沦陷', '占有欲', '致命的'];

const PROHIBIT = /不要|禁止|不得|不能|不可|不准|严禁|切勿|避免|不应|不许|请勿|绝不|永远不|别(?=[写说让用做把给再去])/;
const ALTERNATIVE = /而是|而应|改为|改写为|取而代之|正确做法|正确写法|应改成|替代|换成|代替|改用|作为替代|与之相对|应当|应该/;
const ACTION = /当|若|如果|每当|一旦|时，|应|须|需要|写|用|保持|按|列出|给出|输出|使用|采用|控制在|限定|优先|统一|一律/;
const PROSE = /仿佛|宛如|如同|像是|似乎|好像|恍若|犹如|宛若/;

const sentencesOf = text => String(text || '')
  .split(/[。！？；\n]+/).map(s => s.replace(/^[\s\-*#>·\d.、)）]+/, '').trim()).filter(s => s.length >= 4);

const bigrams = s => {
  const out = new Set();
  const t = s.replace(/\s+/g, '');
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
};
const jaccard = (a, b) => {
  let n = 0;
  a.forEach(x => { if (b.has(x)) n += 1; });
  return n / (a.size + b.size - n || 1);
};

// 在 body 里找与 src 相同、至少 min 个字的片段
function copied(body, src, min = 12) {
  const hits = [];
  const b = String(body || '');
  const s = String(src || '').replace(/\s+/g, '');
  let i = 0;
  while (i <= s.length - min) {
    let len = min;
    if (!b.includes(s.slice(i, i + len))) { i += 1; continue; }
    while (i + len < s.length && b.includes(s.slice(i, i + len + 1))) len += 1;
    hits.push(s.slice(i, i + len));
    i += len;
  }
  return hits;
}

const headingsOf = text => String(text || '').split('\n')
  .map(l => l.match(/^#{1,4}\s*(.+?)\s*$/)).filter(Boolean).map(m => m[1]);
const norm = s => String(s).replace(/[\s#*：:。.、，,（）()\d一二三四五六七八九十]/g, '');

function structure(body, format) {
  const issues = [];
  const text = String(body || '');
  const chars = text.replace(/\s/g, '').length;
  if (format === 'yaml') {
    const seen = new Set();
    text.split('\n').forEach((l, i) => {
      const top = l.match(/^([^\s#-][^:]*):/);
      if (top) {
        if (seen.has(top[1])) issues.push({ line: i + 1, text: `顶层键「${top[1]}」重复，后一个会覆盖前一个` });
        seen.add(top[1]);
      }
      const ind = l.match(/^( +)\S/);
      if (ind && ind[1].length % 2) issues.push({ line: i + 1, text: '缩进不是 2 的倍数' });
    });
    if (chars > 600 && seen.size < 2) issues.push({ line: 0, text: `顶层只有 ${seen.size} 个键，分节不足` });
  } else if (format === 'xml') {
    const stack = [];
    const re = /<(\/?)([A-Za-z一-鿿_][\w一-鿿.-]*)[^>]*?(\/?)>/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[3]) continue;
      if (!m[1]) stack.push(m[2]);
      else if (stack[stack.length - 1] === m[2]) stack.pop();
      else { issues.push({ line: text.slice(0, m.index).split('\n').length, text: `闭合标签 </${m[2]}> 对不上` }); break; }
    }
    if (stack.length) issues.push({ line: 0, text: `标签没有闭合：${stack.slice(-3).join('、')}` });
  } else {
    const h = headingsOf(text).length;
    if (chars > 600 && h < 2) issues.push({ line: 0, text: `${chars} 字只有 ${h} 个小节标题，读起来是一整块` });
    else if (h && chars / h > 1500) issues.push({ line: 0, text: `${chars} 字只有 ${h} 个小节` });
  }
  return issues;
}

/**
 * 一版正文的本地审查。
 * 回来的是 { score, items: [{ id, name, status, summary, evidence: [{ line, text }], advice }], density }
 * status 是 pass、warn、fail、skip
 */
export function audit({ body = '', question = '', outline = '', format = 'natural' } = {}) {
  const items = [];
  const text = String(body || '');
  const sents = sentencesOf(text);
  const chars = Math.max(1, text.replace(/\s/g, '').length);

  // R1 引导优先于禁止
  const bans = sents.map((s, i) => ({ s, i })).filter(x => PROHIBIT.test(x.s));
  const bare = bans.filter(x => !ALTERNATIVE.test(x.s) && !ALTERNATIVE.test(sents[x.i + 1] || ''));
  items.push({
    id: 'R1', name: '引导优先于禁止',
    status: !bans.length || !bare.length ? 'pass' : bare.length / bans.length > 0.5 ? 'fail' : 'warn',
    summary: !bans.length ? '没有禁止性语句'
      : `禁止性语句 ${bans.length} 句，其中 ${bare.length} 句没有给出替代写法`,
    evidence: bare.slice(0, 6).map(x => ({ line: 0, text: x.s })),
    advice: '给每条禁止补一句正面写法：不是 X，而是 Y。禁止只留给真正不能越过的红线。',
  });

  // R2 同一约束说了几遍
  const long = sents.filter(s => s.length >= 8).slice(0, 400).map(s => ({ s, g: bigrams(s) }));
  const pairs = [];
  for (let i = 0; i < long.length && pairs.length < 8; i++) {
    for (let j = i + 1; j < long.length && pairs.length < 8; j++) {
      if (jaccard(long[i].g, long[j].g) >= 0.7) pairs.push([long[i].s, long[j].s]);
    }
  }
  items.push({
    id: 'R2', name: '按类归并',
    status: pairs.length >= 3 ? 'fail' : pairs.length ? 'warn' : 'pass',
    summary: pairs.length ? `${pairs.length} 处高度重复，同一约束说了不止一遍` : '没有发现重复的约束',
    evidence: pairs.slice(0, 4).map(([a, b]) => ({ line: 0, text: `${a} / ${b}` })),
    advice: '重复的约束合并到一处。重复陈述不会让模型更遵守，只会让权重互相干扰。',
  });

  // R3 照搬需求原文
  if (String(question || '').trim()) {
    const hits = copied(text, question);
    const rate = hits.reduce((n, h) => n + h.length, 0) / chars;
    items.push({
      id: 'R3', name: '不照搬用户原话',
      status: !hits.length ? 'pass' : rate > 0.1 ? 'fail' : 'warn',
      summary: hits.length ? `发现 ${hits.length} 处照搬需求原文的片段，占正文 ${(rate * 100).toFixed(1)}%` : '没有发现照搬需求原文的片段',
      evidence: hits.slice(0, 5).map(h => ({ line: 0, text: h })),
      advice: '需求里写的是现象，应翻译成可执行的规约再写入，而不是原样搬运。',
    });
  } else {
    items.push({ id: 'R3', name: '不照搬用户原话', status: 'skip', summary: '没有可对比的需求原文', evidence: [], advice: '' });
  }

  // R4 结构
  const st = structure(text, format);
  items.push({
    id: 'R4', name: '有结构',
    status: !st.length ? 'pass' : st.length > 2 ? 'fail' : 'warn',
    summary: st.length ? `结构问题 ${st.length} 处` : '结构自洽，分节清晰',
    evidence: st.slice(0, 5),
    advice: '每一节只负责一件事，同一约束只出现在一处，格式前后一致。',
  });

  // R6 大纲覆盖
  const nodes = headingsOf(outline).map(norm).filter(Boolean);
  if (nodes.length) {
    const bodyNorm = norm(text);
    const miss = headingsOf(outline).filter(h => !bodyNorm.includes(norm(h)));
    const cov = (nodes.length - miss.length) / nodes.length;
    items.push({
      id: 'R6', name: '先大纲后正文',
      status: cov >= 0.8 ? 'pass' : cov >= 0.5 ? 'warn' : 'fail',
      summary: `大纲 ${nodes.length} 个小节，正文落实 ${nodes.length - miss.length} 个（${Math.round(cov * 100)}%）`,
      evidence: miss.slice(0, 6).map(t => ({ line: 0, text: `大纲中有，正文中未找到：${t}` })),
      advice: '把漏掉的小节补进正文，或者把大纲中不应有的小节删去。两边须一致。',
    });
  } else {
    items.push({ id: 'R6', name: '先大纲后正文', status: 'skip', summary: '没有可对照的大纲', evidence: [], advice: '' });
  }

  // R7 执行性
  const exec = sents.filter(s => ACTION.test(s)).length;
  const prose = sents.filter(s => PROSE.test(s));
  const pct = Math.round((exec / Math.max(1, exec + prose.length)) * 100);
  items.push({
    id: 'R7', name: '执行性语句',
    status: prose.length > exec * 0.5 ? 'fail' : prose.length > exec * 0.2 ? 'warn' : 'pass',
    summary: `执行性语句 ${exec} 句，描写性语句 ${prose.length} 句，执行度 ${pct}%`,
    evidence: prose.slice(0, 5).map(s => ({ line: 0, text: s })),
    advice: '把描写句改成条件、动作、程度：什么时候、做什么、做到什么程度。',
  });

  // R8 套路化表达
  const hard = STOCK_HARD.filter(w => text.includes(w));
  const soft = STOCK_SOFT.filter(w => text.includes(w) && !hard.some(h => h.includes(w)));
  items.push({
    id: 'R8', name: '无套路化表达',
    status: hard.length ? 'fail' : soft.length >= 3 ? 'warn' : 'pass',
    summary: hard.length || soft.length ? `命中词表 ${hard.length + soft.length} 个：${[...hard, ...soft].slice(0, 6).join('、')}` : '没有命中词表',
    evidence: [...hard.map(w => ({ line: 0, text: `${w}（硬）` })), ...soft.map(w => ({ line: 0, text: `${w}（可疑）` }))].slice(0, 8),
    advice: '套路词写进世界书，生成时会被放大成整篇的腔调。换成这个世界里具体的东西。',
  });

  // 约束密度：每千字多少条要求
  const perK = Math.round((exec / chars) * 1000 * 10) / 10;
  const density = {
    perK,
    note: perK < 3 ? '约束偏松，关键行为没有可判定的落点，模型会按自己的默认习惯处理。'
      : perK > 40 ? '约束偏密，可能压缩了发挥空间。' : '约束密度在合理区间，既给了方向也留了发挥空间。',
  };

  const score = Math.max(0, 100 - items.reduce((n, x) => n + (x.status === 'fail' ? 15 : x.status === 'warn' ? 6 : 0), 0));
  return { score, items, density };
}

/** 审查结果写成一段文字（交给独立审查与修订那两次请求） */
export function auditText(a) {
  if (!a) return '';
  return (a.items || []).filter(x => x.status === 'warn' || x.status === 'fail')
    .map(x => `- ${x.id} ${x.status}: ${x.summary}${x.evidence?.length ? `; e.g. ${x.evidence.slice(0, 2).map(e => e.text).join(' | ')}` : ''}`)
    .join('\n');
}

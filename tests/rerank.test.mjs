import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

async function boot(extra = {}, { rerankFails = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
  page.on('pageerror', e => fail.push('PAGEERROR ' + e.message));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const ids = await page.evaluate(async ([extra]) => {
    const db = await import('/src/system/db/index.js');
    const acc = await import('/src/system/accounts.js');
    const me = acc.roots()[0] || acc.createRoot({ name: '我' });
    const a = db.characters.create({ name: '甲', persona: '一个人' });
    const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
    db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text',
      content: '午饭吃的什么', status: 'done' });
    const n = v => { const s = Math.hypot(...v); return new Float32Array(v.map(x => x / s)); };
    // 余弦顺序写死成 甲最高、乙次之、丙最低
    db.memories.create({ charId: a.id, personaId: me.id, content: 'AAA 记忆甲', category: 'fact',
      rank: 'B', keywords: [], vec: n([1, 0, 0, 0]), vecModel: 'm', vecAt: Date.now() });
    db.memories.create({ charId: a.id, personaId: me.id, content: 'BBB 记忆乙', category: 'fact',
      rank: 'B', keywords: [], vec: n([0.9, 0.44, 0, 0]), vecModel: 'm', vecAt: Date.now() });
    db.memories.create({ charId: a.id, personaId: me.id, content: 'CCC 记忆丙', category: 'fact',
      rank: 'B', keywords: [], vec: n([0.8, 0.6, 0, 0]), vecModel: 'm', vecAt: Date.now() });
    db.settings.set({
      memoryEnabled: true, memoryVector: true, memoryTopK: 12, memoryThreshold: 0.2,
      memoryRecent: 0,     // 近期那一档会把这三条常驻、从召回里排掉，这里测的是召回
      streamMode: 'once',   // 假接口回的是整包 JSON，不是 SSE
      ...extra,
      services: { ...db.settings.get().services,
        chat: { presets: [{ id: 'p1', name: '主用', provider: 'openai',
          baseUrl: 'https://fake.invalid/chat', apiKey: 'k', model: 'm' }], activeId: 'p1', fallbackId: null },
        embed: { baseUrl: 'https://fake.invalid/emb', apiKey: 'k', model: 'm', dims: 4 },
        rerank: { baseUrl: 'https://fake.invalid/rr', apiKey: 'k', model: 'Qwen/Qwen3-Reranker-8B' },
      },
    });
    return { chat: chat.id, char: a.id };
  }, [extra]);

  await page.evaluate(([rerankFails]) => {
    window.__hits = { emb: 0, rr: 0, chat: 0 };
    window.__prompts = [];
    const real = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!/fake\.invalid/.test(url)) return real(input, init);
      const J = (o, st = 200) => Promise.resolve(new Response(JSON.stringify(o),
        { status: st, headers: { 'content-type': 'application/json' } }));
      if (url.includes('/emb/')) {
        window.__hits.emb += 1;
        const body = JSON.parse(init.body);
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        return J({ data: inputs.map((_, i) => ({ index: i, embedding: [1, 0, 0, 0] })) });
      }
      if (url.includes('/rr/')) {
        window.__hits.rr += 1;
        if (rerankFails) return J({ error: 'boom' }, 500);
        // 故意给一个和余弦不同的顺序：丙、甲、乙
        return J({ results: [
          { index: 2, relevance_score: 0.99 },
          { index: 0, relevance_score: 0.50 },
          { index: 1, relevance_score: 0.10 },
        ] });
      }
      window.__hits.chat += 1;
      window.__prompts.push(String(init.body || ''));
      return J({ choices: [{ message: { content: '好呀' } }] });
    };
  }, [rerankFails]);
  return { page, ids };
}

const order = body => {
  const at = t => body.indexOf(t);
  return ['AAA', 'BBB', 'CCC'].filter(t => at(t) >= 0).sort((a, b) => at(a) - at(b)).join(',');
};

// ---- 1. 默认（重排关着）----
{
  const { page, ids } = await boot();
  const r = await page.evaluate(async ([c, ch]) => {
    const db = await import('/src/system/db/index.js');
    const engine = await import('/src/system/ai/engine.js');
    const cost = await import('/src/system/ai/cost.js');
    await engine.streamReply({ chat: db.chats.get(c), char: db.characters.get(ch) });
    return { hits: window.__hits, body: window.__prompts[0] || '', perTurn: cost.perTurn(c) };
  }, [ids.chat, ids.char]);
  check(r.hits.rr === 0, `默认不打重排接口（打了 ${r.hits.rr} 次）`);
  check(order(r.body) === 'AAA,BBB,CCC', `默认按余弦排：${order(r.body)}`);
  check(r.perTurn === 2, `每轮 ${r.perTurn} 次（回复 1 + 查询向量 1）`);
  await page.close();
}

// ---- 2. 开了重排 ----
{
  const { page, ids } = await boot({ rerankOn: true });
  const r = await page.evaluate(async ([c, ch]) => {
    const db = await import('/src/system/db/index.js');
    const engine = await import('/src/system/ai/engine.js');
    const cost = await import('/src/system/ai/cost.js');
    await engine.streamReply({ chat: db.chats.get(c), char: db.characters.get(ch) });
    return { hits: window.__hits, body: window.__prompts[0] || '',
      perTurn: cost.perTurn(c), worst: cost.worstPerTurn(c) };
  }, [ids.chat, ids.char]);
  check(r.hits.rr === 1, `重排接口打了 ${r.hits.rr} 次（应为 1）`);
  check(order(r.body) === 'CCC,AAA,BBB', `注入顺序跟着重排走：${order(r.body)}（余弦顺序是 AAA,BBB,CCC）`);
  check(r.perTurn === 3, `每轮 ${r.perTurn} 次（回复 1 + 查询向量 1 + 重排 1）`);
  await page.close();
}

// ---- 3. 重排挂了 ----
{
  const { page, ids } = await boot({ rerankOn: true }, { rerankFails: true });
  const r = await page.evaluate(async ([c, ch]) => {
    const db = await import('/src/system/db/index.js');
    const engine = await import('/src/system/ai/engine.js');
    let text = '', err = '';
    try { text = await engine.streamReply({ chat: db.chats.get(c), char: db.characters.get(ch) }); }
    catch (e) { err = e.message; }
    return { hits: window.__hits, body: window.__prompts[0] || '', text, err };
  }, [ids.chat, ids.char]);
  check(!r.err && r.text === '好呀', `重排挂了聊天照发（回复「${r.text}」${r.err}）`);
  check(order(r.body) === 'AAA,BBB,CCC', `退回余弦顺序：${order(r.body)}`);
  check(r.hits.chat === 1, '聊天接口只打了一次');
  await page.close();
}

// ---- 4. 没配接口时开不起来 ----
{
  const { page, ids } = await boot({ rerankOn: true });
  const r = await page.evaluate(async ([c, ch]) => {
    const db = await import('/src/system/db/index.js');
    db.settings.set({ services: { ...db.settings.get().services, rerank: { baseUrl: '', apiKey: '', model: '' } } });
    const engine = await import('/src/system/ai/engine.js');
    const cost = await import('/src/system/ai/cost.js');
    await engine.streamReply({ chat: db.chats.get(c), char: db.characters.get(ch) });
    return { hits: window.__hits, perTurn: cost.perTurn(c) };
  }, [ids.chat, ids.char]);
  check(r.hits.rr === 0, '接口没填全时不打重排');
  check(r.perTurn === 2, `账也不算它（每轮 ${r.perTurn} 次）`);
  await page.close();
}

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
await browser.close();
process.exit(fail.length ? 1 : 0);

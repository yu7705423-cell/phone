import { BASE, EXE, chromium } from './_env.mjs';
import * as fs from 'node:fs';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  for (let i = 0; i < 4; i++) db.messages.create({ chatId: chat.id, role: i % 2 ? 'char' : 'user', authorId: i % 2 ? c.id : 'me', kind: 'text', content: `第 ${i + 1} 句`, status: 'done' });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${chat.id}`);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/phone-t/zz-chat.png' });
const info = await page.evaluate(() => {
  const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { top: Math.round(b.top), h: Math.round(b.height), pt: cs.paddingTop, pb: cs.paddingBottom, mt: cs.marginTop }; };
  return { vh: innerHeight, root: r('.root'), app: r('.app-frame, .app-view, .app-host'), page: r('.page:last-of-type'), nav: r('.navbar'), body: r('.page-body'), composer: r('.composer-bar'), navback: r('.navback') };
});
fs.writeFileSync('/tmp/phone-t/zz.txt', JSON.stringify(info, null, 1));
await browser.close();

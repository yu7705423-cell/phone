import { html, useState, useRef, useEffect, useMemo } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, IconButton, Icon, Button, Textarea, Switch, Field,
         Sheet, FullSheet, List, ListItem, Spinner, toast, confirm, prompt } from '../../../ui/index.js';
import { Prose, Sign, Byline, Card, Versions, Bub } from '../../../ui/prose.js';
import { Face } from './StageFace.js';

const { db, nav, ai, scene: sceneApi, stage } = phone;

// 线下正文页。一段至少一张，一张一张翻。见 ARCHITECTURE 4.107
//
// 流式那一段**不走 Preact**：几万字的正文，每个 delta 触发一次 diff，
// 一秒几十次，界面会僵住。生成中直接往一个 DOM 节点塞 textContent，
// 落定之后才交回去正常渲染。

export function StageRead({ sceneId }) {
  useStore(db.scenes.store);
  useStore(db.beats.store);
  useStore(db.characters.store);
  useStore(db.settings.store);
  useStore(db.chats.store);

  const [at, setAt] = useState(0);
  const [anim, setAnim] = useState('');
  const [writing, setWriting] = useState(false);
  const [composing, setComposing] = useState('');      // '' | 'me' | 'director'
  const [draft, setDraft] = useState('');
  const [hold, setHold] = useState(false);
  const [menu, setMenu] = useState(false);
  const [notes, setNotes] = useState(null);
  const [picked, setPicked] = useState(null);
  const [editing, setEditing] = useState(null);

  const liveRef = useRef(null);
  const bodyRef = useRef(null);
  const timerRef = useRef(null);
  const holdRef = useRef(null);
  const heldRef = useRef(false);
  // 开场那一下。writeOne 定义在提前 return 之后，hook 不能写在那儿，
  // 所以留一个 ref 让它兑现（第 10 条：hook 顺序）
  const writeRef = useRef(null);
  const openedRef = useRef(false);

  const row = sceneApi.get(sceneId);
  const chat = row ? db.chats.get(row.chatId) : null;
  // 不 memo：全局那份改了之后要跟着变，而它不在依赖里就永远算不到 ——
  // 换主题没反应就是这么来的。两个小对象展开一次，比漏更新便宜
  const cfg = stage.forScene(row);
  const bgUrl = useImage(cfg.bgImage);
  const chrome = stage.bgOf(cfg);

  const pages = useMemo(
    () => (row ? sceneApi.pagesOf(sceneId, cfg.pageChars) : []),
    [row, sceneId, cfg.pageChars, db.beats.indexVersion(sceneId)],
  );

  // 自定义 CSS 只在这一页挂着的时候插进去，离开就摘掉 ——
  // 全局那份 customCSS 是一直在的，这一份不该漏到别的 app 上去
  useEffect(() => {
    stage.mountCSS(cfg.css);
    return () => stage.unmountCSS();
  }, [cfg.css]);

  // 外壳那条状态栏在 .page-body 之外，不染的话深色主题上方留一条白边
  useEffect(() => {
    stage.mountChrome(chrome);
    return () => stage.unmountChrome();
  }, [chrome]);

  // 字体得真挂上去。只把字体名写进 --sg-font 的话，填了字体链接什么也
  // 不会发生，表现和「设置不生效」一模一样
  useEffect(() => {
    stage.mountFont(cfg);
    return () => stage.unmountFont();
  }, [cfg.fontUrl, cfg.fontFamily]);

  // 新的一段落定就翻到末尾。生成中不动 —— 那时候正在往最后一张里长。
  // 明信片那一档同理，只不过「末尾」是滚到底
  const total = Math.max(1, pages.length);
  useEffect(() => {
    setAt(total - 1);
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [total]);
  useEffect(() => () => { clearTimeout(timerRef.current); clearTimeout(holdRef.current); }, []);

  // 新建时选了「让角色开场」就直接写第一段。那一下已经是明示的同意，
  // 不必再点一次；选「我自己写」的什么都不做
  useEffect(() => {
    if (openedRef.current || pages.length || row?.opening !== 'char') return;
    openedRef.current = true;
    writeRef.current?.();
  }, [pages.length, row?.opening]);

  if (!row) {
    return html`
      <${Page} title="线下" onBack=${nav.pop}>
        <div class="pad">这一场已经不在了。</div>
      <//>`;
  }

  const cast = sceneApi.castOf(row);
  const char = cast[0] || null;
  const cards = cfg.layout === 'cards';
  const bubbles = cfg.layout === 'bubble';
  const index = Math.min(Math.max(0, at), total - 1);
  const cur = pages[index] || null;
  const sign = cur && cur.first ? sceneApi.signOf(cur.beat, row) : null;

  const go = step => {
    const next = index + step;
    if (next < 0 || next >= total) return;
    if (cfg.effect === 'instant') { setAt(next); return;  }
    setAnim('is-out');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setAt(next);
      setAnim('is-in');
      timerRef.current = setTimeout(() => setAnim(''), 220);
    }, 170);
  };

  // 长按这一张出它那一段的菜单。长按过之后那一下抬手不算翻页，
  // 否则松手同时又翻了一页
  const startHold = beat => {
    heldRef.current = false;
    clearTimeout(holdRef.current);
    if (!beat) return;
    holdRef.current = setTimeout(() => { heldRef.current = true; setPicked(beat); }, 520);
  };
  const endHold = () => clearTimeout(holdRef.current);

  const onTap = e => {
    if (heldRef.current) { heldRef.current = false; return; }
    if (writing) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    if (!cfg.tapTurn) { if (cfg.spread) stage.set({ spread: false }); return; }
    if (x < 0.33) go(-1);
    else if (x > 0.67) go(1);
    else stage.set({ spread: !cfg.spread });
  };

  // 明信片那一档不翻页，点哪儿都不该动。只留一件事：铺满屏幕时点一下
  // 把界面收回来 —— 否则铺满之后连菜单都没有，出不去
  const onFeedTap = () => {
    if (heldRef.current) { heldRef.current = false; return; }
    if (cfg.spread) stage.set({ spread: false });
  };

  /**
   * 写一段。
   *   more     接着最后那一段往下写，不另起一段
   *   rewrite  重写这一段。**不删旧的**，往后添一版，自己翻着挑
   */
  const writeOne = async ({ more = false, rewrite = '' } = {}) => {
    if (!char) { toast('这一场里还没有角色'); return; }
    if (!ai.isConfigured()) { toast('还没有配置接口'); return; }
    setWriting(true);
    let buf = '';
    try {
      // 窗口把老段落挡在外面时先压一遍。开关默认关着，关着就是一句 return
      await ai.scene.compressIfDue(sceneId).catch(() => {});
      const raw = String(await ai.streamScene({
        scene: row, chat, char, more, omitFrom: rewrite,
        onDelta: d => {
          buf += d;
          const node = liveRef.current;
          if (!node) return;
          node.textContent = buf;
          if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        },
      }) || '');
      const { text, think } = ai.reply.stripThink(raw);
      const { text: body, stamp: at2 } = ai.reply.stripStamps(text);
      if (!body.trim()) throw new Error('模型返回了空内容');
      // 这一段里角色借走、换上了什么，衣帽间已经跟着改了，提示一句（塞进包里的不提示：那是秘密）
      const had = more && lastBeat ? sceneApi.actsOf(lastBeat).length : 0;
      const done = rewrite ? sceneApi.addSwipe(rewrite, { text: body, raw, think, at: at2 })
        : more ? sceneApi.appendBeat(lastBeat?.id, { text: body, raw, at: at2 })
        : sceneApi.addBeat({ sceneId, role: 'char', authorId: char.id, text: body, raw, think, at: at2 });
      const told2 = done ? sceneApi.actsOf(done).slice(had).filter(a => a.text) : [];
      if (told2.length) toast(`衣帽间：${told2.map(a => a.text).join('；')}`);
      // 线下发生的事也要进记忆，否则见了一整场面，回到线上什么都不记得。
      // 和线上共用同一个间隔，默认 0 就是关着的（第 15 条）
      const gap = db.settings.get().autoSummarizeInterval;
      if (ai.memory.shouldAutoExtract(row.chatId, gap)) {
        ai.memory.extract(row.chatId)
          .then(r => { if (r.added || r.updated) toast(`记忆更新 ${r.added + r.updated} 条`); })
          .catch(err => console.warn('[memory] 线下自动提取失败', err));
      }
    } catch (err) {
      if (!ai.queue.isAbort(err)) toast(err.message || '生成失败', 'error');
    } finally {
      setWriting(false);
    }
  };

  writeRef.current = () => writeOne();

  // 续写只对最后那一段有意义：接的就是它
  const told = pages.filter(p => p.beat);
  const lastBeat = told.length ? told[told.length - 1].beat : null;
  const canMore = !!lastBeat && lastBeat.role === sceneApi.CHAR;
  const versOf = beat => {
    const list = sceneApi.versionsOf(beat);
    return list.length > 1
      ? { n: list.length, at: Math.min(list.length - 1, Number(beat.swipeIndex) || 0) }
      : null;
  };
  const pickVer = (beat, i) => sceneApi.pickSwipe(beat.id, i);

  // andWrite：放上去之后紧接着让角色写一段。一次请求，和线上发一条消息一样（第 15 条）；
  // 从前要先「放上去」再回来点一下箭头，两步（4.281）
  const submit = (andWrite = false) => {
    const text = draft.trim();
    if (!text) { setComposing(''); return; }
    if (composing === 'director') {
      const b = sceneApi.addBeat({ sceneId, role: 'director', text });
      sceneApi.updateBeat(b.id, { hold });
    } else {
      sceneApi.addBeat({ sceneId, role: 'me', text });
    }
    setDraft(''); setComposing(''); setHold(false);
    if (andWrite && composing !== 'director') writeOne();
  };

  // 菜单里的两个快捷：重写最后一段（旧版留着）、删掉最后一段（写错了当场撤）
  const rewriteLast = async () => {
    setMenu(false);
    if (!canMore) return;
    await writeOne({ rewrite: lastBeat.id });
  };
  const dropLast = async () => {
    setMenu(false);
    if (!lastBeat) return;
    const ok = await confirm({ title: '删掉最后一段', message: '删除后无法恢复。', okText: '删除', danger: true });
    if (ok) sceneApi.dropBeat(lastBeat.id);
  };
  // 还没有正文时给两条明确的开头，不必猜底栏那几个图标是什么
  const emptyStart = html`
    <div class="sg-empty">
      <div class="sg-eyebrow">这一场还没有正文。</div>
      <div class="sg-empty-acts">
        <button class="sg-go press" disabled=${!char} onClick=${() => writeOne()}>让角色开场</button>
        <button class="sg-act-text press" onClick=${() => { setComposing('me'); setDraft(''); }}>我先写</button>
      </div>
    </div>`;

  const rewrite = async () => {
    const beat = picked;
    setPicked(null);
    if (!beat || beat.role !== 'char') return;
    await writeOne({ rewrite: beat.id });
  };

  const branch = async () => {
    const beat = picked;
    setPicked(null);
    if (!beat) return;
    const ok = await confirm({
      title: '从这一段分叉',
      message: '这一段及其之后的内容将被删除，然后重新往下写。',
      okText: '删除并重写', danger: true,
    });
    if (!ok) return;
    sceneApi.dropFrom(beat.id);
  };

  const removeBeat = async () => {
    const beat = picked;
    setPicked(null);
    if (!beat) return;
    const ok = await confirm({ title: '删除这一段', message: '删除后无法恢复。', okText: '删除', danger: true });
    if (ok) sceneApi.dropBeat(beat.id);
  };

  // 我往对方包里放的：不写进正文，角色当场读不到（ARCHITECTURE 4.217）
  const slipCount = phone.closetStory.slipsOf(sceneId, 'me').length;
  const slipIn = async () => {
    setMenu(false);
    const v = await prompt({ title: '偷偷放进对方包里', placeholder: '例如 一张写着字的便签', okText: '放进去' });
    if (v == null || !v.trim()) return;
    phone.closetStory.slip(sceneId, { from: 'me', what: v });
    toast('已放进去。收场后对方才会发现', 'ok');
  };

  const wrap = async () => {
    setMenu(false);
    // 包里的东西在收场时落到会话里（ARCHITECTURE 4.217）
    const bag = phone.closetStory.arrive(sceneId);
    if (bag.length) toast('这一场放进包里的东西，已经落到会话中', 'ok');
    if (db.settings.get().sceneSummary !== true) {
      toast('收场摘要尚未开启。可在「设置 - 用量与上限」中开启');
      return;
    }
    try {
      const text = await ai.scene.wrap(sceneId);
      toast(text ? '已生成摘要' : '没有可供摘要的内容');
    } catch (err) { toast(err.message || '生成失败', 'error'); }
  };

  // 顶栏归线下自己画。底色深的时候状态栏那几个字要换成浅色
  const hex = String(chrome).replace('#', '');
  const dark = /^[0-9a-f]{6}$/i.test(hex)
    && (parseInt(hex.slice(0, 2), 16) * 299 + parseInt(hex.slice(2, 4), 16) * 587
      + parseInt(hex.slice(4, 6), 16) * 114) / 1000 < 128;

  return html`
    <${Page} hideBar noScroll onBack=${nav.pop} statusBarStyle=${dark ? 'light' : 'dark'}>
      <div class=${`sg${cfg.spread ? ' is-spread' : ''}`} data-effect=${cfg.effect}
        style=${stage.varsOf(cfg, bgUrl)}>

        ${!cfg.spread ? html`
          <div class="sg-head">
            <button class="sg-icon press" onClick=${nav.pop} aria-label="返回">
              <${Icon} name="chevronLeft" size=${20}/>
            <//>
            <div class="sg-head-text">
              <div class="sg-eyebrow">
                ${[row.title || row.place, (cards || bubbles) ? sceneApi.timeOf(sceneId) : (cur?.beat?.at || row.at)]
    .filter(Boolean).join(' · ') || '这一场'}
              </div>
              ${cur?.notes?.length ? html`
                <button class="sg-note press" onClick=${() => setNotes(cur.notes)}>
                  场外指示 ${cur.notes.length}
                <//>` : null}
            </div>
            <button class="sg-icon press" onClick=${() => setMenu(true)} aria-label="菜单">
              <${Icon} name="more" size=${20}/>
            <//>
          </div>` : null}

        ${bubbles ? html`
          <div class="sg-bubs" ref=${bodyRef} onClick=${onFeedTap}>
            ${pages.filter(p => p.first && p.beat).map(p => {
    const b = p.beat;
    const sg = sceneApi.signOf(b, row);
    return html`
                <${Bub} key=${b.id} who=${cfg.sign === 'none' ? '' : sg?.name}
                  mine=${b.role === sceneApi.ME} text=${b.text} marks=${cfg.marks}
                  vers=${versOf(b)} onPick=${i => pickVer(b, i)}
                  onHold=${() => startHold(b)} onEnd=${endHold}/>`;
  })}
            ${writing ? html`
              <article class="sg-bub">
                <div class="sg-lyric sg-live" ref=${liveRef}></div>
              </article>` : null}
            ${!pages.length && !writing ? emptyStart : null}
          </div>`
    : cards ? html`
          <div class="sg-feed" ref=${bodyRef} onClick=${onFeedTap}>
            ${pages.map(p => html`
              <${Card} key=${p.key} page=${p} marks=${cfg.marks} drop=${cfg.drop} Face=${Face}
                grow=${cfg.cardGrow !== false}
                vers=${p.beat ? versOf(p.beat) : null}
                onPick=${i => pickVer(p.beat, i)}
                sign=${p.first ? sceneApi.signOf(p.beat, row) : null}
                showSign=${p.first && cfg.sign !== 'none'}
                onHold=${() => startHold(p.beat)} onEnd=${endHold}/>`)}
            ${writing ? html`
              <article class="sg-card no-callout">
                <div class="sg-text sg-live" ref=${liveRef}></div>
              </article>` : null}
            ${!pages.length && !writing ? emptyStart : null}
          </div>`
    : html`
          <div class="sg-tap no-callout" onClick=${onTap}
            onTouchStart=${() => startHold(cur?.beat)}
            onTouchEnd=${endHold} onTouchMove=${endHold} onTouchCancel=${endHold}
            onContextMenu=${e => { e.preventDefault(); if (cur?.beat) { heldRef.current = true; setPicked(cur.beat); } }}>
            <div class=${`sg-body ${anim}`} ref=${bodyRef}>
              <div class="sg-col">
                ${!writing && sign && cfg.sign !== 'none'
    ? (cfg.sign === 'line'
      ? html`<${Byline} sign=${sign} no=${cur.beatIndex}/>`
      : html`<${Sign} sign=${sign} no=${cur.beatIndex}/>`)
    : null}
                ${writing
    ? html`<div class="sg-text sg-live" ref=${liveRef}></div>`
    : html`
                    <${Prose} text=${cur?.text || ''} marks=${cfg.marks}
                      drop=${cfg.drop && cur?.first}/>
                    ${!cur?.text && cur?.notes?.length
    ? html`<div class="sg-eyebrow">这一张只有场外指示。</div>` : null}
                    ${!pages.length ? emptyStart : null}
                    ${cur?.beat && cur.page === cur.pages - 1 && versOf(cur.beat)
    ? html`<${Versions} ...${versOf(cur.beat)} onPick=${i => pickVer(cur.beat, i)}/>` : null}`}
              </div>
            </div>
          </div>`}

        ${!cfg.spread && !cards && !bubbles ? html`
          <div class="sg-foot">
            <span>${total ? `${index + 1} / ${total}` : ''}</span>
            <div class="sg-rule"></div>
            <span>${cur?.pages > 1 ? `本段 ${cur.page + 1} / ${cur.pages}` : ''}</span>
          </div>` : null}

        ${!cfg.spread ? html`

          <div class="sg-bar">
            <button class="sg-write press" onClick=${() => { setComposing('me'); setDraft(''); }}>
              写一段
            <//>
            <button class="sg-act-btn press" onClick=${() => { setComposing('director'); setDraft(''); }}
              aria-label="场外指示">
              <${Icon} name="notes" size=${18}/>
            <//>
            <button class="sg-act-btn press" disabled=${writing || !canMore}
              onClick=${writing ? undefined : () => writeOne({ more: true })}
              aria-label="接着上一段往下写">
              <${Icon} name="chevronDown" size=${18}/>
            <//>
            ${writing ? html`
              <button class="sg-go press" onClick=${() => ai.cancelScene(sceneId)} aria-label="停止">
                <${Spinner} size=${14}/>停止
              <//>` : html`
              <button class="sg-go press" disabled=${!char} onClick=${() => writeOne()}
                aria-label="让角色往下写">角色写<//>`}
          </div>` : null}
      </div>

      <${FullSheet} open=${!!composing} onClose=${() => setComposing('')}
        title=${composing === 'director' ? '场外指示' : '写一段'}
        right=${html`<${Button} size="sm" onClick=${() => submit(false)}>放上去<//>`}>
        <div class="pad">
          <${Textarea} rows=${14} value=${draft} onInput=${v => setDraft(v)}
            placeholder=${composing === 'director'
    ? '写给模型看的指示。它不会出现在正文里，场景中的人也不知道有这句话。'
    : '写你这一段。动作、对白、心理都可以写在一起。'}/>
          ${composing === 'me' ? html`
            <div class="pad-t">
              <${Button} full disabled=${!draft.trim() || !char} onClick=${() => submit(true)}>放上去，让角色接着写<//>
            </div>
            <div class="settings-foot">调用一次接口。只点右上角「放上去」则不调用，之后可再让角色写。</div>` : null}
          ${composing === 'director' ? html`
            <${Field} label="一直有效"
              desc="开启后这条指示在本场余下的部分持续生效。关闭时它只作用于紧接着的一段。">
              <${Switch} checked=${hold} onChange=${setHold}/>
            <//>` : null}
        </div>
      <//>

      <${FullSheet} open=${!!editing} onClose=${() => setEditing(null)} title="编辑这一段"
        right=${html`<${Button} size="sm" onClick=${() => {
    sceneApi.editBeat(editing.id, editing.text);
    setEditing(null);
  }}>保存<//>`}>
        <div class="pad">
          <${Textarea} rows=${16} value=${editing?.text || ''}
            onInput=${v => setEditing(e => ({ ...e, text: v }))}/>
        </div>
      <//>

      <${Sheet} open=${!!notes} onClose=${() => setNotes(null)} title="场外指示">
        <${List}>
          ${(notes || []).map(n => html`
            <${ListItem} key=${n.id} title=${n.text} multiline
              subtitle=${n.hold ? '一直有效' : '只作用于紧接着的一段'}
              right=${html`<${IconButton} name="trash" onClick=${() => {
    sceneApi.dropBeat(n.id); setNotes(null);
  }} label="删除"/>`}/>`)}
        <//>
      <//>

      <${Sheet} open=${!!picked} onClose=${() => setPicked(null)} title="这一段">
        <${List}>
          <${ListItem} title="复制" onClick=${() => {
    navigator.clipboard?.writeText(picked?.text || '');
    setPicked(null); toast('已复制', 'ok');
  }}/>
          <${ListItem} title=${picked?.pinned ? '取消钉住' : '钉住'}
            subtitle="钉住的段落不受窗口与预算限制，始终进入上下文"
            onClick=${() => { sceneApi.togglePin(picked.id); setPicked(null); }}/>
          <${ListItem} title="编辑" subtitle="改的是当前这一版"
            onClick=${() => { setEditing({ id: picked.id, text: picked.text }); setPicked(null); }}/>
          ${picked?.role === 'char' && picked?.id === lastBeat?.id ? html`
            <${ListItem} title="重写这一段" multiline
              subtitle="旧的那一版留着，写完在正文末尾翻着挑"
              onClick=${rewrite}/>` : null}
          ${sceneApi.versionsOf(picked).length > 1 ? html`
            <${ListItem} title="删掉当前这一版" danger
              onClick=${() => { sceneApi.dropSwipe(picked.id); setPicked(null); }}/>` : null}
          <${ListItem} title="从这一段分叉" subtitle="删除这一段及其之后的内容" onClick=${branch}/>
          <${ListItem} title="删除" danger onClick=${removeBeat}/>
        <//>
      <//>

      <${Sheet} open=${menu} onClose=${() => setMenu(false)} title=${row.title || '这一场'}>
        <${List}>
          ${!cards ? html`
            <${ListItem} title="这一段" subtitle="复制、钉住、重写、分叉"
              onClick=${() => { setMenu(false); if (cur?.beat) setPicked(cur.beat); }}/>` : null}
          ${canMore ? html`
            <${ListItem} title="重写最后一段" subtitle="旧的那一版留着，写完在正文末尾翻着挑" multiline
              onClick=${rewriteLast}/>` : null}
          ${lastBeat ? html`
            <${ListItem} title="删掉最后一段" subtitle=${`${lastBeat.role === 'me' ? '我' : '角色'}写的那一段`} danger
              onClick=${dropLast}/>` : null}
          <${ListItem} title="这一场的设定" subtitle="标题、地点、情境、在场角色" arrow
            onClick=${() => { setMenu(false); nav.push(`/scene/${sceneId}/edit`); }}/>
          <${ListItem} title="外观" subtitle="主题、字体、字号、壁纸、自定义样式" arrow
            onClick=${() => { setMenu(false); nav.push(`/stage/settings/${sceneId}`); }}/>
          <${ListItem} title="版式" subtitle=${cards ? '明信片' : '翻页'}
            onClick=${() => stage.set({ layout: cards ? 'page' : 'cards' })}/>
          <${ListItem} title="铺满屏幕"
            right=${html`<${Switch} checked=${cfg.spread} onChange=${v => stage.set({ spread: v })}/>`}/>
          <${ListItem} title="偷偷放进对方包里" arrow
            subtitle=${slipCount ? `已放进 ${slipCount} 样。收场后对方才会发现` : '对方在收场之前看不到。收场后，角色回到家打开包才会发现'}
            onClick=${slipIn}/>
          <${ListItem} title="收场" subtitle="把整场压成一段摘要，进入记忆；放进包里的东西在此时被发现" onClick=${wrap}/>
        <//>
      <//>
    <//>`;
}

import { html, useState, useRef, useEffect, useMemo } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, IconButton, Icon, Button, Textarea, Switch, Field,
         Sheet, FullSheet, List, ListItem, Spinner, EmptyState,
         toast, confirm } from '../../../ui/index.js';
import { Prose, Sign, Byline, Card, Versions, Bub, CoverCard } from '../../../ui/prose.js';
import { Face } from './Face.js';
import { chapterTitle } from './Bits.js';

const { db, nav, ai, work, scene, stage } = phone;

// 「我们」的正文页。整个是线下那一页的同一套：同一批 beats 函数、
// 同一套分张、同一份展示层（ui/prose.js）、同一套外观（system/stage.js）。
// 见 ARCHITECTURE 4.117
//
// 差别只有三处：署名按这部作品里的身份来、菜单里多一个目录、
// 「整篇由它写」开着时底栏那个键写的是整段而不是只有对方。

export function ReadPage({ chapterId }) {
  useStore(db.works.store);
  useStore(db.chapters.store);
  useStore(db.beats.store);
  useStore(db.characters.store);
  useStore(db.settings.store);

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
  const writeRef = useRef(null);
  const openedRef = useRef(false);

  const row = work.getChapter(chapterId);
  const w = work.workOfChapter(chapterId);
  // 不 memo：全局那份改了之后要跟着变（和线下同一个理由）
  const cfg = stage.forScene(row);
  const bgUrl = useImage(cfg.bgImage);
  // 封面。作品自己传的那张；没有就退回角色的头像；再没有就用标题排一张
  const coverUrl = useImage(work.workOfChapter(chapterId)?.cover
    || work.charOf(work.workOfChapter(chapterId)).avatar);
  const chrome = stage.bgOf(cfg);

  const pages = useMemo(
    () => (row ? scene.pagesOf(chapterId, cfg.pageChars) : []),
    [row, chapterId, cfg.pageChars, db.beats.indexVersion(chapterId)],
  );

  useEffect(() => {
    stage.mountCSS(cfg.css);
    return () => stage.unmountCSS();
  }, [cfg.css]);
  useEffect(() => {
    stage.mountChrome(chrome);
    return () => stage.unmountChrome();
  }, [chrome]);
  useEffect(() => {
    stage.mountFont(cfg);
    return () => stage.unmountFont();
  }, [cfg.fontUrl, cfg.fontFamily]);

  const total = Math.max(1, pages.length);
  useEffect(() => {
    setAt(total - 1);
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [total]);
  useEffect(() => () => { clearTimeout(timerRef.current); clearTimeout(holdRef.current); }, []);

  // 新建那一篇选了「让角色开场」就直接写第一段
  useEffect(() => {
    if (openedRef.current || pages.length || row?.opening !== 'char') return;
    openedRef.current = true;
    writeRef.current?.();
  }, [pages.length, row?.opening]);

  if (!row || !w) {
    return html`
      <${Page} title="我们" onBack=${nav.pop}>
        <${EmptyState} title="这一篇已经不在了"/>
      <//>`;
  }

  const cards = cfg.layout === 'cards';
  const bubbles = cfg.layout === 'bubble';
  const index = Math.min(Math.max(0, at), total - 1);
  const cur = pages[index] || null;
  const sign = cur && cur.first ? work.signOf(cur.beat, row, w) : null;
  const chapters = work.chaptersOf(w.id);
  const charName = work.charOf(w).name;

  const go = step => {
    const next = index + step;
    if (next < 0 || next >= total) return;
    if (cfg.effect === 'instant') { setAt(next); return; }
    setAnim('is-out');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setAt(next);
      setAnim('is-in');
      timerRef.current = setTimeout(() => setAnim(''), 220);
    }, 170);
  };

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
  const onFeedTap = () => {
    if (heldRef.current) { heldRef.current = false; return; }
    if (cfg.spread) stage.set({ spread: false });
  };

  const told = pages.filter(p => p.beat);
  const lastBeat = told.length ? told[told.length - 1].beat : null;
  const canMore = !!lastBeat && lastBeat.role === 'char';

  /** 写一段。more 接着上一段往下写；rewrite 重写那一段，旧的留作候选。 */
  const writeOne = async ({ more = false, rewrite = '' } = {}) => {
    if (!ai.isConfigured()) { toast('还没有配置接口'); return; }
    setWriting(true);
    let buf = '';
    try {
      const raw = String(await ai.streamWork({
        work: w, chapter: row, more, omitFrom: rewrite,
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
      const authorId = (w.castIds || [])[0] || '';
      if (rewrite) scene.addSwipe(rewrite, { text: body, raw, think, at: at2 });
      else if (more) scene.appendBeat(lastBeat?.id, { text: body, raw, at: at2 });
      else scene.addBeat({ sceneId: chapterId, role: 'char', authorId, text: body, raw, think, at: at2 });
      // 作品不进记忆：番外是「如果当时」，长篇是另一条线。两样都不该
      // 混进这段关系的记忆里去（见 ARCHITECTURE 4.117）
    } catch (err) {
      if (!ai.queue.isAbort(err)) toast(err.message || '生成失败', 'error');
    } finally {
      setWriting(false);
    }
  };
  writeRef.current = () => writeOne();

  const versOf = beat => {
    const list = scene.versionsOf(beat);
    return list.length > 1
      ? { n: list.length, at: Math.min(list.length - 1, Number(beat.swipeIndex) || 0) }
      : null;
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) { setComposing(''); return; }
    if (composing === 'director') {
      const b = scene.addBeat({ sceneId: chapterId, role: 'director', text });
      scene.updateBeat(b.id, { hold });
    } else {
      scene.addBeat({ sceneId: chapterId, role: 'me', text });
    }
    setDraft(''); setComposing(''); setHold(false);
  };

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
    if (ok) scene.dropFrom(beat.id);
  };

  const removeBeat = async () => {
    const beat = picked;
    setPicked(null);
    if (!beat) return;
    const ok = await confirm({ title: '删除这一段', message: '删除后无法恢复。', okText: '删除', danger: true });
    if (ok) scene.dropBeat(beat.id);
  };

  const wrap = async () => {
    setMenu(false);
    if (db.settings.get().workSummary !== true) {
      toast('收篇摘要尚未开启。可在「设置 - 用量与上限」中开启');
      return;
    }
    try {
      const text = await ai.work.wrap(chapterId);
      toast(text ? '已生成摘要' : '没有可供摘要的内容');
    } catch (err) { toast(err.message || '生成失败', 'error'); }
  };

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
                ${[chapterTitle(w, row),
    (cards || bubbles) ? work.timeOf(chapterId) : (cur?.beat?.at || row.at)].filter(Boolean).join(' · ')}
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
            ${cfg.cover !== false ? html`
              <${CoverCard} art=${coverUrl} letter=${(w.title || charName)}
                title=${w.title || '未命名'}
                names=${[charName, work.meOf(w).name].filter(Boolean).join('　')}
                meta=${[work.kindLabel(w.kind), chapterTitle(w, row), row.place]
    .filter(Boolean).join('　')}/>` : null}
            ${pages.filter(p => p.first && p.beat).map(p => {
    const b = p.beat;
    const sg = work.signOf(b, row, w);
    return html`
                <${Bub} key=${b.id} who=${cfg.sign === 'none' ? '' : sg?.name}
                  mine=${b.role === 'me'} text=${b.text} marks=${cfg.marks}
                  vers=${versOf(b)} onPick=${i => scene.pickSwipe(b.id, i)}
                  onHold=${() => startHold(b)} onEnd=${endHold}/>`;
  })}
            ${writing ? html`
              <article class="sg-bub">
                <div class="sg-lyric sg-live" ref=${liveRef}></div>
              </article>` : null}
            ${!pages.length && !writing
    ? html`<div class="sg-eyebrow">这一篇还没有正文。</div>` : null}
          </div>`
    : cards ? html`
          <div class="sg-feed" ref=${bodyRef} onClick=${onFeedTap}>
            ${pages.map(p => html`
              <${Card} key=${p.key} page=${p} marks=${cfg.marks} drop=${cfg.drop} Face=${Face}
                grow=${cfg.cardGrow !== false}
                vers=${p.beat ? versOf(p.beat) : null}
                onPick=${i => scene.pickSwipe(p.beat.id, i)}
                sign=${p.first ? work.signOf(p.beat, row, w) : null}
                showSign=${p.first && cfg.sign !== 'none'}
                onHold=${() => startHold(p.beat)} onEnd=${endHold}/>`)}
            ${writing ? html`
              <article class="sg-card no-callout">
                <div class="sg-text sg-live" ref=${liveRef}></div>
              </article>` : null}
            ${!pages.length && !writing
    ? html`<div class="sg-eyebrow">这一篇还没有正文。</div>` : null}
          </div>`
    : html`
          <div class="sg-tap no-callout" onClick=${onTap}
            onTouchStart=${() => startHold(cur?.beat)}
            onTouchEnd=${endHold} onTouchMove=${endHold} onTouchCancel=${endHold}>
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
                    ${!pages.length
    ? html`<div class="sg-eyebrow">这一篇还没有正文。</div>` : null}
                    ${cur?.beat && cur.page === cur.pages - 1 && versOf(cur.beat)
    ? html`<${Versions} ...${versOf(cur.beat)} onPick=${i => scene.pickSwipe(cur.beat.id, i)}/>` : null}`}
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
            <button class="sg-act-btn press" disabled=${writing}
              onClick=${writing ? undefined : () => writeOne()}
              aria-label=${writing ? '正在生成' : (w.solo ? '让它往下写' : `让${charName}往下写`)}>
              ${writing ? html`<${Spinner} size=${16}/>` : html`<${Icon} name="chevronRight" size=${18}/>`}
            <//>
            ${writing ? html`
              <button class="sg-act-btn press" onClick=${() => ai.cancelWork(chapterId)} aria-label="停止">
                <${Icon} name="close" size=${18}/>
              <//>` : null}
          </div>` : null}
      </div>

      <${Sheet} open=${menu} onClose=${() => setMenu(false)} title=${w.title || '这一部'}>
        <${List}>
          ${chapters.length > 1 ? html`
            <${ListItem} title="目录" subtitle=${`共 ${chapters.length} ${w.kind === work.SAGA ? '章' : '则'}`}
              arrow onClick=${() => { setMenu(false); nav.push(`/work/${w.id}`); }}/>` : null}
          <${ListItem} title="这一篇的设定" subtitle="题目、地点、时刻、情境" arrow multiline
            onClick=${() => { setMenu(false); nav.push(`/chapter/${chapterId}`); }}/>
          <${ListItem} title="这一部的设定" subtitle="主线、身份、文风与两个开关" arrow multiline
            onClick=${() => { setMenu(false); nav.push(`/work/${w.id}/edit`); }}/>
          <${ListItem} title="外观" subtitle="纸色、字号、版式。与线下共用一套" arrow multiline
            onClick=${() => { setMenu(false); phone.intent.open('chat', { route: '/stage/settings', back: true }); }}/>
          <${ListItem} title="收篇" multiline
            subtitle="把这一篇压成一段摘要，后面几篇的设定区里会带上它"
            onClick=${wrap}/>
        <//>
      <//>

      <${Sheet} open=${!!picked} onClose=${() => setPicked(null)} title="这一段">
        <${List}>
          ${picked?.role === 'char' ? html`
            <${ListItem} title="重写" multiline
              subtitle="重来一版，原来那版留作候选，可以左右切回去" onClick=${rewrite}/>` : null}
          <${ListItem} title="编辑" onClick=${() => { setEditing(picked); setPicked(null); }}/>
          <${ListItem} title=${picked?.pinned ? '取消钉住' : '钉住这一段'} multiline
            subtitle="钉住的段落不受窗口与预算约束，一直在上下文里"
            onClick=${() => { scene.togglePin(picked.id); setPicked(null); }}/>
          ${scene.versionsOf(picked).length > 1 ? html`
            <${ListItem} title="删掉当前这一版" onClick=${() => { scene.dropSwipe(picked.id); setPicked(null); }}/>` : null}
          <${ListItem} title="从这一段分叉" multiline
            subtitle="删掉这一段及其之后的内容，重新往下写" onClick=${branch}/>
          <${ListItem} title="删除这一段" danger onClick=${removeBeat}/>
        <//>
      <//>

      <${Sheet} open=${!!notes} onClose=${() => setNotes(null)} title="场外指示">
        <${List}>
          ${(notes || []).map(n => html`
            <${ListItem} key=${n.id} title=${n.text} multiline
              subtitle=${n.hold ? '一直有效' : '只作用于紧接着的一段'}
              right=${html`<${IconButton} name="trash" label="删除"
                onClick=${() => { scene.dropBeat(n.id); setNotes(null); }}/>`}/>`)}
        <//>
      <//>

      <${FullSheet} open=${!!composing} onClose=${() => setComposing('')}
        title=${composing === 'director' ? '场外指示' : '写一段'}
        right=${html`<${Button} size="sm" onClick=${submit}>放上去<//>`}>
        <div class="pad">
          <${Textarea} rows=${14} value=${draft} onInput=${v => setDraft(v)}
            placeholder=${composing === 'director'
    ? '写给模型看的指示。它不会出现在正文里，作品中的人也不知道有这句话。'
    : '写你这一段。动作、对白、心理都可以写在一起。'}/>
          ${composing === 'director' ? html`
            <${Field} label="一直有效"
              desc="开启后这条指示在本篇余下的部分持续生效。关闭时它只作用于紧接着的一段。">
              <${Switch} checked=${hold} onChange=${setHold}/>
            <//>` : null}
        </div>
      <//>

      <${FullSheet} open=${!!editing} onClose=${() => setEditing(null)} title="编辑这一段"
        right=${html`<${Button} size="sm" onClick=${() => {
    scene.editBeat(editing.id, editing.text);
    setEditing(null);
  }}>保存<//>`}>
        <div class="pad">
          <${Textarea} rows=${16} value=${editing?.text || ''}
            onInput=${v => setEditing(e => ({ ...e, text: v }))}/>
        </div>
      <//>
    <//>`;
}

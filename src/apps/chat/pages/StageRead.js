import { html, useState, useRef, useEffect, useMemo } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, IconButton, Icon, Button, Textarea, Switch, Field,
         Sheet, FullSheet, List, ListItem, Spinner, toast, confirm } from '../../../ui/index.js';
import { Prose, Sign, Byline } from './StageBits.js';

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

  // 新的一段落定就翻到末尾。生成中不动 —— 那时候正在往最后一张里长
  const total = Math.max(1, pages.length);
  useEffect(() => { setAt(total - 1); }, [total]);
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

  const writeOne = async () => {
    if (!char) { toast('这一场里还没有角色'); return; }
    if (!ai.isConfigured()) { toast('还没有配置接口'); return; }
    setWriting(true);
    let buf = '';
    try {
      // 窗口把老段落挡在外面时先压一遍。开关默认关着，关着就是一句 return
      await ai.scene.compressIfDue(sceneId).catch(() => {});
      const raw = String(await ai.streamScene({
        scene: row, chat, char,
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
      sceneApi.addBeat({ sceneId, role: 'char', authorId: char.id, text: body, raw, think, at: at2 });
    } catch (err) {
      if (!ai.queue.isAbort(err)) toast(err.message || '生成失败', 'err');
    } finally {
      setWriting(false);
    }
  };

  writeRef.current = writeOne;

  const submit = () => {
    const text = draft.trim();
    if (!text) { setComposing(''); return; }
    if (composing === 'director') {
      const b = sceneApi.addBeat({ sceneId, role: 'director', text });
      sceneApi.updateBeat(b.id, { hold });
    } else {
      sceneApi.addBeat({ sceneId, role: 'me', text });
    }
    setDraft(''); setComposing(''); setHold(false);
  };

  const rewrite = async () => {
    const beat = picked;
    setPicked(null);
    if (!beat || beat.role !== 'char') return;
    sceneApi.dropBeat(beat.id);
    await writeOne();
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

  const wrap = async () => {
    setMenu(false);
    if (db.settings.get().sceneSummary !== true) {
      toast('收场摘要尚未开启。可在「设置 - 用量与上限」中开启');
      return;
    }
    try {
      const text = await ai.scene.wrap(sceneId);
      toast(text ? '已生成摘要' : '没有可供摘要的内容');
    } catch (err) { toast(err.message || '生成失败', 'err'); }
  };

  // 顶栏归线下自己画。用 app 的 navbar 的话，深色主题上方会留一条白边，
  // 那就不是「整个页面进入线下」了
  const dark = (cfg.bgColor || '').trim()
    ? (parseInt((cfg.bgColor || '').replace('#', '').slice(0, 2), 16) || 255) < 110
    : false;

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
                ${[row.title || row.place, cur?.beat?.at || row.at].filter(Boolean).join(' · ')
    || '这一场'}
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

        <div class="sg-tap no-callout" onClick=${onTap}
          onTouchStart=${() => startHold(cur?.beat)}
          onTouchEnd=${endHold} onTouchMove=${endHold} onTouchCancel=${endHold}>
          <div class=${`sg-body ${anim}`} ref=${bodyRef}>
            <div class="sg-col">
              ${!writing && sign && cfg.sign !== 'none'
    ? (cfg.sign === 'line'
      ? html`<${Byline} sign=${sign}/>`
      : html`<${Sign} sign=${sign} no=${cur.beatIndex}/>`)
    : null}
              ${writing
    ? html`<div class="sg-text sg-live" ref=${liveRef}></div>`
    : html`
                  <${Prose} text=${cur?.text || ''} marks=${cfg.marks}/>
                  ${!cur?.text && cur?.notes?.length
    ? html`<div class="sg-eyebrow">这一张只有场外指示。</div>` : null}
                  ${!pages.length
    ? html`<div class="sg-eyebrow">这一场还没有正文。</div>` : null}`}
            </div>
          </div>
        </div>

        ${!cfg.spread ? html`
          <div class="sg-foot">
            <span>${total ? `${index + 1} / ${total}` : ''}</span>
            <div class="sg-rule"></div>
            <span>${cur?.pages > 1 ? `本段 ${cur.page + 1} / ${cur.pages}` : ''}</span>
          </div>

          <div class="sg-bar">
            <button class="sg-write press" onClick=${() => { setComposing('me'); setDraft(''); }}>
              写一段
            <//>
            <button class="sg-act-btn press" onClick=${() => { setComposing('director'); setDraft(''); }}
              aria-label="场外指示">
              <${Icon} name="edit" size=${18}/>
            <//>
            <button class="sg-act-btn press" disabled=${writing || !char}
              onClick=${writing ? undefined : writeOne}
              aria-label=${writing ? '正在生成' : '让角色往下写'}>
              ${writing ? html`<${Spinner} size=${16}/>` : html`<${Icon} name="chevronRight" size=${18}/>`}
            <//>
            ${writing ? html`
              <button class="sg-act-btn press" onClick=${() => ai.cancelScene(sceneId)} aria-label="停止">
                <${Icon} name="close" size=${18}/>
              <//>` : null}
          </div>` : null}
      </div>

      <${FullSheet} open=${!!composing} onClose=${() => setComposing('')}
        title=${composing === 'director' ? '场外指示' : '写一段'}
        right=${html`<${Button} size="sm" onClick=${submit}>放上去<//>`}>
        <div class="pad">
          <${Textarea} rows=${14} value=${draft} onInput=${v => setDraft(v)}
            placeholder=${composing === 'director'
    ? '写给模型看的指示。它不会出现在正文里，场景中的人也不知道有这句话。'
    : '写你这一段。动作、对白、心理都可以写在一起。'}/>
          ${composing === 'director' ? html`
            <${Field} label="一直有效"
              desc="开启后这条指示在本场余下的部分持续生效。关闭时它只作用于紧接着的一段。">
              <${Switch} checked=${hold} onChange=${setHold}/>
            <//>` : null}
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
          ${picked?.role === 'char' ? html`
            <${ListItem} title="重写这一段" onClick=${rewrite}/>` : null}
          <${ListItem} title="从这一段分叉" subtitle="删除这一段及其之后的内容" onClick=${branch}/>
          <${ListItem} title="删除" danger onClick=${removeBeat}/>
        <//>
      <//>

      <${Sheet} open=${menu} onClose=${() => setMenu(false)} title=${row.title || '这一场'}>
        <${List}>
          <${ListItem} title="这一段" subtitle="复制、钉住、重写、分叉"
            onClick=${() => { setMenu(false); if (cur?.beat) setPicked(cur.beat); }}/>
          <${ListItem} title="这一场的设定" subtitle="标题、地点、情境、在场角色" arrow
            onClick=${() => { setMenu(false); nav.push(`/scene/${sceneId}/edit`); }}/>
          <${ListItem} title="外观" subtitle="主题、字体、字号、壁纸、自定义样式" arrow
            onClick=${() => { setMenu(false); nav.push(`/stage/settings/${sceneId}`); }}/>
          <${ListItem} title="铺满屏幕"
            right=${html`<${Switch} checked=${cfg.spread} onChange=${v => stage.set({ spread: v })}/>`}/>
          <${ListItem} title="收场" subtitle="把整场压成一段摘要，进入记忆" onClick=${wrap}/>
        <//>
      <//>
    <//>`;
}

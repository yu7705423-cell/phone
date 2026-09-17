import { html, useState, useEffect, useRef, memo } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, Avatar, Icon, EmptyState } from '../../../ui/index.js';
import { relTime, splitBubbles } from '../helpers.js';

const { db, nav, search } = phone;

// 敲字和开扫之间隔这么久。每敲一下就开一轮，扫到一半又被下一下取消，
// 白扫的比扫完的还多。
const DEBOUNCE = 140;
// 一次最多给多少条结果。设置里能改，填 0 就是全给。
const limitOf = () => db.settings.get().searchLimit || 0;

// 全局搜索要回答的是「这句话在哪儿说的」，所以标题写会话，自己说的那条
// 在正文前加一个「我」；在一段对话里搜则相反 —— 会话是同一个，
// 需要区分的是谁说的。
const HitRow = memo(function Hit({ id, q, scoped, onOpen }) {
  const msg = db.messages.get(id);
  const me = phone.accounts.current();
  const chat = msg ? db.chats.get(msg.chatId) : null;
  const char = chat ? db.characters.get((chat.characterIds || [])[0]) : null;
  const mine = msg?.role === 'user';
  const charName = char?.name || '已删除的角色';
  const speaker = mine ? (me?.name || '我') : charName;
  const title = scoped ? speaker : charName;
  const face = scoped && mine ? me?.avatar : char?.avatar;
  const avatar = useImage(face);
  if (!msg) return null;

  // 一条里可能有好几段，只取命中的那一段，再在段里截一小截
  const lower = q.toLowerCase();
  const part = splitBubbles(msg.content).find(p => p.toLowerCase().includes(lower)) || msg.content;
  const [before, hit, after] = search.splitHit(search.excerpt(part, q), q);

  return html`
    <div class="msg-row press" onClick=${() => onOpen(msg)}>
      <${Avatar} src=${avatar} name=${title} size=${40} radius=${20}/>
      <div class="msg-main">
        <div class="msg-line">
          <span class="msg-name ellipsis">${title}</span>
          <span class="msg-time">${relTime(msg.createdAt)}</span>
        </div>
        <div class="msg-line">
          <span class="msg-preview ellipsis">
            ${!scoped && mine ? html`<span class="hit-who">${me?.name || '我'}：</span>` : null}
            ${before}<mark class="hit">${hit}</mark>${after}
          </span>
        </div>
      </div>
    </div>`;
});

export function SearchPage({ chatId }) {
  useStore(db.messages.store);
  useStore(db.chats.store);
  useStore(db.characters.store);

  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [state, setState] = useState('idle');   // idle | running | done
  const [more, setMore] = useState(false);
  const running = useRef(null);
  const inputRef = useRef(null);
  const latest = useRef(null);
  const open = useRef(msg => latest.current(msg)).current;

  const scoped = !!chatId;
  const chat = scoped ? db.chats.get(chatId) : null;
  const char = chat ? db.characters.get((chat.characterIds || [])[0]) : null;

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    running.current?.cancel();
    const text = q.trim();
    if (!text) { setHits([]); setState('idle'); setMore(false); return undefined; }

    setState('running');
    const timer = setTimeout(() => {
      // 一片一片往上加。罕见词要把十几万条都过一遍，但先扫到的就是最新的，
      // 不必等整轮扫完才看得见第一条。
      const job = search.searchMessages(text, {
        chatId, limit: limitOf(),
        onBatch: (found, finished) => {
          setHits(found.slice());
          if (finished) setState('done');
        },
      });
      running.current = job;
      job.done.then(r => { if (running.current === job) setMore(!!r.truncated); });
    }, DEBOUNCE);

    return () => { clearTimeout(timer); running.current?.cancel(); };
  }, [q, chatId]);

  // 退出这一页时把还在跑的那轮停掉
  useEffect(() => () => running.current?.cancel(), []);

  // 结果行是记忆化的，onOpen 每次渲染现造的话就永远判不出相等。
  //
  // 两种情况都走同一个路由：会话页认 /chat/<id>@<消息 id>，进去自己把窗口
  // 开到那一条再滚过去。**不能只是退回去然后找 DOM** —— 会话页只画最近
  // 两百条，几千条之前的那一条根本不在 DOM 里，找不到就什么都不会发生。
  latest.current = msg => {
    const target = `/chat/${msg.chatId}@${msg.id}`;
    // 限定搜索是从这段对话里进来的，退回去再把它换成带定位的那条路由，
    // 免得同一段对话在栈上叠两层
    if (scoped) { nav.pop(); nav.replace(target); return; }
    nav.push(target);
  };

  const query = q.trim();
  const title = scoped ? `在「${char?.name || '这段对话'}」中搜索` : '搜索全部对话';
  const empty = state === 'done' && !hits.length;

  return html`
    <${Page} title="搜索" onBack=${nav.pop}>
      <div class="msg-list">
        <div class="search-bar">
          <${Icon} name="search" size=${16}/>
          <input ref=${inputRef} value=${q} placeholder=${title}
            onInput=${e => setQ(e.target.value)}/>
          ${q ? html`<button class="press" aria-label="清空"
            onClick=${() => setQ('')}><${Icon} name="close" size=${15}/></button>` : null}
        </div>

        ${!query ? html`
          <${EmptyState} icon="search" title="搜索聊天记录"
            desc=${scoped
              ? '在这段对话中按关键词查找消息。'
              : '在全部对话中按关键词查找消息。结果按时间倒序排列。'}/>`
        : empty ? html`<${EmptyState} icon="search" title="没有匹配的消息"/>`
        : html`
          <div class="capsule">
            ${hits.map(id => html`
              <${HitRow} key=${id} id=${id} q=${query} scoped=${scoped} onOpen=${open}/>`)}
          </div>
          ${state === 'running' ? html`<div class="search-note">正在搜索</div>`
            : more ? html`<div class="search-note">仅显示最近 ${limitOf()} 条结果，请输入更具体的关键词</div>`
            : html`<div class="search-note">共 ${hits.length} 条</div>`}`}
      </div>
    <//>`;
}

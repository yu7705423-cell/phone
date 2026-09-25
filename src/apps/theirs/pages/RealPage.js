import { html, useState, useEffect, useRef } from '../../../lib.js';
import { phone, useStore, useThumb } from '../../../sdk/index.js';
import { Page, Button, Icon, EmptyState, toast } from '../../../ui/index.js';
import { CharAvatar } from '../parts.js';

const { db, nav, intent } = phone;

// 和你的那一段，在它自己的手机上看。
//
// 从前这一条是跳回「聊天」那个 app 的。**那一下把「翻别人手机」这件事
// 打断了**：正翻着它的相册、备忘录，点一条会话，人忽然回到了自己的聊天界面，
// 而且退不回来 —— 跨 app 那一跳过去没有回头路。
//
// 现在就在这儿画，而且**打得出字** —— 你登着的是它的手机，所以在这儿
// 打出去的那一句是**它发给你的**。不是替你说话，是替它说话。
//
// 这一下**不调接口**：你已经把话写好了，没有什么要生成的。它落进真的那段
// 对话里，「聊天」那边看见的就是角色发来的一条新消息。
//
// 长按、多选、撤回这些还是「聊天」那边的事，底下那一个按钮过去，
// 那才是干活的地方。
//
// 左右两边是反过来的：这是**它的**手机，所以它说的话在右边（is-me），
// 你说的在左边。头像跟着各自那一边站：is-me 那一行是 row-reverse，
// **所以头像要写在气泡前面**，翻过来才落在气泡右边。写在后面的话
// 翻过来就跑到气泡左边去了，两边的头像挤在中间 —— 原先就是这个样子。
//
// 一次画多少条跟着「设置 - 用量与上限」里那个「一次画多少条气泡」走，
// 和会话页同一个设置、同一个意思（第 5 条：同一件事只有一个开关）。
// 不够按「查看更早的消息」再要一段，也可以在那儿改成全都要（第 13 条）。

const pageSize = () => db.settings.get().chatPage || Infinity;

// 非文字的那几种：content 里本来就存着 [图片：…] 这样的标记（第 14 条，
// 那是协议不是文案），有就直接用。没有的才按类别给一个名字。
const KINDS = {
  voice: '语音', sticker: '表情', call: '通话', gift: '礼物', letter: '信',
  transfer: '转账', location: '位置', dice: '骰子', takeout: '外卖',
  pact: '约定', watch: '一起看', listen: '一起听', excerpt: '摘录', outfit: '搭配', groom: '动作', dresscode: '穿搭盲盒', slip: '包里的东西', narration: '旁白',
  read: '已读', notice: '提示', request: '请求', recent: '最近',
};

function Line({ msg, char, me }) {
  // 图片直接画出来。别的用文字 —— 这一页是看个样子，不是把会话页搬过来
  const url = useThumb(msg.kind === 'image' ? msg.imageId : null);
  const mine = msg.role !== 'user';          // 这台手机的主人是角色
  const text = String(msg.content || '').trim() || KINDS[msg.kind] || '一条消息';
  return html`
    <div class=${`tp-line${mine ? ' is-me' : ''}`}>
      ${mine
        ? html`<${CharAvatar} subject=${char} size=${28}/>`
        : html`<${CharAvatar} subject=${me} name=${me?.name || '我'} size=${28}/>`}
      ${url
        ? html`<span class="tp-bubble tp-bubble-img"><img src=${url} alt="" loading="lazy"/></span>`
        : html`<span class="tp-bubble">${text}</span>`}
    </div>`;
}

export function RealPage({ charId, chatId }) {
  useStore(db.characters.store);
  useStore(db.chats.store);
  useStore(db.messages.store);
  useStore(db.settings.store);

  const [shown, setShown] = useState(pageSize);
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);
  // 换一段会话就从头数起
  useEffect(() => { setShown(pageSize()); setDraft(''); }, [chatId]);
  // 进来先看见最近那几句，和输入框 —— 聊天页打开时本来就在底下，
  // 停在顶上等人自己往下划是不对的
  useEffect(() => {
    const t = setTimeout(() => endRef.current?.scrollIntoView({ block: 'end' }), 60);
    return () => clearTimeout(t);
  }, [chatId]);

  const char = db.characters.get(charId);
  const chat = db.chats.get(chatId);
  if (!char || !chat) {
    return html`<${Page} title="与你" onBack=${nav.pop}>
      <${EmptyState} title="这段对话已经不在了"/><//>`;
  }

  const me = db.personas.get(chat.personaId);
  const all = db.messagesOf(chatId);
  const list = shown === Infinity ? all : all.slice(-shown);
  const earlier = all.length - list.length;

  // 登着它的手机打出去的那一句，是**它**发的
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    db.messages.create({
      chatId, role: 'assistant', authorId: charId, kind: 'text',
      content: text, status: 'done',
    });
    db.chats.update(chatId, { lastMessageAt: Date.now() });
    toast(`已以${char.name}的身份发出`, 'ok');
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
  };

  return html`
    <${Page} title=${phone.remark.shownToChar(db.chats.get(chatId)) || '与你'} onBack=${nav.pop}>
      ${all.length ? html`
        <div class="tp-talk">
          ${earlier ? html`
            <div class="pad-b">
              <${Button} full variant="ghost"
                onClick=${() => setShown(n => (n === Infinity ? n : n + pageSize()))}>
                查看更早的消息（还有 ${earlier} 条）
              <//>
            </div>` : null}
          ${list.map(m => html`<${Line} key=${m.id} msg=${m} char=${char} me=${me}/>`)}
          <div ref=${endRef}></div>
        </div>`
      : html`<${EmptyState} icon="message" title="还没有消息"
          desc=${`在下面写一句，以${char.name}的身份发给你自己。`}/>`}

      <div class="pad-x">
        <div class="composer composer-inline">
          <textarea rows="1" value=${draft}
            placeholder=${`以${char.name}的身份发送`}
            onInput=${e => setDraft(e.target.value)}></textarea>
          <button class="send-btn press" disabled=${!draft.trim()}
            aria-label="发送" onClick=${send}>
            <${Icon} name="send" size=${16}/>
          </button>
        </div>
      </div>

      <div class="pad">
        <${Button} full variant="ghost"
          onClick=${() => intent.open('chat', { route: `/chat/${chatId}`, back: true })}>
          在「聊天」中打开
        <//>
      </div>
      <div class="settings-foot">
        这一段是真实的对话记录。在此处发送的消息以${char.name}的身份写入这段对话，
        与该角色自己发出的消息没有区别，不调用接口。
        长按、多选、撤回等操作在「聊天」中进行。图片以外的内容以文字显示。
      </div>
    <//>`;
}

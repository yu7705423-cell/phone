import { html, useState, useEffect } from '../../../lib.js';
import { phone, useStore, useThumb } from '../../../sdk/index.js';
import { Page, Button, EmptyState } from '../../../ui/index.js';
import { CharAvatar } from '../parts.js';

const { db, nav, intent } = phone;

// 和你的那一段，在它自己的手机上看。
//
// 从前这一条是跳回「聊天」那个 app 的。**那一下把「翻别人手机」这件事
// 打断了**：正翻着它的相册、备忘录，点一条会话，人忽然回到了自己的聊天界面，
// 而且退不回来 —— 跨 app 那一跳过去没有回头路。
//
// 现在就在这儿画。**只读**：这一页是「它手机上显示着什么」，不是你的输入框。
// 要回话、要长按、要多选，按底下那一个按钮去「聊天」，那才是干活的地方。
//
// 左右两边是反过来的：这是**它的**手机，所以它说的话在右边（is-me），
// 你说的在左边。
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
  pact: '约定', watch: '一起看', listen: '一起听', excerpt: '摘录',
  read: '已读', notice: '提示', request: '请求', recent: '最近',
};

function Line({ msg, char, me }) {
  // 图片直接画出来。别的用文字 —— 这一页是看个样子，不是把会话页搬过来
  const url = useThumb(msg.kind === 'image' ? msg.imageId : null);
  const mine = msg.role !== 'user';          // 这台手机的主人是角色
  const text = String(msg.content || '').trim() || KINDS[msg.kind] || '一条消息';
  return html`
    <div class=${`tp-line${mine ? ' is-me' : ''}`}>
      ${mine ? null : html`<${CharAvatar} subject=${me} name=${me?.name || '我'} size=${28}/>`}
      ${url
        ? html`<span class="tp-bubble tp-bubble-img"><img src=${url} alt="" loading="lazy"/></span>`
        : html`<span class="tp-bubble">${text}</span>`}
      ${mine ? html`<${CharAvatar} subject=${char} size=${28}/>` : null}
    </div>`;
}

export function RealPage({ charId, chatId }) {
  useStore(db.characters.store);
  useStore(db.chats.store);
  useStore(db.messages.store);
  useStore(db.settings.store);

  const [shown, setShown] = useState(pageSize);
  // 换一段会话就从头数起
  useEffect(() => { setShown(pageSize()); }, [chatId]);

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

  return html`
    <${Page} title=${me?.name || '与你'} onBack=${nav.pop}>
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
        </div>`
      : html`<${EmptyState} icon="message" title="还没有消息"
          desc="这段对话还没有内容。"/>`}

      <div class="pad">
        <${Button} full variant="ghost"
          onClick=${() => intent.open('chat', { route: `/chat/${chatId}`, back: true })}>
          在「聊天」中打开
        <//>
      </div>
      <div class="settings-foot">
        这一段是真实的对话记录，此处只作查看，不能发送或修改。
        图片以外的内容以文字显示。
      </div>
    <//>`;
}

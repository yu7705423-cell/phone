import { skins, chats } from './db/index.js';

// 美化。见 ARCHITECTURE 4.111
//
// **按会话隔离，不是全局。** 一份美化挂在若干段会话上，只在那段会话的页面
// 开着时才注入，离开就摘掉。这一条同时就是安全机制：写坏的那份只坏一个
// 聊天页，而「清除」的入口在**没上美化的消息列表**上，永远够得着。
//
// 两层，别混（4.111 里有表）：
//   令牌层  已经是 CSS 变量的那些，滑杆改，逐项可回退，导出得出来
//   自由层  用户手写，什么都能改，也什么都能弄坏，只能整段清掉
// 生成的 CSS 顺序固定：令牌在前，自由在后 —— 自由层永远盖得住令牌层。

export { skins };

/**
 * 能调的那几样。**只列已经是变量的**：写死在 CSS 里的调不了，
 * 要调就得先把它提成令牌（tokens.css 那一组会话页尺寸就是这么来的）。
 *
 * 没设过的项**整条不发**，那一项就还是 app 自己的值。所以 def 只用来
 * 在界面上当提示，不参与生成。
 */
export const TOKENS = [
  { id: 'navH', css: '--navbar-h', label: '顶栏高度', unit: 'px', def: 48, min: 28, max: 88 },
  { id: 'barH', css: '--composer-h', label: '底栏按钮大小', unit: 'px', def: 38, min: 26, max: 60,
    desc: '输入框的最小高度也是它。底栏偏高多半调这一项' },
  { id: 'barPad', css: '--composer-pad', label: '底栏内边距', unit: 'px', def: 8, min: 0, max: 24 },
  { id: 'gap', css: '--bubble-gap', label: '消息间距', unit: 'px', def: 16, min: 0, max: 48 },
  { id: 'gapIn', css: '--bubble-gap-in', label: '同一轮内间距', unit: 'px', def: 5, min: 0, max: 24 },
  { id: 'bubbleR', css: '--bubble-r', label: '气泡圆角', unit: 'px', def: 14, min: 0, max: 30 },
  { id: 'bubblePX', css: '--bubble-px', label: '气泡左右内距', unit: 'px', def: 12, min: 2, max: 32 },
  { id: 'bubblePY', css: '--bubble-py', label: '气泡上下内距', unit: 'px', def: 8, min: 2, max: 28 },
  { id: 'bubbleFS', css: '--bubble-fs', label: '气泡字号', unit: 'px', def: 14, min: 11, max: 24 },
];

export const SHAPES = [
  { id: '', label: '跟随默认', css: '' },
  { id: 'round', label: '圆形', css: '50%' },
  { id: 'square', label: '方形', css: '4px' },
  { id: 'soft', label: '圆角方形', css: '10px' },
];

// 工坊里摆出来给人抄的那一份。**和挂载点是同一份数据**，
// 不另写一张表 —— 两张表迟早对不上。
export const CLASSES = [
  { sel: '.conv-body', label: '消息列表' },
  { sel: '.msg', label: '一条消息（含头像）' },
  { sel: '.msg.is-mine', label: '我发的那一条' },
  { sel: '.msg-col', label: '同一轮的几个气泡' },
  { sel: '.bubble', label: '气泡' },
  { sel: '.msg.is-mine .bubble', label: '我的气泡' },
  { sel: '.avatar', label: '头像' },
  { sel: '.navbar', label: '顶栏' },
  { sel: '.nav-title', label: '顶栏标题' },
  { sel: '.composer-bar', label: '底栏' },
  { sel: '.composer-input', label: '输入框' },
  { sel: '.composer-side', label: '底栏圆按钮' },
  { sel: '.send-btn', label: '发送键' },
  { sel: '.quote-ref', label: '引用条' },
  { sel: '.bubble-sticker', label: '表情气泡' },
];

export const all = () => skins.all().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
export const get = id => skins.get(id);

export function create(init = {}) {
  return skins.create({
    name: String(init.name || '未命名').trim() || '未命名',
    tokens: init.tokens || {}, shape: init.shape || '', css: String(init.css || ''),
    createdAt: Date.now(), updatedAt: Date.now(),
  });
}

export function update(id, patch) {
  if (!skins.has(id)) return null;
  return skins.update(id, { ...patch, updatedAt: Date.now() });
}

/** 删一份。挂着它的会话一并摘掉，否则那几段会话指向一个不存在的 id。 */
export function remove(id) {
  chats.all().forEach(c => { if (c.skinId === id) chats.update(c.id, { skinId: '' }); });
  skins.remove(id);
}

export const ofChat = chatId => get(chats.get(chatId)?.skinId || '') || null;
export const attach = (chatId, skinId) => chats.update(chatId, { skinId: skinId || '' });
export const detach = chatId => attach(chatId, '');
export const usedBy = id => chats.where(c => c.skinId === id).length;

/**
 * 编译成一段 CSS。
 *
 * **不改写用户写的选择器。** 隔离靠的是「只在那一页挂着」，不是靠重写
 * 选择器 —— 重写要一个真的 CSS 解析器，而 @media、嵌套、伪元素上每一处
 * 想当然都会写错，错了还是静默的。时间上的隔离够用，而且解释得清楚。
 */
export function compile(skin) {
  if (!skin) return '';
  const out = [];
  const vars = TOKENS
    .filter(t => skin.tokens?.[t.id] != null && skin.tokens[t.id] !== '')
    .map(t => `${t.css}:${Math.round(Number(skin.tokens[t.id]))}${t.unit || ''}`);
  const shape = SHAPES.find(s => s.id === skin.shape);
  if (shape?.css) vars.push(`--avatar-r:${shape.css}`);
  if (vars.length) out.push(`:root{${vars.join(';')}}`);
  const css = String(skin.css || '').trim();
  if (css) out.push(css);
  return out.join('\n');
}

// ---- 挂上去 / 摘下来 ----

const NODE_ID = 'skin-css';
const MARK = 'skinTrying';

/**
 * 上一次挂这份美化时页面没能活下来，这一次就不挂了。
 *
 * 清除的入口在消息列表上（那一页不上美化），所以理论上总够得着。这一条
 * 是第二道：万一那份 CSS 连列表都拖垮了，重进一次就是素颜的。
 */
export const crashed = id => {
  try { return localStorage.getItem(MARK) === String(id); } catch { return false; }
};

const dropNode = () => document.getElementById(NODE_ID)?.remove();

export function mount(skin) {
  dropNode();
  if (!skin) return false;
  if (crashed(skin.id)) return false;
  const text = compile(skin);
  if (!text.trim()) return true;
  try { localStorage.setItem(MARK, skin.id); } catch { /* 无痕模式，认了 */ }
  const el = document.createElement('style');
  el.id = NODE_ID;
  el.textContent = text;
  document.head.appendChild(el);
  return true;
}

/**
 * 活过来了，把记号清掉。**只有这里清。**
 *
 * 从前 unmount 也顺手清了一次，那等于守卫不存在：页面炸掉时
 * ErrorBoundary 会把这一层卸下来，卸载就清记号，下次进来照样注入那份
 * 坏 CSS。所以卸载只摘节点，「这一份是好的」只能由渲染活过一段时间来证明。
 */
export function settle() {
  try { localStorage.removeItem(MARK); } catch { /* 同上 */ }
}

export function unmount() { dropNode(); }

/** 手动解除那个记号，给「它说上次崩了，但我改好了」用。 */
export const forgive = () => settle();

import { skins, chats, settings } from './db/index.js';
import { compressFit } from './db/images.js';
import { SCOPES, scopeOf, isGlobal } from './skin-contract.js';
import { emit as emitGen } from './skin-gen.js';

export { SCOPES, scopeOf, isGlobal, HOOKS, VARS, CONTRACT_VERSION } from './skin-contract.js';
export * as gen from './skin-gen.js';
export { buildStage, SAMPLE, hooksInStage, stageCss } from './skin-stage.js';

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
  { id: 'navH', css: '--ph-navbar-h', label: '顶栏高度', unit: 'px', def: 48, min: 28, max: 88 },
  { id: 'barH', css: '--ph-composer-h', label: '底栏按钮大小', unit: 'px', def: 38, min: 26, max: 60,
    desc: '输入框的最小高度也是它。底栏偏高多半调这一项' },
  { id: 'barPad', css: '--ph-composer-pad', label: '底栏内边距', unit: 'px', def: 8, min: 0, max: 24 },
  { id: 'gap', css: '--ph-bubble-gap', label: '消息间距', unit: 'px', def: 16, min: 0, max: 48 },
  { id: 'gapIn', css: '--ph-bubble-gap-in', label: '同一轮内间距', unit: 'px', def: 5, min: 0, max: 24 },
  { id: 'bubbleR', css: '--ph-bubble-r', label: '气泡圆角', unit: 'px', def: 14, min: 0, max: 30 },
  { id: 'bubblePX', css: '--ph-bubble-px', label: '气泡左右内距', unit: 'px', def: 12, min: 2, max: 32 },
  { id: 'bubblePY', css: '--ph-bubble-py', label: '气泡上下内距', unit: 'px', def: 8, min: 2, max: 28 },
  { id: 'bubbleFS', css: '--ph-bubble-fs', label: '气泡字号', unit: 'px', def: 14, min: 11, max: 24 },
];

export const SHAPES = [
  { id: '', label: '跟随默认', css: '' },
  { id: 'round', label: '圆形', css: '50%' },
  { id: 'square', label: '方形', css: '4px' },
  { id: 'soft', label: '圆角方形', css: '10px' },
];

// ---- 头像框 ----
//
// **画在头像外面的一圈，不改头像本身。** 挂在 `.msg-face` 的 `::after` 上：
// 那个盒子正好就是头像那一块，框按它的百分比放大，头像是圆是方都不受影响。
//
// 图存成 data URL，直接写进生成的那段 CSS 里。**不走 images 库**，理由是
// `compile` 是同步的 —— 挂载、预览、卡片光栅三处都在同步路径上，
// 换成按 id 现取就要让这三处全部变成异步。代价是美化包会变大，
// 导出前把这件事写在确认框里。

export const FRAME_WHO = [
  { id: 'both', label: '双方', sel: '.msg-face' },
  { id: 'char', label: '仅角色', sel: '.msg:not(.is-mine) .msg-face' },
  { id: 'mine', label: '仅自己', sel: '.msg.is-mine .msg-face' },
];
export const frameWhoOf = skin => FRAME_WHO.find(x => x.id === skin?.frameWho) || FRAME_WHO[0];

/** 框比头像大多少。100 是正好一样大，框本身四周留白的多少由图决定。 */
export const FRAME_SCALE_DEF = 160;
export const FRAME_SCALE_MIN = 100;
export const FRAME_SCALE_MAX = 300;
export function frameScaleOf(skin) {
  const n = Math.round(Number(skin?.frameScale));
  if (!Number.isFinite(n) || n <= 0) return FRAME_SCALE_DEF;
  return Math.max(FRAME_SCALE_MIN, Math.min(FRAME_SCALE_MAX, n));
}

/**
 * 存成多大。头像本身只有 36 像素，三倍屏上 108，512 已经绰绰有余。
 * 再大只是把美化包撑起来，屏幕上一点看不出来。
 */
export const FRAME_MAX = 512;

/** 只认 data:image/。别的一律不往生成的 CSS 里写 —— 那段是我们自己拼的字符串。 */
const frameUrlOk = url => /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+$/.test(String(url || ''));

/**
 * 换一张头像框。
 *
 * 用 `compressFit`：整张图放进正方形画布，留白透明，**不居中裁切** ——
 * 框的四个角正是它最要紧的地方，裁掉就不成其为框了。
 * 它输出 webp（带透明通道），不支持的退回 png，两者都留得住透明。
 */
export async function toDataUrl(file) {
  const { blob } = await compressFit(file, FRAME_MAX);
  const url = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || ''));
    fr.onerror = () => rej(new Error('这张图读不出来'));
    fr.readAsDataURL(blob);
  });
  if (!frameUrlOk(url)) throw new Error('这张图转不成可嵌入的格式');
  return url;
}


function frameCss(skin) {
  const url = String(skin?.frame || '');
  if (!frameUrlOk(url)) return '';
  const sel = frameWhoOf(skin).sel;
  const pct = frameScaleOf(skin);
  // `.msg-face` 本身没有定位，`::after` 没处可挂，所以这一条要一起发
  return `${sel}{position:relative}\n`
    + `${sel}::after{content:'';position:absolute;left:50%;top:50%;`
    + `transform:translate(-50%,-50%);width:${pct}%;height:${pct}%;`
    + `background:url("${url}") center/contain no-repeat;pointer-events:none}`;
}

export const all = () => skins.all().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
export const get = id => skins.get(id);

export function create(init = {}) {
  return skins.create({
    name: String(init.name || '未命名').trim() || '未命名',
    tokens: init.tokens || {}, shape: init.shape || '', css: String(init.css || ''),
    // 生效范围。不写就是「单段会话」，那是从前唯一的行为
    scope: scopeOf(init),
    // 生成器那一堆旋钮的值。存着才能回来接着调，而不是每次从头来
    gen: init.gen && typeof init.gen === 'object' ? structuredClone(init.gen) : {},
    // 头像框三件一起存。少存一件，复制和导入过来的那一份就会戴错人或错大小
    frame: frameUrlOk(init.frame) ? String(init.frame) : '',
    frameWho: FRAME_WHO.some(x => x.id === init.frameWho) ? String(init.frameWho) : 'both',
    frameScale: frameScaleOf(init),
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
  // 设为全局的正是它的话，一并取消。少这一行就是一个指向空 id 的全局设置，
  // 表现为「删了之后全局美化再也设不回来」
  if (settings.get().globalSkinId === id) settings.set({ globalSkinId: '' });
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
export function compile(skin, { varsOn = ':root' } = {}) {
  if (!skin) return '';
  const out = [];
  const vars = TOKENS
    .filter(t => skin.tokens?.[t.id] != null && skin.tokens[t.id] !== '')
    .map(t => `${t.css}:${Math.round(Number(skin.tokens[t.id]))}${t.unit || ''}`);
  const shape = SHAPES.find(s => s.id === skin.shape);
  if (shape?.css) vars.push(`--ph-avatar-r:${shape.css}`);
  // 令牌挂在哪个选择器上。**只有这一段是我们自己生成的，所以换得起** ——
  // 用户手写的那一段一个字都不改（见上面「不重写用户的选择器」）。
  // 画在 shadow root 里时要换成 :host：那里面没有 :root，整段会静静地不生效
  if (vars.length) out.push(`${varsOn}{${vars.join(';')}}`);
  // 头像框排在令牌之后、手写 CSS 之前：它和令牌一样是「我们生成的那一层」，
  // 手写那一段仍然盖得住它
  const frame = frameCss(skin);
  if (frame) out.push(frame);
  // 生成器那一段。排在手写之前：手写的排最后，才盖得住它
  // （那一段带 !important，所以手写要盖也得写 !important，界面上说明了）
  const made = emitGen(skin.gen);
  if (made) out.push(made);
  const css = String(skin.css || '').trim();
  if (css) out.push(css);
  return out.join('\n');
}


/**
 * 复刻页外面那一圈。**只管把它摆成一部手机的形状**，里面每一件的样子
 * 都来自 app.css，和真页面同一份 —— 这儿多写一条，预览就和真页面差一条。
 */
export const STAGE_CSS = `
:host { display: block; }
.stage-scale { width: 430px; transform-origin: 0 0; }
.stage-page { display: flex; flex-direction: column; height: 620px; background: var(--bg); }
.stage-page .conv { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.stage-page .conv-main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.stage-page .conv-body { flex: 1; min-height: 0; overflow: hidden; }
/* **安全区照着真机摆一段，不抹掉。**
   真机上底栏那一块是「内边距 + 安全区」，iPhone 上那条横杠要占 34 像素。
   从前这里把它抹成 0，于是预览里看不到那一块，人调完到真机上才发现
   下面还空一大截 —— 预览的意义就没了。 */
.stage-page { --safe-bottom: 34px; }
.stage-page textarea { pointer-events: none; }
`;

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

// 这一次挂上去的是哪一份（记号是这次写的才算），以及挂着的时候页面炸没炸
let trying = null;
let broke = false;

export function mount(skin) {
  dropNode();
  trying = null;
  broke = false;
  if (!skin) return false;
  if (crashed(skin.id)) return false;
  const text = compile(skin);
  if (!text.trim()) return true;
  try { localStorage.setItem(MARK, skin.id); trying = skin.id; } catch { /* 无痕模式，认了 */ }
  const el = document.createElement('style');
  el.id = NODE_ID;
  el.textContent = text;
  document.head.appendChild(el);
  return true;
}

/**
 * 活过来了，把记号清掉。
 *
 * 两条路能走到这儿：渲染活过一段时间（页面上的定时器），或者人正常离开
 * 了这一页（下面的 unmount）。**页面炸掉时不算正常离开**：错误边界接到
 * 异常会先叫一声 reportCrash，卸载时看见那个记号就留着，下次进来不注入。
 *
 * 从前卸载一律不清，只靠定时器。可定时器要几百毫秒，人在美化页改一个数
 * 立刻按返回，定时器被清掉，记号留下 —— 一份好好的美化被当成崩过的，
 * 回到会话页就是素颜，还要去点「恢复」。
 */
export function settle() {
  try { localStorage.removeItem(MARK); } catch { /* 同上 */ }
}

/** 错误边界接到异常时调一下。见 system/runtime.js */
export function reportCrash() { broke = true; }

export function unmount() {
  dropNode();
  // 只清这次自己写的记号。上次崩过、这次没挂上的那种，记号不是这次写的，
  // 清了等于每隔一次就再炸一回
  if (trying && !broke) settle();
  trying = null;
}

/** 手动解除那个记号，给「它说上次崩了，但我改好了」用。 */
export const forgive = () => settle();

// ---- 全局那一层 ----
//
// 会话那一层挂在 `<head>` 里的 `skin-css`，进那一页才有，离开就摘。
// 全局这一层是另一个节点 `skin-global`，一直挂着。**两层分开，不许合并**：
// 合了的话，关掉全局的那一下会把会话那一份也摘掉。
//
// ---- 逃生口 ----
//
// 会话那一层的逃生口是「消息列表不上美化」，天然存在。全局这一层没有
// 这种天然的地方，所以人为留两个：
//
//   一、**设置 app 永不注入。** 由 shell 判断，见 shell/Root.js。
//       写坏了整个界面的时候，设置那一页仍然是素颜的，进得去、点得到
//   二、**一个总开关。** settings.skinOff，在「外观」里，关掉两层都不注入
//
// 崩溃记号（上面那个 MARK）两层共用：全局那一份挂上之前也记，活过一段
// 时间才清。上次进来就崩在它身上的，这次不注入。

const GLOBAL_ID = 'skin-global';

const dropGlobal = () => document.getElementById(GLOBAL_ID)?.remove();

/**
 * 全局那一层挂上或摘掉。`skin` 为空、或者这一页不许注入时摘掉。
 *
 * 返回真表示这一次是挂上了。调用方拿它决定要不要起那个「活过来了」的定时器。
 */
export function mountGlobal(skin) {
  dropGlobal();
  if (!skin || !isGlobal(skin)) return false;
  if (crashed(skin.id)) return false;
  const text = compile(skin);
  if (!text.trim()) return true;
  try { localStorage.setItem(MARK, skin.id); trying = skin.id; } catch { /* 无痕模式，认了 */ }
  const el = document.createElement('style');
  el.id = GLOBAL_ID;
  el.textContent = text;
  document.head.appendChild(el);
  return true;
}

export function unmountGlobal() {
  dropGlobal();
  if (trying && !broke) settle();
  trying = null;
}

/**
 * 当前设为全局的那一份。没设、设的那份没了、或者总开关关着，都回 null。
 *
 * **读不出来就当没有，不许抛。** 这个函数在 `shell/Root.js` 的渲染路径上，
 * 位置比错误边界还靠外 —— 它抛一下，整棵树当场没了，屏幕全白，
 * 而错误边界本来是能把单个 app 的崩溃兜住的。少一个 try 就是「一个 app
 * 出问题，整台手机打不开」。
 */
export function globalSkin() {
  try {
    const s = settings.get();
    if (s.skinOff === true) return null;
    const row = get(s.globalSkinId || '');
    return row && isGlobal(row) ? row : null;
  } catch { return null; }
}

/** 设为全局。传空就是取消。设了全局的那一份自动带上 shell 这一档。 */
export function setGlobal(id) {
  if (!id) { settings.set({ globalSkinId: '' }); return null; }
  const row = get(id);
  if (!row) return null;
  if (!isGlobal(row)) update(id, { scope: [...scopeOf(row), 'shell'] });
  settings.set({ globalSkinId: id });
  return get(id);
}

// ---- 美化包：导成一个文件，也导得回来 ----
//
// **叫「美化包」，和「角色包」同一套叫法。** 这套东西从头到尾叫美化，
// 不另起第二个名字 —— 两个词指一件事，用户要学两遍。
//
// 只带这一份自己的东西：名字、令牌、头像形状、那段 CSS。**不带它挂在
// 哪几段会话上** —— 那是本机的事，别人导进去自然要自己挂。

export const PACK_VERSION = 1;
const PACK_KIND = 'phone-skin';

/**
 * 这段 CSS 引用了哪些外部的东西。
 *
 * **图片不在美化行里**，它只可能出现在用户手写的那段 CSS 的 `url(...)` 里。
 * 三种下场完全不同，所以分开数，导出前摆给人看：
 *
 *   data:    已经内联在文本里，跟着包走，只是包会变大
 *   http(s): 跟着包走的只是地址。对方打得开才看得见，而且那台服务器
 *            会知道对方什么时候开了这段会话
 *   其余:    `blob:`、相对路径这些指的是本机的东西，**分享出去就是空框**
 */
export function assetsOf(css) {
  const out = { data: 0, remote: 0, local: [] };
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let m;
  while ((m = re.exec(String(css || '')))) {
    const u = m[2].trim();
    if (/^data:/i.test(u)) out.data += 1;
    else if (/^https?:\/\//i.test(u)) out.remote += 1;
    else out.local.push(u.slice(0, 60));
  }
  return out;
}

/** 导出成一段文本。 */
export function pack(skin) {
  if (!skin) throw new Error('这一份美化不存在');
  return JSON.stringify({
    kind: PACK_KIND, version: PACK_VERSION,
    name: String(skin.name || '未命名'),
    tokens: skin.tokens || {},
    shape: String(skin.shape || ''),
    scope: scopeOf(skin),
    // 旋钮的值也一起带走。别人导进去能接着调，而不是只拿到一段死 CSS
    gen: skin.gen || {},
    frame: String(skin.frame || ''),
    frameWho: frameWhoOf(skin).id,
    frameScale: frameScaleOf(skin),
    css: String(skin.css || ''),
  }, null, 2);
}

/**
 * 读一个美化包。
 *
 * **只认识的字段才留下。** 别人给的文件里有什么不归我们管，照单全收
 * 等于把任意字段写进库里，以后哪一处读到它都可能出怪事。
 * 认不出就说清楚认不出在哪儿，不要一句「文件无效」。
 */
export function unpack(text) {
  let raw;
  try { raw = JSON.parse(String(text || '')); }
  catch { throw new Error('这不是一个美化包：内容不是有效的 JSON'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('这不是一个美化包：内容不是一个对象');
  }
  if (raw.kind !== PACK_KIND) {
    throw new Error(`这不是一个美化包：标记写的是「${String(raw.kind || '空').slice(0, 20)}」`);
  }
  if (Number(raw.version) > PACK_VERSION) {
    throw new Error(`这个美化包来自更新的版本（${raw.version}），当前版本读不了`);
  }
  const tokens = {};
  TOKENS.forEach(t => {
    const v = raw.tokens?.[t.id];
    if (v === '' || v == null) return;
    const n = Math.round(Number(v));
    if (Number.isFinite(n)) tokens[t.id] = n;
  });
  const shape = SHAPES.some(x => x.id === raw.shape) ? String(raw.shape) : '';
  // 头像框是别人文件里的一张图。**只认 data:image 的 base64**：
  // 这个字符串会被原样拼进一段 CSS，放行别的形式等于让包决定往哪儿发请求
  const frame = frameUrlOk(raw.frame) ? String(raw.frame) : '';
  const frameWho = FRAME_WHO.some(x => x.id === raw.frameWho) ? String(raw.frameWho) : 'both';
  return {
    name: String(raw.name || '未命名').trim().slice(0, 40) || '未命名',
    // 老包（v1）没有这一项，一律当「单段会话」—— 那是从前唯一的行为。
    // 默认成全局就等于替作者把影响面扩大了一圈，而他当初没这么写
    scope: scopeOf(raw),
    gen: raw.gen && typeof raw.gen === 'object' && !Array.isArray(raw.gen) ? raw.gen : {},
    tokens, shape, frame, frameWho, frameScale: frameScaleOf(raw),
    css: String(raw.css || ''),
  };
}

/**
 * 装进库里。
 *
 * **重名不覆盖，加一个后缀。** 覆盖掉别人调了半天的那一份，比多出一行糟得多。
 */
export function install(data) {
  const taken = new Set(all().map(x => x.name));
  let name = data.name;
  for (let i = 2; taken.has(name); i++) name = `${data.name}（${i}）`;
  const row = create({ ...data, name });
  // 老包里的头像框当场搬进生成器，不然它会变成一个改不了的框
  migrateFrames();
  return get(row.id) || row;
}

/**
 * 复制一份。名字后面缀一个「副本」，重名再加数字。
 *
 * 调好一份再在它基础上改，比从头写一遍常见得多 —— 而从前只能导出再导入，
 * 绕一大圈还多出一个文件。
 */
export function duplicate(id) {
  const src = get(id);
  if (!src) return null;
  const taken = new Set(all().map(x => x.name));
  const base = `${src.name} 副本`;
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
  return create({ name, tokens: { ...(src.tokens || {}) }, shape: src.shape, css: src.css,
    scope: scopeOf(src), gen: src.gen || {},
    frame: src.frame || '', frameWho: src.frameWho || 'both', frameScale: frameScaleOf(src) });
}

/**
 * 老的头像框搬进生成器。
 *
 * 头像框从前是美化行上的三个字段（`frame` / `frameWho` / `frameScale`），
 * 编辑入口在「尺寸」那一页。后来生成器的「头像」那一组把这件事做全了
 * （收发各一张、能偏移），于是同一个开关有了两个入口 —— 违反第 5 条，
 * 而且两处存的还是两份数据。
 *
 * 所以搬过去，老字段清空。**不是删掉，是搬** —— 已经戴上框的那些美化
 * 一张都不能丢。启动时跑一次，跑过就没得搬了。
 */
export function migrateFrames() {
  let n = 0;
  for (const row of skins.all()) {
    const url = String(row.frame || '');
    if (!frameUrlOk(url)) continue;
    const who = FRAME_WHO.some(x => x.id === row.frameWho) ? row.frameWho : 'both';
    const av = { ...(row.gen?.avatar || {}) };
    if (who === 'both' || who === 'char') av.frameTheirs = av.frameTheirs || url;
    if (who === 'both' || who === 'mine') av.frameMine = av.frameMine || url;
    av.frameScale = av.frameScale || frameScaleOf(row);
    update(row.id, { gen: { ...(row.gen || {}), avatar: av }, frame: '' });
    n += 1;
  }
  if (n) console.warn(`[skin] ${n} 份美化的头像框已搬进生成器`);
  return n;
}

/** 这一份挂在哪几段会话上。库那一页要能说清楚「删了会影响谁」。 */
export const chatsUsing = id => chats.all().filter(c => c.skinId === id);

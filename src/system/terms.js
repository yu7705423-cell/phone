import { createStore } from './store.js';
import { settings } from './db/index.js';

// 使用须知与内测说明（用户要求，ARCHITECTURE 4.246）。
//
// 第一次打开时挡在最前面：先读使用须知，再逐条确认六条内测说明，每一步「同意 / 不同意」。
// 任意一步不同意：安卓安装包里直接关掉应用（NativeBridge.exitApp），别的环境网页没法自己关掉自己，
// 换成结束页，进不去应用。
//
// **只弹一次**（用户原话：「弹一次就够了，不要更新一次看一次」）。VERSION 只在须知内容有实质改动、
// 并且用户同意要所有人重新确认时才改，发版不改它。
// 同意记在两处：localStorage（读得最快，开机就知道）与 settings.termsAccepted（跟着备份走，
// 换设备恢复之后不再问）。任意一处认了就算同意 —— 宁可少弹，不因为某一处读失败又弹一遍。
//
// 自动化测试里默认不弹（几百个测试都会被它挡住），专门测它的那一个在 localStorage 里放 eira-terms-test。

export const VERSION = '1';
const KEY = 'eira-terms';

export const TITLE = 'Eira 使用须知';

export const NOTICE = {
  intro: '在使用 Eira 前，请确认你符合以下条件，并阅读、理解以下说明：',
  sections: [
    { title: '1. 使用资格', body: ['Eira 仅面向已年满 18 周岁的成年女性使用。未满 18 周岁者请勿使用。'] },
    { title: '2. 数据与隐私', body: [
      'Eira 本身不建立或保存云端聊天记录，聊天内容及相关数据原则上仅保存在你的本地设备中。',
      '生成回复时，对话内容会发送给你所配置的第三方接口服务商。你开启「后台消息」「云端备份」等功能时，相关数据会发送到你自己配置的服务器或账号。接口密钥仅保存在本机。清除浏览器数据、卸载应用或更换设备，可能导致本地数据丢失，请定期备份。',
    ] },
    { title: '3. AI 生成内容', body: [
      '第三方 API 生成的内容属于自动生成内容，不代表 Eira 或相关服务商的立场、观点、承诺或建议。AI 生成内容可能存在错误、遗漏、虚构、不准确、不完整或不适用于特定情境的情况，不应被视为专业的法律、医疗、财务或其他专业意见。',
      '你应根据实际情况独立判断，并在必要时向具备相应资质的专业人士寻求帮助。对于 AI 生成内容的阅读、采用、修改、保存、传播或其他使用方式，请务必谨慎。',
    ] },
    { title: '4. 费用', body: [
      '接口费用由第三方服务商向你收取，Eira 不收取任何费用。每次生成、重试以及开启的自动功能都会产生调用，调用情况可在「设置 - 用量与上限」和「后台任务」中查看。',
    ] },
    { title: '5. 情感与现实边界', body: [
      'Eira 中的内容均由 AI 生成，无法替代专业人士的帮助。请重视现实中的人际关系与专业支持；如果你正经历难以承受的情绪困扰，请及时向身边信任的人或专业人士寻求帮助。',
    ] },
    { title: '6. 法律、平台规则与用户责任', body: [
      '你应自行确保通过 Eira 生成、输入、使用、保存、分享或传播的内容，符合你所在地区适用的法律法规，以及所使用的第三方服务、API 和相关平台的服务条款、内容政策及其他规则。',
      '不得利用 Eira 从事违法活动，侵犯他人隐私、著作权、商标权、名誉权或其他合法权益，或规避第三方服务的限制与安全措施。',
      '因用户自行输入、生成、使用、保存、分享或传播相关内容，或因用户违反适用法律法规、第三方服务规则而产生的责任、损失或争议，由用户自行承担。Eira 不对第三方 API 的可用性、准确性、持续性或其数据处理行为作出保证。',
    ] },
    { title: '7. 关于酒馆人设与世界书', body: [
      '不支持在 Eira 内直接使用、导入或运行来自「酒馆 / Tavern」的人设、世界书及相关角色设定文件。',
    ] },
  ],
  outro: '继续使用 Eira，即表示你已阅读并理解以上说明，并确认自己符合 Eira 的使用条件。',
};

export const BETA = {
  title: '内测说明',
  intro: '请仔细阅读、理解并确认以下内测说明。该项目处于测试运行阶段，你可能会面临以下问题：',
  items: [
    '测试处在不稳定期，需要自行备份存储内容、或上传云端备份。版本更新过程中可能会导致部分存储缺失。',
    '功能处于测试期，可能存在开发中未发现的 bug。',
    '部分 bug 可能会导致重复计费问题，请尽量使用单独的 API 密钥并设置额度上限。',
    '在浏览器中直接打开、未添加到主屏幕时，iPhone 等设备可能在一段时间未使用后自动清理网页数据。建议添加到主屏幕使用，并定期备份。',
    '标注为「测试阶段」的功能（如「后台消息」），请在了解其说明后谨慎开启。',
    '遇到问题请及时反馈。',
  ],
};

function testing() {
  if (typeof navigator === 'undefined' || !navigator.webdriver) return false;
  try { return localStorage.getItem('eira-terms-test') !== '1'; } catch { return true; }
}

function readLocal() {
  try { return localStorage.getItem(KEY) === VERSION; } catch { return false; }
}

export const accepted = () => testing() || readLocal() || settings.get().termsAccepted === VERSION;

// 界面订阅这个：同意之后外壳立刻放行；不同意之后画结束页
export const termsStore = createStore({ ok: false, declined: false });

export function refresh() { termsStore.set({ ok: accepted() }); }

export function accept() {
  try { localStorage.setItem(KEY, VERSION); } catch { /* 无痕模式记不住，靠 settings */ }
  settings.set({ termsAccepted: VERSION, termsAcceptedAt: Date.now() });
  termsStore.set({ ok: true, declined: false });
}

/** 不同意：安卓安装包里关掉应用，别处画结束页 */
export function decline() {
  try { if (window.EiraNative?.exitApp) { window.EiraNative.exitApp(); return; } } catch { /* 走结束页 */ }
  termsStore.set({ declined: true });
}

export const restart = () => termsStore.set({ declined: false });

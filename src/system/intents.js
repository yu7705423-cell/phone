// 跨 app 的唯一合法通道。调用方不知道谁来处理。
import { openApp } from './nav.js';
import { listApps } from './registry.js';
import { on, EVENTS } from './bus.js';

const handlers = new Map();   // intentId -> { appId, fn }

export function provide(appId, intentId, fn) {
  handlers.set(intentId, { appId, fn });
  return () => { if (handlers.get(intentId)?.appId === appId) handlers.delete(intentId); };
}

/**
 * 跳到另一个 app 的某一页。
 *
 * `params.back` 是「过去看一眼就回来」：那一页退到底时回到出发的地方，
 * 连同出发时那一整条栈。**凡是「去那边改一下 / 看一眼」的跳转都该带上它**
 * —— 不带的话过去了就没有回头路，人要自己重开原来那个 app、再点回去。
 * 不带的是真正的交接：从资料页「去聊天」，去了就是要待在那儿。
 */
export function open(appId, params) {
  const route = params?.route || '/';
  openApp(appId, route, { back: params?.back === true });
}

export async function request(intentId, params) {
  const h = handlers.get(intentId);
  if (!h) {
    const declared = listApps().find(a => (a.intents || []).includes(intentId));
    throw new Error(declared
      ? `${declared.name} 声明了 ${intentId} 但还没有注册处理函数`
      : `没有 app 能处理 ${intentId}`);
  }
  return h.fn(params);
}

export const canHandle = intentId => handlers.has(intentId);

// 点通知就跳过去。锁屏上的通知、顶上掉下来的横幅都走这里，
// notify() 本身只管发出事件，不知道点了会发生什么。
on(EVENTS.notificationOpen, item => {
  if (item?.appId) open(item.appId, item.payload);
});

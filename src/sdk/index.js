// app 唯一能接触到的系统入口。app 不允许 import system/ 下的任何东西。
import * as navApi from '../system/nav.js';
import * as intents from '../system/intents.js';
import * as notifyApi from '../system/notify.js';
import * as soundApi from '../system/sound.js';
import * as pushApi from '../system/push.js';
import * as bus from '../system/bus.js';
import { db } from '../system/db/index.js';
import { images } from '../system/db/images.js';
import { useStore, uid } from '../system/store.js';
import { useImage } from '../system/db/useImage.js';
import * as engine from '../system/ai/engine.js';
import * as queue from '../system/ai/queue.js';
import * as memoryCtx from '../system/ai/context/memory.js';
import * as loreCtx from '../system/ai/context/lorebook.js';
import { extract, shouldAutoExtract, pendingOf } from '../system/ai/tasks/memory-extract.js';
import * as momentTasks from '../system/ai/tasks/moments.js';
import { DEFAULT_TEMPLATES } from '../system/ai/templates.js';
import * as svc from '../system/ai/services.js';
import { fetchModels, filterModels } from '../system/ai/models.js';
import * as voice from '../system/ai/voice.js';
import * as image from '../system/ai/image.js';
import * as stickerApi from '../system/stickers.js';
import * as replyApi from '../system/ai/reply.js';
import * as proactiveApi from '../system/ai/proactive.js';
import { files, download } from '../system/db/files.js';
import { useFile } from '../system/db/useFile.js';
import { BLOCKS, DEFAULT_ORDER, resolveOrder } from '../system/ai/context/index.js';
import { toast, confirm, prompt } from '../ui/overlay.js';
import { appLook, listAppLooks } from '../system/look.js';
import { registryStore } from '../system/registry.js';

export const phone = {
  nav: {
    push: navApi.push,
    pop: navApi.pop,
    replace: navApi.replace,
    popToRoot: navApi.popToRoot,
    home: navApi.goHome,
    route: navApi.currentRoute,
  },

  db,
  images,
  files,
  downloadFile: download,
  stickers: stickerApi,

  // 已注册的 app 及其外观（含用户在设置里的自定义）
  apps: {
    list: listAppLooks,
    get: appLook,
    store: registryStore,
  },

  ai: {
    isConfigured: engine.isConfigured,
    config: engine.config,
    buildChatSystem: engine.buildChatSystem,
    buildHistory: engine.buildHistory,
    streamReply: engine.streamReply,
    isReplying: engine.isReplying,
    cancelReply: engine.cancelReply,
    runJSONTask: engine.runJSONTask,
    runTextTask: engine.runTextTask,
    template: engine.template,
    templates: DEFAULT_TEMPLATES,
    blocks: BLOCKS,
    defaultOrder: DEFAULT_ORDER,
    resolveOrder,
    memory: { ...memoryCtx, extract, shouldAutoExtract, pendingOf },
    lore: loreCtx,
    moments: momentTasks,
    services: svc,
    fetchModels,
    filterModels,
    voice,
    image,
    reply: replyApi,
    proactive: proactiveApi,
    runWithPreset: engine.runWithPreset,

    queue: {
      cancel: queue.cancel,
      cancelAll: queue.cancelAll,
      isRunning: queue.isRunning,
      stats: queue.stats,
      isAbort: queue.isAbort,
      setConcurrency: queue.setConcurrency,
    },
  },

  sound: soundApi,
  push: pushApi,

  intent: {
    open: intents.open,
    request: intents.request,
    provide: intents.provide,
    canHandle: intents.canHandle,
  },

  notify: notifyApi.notify,
  notifications: notifyApi,

  bus: { on: bus.on, emit: bus.emit, EVENTS: bus.EVENTS },

  ui: { toast, confirm, prompt },

  uid,
};

export { useStore, useImage, useFile, phone as default };
export function usePhone() { return phone; }

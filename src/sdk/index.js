// app 唯一能接触到的系统入口。app 不允许 import system/ 下的任何东西。
import * as navApi from '../system/nav.js';
import * as intents from '../system/intents.js';
import * as notifyApi from '../system/notify.js';
import * as accountsApi from '../system/accounts.js';
import * as soundApi from '../system/sound.js';
import * as pushApi from '../system/push.js';
import * as looksApi from '../system/looks.js';
import * as fontsApi from '../system/fonts.js';
import * as clockApi from '../system/time.js';
import * as bus from '../system/bus.js';
import { db } from '../system/db/index.js';
import { images } from '../system/db/images.js';
import { useStore, uid } from '../system/store.js';
import { useImage, useThumb } from '../system/db/useImage.js';
import * as engine from '../system/ai/engine.js';
import * as queue from '../system/ai/queue.js';
import * as memoryCtx from '../system/ai/context/memory.js';
import * as bondApi from '../system/bond.js';
import * as embedApi from '../system/ai/embed.js';
import * as memvecApi from '../system/ai/memvec.js';
import * as loreCtx from '../system/ai/context/lorebook.js';
import * as traceApi from '../system/ai/trace.js';
import { extract, shouldAutoExtract, pendingOf } from '../system/ai/tasks/memory-extract.js';
import * as memImport from '../system/ai/tasks/memory-import.js';
import * as charAltApi from '../system/ai/tasks/char-alt.js';
import * as cardApi from '../system/ai/tasks/card.js';
import * as momentTasks from '../system/ai/tasks/moments.js';
import { DEFAULT_TEMPLATES } from '../system/ai/templates.js';
import * as svc from '../system/ai/services.js';
import { fetchModels, filterModels } from '../system/ai/models.js';
import { estimate as estimateTokens } from '../system/ai/tokens.js';
import * as voice from '../system/ai/voice.js';
import * as image from '../system/ai/image.js';
import * as visionApi from '../system/ai/vision.js';
import * as asrApi from '../system/ai/asr.js';
import * as translateApi from '../system/ai/translate.js';
import * as costApi from '../system/ai/cost.js';
import * as ledgerApi from '../system/ledger.js';
import * as requestApi from '../system/request.js';
import * as audioApi from '../system/audio.js';
import * as searchApi from '../system/search.js';
import * as transferApi from '../system/transfer.js';
import * as currencyApi from '../system/currency.js';
import * as placeApi from '../system/place.js';
import * as giftApi from '../system/gift.js';
import * as spaceApi from '../system/space.js';
import * as eventsApi from '../system/events.js';
import * as dayApi from '../system/day.js';
import * as extrasApi from '../system/extras.js';
import * as avatarApi from '../system/avatar.js';
import * as takeoutApi from '../system/takeout.js';
import * as geoApi from '../system/geo.js';
import * as panelApi from '../system/panel.js';
import * as paceApi from '../system/pace.js';
import * as autoReplyApi from '../system/autoreply.js';
import * as innerTask from '../system/ai/tasks/inner.js';
import * as foodApi from '../system/food.js';
import * as dayTask from '../system/ai/tasks/day.js';
import * as recipeBatch from '../system/ai/tasks/recipe-batch.js';
import * as drawApi from '../system/draw.js';
import * as eventBatch from '../system/ai/tasks/event-batch.js';
import * as musicApi from '../system/music.js';
import * as listenApi from '../system/listen.js';
import * as neteaseApi from '../system/netease.js';
import * as purgeApi from '../system/purge.js';
import * as playerApi from '../system/player.js';
import * as videoApi from '../system/video.js';
import * as watchApi from '../system/watch.js';
import * as subtitleApi from '../system/subtitle.js';
import * as ffmpegApi from '../system/ffmpeg.js';
import * as backupApi from '../system/backup.js';
import * as watchOutline from '../system/ai/tasks/watch-outline.js';
import * as callApi from '../system/call.js';
import * as cameraApi from '../system/camera.js';
import * as keepAliveApi from '../system/keepalive.js';
import { forceUpdate } from '../system/refresh.js';
import * as stickerApi from '../system/stickers.js';
import * as replyApi from '../system/ai/reply.js';
import * as repairApi from '../system/ai/repair.js';
import * as proactiveApi from '../system/ai/proactive.js';
import { files, download } from '../system/db/files.js';
import { useFile } from '../system/db/useFile.js';
import { BLOCKS, DEFAULT_ORDER, resolveOrder } from '../system/ai/context/index.js';
import { toast, confirm, prompt } from '../ui/overlay.js';
import { appLook, listAppLooks } from '../system/look.js';
import { registryStore } from '../system/registry.js';
import { removedApps, restoreApp } from '../screens/home/layout.js';

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
    // 被用户从主界面移除的那些。设置里要能看见、能放回来，
    // 所以从 sdk 过一道：app 不直接碰 screens/
    removed: removedApps,
    restore: restoreApp,
  },

  ai: {
    isConfigured: engine.isConfigured,
    config: engine.config,
    buildChatSystem: engine.buildChatSystem,
    buildHistory: engine.buildHistory,
    streamReply: engine.streamReply,
    watchOutline,
    isReplying: engine.isReplying,
    cancelReply: engine.cancelReply,
    runJSONTask: engine.runJSONTask,
    runTextTask: engine.runTextTask,
    template: engine.template,
    estimateTokens,
    templates: DEFAULT_TEMPLATES,
    blocks: BLOCKS,
    defaultOrder: DEFAULT_ORDER,
    resolveOrder,
    memory: { ...memoryCtx, extract, shouldAutoExtract, pendingOf, import: memImport },
    bond: bondApi,
    embed: embedApi,
    memvec: memvecApi,
    lore: loreCtx,
    trace: traceApi,
    moments: momentTasks,
    services: svc,
    fetchModels,
    filterModels,
    voice,
    image,
    vision: visionApi,
    asr: asrApi,
    translate: translateApi,
    cost: costApi,
    reply: replyApi,
    repair: repairApi,
    proactive: proactiveApi,
    charAlt: charAltApi,
    card: cardApi,
    eventBatch,
    dayTask,
    inner: innerTask,
    recipeBatch,
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

  accounts: accountsApi,
  sound: soundApi,
  push: pushApi,
  looks: looksApi,
  fonts: fontsApi,
  clock: clockApi,
  audio: audioApi,
  search: searchApi,
  transfer: transferApi,
  currency: currencyApi,
  ledger: ledgerApi,
  request: requestApi,
  place: placeApi,
  gift: giftApi,
  space: spaceApi,
  events: eventsApi,
  day: dayApi,
  extras: extrasApi,
  avatarLink: avatarApi,
  takeout: takeoutApi,
  geo: geoApi,
  panel: panelApi,
  pace: paceApi,
  autoReply: autoReplyApi,
  food: foodApi,
  draw: drawApi,
  music: musicApi,
  listen: listenApi,
  netease: neteaseApi,
  purge: purgeApi,
  player: playerApi,
  video: videoApi,
  watch: watchApi,
  subtitle: subtitleApi,
  ffmpeg: ffmpegApi,
  backup: backupApi,
  call: callApi,
  camera: cameraApi,
  keepAlive: keepAliveApi,

  // 把缓存里的旧代码换掉再重开，见 system/refresh.js
  refresh: forceUpdate,

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

export { useStore, useImage, useThumb, useFile, phone as default };

// app 唯一能接触到的系统入口。app 不允许 import system/ 下的任何东西。
import * as navApi from '../system/nav.js';
import * as intents from '../system/intents.js';
import * as notifyApi from '../system/notify.js';
import * as accountsApi from '../system/accounts.js';
import * as soundApi from '../system/sound.js';
import * as pushApi from '../system/push.js';
import * as looksApi from '../system/looks.js';
import * as fullApi from '../system/fullscreen.js';
import * as chatLookApi from '../system/chatlook.js';
import * as remarkApi from '../system/remark.js';
import { isTest } from '../system/channel.js';
import * as fontsApi from '../system/fonts.js';
import * as clockApi from '../system/time.js';
import * as bus from '../system/bus.js';
import { db } from '../system/db/index.js';
import { images } from '../system/db/images.js';
import { useStore, uid } from '../system/store.js';
import { useImage, useThumb } from '../system/db/useImage.js';
import * as engine from '../system/ai/engine.js';
import * as capsApi from '../system/ai/capabilities.js';
import * as queue from '../system/ai/queue.js';
import * as memoryCtx from '../system/ai/context/memory.js';
import * as bondApi from '../system/bond.js';
import * as embedApi from '../system/ai/embed.js';
import * as memvecApi from '../system/ai/memvec.js';
import * as rerankApi from '../system/ai/rerank.js';
import * as loreCtx from '../system/ai/context/lorebook.js';
import * as traceApi from '../system/ai/trace.js';
import * as usageApi from '../system/ai/usage.js';
import { extract, shouldAutoExtract, pendingOf, runsFor, markCaughtUp, batchSize } from '../system/ai/tasks/memory-extract.js';
import * as memImport from '../system/ai/tasks/memory-import.js';
import * as charAltApi from '../system/ai/tasks/char-alt.js';
import * as snapApi from '../system/ai/tasks/snap.js';
import * as cardApi from '../system/ai/tasks/card.js';
import * as momentTasks from '../system/ai/tasks/moments.js';
import { DEFAULT_TEMPLATES } from '../system/ai/templates.js';
import * as svc from '../system/ai/services.js';
import { fetchModels, filterModels } from '../system/ai/models.js';
import { estimate as estimateTokens } from '../system/ai/tokens.js';
import * as voice from '../system/ai/voice.js';
import * as image from '../system/ai/image.js';
import * as aiVideo from '../system/ai/video.js';
import * as imagePrompt from '../system/ai/imageprompt.js';
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
import * as healthTask from '../system/ai/tasks/health.js';
import * as recipeBatch from '../system/ai/tasks/recipe-batch.js';
import * as shelfBatch from '../system/ai/tasks/shelf-batch.js';
import * as impression from '../system/ai/tasks/shelf-impression.js';
import * as readAheadTask from '../system/ai/tasks/readahead.js';
import * as paraComment from '../system/ai/tasks/para-comment.js';
import * as drawApi from '../system/draw.js';
import * as eventBatch from '../system/ai/tasks/event-batch.js';
import * as musicApi from '../system/music.js';
import * as mcpApi from '../system/mcptools.js';
import * as weatherApi from '../system/weather.js';
import * as listenApi from '../system/listen.js';
import * as neteaseApi from '../system/netease.js';
import * as purgeApi from '../system/purge.js';
import * as authApi from '../system/auth.js';
import * as groupApi from '../system/group.js';
import * as badgesApi from '../system/badges.js';
import * as safekeepApi from '../system/safekeep.js';
import * as onThisDayApi from '../system/onthisday.js';
import * as ghbackupApi from '../system/ghbackup.js';
import * as yearNote from '../system/ai/tasks/year-note.js';
import * as aiGroup from '../system/ai/group.js';
import * as charpackApi from '../system/charpack.js';
import * as bookApi from '../system/book.js';
import * as readApi from '../system/read.js';
import * as shelfApi from '../system/shelf.js';
import * as readerApi from '../system/reader.js';
import * as excerptApi from '../system/excerpt.js';
import * as aheadApi from '../system/readahead.js';
import * as paraApi from '../system/paracomment.js';
import * as healthApi from '../system/health.js';
import * as healthkitApi from '../system/healthkit.js';
import * as albumApi from '../system/album.js';
import * as theirsApi from '../system/theirs.js';
import * as tripApi from '../system/trip.js';
import * as memcheckApi from '../system/memcheck.js';
import * as banApi from '../system/ban.js';
import * as todoApi from '../system/todo.js';
import * as sceneApi from '../system/scene.js';
import * as workApi from '../system/work.js';
import * as stageApi from '../system/stage.js';
import * as skinApi from '../system/skin.js';
import * as receiptApi from '../system/receipt.js';
import * as toneApi from '../system/tone.js';
import * as alarmApi from '../system/alarm.js';
import * as whenApi from '../system/when.js';
import * as noteApi from '../system/note.js';
import * as grabApi from '../system/grab.js';
import * as phoneTask from '../system/ai/tasks/phone.js';
import * as tripTask from '../system/ai/tasks/trip.js';
import * as sceneTask from '../system/ai/tasks/scene.js';
import * as workTask from '../system/ai/tasks/work.js';
import * as cardshotApi from '../system/cardshot.js';
import * as reviewApi from '../system/review.js';
import * as booksearchApi from '../system/booksearch.js';
import * as playerApi from '../system/player.js';
import * as clipApi from '../system/clip.js';
import * as watchApi from '../system/watch.js';
import * as subtitleApi from '../system/subtitle.js';
import * as ffmpegApi from '../system/ffmpeg.js';
import * as backupApi from '../system/backup.js';
import * as watchOutline from '../system/ai/tasks/watch-outline.js';
import * as callApi from '../system/call.js';
import * as cameraApi from '../system/camera.js';
import * as videoApi from '../system/video.js';
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
import { appLook, listAppLooks, iconOverride, setAppIcon, resetAppIcon,
         setAppIconFile, setAppIconUrl, clearAppIconImage } from '../system/look.js';
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
    // 图标与名称。ui/IconPicker 要的就是这几个动作
    icon: {
      override: iconOverride,
      set: setAppIcon,
      reset: resetAppIcon,
      file: setAppIconFile,
      url: setAppIconUrl,
      clearImage: clearAppIconImage,
    },
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
    streamScene: engine.streamScene,
    isWriting: engine.isWriting,
    cancelScene: engine.cancelScene,
    streamWork: engine.streamWork,
    isWritingWork: engine.isWritingWork,
    cancelWork: engine.cancelWork,
    runJSONTask: engine.runJSONTask,
    runTextTask: engine.runTextTask,
    template: engine.template,
    estimateTokens,
    templates: DEFAULT_TEMPLATES,
    blocks: BLOCKS,
    defaultOrder: DEFAULT_ORDER,
    resolveOrder,
    memory: { ...memoryCtx, extract, shouldAutoExtract, pendingOf, runsFor, markCaughtUp, batchSize,
      import: memImport },
    bond: bondApi,
    embed: embedApi,
    memvec: memvecApi,
    rerank: rerankApi,
    lore: loreCtx,
    trace: traceApi,
    usage: usageApi,
    moments: momentTasks,
    services: svc,
    fetchModels,
    filterModels,
    voice,
    image,
    video: aiVideo,
    imagePrompt,
    vision: visionApi,
    asr: asrApi,
    translate: translateApi,
    caps: capsApi,
    cost: costApi,
    reply: replyApi,
    group: aiGroup,
    yearNote,
    repair: repairApi,
    proactive: proactiveApi,
    charAlt: charAltApi,
    snap: snapApi,
    card: cardApi,
    phone: phoneTask,
    trip: tripTask,
    scene: sceneTask,
    work: workTask,
    eventBatch,
    dayTask,
    healthTask,
    inner: innerTask,
    recipeBatch,
    shelfBatch,
    impression,
    readAhead: readAheadTask,
    paraComment,
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
  mcp: mcpApi,
  weather: weatherApi,
  listen: listenApi,
  netease: neteaseApi,
  purge: purgeApi,
  // 登录账号（本站开了账号功能时）。设置里的「登录账号」与管理页用
  auth: authApi,
  group: groupApi,
  badges: badgesApi,
  safekeep: safekeepApi,
  onThisDay: onThisDayApi,
  ghbackup: ghbackupApi,
  charpack: charpackApi,
  book: bookApi,
  read: readApi,
  shelf: shelfApi,
  reader: readerApi,
  excerpt: excerptApi,
  ahead: aheadApi,
  para: paraApi,
  health: healthApi,
  healthkit: healthkitApi,
  album: albumApi,
  theirs: theirsApi,
  trip: tripApi,
  memcheck: memcheckApi,
  ban: banApi,
  todo: todoApi,
  scene: sceneApi,
  work: workApi,
  stage: stageApi,
  skin: skinApi,
  receipt: receiptApi,
  tone: toneApi,
  alarm: alarmApi,
  when: whenApi,
  note: noteApi,
  grab: grabApi,
  cardshot: cardshotApi,
  review: reviewApi,
  booksearch: booksearchApi,
  player: playerApi,
  clip: clipApi,
  watch: watchApi,
  subtitle: subtitleApi,
  ffmpeg: ffmpegApi,
  backup: backupApi,
  call: callApi,
  camera: cameraApi,
  video: videoApi,
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

  // 这一份是不是测试版（见 system/channel.js）
  isTest,

  // 备注：我给角色的、角色给我的（见 system/remark.js）
  remark: remarkApi,

  // 聊天背景与上下栏样式（存在会话记录上）
  chatLook: chatLookApi,

  // 浏览器标签页里的全屏。外观页上那个开关要知道这台设备有没有这回事
  fullscreen: { supported: fullApi.supported, enter: fullApi.enter, store: fullApi.fullStore },

  uid,
};

export { useStore, useImage, useThumb, useFile, phone as default };

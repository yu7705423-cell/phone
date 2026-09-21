import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, Switch, toast } from '../../ui/index.js';
import { ApiPage } from './ApiPage.js';
import { FilesPage } from './FilesPage.js';
import { VoicePage } from './VoicePage.js';
import { ImagePage } from './ImagePage.js';
import { AppearancePage } from './AppearancePage.js';
import { StoragePage } from './StoragePage.js';
import { TracePage } from './TracePage.js';
import { NotifyPage } from './NotifyPage.js';
import { EmbedPage } from './EmbedPage.js';
import { RerankPage } from './RerankPage.js';
import { VisionPage } from './VisionPage.js';
import { AsrPage } from './AsrPage.js';
import { MusicPage } from './MusicPage.js';
import { LimitsPage } from './LimitsPage.js';
import { BanPage } from './BanPage.js';
import { SearchApiPage } from './SearchApiPage.js';
import { TranslateApiPage } from './TranslateApiPage.js';
import { MemoryApiPage } from './MemoryApiPage.js';
import { BUILD } from '../../version.js';

const { db, nav } = phone;

function Home() {
  const s = useStore(db.settings.store);
  // 保活现在到底在不在跑。开关打开之后屏幕上得有个地方看得出来
  const ka = useStore(phone.keepAlive.state);
  const svc = phone.ai.services;
  const banN = phone.ban.list().length;
  // 装在手机上的那个外壳是哪一版。网页那份构建号是从站点现取的，说明不了
  // 手机上装的是哪个 ipa —— 而闹钟、通知这几样只有重装才会变
  const shell = typeof window !== 'undefined' ? (window.phoneAppVersion || '') : '';
  const ai = phone.ai;
  const chat = svc.services().chat;
  const active = svc.activeChat();
  const spare = svc.fallbackChat();
  const chatDesc = active
    ? `${active.name} · ${active.model || '未选模型'}${spare ? `，副用 ${spare.name}` : ''}`
    : '未配置，聊天不可用';
  const voice = svc.voiceConfig();
  const voiceDesc = voice.enabled && voice.apiKey ? `已配置 · ${voice.model || '未选择模型'}` : '未配置';
  const vision = svc.visionConfig();
  const visionMode = svc.visionMode();
  const visionDesc = visionMode === 'chat'
    ? '交给聊天模型 · 只传当轮的图，看过即存为描述'
    : visionMode === 'api'
      ? (svc.visionReady() ? `单独的接口 · ${vision.model}` : '选了单独的接口，但还没填全')
      : '关闭。角色看不到你发的图片，只知道你发了一张图';
  const asr = svc.asrConfig();
  const asrDesc = svc.asrReady()
    ? `${asr.model} · ${asr.mode === 'tone' ? '同时识别语气' : '仅转写文字'}`
    : ai.asr.canSendVoice()
      ? '未配置，当前使用浏览器自带的识别。只有文字，没有语气'
      : '未配置，且这个浏览器不支持本机识别，暂时发不了语音';
  const imgActive = svc.activeImage();
  const imageDesc = imgActive ? `${imgActive.name} · ${imgActive.model || '未选择模型'}` : '未配置';

  const ne = svc.neteaseConfig();
  const musicDesc = !ne.baseUrl
    ? '未配置。配置后可在一起听中搜索并播放网易云曲库'
    : svc.neteaseLoggedIn() ? `已登录 ${ne.nickname}${ne.sync ? ' · 同步歌单' : ''}` : '已填写地址，尚未登录';

  const emb = svc.embedConfig();
  const rrk = svc.rerankConfig();
  const embDone = phone.ai.memvec.indexedCount();
  const embDesc = emb.apiKey && emb.model
    ? `${emb.model} · 已索引 ${embDone} / ${db.memories.count()} 条记忆`
    : '未配置。配置后记忆按语义检索，不再依赖关键词匹配';

  const rerankDesc = !svc.rerankReady()
    ? '未配置。配置后可在语义召回之后再按相关度重排一遍'
    : db.settings.get().rerankOn === true
      ? `${rrk.model} · 已开启，每轮额外调用一次`
      : `${rrk.model} · 已配置但未开启`;

  const tr = svc.translateConfig();
  const trDesc = svc.translateMode() === 'api'
    ? `单独的接口 · ${tr.model}`
    : tr.mode === 'api'
      ? '选了单独的接口，但还没填全'
      : '跟着回复一起给出。译文由聊天模型在生成回复时一并写出';

  const sc = svc.searchConfig();
  const searchDesc = svc.searchReady()
    ? `${sc.model} · 可按地区搜索真实的吃处`
    : '未配置。配置后可在「日常 - 吃什么」中搜索真实存在的店';

  const nc = phone.sound.config();
  const soundName = nc.soundFileId ? '自定义音频'
    : (phone.sound.PRESETS.find(p => p.id === nc.sound) || {}).label || '清脆';
  const notifyDesc = `${nc.banner ? '横幅开着' : '横幅关着'} · 提示音 ${soundName}`;

  const update = async () => {
    toast('正在获取最新代码', 'plain');
    const r = await phone.refresh();
    toast(r.fail ? `${r.total} 个文件中有 ${r.fail} 个获取失败，仍将尝试重新加载` : `${r.ok} 个文件已更新，正在重新加载`,
      r.fail ? 'plain' : 'ok');
    setTimeout(() => location.reload(), 900);
  };

  return html`
    <${Page} title="设置">
      <${List} title="服务">
        <${ListItem} title="接口" subtitle=${chatDesc} arrow multiline
          left=${html`<${Icon} name="key" size=${19}/>`}
          onClick=${() => nav.push('/api')}/>
        <${ListItem} title="语音合成" subtitle=${voiceDesc} arrow
          left=${html`<${Icon} name="headphone" size=${19}/>`}
          onClick=${() => nav.push('/voice')}/>
        <${ListItem} title="生图" subtitle=${imageDesc} arrow
          left=${html`<${Icon} name="camera" size=${19}/>`}
          onClick=${() => nav.push('/image')}/>
        <${ListItem} title="音乐服务" subtitle=${musicDesc} arrow multiline
          left=${html`<${Icon} name="music" size=${19}/>`}
          onClick=${() => nav.push('/music')}/>
        <${ListItem} title="向量" subtitle=${embDesc} arrow multiline
          left=${html`<${Icon} name="brain" size=${19}/>`}
          onClick=${() => nav.push('/embed')}/>
        <${ListItem} title="重排" subtitle=${rerankDesc} arrow multiline
          left=${html`<${Icon} name="filter" size=${19}/>`}
          onClick=${() => nav.push('/rerank')}/>
        <${ListItem} title="联网搜索" subtitle=${searchDesc} arrow multiline
          left=${html`<${Icon} name="compass" size=${19}/>`}
          onClick=${() => nav.push('/search')}/>
      <//>

      <${List} title="识别你发送的内容">
        <${ListItem} title="识图" subtitle=${visionDesc} arrow multiline
          left=${html`<${Icon} name="eye" size=${19}/>`}
          onClick=${() => nav.push('/vision')}/>
        <${ListItem} title="语音识别" subtitle=${asrDesc} arrow multiline
          left=${html`<${Icon} name="signal" size=${19}/>`}
          onClick=${() => nav.push('/asr')}/>
      <//>

      <${List} title="翻译">
        <${ListItem} title="翻译" subtitle=${trDesc} arrow multiline
          left=${html`<${Icon} name="translate" size=${19}/>`}
          onClick=${() => nav.push('/translate')}/>
      <//>

      <${List} title="外观">
        <${ListItem} title="通知" subtitle=${notifyDesc} arrow multiline
          left=${html`<${Icon} name="bell" size=${18}/>`}
          onClick=${() => nav.push('/notify')}/>
        <${ListItem} title="主题"
          subtitle="深色模式、壁纸、图标颜色与阴影、自定义 CSS" arrow multiline
          left=${html`<${Icon} name="grid" size=${18}/>`}
          onClick=${() => nav.push('/appearance')}/>
        <${ListItem} title="线下外观" arrow multiline
          subtitle="线下正文的主题、字体、字号、栏宽、壁纸与自定义样式。与全局主题、阅读器各自独立"
          left=${html`<${Icon} name="book" size=${18}/>`}
          onClick=${() => phone.intent.open('chat', { route: '/stage/settings', back: true })}/>
      <//>

      <${List} title="文字">
        <${ListItem} title="不要写这些" arrow multiline
          left=${html`<${Icon} name="filter" size=${18}/>`}
          subtitle=${banN
            ? `已列出 ${banN} 条，对所有角色生效。`
              + (Number(s.banReroll) > 0
                ? `命中时最多重新生成 ${Math.max(0, Math.round(Number(s.banReroll) || 0))} 次`
                : '命中时在该条消息下方标注')
            : '列出不希望角色使用的词句。列出后写入每一轮的提示词，并在回复落地时本地比对'}
          onClick=${() => nav.push('/ban')}/>
      <//>

      <${List} title="用量">
        <${ListItem} title="用量与上限" arrow multiline
          left=${html`<${Icon} name="filter" size=${18}/>`}
          subtitle=${`通话回复长度、视频通话画面间隔、表情名单长度、主动消息的未读阈值、`
            + `会话渲染条数、搜索结果条数、一起听的上报门槛。均可填 0 表示不限。`}
          onClick=${() => nav.push('/limits')}/>
      <//>

      <${List} title="后台">
        <${ListItem} title="保活" multiline
          left=${html`<${Icon} name="power" size=${18}/>`}
          subtitle=${(phone.keepAlive.native()
            ? `由外壳持续播放一段极轻的音频，让系统把本应用当成正在播放，`
              + `切到后台后不那么快被冻结，主动消息更有机会按时发出。`
              + `开启期间独占音频，会中断其他应用正在播放的内容。`
            : `循环播放一段无声音频，让系统把本页当成正在播放的标签页，`
              + `切到后台后不那么快被冻结，主动消息更有机会按时发出。`)
            + `会持续占用少量电量，且在锁屏后通常仍会停止。`
            + (ka.note ? `　当前：${ka.note}` : '')
            + (phone.keepAlive.awayText() ? `　${phone.keepAlive.awayText()}` : '')}
          right=${html`<${Switch} checked=${!!s.keepAlive}
            onChange=${v => db.settings.set({ keepAlive: v })}/>`}/>
        ${phone.keepAlive.native() ? html`
          <${ListItem} title="不打断其他应用的声音" multiline
            subtitle=${'开启后保活音频与其他应用混合，你正在听的东西不会被中断。'
              + '代价是系统可能不再把本应用当成正在播放，后台仍会被暂停。'
              + '开启后切到后台三分钟以上再回来，上面那一行会告诉你还管不管用。'}
            right=${html`<${Switch} checked=${!!s.keepAliveMix}
              onChange=${v => db.settings.set({ keepAliveMix: v })}
              disabled=${!s.keepAlive}/>`}/>` : null}
      <//>

      <${List} title="数据">
        <${ListItem} title="存储与备份" subtitle="占用统计、导入导出、清空数据" arrow
          left=${html`<${Icon} name="database" size=${18}/>`}
          onClick=${() => nav.push('/storage')}/>
        <${ListItem} title="强制更新" multiline arrow
          subtitle=${`网页版本 ${BUILD}`
            + (shell ? `，外壳版本 ${shell}` : '')
            + '。若界面仍为旧版，点击此处清除缓存的旧代码并重新加载。'
            + (shell ? '外壳版本只能通过重新安装更新。' : '')}
          left=${html`<${Icon} name="refresh" size=${18}/>`} onClick=${update}/>
      <//>

      <div class="settings-foot">
        我的人设在「聊天」里的「主页」中编辑<br/>
        上下文、记忆与 Prompt 模板在会话右上角的菜单里<br/>
        小手机 · 本地运行，数据只存在这台设备上<br/>
        构建 ${BUILD}${shell ? ` · 外壳 ${shell}` : ''}
      </div>
    <//>`;
}

export default function SettingsApp({ route }) {
  if (route === '/api') return html`<${ApiPage}/>`;
  if (route === '/notify') return html`<${NotifyPage}/>`;
  if (route === '/embed') return html`<${EmbedPage}/>`;
  if (route === '/rerank') return html`<${RerankPage}/>`;
  if (route === '/vision') return html`<${VisionPage}/>`;
  if (route === '/asr') return html`<${AsrPage}/>`;
  if (route === '/music') return html`<${MusicPage}/>`;
  if (route === '/limits') return html`<${LimitsPage}/>`;
  if (route === '/ban') return html`<${BanPage}/>`;
  if (route === '/search') return html`<${SearchApiPage}/>`;
  if (route === '/translate') return html`<${TranslateApiPage}/>`;
  if (route === '/memoryapi') return html`<${MemoryApiPage}/>`;
  if (route === '/voice') return html`<${VoicePage}/>`;
  if (route === '/image') return html`<${ImagePage}/>`;
  if (route === "/appearance") return html`<${AppearancePage}/>`;
  if (route === '/storage') return html`<${StoragePage}/>`;
  if (route === '/storage/files') return html`<${FilesPage}/>`;
  if (route === '/trace') return html`<${TracePage}/>`;
  return html`<${Home}/>`;
}

import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Icon, Switch, toast } from '../../ui/index.js';
import { ApiPage } from './ApiPage.js';
import { FilesPage } from './FilesPage.js';
import { VoicePage } from './VoicePage.js';
import { ImagePage } from './ImagePage.js';
import { VideoPage } from './VideoPage.js';
import { AppearancePage } from './AppearancePage.js';
import { StoragePage } from './StoragePage.js';
import { GitHubPage } from './GitHubPage.js';
import { BackgroundPage } from './BackgroundPage.js';
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
import { McpPage, McpServerPage } from './McpPage.js';
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
  // 列表里只写状态，不写说明 —— 说明在点进去的那一页。
  // 没配的在右边写「未配置」；配好了在标题下写一行它用的是什么
  const OFF = '未配置';
  const active = svc.activeChat();
  const spare = svc.fallbackChat();
  const chatDesc = active ? `${active.name} · ${active.model || '未选模型'}${spare ? `，副用 ${spare.name}` : ''}` : '';
  const voice = svc.voiceConfig();
  const voiceDesc = voice.enabled && voice.apiKey ? (voice.model || '未选择模型') : '';
  const vision = svc.visionConfig();
  const visionMode = svc.visionMode();
  const visionVal = visionMode === 'chat' ? '交给聊天模型'
    : visionMode === 'api' ? (svc.visionReady() ? '单独接口' : '未填全') : '关闭';
  const visionDesc = visionMode === 'api' && svc.visionReady() ? vision.model : '';
  const asr = svc.asrConfig();
  const asrVal = svc.asrReady() ? '' : ai.asr.canSendVoice() ? '浏览器自带' : '不可用';
  const asrDesc = svc.asrReady() ? `${asr.model} · ${asr.mode === 'tone' ? '同时识别语气' : '仅转写文字'}` : '';
  const imgActive = svc.activeImage();
  const imageDesc = imgActive ? `${imgActive.name} · ${imgActive.model || '未选择模型'}` : '';
  const vidActive = ai.video.isVideoReady() ? svc.activeVideo() : null;
  const videoDesc = vidActive ? `${vidActive.name} · ${vidActive.model}` : '';
  const videoVal = vidActive ? '' : svc.videoPresets().length ? '未填全' : OFF;

  const ne = svc.neteaseConfig();
  const musicVal = !ne.baseUrl ? OFF : svc.neteaseLoggedIn() ? '' : '未登录';
  const musicDesc = ne.baseUrl && svc.neteaseLoggedIn() ? `${ne.nickname}${ne.sync ? ' · 同步歌单' : ''}` : '';

  const emb = svc.embedConfig();
  const rrk = svc.rerankConfig();
  const embOk = !!(emb.apiKey && emb.model);
  const embDesc = embOk ? `${emb.model} · 已索引 ${phone.ai.memvec.indexedCount()} / ${db.memories.count()}` : '';
  const rerankVal = !svc.rerankReady() ? OFF : db.settings.get().rerankOn === true ? '已开启' : '未开启';
  const rerankDesc = svc.rerankReady() ? rrk.model : '';

  const tr = svc.translateConfig();
  const trVal = svc.translateMode() === 'api' ? '单独接口' : tr.mode === 'api' ? '未填全' : '随回复写出';
  const trDesc = svc.translateMode() === 'api' ? tr.model : '';

  const mcpList = svc.mcpServers().filter(x => x.url);
  const mcpDesc = mcpList.length ? `${mcpList.length} 台服务器` : '';

  const sc = svc.searchConfig();
  const searchDesc = svc.searchReady() ? sc.model : '';

  const nc = phone.sound.config();
  const soundName = nc.soundFileId ? '自定义音频'
    : (phone.sound.PRESETS.find(p => p.id === nc.sound) || {}).label || '清脆';
  const notifyDesc = `${nc.banner ? '横幅开着' : '横幅关着'} · 提示音 ${soundName}`;

  // 一行服务。状态写在右边，配好了才有副标题
  const svcRow = ({ title, icon, route, desc = '', value = '' }) => html`
    <${ListItem} title=${title} subtitle=${desc} arrow
      right=${value || null}
      left=${html`<${Icon} name=${icon} size=${19}/>`}
      onClick=${() => nav.push(route)}/>`;

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
        ${svcRow({ title: '接口', icon: 'key', route: '/api', desc: chatDesc, value: active ? '' : OFF })}
        ${svcRow({ title: '语音合成', icon: 'headphone', route: '/voice', desc: voiceDesc, value: voiceDesc ? '' : OFF })}
        ${svcRow({ title: '生图', icon: 'camera', route: '/image', desc: imageDesc, value: imageDesc ? '' : OFF })}
        ${svcRow({ title: '生成视频', icon: 'film', route: '/video', desc: videoDesc, value: videoVal })}
        ${svcRow({ title: '音乐服务', icon: 'music', route: '/music', desc: musicDesc, value: musicVal })}
        ${svcRow({ title: '向量', icon: 'brain', route: '/embed', desc: embDesc, value: embOk ? '' : OFF })}
        ${svcRow({ title: '重排', icon: 'filter', route: '/rerank', desc: rerankDesc, value: rerankVal })}
        ${svcRow({ title: '联网搜索', icon: 'compass', route: '/search', desc: searchDesc, value: searchDesc ? '' : OFF })}
        ${svcRow({ title: 'MCP 工具', icon: 'grid', route: '/mcp', desc: mcpDesc, value: mcpDesc ? '' : OFF })}
      <//>

      <${List} title="识别你发送的内容">
        ${svcRow({ title: '识图', icon: 'eye', route: '/vision', desc: visionDesc, value: visionVal })}
        ${svcRow({ title: '语音识别', icon: 'signal', route: '/asr', desc: asrDesc, value: asrVal })}
      <//>

      <${List} title="翻译">
        ${svcRow({ title: '翻译', icon: 'translate', route: '/translate', desc: trDesc, value: trVal })}
      <//>

      <${List} title="外观">
        <${ListItem} title="通知" subtitle=${notifyDesc} arrow
          left=${html`<${Icon} name="bell" size=${18}/>`}
          onClick=${() => nav.push('/notify')}/>
        <${ListItem} title="主题"
          subtitle="深色模式、壁纸、图标、自定义 CSS" arrow
          left=${html`<${Icon} name="grid" size=${18}/>`}
          onClick=${() => nav.push('/appearance')}/>
        <${ListItem} title="线下外观" arrow
          subtitle="线下正文的主题、字体与排版"
          left=${html`<${Icon} name="book" size=${18}/>`}
          onClick=${() => phone.intent.open('chat', { route: '/stage/settings', back: true })}/>
      <//>

      <${List} title="文字">
        <${ListItem} title="不要写这些" arrow
          left=${html`<${Icon} name="filter" size=${18}/>`}
          subtitle=${banN ? (Number(s.banReroll) > 0 ? '命中时重新生成' : '命中时在消息下方标注') : ''}
          right=${banN ? `${banN} 条` : '未设置'}
          onClick=${() => nav.push('/ban')}/>
      <//>

      <${List} title="用量">
        <${ListItem} title="用量与上限" arrow
          left=${html`<${Icon} name="filter" size=${18}/>`}
          subtitle="一次处理多少、哪些功能会额外调用接口"
          onClick=${() => nav.push('/limits')}/>
      <//>

      <${List} title="后台">
        <${ListItem} title="后台任务" arrow
          subtitle="定时执行的任务与实际调用次数"
          left=${html`<${Icon} name="pulse" size=${18}/>`}
          onClick=${() => nav.push('/background')}/>
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
        <${ListItem} title="强制更新" arrow
          subtitle="界面仍是旧版时，清除缓存的代码并重新加载"
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
  if (route === '/mcp') return html`<${McpPage}/>`;
  const mcpOne = route?.match(/^\/mcp\/(.+)$/);
  if (mcpOne) return html`<${McpServerPage} id=${mcpOne[1]}/>`;
  if (route === '/translate') return html`<${TranslateApiPage}/>`;
  if (route === '/memoryapi') return html`<${MemoryApiPage}/>`;
  if (route === '/voice') return html`<${VoicePage}/>`;
  if (route === '/image') return html`<${ImagePage}/>`;
  if (route === '/video') return html`<${VideoPage}/>`;
  if (route === "/appearance") return html`<${AppearancePage}/>`;
  if (route === '/storage') return html`<${StoragePage}/>`;
  if (route === '/github') return html`<${GitHubPage}/>`;
  if (route === '/background') return html`<${BackgroundPage}/>`;
  if (route === '/storage/files') return html`<${FilesPage}/>`;
  if (route === '/trace') return html`<${TracePage}/>`;
  return html`<${Home}/>`;
}

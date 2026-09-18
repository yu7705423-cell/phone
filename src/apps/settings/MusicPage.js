import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, NumberInput, Switch, QrLogin, confirm } from '../../ui/index.js';

const { db, nav, netease } = phone;
const svc = phone.ai.services;

export function MusicPage() {
  const s = useStore(db.settings.store);
  const cfg = svc.neteaseConfig();

  const quit = async () => {
    if (!await confirm({ title: '退出登录', message: cfg.nickname || '当前账号', danger: true })) return;
    netease.logout();
  };

  return html`
    <${Page} title="音乐服务" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="接口地址"
          desc=${`需要自行部署 NeteaseCloudMusicApi 并填写其地址，填写至端口为止。`
            + `浏览器里跑不起这个服务，而且多人共用一个出口地址会被限流，所以只能各自部署。`}>
          <${Input} value=${cfg.baseUrl} placeholder="https://music.example.com"
            onInput=${v => svc.setNetease({ baseUrl: v })}/>
        <//>
      </div>

      ${cfg.baseUrl ? html`
        <${List} title="我的账号">
          ${cfg.cookie ? html`
            <${ListItem} title=${cfg.nickname || '已登录'} subtitle=${`UID ${cfg.uid}`}
              right=${html`<button class="nav-text press" onClick=${quit}>退出</button>`}/>`
          : html`<div class="pad"><${QrLogin} service=${netease}
              hint="请使用网易云音乐扫描二维码"/></div>`}
        <//>

        <${List} title="一起听">
          <${ListItem} title="同步到网易云歌单" multiline
            subtitle=${`开启后，一起听结束时会把听过的歌加进双方各自的「和某某一起听」歌单。`
              + `这会改动你真实的网易云歌单，默认关闭。听歌打卡不受此项影响，始终会记录。`}
            right=${html`<${Switch} checked=${cfg.sync === true}
              onChange=${v => svc.setNetease({ sync: v })}/>`}/>
        <//>

        <${List} title="她在听什么">
          <${ListItem} title="读取角色账号的播放记录" multiline
            subtitle=${`在电脑上用角色的账号登录网易云客户端播放音乐后，`
              + `这些播放记录会被读取并写入 prompt，角色被问起时给出的是真实答案。`
              + `该功能只请求你自己部署的音乐接口，不调用模型接口。`}/>
        <//>
        <div class="pad-x pad-b">
          <${Field} label="随消息拉取的最小间隔"
            desc="发送消息时顺带拉取一次播放记录，距上次拉取不足该时长则跳过。
              填 0 表示不自动拉取，仅在会话中手动点击时拉取。">
            <${NumberInput} value=${cfg.recentGap ?? 5} unit="分钟" placeholder="只手动拉取"
              onChange=${v => svc.setNetease({ recentGap: v })}/>
          <//>
          <${Field} label="播放记录的有效时长"
            desc="超过该时长的播放记录不再写入 prompt。
              三天前的那首歌写成「正在听」比不写更糟，用户一问就会穿帮。
              填 0 表示不限时效。">
            <${NumberInput} value=${s.musicFresh ?? 120} unit="分钟" placeholder="不限"
              onChange=${v => db.settings.set({ musicFresh: v })}/>
          <//>
        </div>

        <div class="settings-foot">
          角色的账号在各自的角色卡中登录。一起听时，两个账号都会记录这次听歌。
        </div>` : null}

      <div class="settings-foot">
        登录凭据仅保存在本设备的浏览器中。它等同于账号权限，
        请勿在他人可以打开此页面的设备上登录。
      </div>
    <//>`;
}

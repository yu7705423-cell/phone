import { html } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Switch, QrLogin, confirm } from '../../ui/index.js';

const { db, nav, netease } = phone;
const svc = phone.ai.services;

export function MusicPage() {
  useStore(db.settings.store);
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

        <div class="settings-foot">
          角色的账号在各自的角色卡中登录。一起听时，两个账号都会记录这次听歌。<br/>
          网易云自身的「一起听」是需要双方在线的实时房间，角色一侧没有客户端，
          因此不做房间，改为让两个账号的听歌数据都真实产生记录。
        </div>` : null}

      <div class="settings-foot">
        登录凭据仅保存在本设备的浏览器中。它等同于账号权限，
        请勿在他人可以打开此页面的设备上登录。
      </div>
    <//>`;
}

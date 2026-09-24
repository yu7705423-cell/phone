import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, NumberInput, Switch, Icon, Spinner,
  QrLogin, CookiePaste, SmsLogin, confirm, toast } from '../../ui/index.js';

const { db, nav, netease } = phone;
const svc = phone.ai.services;

// 探测结果那一段总结。分开写是因为这里的分支比一行三元式装得下的多：
// 同样是「有几项没过」，原因是连不上、是被网易云的风控挡住，还是只剩扫码
// 那两项过不去而 cookie 已经补上了，给用户的下一步完全不同。
const QR_ROWS = ['qrkey', 'qrimg'];

function verdict(rows, cfg) {
  if (!rows[0].pass) {
    return '这个地址在本机用不了：服务不通，或它不允许本页面跨域读取。请更换地址，或自行部署一份。';
  }
  const bad = rows.filter(r => !r.pass);
  if (!bad.length) return '各项均可用。';

  // 只剩扫码过不去，而 cookie 已经填了：扫码本来就不用再走
  if (cfg.cookie && bad.every(r => QR_ROWS.includes(r.id))) {
    return '扫码登录不可用，其余项目均正常。已保存的 cookie 可以继续使用，无需扫码。';
  }
  if (bad.some(r => r.risk)) {
    return cfg.cookie
      ? '地址与跨域均正常，未通过的项目是网易云拒绝了这个实例的出口 IP。'
        + '已保存的 cookie 未能解除该限制，请改用另一个公开实例。'
      : '地址与跨域均正常，未通过的项目是网易云拒绝了这个实例的出口 IP，扫码登录已自动换用游客身份仍未通过。'
        + '可在上方填写一个中国大陆 IP 作为来源地址后重新测试。';
  }
  return '部分项目不可用。未通过的功能会自动退回或显示为不可用，其余功能照常。';
}

export function MusicPage() {
  const s = useStore(db.settings.store);
  const cfg = svc.neteaseConfig();
  const [rows, setRows] = useState(null);
  const [testing, setTesting] = useState(false);

  // 这个地址能不能用，只有在你自己的浏览器里问才算数 —— CORS 按来源判，
  // 同一个实例别人用得了不代表你用得了。所以给一个探测器，不给一张名单。
  const probe = async () => {
    setTesting(true);
    setRows([]);
    try {
      await netease.probe(cfg.baseUrl, (_, all) => setRows([...all]));
    } catch (err) {
      toast(String(err.message || err), 'error', 4000);
      setRows(null);
    } finally { setTesting(false); }
  };

  const quit = async () => {
    if (!await confirm({ title: '退出登录', message: cfg.nickname || '当前账号', danger: true })) return;
    netease.logout();
  };

  return html`
    <${Page} title="音乐服务" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="接口地址"
          desc=${`指向一个 NeteaseCloudMusicApi 服务，填写至端口为止。`
            + `可以自行部署，也可以填写他人公开的实例。后者不需要维护，`
            + `但随时可能停止服务或限流。填写后请先测试。`}>
          <${Input} value=${cfg.baseUrl} placeholder="https://music.example.com"
            onInput=${v => { svc.setNetease({ baseUrl: v }); setRows(null); }}/>
        <//>
        <${Field} label="来源地址 realIP"
          desc=${`随每次请求发送给上面的接口，由接口转交网易云作为请求来源地址。`
            + `网易云对境外地址常返回「请完成验证操作」（code -462），`
            + `此时填写一个中国大陆 IP 可使请求正常返回。留空则不发送此参数。`}>
          <${Input} value=${cfg.realIP} placeholder="116.25.146.177"
            onInput=${v => { svc.setNetease({ realIP: v.trim() }); setRows(null); }}/>
        <//>
      </div>

      ${cfg.baseUrl ? html`
        <${List} title="这个地址能不能用">
          <${ListItem} title=${testing ? '测试中' : '测试这个地址'} multiline
            subtitle=${testing
              ? '首次访问的实例可能处于休眠状态，唤醒需要数十秒，请等待。'
              : '逐项检查连通、跨域、搜歌、扫码登录三步、cookie 传递与播放地址。仅从本机发起请求。'}
            left=${testing ? html`<${Spinner} size=${16}/>` : html`<${Icon} name="compass" size=${18}/>`}
            arrow onClick=${() => !testing && probe()}/>
          ${(rows || []).map(r => html`
            <${ListItem} key=${r.id} title=${r.label} multiline
              subtitle=${`${r.note}。${r.desc}`}
              left=${html`<${Icon} name=${r.pass ? 'check' : 'close'} size=${18}/>`}/>`)}
        <//>
        ${rows && !testing && rows.length ? html`
          <div class="settings-foot">
            ${verdict(rows, cfg)}
            <br/>公共实例由他人运行，其可用性不受本项目控制。
          </div>` : null}` : null}

      ${cfg.baseUrl ? html`
        <${List} title="我的账号">
          ${cfg.cookie ? html`
            <${ListItem} title=${cfg.nickname || '已登录'} subtitle=${`UID ${cfg.uid}`}
              right=${html`<button class="nav-text press" onClick=${quit}>退出</button>`}/>`
          : html`<div class="pad">
              <${QrLogin} service=${netease} hint="请使用网易云音乐扫描二维码"/>
              <div class="acct-sep">扫码不方便时，用短信验证码登录</div>
              <${SmsLogin} service=${netease}/>
              <div class="acct-sep">以上方式都不可用时</div>
              <${CookiePaste} service=${netease}/>
            </div>`}
        <//>
        <div class="settings-foot">
          登录后得到的 cookie 等同于账号权限，会随每次请求发送给上面填写的接口地址。
          填写的是他人运行的公共实例时，该实例可以读取你的歌单与播放记录，
          也可以以你的名义进行操作。<br/>
          搜索、播放、一起听均不需要登录。登录仅用于个人主页、听歌排行与歌单同步。<br/>
          网易云对机房地址的匿名请求常返回「请完成验证操作」（code -462），
          扫码的三个接口也在其中。此时可从已登录网易云的浏览器中取出 MUSIC_U 填入，
          登录后的请求通常不受该限制。已保存的 cookie 会一并用于上方的地址测试。
        </div>

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

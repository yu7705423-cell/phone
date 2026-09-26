// 内置卡片：六个平台的帖子样式（ARCHITECTURE 4.251）。
//
// 用户要求版式、配色、字号、图标全部照原样，账号那里加一个 @Eira（「我不商用不传播，很多用户追求的就是要一模一样的」）。
// 图标全是这里手画的线条 SVG，不放各家的 logo 与官方图标原件。
//
// 这本书不存进数据库：写在代码里，开机不往库里写任何东西（CLAUDE.md 第 20 条），跟着应用更新。
// 挂给角色、全局生效、单张停用这几样记在设置里（htmlcard.js 的 builtinBook）。要改样式就复制一份到自己的世界书。
//
// 每张卡片的类名各带自己的前缀（wb- xhs- ig- x- db- zh-）。卡片本来就各在各的框里，前缀是给复制出去的代码用的。
// 说明与字段说明进 prompt，所以是英文（第 14 条）。

// ---- 图标（24 格，线条，currentColor）----
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;
const I = {
  repost: svg('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/>'),
  comment: svg('<path d="M21 12a8 8 0 01-11.6 7.1L4 20.5l1.4-4.7A8 8 0 1121 12z"/>'),
  thumb: svg('<path d="M7 11v9H4v-9h3z"/><path d="M7 11l4-8a2.5 2.5 0 012.5 2.5V9h5.2a2 2 0 012 2.3l-1.2 7A2 2 0 0117.5 20H7"/>'),
  heart: svg('<path d="M12 20.5s-8-4.7-8-10.6A4.4 4.4 0 0112 7a4.4 4.4 0 018 2.9c0 5.9-8 10.6-8 10.6z"/>'),
  star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  plane: svg('<path d="M22 3L11 13"/><path d="M22 3l-7 18-4-8-8-4z"/>'),
  bookmark: svg('<path d="M6 3h12v18l-6-4.5L6 21z"/>'),
  share: svg('<path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/>'),
  views: svg('<path d="M5 20V12"/><path d="M10 20V5"/><path d="M15 20v-9"/><path d="M20 20V8"/>'),
  dots: svg('<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  pic: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-9 9"/>'),
  up: svg('<path d="M12 5l7 11H5z"/>', ' fill="currentColor"'),
  dn: svg('<path d="M12 19L5 8h14z"/>', ' fill="currentColor"'),
  pin: svg('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  group: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3.5 3.5 0 010 7"/><path d="M18 20a6.5 6.5 0 00-2.5-5.1"/>'),
};
// 认证角标：圆底加一个勾，颜色由各自的样式给
const TICK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// 头像：发帖人是角色本人时用角色头像（author_avatar，应用按「发帖人字段」对上名字后填），否则用昵称的第一个字
const avatarIn = (cls, field) => `{{#author_avatar}}<img src="{{author_avatar}}" alt="">{{/author_avatar}}`
  + `{{^author_avatar}}<span class="${cls}-ini">{{${field}}}</span>{{/author_avatar}}`;
const avatar = (cls, field) => `<div class="${cls}">${avatarIn(cls, field)}</div>`;

// ---- 微博 ----
const WEIBO = `<style>
.wb{min-height:100%;box-sizing:border-box;padding:14px 14px 0;background:#fff;color:#333;font-size:15px;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
.wb-head{display:flex;align-items:center;gap:10px}
.wb-av{position:relative;flex:none;width:40px;height:40px}
.wb-av img,.wb-av-ini{display:block;width:40px;height:40px;border-radius:50%;object-fit:cover}
.wb-av-ini{background:#fdebd3;color:#e8730f;font-size:17px;line-height:40px;white-space:nowrap;overflow:hidden;text-indent:calc(20px - .5em);letter-spacing:40px}
.wb-v{position:absolute;right:-3px;bottom:-3px;width:16px;height:16px;color:#ffa200;background:#fff;border-radius:50%}
.wb-v svg{display:block;width:16px;height:16px}
.wb-who{flex:1;min-width:0}
.wb-name{display:flex;align-items:baseline;gap:6px;font-size:15px;font-weight:600;color:#333;white-space:nowrap;overflow:hidden}
.wb-mark{font-size:11px;font-weight:400;color:#b2b2b2}
.wb-sub{margin-top:3px;font-size:12px;color:#939393;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wb-more{flex:none;width:18px;height:18px;color:#b2b2b2}
.wb-text{margin-top:10px;line-height:1.6;word-break:break-word}
.wb .eira-topic{color:#507daf}
.eira-dark .wb .eira-topic{color:#7fa6d6}
.wb-pics{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-top:10px}
.wb-pics:empty{display:none}
.wb-pics:has(>.wb-pic:nth-child(2):last-child){grid-template-columns:repeat(2,1fr)}
.wb-pics:has(>.wb-pic:nth-child(4):last-child){grid-template-columns:repeat(2,1fr);width:67%}
.wb-pic{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;aspect-ratio:1;box-sizing:border-box;padding:6px;background:#f0f0f0;color:#a3a3a3;font-size:11px;line-height:1.35;text-align:center;overflow:hidden}
.wb-pic svg{flex:none;width:18px;height:18px}
.wb-pic:only-child{grid-column:span 2;aspect-ratio:4/3}
.wb-cmts{margin-top:10px;padding:8px 10px;background:#f7f7f7;border-radius:4px;font-size:13px;line-height:1.65}
.wb-cmts:empty{display:none}
.wb-cmt b{font-weight:400;color:#507daf}
.wb-cmt i{margin-left:6px;font-size:12px;font-style:normal;color:#aaa}
.wb-bar{display:flex;margin:12px -14px 0;border-top:1px solid #f2f2f2}
.wb-act{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;height:40px;font-size:13px;color:#636363}
.wb-act svg{width:18px;height:18px}
.eira-dark .wb{background:#1b1b1b;color:#d8d8d8}
.eira-dark .wb-name{color:#e6e6e6}
.eira-dark .wb-pic{background:#2a2a2a;color:#777}
.eira-dark .wb-cmts{background:#242424}
.eira-dark .wb-bar{border-color:#2a2a2a}
.eira-dark .wb-act{color:#a0a0a0}
.eira-dark .wb-v{background:#1b1b1b}
</style>
<div class="wb">
<div class="wb-head">
<div class="wb-av">${avatarIn('wb-av', '昵称')}{{#认证}}<span class="wb-v">${TICK}</span>{{/认证}}</div>
<div class="wb-who"><div class="wb-name">{{昵称}}<span class="wb-mark">@Eira</span></div>
<div class="wb-sub">{{时间}}{{#来源}}&nbsp;&nbsp;来自 {{来源}}{{/来源}}</div></div>
<span class="wb-more">${I.down}</span>
</div>
<div class="wb-text">{{正文}}</div>
<div class="wb-pics">{{#配图}}<div class="wb-pic">${I.pic}<span>{{.}}</span></div>{{/配图}}</div>
<div class="wb-cmts">{{#热评}}<div class="wb-cmt"><b>{{昵称}}</b>：{{内容}}<i>{{点赞}}</i></div>{{/热评}}</div>
<div class="wb-bar"><div class="wb-act">${I.repost}<span>{{转发数}}{{^转发数}}转发{{/转发数}}</span></div><div class="wb-act">${I.comment}<span>{{评论数}}{{^评论数}}评论{{/评论数}}</span></div><div class="wb-act">${I.thumb}<span>{{点赞数}}{{^点赞数}}赞{{/点赞数}}</span></div></div>
</div>`;

// ---- 小红书（笔记详情）----
const XHS = `<style>
.xhs{min-height:100%;background:#fff;color:#333;font-size:15px;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
.xhs-top{display:flex;align-items:center;gap:8px;height:48px;padding:0 12px}
.xhs-top>svg{flex:none;width:22px;height:22px;color:#333}
.xhs-av{flex:none;width:32px;height:32px}
.xhs-av img,.xhs-av-ini{display:block;width:32px;height:32px;border-radius:50%;object-fit:cover}
.xhs-av-ini{background:#ffe3e6;color:#ff2442;font-size:14px;line-height:32px;white-space:nowrap;overflow:hidden;text-indent:calc(16px - .5em);letter-spacing:32px}
.xhs-name{flex:1;min-width:0;font-size:14px;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xhs-mark{margin-left:5px;font-size:11px;color:#bbb}
.xhs-follow{flex:none;height:26px;padding:0 14px;border:1px solid #ff2442;border-radius:13px;color:#ff2442;font-size:13px;line-height:26px}
.xhs-cover{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;aspect-ratio:3/4;padding:24px;box-sizing:border-box;background:#f5f5f5;color:#aaa;font-size:14px;line-height:1.5;text-align:center}
.xhs-cover svg{width:30px;height:30px}
.xhs-dots{display:flex;justify-content:center;gap:5px;padding:10px 0 0}
.xhs-dots i{width:5px;height:5px;border-radius:50%;background:#d8d8d8}
.xhs-dots i:first-child{background:#ff2442}
.xhs-dots:has(i:only-child),.xhs-dots:empty{display:none}
.xhs-body{padding:12px 16px 0}
.xhs-title{font-size:17px;font-weight:600;line-height:1.45;color:#333}
.xhs-text{margin-top:8px;line-height:1.7;word-break:break-word}
.xhs-tags{margin-top:6px;line-height:1.7;color:#13386c}
.xhs .eira-topic{color:#13386c}
.xhs-tags span{margin-right:6px}
.xhs-date{margin-top:10px;font-size:12px;color:#999}
.xhs-line{height:1px;margin:14px 16px 0;background:#f2f2f2}
.xhs-count{padding:12px 16px 4px;font-size:13px;color:#666}
.xhs-cmt{display:flex;gap:10px;padding:8px 16px}
.xhs-cav{flex:none;width:28px;height:28px;border-radius:50%;background:#f0f0f0;color:#888;font-size:12px;line-height:28px;white-space:nowrap;overflow:hidden;text-indent:calc(14px - .5em);letter-spacing:28px}
.xhs-cbody{flex:1;min-width:0}
.xhs-cname{font-size:13px;color:#999}
.xhs-ctext{margin-top:3px;font-size:14px;line-height:1.55;color:#333}
.xhs-cmeta{margin-top:4px;font-size:12px;color:#bbb}
.xhs-clike{flex:none;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11px;color:#999}
.xhs-clike svg{width:16px;height:16px}
.xhs-bar{position:sticky;bottom:0;display:flex;align-items:center;gap:14px;padding:8px 14px;margin-top:10px;border-top:1px solid #f2f2f2;background:#fff}
.xhs-input{flex:1;height:34px;padding:0 14px;border-radius:17px;background:#f5f5f5;color:#aaa;font-size:13px;line-height:34px}
.xhs-act{display:flex;align-items:center;gap:3px;font-size:13px;color:#333}
.xhs-act svg{width:22px;height:22px}
.eira-dark .xhs,.eira-dark .xhs-bar{background:#161616;color:#ddd}
.eira-dark .xhs-title,.eira-dark .xhs-ctext,.eira-dark .xhs-name,.eira-dark .xhs-act,.eira-dark .xhs-top>svg{color:#e5e5e5}
.eira-dark .xhs-cover,.eira-dark .xhs-input{background:#262626}
.eira-dark .xhs-tags{color:#7ea4d8}
.eira-dark .xhs-line,.eira-dark .xhs-bar{border-color:#262626}
</style>
<div class="xhs">
<div class="xhs-top">${I.back}${avatar('xhs-av', '昵称')}<div class="xhs-name">{{昵称}}<span class="xhs-mark">@Eira</span></div><span class="xhs-follow">关注</span>${I.share}</div>
<div class="xhs-cover">${I.pic}<span>{{封面}}</span></div>
<div class="xhs-dots">{{#配图}}<i></i>{{/配图}}</div>
<div class="xhs-body">
<div class="xhs-title">{{标题}}</div>
<div class="xhs-text">{{正文}}</div>
<div class="xhs-tags">{{#话题}}<span>#{{.}}</span>{{/话题}}</div>
<div class="xhs-date">{{日期}}{{#IP属地}} {{IP属地}}{{/IP属地}}</div>
</div>
<div class="xhs-line"></div>
<div class="xhs-count">共 {{评论数}}{{^评论数}}0{{/评论数}} 条评论</div>
{{#评论}}<div class="xhs-cmt"><span class="xhs-cav">{{昵称}}</span><div class="xhs-cbody"><div class="xhs-cname">{{昵称}}</div><div class="xhs-ctext">{{内容}}</div><div class="xhs-cmeta">{{时间}}&nbsp;&nbsp;回复</div></div><div class="xhs-clike">${I.heart}<span>{{点赞}}</span></div></div>{{/评论}}
<div class="xhs-bar"><div class="xhs-input">说点什么...</div><div class="xhs-act">${I.heart}<span>{{点赞数}}</span></div><div class="xhs-act">${I.star}<span>{{收藏数}}</span></div><div class="xhs-act">${I.comment}<span>{{评论数}}</span></div></div>
</div>`;

// ---- Instagram ----
const IG = `<style>
.ig{min-height:100%;background:#fff;color:#000;font-size:14px;font-family:-apple-system,"Helvetica Neue","PingFang SC",sans-serif}
.ig-head{display:flex;align-items:center;gap:10px;height:54px;padding:0 12px}
.ig-av{flex:none;width:32px;height:32px}
.ig-av img,.ig-av-ini{display:block;width:32px;height:32px;border-radius:50%;object-fit:cover;text-transform:uppercase}
.ig-av-ini{background:#efefef;color:#555;font-size:14px;font-weight:600;line-height:32px;white-space:nowrap;overflow:hidden;text-indent:calc(16px - .5em);letter-spacing:32px;text-transform:uppercase}
.ig-who{flex:1;min-width:0}
.ig-user{display:flex;align-items:center;gap:4px;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden}
.ig-user svg{flex:none;width:12px;height:12px;color:#0095f6}
.ig-mark{font-size:11px;font-weight:400;color:#a8a8a8}
.ig-loc{font-size:12px;color:#000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ig-head>svg{flex:none;width:22px;height:22px}
.ig-media{position:relative}
.ig-pics{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}
.ig-pics::-webkit-scrollbar{display:none}
.ig-pic{display:flex;flex:0 0 100%;flex-direction:column;align-items:center;justify-content:center;gap:8px;aspect-ratio:1;box-sizing:border-box;padding:24px;background:#efefef;color:#8e8e8e;font-size:14px;line-height:1.5;text-align:center;scroll-snap-align:start}
.ig-pic svg{width:30px;height:30px}
.ig-count{position:absolute;top:12px;right:12px;padding:3px 8px;border-radius:12px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;counter-reset:ig}
.ig-count i{position:absolute;visibility:hidden;counter-increment:ig}
.ig-count::after{content:"1/" counter(ig)}
.ig-count:has(i:only-child),.ig-count:empty{display:none}
.ig-acts{display:flex;align-items:center;gap:14px;padding:10px 12px 6px}
.ig-acts svg{width:25px;height:25px}
.ig-acts .ig-save{margin-left:auto}
.ig-dots{position:absolute;left:50%;transform:translateX(-50%);display:flex;gap:4px;margin-top:-22px}
.ig-dots i{width:6px;height:6px;border-radius:50%;background:#a8a8a8}
.ig-dots i:first-child{background:#0095f6}
.ig-dots:has(i:only-child),.ig-dots:empty{display:none}
.ig-body{padding:0 12px 12px;line-height:1.45}
.ig-likes{font-weight:600}
.ig-cap{margin-top:4px;word-break:break-word}
.ig-cap b{font-weight:600;margin-right:4px}
.ig-tags span{color:#00376b;margin-right:4px}
.ig .eira-topic{color:#00376b}
.eira-dark .ig .eira-topic{color:#e0f1ff}
.ig-more{margin-top:6px;color:#737373}
.ig-time{margin-top:6px;font-size:11px;color:#737373}
.eira-dark .ig{background:#000;color:#f5f5f5}
.eira-dark .ig-loc{color:#f5f5f5}
.eira-dark .ig-pic,.eira-dark .ig-av-ini{background:#262626;color:#a8a8a8;text-transform:uppercase}
.eira-dark .ig-tags span{color:#e0f1ff}
.eira-dark .ig-more,.eira-dark .ig-time{color:#a8a8a8}
</style>
<div class="ig">
<div class="ig-head">${avatar('ig-av', '用户名')}<div class="ig-who"><div class="ig-user">{{用户名}}{{#认证}}${TICK}{{/认证}}<span class="ig-mark">@Eira</span></div>{{#地点}}<div class="ig-loc">{{地点}}</div>{{/地点}}</div>${I.dots}</div>
<div class="ig-media"><div class="ig-pics">{{#图片}}<div class="ig-pic">${I.pic}<span>{{.}}</span></div>{{/图片}}{{^图片}}<div class="ig-pic">${I.pic}</div>{{/图片}}</div><div class="ig-count">{{#图片}}<i></i>{{/图片}}</div></div>
<div class="ig-acts">${I.heart}${I.comment}${I.plane}<span class="ig-save">${I.bookmark}</span></div>
<div class="ig-dots">{{#图片}}<i></i>{{/图片}}</div>
<div class="ig-body">
<div class="ig-likes">{{点赞数}}{{^点赞数}}0{{/点赞数}} 次赞</div>
<div class="ig-cap"><b>{{用户名}}</b>{{正文}}</div>
<div class="ig-tags">{{#话题}}<span>#{{.}}</span>{{/话题}}</div>
{{#评论数}}<div class="ig-more">查看全部 {{评论数}} 条评论</div>{{/评论数}}
<div class="ig-time">{{时间}}</div>
</div>
</div>`;

// ---- X ----
const X = `<style>
.x{min-height:100%;box-sizing:border-box;padding:12px 16px 4px;background:#fff;color:#0f1419;font-size:15px;font-family:-apple-system,"Helvetica Neue","PingFang SC",sans-serif}
.x-row{display:flex;gap:12px}
.x-av{flex:none;width:40px;height:40px}
.x-av img,.x-av-ini{display:block;width:40px;height:40px;border-radius:50%;object-fit:cover}
.x-av-ini{background:#cfd9de;color:#0f1419;font-size:17px;font-weight:700;line-height:40px;white-space:nowrap;overflow:hidden;text-indent:calc(20px - .5em);letter-spacing:40px}
.x-main{flex:1;min-width:0}
.x-head{display:flex;align-items:center;gap:4px;font-size:15px;line-height:20px;white-space:nowrap;overflow:hidden}
.x-name{font-weight:700;overflow:hidden;text-overflow:ellipsis}
.x-head>svg,.x-name+svg{flex:none;width:18px;height:18px;color:#1d9bf0}
.x-meta{color:#536471;overflow:hidden;text-overflow:ellipsis}
.x-more{flex:none;margin-left:auto;width:18px;height:18px;color:#536471}
.x-text{margin-top:2px;line-height:20px;word-break:break-word}
.x-tags span{color:#1d9bf0;margin-right:4px}
.x .eira-topic{color:#1d9bf0}
.x-pics{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin-top:12px;border:1px solid #cfd9de;border-radius:16px;overflow:hidden}
.x-pics:empty{display:none}
.x-pic{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;aspect-ratio:1;box-sizing:border-box;padding:10px;background:#eff3f4;color:#8b98a5;font-size:12px;line-height:1.4;text-align:center}
.x-pic svg{width:22px;height:22px}
.x-pic:only-child{grid-column:span 2;aspect-ratio:16/10}
.x-pics:has(>.x-pic:nth-child(3):last-child) .x-pic:first-child{grid-row:span 2;aspect-ratio:auto}
.x-acts{display:flex;justify-content:space-between;margin-top:12px;padding-bottom:8px;color:#536471;font-size:13px}
.x-act{display:flex;align-items:center;gap:4px}
.x-act svg{width:18px;height:18px}
.x-mark{margin-left:4px;color:#8b98a5;font-size:12px}
.eira-dark .x{background:#000;color:#e7e9ea}
.eira-dark .x-meta,.eira-dark .x-acts,.eira-dark .x-more{color:#71767b}
.eira-dark .x-pics{border-color:#2f3336}
.eira-dark .x-pic,.eira-dark .x-av-ini{background:#16181c;color:#71767b}
</style>
<div class="x"><div class="x-row">${avatar('x-av', '显示名')}<div class="x-main">
<div class="x-head"><span class="x-name">{{显示名}}</span>{{#认证}}${TICK}{{/认证}}<span class="x-meta">@{{用户名}}<span class="x-mark">@Eira</span> · {{时间}}</span><span class="x-more">${I.dots}</span></div>
<div class="x-text">{{正文}}</div>
<div class="x-tags">{{#话题}}<span>#{{.}}</span>{{/话题}}</div>
<div class="x-pics">{{#图片}}<div class="x-pic">${I.pic}<span>{{.}}</span></div>{{/图片}}</div>
<div class="x-acts"><span class="x-act">${I.comment}{{回复数}}</span><span class="x-act">${I.repost}{{转发数}}</span><span class="x-act">${I.heart}{{点赞数}}</span><span class="x-act">${I.views}{{浏览量}}</span><span class="x-act">${I.bookmark}{{书签数}}</span></div>
</div></div></div>`;

// ---- 豆瓣：广播 ----
const DB_STATUS = `<style>
.dbs{min-height:100%;box-sizing:border-box;padding:14px 16px 0;background:#fff;color:#111;font-size:15px;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
.dbs-head{display:flex;align-items:center;gap:10px}
.dbs-av{flex:none;width:40px;height:40px}
.dbs-av img,.dbs-av-ini{display:block;width:40px;height:40px;border-radius:50%;object-fit:cover}
.dbs-av-ini{background:#e3f4e6;color:#2e963d;font-size:17px;line-height:40px;white-space:nowrap;overflow:hidden;text-indent:calc(20px - .5em);letter-spacing:40px}
.dbs-who{flex:1;min-width:0}
.dbs-name{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dbs-name span{font-weight:400;color:#818181}
.dbs-mark{margin-left:5px;font-size:11px;color:#bbb}
.dbs-time{margin-top:3px;font-size:12px;color:#9b9b9b}
.dbs-text{margin-top:10px;line-height:1.7;word-break:break-word}
.dbs-pics{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:10px}
.dbs-pics:empty{display:none}
.dbs-pic{display:flex;align-items:center;justify-content:center;aspect-ratio:1;padding:6px;box-sizing:border-box;border-radius:4px;background:#f2f2f2;color:#aaa;font-size:11px;text-align:center}
.dbs-bar{display:flex;justify-content:space-around;margin:12px -16px 0;border-top:1px solid #f0f0f0}
.dbs-act{display:flex;align-items:center;gap:5px;height:42px;font-size:13px;color:#6e6e6e}
.dbs-act svg{width:18px;height:18px}
.eira-dark .dbs{background:#1c1c1c;color:#dcdcdc}
.eira-dark .dbs-pic{background:#2b2b2b;color:#777}
.eira-dark .dbs-bar{border-color:#2b2b2b}
.eira-dark .dbs-act{color:#9a9a9a}
</style>
<div class="dbs">
<div class="dbs-head">${avatar('dbs-av', '昵称')}<div class="dbs-who"><div class="dbs-name">{{昵称}}<span> 说：</span><span class="dbs-mark">@Eira</span></div><div class="dbs-time">{{时间}}</div></div></div>
<div class="dbs-text">{{正文}}</div>
<div class="dbs-pics">{{#配图}}<div class="dbs-pic">{{.}}</div>{{/配图}}</div>
<div class="dbs-bar"><span class="dbs-act">${I.comment}{{回应数}}{{^回应数}}回应{{/回应数}}</span><span class="dbs-act">${I.repost}{{转发数}}{{^转发数}}转发{{/转发数}}</span><span class="dbs-act">${I.thumb}{{点赞数}}{{^点赞数}}赞{{/点赞数}}</span></div>
</div>`;

// ---- 豆瓣：小组帖 ----
const DB_GROUP = `<style>
.dbg{min-height:100%;background:#fff;color:#111;font-size:15px;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
.dbg-grp{display:flex;align-items:center;gap:8px;padding:12px 16px;background:#f6f6f1;font-size:13px;color:#494949}
.dbg-grp svg{width:18px;height:18px;color:#2e963d}
.dbg-grp b{font-weight:600;color:#2e963d}
.dbg-main{padding:14px 16px 0}
.dbg-title{font-size:19px;font-weight:600;line-height:1.45}
.dbg-author{display:flex;align-items:center;gap:8px;margin-top:12px}
.dbg-av{flex:none;width:30px;height:30px}
.dbg-av img,.dbg-av-ini{display:block;width:30px;height:30px;border-radius:50%;object-fit:cover}
.dbg-av-ini{background:#e3f4e6;color:#2e963d;font-size:13px;line-height:30px;white-space:nowrap;overflow:hidden;text-indent:calc(15px - .5em);letter-spacing:30px}
.dbg-an{font-size:14px;color:#2e963d}
.dbg-mark{margin-left:4px;font-size:11px;color:#bbb}
.dbg-at{margin-left:auto;font-size:12px;color:#aaa}
.dbg-text{margin-top:14px;line-height:1.8;word-break:break-word}
.dbg-rn{margin:18px 16px 0;padding-bottom:8px;border-bottom:1px solid #eee;font-size:14px;color:#494949}
.dbg-r{display:flex;gap:10px;padding:12px 16px;border-bottom:1px solid #f4f4f4}
.dbg-rav{flex:none;width:28px;height:28px;border-radius:50%;background:#eee;color:#888;font-size:12px;line-height:28px;white-space:nowrap;overflow:hidden;text-indent:calc(14px - .5em);letter-spacing:28px}
.dbg-rb{flex:1;min-width:0}
.dbg-rh{display:flex;font-size:13px;color:#2e963d}
.dbg-rh span{margin-left:auto;color:#aaa;font-size:12px}
.dbg-rt{margin-top:4px;font-size:14px;line-height:1.6;color:#333}
.eira-dark .dbg{background:#1c1c1c;color:#dcdcdc}
.eira-dark .dbg-grp{background:#262622;color:#aaa}
.eira-dark .dbg-rt{color:#ccc}
.eira-dark .dbg-rn,.eira-dark .dbg-r{border-color:#2b2b2b}
</style>
<div class="dbg">
<div class="dbg-grp">${I.group}<span>来自 <b>{{小组名}}</b></span></div>
<div class="dbg-main">
<div class="dbg-title">{{标题}}</div>
<div class="dbg-author">${avatar('dbg-av', '昵称')}<span class="dbg-an">{{昵称}}<span class="dbg-mark">@Eira</span></span><span class="dbg-at">{{时间}}</span></div>
<div class="dbg-text">{{正文}}</div>
</div>
<div class="dbg-rn">{{回应数}}{{^回应数}}0{{/回应数}} 回应</div>
{{#回应}}<div class="dbg-r"><span class="dbg-rav">{{昵称}}</span><div class="dbg-rb"><div class="dbg-rh">{{昵称}}<span>{{时间}}</span></div><div class="dbg-rt">{{内容}}</div></div></div>{{/回应}}
</div>`;

// ---- 豆瓣：影评书评 ----
// 星级用 class 带出来（dbr-s1 到 dbr-s5），纯 CSS 画成几颗
const DB_REVIEW = `<style>
.dbr{min-height:100%;box-sizing:border-box;padding:14px 16px 0;background:#fff;color:#111;font-size:15px;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
.dbr-item{display:flex;gap:12px;padding:10px;border-radius:6px;background:#f6f6f1}
.dbr-poster{flex:none;display:flex;align-items:center;justify-content:center;width:52px;height:74px;border-radius:3px;background:#dfe0d7;color:#9a9b90}
.dbr-poster svg{width:20px;height:20px}
.dbr-info{flex:1;min-width:0}
.dbr-iname{font-size:15px;font-weight:600;line-height:1.35}
.dbr-iyear{font-weight:400;color:#818181}
.dbr-irate{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;color:#818181}
.dbr-irate b{font-size:14px;color:#111}
.dbr-title{margin-top:16px;font-size:18px;font-weight:600;line-height:1.45}
.dbr-by{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;color:#818181}
.dbr-av{flex:none;width:24px;height:24px}
.dbr-av img,.dbr-av-ini{display:block;width:24px;height:24px;border-radius:50%;object-fit:cover}
.dbr-av-ini{background:#e3f4e6;color:#2e963d;font-size:11px;line-height:24px;white-space:nowrap;overflow:hidden;text-indent:calc(12px - .5em);letter-spacing:24px}
.dbr-by b{font-weight:400;color:#2e963d}
.dbr-mark{font-size:11px;color:#bbb}
.dbr-stars{position:relative;display:inline-block;width:65px;height:13px;background:linear-gradient(90deg,#e0e0e0 0 100%);-webkit-mask:var(--dbr-star) 0 0/13px 13px repeat-x;mask:var(--dbr-star) 0 0/13px 13px repeat-x}
.dbr-stars::before{content:"";position:absolute;inset:0;width:var(--dbr-w,0%);background:#ffac2d}
.dbr{--dbr-star:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z'/%3E%3C/svg%3E")}
.dbr-s1{--dbr-w:20%}.dbr-s2{--dbr-w:40%}.dbr-s3{--dbr-w:60%}.dbr-s4{--dbr-w:80%}.dbr-s5{--dbr-w:100%}
.dbr-text{margin-top:12px;line-height:1.8;word-break:break-word}
.dbr-bar{display:flex;gap:18px;margin-top:14px;padding:12px 0;border-top:1px solid #f0f0f0;font-size:13px;color:#6e6e6e}
.eira-dark .dbr{background:#1c1c1c;color:#dcdcdc}
.eira-dark .dbr-item{background:#262622}
.eira-dark .dbr-irate b{color:#eee}
.eira-dark .dbr-bar{border-color:#2b2b2b;color:#9a9a9a}
</style>
<div class="dbr">
<div class="dbr-item"><div class="dbr-poster">${I.pic}</div><div class="dbr-info"><div class="dbr-iname">{{条目}} <span class="dbr-iyear">{{#年份}}({{年份}}){{/年份}}</span></div>
<div class="dbr-irate"><span class="dbr-stars dbr-s{{条目星级}}"></span><b>{{豆瓣评分}}</b>{{^豆瓣评分}}暂无评分{{/豆瓣评分}}</div></div></div>
<div class="dbr-title">{{标题}}</div>
<div class="dbr-by">${avatar('dbr-av', '昵称')}<b>{{昵称}}</b><span class="dbr-mark">@Eira</span><span class="dbr-stars dbr-s{{星级}}"></span><span>{{时间}}</span></div>
<div class="dbr-text">{{正文}}</div>
<div class="dbr-bar"><span>{{有用数}}{{^有用数}}0{{/有用数}} 有用</span><span>{{没用数}}{{^没用数}}0{{/没用数}} 没用</span><span>{{回应数}}{{^回应数}}0{{/回应数}} 回应</span></div>
</div>`;

// ---- 知乎：回答 ----
const ZHIHU = `<style>
.zh{min-height:100%;box-sizing:border-box;background:#fff;color:#121212;font-size:15px;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
.zh-q{padding:14px 16px 12px;border-bottom:8px solid #f6f6f6;font-size:18px;font-weight:600;line-height:1.45}
.zh-a{padding:14px 16px 0}
.zh-author{display:flex;align-items:center;gap:10px}
.zh-av{flex:none;width:36px;height:36px}
.zh-av img,.zh-av-ini{display:block;width:36px;height:36px;border-radius:50%;object-fit:cover}
.zh-av-ini{background:#e5efff;color:#056de8;font-size:16px;line-height:36px;white-space:nowrap;overflow:hidden;text-indent:calc(18px - .5em);letter-spacing:36px}
.zh-who{flex:1;min-width:0}
.zh-name{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zh-mark{margin-left:5px;font-size:11px;font-weight:400;color:#bbb}
.zh-sign{margin-top:2px;font-size:13px;color:#8590a6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zh-follow{flex:none;height:28px;padding:0 12px;border-radius:4px;background:#056de8;color:#fff;font-size:13px;line-height:28px}
.zh-agree{margin-top:12px;font-size:13px;color:#8590a6}
.zh-text{margin-top:8px;font-size:16px;line-height:1.75;word-break:break-word}
.zh-edit{margin-top:14px;font-size:13px;color:#8590a6}
.zh-bar{position:sticky;bottom:0;display:flex;align-items:center;gap:6px;white-space:nowrap;margin-top:12px;padding:10px 16px;border-top:1px solid #f0f2f7;background:#fff}
.zh-vote{flex:none;display:flex;align-items:center;gap:4px;height:32px;padding:0 10px;border-radius:4px;background:rgba(5,109,232,.1);color:#056de8;font-size:14px}
.zh-vote svg{width:12px;height:12px}
.zh-down{flex:none;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:4px;background:rgba(5,109,232,.1);color:#056de8}
.zh-down svg{width:12px;height:12px}
.zh-act{flex:none;display:flex;align-items:center;gap:2px;font-size:12px;color:#8590a6}
.zh-acts{display:flex;gap:12px;margin-left:auto}
.zh-act svg{width:18px;height:18px}
.eira-dark .zh,.eira-dark .zh-bar{background:#121212;color:#d3d3d3}
.eira-dark .zh-q{border-color:#1f1f1f}
.eira-dark .zh-bar{border-color:#1f1f1f}
</style>
<div class="zh">
<div class="zh-q">{{问题}}</div>
<div class="zh-a">
<div class="zh-author">${avatar('zh-av', '回答者')}<div class="zh-who"><div class="zh-name">{{回答者}}<span class="zh-mark">@Eira</span></div>{{#签名}}<div class="zh-sign">{{签名}}</div>{{/签名}}</div><span class="zh-follow">+ 关注</span></div>
{{#赞同数}}<div class="zh-agree">{{赞同数}} 人赞同了该回答</div>{{/赞同数}}
<div class="zh-text">{{正文}}</div>
<div class="zh-edit">编辑于 {{时间}}</div>
</div>
<div class="zh-bar"><span class="zh-vote">${I.up}赞同 {{赞同数}}</span><span class="zh-down">${I.dn}</span><span class="zh-acts"><span class="zh-act">${I.comment}{{评论数}}</span><span class="zh-act">${I.star}{{收藏数}}</span><span class="zh-act">${I.heart}</span></span></div>
</div>`;

// ---- 条目 ----
const tall = (html, extra = {}) => ({ html, width: 'full', ratio: 'long', images: false, ...extra });

export const BUILTIN_BOOK_ID = 'builtin-cards';

export const BUILTIN = [
  {
    id: 'builtin-weibo', comment: '微博', keys: ['微博', '热搜', '转发'],
    content: 'A Weibo post as it appears in the feed.',
    card: tall(WEIBO, {
      ratio: 'custom', height: 420, authorField: '昵称',
      fields: {
        昵称: { desc: 'screen name of the poster', max: 20 },
        认证: { desc: 'write 是 for a verified account; leave out otherwise' },
        时间: { desc: 'relative time, e.g. 10分钟前 or 09-26' },
        来源: { desc: 'the device or client it was posted from, e.g. iPhone 15 Pro; may be left out' },
        正文: { desc: 'the post text; topics are written as #topic# and mentions as @name', max: 500, topics: true },
        配图: { desc: 'up to 9 images, each a short description of the picture', max: 30 },
        热评: { desc: 'top comments shown under the post' },
        '热评.昵称': { max: 16 }, '热评.内容': { max: 60, topics: true }, '热评.点赞': { desc: 'like count' },
        转发数: {}, 评论数: {}, 点赞数: {},
      },
    }),
    sampleText: '昵称：林深\n认证：是\n时间：10分钟前\n来源：iPhone 15 Pro\n正文：今天路过那家书店，门口的猫还在。#城市里的小事#\n配图：书店门口的橘猫\n配图：落地窗上的雨\n热评：路人甲｜这是哪家店｜326\n热评：阿岚｜下次带我去｜58\n转发数：12\n评论数：89\n点赞数：1.2万',
  },
  {
    id: 'builtin-xhs', comment: '小红书', keys: ['小红书', '笔记', '种草'],
    content: 'A Xiaohongshu (RED) note, shown as the note detail page.',
    card: tall(XHS, {
      authorField: '昵称',
      fields: {
        昵称: { desc: 'author name', max: 20 },
        封面: { desc: 'a short description of the cover image', max: 40 },
        配图: { desc: 'one line per image in the note including the cover, each a short description; only the count is shown as dots' },
        标题: { desc: 'note title', max: 30 },
        正文: { desc: 'note text', max: 800, long: true, lines: 10, topics: true },
        话题: { desc: 'hashtags without the # sign' },
        日期: { desc: 'e.g. 09-26 or 3天前' },
        IP属地: { desc: 'region shown after the date, e.g. 上海' },
        评论: { desc: 'comments under the note' },
        '评论.昵称': { max: 16 }, '评论.内容': { max: 80 }, '评论.时间': { desc: 'e.g. 09-26' }, '评论.点赞': { desc: 'like count' },
        点赞数: {}, 收藏数: {}, 评论数: {},
      },
    }),
    sampleText: '昵称：林深\n封面：窗边的一杯拿铁和一本书\n配图：窗边的一杯拿铁和一本书\n配图：书页特写\n标题：雨天适合躲进书店\n正文：下午在老城区找到一家很安静的书店。\n二楼靠窗的位置可以坐一整个下午。\n话题：城市漫步\n话题：书店\n日期：09-26\nIP属地：上海\n评论：路人甲｜求地址｜09-26｜12\n点赞数：2368\n收藏数：1021\n评论数：86',
  },
  {
    id: 'builtin-ig', comment: 'Instagram', keys: ['instagram', '照片墙', 'ins上', '发ins', 'ig上'],
    content: 'An Instagram post.',
    card: tall(IG, {
      ratio: 'custom', height: 560, authorField: '用户名',
      fields: {
        用户名: { desc: 'Instagram handle without @', max: 30 },
        认证: { desc: 'write 是 for a verified account; leave out otherwise' },
        地点: { desc: 'location tag; may be left out', max: 30 },
        图片: { desc: 'one line per image, each a short description', max: 40 },
        点赞数: { desc: 'number of likes' },
        正文: { desc: 'caption', max: 300, topics: true },
        话题: { desc: 'hashtags without the # sign' },
        评论数: {}, 时间: { desc: 'e.g. 3天前' },
      },
    }),
    sampleText: '用户名：linshen.film\n地点：Kyoto, Japan\n图片：鸭川边的黄昏\n图片：石板路上的影子\n点赞数：1,284\n正文：Some evenings are worth walking slowly.\n话题：kyoto\n话题：filmphotography\n评论数：42\n时间：3天前',
  },
  {
    id: 'builtin-x', comment: 'X', keys: ['推特', '推文', 'twitter'],
    content: 'A post on X (formerly Twitter), shown as in the timeline.',
    card: tall(X, {
      ratio: 'custom', height: 360, authorField: '显示名',
      fields: {
        显示名: { desc: 'display name', max: 30 },
        用户名: { desc: 'handle without @', max: 20 },
        认证: { desc: 'write 是 for a verified account; leave out otherwise' },
        时间: { desc: 'e.g. 2小时 or 9月26日' },
        正文: { desc: 'post text', max: 280, topics: true },
        话题: { desc: 'hashtags without the # sign' },
        图片: { desc: 'up to 4 images, each a short description', max: 30 },
        回复数: {}, 转发数: {}, 点赞数: {}, 浏览量: {}, 书签数: {},
      },
    }),
    sampleText: '显示名：林深\n用户名：linshen\n时间：2小时\n正文：今天第一次在凌晨四点看见街上没有人。\n图片：空荡荡的十字路口\n回复数：18\n转发数：42\n点赞数：356\n浏览量：1.2万\n书签数：9',
  },
  {
    id: 'builtin-douban-status', comment: '豆瓣广播', keys: ['豆瓣', '广播'],
    content: 'A Douban status update (广播).',
    card: tall(DB_STATUS, {
      ratio: 'custom', height: 360, authorField: '昵称',
      fields: {
        昵称: { max: 20 }, 时间: { desc: 'e.g. 09-26 21:40' }, 正文: { max: 400 },
        配图: { desc: 'images, each a short description', max: 20 },
        回应数: {}, 转发数: {}, 点赞数: {},
      },
    }),
    sampleText: '昵称：林深\n时间：09-26 21:40\n正文：重看了一遍《海街日记》，还是在四姐妹吃梅子酒那段哭了。\n回应数：6\n转发数：2\n点赞数：31',
  },
  {
    id: 'builtin-douban-group', comment: '豆瓣小组', keys: ['豆瓣', '小组'],
    content: 'A post in a Douban group (小组) with its replies.',
    card: tall(DB_GROUP, {
      authorField: '昵称',
      fields: {
        小组名: { max: 20 }, 标题: { max: 40 }, 昵称: { max: 20 }, 时间: { desc: 'e.g. 2026-09-26 21:40' },
        正文: { max: 800, long: true, lines: 10 },
        回应数: {}, 回应: { desc: 'replies under the post' },
        '回应.昵称': { max: 16 }, '回应.时间': { desc: 'e.g. 09-26 22:03' }, '回应.内容': { max: 120 },
      },
    }),
    sampleText: '小组名：豆瓣鹅组\n标题：有没有人和我一样只在雨天去书店\n昵称：林深\n时间：2026-09-26 21:40\n正文：晴天总觉得应该去外面走走，只有下雨的时候才心安理得地待在书店里。\n回应数：128\n回应：路人甲｜09-26 22:03｜同，雨天的书店人少\n回应：阿岚｜09-26 22:10｜下次叫上我',
  },
  {
    id: 'builtin-douban-review', comment: '豆瓣影评', keys: ['影评', '书评', '豆瓣评分'],
    content: 'A Douban review of a film or book, with the item card on top.',
    card: tall(DB_REVIEW, {
      authorField: '昵称',
      fields: {
        条目: { desc: 'title of the film or book', max: 30 }, 年份: { desc: 'release or publication year' },
        豆瓣评分: { desc: 'Douban score such as 8.9; may be left out' },
        条目星级: { desc: 'the Douban score as whole stars, a digit from 1 to 5' },
        标题: { desc: 'review title', max: 40 }, 昵称: { max: 20 },
        星级: { desc: 'the reviewer rating, a digit from 1 to 5' },
        时间: { desc: 'e.g. 2026-09-26' },
        正文: { max: 1200, long: true, lines: 12 },
        有用数: {}, 没用数: {}, 回应数: {},
      },
    }),
    sampleText: '条目：海街日记\n年份：2015\n豆瓣评分：8.8\n条目星级：4\n标题：四个人的夏天\n昵称：林深\n星级：5\n时间：2026-09-26\n正文：是枝裕和把一家人的日常拍得像一封很长的信。\n有用数：312\n没用数：4\n回应数：27',
  },
  {
    id: 'builtin-zhihu', comment: '知乎', keys: ['知乎', '回答'],
    content: 'A Zhihu answer, with the question on top.',
    card: tall(ZHIHU, {
      authorField: '回答者',
      fields: {
        问题: { max: 50 }, 回答者: { max: 20 }, 签名: { desc: 'one-line bio under the name; may be left out', max: 30 },
        赞同数: {}, 正文: { max: 1500, long: true, lines: 14 }, 时间: { desc: 'e.g. 2026-09-26 21:40' },
        评论数: {}, 收藏数: {},
      },
    }),
    sampleText: '问题：一个人在陌生城市生活是什么体验？\n回答者：林深\n签名：摄影 / 读书 / 走路\n赞同数：2,341\n正文：第一年最难的是周末。\n后来学会了一个人去看早场电影。\n时间：2026-09-26 21:40\n评论数：186\n收藏数：903',
  },
].map(e => ({
  type: 'card', enabled: true, constant: false, secondaryKeys: [], caseSensitive: false,
  priority: 100, order: 0, part: 'before', depth: 0, probability: 100, builtin: true,
  ...e,
  card: { ...e.card, sampleText: e.sampleText },
}));

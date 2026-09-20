import { html } from '../../lib.js';
import { useImage } from '../../sdk/index.js';
import { Avatar } from '../../ui/index.js';

// 头像。
//
// **`char.avatar` 存的是图片 id，不是能直接塞进 `<img src>` 的地址。**
// 要先过一道 useImage 换成 objectURL，否则那张图永远出不来，只剩姓名首字。
// 这一整个 app 里六处头像原先都是把 id 直接递过去的，六处都不显示。
//
// 单拆一个组件是因为 **hook 不能在 .map() 里调**：列表里一行一个头像，
// 每一行都要一次 useImage，只能各自是一个组件。ui/Avatar 本身不改 ——
// 别处传进去的本来就是地址，那一层不该猜自己收到的是哪一种。
export const CharAvatar = ({ subject, name, size = 36 }) => {
  const url = useImage(subject?.avatar);
  return html`<${Avatar} src=${url} name=${name ?? subject?.name ?? ''} size=${size}/>`;
};

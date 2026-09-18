import * as avatarLib from '../../avatar.js';

// 「对方的头像」那一句。
//
// 只在**刚换过**的时候出现。常驻一句「他的头像是深蓝色的」没有意义 ——
// 头像一直在那儿，值得一提的是它变了。
//
// 描述是本地按像素算的，只说明暗浓淡，**不作任何解读**。
// 写「几乎全黑」，不写「看起来心情不好」—— 那是她自己该琢磨的事，
// 写死了她只会照着念出来。
export const meta = {
  id: 'avatar',
  label: '对方的头像',
  desc: '对方换头像时提示一次，附一句客观描述。不解读含义',
};

export function build({ chat, persona }) {
  if (!chat || !persona || !persona.avatar) return '';
  if (!avatarLib.changedFor(chat, persona)) return '';
  const note = String(persona.avatarNote || '').trim();
  return `\n\n[对方的头像]\n对方更换了头像。${note ? `新的一张${note}。` : ''}\n`
    + '这是你可以看到的事实。是否提及、作何反应，由你自行决定。';
}

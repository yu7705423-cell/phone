import { characters } from '../../db/index.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask } from '../engine.js';
import * as theirs from '../../theirs.js';

// 生成角色手机里的东西。
//
// 头一样是锁屏密码。**生成之后不显示给用户** —— 看了就没得猜了，
// 而猜这一下本来就是这个功能的全部意思。密码、答案、三条提示一次要回来，
// 问提示的时候不再调接口（第 15 条：能一次要回来的不分两次）。

const str = v => String(v ?? '').trim();

const personaOf = char => [char.persona, char.signature, char.description]
  .filter(Boolean).join('\n\n') || '（角色卡里还没有写人设）';

/**
 * 按人设定一个开机密码。digits 由用户挑，四位或六位。
 * 存下来的时候 shown 归零 —— 一条提示都还没问过。
 */
export async function makeLock(charId, { digits = 4 } = {}) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const n = digits === 6 ? 6 : 4;

  const out = await runJSONTask('phone.lock', {
    system: fillTemplate(template('task.phone-lock'), {
      charName: char.name || '该角色',
      charPersona: personaOf(char),
      digits: n,
    }),
    key: `phone-lock:${charId}:${Date.now()}`,
    maxTokens: 500,
  });

  // 模型偶尔会给带空格或别的字符的串，也偶尔会给错位数。
  // 位数不对就不收 —— 一个开不了的锁比没有锁糟得多
  const code = str(out?.code).replace(/\D/g, '');
  if (code.length !== n) throw new Error(`模型给的不是 ${n} 位数字，请重试`);

  const hints = (Array.isArray(out?.hints) ? out.hints : [])
    .map(str).filter(Boolean).slice(0, 3);
  if (!hints.length) throw new Error('模型没有给出提示，请重试');

  theirs.setLock(charId, { code, why: str(out?.why), hints });
  return { digits: n, hints: hints.length };
}

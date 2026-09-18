import { sources, read, rel, report } from './lib.mjs';

// 注入 prompt 的文字必须是英文，剩下的那点中文必须是书面语。见 CLAUDE.md 第 14 条。
//
// 两件事分两组规则查：
//
//   **英文**   prompt 正文一律英文。中文指令会把自己的措辞漏进输出里 ——
//              译文一口中式英文、回复一股说明书味，都是这么来的。
//              只在 prompt 正文里查，界面文案和报错照旧是中文（第 7 条）。
//
//   **书面语** 留在 prompt 里的中文（方括号标记、「」里举的原话、示例那一段）
//              仍然按第 14 条写。这一组以前只写在对话里，没有任何东西拦得住，
//              于是同一个错犯了很多次。
//
// 只扫**字符串字面量**，注释不管（CLAUDE.md 第 7 条：注释可以口语）。

const FILES = /^src\/system\/ai\//;

// 额外几个也在往 prompt 里塞句子的文件
const EXTRA = new Set([
  'src/system/time.js',
  'src/system/food.js',
  'src/system/bond.js',
]);

// 「这个文件里的字符串就是 prompt 正文」—— 只有这几个文件敢这么说。
// 别的文件（engine、tasks、time）里报错文案和 prompt 混在一起，
// 机器分不出来，那一层仍然要自己把关。
const ENGLISH = new Set([
  'src/system/ai/templates.js',
  'src/system/ai/capabilities.js',
  'src/system/ai/context/avatar.js',
  'src/system/ai/context/basic.js',
  'src/system/ai/context/day.js',
  'src/system/ai/context/geo.js',
  'src/system/ai/context/memory.js',
  'src/system/ai/context/music.js',
  'src/system/ai/context/space.js',
  'src/system/ai/context/watch.js',
]);

const RULES = [
  [/[呀嘛啦哦咯][。！？，、\n]|[呀嘛啦哦咯]$/u, '句末语气词'],
  [/[吧呢][。！？\n]|[吧呢]$/u, '句末语气词「吧」「呢」'],
  [/别(写|说|让|问|提|做|用|把|给|当|太|忘|急|去|再|管|挑)/u, '「别…」是口语，祈使否定写「不要…」'],
  [/而已|反正|干脆|顺手|省得|压根|甭|一上来|拿不准|凭空/u, '口头连接词'],
  [/就(行|好|是了|完了)/u, '「就行」一类口语'],
  [/啥|咋|瞎|老是|成天|一堆|好几|不痛快|走背字|上火|小作文|边角料|吐槽|使劲/u, '口语词'],
  [/——/u, '破折号插入语'],
  [/(?<!其)他(?!们|人)|她/u, '用「她」「他」称呼角色会替用户预设性别，写「该角色」'],
  // 直引号只在**中文句子里**算错。英文正文里的 "..." 是它本来的标点。
  [/[一-鿿][^"\n]*"[^"\n]{1,24}"|"[^"\n]{0,24}[一-鿿][^"\n]{0,24}"/u,
    '中文里用了直引号，应当用「」', 'noJson'],
];

// 连着这么多个汉字就算是在写中文句子了。标记名（图片、约定完成）都比它短。
const RUN = 4;
const HAN_RUN = new RegExp(`[\\u4e00-\\u9fff]{${RUN},}`, 'u');

// 明知违反但必须留着的，一行一个理由
const ALLOW = new Map([
  ['skeleton.examples',
    '示例演示的就是人怎么发消息，它本身不是规则，语气词是被演示的内容'],
]);

// 去掉注释，只留代码。字符串里的 // 不算注释，所以要边走边认引号。
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i += 1; continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c; i += 1;
  }
  return out;
}

// 输出格式那一段本来就是 JSON，里面的直引号是语法，不是标点
const stripJson = t => t.split('\n')
  .filter(l => !/[{}[\]]/.test(l) && !/^\s*"[\w]+"\s*:/.test(l))
  .join('\n');

// 查「是不是英文」之前先把**本来就该是中文**的那几样摘掉：
//   [图片：…]  方括号标记是协议，reply.js 按它切分，库里的历史消息也存着它
//   「…」      引起来的是被举例、被禁止的原话
//   《…》      片名、书名
//   JSON       输出格式那一段
const stripProtocol = t => stripJson(t)
  .replace(/[[【][^\]】\n]*[\]】]/gu, '[]')
  .replace(/「[^」\n]*」/gu, '「」')
  .replace(/《[^》\n]*》/gu, '《》');

// 字符串字面量，连同它前面最近的那个模板 id（'task.xxx': 那种）
function literals(src) {
  const out = [];
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const before = src.slice(0, m.index);
    const key = [...before.matchAll(/'((?:skeleton|task)\.[\w-]+)'\s*:/g)].pop();
    const head = before.slice(before.lastIndexOf('\n') + 1);
    out.push({
      text: m[2],
      line: before.split('\n').length,
      key: key ? key[1] : '',
      // 界面文案与报错：注入顺序那一页读 label / desc，报错是给用户看的
      ui: /\b(label|desc|id|name)\s*:\s*$/.test(head)
        || /console\.\w+\(|new Error\(/.test(head),
    });
  }
  return out;
}

export function check() {
  const problems = [];
  for (const file of sources(['.js'])) {
    const name = rel(file);
    if (!FILES.test(name) && !EXTRA.has(name)) continue;
    for (const lit of literals(stripComments(read(file)))) {
      if (ALLOW.has(lit.key)) continue;

      if (ENGLISH.has(name) && !lit.ui) {
        const hit = stripProtocol(lit.text).match(HAN_RUN);
        if (hit) {
          problems.push(`${name}:${lit.line}  prompt 正文要写英文：…${hit[0]}…`);
          continue;
        }
      }

      // 「」里引着的是被举例、被禁止的原话，本来就该是口语，不算违规
      const body = lit.text.replace(/「[^」\n]*」/gu, '「」');
      for (const [re, why, mode] of RULES) {
        const hit = (mode === 'noJson' ? stripJson(body) : body).match(re);
        if (!hit) continue;
        const at = body.indexOf(hit[0]);
        problems.push(`${name}:${lit.line}  ${why}：…${body.slice(Math.max(0, at - 12), at + 14).replace(/\n/g, ' ')}…`);
        break;
      }
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('提示词是书面语', check()));
}

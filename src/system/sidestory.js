// 番外生成器：标签、语义词典、本地编译。见 ARCHITECTURE 4.247
//
// 移植自用户自己的番外生成器（fanwai 仓库）。它不是故事生成器，是「提示词编译器」：
// 用户写脑洞、选几个梗，这里把它们整理成一段可以直接交给模型执行的提示词。
// 本地编译不调接口；「AI 整理」「编主线」「批量生成标签」各是一次请求，在 ai/tasks/tools.js。
//
// 抽象标签不原样交给模型（那样容易套刻板人物模板），而是经「语义词典」翻译成行为语言。
// 词典可以改、可以加、可以删，改动存在生成器的设置里（lexicon / lexDeleted）。
//
// 这里的中文是编译产物的内容（交给另一个模型的提示词），不是 Eira 自己的 prompt。

export const OPENING_DEFAULT = '暂停当前剧情，生成一个番外，不计入主线。';
export const OPENING_EXTRA_DEFAULT = '暂时脱离当前主线剧情，生成一个独立番外。本番外不计入主线剧情，不修改、不覆盖、不追加主线事件、人物记忆或关系状态。番外内部可以拥有独立的时间线、背景和剧情发展。番外结束后恢复主线，不将本次番外内容带回主线。';
export const CONTINUE_INSTRUCTION = '继续当前番外，从上一段最后一句无缝续写。不要重复前文，不要重新开始，不要总结。当前正文尚未达到目标篇幅，请继续展开人物互动、对白、场景、情绪与后续事件。';

export const CATEGORIES = [
  { key: 'emotion', name: '情感张力', tags: ['暧昧', '双向暗恋', '单向暗恋', '偷偷喜欢', '克制喜欢', '后知后觉',
    '一方先陷进去', '双方都以为自己单恋', '明明在意却不说', '偷偷偏爱', '只有对方是例外', '意外心动', '差一点错过',
    '终于说开', '关系逐渐失控'] },
  { key: 'relation', name: '关系张力', tags: ['欢喜冤家', '互相嘴硬', '互相试探', '针锋相对', '强强', '反差', '权力差',
    '身份差', '下克上', '主动权反转', '身份反转', '原本处于优势的一方逐渐失去主动权', '原本处于弱势的一方逐渐掌握主动权',
    '表面平静实际暗流涌动'] },
  { key: 'mood', name: '情绪嗑点', tags: ['吃醋', '暗戳戳吃醋', '偷偷关注', '特殊偏爱', '小心翼翼靠近', '嘴上否认行动明显',
    '不自觉依赖', '某个细节暴露真实感情', '被别人一眼看穿', '当事人自己还没意识到'] },
  { key: 'plot', name: '剧情元素', tags: ['偶然相遇', '重逢', '久别重逢', '身份隐藏', '身份暴露', '掉马', '误会',
    '意外听见真心话', '意外发现秘密', '被误认为情侣', '假装情侣', '意外同居', '被迫同行', '一起旅行', '临时搭档',
    '生病照顾', '朋友起哄', '第三方误会', '家庭阻力', '身份冲突', '离别', '再见', '追人', '关系确认'] },
  { key: 'au', name: 'AU 类型', tags: ['现代AU', '古代AU', '校园AU', '职场AU', '娱乐圈AU', '旅行AU', '恋综AU', '家庭AU',
    '平行世界', '身份互换', '普通人AU'] },
  { key: 'skit', name: '小剧场类型', tags: ['日常', '节日', '旅行', '聚会', '一起吃饭', '一起工作', '临时任务', '意外事件',
    '双人', '多人', '全员', '群像'] },
];

// 语义翻译层：标签翻译为行为语言
export const LEXICON = [
  ['占有欲', '对对方存在明显的特殊关注，在对方与其他人互动时出现自然的情绪变化，通过行为、语气和细节表现，而不是通过控制对方体现'],
  ['掌控欲', '角色习惯主动安排事情、掌握局面，在关键情况下表现出行动力和决断力，但不自动解释为控制对方'],
  ['强势', '行动果断、有主见，倾向主动处理事情，通过行动体现力量，而非压迫或命令对方'],
  ['宠溺', '对特定对象表现出比对其他人更多的耐心、偏爱和纵容，通过细节体现特殊待遇'],
  ['保护欲', '当对方需要帮助时自然站出来，主动提供支持，但不因此削弱对方的能力或自主性'],
  ['高冷', '对大多数人保持距离、情绪表达克制，但面对特定对象时逐渐出现自然的例外'],
  ['权力差', '两人社会位置存在明显差距，让身份差异影响互动处境、语言和选择，但不将社会地位等同于人格高低'],
  ['下克上', '让关系中的主动权逐渐发生变化，使原本处于优势的一方逐渐受到另一方影响'],
  ['吃醋', '察觉对方与其他人产生亲近互动时，出现细微的不自在、注意力变化、语气变化或异常反应，从行为中体现而非直接解释情绪'],
  ['暗戳戳吃醋', '情绪只通过细微动作、语气停顿、话题转移或不合常理的小举动流露，角色不会承认，也不会直接说出自己的感受'],
  ['暧昧', '两人之间存在尚未定义的亲近感，通过停留过久的注视、未说完的话、恰好的距离与犹豫来体现，任何一方都没有明确表态'],
  ['双向暗恋', '两个人都对彼此有超出普通关系的在意，但都认为对方没有相同的心意，各自把情绪藏起来'],
  ['单向暗恋', '其中一方持续关注对方并压抑自己的情绪，另一方并未察觉，互动中体现出信息不对等'],
  ['偷偷喜欢', '喜欢的情绪没有被说出口，只在无人注意的细节里出现，例如记住对方的习惯、目光跟随、不自觉的迁就'],
  ['克制喜欢', '角色清楚自己的感情，但因为处境、身份或性格主动压抑，表现为该靠近时停下、话到嘴边改口'],
  ['后知后觉', '角色的感情在行为上早已显露，但自己直到某个具体事件才意识到，之前的所有反应都可以被重新解读'],
  ['欢喜冤家', '两人习惯用互相拆台、斗嘴和挑衅的方式互动，但行为上仍会为对方留余地'],
  ['互相嘴硬', '双方都不愿意先示弱或承认在意，用否认、反驳、转移话题来掩盖真实反应，但行动与话语相反'],
  ['针锋相对', '对话与行动中存在持续的较劲和试探，气氛紧绷但双方都不退，冲突集中在具体事件而非人身攻击'],
  ['反差', '角色在不同场合表现出明显不同的一面，这种差异只有特定的人才能看见'],
  ['身份差', '两人的社会身份、处境或所属圈子不同，这种差异带来现实层面的阻力与互动上的错位感'],
  ['主动权反转', '关系中原本占据主动的一方逐渐失去掌控，另一方的影响力逐步上升，变化通过具体事件推进'],
  ['表面平静实际暗流涌动', '表面互动礼貌克制、看似正常，但对话之下存在未说破的情绪和张力'],
  ['偷偷关注', '角色会留意对方的状态与变化，但不会让对方发现，也不会承认'],
  ['特殊偏爱', '对某个人的标准与对其他人明显不同，这种差别待遇是通过具体行为体现的'],
  ['小心翼翼靠近', '靠近对方时反复衡量分寸，害怕越界，动作与语言都带有试探性'],
  ['嘴上否认行动明显', '语言上否认在意，行为上却持续付出与迁就，两者形成明确落差'],
  ['不自觉依赖', '角色在不知不觉中习惯了对方的存在，在对方不在时才显露出不适应'],
  ['某个细节暴露真实感情', '让一个具体的小细节成为情绪的证据，例如一个动作、一件物品、一句无意的话'],
  ['被别人一眼看穿', '由第三方角色点破两人之间的异常，当事人否认或回避'],
  ['当事人自己还没意识到', '角色的行为已经明显偏向对方，但角色本人给出的是别的解释'],
  ['误会', '因为信息缺失或错误理解产生偏差，误会有明确的成因和可被解开的路径，不靠角色降智推动'],
  ['意外听见真心话', '角色在非计划的情况下听到对方未准备让其听见的内容，并因此改变认知'],
  ['假装情侣', '两人因为外部原因需要扮演亲密关系，在扮演中出现真实反应，界线逐渐模糊'],
  ['意外同居', '因客观原因共处同一生活空间，通过生活细节与作息摩擦推进关系'],
  ['生病照顾', '一方处于虚弱状态，另一方的照顾行为暴露出平时被掩盖的在意'],
  ['久别重逢', '分开一段时间后重新相遇，双方都发生了变化，需要重新确认彼此的位置与距离'],
  ['掉马', '被隐藏的身份或秘密被对方知晓，重点写知晓瞬间与之后的关系变化'],
  ['群像', '多个角色共同承担叙事，关系网而非单一关系推动剧情，每个角色都有自己的目的与反应'],
  ['慢热', '情绪与关系推进缓慢，靠日常积累和细节堆叠，不使用突发事件强行加速'],
  ['甜', '互动整体轻松愉快，情绪走向正向，冲突不构成实质威胁'],
  ['酸', '存在遗憾、错过或求而不得的情绪底色，即使有温柔的部分也带着不完满'],
  ['宿命', '两人的关系被更大的处境或时间牵引，重逢与分离都带有必然感'],
  ['烟火气', '大量具体的生活细节：食物、家务、路过的人、季节的气味，让场景有真实的质感'],
  ['留白', '不把所有情绪与结果说尽，允许对话中断、场景收束在未完成处'],
  ['治愈', '人物在互动中获得情绪上的修复，节奏舒缓，冲突以理解和陪伴化解'],
];

export const SLIDERS = [
  { key: 'power', name: '权力差', min: '无', max: '极强', value: 0 },
  { key: 'ambiguous', name: '暧昧程度', min: '低', max: '极高', value: 0 },
  { key: 'jealous', name: '吃醋程度', min: '轻微', max: '明显', value: 0 },
  { key: 'tension', name: '情绪拉扯', min: '轻松', max: '强烈', value: 0 },
  { key: 'contrast', name: '反差', min: '低', max: '极高', value: 0 },
  { key: 'initiative', name: '主动权', min: 'CHAR', max: 'USER', value: 50 },
  { key: 'status', name: '身份差', min: '无', max: '巨大', value: 0 },
  { key: 'change', name: '关系变化', min: '稳定', max: '剧烈反转', value: 0 },
];
export const NARRATIVE_SLIDERS = [
  { key: 'pace', name: '节奏', min: '慢', max: '快', value: 50 },
  { key: 'dialogue', name: '对话密度', min: '低', max: '高', value: 50 },
  { key: 'literary', name: '文学密度', min: '低', max: '高', value: 50 },
  { key: 'emotion', name: '情绪表达', min: '直接', max: '克制', value: 50 },
  { key: 'describe', name: '描写比例', min: '对白为主', max: '描写为主', value: 50 },
  { key: 'scale', name: '世界规模', min: '两个人', max: '整个世界', value: 0 },
];

const SLIDER_TEXT = {
  power: { low: '两人处在基本平等的位置上，没有明显的权力落差。',
    mid: '两人之间存在可以被感觉到的权力差距，它会影响说话的方式、请求的分量和可选择的余地。',
    high: '两人之间的权力差距很明显，身份位置会直接影响处境、语言和每个选择的代价；但不要把社会位置等同于人格高低，也不要让位置较低的一方失去判断力与主体性。' },
  ambiguous: { low: '两人的关系边界比较清楚，暧昧感很淡。',
    mid: '两人之间存在没有被说破的亲近感，偶尔出现越过普通关系的瞬间，随后又被自然带过。',
    high: '几乎每一次互动都带着未被定义的张力：停留过久的注视、被自己打断的句子、恰好过近的距离，双方都察觉得到，但谁都不点破。' },
  jealous: { low: '不适感只是一闪而过，几乎不影响行为。',
    mid: '当对方与他人亲近时，会出现细微的不自在、注意力偏移或语气变化，角色本人不会承认。',
    high: '对方与别人的亲近互动会明显改变角色的状态：语气、动作节奏、话题选择都会变化。全部通过行为与细节体现，不要让角色直接说明自己在吃醋。' },
  tension: { low: '整体情绪松弛，冲突不构成真正的压力。', mid: '情绪有明显起伏和拉扯，但仍在可控范围内。',
    high: '情绪拉扯强烈，靠近与退开反复发生，每一次互动都在改变两人之间的距离。' },
  contrast: { low: '角色在不同场合的表现基本一致。', mid: '角色在特定的人面前会露出与平时不同的一面。',
    high: '角色对外的样子与面对特定对象时的样子差别很大，这种落差本身即是重点，请用具体行为呈现，不要用叙述解释。' },
  status: { low: '两人的身份处境接近，没有明显落差。', mid: '两人的身份存在差距，会带来一些现实层面的不便与错位。',
    high: '两人的身份差距巨大，会带来现实阻力、外部目光和选择上的代价，这些代价要落在具体事件里。' },
  change: { low: '关系状态在番外中保持相对稳定，变化体现在细节而不是结构上。', mid: '关系在番外过程中发生可以感知的推进或位移。',
    high: '关系在番外中发生明显反转，结尾时两人的位置与开头不同，转折必须有具体事件支撑，不要突然改变。' },
};
const NARRATIVE_TEXT = {
  pace: { low: '叙事节奏放慢，允许停顿、沉默和无事发生的段落，让情绪在细节里积累。', mid: '叙事节奏适中，场景推进与停顿交替。',
    high: '叙事节奏偏快，场景切换紧凑，减少铺垫性描写，但不要用总结替代情节。' },
  dialogue: { low: '对白使用克制，更多依靠动作、场景与心理活动推进。', mid: '对白与描写大致均衡。',
    high: '大量使用对白推进剧情，让性格与关系在你来我往的语言里显形。' },
  literary: { low: '语言平实自然，不追求修辞。', mid: '语言有一定质感，但不堆砌辞藻。',
    high: '语言密度高，注重意象、节奏与句式变化，但不要为了文学感牺牲可读性和人物真实感。' },
  emotion: { low: '情绪表达直接，角色会说出自己的感受。', mid: '情绪表达有直有藏。',
    high: '情绪表达高度克制，重要的感受不直说，通过动作、停顿、回避和细节泄露出来。' },
  describe: { low: '以对白为主，描写作为支撑。', mid: '对白与描写比例均衡。', high: '以描写为主，用环境、动作和感官细节承担叙事。' },
  scale: { low: '故事范围收在两个人之间，外部世界只是背景。', mid: '故事以两人为中心，同时让周围的人和环境产生影响。',
    high: '故事涉及更大的环境与更多人物，个人关系被放在更大的处境里推进。' },
};

export const ROLE_QUESTIONS = [
  { key: 'initiator', label: '谁更主动' },
  { key: 'firstLove', label: '谁先动心' },
  { key: 'jealousOne', label: '谁更容易吃醋' },
  { key: 'softOne', label: '谁更容易心软' },
  { key: 'inControl', label: '谁掌握当前主动权' },
];
export const ROLE_OPTIONS = ['未指定', 'A', 'B', '双方'];

export const OPT = {
  gender: ['未指定', '男', '女', '非二元'],
  orientation: ['未指定', '异性恋', '同性恋', '双性恋', '泛性恋', '无明确设定'],
  age: ['未指定', '青少年', '成年', '中年'],
  identity: ['未指定', '普通人', '贵族', '皇族', '权贵', '上司', '老板', '员工', '学生', '教师', '医生', '军人', '艺术家', '明星', '江湖人士'],
  personality: ['冷静', '温柔', '克制', '毒舌', '腹黑', '嘴硬', '直球', '慢热', '散漫', '理性', '活泼', '成熟'],
  relation: ['未指定', '初识', '陌生人', '熟人', '朋友', '同事', '搭档', '欢喜冤家', '死对头', '暧昧', '双向暗恋', '单向暗恋', '恋人', '已婚', '前任', '久别重逢'],
  era: ['未指定', '古代', '架空古代', '中世纪', '近代', '民国', '20世纪', '现代', '未来', '架空历史'],
  world: ['未指定', '现实', '架空', '武侠', '东方幻想', '西方奇幻', '志怪', '神话', '科幻', '赛博朋克', '蒸汽朋克', '超自然', '末世'],
  social: ['未指定', '贵族与平民', '权贵与普通人', '皇族与平民', '上司与下属', '老板与员工', '名人与普通人', '大人物与小人物', '城市与小镇', '城市与乡村', '江湖高手与普通人'],
  scene: ['城市', '小镇', '乡村', '庄园', '校园', '公司', '咖啡店', '酒馆', '海边', '山里', '旅馆', '火车', '公路', '异国', '家里', '集市'],
  screen: ['文艺爱情片', '青春电影', '公路电影', '浪漫喜剧', '黑色喜剧', '历史电影', '古装剧', '年代剧', '群像剧', '独立电影', '生活流', '悬疑', '奇幻'],
  vibe: ['甜', '酸', '酸甜', '暧昧', '轻松', '搞笑', '温柔', '克制', '浪漫', '孤独', '治愈', '宿命', '戏剧', '荒诞', '日常', '烟火气', '梦幻', '现实感'],
  pov: ['未指定', '第一人称', '第三人称', '双视角', '多视角', 'CHAR视角', 'USER视角', '全知视角', '群像'],
  style: ['生活流', '电影感', '文学感', '轻小说感', '慢热', '快节奏', '留白', '对话驱动', '心理描写', '细节驱动'],
  infoGap: ['未指定', 'A知道B不知道', 'B知道A不知道', '双方都不知道', '双方都有误解', '读者知道角色不知道', '没有明显信息差'],
  season: ['未指定', '春', '夏', '秋', '冬'],
  time: ['未指定', '清晨', '白天', '黄昏', '深夜'],
  weather: ['未指定', '晴', '阴', '雨', '雪', '雾'],
  tone: ['未指定', '黑白', '灰调', '暖色', '冷色', '奶油色', '棕褐', '暮蓝', '低饱和', '高饱和'],
  ending: ['未指定', 'HE', '温柔收尾', '酸甜', '开放式', '留白', '意外反转', '久别重逢', '终于说开', '圆满'],
  hooks: ['小误会', '意外事件', '配角反应或介入', '场景变化', '小伏笔', '情绪节点', '关系变化'],
  hookLevel: ['轻', '中', '大胆'],
  charMode: [
    { v: 'unspecified', t: '不指定' },
    { v: 'single', t: '单角色' },
    { v: 'dual', t: '双角色' },
    { v: 'multi', t: '多角色' },
    { v: 'group', t: '群像' },
  ],
  lengthTarget: ['不限', '3000', '5000', '8000', '10000', '15000', '20000'],
  compileLevel: [
    { v: 'raw', t: '原汁原味', d: '几乎不改写，只做最小整理' },
    { v: 'polish', t: '轻度润色', d: '整理表达、补齐执行细节' },
    { v: 'deep', t: '深度细化', d: '把标签展开成具体行为与场景要求' },
    { v: 'bold', t: '大胆扩展', d: '在不改核心的前提下补充钩子与层次' },
  ],
};

// 方向相反的标签。编译前提示，由用户决定，不自动处理
export const CONFLICT_PAIRS = [
  ['克制喜欢', '直球'], ['暗戳戳吃醋', '嘴上否认行动明显'], ['慢热', '快节奏'], ['单向暗恋', '双向暗恋'],
  ['初识', '已婚'], ['陌生人', '恋人'], ['轻松', '宿命'], ['搞笑', '孤独'], ['日常', '末世'], ['留白', '对话驱动'],
  ['当事人自己还没意识到', '终于说开'], ['身份隐藏', '身份暴露'], ['强强', '权力差'],
];
export const RELATED_TAGS = {
  吃醋: ['暗戳戳吃醋', '克制喜欢', '嘴上否认行动明显', '特殊偏爱'],
  暧昧: ['双向暗恋', '小心翼翼靠近', '明明在意却不说', '留白'],
  下克上: ['主动权反转', '权力差', '表面平静实际暗流涌动'],
  权力差: ['身份差', '下克上', '身份冲突'],
  欢喜冤家: ['互相嘴硬', '针锋相对', '嘴上否认行动明显'],
  假装情侣: ['被误认为情侣', '意外同居', '朋友起哄'],
  久别重逢: ['终于说开', '关系确认'],
  群像: ['全员', '多人', '聚会', '一起工作'],
  误会: ['意外听见真心话', '第三方误会', '差一点错过'],
  身份隐藏: ['掉马', '身份暴露', '身份冲突'],
  双向暗恋: ['双方都以为自己单恋', '明明在意却不说', '后知后觉'],
  生病照顾: ['不自觉依赖', '特殊偏爱', '小心翼翼靠近'],
};

// ---- 一篇番外的设置（生成器里用户填的全部）----

const person = () => ({ name: '', gender: '未指定', orientation: '未指定', age: '未指定', identity: '未指定',
  job: '', social: '', personality: [], temperament: '', extra: '' });

export function blankStory() {
  return {
    title: '', brainDump: '',
    tags: {}, customTags: {},
    characters: { mode: 'unspecified', char: person(), user: person(), others: [] },
    relationship: { current: '未指定', currentCustom: '', sliders: {}, roles: {} },
    world: { era: '未指定', eraCustom: '', type: '未指定', typeCustom: '', social: '未指定', socialCustom: '',
      charIdentity: '', userIdentity: '', scenes: [], sceneCustom: '', literary: '', screen: [], screenFeel: '' },
    narrative: { sliders: {}, pov: '未指定', povCustom: '', styles: [], infoGap: '未指定', infoGapCustom: '' },
    vibe: { moods: [], custom: '' },
    visual: { season: '未指定', time: '未指定', weather: '未指定', tone: '未指定', custom: '' },
    ending: '未指定', endingCustom: '',
    extra: { on: false, hooks: [], custom: '', level: '轻' },
    refuse: '',
    length: { target: '不限', custom: '', strict: false, segmented: false, countOutput: false },
    opening: OPENING_DEFAULT, openingExtraOn: false, openingExtra: OPENING_EXTRA_DEFAULT,
    head: '', tail: '', promptStyle: 'natural', compileLevel: 'polish',
  };
}

const trim = v => String(v == null ? '' : v).trim();
const nonEmpty = arr => (arr || []).map(trim).filter(Boolean);
const uniq = arr => [...new Set(arr)];
const val = v => { const t = trim(v); return (!t || t === '未指定') ? '' : t; };
const orCustom = (v, custom) => val(custom) || val(v);
const splitList = s => String(s || '').split(/[,，、;；\n]/).map(trim).filter(Boolean);
const band = v => (v < 34 ? 'low' : (v > 66 ? 'high' : 'mid'));
const joinSentences = (list, sep = '；') => { const out = nonEmpty(list); return out.length ? `${out.join(sep)}。` : ''; };

export function tagList(s) {
  const out = [];
  Object.values(s.tags || {}).forEach(list => (list || []).forEach(t => out.push(t)));
  return uniq(out.map(trim).filter(Boolean));
}

/** 词典：默认那一份，叠上用户改过、加过、删过的 */
export function lexMap(lex = {}, deleted = []) {
  const m = new Map(LEXICON.filter(([t]) => !deleted.includes(t)));
  Object.entries(lex || {}).forEach(([t, v]) => { if (trim(v)) m.set(t, trim(v)); });
  return m;
}

export function translateTags(s, lex) {
  const tags = tagList(s);
  const translated = [];
  const plain = [];
  tags.forEach(t => { const m = lex.get(t); if (m) translated.push({ tag: t, text: m }); else plain.push(t); });
  return { translated, plain, tags };
}

const nameA = s => trim(s.characters.char.name) || 'CHAR';
const nameB = s => trim(s.characters.user.name) || 'USER';
const roleName = (s, v) => (v === 'A' ? nameA(s) : v === 'B' ? nameB(s) : v === '双方' ? '双方' : '');

function slidersText(defs, cfgs, texts, s, withInitiative) {
  const lines = [];
  defs.forEach(d => {
    const cfg = (cfgs || {})[d.key];
    if (!cfg || !cfg.on) return;
    const v = typeof cfg.value === 'number' ? cfg.value : d.value;
    if (withInitiative && d.key === 'initiative') {
      const who = v < 35 ? nameA(s) : (v > 65 ? nameB(s) : null);
      lines.push(who ? `关系里的主动权更多在${who}一侧` : '两人的主动权大致均衡');
      return;
    }
    const t = texts[d.key];
    if (t) lines.push(t[band(v)].replace(/。$/, ''));
  });
  return lines;
}

function personProse(label, p) {
  const bits = [];
  const nm = val(p.name);
  const who = nm ? `${nm}（${label}）` : label;
  const id = [val(p.identity), val(p.job)].filter(Boolean).join('、');
  const base = [];
  if (val(p.gender)) base.push(`${val(p.gender)}性`);
  if (val(p.age)) base.push(val(p.age));
  if (id) base.push(id);
  if (base.length) bits.push(`${who}是${base.join('、')}`);
  const per = nonEmpty(p.personality);
  const tem = val(p.temperament);
  if (per.length || tem) bits.push(`${bits.length ? '' : who}性格${[per.join('、'), tem].filter(Boolean).join('、')}`);
  if (val(p.social)) bits.push(`${bits.length ? '' : who}的社会位置是${val(p.social)}`);
  if (val(p.orientation)) bits.push(`${bits.length ? '' : who}性取向${val(p.orientation)}，不要中途改变`);
  if (val(p.extra)) bits.push(val(p.extra));
  if (bits.length) return { text: bits.join('，'), rich: true };
  return nm ? { text: `${label} 是${nm}`, rich: false } : { text: '', rich: false };
}

function proseCharacters(s) {
  const c = s.characters;
  const lines = [];
  if (c.mode === 'group') lines.push('这是一篇群像，多个角色一起承担剧情，不要把重心压到某一对关系上');
  else if (c.mode === 'multi') lines.push('出场角色不止两个，每个人都要有自己的目的和反应');
  const a = personProse('CHAR', c.char);
  const b = personProse('USER', c.user);
  let rich = a.rich || b.rich;
  if (a.text) lines.push(a.text);
  if (b.text) lines.push(b.text);
  (c.others || []).forEach(o => {
    const bits = [val(o.identity), val(o.relation), val(o.extra)].filter(Boolean);
    if (val(o.name)) { lines.push(val(o.name) + (bits.length ? `：${bits.join('，')}` : ' 也会出场')); rich = rich || bits.length > 0; }
  });
  if (!lines.length) return '';
  if (rich) lines.push('没有写到的部分保持未知，不要根据性别、身份或职业替角色补充性格和能力');
  return joinSentences(lines);
}

function proseWorld(s) {
  const w = s.world;
  const lines = [];
  const era = orCustom(w.era, w.eraCustom);
  const wt = orCustom(w.type, w.typeCustom);
  if (era || wt) lines.push(`背景设定在${[era, wt].filter(Boolean).join('的')}`);
  const so = orCustom(w.social, w.socialCustom);
  if (so) lines.push(`两人之间存在${so}这样的身份差距`);
  if (val(w.charIdentity)) lines.push(`CHAR 的身份是${val(w.charIdentity)}`);
  if (val(w.userIdentity)) lines.push(`USER 的身份是${val(w.userIdentity)}`);
  const sc = uniq(nonEmpty(w.scenes).concat(splitList(w.sceneCustom)));
  if (sc.length) lines.push(`场景可以放在${sc.join('、')}`);
  const lit = splitList(w.literary);
  if (lit.length) lines.push(`气质上参考${lit.join('、')}的时代感、人物张力与叙事节奏，但不要复制原作的剧情和人物`);
  const scr = nonEmpty(w.screen);
  if (scr.length) lines.push(`节奏和画面参考${scr.join('、')}的感觉`);
  if (val(w.screenFeel)) lines.push(`整体想要的感觉是${val(w.screenFeel)}`);
  return joinSentences(lines);
}

function proseRelationship(s) {
  const r = s.relationship;
  const lines = [];
  const cur = orCustom(r.current, r.currentCustom);
  if (cur) lines.push(`两人现在的关系是${cur}，番外从这个状态开始`);
  lines.push(...slidersText(SLIDERS, r.sliders, SLIDER_TEXT, s, true));
  ROLE_QUESTIONS.forEach(q => { const n = roleName(s, (r.roles || {})[q.key]); if (n) lines.push(`${q.label}是${n}`); });
  return joinSentences(lines);
}

function proseTags(s, lex) {
  const { translated, plain } = translateTags(s, lex);
  if (!translated.length && !plain.length) return '';
  const chunks = [];
  for (let i = 0; i < translated.length; i += 3) chunks.push(joinSentences(translated.slice(i, i + 3).map(t => t.text)));
  if (plain.length) chunks.push(`另外让这些方向存在于故事里：${plain.join('、')}。`);
  return (translated.length ? '这一篇要抓住的感觉：\n' : '') + chunks.join('\n');
}

function proseNarrative(s) {
  const n = s.narrative;
  const lines = [...slidersText(NARRATIVE_SLIDERS, n.sliders, NARRATIVE_TEXT, s, false)];
  const pov = orCustom(n.pov, n.povCustom);
  if (pov) lines.push(`用${pov}来写`);
  const st = nonEmpty(n.styles);
  if (st.length) lines.push(`风格偏${st.join('、')}`);
  const ig = orCustom(n.infoGap, n.infoGapCustom);
  if (ig && ig !== '没有明显信息差') lines.push(`信息差是${ig}，让它影响人物的判断和对话，不要靠旁白解释`);
  const moods = uniq(nonEmpty(s.vibe.moods).concat(splitList(s.vibe.custom)));
  if (moods.length) lines.push(`整体氛围偏${moods.join('、')}`);
  const v = s.visual;
  const vb = [val(v.season), val(v.time), val(v.weather), val(v.tone) ? `${val(v.tone)}的色调` : '', val(v.custom)].filter(Boolean);
  if (vb.length) lines.push(`画面基调是${vb.join('、')}`);
  const e = orCustom(s.ending, s.endingCustom);
  if (e) lines.push(`结局倾向${e}，但要由剧情自然导向，不要为了收尾强行转折`);
  const x = s.extra;
  if (x && x.on) {
    const hooks = uniq(nonEmpty(x.hooks).concat(splitList(x.custom)));
    const lv = x.level || '轻';
    lines.push(`可以加入${hooks.length ? hooks.join('、') : '不破坏走向的小意外'}${lv === '轻' ? '，幅度小，只作点缀' : lv === '中' ? '，可以形成一个小转折' : '，可以大胆一些'}`);
  }
  return joinSentences(lines);
}

function proseLength(s) {
  const L = s.length || {};
  const target = trim(L.custom) || (L.target && L.target !== '不限' ? L.target : '');
  const lines = [];
  if (target) {
    let main = `请以此展开写一篇番外，不少于${target}字`;
    if (L.strict) main += '，把这个字数当成最低线，未达到之前不要收尾，不要用总结或跳时间压缩剧情，也不要虚报字数';
    lines.push(main);
  } else if (L.strict) lines.push('内容要写足，不要用总结或跳时间压缩剧情，也不要提前收尾');
  if (L.segmented) lines.push('一次写不完时，停在自然的场景断点，下次从上一句无缝接着写');
  if (L.countOutput) lines.push('正文写完后另起一行输出【输出总字数：XXXX字】，数字按实际写出的正文统计，不要估算或虚报');
  return joinSentences(lines);
}

function refuseList(s) { return splitList(String(s.refuse || '').replace(/\n/g, '、')); }

function proseRules(s) {
  const lines = ['这段番外不计入主线，不要修改主线的事件、人物记忆和关系状态',
    '保持角色原本的人格、说话方式和行为逻辑，不要为了剧情让人物 OOC',
    '没有明确给出的信息不要写成固定事实'];
  if (refuseList(s).length) lines.push(`另外这些内容绝对不要出现：${refuseList(s).join('、')}`);
  return joinSentences(lines);
}

function block(title, lines) {
  const body = nonEmpty(Array.isArray(lines) ? lines : [lines]);
  return body.length ? `【${title}】\n${body.join('\n')}` : '';
}

// 分区块形态：同样的信息分块列出
function structuredParts(s, lex) {
  const out = [];
  if (trim(s.brainDump)) out.push(block('我这次想看的', [trim(s.brainDump),
    '这是本次番外最重要的部分，优先级高于其他所有标签与设定。可以扩展细节、补充过程，但不要改变它的核心意图。']));
  out.push(block('人物', proseCharacters(s)));
  out.push(block('世界与场景', proseWorld(s)));
  out.push(block('关系与情绪', proseRelationship(s)));
  const { translated, plain } = translateTags(s, lex);
  if (translated.length || plain.length) {
    out.push(block('这次番外要抓住的感觉', [...translated.map(t => `· ${t.text}`),
      plain.length ? `· 另外请让这些方向存在于故事里：${plain.join('、')}。把它们理解为整体氛围与走向，而不是需要逐项完成的条目。` : '',
      '以上是整体创作方向，不是任务清单。不要逐条点名、不要在正文里复述这些描述。']));
  }
  out.push(block('叙事要求', proseNarrative(s)));
  out.push(block('篇幅要求', proseLength(s)));
  out.push(block('番外执行规则', proseRules(s)));
  out.push(block('输出要求', ['直接开始写番外正文。不要复述上面的设定，不要输出创作分析或剧情大纲，不要把要求逐项打卡。']));
  return out.filter(Boolean);
}

/**
 * 本地编译：整段提示词。不调接口。
 * 自然段落：像自己手写要求那样连成几段；分区块：人物、关系、叙事、篇幅分块列出。
 */
export function compile(s, lex) {
  const opening = [trim(s.opening), s.openingExtraOn ? trim(s.openingExtra) : ''].filter(Boolean).join('\n');
  let mid;
  if (s.promptStyle === 'structured') {
    mid = structuredParts(s, lex).join('\n\n');
  } else {
    mid = [trim(s.brainDump), proseCharacters(s), proseWorld(s), proseRelationship(s), proseTags(s, lex),
      proseNarrative(s), proseLength(s), proseRules(s),
      joinSentences(['直接开始正文，不要复述以上要求，不要写分析或大纲，也不要逐条打卡'])].filter(Boolean).join('\n');
  }
  return [trim(s.head), opening, mid, trim(s.tail)].filter(Boolean).join(s.promptStyle === 'structured' ? '\n\n' : '\n')
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
}

/** 交给「AI 整理」「编主线」的材料：用户选了什么，一样一样列出来 */
export function material(s, lex) {
  const { translated, plain } = translateTags(s, lex);
  return [
    trim(s.title) ? `标题：${trim(s.title)}` : '',
    trim(s.brainDump) ? `脑洞（最重要）：\n${trim(s.brainDump)}` : '脑洞：未填写',
    translated.length || plain.length ? `梗与感觉：\n${[...translated.map(t => `- ${t.tag}：${t.text}`), ...plain.map(t => `- ${t}`)].join('\n')}` : '',
    proseCharacters(s) ? `人物：${proseCharacters(s)}` : '',
    proseWorld(s) ? `世界与场景：${proseWorld(s)}` : '',
    proseRelationship(s) ? `关系：${proseRelationship(s)}` : '',
    proseNarrative(s) ? `叙事与氛围：${proseNarrative(s)}` : '',
    proseLength(s) ? `篇幅：${proseLength(s)}` : '',
    refuseList(s).length ? `绝对不要出现：${refuseList(s).join('、')}` : '',
  ].filter(Boolean).join('\n\n');
}

/** 本地给出的「理解」与「方向」两段，不调接口 */
export function understanding(s, lex) {
  const { translated, plain, tags } = translateTags(s, lex);
  const L = [];
  const raw = trim(s.brainDump);
  L.push(raw ? `想看的是：${raw.replace(/\s+/g, ' ').slice(0, 300)}${raw.length > 300 ? '…' : ''}` : '没有填写具体脑洞，这一次以标签与设定为主要方向。');
  if (tags.length) L.push(`选中的嗑点：${tags.join('、')}。`);
  if (translated.length) L.push(`其中 ${translated.length} 个已翻译为可执行的行为要求。`);
  if (plain.length) L.push(`以下标签没有词典条目，作为整体方向交给模型：${plain.join('、')}。可在「语义词典」中补充翻译。`);
  return L.join('\n');
}

export function conflicts(s) {
  const all = [...tagList(s), orCustom(s.relationship.current, s.relationship.currentCustom),
    ...nonEmpty(s.narrative.styles), ...nonEmpty(s.vibe.moods)].filter(Boolean);
  return CONFLICT_PAIRS.filter(([a, b]) => all.includes(a) && all.includes(b));
}

export function related(s, known) {
  const tags = tagList(s);
  const pool = [];
  tags.forEach(t => (RELATED_TAGS[t] || []).forEach(r => { if (!tags.includes(r)) pool.push(r); }));
  return uniq(pool).filter(t => !known || known.has(t)).slice(0, 8);
}

/** 篇幅检测：一段正文的字数 */
export function countText(text) {
  const t = String(text || '');
  return {
    chars: Array.from(t).length,
    noSpace: Array.from(t.replace(/\s/g, '')).length,
    cn: (t.match(/[一-鿿㐀-䶿]/g) || []).length,
    paragraphs: t.split(/\n\s*\n/).filter(x => trim(x)).length,
  };
}

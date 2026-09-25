// 衣帽间的分类表。**只有这一份**：界面、识图、上下文都从这里读。见 ARCHITECTURE 4.213
//
// 三层：大类、小类、单品。每件东西必须落在一个大类的一个小类里，这一层决定它「放在哪」。
// 颜色、季节、场合、来源、状态是横切的标签，只用来筛选，不决定位置。
//
// 妆台的小类另带三样默认值，填的时候不必从零算：
//   unit   每次用量的单位（泵、喷……），换算成毫升见 DOSE
//   pao    开封后能用几个月（包装上那个开盖小图标里的「12M」），0 为不算
//   shade  主要记色号（眼影、口红），不算余量也照样能记
// 工具一类不算余量（没有 unit）。

export const SIDES = [
  { id: 'wear', label: '衣橱' },
  { id: 'beauty', label: '妆台' },
];

const w = labels => labels.map(label => ({ label }));

export const GROUPS = [
  // ---- 衣橱 ----
  { id: 'top', side: 'wear', label: '上装', subs: w(['T 恤', '衬衫', '针织 / 毛衣', '卫衣', '背心 / 吊带']) },
  { id: 'bottom', side: 'wear', label: '下装', subs: w(['长裤', '牛仔裤', '半身裙', '短裤']) },
  { id: 'onepiece', side: 'wear', label: '连身', subs: w(['连衣裙', '连体裤', '套装']) },
  { id: 'outer', side: 'wear', label: '外套', subs: w(['大衣', '风衣', '夹克', '西装', '羽绒服', '开衫']) },
  { id: 'shoes', side: 'wear', label: '鞋', subs: w(['运动鞋', '靴子', '高跟鞋', '平底 / 乐福', '凉拖']) },
  { id: 'bag', side: 'wear', label: '包', subs: w(['手提', '斜挎', '双肩', '托特', '手拿']) },
  { id: 'jewelry', side: 'wear', label: '首饰', subs: w(['戒指', '项链', '耳饰', '手链 / 手镯', '胸针']) },
  { id: 'acc', side: 'wear', label: '配饰', subs: w(['帽子', '围巾', '领带', '眼镜', '腰带', '发饰', '手表', '袜子']) },
  { id: 'home', side: 'wear', label: '家居', subs: w(['睡衣', '家居服', '贴身']) },
  // 随身：包里带着的小东西。勾上是「今天带着」，不算穿在身上（ARCHITECTURE 4.216）
  { id: 'carry', side: 'wear', label: '随身', subs: w(['伞', '耳机', '相机', '钥匙', '零食', '小物']) },

  // ---- 妆台 ----
  { id: 'skin', side: 'beauty', label: '护肤', subs: [
    { label: '洁面', unit: '克', dose: 1, pao: 12 },
    { label: '化妆水', unit: '毫升', dose: 2, pao: 12 },
    { label: '精华', unit: '滴管', dose: 1, pao: 12 },
    { label: '乳霜', unit: '克', dose: 0.5, pao: 12 },
    { label: '眼霜', unit: '克', dose: 0.1, pao: 6 },
    { label: '防晒', unit: '毫升', dose: 1, pao: 12 },
    { label: '面膜', unit: '片', dose: 1, pao: 0 },
  ] },
  { id: 'base', side: 'beauty', label: '底妆', subs: [
    { label: '妆前', unit: '泵', dose: 1, pao: 12 },
    { label: '粉底', unit: '泵', dose: 2, pao: 12 },
    { label: '遮瑕', unit: '克', dose: 0.1, pao: 12 },
    { label: '定妆', unit: '克', dose: 0.2, pao: 24 },
  ] },
  { id: 'eye', side: 'beauty', label: '眼妆', subs: [
    { label: '眼影', shade: true, pao: 24 },
    { label: '眼线', shade: true, pao: 6 },
    { label: '睫毛膏', shade: true, pao: 3 },
    { label: '眉笔', shade: true, pao: 24 },
  ] },
  { id: 'lip', side: 'beauty', label: '唇妆', subs: [
    { label: '口红', shade: true, pao: 18 },
    { label: '唇釉', shade: true, pao: 12 },
    { label: '润唇', pao: 12 },
  ] },
  { id: 'cheek', side: 'beauty', label: '修容', subs: [
    { label: '腮红', shade: true, pao: 24 },
    { label: '高光', shade: true, pao: 24 },
    { label: '修容', shade: true, pao: 24 },
  ] },
  { id: 'scent', side: 'beauty', label: '香氛', subs: [
    { label: '香水', unit: '喷', dose: 2, pao: 36 },
    { label: '香膏', unit: '克', dose: 0.1, pao: 12 },
    { label: '身体乳', unit: '泵', dose: 2, pao: 12 },
  ] },
  { id: 'hair', side: 'beauty', label: '发与身体', subs: [
    { label: '洗护', unit: '泵', dose: 2, pao: 12 },
    { label: '造型', unit: '喷', dose: 3, pao: 24 },
    { label: '身体护理', unit: '泵', dose: 2, pao: 12 },
  ] },
  { id: 'tool', side: 'beauty', label: '工具', subs: w(['刷具', '美妆蛋', '卷发棒']) },
];

/**
 * 每次用量的单位换成毫升（或克，按一比一算）大约是多少。
 * 只是估算的起点，单品页上可以自己改（item.mlPer）。片、次按「一次一个」算。
 */
export const DOSE = {
  泵: 0.25, 滴管: 0.5, 喷: 0.1, 毫升: 1, 克: 1, 片: 1, 次: 1,
};
export const DOSE_UNITS = Object.keys(DOSE);
/** 容量的单位。面膜这种按片数 */
export const CAP_UNITS = ['毫升', '克', '片'];

/** 只有购入日期、没开封时，按这么多个月算未开封的保质期 */
export const SHELF_MONTHS = 36;

// ---- 横切标签 ----

/** 色系。色块的颜色只在这里写一次，页面上走 --sw 变量 */
export const COLORS = [
  { id: 'black', label: '黑', sw: '#1f1f1f' },
  { id: 'white', label: '白', sw: '#f7f7f5' },
  { id: 'gray', label: '灰', sw: '#9a9a9a' },
  { id: 'beige', label: '米', sw: '#e8dcc6' },
  { id: 'brown', label: '棕', sw: '#8a5a3c' },
  { id: 'red', label: '红', sw: '#c73a3a' },
  { id: 'pink', label: '粉', sw: '#eaa6b8' },
  { id: 'orange', label: '橙', sw: '#e58a3c' },
  { id: 'yellow', label: '黄', sw: '#e8c84a' },
  { id: 'green', label: '绿', sw: '#5f9463' },
  { id: 'blue', label: '蓝', sw: '#4a6fa5' },
  { id: 'purple', label: '紫', sw: '#8a6bb0' },
  { id: 'gold', label: '金', sw: '#c9a449' },
  { id: 'silver', label: '银', sw: '#c3c7cc' },
  { id: 'multi', label: '花色', sw: 'linear-gradient(135deg,#e58a3c,#4a6fa5)' },
];
export const SEASONS = [
  { id: 'spring', label: '春' }, { id: 'summer', label: '夏' },
  { id: 'autumn', label: '秋' }, { id: 'winter', label: '冬' },
];
export const OCCASIONS = [
  { id: 'daily', label: '日常' }, { id: 'work', label: '通勤' }, { id: 'date', label: '约会' },
  { id: 'formal', label: '正式' }, { id: 'sport', label: '运动' }, { id: 'home', label: '居家' },
];
/** 来源。「谁送的」「和谁一起做的」另存在 giver / with 上 */
export const SOURCES = [
  { id: 'self', label: '自己买的' },
  { id: 'gift', label: '收到的礼物' },
  { id: 'made', label: '一起做的' },
];
/**
 * 状态。已用完、已送出的东西不删 —— 礼物的那点意义还在 ——
 * 但默认不显示，也不告诉角色（见 closet.live）
 */
export const STATES = [
  { id: '', label: '在用' },
  { id: 'fav', label: '收藏' },
  { id: 'idle', label: '闲置' },
  { id: 'done', label: '已用完' },
  { id: 'gone', label: '已送出' },
];
export const GONE_STATES = new Set(['done', 'gone']);

export const sideOf = id => SIDES.find(s => s.id === id) || SIDES[0];
export const groupOf = id => GROUPS.find(g => g.id === id) || null;
export const labelIn = (list, id) => list.find(x => x.id === id)?.label || '';

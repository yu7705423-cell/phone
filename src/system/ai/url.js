// 接口地址收口。六个模块原先各抄一份「去掉末尾斜杠」，现在只留这一份。
// 留空就用各自的默认端点 —— 默认值由调用方给，这里不替它们记。
export const baseOf = (u, fallback = '') => String(u || '').replace(/\/+$/, '') || fallback;

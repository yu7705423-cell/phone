// 情侣空间几页共用的几个格式化。原先每页各抄一份，改一处漏三处。
const p = n => String(n).padStart(2, '0');

export const ymd = ms => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const ymdhm = ms => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${ymd(ms)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 和 listen.fmt 不是一回事：那个给播放条用，要精确到秒；这里是记录页，到分钟就够
export const hhmm = sec => {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} 小时 ${m} 分钟` : `${m} 分钟`;
};

export const fromDateInput = v => {
  const [y, m, d] = String(v || '').split('-').map(Number);
  return (y && m && d) ? new Date(y, m - 1, d).getTime() : 0;
};

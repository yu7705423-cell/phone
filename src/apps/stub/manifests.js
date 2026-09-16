// 占位应用清单。加一行就多一个可装修的图标。
const STUBS = [
  { id: 'stub-photos',  name: '相册', icon: 'camera' },
  { id: 'stub-music',   name: '音乐', icon: 'music' },
  { id: 'stub-calendar', name: '日历', icon: 'calendar' },
  { id: 'stub-weather', name: '天气', icon: 'cloud' },
  { id: 'stub-clock',   name: '时钟', icon: 'clock' },
  { id: 'stub-notes',   name: '便签', icon: 'notes' },
  { id: 'stub-mail',    name: '邮件', icon: 'mail' },
  { id: 'stub-map',     name: '地图', icon: 'map' },
];

export const stubManifests = STUBS.map(s => ({
  id: s.id,
  name: s.name,
  icon: s.icon,
  stub: true,
  entry: () => import('./App.js').then(m => ({ default: m.makeStub(s.id) })),
  permissions: [],
}));

export const manifest = {
  id: 'theirs',
  name: '角色手机',
  icon: 'phone',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

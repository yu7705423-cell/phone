export const manifest = {
  id: 'settings',
  name: '设置',
  icon: 'settings',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

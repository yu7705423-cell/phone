export const manifest = {
  id: 'music',
  name: '音乐',
  icon: 'music',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

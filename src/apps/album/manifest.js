export const manifest = {
  id: 'album',
  name: '相册',
  icon: 'camera',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

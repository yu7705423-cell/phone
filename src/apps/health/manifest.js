export const manifest = {
  id: 'health',
  name: '健康',
  icon: 'heart',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

export const manifest = {
  id: 'health',
  name: '健康',
  icon: 'pulse',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

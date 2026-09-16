export const manifest = {
  id: 'memory',
  name: '记忆',
  icon: 'brain',
  entry: () => import('./App.js'),
  permissions: ['storage', 'ai'],
};

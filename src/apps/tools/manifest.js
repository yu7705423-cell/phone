export const manifest = {
  id: 'tools',
  name: '工具箱',
  icon: 'tool',
  entry: () => import('./App.js'),
  permissions: ['storage'],
};

export const manifest = {
  id: 'todo',
  name: '待办',
  icon: 'check',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

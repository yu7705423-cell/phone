export const manifest = {
  id: 'contact',
  name: '联系',
  icon: 'users',
  entry: () => import('./App.js'),
  permissions: ['storage'],
};

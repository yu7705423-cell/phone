export const manifest = {
  id: 'travel',
  name: '出行',
  icon: 'compass',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

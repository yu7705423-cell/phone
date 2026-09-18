export const manifest = {
  id: 'bill',
  name: '记账',
  icon: 'wallet',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

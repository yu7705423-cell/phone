export const manifest = {
  id: 'space',
  name: '情侣空间',
  icon: 'heart',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

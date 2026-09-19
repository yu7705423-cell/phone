export const manifest = {
  id: 'theater',
  name: '一起看',
  icon: 'film',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

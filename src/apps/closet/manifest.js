export const manifest = {
  id: 'closet',
  name: '衣帽间',
  icon: 'hanger',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

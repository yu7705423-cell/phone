export const manifest = {
  id: 'daily',
  name: '日常',
  icon: 'sparkle',
  entry: () => import('./App.js'),
  permissions: ['storage', 'ai'],
  showOnHome: true,
};

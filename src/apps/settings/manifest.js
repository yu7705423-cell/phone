export const manifest = {
  id: 'settings',
  name: '设置',
  icon: 'settings',
  accent: 'var(--tile-4)',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

export const manifest = {
  id: 'settings',
  name: '设置',
  icon: 'settings',
  accent: 'var(--a-stone)',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

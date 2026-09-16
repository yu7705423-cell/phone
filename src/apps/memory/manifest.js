export const manifest = {
  id: 'memory',
  name: '记忆',
  icon: 'brain',
  accent: 'var(--tile-2)',
  entry: () => import('./App.js'),
  permissions: ['storage', 'ai'],
};

export const manifest = {
  id: 'memory',
  name: '记忆',
  icon: 'brain',
  accent: 'var(--a-sage)',
  entry: () => import('./App.js'),
  permissions: ['storage', 'ai'],
};

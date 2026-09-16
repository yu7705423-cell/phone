export const manifest = {
  id: 'lorebook',
  name: '世界书',
  icon: 'book',
  accent: 'var(--a-sand)',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  intents: ['pick:lorebook'],
};

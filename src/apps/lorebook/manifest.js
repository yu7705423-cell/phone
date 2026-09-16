export const manifest = {
  id: 'lorebook',
  name: '世界书',
  icon: 'book',
  accent: 'var(--tile-3)',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  intents: ['pick:lorebook'],
};

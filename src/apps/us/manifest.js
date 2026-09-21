export const manifest = {
  id: 'us',
  name: '我们',
  icon: 'book',
  entry: () => import('./App.js'),
  permissions: ['ai', 'storage'],
  intents: ['open:work'],
};

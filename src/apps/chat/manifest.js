export const manifest = {
  id: 'chat',
  name: '聊天',
  icon: 'message',
  accent: 'var(--tile-1)',
  entry: () => import('./App.js'),
  permissions: ['ai', 'storage', 'notify'],
  intents: ['open:chat', 'pick:character'],
};

export const manifest = {
  id: 'chat',
  name: '聊天',
  icon: 'message',
  entry: () => import('./App.js'),
  permissions: ['ai', 'storage', 'notify'],
  intents: ['open:chat', 'pick:character'],
};

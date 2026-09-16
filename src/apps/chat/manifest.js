export const manifest = {
  id: 'chat',
  name: '聊天',
  icon: 'message',
  accent: 'var(--a-slate)',
  entry: () => import('./App.js'),
  permissions: ['ai', 'storage', 'notify'],
  intents: ['open:chat', 'pick:character'],
};

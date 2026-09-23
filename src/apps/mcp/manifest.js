export const manifest = {
  id: 'mcp',
  name: 'MCP',
  icon: 'plug',
  entry: () => import('./App.js'),
  permissions: ['storage'],
  showOnHome: true,
};

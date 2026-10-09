import { createTransitServer } from '../../server/index.js';
const { server } = createTransitServer({
  dbPath: ':memory:',
  allowedOrigins: ['http://127.0.0.1:5184'],
  publicAppUrl: 'http://127.0.0.1:5184/',
  releaseFetcher: async () => new Response(null, { status: 404 }),
});
server.listen(5185, '127.0.0.1');
const stop = () => {
  server.close();
  server.closeAllConnections();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

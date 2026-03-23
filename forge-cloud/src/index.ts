import { buildServer } from './server';
import { config } from './utils/config';

const start = async () => {
  try {
    const server = await buildServer();
    await server.listen({ port: config.PORT, host: '0.0.0.0' });
    server.log.info({ port: config.PORT }, 'Server listening');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();

import app, { clock } from './app';

const port = Number(process.env.SERVER_PORT ?? 4000);

async function startServer(): Promise<void> {
  try {
    await clock.initialize();
    app.listen(port, '0.0.0.0', () => {
      console.log(`CareLoop server listening on port ${port}`);
    });
  } catch (err) {
    console.error('Failed to start CareLoop server:', err);
    process.exit(1);
  }
}

startServer();

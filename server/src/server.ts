import { PrismaClient } from '@prisma/client';
import { createApp } from './app';
import { validateEnv } from './config/env';
import { DatabaseClock } from './core/clock';

async function startServer(): Promise<void> {
  let prisma: PrismaClient | undefined;
  try {
    const env = validateEnv();
    const port = env.SERVER_PORT;
    prisma = new PrismaClient();
    const clock = new DatabaseClock(prisma.systemSetting);
    await clock.initialize();
    const app = createApp({ prisma, clock, env });
    app.listen(port, '0.0.0.0', () => {
      console.log(`CareLoop server listening on port ${port}`);
    });
  } catch (err) {
    console.error('Failed to start CareLoop server:', err);
    await prisma?.$disconnect();
    process.exit(1);
  }
}

startServer();

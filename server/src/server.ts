import { PrismaClient } from '@prisma/client';
import { createApp } from './app';
import { validateEnv } from './config/env';
import { DatabaseClock } from './core/clock';
import { runEscalationSweep } from './modules/escalation/escalationService';

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
      const intervalMs = env.ESCALATION_SWEEP_INTERVAL_MS ?? 60_000;
      if (intervalMs > 0) {
        setInterval(() => {
          void runEscalationSweep({ prisma: prisma!, clock }).then((raised) => {
            if (raised !== null && raised > 0) console.log(`Escalation sweep completed: ${raised} raised.`);
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message.replace(/[\r\n]+/g, ' ') : 'unknown error';
            console.error(`Escalation sweep failed: ${message}`);
          });
        }, intervalMs).unref();
      }
    });
  } catch (err) {
    console.error('Failed to start CareLoop server:', err);
    await prisma?.$disconnect();
    process.exit(1);
  }
}

startServer();

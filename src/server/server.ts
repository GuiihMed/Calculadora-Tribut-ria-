import { buildApp } from './app.js';
import { DadosAbertosRepository } from './db/dados-abertos-repo.js';
import { openOficialDbReadOnly } from './db/oficial-db.js';
import { DEFAULT_WORKSPACE_DB_PATH, WorkspaceStore } from './db/workspace-db.js';
import { FiscalEngineRouter } from './engine/engine-router.js';
import { GeminiOrchestrator } from './gemini/orchestrator.js';
import { createZeroPiiLogger } from './security/zero-pii-logger.js';

async function main(): Promise<void> {
  const logger = createZeroPiiLogger();
  const oficialDb = openOficialDbReadOnly(process.env.RTC_OFICIAL_DB_PATH);
  const repo = new DadosAbertosRepository(oficialDb);
  const store = new WorkspaceStore(process.env.WORKSPACE_DB_PATH ?? DEFAULT_WORKSPACE_DB_PATH);
  const router = new FiscalEngineRouter({ db: oficialDb, repo });
  const orchestrator = new GeminiOrchestrator({ repo, router, store });

  const app = await buildApp({
    db: oficialDb,
    repo,
    store,
    router,
    orchestrator,
    logger,
  });

  const port = Number.parseInt(process.env.PORT ?? '3001', 10);
  const host = process.env.HOST ?? '127.0.0.1';

  const shutdown = async () => {
    try {
      await app.close();
    } finally {
      store.close();
      oficialDb.close();
      process.exit(0);
    }
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await app.listen({ port, host });
  logger.info({
    method: 'STARTUP',
    route: `http://${host}:${port}`,
    status: 200,
  });
}

void main().catch((err) => {
  const logger = createZeroPiiLogger();
  logger.error({
    method: 'STARTUP',
    route: 'server',
    status: 500,
    error_type: err instanceof Error ? err.name : 'StartupError',
  });
  process.exit(1);
});

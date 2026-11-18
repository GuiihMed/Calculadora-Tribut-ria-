import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
import { DadosAbertosRepository } from '../src/server/db/dados-abertos-repo.js';
import { openOficialDbReadOnly } from '../src/server/db/oficial-db.js';
import { WorkspaceStore } from '../src/server/db/workspace-db.js';
import { FiscalEngineRouter } from '../src/server/engine/engine-router.js';
import { GeminiOrchestrator } from '../src/server/gemini/orchestrator.js';
import { createZeroPiiLogger } from '../src/server/security/zero-pii-logger.js';

let appPromise: Promise<FastifyInstance> | null = null;

function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = (async () => {
      const logger = createZeroPiiLogger();
      const oficialDbPath =
        process.env.RTC_OFICIAL_DB_PATH ??
        path.resolve(process.cwd(), 'data', 'rtc-oficial.db');
      const oficialDb = openOficialDbReadOnly(oficialDbPath);
      const repo = new DadosAbertosRepository(oficialDb);
      const workspacePath =
        process.env.WORKSPACE_DB_PATH ?? '/tmp/rtc-workspace.db';
      const store = new WorkspaceStore(workspacePath);
      const router = new FiscalEngineRouter({ db: oficialDb, repo });
      const orchestrator = new GeminiOrchestrator({ repo, router, store });

      const app = await buildApp({
        db: oficialDb,
        repo,
        store,
        router,
        orchestrator,
        logger,
        staticDir: path.resolve(process.cwd(), 'dist', 'client'),
      });
      await app.ready();
      return app;
    })();
  }
  return appPromise;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const app = await getApp();
  app.server.emit('request', req, res);
}

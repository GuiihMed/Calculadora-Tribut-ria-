import fs from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type Database from 'better-sqlite3';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import {
  type ExtractionDraft,
  FieldConfidenceSchema,
  OperationContextSchema,
} from '../shared/types/fiscal.js';
import { DadosAbertosRepository } from './db/dados-abertos-repo.js';
import { openOficialDbReadOnly } from './db/oficial-db.js';
import { DEFAULT_WORKSPACE_DB_PATH, WorkspaceStore } from './db/workspace-db.js';
import { RemoteEngineUnavailableError } from './engine/engine-port.js';
import { FiscalEngineRouter } from './engine/engine-router.js';
import {
  type ErrorCatalogEntry,
  listErrorCatalog,
  lookupErrorDescription,
} from './engine/error-catalog.js';
import { GeminiOrchestrator } from './gemini/orchestrator.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerExportRoutes } from './routes/export.js';
import { registerFiscalRoutes } from './routes/fiscal.js';
import { registerUploadRoutes } from './routes/upload.js';
import {
  FileTooLargeError,
  MAX_UPLOAD_BYTES,
  MagicBytesMismatchError,
  UnsupportedFileTypeError,
  XxeRejectedError,
} from './security/file-validator.js';
import {
  type ZeroPiiLogger,
  createZeroPiiLogger,
  generateRequestId,
} from './security/zero-pii-logger.js';

declare module 'fastify' {
  interface FastifyRequest {
    serverRequestId?: string;
    startTimeNs?: bigint;
    errorType?: string;
  }
}

export interface AppDependencies {
  db?: Database.Database;
  repo: DadosAbertosRepository;
  store: WorkspaceStore;
  router: FiscalEngineRouter;
  orchestrator: GeminiOrchestrator;
  logger: ZeroPiiLogger;
  allowedOrigins: string[];
  staticDir?: string;
  rateLimitMax?: number;
}

export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
] as const;

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'";

function applySecurityHeaders(reply: FastifyReply): void {
  reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
}

function parseEnvOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveAllowedOrigins(injected?: string[]): Set<string> {
  const envOrigins = [
    ...parseEnvOrigins(process.env.ALLOWED_ORIGINS),
    ...parseEnvOrigins(process.env.APP_CORS_ALLOWED_ORIGINS),
  ];
  const combined =
    injected !== undefined ? [...injected, ...envOrigins] : [...DEFAULT_ALLOWED_ORIGINS, ...envOrigins];

  for (const origin of combined) {
    if (origin === '*') {
      throw new Error("Wildcard '*' is not allowed in CORS allowedOrigins.");
    }
  }

  return new Set(combined);
}

const CreateSessionBodySchema = z.object({
  title: z.string().trim().optional(),
  context: OperationContextSchema.partial().optional(),
});

const DraftItemPatchSchema = z
  .object({
    nObj: z.number().int().positive(),
    descricao: z.string().optional(),
    ncm: z.string().optional(),
    nbs: z.string().optional(),
    cst: z.string().optional(),
    cClassTrib: z.string().optional(),
    cAtivSN: z.string().optional(),
    baseCalculo: z.string().optional(),
    quantidade: z.string().optional(),
    unidade: z.string().optional(),
    vProd: z.string().optional(),
    vFrete: z.string().optional(),
    vSeg: z.string().optional(),
    vOutro: z.string().optional(),
    vDesc: z.string().optional(),
    vICMS: z.string().optional(),
    vPIS: z.string().optional(),
    vCOFINS: z.string().optional(),
    vIS: z.string().optional(),
    pIBSSN: z.string().optional(),
    pCBSSN: z.string().optional(),
    confidence: z.record(FieldConfidenceSchema).default({}),
    missingFields: z.array(z.string()).default([]),
  })
  .passthrough();

const UpdateDraftBodySchema = z.object({
  context: OperationContextSchema.partial().optional(),
  itens: z.array(DraftItemPatchSchema).optional(),
  warnings: z.array(z.string()).optional(),
  requiresReview: z.boolean().optional(),
});

export async function buildApp(deps: Partial<AppDependencies> = {}): Promise<FastifyInstance> {
  const allowedOriginSet = resolveAllowedOrigins(deps.allowedOrigins);
  const logger = deps.logger ?? createZeroPiiLogger();

  let ownedDb: Database.Database | undefined;
  let ownedStore: WorkspaceStore | undefined;

  const db =
    deps.db ??
    deps.repo?.getDatabase() ??
    (() => {
      ownedDb = openOficialDbReadOnly(process.env.RTC_OFICIAL_DB_PATH);
      return ownedDb;
    })();

  const repo = deps.repo ?? new DadosAbertosRepository(db);
  const store =
    deps.store ??
    (() => {
      ownedStore = new WorkspaceStore(process.env.WORKSPACE_DB_PATH ?? DEFAULT_WORKSPACE_DB_PATH);
      return ownedStore;
    })();
  const router = deps.router ?? new FiscalEngineRouter({ db, repo });
  const orchestrator = deps.orchestrator ?? new GeminiOrchestrator({ repo, router, store });
  const rateLimitMax = deps.rateLimitMax ?? 30;

  const app = Fastify({
    logger: false,
    genReqId: () => generateRequestId(),
  });

  if (ownedDb || ownedStore) {
    app.addHook('onClose', async () => {
      ownedStore?.close();
      ownedDb?.close();
    });
  }

  // Fresh server-generated X-Request-ID & security headers on every response
  app.addHook('onRequest', async (request, reply) => {
    const requestId = generateRequestId();
    request.serverRequestId = requestId;
    request.startTimeNs = process.hrtime.bigint();
    reply.header('X-Request-ID', requestId);
    applySecurityHeaders(reply);
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.serverRequestId) {
      reply.header('X-Request-ID', request.serverRequestId);
    }
    applySecurityHeaders(reply);
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    const startNs = request.startTimeNs ?? process.hrtime.bigint();
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    const route = request.routeOptions?.url || request.url.split('?')[0];
    logger.info({
      request_id: request.serverRequestId ?? request.id,
      method: request.method,
      route,
      status: reply.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100,
      error_type: request.errorType,
    });
  });

  app.setErrorHandler((err, request, reply) => {
    const errWithMeta = err as Error & { statusCode?: number; code?: string };

    if (err instanceof RemoteEngineUnavailableError) {
      request.errorType = err.name;
      return reply.code(503).send({
        code: 'REMOTE_ENGINE_UNAVAILABLE',
        capability: err.capability,
        endpoint: err.endpoint,
        message: err.message,
        canForceLocal: true,
      });
    }

    if (err instanceof ZodError) {
      request.errorType = 'ZodError';
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Parâmetros inválidos na requisição.',
        issues: err.issues,
      });
    }

    if (err instanceof FileTooLargeError || errWithMeta.code === 'FST_REQ_FILE_TOO_LARGE') {
      request.errorType = 'FileTooLargeError';
      return reply.code(413).send({
        code: 'FILE_TOO_LARGE',
        message:
          err instanceof FileTooLargeError
            ? err.message
            : 'Arquivo excede o limite máximo permitido de 5 MiB.',
      });
    }

    if (errWithMeta.code === 'FST_FILES_LIMIT') {
      request.errorType = 'TooManyFilesError';
      return reply.code(400).send({
        code: 'TOO_MANY_FILES',
        message: 'Limite máximo de 5 arquivos por envio excedido.',
      });
    }

    if (err instanceof UnsupportedFileTypeError) {
      request.errorType = err.name;
      return reply.code(415).send({
        code: 'UNSUPPORTED_FILE_TYPE',
        message: err.message,
      });
    }

    if (err instanceof MagicBytesMismatchError) {
      request.errorType = err.name;
      return reply.code(400).send({
        code: 'MAGIC_BYTES_MISMATCH',
        message: err.message,
      });
    }

    if (err instanceof XxeRejectedError) {
      request.errorType = err.name;
      return reply.code(400).send({
        code: 'XXE_REJECTED',
        message: err.message,
      });
    }

    if (errWithMeta.statusCode === 403) {
      request.errorType = 'CorsForbiddenError';
      return reply.code(403).send({
        error: errWithMeta.message || 'Origin not allowed by CORS policy',
        code: 'CORS_ORIGIN_FORBIDDEN',
      });
    }

    if (errWithMeta.statusCode === 429) {
      request.errorType = 'RateLimitError';
      return reply.code(429).send({
        code: 'RATE_LIMIT_EXCEEDED',
        message: errWithMeta.message || 'Limite de requisições excedido.',
      });
    }

    const status =
      typeof errWithMeta.statusCode === 'number' &&
      errWithMeta.statusCode >= 400 &&
      errWithMeta.statusCode < 500
        ? errWithMeta.statusCode
        : 500;
    request.errorType = errWithMeta.name || errWithMeta.code || 'InternalError';

    return reply.code(status).send({
      code: status >= 500 ? 'INTERNAL_ERROR' : errWithMeta.code ?? 'BAD_REQUEST',
      message:
        status >= 500
          ? 'Erro interno ao processar a solicitação.'
          : errWithMeta.message || 'Requisição inválida.',
    });
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, false);
        return;
      }
      if (allowedOriginSet.has(origin)) {
        cb(null, true);
        return;
      }
      const err = new Error('Origin not allowed by CORS policy') as Error & { statusCode?: number };
      err.statusCode = 403;
      cb(err, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
    exposedHeaders: ['X-Request-ID', 'X-Session-ID', 'X-Danfse-Engine-Mode', 'X-Danfse-Local-Preview'],
  });

  await app.register(rateLimit, {
    global: false,
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 5,
    },
  });

  // --------------------------------------------------------------------------
  // Health & Dados Abertos
  // --------------------------------------------------------------------------

  app.get('/api/health', async () => {
    let oficialReady = true;
    try {
      repo.listUfs();
    } catch {
      oficialReady = false;
    }

    return {
      status: 'ok',
      engines: router.getStatus(),
      oficialDb: { ready: oficialReady },
    };
  });

  app.get<{ Querystring: { q?: string; data?: string } }>(
    '/api/dados-abertos/ncm',
    async (request) => {
      const q = request.query.q ?? '';
      const data = request.query.data?.trim() || '2026-01-01';
      const items = repo.lookupNcm(q, data);
      return { dhFatoGerador: data, items, count: items.length };
    },
  );

  app.get<{ Querystring: { q?: string; data?: string } }>(
    '/api/dados-abertos/nbs',
    async (request) => {
      const q = request.query.q ?? '';
      const data = request.query.data?.trim() || '2026-01-01';
      const items = repo.lookupNbs(q, data);
      return { dhFatoGerador: data, items, count: items.length };
    },
  );

  app.get<{ Querystring: { q?: string; cst?: string; data?: string } }>(
    '/api/dados-abertos/classtrib',
    async (request) => {
      const q = request.query.q ?? '';
      const cst = request.query.cst?.trim() || undefined;
      const data = request.query.data?.trim() || undefined;
      const items = repo.searchClassificacoes(q, cst, data);
      return { items, count: items.length };
    },
  );

  app.get('/api/dados-abertos/uf', async () => {
    const items = repo.listUfs();
    return { items, count: items.length };
  });

  app.get<{ Querystring: { uf?: string; ufCd?: string } }>(
    '/api/dados-abertos/municipios',
    async (request) => {
      const rawUf = request.query.ufCd?.trim() || request.query.uf?.trim();
      if (!rawUf) {
        const items = repo.listMunicipios();
        return { items, count: items.length };
      }

      if (/^\d+$/.test(rawUf)) {
        const items = repo.listMunicipios(Number.parseInt(rawUf, 10));
        return { items, count: items.length };
      }

      const matchedUf = repo
        .listUfs()
        .find((u) => u.sigla.toUpperCase() === rawUf.toUpperCase());
      if (!matchedUf) {
        return { items: [], count: 0 };
      }
      const items = repo.listMunicipios(matchedUf.ufCd);
      return { items, count: items.length };
    },
  );

  app.get<{
    Querystring: {
      data?: string;
      anexo?: string;
      cClassTrib?: string;
      tipoDocumento?: string;
    };
  }>('/api/dados-abertos/atividades-simples', async (request) => {
    const data = request.query.data?.trim() || '2027-01-01';
    const anexo = request.query.anexo?.trim() || undefined;
    const cClassTrib = request.query.cClassTrib?.trim() || undefined;
    const rawTpDoc = request.query.tipoDocumento?.trim();
    const tipoDocumento =
      rawTpDoc && /^\d+$/.test(rawTpDoc) ? Number.parseInt(rawTpDoc, 10) : undefined;

    const items = repo.getAtividadesSimples(data, {
      anexo,
      cClassTrib,
      tipoDocumento,
    });
    return { dhFatoGerador: data, items, count: items.length };
  });

  app.get<{ Querystring: { code?: string; categoria?: ErrorCatalogEntry['categoria'] } }>(
    '/api/dados-abertos/erros',
    async (request) => {
      const code = request.query.code?.trim();
      if (code) {
        const item = lookupErrorDescription(code);
        return { item, items: item ? [item] : [], count: item ? 1 : 0 };
      }
      const cat = request.query.categoria;
      const items = listErrorCatalog(cat);
      return { items, count: items.length };
    },
  );

  // --------------------------------------------------------------------------
  // Sessions, Drafts & CalcRuns
  // --------------------------------------------------------------------------

  app.get('/api/sessions', async () => {
    return { sessions: store.listSessions() };
  });

  app.post('/api/sessions', async (request, reply) => {
    const body = CreateSessionBodySchema.parse(request.body ?? {});
    const session = store.createSession(body.title, body.context ?? {});
    return reply.code(201).send({ session });
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const session = store.getSession(request.params.id);
    if (!session) {
      return reply.code(404).send({
        code: 'SESSION_NOT_FOUND',
        message: 'Sessão não encontrada.',
      });
    }
    return {
      session,
      messages: store.listMessages(session.id),
      calcRuns: store.listCalcRuns(session.id),
    };
  });

  app.patch<{ Params: { id: string } }>(
    '/api/sessions/:id/context',
    async (request, reply) => {
      const rawBody = (request.body ?? {}) as Record<string, unknown>;
      const hasContextWrapper =
        rawBody.context !== undefined &&
        typeof rawBody.context === 'object' &&
        rawBody.context !== null;
      const title = typeof rawBody.title === 'string' ? rawBody.title : undefined;
      const rawContext = hasContextWrapper
        ? rawBody.context
        : Object.fromEntries(Object.entries(rawBody).filter(([k]) => k !== 'title'));

      const parsedContext = OperationContextSchema.partial().parse(rawContext ?? {});
      const updated = store.updateSessionContext(request.params.id, parsedContext, title);
      if (!updated) {
        return reply.code(404).send({
          code: 'SESSION_NOT_FOUND',
          message: 'Sessão não encontrada.',
        });
      }
      return { session: updated };
    },
  );

  app.get<{ Params: { id: string } }>('/api/drafts/:id', async (request, reply) => {
    const draft = store.getExtractionDraft(request.params.id);
    if (!draft) {
      return reply.code(404).send({
        code: 'DRAFT_NOT_FOUND',
        message: 'Rascunho de extração não encontrado.',
      });
    }
    return { draft };
  });

  app.put<{ Params: { id: string } }>('/api/drafts/:id', async (request, reply) => {
    const patch = UpdateDraftBodySchema.parse(request.body ?? {});
    const updated = store.updateExtractionDraft(
      request.params.id,
      patch as Partial<ExtractionDraft>,
    );
    if (!updated) {
      return reply.code(404).send({
        code: 'DRAFT_NOT_FOUND',
        message: 'Rascunho de extração não encontrado.',
      });
    }
    return { draft: updated };
  });

  app.get<{ Params: { id: string } }>('/api/calc-runs/:id', async (request, reply) => {
    const snapshot = store.getCalcRun(request.params.id);
    if (!snapshot) {
      return reply.code(404).send({
        code: 'CALC_RUN_NOT_FOUND',
        message: 'Execução de cálculo não encontrada.',
      });
    }
    return { snapshot };
  });

  // --------------------------------------------------------------------------
  // Modular API Routes
  // --------------------------------------------------------------------------

  registerUploadRoutes(app, { store, orchestrator, rateLimitMax });
  registerChatRoutes(app, { store, orchestrator, rateLimitMax });
  registerFiscalRoutes(app, { store, router });
  registerExportRoutes(app, { store, router });

  // --------------------------------------------------------------------------
  // Static SPA Fallback (production build)
  // --------------------------------------------------------------------------

  const staticRoot = path.resolve(deps.staticDir ?? 'dist/client');
  const indexHtmlPath = path.join(staticRoot, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Endpoint não encontrado.' });
      }
      if (request.method === 'GET' || request.method === 'HEAD') {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Recurso não encontrado.' });
    });
  } else {
    app.setNotFoundHandler((_request, reply) => {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Recurso não encontrado.' });
    });
  }

  return app;
}

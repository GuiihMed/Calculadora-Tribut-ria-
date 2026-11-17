import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type ChatStreamEvent, OperationContextSchema } from '../../shared/types/fiscal.js';
import type { WorkspaceStore } from '../db/workspace-db.js';
import type { GeminiOrchestrator } from '../gemini/orchestrator.js';

export interface ChatRoutesDeps {
  store: WorkspaceStore;
  orchestrator: GeminiOrchestrator;
  rateLimitMax: number;
}

const ChatRequestSchema = z.object({
  sessionId: z.string().trim().optional(),
  message: z.string().trim().min(1, 'Mensagem não pode ser vazia.'),
  attachmentSummary: z.string().optional(),
  activeContext: OperationContextSchema.partial().optional(),
  stream: z.boolean().optional(),
});

export function registerChatRoutes(app: FastifyInstance, deps: ChatRoutesDeps): void {
  const { store, orchestrator, rateLimitMax } = deps;

  app.post(
    '/api/chat',
    {
      config: {
        rateLimit: {
          max: rateLimitMax,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const body = ChatRequestSchema.parse(request.body ?? {});

      let session = body.sessionId ? store.getSession(body.sessionId) : null;
      if (!session) {
        session = store.createSession('Nova Simulação', body.activeContext ?? {});
      }

      if (body.stream === false) {
        const events: ChatStreamEvent[] = [];
        const turn = await orchestrator.runChatTurn({
          sessionId: session.id,
          userMessage: body.message,
          attachmentSummary: body.attachmentSummary,
          activeContext: body.activeContext,
          onDelta: (ev) => {
            events.push(ev);
          },
        });
        return reply.code(200).send({
          sessionId: session.id,
          turn,
          events,
        });
      }

      const stream = new PassThrough();
      reply
        .code(200)
        .header('Content-Type', 'text/event-stream; charset=utf-8')
        .header('Cache-Control', 'no-cache')
        .header('Connection', 'keep-alive')
        .header('X-Session-ID', session.id);

      void (async () => {
        try {
          await orchestrator.runChatTurn({
            sessionId: session.id,
            userMessage: body.message,
            attachmentSummary: body.attachmentSummary,
            activeContext: body.activeContext,
            onDelta: (ev) => {
              if (!stream.destroyed) {
                stream.write(`data: ${JSON.stringify(ev)}\n\n`);
              }
            },
          });
        } catch (err) {
          request.errorType = err instanceof Error ? err.name : 'ChatStreamError';
          if (!stream.destroyed) {
            const safeMessage =
              err instanceof Error && err.message.includes('GEMINI_API_KEY')
                ? err.message
                : 'Falha ao processar turno no Copiloto Gemini.';
            stream.write(`data: ${JSON.stringify({ type: 'error', message: safeMessage })}\n\n`);
          }
        } finally {
          if (!stream.destroyed) {
            stream.end();
          }
        }
      })();

      return reply.send(stream);
    },
  );
}

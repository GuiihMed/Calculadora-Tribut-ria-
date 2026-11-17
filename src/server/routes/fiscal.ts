import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BaseCalculoUnificadaInputSchema,
  BaseCalculoUnificadaNfseInputSchema,
  type BaseCalculoUnificadaOutput,
  type CalcRunSnapshot,
  CompareRegimesInputSchema,
  DecimalInputSchema,
  OperacaoInputSchema,
  OperacaoSimplesInputSchema,
  type OperationContext,
  OperationContextSchema,
} from '../../shared/types/fiscal.js';
import type { WorkspaceStore } from '../db/workspace-db.js';
import type { FiscalEngineRouter } from '../engine/engine-router.js';

export interface FiscalRoutesDeps {
  store: WorkspaceStore;
  router: FiscalEngineRouter;
}

const CalculateRequestSchema = z.object({
  regime: z.enum(['regime-regular', 'simples-nacional']),
  input: z.unknown(),
  sessionId: z.string().trim().optional(),
  context: OperationContextSchema.partial().optional(),
  modo: z.enum(['observabilidade', 'estrito']).optional(),
  forceLocal: z.boolean().optional(),
});

const CompareRequestEnvelopeSchema = z
  .object({
    input: z.unknown().optional(),
    sessionId: z.string().trim().optional(),
    context: OperationContextSchema.partial().optional(),
    forceLocal: z.boolean().optional(),
  })
  .passthrough();

const BaseUnificadaRequestEnvelopeSchema = z
  .object({
    modelo: z.enum(['nfe', 'nfse']).optional(),
    input: z.unknown().optional(),
    sessionId: z.string().trim().optional(),
    context: OperationContextSchema.partial().optional(),
    forceLocal: z.boolean().optional(),
  })
  .passthrough();

const FatorRRequestSchema = z.object({
  folha12m: DecimalInputSchema,
  rbt12m: DecimalInputSchema,
});

function resolveTipoDfe(raw: unknown): OperationContext['tipoDfe'] {
  if (raw === 65 || raw === '65') {
    return '65';
  }
  if (raw === 'NFSE' || raw === 99 || raw === '99') {
    return 'NFSE';
  }
  return '55';
}

export function registerFiscalRoutes(app: FastifyInstance, deps: FiscalRoutesDeps): void {
  const { store, router } = deps;

  app.post('/api/fiscal/calculate', async (request, reply) => {
    const body = CalculateRequestSchema.parse(request.body ?? {});

    if (body.regime === 'regime-regular') {
      const parsed = OperacaoInputSchema.parse(body.input);
      const { output, engineMode } = await router.calculateRegimeRegular(parsed, {
        modo: body.modo ?? 'observabilidade',
        forceLocal: body.forceLocal,
      });

      const snapshot: CalcRunSnapshot = store.saveCalcRun({
        id: crypto.randomUUID(),
        sessionId: body.sessionId,
        kind: 'regime_regular',
        engineMode,
        dhFatoGerador: output.dhFatoGerador,
        context: {
          regime: 'regime-regular',
          dhFatoGerador: output.dhFatoGerador,
          tipoDfe: resolveTipoDfe(parsed.tipoDfe),
          uf: parsed.uf,
          ufCd: parsed.ufCd,
          municipio: parsed.municipio,
          tpEnteGov: parsed.tpEnteGov,
          ...body.context,
        },
        input: parsed,
        output,
        xWarningDadosSimulados: output.xWarningDadosSimulados,
        createdAt: new Date().toISOString(),
      });

      return reply.code(200).send({ calcRunId: snapshot.id, snapshot });
    }

    const parsed = OperacaoSimplesInputSchema.parse(body.input);
    const { output, engineMode } = await router.calculateSimplesNacional(parsed, {
      forceLocal: body.forceLocal,
    });

    const snapshot: CalcRunSnapshot = store.saveCalcRun({
      id: crypto.randomUUID(),
      sessionId: body.sessionId,
      kind: 'simples_nacional',
      engineMode,
      dhFatoGerador: output.dhFatoGerador,
      context: {
        regime: 'simples-nacional',
        dhFatoGerador: output.dhFatoGerador,
        tipoDfe: resolveTipoDfe(parsed.tpDoc),
        crt: parsed.CRT,
        tpRegimeIBSCBS: parsed.tpRegimeIBSCBS ?? undefined,
        tpEnteGov: parsed.tpEnteGov,
        ...body.context,
      },
      input: parsed,
      output,
      xWarningDadosSimulados: false,
      createdAt: new Date().toISOString(),
    });

    return reply.code(200).send({ calcRunId: snapshot.id, snapshot });
  });

  app.post('/api/fiscal/compare', async (request, reply) => {
    const envelope = CompareRequestEnvelopeSchema.parse(request.body ?? {});
    const rawInput = envelope.input !== undefined ? envelope.input : envelope;
    const parsed = CompareRegimesInputSchema.parse(rawInput);

    const { output, engineMode } = await router.compareRegimes(parsed, {
      forceLocal: envelope.forceLocal,
    });

    const snapshot: CalcRunSnapshot = store.saveCalcRun({
      id: crypto.randomUUID(),
      sessionId: envelope.sessionId,
      kind: 'comparativo',
      engineMode,
      dhFatoGerador: output.dhFatoGerador,
      context: {
        regime: 'comparativo',
        dhFatoGerador: output.dhFatoGerador,
        tipoDfe: resolveTipoDfe(parsed.tpDoc),
        uf: parsed.uf,
        ufCd: parsed.ufCd,
        municipio: parsed.municipio,
        tpEnteGov: parsed.tpEnteGov,
        ...envelope.context,
      },
      input: parsed,
      output,
      xWarningDadosSimulados: false,
      createdAt: new Date().toISOString(),
    });

    return reply.code(200).send({ calcRunId: snapshot.id, snapshot });
  });

  app.post('/api/fiscal/base-unificada', async (request, reply) => {
    const envelope = BaseUnificadaRequestEnvelopeSchema.parse(request.body ?? {});
    const rawInput =
      envelope.input !== undefined && typeof envelope.input === 'object' && envelope.input !== null
        ? (envelope.input as Record<string, unknown>)
        : (envelope as Record<string, unknown>);

    const isNfse =
      envelope.modelo === 'nfse' ||
      (envelope.modelo !== 'nfe' &&
        ('ehLocacao' in rawInput || 'isMei' in rawInput || 'vDescIncond' in rawInput));

    if (isNfse) {
      const parsed = BaseCalculoUnificadaNfseInputSchema.parse(rawInput);
      const { output, engineMode } = await router.calculateBaseUnificadaNfse(parsed, {
        forceLocal: envelope.forceLocal,
      });
      const dhFatoGerador = `${parsed.anoFatoGerador}-01-01`;
      const normalizedOutput: BaseCalculoUnificadaOutput = {
        baseRG: output.baseRG,
        baseIS: '0.00',
        baseSN: output.baseSN,
        avisos: output.avisos,
      };
      const snapshot = store.saveCalcRun({
        id: crypto.randomUUID(),
        sessionId: envelope.sessionId,
        kind: 'base_unificada',
        engineMode,
        dhFatoGerador,
        context: {
          regime: 'regime-regular',
          dhFatoGerador,
          tipoDfe: 'NFSE',
          ...envelope.context,
        },
        input: parsed,
        output: normalizedOutput,
        xWarningDadosSimulados: false,
        createdAt: new Date().toISOString(),
      });

      return reply.code(200).send({ calcRunId: snapshot.id, snapshot, output });
    }

    const parsed = BaseCalculoUnificadaInputSchema.parse(rawInput);
    const { output, engineMode } = await router.calculateBaseUnificadaNfe(parsed, {
      forceLocal: envelope.forceLocal,
    });
    const dhFatoGerador = `${parsed.anoFatoGerador}-01-01`;
    const snapshot = store.saveCalcRun({
      id: crypto.randomUUID(),
      sessionId: envelope.sessionId,
      kind: 'base_unificada',
      engineMode,
      dhFatoGerador,
      context: {
        regime: 'regime-regular',
        dhFatoGerador,
        tipoDfe: resolveTipoDfe(parsed.tipoDocumento),
        ...envelope.context,
      },
      input: parsed,
      output,
      xWarningDadosSimulados: false,
      createdAt: new Date().toISOString(),
    });

    return reply.code(200).send({ calcRunId: snapshot.id, snapshot, output });
  });

  app.post('/api/fiscal/fator-r', async (request, reply) => {
    const parsed = FatorRRequestSchema.parse(request.body ?? {});
    const output = router.calculateFatorR(parsed);
    return reply.code(200).send({ output });
  });
}

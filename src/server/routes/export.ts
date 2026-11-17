import type { FastifyInstance } from 'fastify';
import { XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import type { CalcRunSnapshot } from '../../shared/types/fiscal.js';
import type { WorkspaceStore } from '../db/workspace-db.js';
import type { FiscalEngineRouter } from '../engine/engine-router.js';
import { exportAuditXlsx } from '../parsers/xlsx-exporter.js';
import { XXE_DTD_OR_ENTITY_RE, XxeRejectedError } from '../security/file-validator.js';

export interface ExportRoutesDeps {
  store: WorkspaceStore;
  router: FiscalEngineRouter;
}

const ExportXmlRequestSchema = z.object({
  calcRunId: z.string().trim().optional(),
  snapshot: z.unknown().optional(),
  tipo: z.enum(['nfe', 'nfce']).optional(),
  forceLocal: z.boolean().optional(),
});

const ExportDanfseRequestSchema = z.object({
  xml: z.string().trim().min(1, 'XML da NFS-e é obrigatório para gerar a DANFSe.'),
  stc: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  canhoto: z.boolean().optional(),
  forceLocal: z.boolean().optional(),
});

export function registerExportRoutes(app: FastifyInstance, deps: ExportRoutesDeps): void {
  const { store, router } = deps;

  app.post('/api/export/xml', async (request, reply) => {
    const body = ExportXmlRequestSchema.parse(request.body ?? {});

    let snapshot: CalcRunSnapshot | null = null;
    if (body.calcRunId) {
      snapshot = store.getCalcRun(body.calcRunId);
      if (!snapshot) {
        return reply.code(404).send({
          code: 'CALC_RUN_NOT_FOUND',
          message: `CalcRunSnapshot '${body.calcRunId}' não encontrado.`,
        });
      }
    } else if (body.snapshot && typeof body.snapshot === 'object') {
      snapshot = body.snapshot as CalcRunSnapshot;
    } else {
      return reply.code(400).send({
        code: 'MISSING_CALC_RUN',
        message: 'Informe calcRunId ou snapshot para exportação XML.',
      });
    }

    const tipo = body.tipo ?? 'nfe';
    const generation = await router.generateTaxXml(snapshot, tipo, {
      forceLocal: body.forceLocal,
    });

    if (generation.supported && generation.xml) {
      const validation = await router.validateXml(generation.xml, tipo, 'grupo', {
        forceLocal: body.forceLocal,
      });
      return reply.code(200).send({ generation, validation });
    }

    return reply.code(200).send({ generation, validation: null });
  });

  app.post('/api/export/danfse', async (request, reply) => {
    const body = ExportDanfseRequestSchema.parse(request.body ?? {});
    if (XXE_DTD_OR_ENTITY_RE.test(body.xml)) {
      throw new XxeRejectedError();
    }
    const wellFormed = XMLValidator.validate(body.xml);
    if (wellFormed !== true) {
      return reply.code(400).send({
        code: 'INVALID_XML',
        message: `XML de NFS-e malformado: ${wellFormed.err?.msg ?? 'erro de sintaxe'}`,
      });
    }

    const result = await router.generateDanfse(
      body.xml,
      body.stc ?? 0,
      body.canhoto ?? true,
      { forceLocal: body.forceLocal },
    );

    return reply
      .code(200)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', 'attachment; filename="danfse-preview.pdf"')
      .header('X-Danfse-Engine-Mode', result.engineMode)
      .header('X-Danfse-Local-Preview', String(result.isLocalPreview))
      .send(result.pdf);
  });

  app.get<{ Params: { calcRunId: string } }>(
    '/api/export/xlsx/:calcRunId',
    async (request, reply) => {
      const { calcRunId } = request.params;
      const snapshot = store.getCalcRun(calcRunId);
      if (!snapshot) {
        return reply.code(404).send({
          code: 'CALC_RUN_NOT_FOUND',
          message: `CalcRunSnapshot '${calcRunId}' não encontrado.`,
        });
      }

      const buffer = await exportAuditXlsx(snapshot);
      const safeId = calcRunId.replace(/[^a-zA-Z0-9_-]/g, '') || 'calculo';

      return reply
        .code(200)
        .header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        .header('Content-Disposition', `attachment; filename="auditoria-rtc-${safeId}.xlsx"`)
        .send(buffer);
    },
  );

  app.get<{ Params: { calcRunId: string } }>(
    '/api/export/json/:calcRunId',
    async (request, reply) => {
      const { calcRunId } = request.params;
      const snapshot = store.getCalcRun(calcRunId);
      if (!snapshot) {
        return reply.code(404).send({
          code: 'CALC_RUN_NOT_FOUND',
          message: `CalcRunSnapshot '${calcRunId}' não encontrado.`,
        });
      }

      const safeId = calcRunId.replace(/[^a-zA-Z0-9_-]/g, '') || 'calculo';
      return reply
        .code(200)
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="auditoria-rtc-${safeId}.json"`)
        .send(snapshot);
    },
  );
}

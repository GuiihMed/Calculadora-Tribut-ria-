import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ColumnMappingSuggestion, ExtractionDraft } from '../../shared/types/fiscal.js';
import type { WorkspaceStore } from '../db/workspace-db.js';
import type { GeminiOrchestrator, VisualDocumentMimeType } from '../gemini/orchestrator.js';
import { parseSpreadsheetToDraft } from '../parsers/spreadsheet-parser.js';
import { parseDfeXmlToDraft } from '../parsers/xml-dfe-parser.js';
import {
  FileTooLargeError,
  MAX_UPLOAD_BYTES,
  type SupportedExtension,
  validateUploadedFile,
} from '../security/file-validator.js';
import { maskFiscalPii } from '../security/pii-masker.js';

export interface UploadRoutesDeps {
  store: WorkspaceStore;
  orchestrator?: GeminiOrchestrator;
  rateLimitMax: number;
}

const VISUAL_MIME_BY_EXT: Partial<Record<SupportedExtension, VisualDocumentMimeType>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

function buildMaskedAttachmentSummary(drafts: ExtractionDraft[]): string {
  const lines = drafts.map((draft) => {
    const contextParts = [
      draft.context.regime ? `regime=${draft.context.regime}` : null,
      draft.context.tipoDfe ? `tipoDfe=${draft.context.tipoDfe}` : null,
      draft.context.dhFatoGerador ? `data=${draft.context.dhFatoGerador}` : null,
      draft.context.uf ? `uf=${draft.context.uf}` : null,
    ].filter(Boolean);

    const sampleItems = draft.itens.slice(0, 5).map((item) => ({
      nObj: item.nObj,
      descricao: item.descricao ? maskFiscalPii(item.descricao) : undefined,
      ncm: item.ncm,
      nbs: item.nbs,
      cst: item.cst,
      cClassTrib: item.cClassTrib,
      baseCalculo: item.baseCalculo,
      missingFields: item.missingFields,
    }));

    return [
      `Arquivo: ${maskFiscalPii(draft.filename)} (${draft.sourceType}, draftId=${draft.id})`,
      `Itens extraídos: ${draft.itens.length}`,
      contextParts.length > 0 ? `Contexto: ${contextParts.join(', ')}` : null,
      sampleItems.length > 0 ? `Amostra de itens: ${JSON.stringify(sampleItems)}` : null,
      draft.warnings.length > 0
        ? `Avisos: ${draft.warnings.map((w) => maskFiscalPii(w)).join(' | ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
  });

  return maskFiscalPii(lines.join('\n\n'));
}

export function registerUploadRoutes(app: FastifyInstance, deps: UploadRoutesDeps): void {
  const { store, orchestrator, rateLimitMax } = deps;

  app.post(
    '/api/upload',
    {
      config: {
        rateLimit: {
          max: rateLimitMax,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      if (!request.isMultipart()) {
        return reply.code(400).send({
          code: 'INVALID_CONTENT_TYPE',
          message: 'A requisição de upload deve usar multipart/form-data.',
        });
      }

      let sessionId: string | undefined;
      const bufferedFiles: Array<{ buffer: Buffer; filename: string; mimetype: string }> = [];

      for await (const part of request.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'sessionId' && typeof part.value === 'string') {
            const trimmed = part.value.trim();
            if (trimmed) {
              sessionId = trimmed;
            }
          }
          continue;
        }

        const buffer = await part.toBuffer();
        if (part.file.truncated || buffer.byteLength > MAX_UPLOAD_BYTES) {
          throw new FileTooLargeError();
        }
        bufferedFiles.push({
          buffer,
          filename: part.filename || 'upload',
          mimetype: part.mimetype || '',
        });
      }

      if (bufferedFiles.length === 0) {
        return reply.code(400).send({
          code: 'NO_FILES_UPLOADED',
          message: 'Nenhum arquivo enviado.',
        });
      }

      const drafts: ExtractionDraft[] = [];
      const columnMappings: Record<string, ColumnMappingSuggestion> = {};

      for (const filePart of bufferedFiles) {
        const validated = validateUploadedFile(
          filePart.buffer,
          filePart.filename,
          filePart.mimetype,
        );

        if (validated.extension === 'xml') {
          let parsedDraft: ExtractionDraft;
          try {
            parsedDraft = parseDfeXmlToDraft(
              validated.buffer.toString('utf8'),
              validated.sanitizedFilename,
            );
          } catch (err) {
            return reply.code(400).send({
              code: 'INVALID_XML',
              message: err instanceof Error ? err.message : 'XML inválido.',
            });
          }
          const saved = store.saveExtractionDraft({
            ...parsedDraft,
            sessionId,
          });
          drafts.push(saved);
          continue;
        }

        if (validated.extension === 'xlsx' || validated.extension === 'csv') {
          let parsed: Awaited<ReturnType<typeof parseSpreadsheetToDraft>>;
          try {
            parsed = await parseSpreadsheetToDraft(
              validated.buffer,
              validated.extension,
              validated.sanitizedFilename,
            );
          } catch (err) {
            return reply.code(400).send({
              code: 'INVALID_SPREADSHEET',
              message: err instanceof Error ? err.message : 'Planilha inválida.',
            });
          }

          const draftToSave: ExtractionDraft = {
            ...parsed.draft,
            sessionId,
            warnings: [...parsed.draft.warnings],
          };

          if (parsed.unmappedColumns && orchestrator && parsed.headers.length > 0) {
            try {
              const suggestion = await orchestrator.suggestSpreadsheetMapping(
                parsed.headers,
                parsed.maskedSampleRows,
              );
              columnMappings[draftToSave.id] = suggestion;
              if (suggestion.warnings.length > 0) {
                draftToSave.warnings.push(...suggestion.warnings);
              }
            } catch {
              draftToSave.warnings.push(
                'Sugestão automática de mapeamento indisponível; revise os cabeçalhos manualmente na aba Prévia & Lote.',
              );
            }
          }

          const saved = store.saveExtractionDraft(draftToSave);
          drafts.push(saved);
          continue;
        }

        const visualMime = VISUAL_MIME_BY_EXT[validated.extension];
        if (visualMime) {
          if (orchestrator) {
            try {
              const extracted = await orchestrator.extractFromVisualDocument(
                validated.buffer,
                visualMime,
                validated.sanitizedFilename,
                sessionId,
              );
              drafts.push(extracted);
              continue;
            } catch (err) {
              const fallbackDraft = store.saveExtractionDraft({
                id: crypto.randomUUID(),
                sessionId,
                sourceType: validated.extension === 'pdf' ? 'pdf' : 'image',
                filename: validated.sanitizedFilename,
                context: {},
                itens: [],
                warnings: [
                  `Extração visual automática indisponível (${err instanceof Error ? err.message : 'erro técnico'}); preencha os itens manualmente na aba Prévia & Lote.`,
                ],
                requiresReview: true,
                createdAt: new Date().toISOString(),
              });
              drafts.push(fallbackDraft);
              continue;
            }
          }

          const fallbackDraft = store.saveExtractionDraft({
            id: crypto.randomUUID(),
            sessionId,
            sourceType: validated.extension === 'pdf' ? 'pdf' : 'image',
            filename: validated.sanitizedFilename,
            context: {},
            itens: [],
            warnings: [
              'Orquestrador visual não configurado; preencha os itens manualmente na aba Prévia & Lote.',
            ],
            requiresReview: true,
            createdAt: new Date().toISOString(),
          });
          drafts.push(fallbackDraft);
        }
      }

      const attachmentSummary = buildMaskedAttachmentSummary(drafts);

      return reply.code(200).send({
        drafts,
        attachmentSummary,
        ...(Object.keys(columnMappings).length > 0 ? { columnMappings } : {}),
      });
    },
  );
}

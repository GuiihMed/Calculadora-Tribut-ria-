import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import {
  type AssistantTurnRecord,
  type CalcRunSnapshot,
  type ChatStreamEvent,
  type ColumnMappingSuggestion,
  type ExtractionDraft,
  type ExtractionDraftItem,
  type FieldConfidence,
  FieldConfidenceSchema,
  type GeminiTurnStep,
  type OperationContext,
} from '../../shared/types/fiscal.js';
import type { DadosAbertosRepository } from '../db/dados-abertos-repo.js';
import type { WorkspaceStore } from '../db/workspace-db.js';
import type { FiscalEngineRouter } from '../engine/engine-router.js';
import { maskFiscalPii, maskSpreadsheetRowsForLlm } from '../security/pii-masker.js';
import {
  COPILOT_SYSTEM_INSTRUCTION,
  verifyNumericGrounding,
  wrapUntrustedDocumentData,
} from './prompt-guard.js';
import {
  FISCAL_TOOL_DECLARATIONS,
  executeFiscalTool,
} from './tools-registry.js';

export const GEMINI_COPILOT_MODEL = 'gemini-4-hydrogen';
export const MAX_TOOL_ITERATIONS = 8;

export type VisualDocumentMimeType =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp';

export interface InteractionCreateParams {
  model: string;
  input: string | Array<Record<string, unknown>>;
  store: false;
  system_instruction?: string;
  tools?: Array<Record<string, unknown>>;
  response_format?: Record<string, unknown>;
  generation_config?: Record<string, unknown>;
  stream?: false;
  previous_interaction_id?: never;
}

export interface InteractionStepOutput {
  type: string;
  content?: Array<{ type?: string; text?: string; [k: string]: unknown }>;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  call_id?: string;
  result?: unknown;
  is_error?: boolean;
  [k: string]: unknown;
}

export interface InteractionResponse {
  id?: string;
  status?: string;
  output_text?: string;
  steps?: Array<InteractionStepOutput>;
  errors?: Array<{ code?: string; message?: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

export interface InteractionsClient {
  interactions: {
    create(params: InteractionCreateParams): Promise<InteractionResponse>;
  };
}

export interface GeminiOrchestratorDeps {
  repo: DadosAbertosRepository;
  router: FiscalEngineRouter;
  store: WorkspaceStore;
  client?: InteractionsClient;
  apiKey?: string;
}

export interface RunChatTurnParams {
  sessionId: string;
  userMessage: string;
  attachmentSummary?: string;
  activeContext?: Partial<OperationContext>;
  onDelta: (ev: ChatStreamEvent) => void;
  clientFactory?: InteractionsClient;
}

const VisualExtractionItemSchema = z.object({
  nObj: z.number().int().positive().optional(),
  descricao: z.string().nullable().optional(),
  ncm: z.string().nullable().optional(),
  nbs: z.string().nullable().optional(),
  cst: z.string().nullable().optional(),
  cClassTrib: z.string().nullable().optional(),
  cAtivSN: z.string().nullable().optional(),
  baseCalculo: z.union([z.string(), z.number()]).nullable().optional(),
  quantidade: z.union([z.string(), z.number()]).nullable().optional(),
  unidade: z.string().nullable().optional(),
  vProd: z.union([z.string(), z.number()]).nullable().optional(),
  vFrete: z.union([z.string(), z.number()]).nullable().optional(),
  vSeg: z.union([z.string(), z.number()]).nullable().optional(),
  vOutro: z.union([z.string(), z.number()]).nullable().optional(),
  vDesc: z.union([z.string(), z.number()]).nullable().optional(),
  vICMS: z.union([z.string(), z.number()]).nullable().optional(),
  vPIS: z.union([z.string(), z.number()]).nullable().optional(),
  vCOFINS: z.union([z.string(), z.number()]).nullable().optional(),
  vIS: z.union([z.string(), z.number()]).nullable().optional(),
  pIBSSN: z.union([z.string(), z.number()]).nullable().optional(),
  pCBSSN: z.union([z.string(), z.number()]).nullable().optional(),
  confidence: z.record(FieldConfidenceSchema).optional(),
  missingFields: z.array(z.string()).optional(),
});

const VisualExtractionResponseSchema = z.object({
  context: z
    .object({
      regime: z.enum(['regime-regular', 'simples-nacional', 'comparativo']).nullable().optional(),
      dhFatoGerador: z.string().nullable().optional(),
      tipoDfe: z.enum(['55', '65', 'NFSE']).nullable().optional(),
      uf: z.string().nullable().optional(),
      municipio: z.number().int().positive().nullable().optional(),
      crt: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable().optional(),
    })
    .optional(),
  itens: z.array(VisualExtractionItemSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

const ColumnMappingResponseSchema = z.object({
  mappings: z
    .array(
      z.object({
        sourceColumn: z.string(),
        targetField: z.string().nullable(),
        confidence: FieldConfidenceSchema,
        reason: z.string().optional(),
      }),
    )
    .default([]),
  unmappedColumns: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  suggestedRegime: z.enum(['regime-regular', 'simples-nacional', 'comparativo']).optional(),
});

const CONFIDENCE_FIELD_SCHEMA = {
  type: 'string',
  enum: ['high', 'medium', 'low', 'missing'],
} as const;

const VISUAL_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    context: {
      type: 'object',
      properties: {
        regime: { type: 'string', enum: ['regime-regular', 'simples-nacional', 'comparativo'] },
        dhFatoGerador: { type: 'string' },
        tipoDfe: { type: 'string', enum: ['55', '65', 'NFSE'] },
        uf: { type: 'string' },
        municipio: { type: 'number' },
        crt: { type: 'number', enum: [1, 2, 3] },
      },
    },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nObj: { type: 'number' },
          descricao: { type: 'string' },
          ncm: { type: 'string' },
          nbs: { type: 'string' },
          cst: { type: 'string' },
          cClassTrib: { type: 'string' },
          cAtivSN: { type: 'string' },
          baseCalculo: { type: 'string' },
          quantidade: { type: 'string' },
          unidade: { type: 'string' },
          vProd: { type: 'string' },
          vFrete: { type: 'string' },
          vSeg: { type: 'string' },
          vOutro: { type: 'string' },
          vDesc: { type: 'string' },
          vICMS: { type: 'string' },
          vPIS: { type: 'string' },
          vCOFINS: { type: 'string' },
          vIS: { type: 'string' },
          pIBSSN: { type: 'string' },
          pCBSSN: { type: 'string' },
          confidence: {
            type: 'object',
            properties: {
              descricao: CONFIDENCE_FIELD_SCHEMA,
              ncm: CONFIDENCE_FIELD_SCHEMA,
              nbs: CONFIDENCE_FIELD_SCHEMA,
              cst: CONFIDENCE_FIELD_SCHEMA,
              cClassTrib: CONFIDENCE_FIELD_SCHEMA,
              cAtivSN: CONFIDENCE_FIELD_SCHEMA,
              baseCalculo: CONFIDENCE_FIELD_SCHEMA,
              quantidade: CONFIDENCE_FIELD_SCHEMA,
              unidade: CONFIDENCE_FIELD_SCHEMA,
              vProd: CONFIDENCE_FIELD_SCHEMA,
              vFrete: CONFIDENCE_FIELD_SCHEMA,
              vSeg: CONFIDENCE_FIELD_SCHEMA,
              vOutro: CONFIDENCE_FIELD_SCHEMA,
              vDesc: CONFIDENCE_FIELD_SCHEMA,
              vICMS: CONFIDENCE_FIELD_SCHEMA,
              vPIS: CONFIDENCE_FIELD_SCHEMA,
              vCOFINS: CONFIDENCE_FIELD_SCHEMA,
              vIS: CONFIDENCE_FIELD_SCHEMA,
              pIBSSN: CONFIDENCE_FIELD_SCHEMA,
              pCBSSN: CONFIDENCE_FIELD_SCHEMA,
            },
            additionalProperties: CONFIDENCE_FIELD_SCHEMA,
          },
          missingFields: { type: 'array', items: { type: 'string' } },
        },
        required: ['nObj', 'confidence', 'missingFields'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['itens', 'warnings'],
};

const COLUMN_MAPPING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourceColumn: { type: 'string' },
          targetField: { type: ['string', 'null'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low', 'missing'] },
          reason: { type: 'string' },
        },
        required: ['sourceColumn', 'targetField', 'confidence'],
      },
    },
    unmappedColumns: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    suggestedRegime: { type: 'string', enum: ['regime-regular', 'simples-nacional', 'comparativo'] },
  },
  required: ['mappings', 'unmappedColumns', 'warnings'],
};

export function createGoogleGenAIClient(apiKey: string): InteractionsClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    interactions: {
      create: async (params: InteractionCreateParams): Promise<InteractionResponse> => {
        const sdkParams = params as unknown as Parameters<typeof ai.interactions.create>[0];
        const response = await ai.interactions.create(sdkParams);
        return response as unknown as InteractionResponse;
      },
    },
  };
}

function extractResponseText(response: InteractionResponse): string {
  if (typeof response.output_text === 'string' && response.output_text.length > 0) {
    return response.output_text;
  }

  const chunks: string[] = [];
  for (const step of response.steps ?? []) {
    if (step.type === 'model_output' && Array.isArray(step.content)) {
      for (const block of step.content) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          chunks.push(block.text);
        }
      }
    }
  }
  return chunks.join('');
}

function cleanJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }
  return trimmed;
}

function optionalFieldString(val: string | number | null | undefined): string | undefined {
  if (val === null || val === undefined) {
    return undefined;
  }
  const str = String(val).trim();
  return str.length > 0 ? str : undefined;
}

function normalizeVisualItem(
  raw: z.infer<typeof VisualExtractionItemSchema>,
  index: number,
): ExtractionDraftItem {
  const item: ExtractionDraftItem = {
    nObj: raw.nObj ?? index + 1,
    confidence: {},
    missingFields: [],
  };

  const stringFields = [
    'descricao',
    'ncm',
    'nbs',
    'cst',
    'cClassTrib',
    'cAtivSN',
    'baseCalculo',
    'quantidade',
    'unidade',
    'vProd',
    'vFrete',
    'vSeg',
    'vOutro',
    'vDesc',
    'vICMS',
    'vPIS',
    'vCOFINS',
    'vIS',
    'pIBSSN',
    'pCBSSN',
  ] as const;

  const missingSet = new Set<string>(raw.missingFields ?? []);

  for (const field of stringFields) {
    const val = optionalFieldString(raw[field]);
    const declaredConfidence: FieldConfidence | undefined = raw.confidence?.[field];
    if (val !== undefined && declaredConfidence !== 'missing') {
      item[field] = val;
      item.confidence[field] = declaredConfidence ?? 'medium';
    } else if (declaredConfidence === 'missing' || missingSet.has(field)) {
      item.confidence[field] = 'missing';
      missingSet.add(field);
    }
  }

  for (const missingField of missingSet) {
    if (!item.confidence[missingField]) {
      item.confidence[missingField] = 'missing';
    }
  }

  // Ensure critical fiscal classification fields are explicitly flagged when absent
  for (const critical of ['cst', 'cClassTrib', 'baseCalculo'] as const) {
    if (!item[critical]) {
      item.confidence[critical] = 'missing';
      missingSet.add(critical);
    }
  }

  item.missingFields = Array.from(missingSet);
  return item;
}

function formatActiveContextInstruction(context: Partial<OperationContext>): string {
  const entries = Object.entries(context).filter(
    ([, val]) => val !== undefined && val !== null && val !== '',
  );
  if (entries.length === 0) {
    return '';
  }
  return `\n\n[Contexto Ativo da Mesa Fiscal: ${JSON.stringify(Object.fromEntries(entries))}]`;
}

/**
 * Stateless Gemini 4 (`gemini-4-hydrogen`) orchestrator enforcing `store: false` on every
 * `interactions.create(...)` call, deterministic tool replay from `WorkspaceStore`,
 * indirect prompt-injection sandboxing, and zero-hallucination numeric grounding checks.
 */
export class GeminiOrchestrator {
  private readonly repo: DadosAbertosRepository;
  private readonly router: FiscalEngineRouter;
  private readonly store: WorkspaceStore;
  private readonly defaultClient?: InteractionsClient;
  private readonly apiKey?: string;

  constructor(deps: GeminiOrchestratorDeps) {
    this.repo = deps.repo;
    this.router = deps.router;
    this.store = deps.store;
    this.defaultClient = deps.client;
    this.apiKey = deps.apiKey;
  }

  private resolveClient(override?: InteractionsClient): InteractionsClient {
    if (override) {
      return override;
    }
    if (this.defaultClient) {
      return this.defaultClient;
    }
    const key = this.apiKey ?? process.env.GEMINI_API_KEY;
    if (!key || !key.trim()) {
      throw new Error(
        'GEMINI_API_KEY não configurada para chamadas ao Copiloto Gemini.',
      );
    }
    return createGoogleGenAIClient(key.trim());
  }

  /**
   * Single guarded gateway for all Gemini Interactions API calls.
   * Enforces `model: 'gemini-4-hydrogen'`, `store: false`, and never passes `previous_interaction_id`.
   */
  private async callInteractions(
    client: InteractionsClient,
    payload: Omit<InteractionCreateParams, 'model' | 'store' | 'previous_interaction_id'>,
  ): Promise<InteractionResponse> {
    const params: InteractionCreateParams = {
      ...payload,
      model: GEMINI_COPILOT_MODEL,
      store: false,
    };
    const response = await client.interactions.create(params);
    const hasErrors = Array.isArray(response.errors) && response.errors.length > 0;
    if (response.status === 'failed' || response.status === 'cancelled' || hasErrors) {
      const detail = hasErrors
        ? response.errors!
            .map((e) => e.message || e.code || JSON.stringify(e))
            .join('; ')
        : `status=${response.status ?? 'unknown'}`;
      throw new Error(`Falha na interação Gemini (${response.status ?? 'erro'}): ${detail}`);
    }
    return response;
  }

  async runChatTurn(params: RunChatTurnParams): Promise<AssistantTurnRecord> {
    const existingSession = this.store.getSession(params.sessionId);
    if (!existingSession) {
      throw new Error(`Sessão '${params.sessionId}' não encontrada no WorkspaceStore.`);
    }

    const activeSession = params.activeContext
      ? (this.store.updateSessionContext(params.sessionId, params.activeContext) ?? existingSession)
      : existingSession;

    const client = this.resolveClient(params.clientFactory);
    const priorMessages = this.store.listMessages(params.sessionId);

    const replaySteps: Array<Record<string, unknown>> = [];
    for (const msg of priorMessages) {
      if (msg.steps && msg.steps.length > 0) {
        for (const step of msg.steps) {
          replaySteps.push(step as unknown as Record<string, unknown>);
        }
      } else if (msg.role === 'user') {
        replaySteps.push({
          type: 'user_input',
          content: [{ type: 'text', text: msg.content }],
        });
      } else if (msg.role === 'assistant') {
        replaySteps.push({
          type: 'model_output',
          content: [{ type: 'text', text: msg.content }],
        });
      }
    }

    const trimmedMessage = params.userMessage.trim();
    const attachmentBlock = params.attachmentSummary?.trim()
      ? `\n\n${wrapUntrustedDocumentData(params.attachmentSummary, 'attachment_summary')}`
      : '';
    const userTurnText = `${trimmedMessage}${attachmentBlock}`;

    const userInputStep: GeminiTurnStep = {
      type: 'user_input',
      content: [{ type: 'text', text: userTurnText }],
    };

    const userCreatedAt = new Date().toISOString();
    this.store.appendMessage({
      id: crypto.randomUUID(),
      sessionId: params.sessionId,
      role: 'user',
      content: trimmedMessage,
      steps: [userInputStep],
      createdAt: userCreatedAt,
    });

    const currentTurnSteps: GeminiTurnStep[] = [userInputStep];
    const assistantTurnSteps: GeminiTurnStep[] = [];
    const systemInstruction = `${COPILOT_SYSTEM_INSTRUCTION}${formatActiveContextInstruction(activeSession.activeContext)}`;

    let toolIterations = 0;
    let finalText = '';
    let latestSnapshot: CalcRunSnapshot | undefined;
    let latestCalcRunId: string | undefined;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await this.callInteractions(client, {
        system_instruction: systemInstruction,
        input: [
          ...replaySteps,
          ...(currentTurnSteps as unknown as Array<Record<string, unknown>>),
        ],
        tools: FISCAL_TOOL_DECLARATIONS as unknown as Array<Record<string, unknown>>,
      });

      const responseSteps = response.steps ?? [];
      const functionCalls = responseSteps.filter((s) => s.type === 'function_call');

      if (functionCalls.length > 0) {
        toolIterations++;
        for (const call of functionCalls) {
          const callId = call.id || crypto.randomUUID();
          const toolName = call.name || '';
          const args =
            call.arguments && typeof call.arguments === 'object' ? call.arguments : {};

          params.onDelta({
            type: 'tool_start',
            toolName,
            callId,
            args,
          });

          const fnCallStep: GeminiTurnStep = {
            type: 'function_call',
            id: callId,
            name: toolName,
            arguments: args,
          };
          currentTurnSteps.push(fnCallStep);
          assistantTurnSteps.push(fnCallStep);

          const toolResult = await executeFiscalTool(toolName, args, {
            repo: this.repo,
            router: this.router,
            store: this.store,
            sessionId: params.sessionId,
          });

          if (toolResult.snapshot) {
            latestSnapshot = toolResult.snapshot;
            latestCalcRunId = toolResult.snapshot.id;
            params.onDelta({
              type: 'calc_run',
              snapshot: toolResult.snapshot,
            });
          }

          params.onDelta({
            type: 'tool_done',
            toolName,
            callId,
            resultSummary: toolResult.summary,
            calcRunId: toolResult.calcRunId,
          });

          const fnResultStep: GeminiTurnStep = {
            type: 'function_result',
            call_id: callId,
            name: toolName,
            result: JSON.stringify(toolResult.output),
            ...(toolResult.isError ? { is_error: true } : {}),
          };
          currentTurnSteps.push(fnResultStep);
          assistantTurnSteps.push(fnResultStep);
        }
        continue;
      }

      finalText = extractResponseText(response);
      break;
    }

    if (!finalText.trim() && toolIterations >= MAX_TOOL_ITERATIONS) {
      finalText =
        `Limite máximo de ${MAX_TOOL_ITERATIONS} iterações de ferramentas atingido neste turno. ` +
        'Consulte os resultados determinísticos na Mesa Fiscal ou refine sua solicitação.';
    }

    const grounding = verifyNumericGrounding(finalText, latestSnapshot);
    let groundingWarning: string | undefined;
    if (!grounding.grounded && grounding.warning) {
      groundingWarning = grounding.warning;
      finalText = `${finalText}\n\n> ⚠️ **Aviso de Aterramento Determinístico:** ${groundingWarning}`;
    }

    if (finalText) {
      params.onDelta({
        type: 'text_delta',
        delta: finalText,
      });
    }

    const modelStep: GeminiTurnStep = {
      type: 'model_output',
      content: [{ type: 'text', text: finalText }],
    };
    assistantTurnSteps.push(modelStep);

    const assistantCreatedAt = new Date().toISOString();
    const persistedMessage = this.store.appendMessage({
      id: crypto.randomUUID(),
      sessionId: params.sessionId,
      role: 'assistant',
      content: finalText,
      steps: assistantTurnSteps,
      calcRunId: latestCalcRunId,
      groundingWarning,
      createdAt: assistantCreatedAt,
    });

    params.onDelta({
      type: 'done',
      messageId: persistedMessage.id,
      calcRunId: latestCalcRunId,
      groundingWarning,
    });

    return {
      messageId: persistedMessage.id,
      sessionId: params.sessionId,
      content: finalText,
      calcRunId: latestCalcRunId,
      snapshot: latestSnapshot,
      groundingWarning,
      toolIterations,
      steps: assistantTurnSteps,
      createdAt: persistedMessage.createdAt,
    };
  }

  async extractFromVisualDocument(
    fileBuffer: Buffer,
    mimeType: VisualDocumentMimeType,
    filename?: string,
    sessionId?: string,
    clientOverride?: InteractionsClient,
  ): Promise<ExtractionDraft> {
    if (!fileBuffer || fileBuffer.byteLength === 0) {
      throw new Error('Arquivo visual vazio para extração.');
    }

    const client = this.resolveClient(clientOverride);
    const base64Data = fileBuffer.toString('base64');
    const sourceType: ExtractionDraft['sourceType'] =
      mimeType === 'application/pdf' ? 'pdf' : 'image';
    const resolvedFilename =
      filename?.trim() || (sourceType === 'pdf' ? 'documento.pdf' : 'imagem');

    const mediaPart =
      mimeType === 'application/pdf'
        ? { type: 'document', data: base64Data, mime_type: mimeType }
        : { type: 'image', data: base64Data, mime_type: mimeType };

    const extractionPrompt =
      'Extraia APENAS os campos fiscais explicitamente visíveis neste documento para um rascunho estruturado. ' +
      'Para cada item encontrado, informe o nível de confiança por campo ("high", "medium", "low" ou "missing"). ' +
      'NUNCA invente, suponha ou preencha campos ausentes (como CST, cClassTrib, alíquotas ou NCM não impressos); ' +
      'marque-os como "missing" e liste seus nomes em missingFields.';

    const response = await this.callInteractions(client, {
      system_instruction: COPILOT_SYSTEM_INSTRUCTION,
      input: [
        {
          type: 'user_input',
          content: [mediaPart, { type: 'text', text: extractionPrompt }],
        },
      ],
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: VISUAL_EXTRACTION_JSON_SCHEMA,
      },
    });

    const rawText = cleanJsonText(extractResponseText(response));
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch (err) {
      throw new Error('Falha ao interpretar JSON estruturado da extração visual.', {
        cause: err,
      });
    }

    const parsed = VisualExtractionResponseSchema.parse(parsedJson);
    const itens = parsed.itens.map((item, idx) => normalizeVisualItem(item, idx));
    const context: Partial<OperationContext> = {};
    if (parsed.context?.regime) context.regime = parsed.context.regime;
    if (parsed.context?.dhFatoGerador) context.dhFatoGerador = parsed.context.dhFatoGerador;
    if (parsed.context?.tipoDfe) context.tipoDfe = parsed.context.tipoDfe;
    if (parsed.context?.uf && parsed.context.uf.trim().length === 2) {
      context.uf = parsed.context.uf.trim().toUpperCase();
    }
    if (parsed.context?.municipio) context.municipio = parsed.context.municipio;
    if (parsed.context?.crt) context.crt = parsed.context.crt;

    const draft: ExtractionDraft = {
      id: crypto.randomUUID(),
      sessionId,
      sourceType,
      filename: resolvedFilename,
      context,
      itens,
      warnings: [
        ...parsed.warnings,
        'Extração visual sujeita a revisão obrigatória na aba Prévia & Lote.',
      ],
      requiresReview: true,
      createdAt: new Date().toISOString(),
    };

    return this.store.saveExtractionDraft(draft);
  }

  async suggestSpreadsheetMapping(
    headers: string[],
    maskedSampleRows: Record<string, string>[],
    clientOverride?: InteractionsClient,
  ): Promise<ColumnMappingSuggestion> {
    const client = this.resolveClient(clientOverride);
    const sanitizedHeaders = headers.map((h) => maskFiscalPii(String(h ?? '')));
    const doubleMaskedSamples = maskSpreadsheetRowsForLlm(maskedSampleRows.slice(0, 3));

    const payloadJson = JSON.stringify(
      {
        headers: sanitizedHeaders,
        sampleRows: doubleMaskedSamples,
      },
      null,
      2,
    );

    const wrapped = wrapUntrustedDocumentData(
      payloadJson,
      'spreadsheet_headers_and_masked_samples',
    );

    const prompt =
      'Mapeie os cabeçalhos da planilha abaixo para os campos canônicos da Calculadora RTC ' +
      '(descricao, ncm, nbs, cst, cClassTrib, cAtivSN, baseCalculo, quantidade, unidade, ' +
      'vProd, vFrete, vSeg, vOutro, vDesc, vICMS, vPIS, vCOFINS, vIS, pCBS, pIBSUF, pIBSMun, pIBSSN, pCBSSN). ' +
      'Colunas sem correspondência devem receber targetField=null e constar em unmappedColumns.\n\n' +
      wrapped;

    const response = await this.callInteractions(client, {
      system_instruction: COPILOT_SYSTEM_INSTRUCTION,
      input: [
        {
          type: 'user_input',
          content: [{ type: 'text', text: prompt }],
        },
      ],
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: COLUMN_MAPPING_JSON_SCHEMA,
      },
    });

    const rawText = cleanJsonText(extractResponseText(response));
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch (err) {
      throw new Error('Falha ao interpretar JSON de mapeamento de planilha.', {
        cause: err,
      });
    }

    return ColumnMappingResponseSchema.parse(parsedJson);
  }
}

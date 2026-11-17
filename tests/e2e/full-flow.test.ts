import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { DadosAbertosRepository } from '../../src/server/db/dados-abertos-repo.js';
import { openOficialDbReadOnly } from '../../src/server/db/oficial-db.js';
import { WorkspaceStore } from '../../src/server/db/workspace-db.js';
import { FiscalEngineRouter } from '../../src/server/engine/engine-router.js';
import {
  GEMINI_COPILOT_MODEL,
  GeminiOrchestrator,
  type InteractionCreateParams,
  type InteractionResponse,
  type InteractionsClient,
} from '../../src/server/gemini/orchestrator.js';
import { createZeroPiiLogger } from '../../src/server/security/zero-pii-logger.js';
import type { CalcRunSnapshot, ChatStreamEvent } from '../../src/shared/types/fiscal.js';

const SENSITIVE_CPF = '123.456.789-00';
const SENSITIVE_CNPJ = '12.345.678/0001-99';
const SENSITIVE_ACCESS_KEY = '43260112345678000199550010000000011000000010';
const FORMULA_SIMPLE = '=1+1';
const FORMULA_DDE = "=CMD|'/C calc'!A0";

const PERMITTED_LOG_KEYS = new Set([
  'level',
  'timestamp',
  'request_id',
  'method',
  'route',
  'status',
  'duration_ms',
  'error_type',
]);

const SAMPLE_NFSE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe versao="1.00">
  <infNFSe Id="NFS431490222000000000001">
    <nNFSe>1024</nNFSe>
    <dhProc>2027-03-10T10:00:00-03:00</dhProc>
    <emit><CNPJ>${SENSITIVE_CNPJ.replace(/\D/g, '')}</CNPJ><xNome>Prestador E2E LTDA</xNome></emit>
    <valores><vLiq>1000.00</vLiq></valores>
    <DPS>
      <infDPS>
        <nDPS>42</nDPS>
        <serie>1</serie>
        <dCompet>2027-03-10</dCompet>
        <prest><CNPJ>${SENSITIVE_CNPJ.replace(/\D/g, '')}</CNPJ></prest>
        <toma><CPF>${SENSITIVE_CPF.replace(/\D/g, '')}</CPF><xNome>Tomador E2E</xNome></toma>
        <serv>
          <cServ><cTribNac>010101</cTribNac><cNBS>115021000</cNBS><xDescServ>Consultoria Técnica</xDescServ></cServ>
        </serv>
        <valores><vServPrest><vServ>1000.00</vServ></vServPrest></valores>
      </infDPS>
    </DPS>
    <IBSCBS><vBC>1000.00</vBC></IBSCBS>
  </infNFSe>
</NFSe>`;

function buildMultipartPayload(
  parts: Array<{
    name: string;
    filename?: string;
    contentType?: string;
    data: Buffer | string;
  }>,
): { payload: Buffer; contentType: string } {
  const boundary = `----E2EBoundary${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];

  for (const part of parts) {
    const dataBuf = Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data, 'utf8');
    let header = `--${boundary}\r\n`;
    if (part.filename !== undefined) {
      header += `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`;
      header += `Content-Type: ${part.contentType ?? 'application/octet-stream'}\r\n\r\n`;
    } else {
      header += `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`;
    }
    chunks.push(Buffer.from(header, 'utf8'), dataBuf, Buffer.from('\r\n', 'utf8'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('Full-Stack E2E Flow (Upload -> Draft -> Calculate & Chat SSE -> Exports -> Static SPA -> Zero-PII)', () => {
  let oficialDb: Database.Database;
  let repo: DadosAbertosRepository;
  const tempDirs: string[] = [];
  const openApps: Array<{ close: () => Promise<void> }> = [];
  const openStores: WorkspaceStore[] = [];

  beforeAll(() => {
    oficialDb = openOficialDbReadOnly(path.resolve('data/rtc-oficial.db'));
    repo = new DadosAbertosRepository(oficialDb);
  });

  afterEach(async () => {
    while (openApps.length > 0) {
      await openApps.pop()!.close();
    }
    while (openStores.length > 0) {
      openStores.pop()!.close();
    }
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    oficialDb.close();
  });

  it('executes complete fiscal workflow end-to-end with security, parity, exports, SPA serving, and zero-PII logging', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtc-e2e-'));
    tempDirs.push(tmpDir);
    const workspaceDbPath = path.join(tmpDir, 'workspace.db');
    const store = new WorkspaceStore(workspaceDbPath);
    openStores.push(store);

    const router = new FiscalEngineRouter({ db: oficialDb, repo });

    const geminiCalls: InteractionCreateParams[] = [];
    let interactionTurn = 0;

    const mockClient: InteractionsClient = {
      interactions: {
        create: vi.fn(async (params: InteractionCreateParams): Promise<InteractionResponse> => {
          geminiCalls.push(params);
          interactionTurn += 1;

          if (interactionTurn === 1) {
            return {
              id: 'int-e2e-1',
              status: 'requires_action',
              steps: [
                {
                  type: 'function_call',
                  id: 'call-rr-e2e-1',
                  name: 'calculate_regime_regular',
                  arguments: {
                    dhFatoGerador: '2027-03-10T10:00:00-03:00',
                    tipoDfe: 55,
                    uf: 'RS',
                    municipio: 4314902,
                    itens: [
                      {
                        nObj: 1,
                        descricao: `'${FORMULA_SIMPLE}`,
                        ncm: '10063021',
                        cst: '200',
                        cClassTrib: '200003',
                        baseCalculo: '100.00',
                        aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
                      },
                      {
                        nObj: 2,
                        descricao: `'${FORMULA_DDE}`,
                        ncm: '10063021',
                        cst: '000',
                        cClassTrib: '000001',
                        baseCalculo: '1000.00',
                        aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
                      },
                      {
                        nObj: 3,
                        descricao: 'Carne CPF [CPF-REDACTED] CNPJ [CNPJ-REDACTED] Chave [CHAVE-ACESSO-REDACTED]',
                        ncm: '02013000',
                        cst: '200',
                        cClassTrib: '200035',
                        baseCalculo: '80.00',
                        aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
                      },
                    ],
                  },
                },
              ],
            };
          }

          return {
            id: 'int-e2e-2',
            status: 'completed',
            output_text:
              'Apuração determinística concluída: vCBS = R$ 88,00 e vIBS = R$ 1,00 sobre vBC = R$ 1.100,00. O item 3 apresentou REG-011.',
            steps: [
              {
                type: 'model_output',
                content: [
                  {
                    type: 'text',
                    text: 'Apuração determinística concluída: vCBS = R$ 88,00 e vIBS = R$ 1,00 sobre vBC = R$ 1.100,00. O item 3 apresentou REG-011.',
                  },
                ],
              },
            ],
          };
        }),
      },
    };

    const orchestrator = new GeminiOrchestrator({
      repo,
      router,
      store,
      client: mockClient,
    });

    const capturedLogs: string[] = [];
    const logger = createZeroPiiLogger((line) => capturedLogs.push(line));

    const builtDistClient = path.resolve('dist/client');
    const hasBuiltClient = fs.existsSync(path.join(builtDistClient, 'index.html'));
    const staticDir = hasBuiltClient
      ? builtDistClient
      : (() => {
          const fallbackStatic = path.join(tmpDir, 'static-client');
          fs.mkdirSync(path.join(fallbackStatic, 'assets'), { recursive: true });
          fs.writeFileSync(
            path.join(fallbackStatic, 'index.html'),
            '<!doctype html><html><body><div id="root"></div></body></html>',
            'utf8',
          );
          return fallbackStatic;
        })();

    const app = await buildApp({
      db: oficialDb,
      repo,
      store,
      router,
      orchestrator,
      logger,
      staticDir,
    });
    openApps.push(app);

    // ------------------------------------------------------------------------
    // 1. Create session & upload CSV batch with formula payloads, PII & REG-011
    // ------------------------------------------------------------------------
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'Fluxo E2E Completo',
        context: {
          regime: 'regime-regular',
          dhFatoGerador: '2027-03-10',
          tipoDfe: '55',
          uf: 'RS',
          municipio: 4314902,
        },
      },
    });
    expect(sessionRes.statusCode).toBe(201);
    const sessionId = sessionRes.json().session.id as string;

    const csvRows = [
      'descricao,ncm,cst,cClassTrib,baseCalculo',
      `"${FORMULA_SIMPLE}",10063021,200,200003,100.00`,
      `"${FORMULA_DDE}",10063021,000,000001,1000.00`,
      `"Carne CPF ${SENSITIVE_CPF} CNPJ ${SENSITIVE_CNPJ} Chave ${SENSITIVE_ACCESS_KEY}",02013000,200,200035,80.00`,
    ].join('\n');

    const form = buildMultipartPayload([
      { name: 'sessionId', data: sessionId },
      { name: 'file', filename: 'lote-e2e.csv', contentType: 'text/csv', data: csvRows },
    ]);

    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': form.contentType },
      payload: form.payload,
    });
    expect(uploadRes.statusCode).toBe(200);

    const uploadBody = uploadRes.json() as {
      drafts: Array<{
        id: string;
        itens: Array<{
          nObj: number;
          descricao?: string;
          ncm?: string;
          cst?: string;
          cClassTrib?: string;
          baseCalculo?: string;
        }>;
      }>;
      attachmentSummary: string;
    };

    expect(uploadBody.drafts).toHaveLength(1);
    const draft = uploadBody.drafts[0]!;
    expect(draft.itens).toHaveLength(3);
    expect(draft.itens[0]!.descricao).toBe(`'${FORMULA_SIMPLE}`);
    expect(draft.itens[1]!.descricao).toBe(`'${FORMULA_DDE}`);

    // PII must be masked in attachmentSummary before reaching client/LLM
    expect(uploadBody.attachmentSummary).not.toContain(SENSITIVE_CPF);
    expect(uploadBody.attachmentSummary).not.toContain(SENSITIVE_CNPJ);
    expect(uploadBody.attachmentSummary).not.toContain(SENSITIVE_ACCESS_KEY);
    expect(uploadBody.attachmentSummary).toContain('[CPF-REDACTED]');
    expect(uploadBody.attachmentSummary).toContain('[CNPJ-REDACTED]');
    expect(uploadBody.attachmentSummary).toContain('[CHAVE-ACESSO-REDACTED]');

    // Confirm draft in workspace
    const confirmDraftRes = await app.inject({
      method: 'PUT',
      url: `/api/drafts/${draft.id}`,
      payload: { requiresReview: false },
    });
    expect(confirmDraftRes.statusCode).toBe(200);
    expect(confirmDraftRes.json().draft.requiresReview).toBe(false);

    // ------------------------------------------------------------------------
    // 2. Calculate via POST /api/fiscal/calculate AND via POST /api/chat SSE
    // ------------------------------------------------------------------------
    const directCalcRes = await app.inject({
      method: 'POST',
      url: '/api/fiscal/calculate',
      payload: {
        regime: 'regime-regular',
        sessionId,
        input: {
          dhFatoGerador: '2027-03-10T10:00:00-03:00',
          tipoDfe: 55,
          uf: 'RS',
          municipio: 4314902,
          itens: draft.itens.map((it) => ({
            nObj: it.nObj,
            descricao: it.descricao,
            ncm: it.ncm,
            cst: it.cst,
            cClassTrib: it.cClassTrib,
            baseCalculo: it.baseCalculo,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          })),
        },
      },
    });
    expect(directCalcRes.statusCode).toBe(200);
    const directBody = directCalcRes.json() as {
      calcRunId: string;
      snapshot: CalcRunSnapshot;
    };

    const chatPrompt = 'Calcule o lote enviado na planilha e explique eventuais inconsistências.';
    const chatRes = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        sessionId,
        message: chatPrompt,
        attachmentSummary: uploadBody.attachmentSummary,
      },
    });
    expect(chatRes.statusCode).toBe(200);
    expect(chatRes.headers['content-type']).toContain('text/event-stream');

    const sseEvents = chatRes.body
      .split('\n\n')
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.startsWith('data:'))
      .map((chunk) => JSON.parse(chunk.slice('data:'.length).trim()) as ChatStreamEvent);

    expect(
      sseEvents.some((ev) => ev.type === 'tool_start' && ev.toolName === 'calculate_regime_regular'),
    ).toBe(true);
    expect(
      sseEvents.some((ev) => ev.type === 'tool_done' && ev.toolName === 'calculate_regime_regular'),
    ).toBe(true);
    const chatCalcRunEvent = sseEvents.find((ev) => ev.type === 'calc_run');
    const chatDoneEvent = sseEvents.find((ev) => ev.type === 'done');
    expect(chatCalcRunEvent).toBeDefined();
    expect(chatDoneEvent).toBeDefined();
    if (chatDoneEvent?.type === 'done') {
      expect(chatDoneEvent.groundingWarning).toBeUndefined();
      expect(chatDoneEvent.calcRunId).toBeTruthy();
    }

    // Assert store:false and model:'gemini-4-hydrogen' on every interactions.create call
    expect(geminiCalls).toHaveLength(2);
    for (const call of geminiCalls) {
      expect(call.store).toBe(false);
      expect(call.model).toBe(GEMINI_COPILOT_MODEL);
      expect('previous_interaction_id' in call).toBe(false);
    }

    const firstGeminiInputJson = JSON.stringify(geminiCalls[0]!.input);
    expect(firstGeminiInputJson).toContain('<untrusted_document_data');
    expect(firstGeminiInputJson).not.toContain(SENSITIVE_CPF);
    expect(firstGeminiInputJson).not.toContain(SENSITIVE_CNPJ);
    expect(firstGeminiInputJson).not.toContain(SENSITIVE_ACCESS_KEY);

    // ------------------------------------------------------------------------
    // 3. Verify CalcRunSnapshot parity & exports (XML, XLSX, DANFSe PDF)
    // ------------------------------------------------------------------------
    // Verify CalcRunSnapshot parity across direct calculation and chat tool execution
    const chatSnapshot =
      chatCalcRunEvent?.type === 'calc_run' ? chatCalcRunEvent.snapshot : undefined;
    expect(chatSnapshot).toBeDefined();

    const stripItemDesc = (out: CalcRunSnapshot['output']) => {
      const roc = out as {
        itens: Array<Record<string, unknown>>;
        [k: string]: unknown;
      };
      return {
        ...roc,
        itens: roc.itens.map(({ descricao: _d, ...rest }) => rest),
      };
    };
    expect(stripItemDesc(directBody.snapshot.output)).toEqual(
      stripItemDesc(chatSnapshot!.output),
    );

    const persistedSnapshot = store.getCalcRun(directBody.calcRunId);
    expect(persistedSnapshot).not.toBeNull();
    expect(persistedSnapshot!.output).toEqual(directBody.snapshot.output);

    const rocOut = persistedSnapshot!.output as {
      itens: Array<{ nObj: number; estadoItem: string; erros: Array<{ code: string }> }>;
      IBSCBSTot?: {
        vBCIBSCBS: string;
        gCBS: { vCBS: string };
        gIBS: { vIBS: string };
      };
    };
    expect(rocOut.itens).toHaveLength(3);
    expect(rocOut.itens[0]!.estadoItem).toBe('CALCULO_SIMULADO');
    expect(rocOut.itens[1]!.estadoItem).toBe('CALCULO_SIMULADO');
    expect(rocOut.itens[2]!.estadoItem).toBe('INCONSISTENCIA_ENTRADA');
    expect(rocOut.itens[2]!.erros.some((e) => e.code === 'REG-011')).toBe(true);
    expect(rocOut.IBSCBSTot?.vBCIBSCBS).toBe('1100.00');
    expect(rocOut.IBSCBSTot?.gCBS.vCBS).toBe('88.00');
    expect(rocOut.IBSCBSTot?.gIBS.vIBS).toBe('1.00');

    // 3a. XML export excludes REG-011 item and validates <infNFe>...<total><IBSCBSTot>
    const xmlRes = await app.inject({
      method: 'POST',
      url: '/api/export/xml',
      payload: { calcRunId: directBody.calcRunId, tipo: 'nfe' },
    });
    expect(xmlRes.statusCode).toBe(200);
    const xmlBody = xmlRes.json() as {
      generation: {
        supported: boolean;
        xml?: string;
        excludedItems: Array<{ nObj: number; code: string }>;
      };
      validation: { valid: boolean; errors: unknown[] };
    };
    expect(xmlBody.generation.supported).toBe(true);
    expect(xmlBody.validation.valid).toBe(true);
    expect(xmlBody.generation.excludedItems).toHaveLength(1);
    expect(xmlBody.generation.excludedItems[0]).toMatchObject({
      nObj: 3,
      code: 'REG-011',
    });

    const xmlStr = xmlBody.generation.xml!;
    expect(XMLValidator.validate(xmlStr)).toBe(true);
    const xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      processEntities: false,
      parseTagValue: false,
    });
    const parsedXml = xmlParser.parse(xmlStr) as {
      infNFe: {
        det: Array<{ '@_nItem': string }>;
        total: {
          IBSCBSTot: {
            vBCIBSCBS: string;
            gCBS: { vCBS: string };
            gIBS: { vIBS: string };
          };
        };
      };
    };
    expect(parsedXml.infNFe.det).toHaveLength(2);
    expect(parsedXml.infNFe.det.map((d) => d['@_nItem'])).toEqual(['1', '2']);
    expect(parsedXml.infNFe.total.IBSCBSTot.vBCIBSCBS).toBe('1100.00');
    expect(parsedXml.infNFe.total.IBSCBSTot.gCBS.vCBS).toBe('88.00');
    expect(parsedXml.infNFe.total.IBSCBSTot.gIBS.vIBS).toBe('1.00');

    // 3b. XLSX export neutralizes formula cells with leading '
    const xlsxRes = await app.inject({
      method: 'GET',
      url: `/api/export/xlsx/${directBody.calcRunId}`,
    });
    expect(xlsxRes.statusCode).toBe(200);
    expect(xlsxRes.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsxRes.rawPayload as unknown as ArrayBuffer);
    const itensSheet = workbook.getWorksheet('Itens');
    expect(itensSheet).toBeDefined();
    // Row 1 is headers; Row 2 is item 1 (=1+1); Row 3 is item 2 (=CMD...)
    expect(itensSheet!.getRow(2).getCell(3).value).toBe(`'${FORMULA_SIMPLE}`);
    expect(itensSheet!.getRow(3).getCell(3).value).toBe(`'${FORMULA_DDE}`);

    // 3c. DANFSe PDF preview returns %PDF- and X-Danfse-Local-Preview: true
    const danfseRes = await app.inject({
      method: 'POST',
      url: '/api/export/danfse',
      payload: { xml: SAMPLE_NFSE_XML, stc: 0, canhoto: true },
    });
    expect(danfseRes.statusCode).toBe(200);
    expect(danfseRes.headers['content-type']).toBe('application/pdf');
    expect(danfseRes.headers['x-danfse-local-preview']).toBe('true');
    expect(danfseRes.rawPayload.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    // ------------------------------------------------------------------------
    // 4. Built SPA static assets serving when staticDir is passed to buildApp
    // ------------------------------------------------------------------------
    const spaRootRes = await app.inject({ method: 'GET', url: '/' });
    expect(spaRootRes.statusCode).toBe(200);
    expect(spaRootRes.headers['content-type']).toContain('text/html');
    expect(spaRootRes.body).toContain('<div id="root"></div>');

    const spaFallbackRes = await app.inject({ method: 'GET', url: '/simulacao/123' });
    expect(spaFallbackRes.statusCode).toBe(200);
    expect(spaFallbackRes.headers['content-type']).toContain('text/html');
    expect(spaFallbackRes.body).toContain('<div id="root"></div>');

    if (hasBuiltClient) {
      const assetFiles = fs.readdirSync(path.join(builtDistClient, 'assets'));
      const jsAsset = assetFiles.find((f) => f.endsWith('.js'));
      expect(jsAsset).toBeDefined();
      const assetRes = await app.inject({ method: 'GET', url: `/assets/${jsAsset}` });
      expect(assetRes.statusCode).toBe(200);
    }

    // ------------------------------------------------------------------------
    // 5. Verify ZeroPiiLogger strict metadata-only schema & zero PII/XML/prompt
    // ------------------------------------------------------------------------
    expect(capturedLogs.length).toBeGreaterThanOrEqual(8);
    for (const line of capturedLogs) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      for (const key of Object.keys(parsed)) {
        expect(PERMITTED_LOG_KEYS.has(key)).toBe(true);
      }
      expect(typeof parsed.level).toBe('string');
      expect(typeof parsed.timestamp).toBe('string');
      expect(typeof parsed.request_id).toBe('string');
      expect(typeof parsed.method).toBe('string');
      expect(typeof parsed.route).toBe('string');
      expect(typeof parsed.status).toBe('number');
      expect(typeof parsed.duration_ms).toBe('number');
    }

    const joinedLogs = capturedLogs.join('\n');
    expect(joinedLogs).not.toContain(SENSITIVE_CPF);
    expect(joinedLogs).not.toContain(SENSITIVE_CPF.replace(/\D/g, ''));
    expect(joinedLogs).not.toContain(SENSITIVE_CNPJ);
    expect(joinedLogs).not.toContain(SENSITIVE_CNPJ.replace(/\D/g, ''));
    expect(joinedLogs).not.toContain(SENSITIVE_ACCESS_KEY);
    expect(joinedLogs).not.toContain('<infNFe');
    expect(joinedLogs).not.toContain('<infNFSe');
    expect(joinedLogs).not.toContain('Calcule o lote enviado');
    expect(joinedLogs).not.toContain('untrusted_document_data');
  });
});

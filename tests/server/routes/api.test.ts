import type Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../../src/server/app.js';
import { DadosAbertosRepository } from '../../../src/server/db/dados-abertos-repo.js';
import { openOficialDbReadOnly } from '../../../src/server/db/oficial-db.js';
import { WorkspaceStore } from '../../../src/server/db/workspace-db.js';
import { FiscalEngineRouter } from '../../../src/server/engine/engine-router.js';
import {
  GeminiOrchestrator,
  type InteractionResponse,
  type InteractionsClient,
} from '../../../src/server/gemini/orchestrator.js';
import { createZeroPiiLogger } from '../../../src/server/security/zero-pii-logger.js';

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'";

const SAMPLE_NFE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<NFe>
  <infNFe Id="NFe43260112345678000199550010000000011000000010">
    <ide>
      <mod>55</mod>
      <dhEmi>2026-06-01T10:00:00-03:00</dhEmi>
      <cMunFG>4314902</cMunFG>
    </ide>
    <emit>
      <CNPJ>12345678000199</CNPJ>
      <xNome>Empresa Teste LTDA</xNome>
      <enderEmit><UF>RS</UF><cMun>4314902</cMun></enderEmit>
      <CRT>3</CRT>
    </emit>
    <det nItem="1">
      <prod>
        <xProd>Arroz Beneficiado</xProd>
        <NCM>10063021</NCM>
        <vProd>100.00</vProd>
        <qCom>20</qCom>
        <uCom>KG</uCom>
      </prod>
      <imposto>
        <IBSCBS>
          <CST>200</CST>
          <cClassTrib>200003</cClassTrib>
          <gIBSCBS><vBC>100.00</vBC></gIBSCBS>
        </IBSCBS>
      </imposto>
    </det>
  </infNFe>
</NFe>`;

const SAMPLE_NFSE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe versao="1.00">
  <infNFSe Id="NFS431490222000000000001">
    <nNFSe>1024</nNFSe>
    <dhProc>2027-03-10T10:00:00-03:00</dhProc>
    <emit><CNPJ>12345678000199</CNPJ><xNome>Empresa Teste LTDA</xNome></emit>
    <valores><vLiq>1000.00</vLiq></valores>
    <DPS>
      <infDPS>
        <nDPS>42</nDPS>
        <serie>1</serie>
        <dCompet>2027-03-10</dCompet>
        <prest><CNPJ>12345678000199</CNPJ></prest>
        <toma><CNPJ>98765432000100</CNPJ><xNome>Tomador SA</xNome></toma>
        <serv>
          <cServ><cTribNac>010101</cTribNac><cNBS>115021000</cNBS><xDescServ>Consultoria</xDescServ></cServ>
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
  const boundary = `----VitestBoundary${Math.random().toString(16).slice(2)}`;
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

describe('Fastify BFF HTTP Server & API Routes', () => {
  let oficialDb: Database.Database;
  let repo: DadosAbertosRepository;
  const openApps: Array<{ close: () => Promise<void> }> = [];
  const openStores: WorkspaceStore[] = [];

  beforeAll(() => {
    oficialDb = openOficialDbReadOnly();
    repo = new DadosAbertosRepository(oficialDb);
  });

  afterEach(async () => {
    while (openApps.length > 0) {
      const app = openApps.pop()!;
      await app.close();
    }
    while (openStores.length > 0) {
      const store = openStores.pop()!;
      store.close();
    }
    delete process.env.ALLOWED_ORIGINS;
  });

  afterAll(() => {
    oficialDb.close();
  });

  async function createTestHarness(options?: {
    geminiClient?: InteractionsClient;
    router?: FiscalEngineRouter;
    allowedOrigins?: string[];
    rateLimitMax?: number;
  }) {
    const store = new WorkspaceStore(':memory:');
    openStores.push(store);
    const router = options?.router ?? new FiscalEngineRouter({ db: oficialDb, repo });
    const orchestrator = new GeminiOrchestrator({
      repo,
      router,
      store,
      client: options?.geminiClient,
    });
    const logLines: string[] = [];
    const logger = createZeroPiiLogger((line) => logLines.push(line));
    const app = await buildApp({
      repo,
      store,
      router,
      orchestrator,
      logger,
      allowedOrigins: options?.allowedOrigins,
      rateLimitMax: options?.rateLimitMax,
    });
    openApps.push(app);
    return { app, store, router, orchestrator, logLines };
  }

  describe('Security Headers, Request ID, Zero-PII Logger & CORS', () => {
    it('sets mandatory security headers, replaces incoming X-Request-ID with fresh 32-hex ID, and logs zero PII', async () => {
      const { app, logLines } = await createTestHarness();

      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          'x-request-id': 'attacker-forged-id-12345678901234',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-security-policy']).toBe(EXPECTED_CSP);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');

      const requestId = res.headers['x-request-id'];
      expect(typeof requestId).toBe('string');
      expect(requestId).not.toBe('attacker-forged-id-12345678901234');
      expect(requestId).toMatch(/^[0-9a-f]{32}$/);

      expect(logLines.length).toBeGreaterThan(0);
      const parsedLog = JSON.parse(logLines[logLines.length - 1]!) as Record<string, unknown>;
      expect(parsedLog.request_id).toBe(requestId);
      expect(parsedLog.method).toBe('GET');
      expect(parsedLog.route).toBe('/api/health');
      expect(parsedLog.status).toBe(200);
      expect(typeof parsedLog.duration_ms).toBe('number');
    });

    it('rejects wildcard * in allowedOrigins and blocks unlisted Origin headers with 403', async () => {
      await expect(createTestHarness({ allowedOrigins: ['*'] })).rejects.toThrow();

      process.env.ALLOWED_ORIGINS = '*';
      await expect(createTestHarness()).rejects.toThrow();
      delete process.env.ALLOWED_ORIGINS;

      const { app } = await createTestHarness();

      const allowedRes = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'http://localhost:5173' },
      });
      expect(allowedRes.statusCode).toBe(200);
      expect(allowedRes.headers['access-control-allow-origin']).toBe('http://localhost:5173');

      const blockedRes = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://evil.example.com' },
      });
      expect(blockedRes.statusCode).toBe(403);
      expect(blockedRes.headers['access-control-allow-origin']).toBeUndefined();
      expect(blockedRes.headers['x-frame-options']).toBe('DENY');
    });
  });

  describe('Health & Dados Abertos & Sessions', () => {
    it('serves GET /api/health and all GET /api/dados-abertos/* endpoints', async () => {
      const { app } = await createTestHarness();

      const healthRes = await app.inject({ method: 'GET', url: '/api/health' });
      expect(healthRes.statusCode).toBe(200);
      const healthBody = healthRes.json();
      expect(healthBody.status).toBe('ok');
      expect(healthBody.oficialDb).toEqual({ ready: true });
      expect(healthBody.engines.regimeRegular.mode).toBe('local-ts');

      const ncmRes = await app.inject({ method: 'GET', url: '/api/dados-abertos/ncm?q=1006' });
      expect(ncmRes.statusCode).toBe(200);
      expect(ncmRes.json().items.length).toBeGreaterThan(0);

      const nbsRes = await app.inject({ method: 'GET', url: '/api/dados-abertos/nbs?q=115' });
      expect(nbsRes.statusCode).toBe(200);
      expect(nbsRes.json().items.length).toBeGreaterThan(0);

      const ctRes = await app.inject({
        method: 'GET',
        url: '/api/dados-abertos/classtrib?q=200003&cst=200',
      });
      expect(ctRes.statusCode).toBe(200);
      expect(ctRes.json().items.some((i: { cClassTrib: string }) => i.cClassTrib === '200003')).toBe(
        true,
      );

      const ufRes = await app.inject({ method: 'GET', url: '/api/dados-abertos/uf' });
      expect(ufRes.statusCode).toBe(200);
      expect(ufRes.json().items.length).toBeGreaterThanOrEqual(27);

      const muniRes = await app.inject({
        method: 'GET',
        url: '/api/dados-abertos/municipios?uf=RS',
      });
      expect(muniRes.statusCode).toBe(200);
      expect(
        muniRes.json().items.some((m: { muniCd: number }) => m.muniCd === 4314902),
      ).toBe(true);

      const ativRes = await app.inject({
        method: 'GET',
        url: '/api/dados-abertos/atividades-simples?data=2027-01-01',
      });
      expect(ativRes.statusCode).toBe(200);
      expect(ativRes.json().items.length).toBeGreaterThan(0);

      const errRes = await app.inject({
        method: 'GET',
        url: '/api/dados-abertos/erros?code=REG-011',
      });
      expect(errRes.statusCode).toBe(200);
      expect(errRes.json().item.codigo).toBe('REG-011');
    });

    it('manages sessions, context patching, and draft editing', async () => {
      const { app } = await createTestHarness();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          title: 'Simulação Inicial',
          context: { regime: 'regime-regular', dhFatoGerador: '2026-06-01', uf: 'RS' },
        },
      });
      expect(createRes.statusCode).toBe(201);
      const sessionId = createRes.json().session.id as string;

      const listRes = await app.inject({ method: 'GET', url: '/api/sessions' });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().sessions.some((s: { id: string }) => s.id === sessionId)).toBe(true);

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/sessions/${sessionId}/context`,
        payload: { context: { municipio: 4314902 } },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().session.activeContext.municipio).toBe(4314902);
      expect(patchRes.json().session.activeContext.uf).toBe('RS');

      const getRes = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json().session.id).toBe(sessionId);
    });
  });

  describe('POST /api/upload & Security Validations', () => {
    it('rejects files larger than 5 MiB (413), XXE XML (400), magic-bytes mismatch (400), and unsupported extensions (415)', async () => {
      const { app } = await createTestHarness();

      // 1. > 5 MiB
      const oversized = Buffer.alloc(5_242_881, 0x41);
      const oversizedForm = buildMultipartPayload([
        { name: 'file', filename: 'grande.csv', contentType: 'text/csv', data: oversized },
      ]);
      const oversizedRes = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': oversizedForm.contentType },
        payload: oversizedForm.payload,
      });
      expect(oversizedRes.statusCode).toBe(413);
      expect(oversizedRes.json().code).toBe('FILE_TOO_LARGE');

      // 2. XXE XML
      const xxeXml = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><NFe>&xxe;</NFe>`;
      const xxeForm = buildMultipartPayload([
        { name: 'file', filename: 'evil.xml', contentType: 'application/xml', data: xxeXml },
      ]);
      const xxeRes = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': xxeForm.contentType },
        payload: xxeForm.payload,
      });
      expect(xxeRes.statusCode).toBe(400);
      expect(xxeRes.json().code).toBe('XXE_REJECTED');

      // 3. Magic bytes mismatch (.pdf with plain text)
      const fakePdfForm = buildMultipartPayload([
        { name: 'file', filename: 'falso.pdf', contentType: 'application/pdf', data: 'not a pdf' },
      ]);
      const fakePdfRes = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': fakePdfForm.contentType },
        payload: fakePdfForm.payload,
      });
      expect(fakePdfRes.statusCode).toBe(400);
      expect(fakePdfRes.json().code).toBe('MAGIC_BYTES_MISMATCH');

      // 4. Unsupported extension (.exe)
      const exeForm = buildMultipartPayload([
        { name: 'file', filename: 'malware.exe', contentType: 'application/octet-stream', data: 'MZ...' },
      ]);
      const exeRes = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': exeForm.contentType },
        payload: exeForm.payload,
      });
      expect(exeRes.statusCode).toBe(415);
      expect(exeRes.json().code).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('accepts valid .csv and .xml files, creates ExtractionDrafts in workspace.db, allows draft editing, and masks PII in attachmentSummary', async () => {
      const { app, store, logLines } = await createTestHarness();

      const csvContent = [
        'descricao,ncm,cst,cClassTrib,baseCalculo,cnpj',
        'Arroz Beneficiado,10063021,200,200003,100.00,12.345.678/0001-99',
      ].join('\n');

      const form = buildMultipartPayload([
        { name: 'file', filename: 'itens.csv', contentType: 'text/csv', data: csvContent },
        { name: 'file', filename: 'nota.xml', contentType: 'application/xml', data: SAMPLE_NFE_XML },
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { 'content-type': form.contentType },
        payload: form.payload,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.drafts).toHaveLength(2);
      expect(body.attachmentSummary).toContain('itens.csv');
      expect(body.attachmentSummary).toContain('nota.xml');
      expect(body.attachmentSummary).not.toContain('12.345.678/0001-99');
      expect(body.attachmentSummary).not.toContain('12345678000199');

      const savedCsvDraft = store.getExtractionDraft(body.drafts[0].id);
      const savedXmlDraft = store.getExtractionDraft(body.drafts[1].id);
      expect(savedCsvDraft?.itens).toHaveLength(1);
      expect(savedXmlDraft?.itens[0]?.ncm).toBe('10063021');

      // Edit draft via PUT /api/drafts/:id
      const putRes = await app.inject({
        method: 'PUT',
        url: `/api/drafts/${body.drafts[0].id}`,
        payload: { requiresReview: false },
      });
      expect(putRes.statusCode).toBe(200);
      expect(putRes.json().draft.requiresReview).toBe(false);

      // Ensure logs never captured CNPJ or XML body
      const allLogs = logLines.join('\n');
      expect(allLogs).not.toContain('12.345.678/0001-99');
      expect(allLogs).not.toContain('12345678000199');
      expect(allLogs).not.toContain('<infNFe');
    });
  });

  describe('POST /api/chat (SSE Streaming & Rate Limiting)', () => {
    it('auto-creates session when omitted and streams SSE events from GeminiOrchestrator', async () => {
      const mockClient: InteractionsClient = {
        interactions: {
          create: vi.fn<InteractionsClient['interactions']['create']>().mockResolvedValue({
            id: 'int-1',
            status: 'completed',
            output_text: 'Operação analisada com sucesso.',
            steps: [
              {
                type: 'model_output',
                content: [{ type: 'text', text: 'Operação analisada com sucesso.' }],
              },
            ],
          } satisfies InteractionResponse),
        },
      };

      const { app, store } = await createTestHarness({ geminiClient: mockClient });

      const res = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: {
          message: 'Explique a transição da CBS em 2026.',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.headers['cache-control']).toBe('no-cache');

      const sessionId = res.headers['x-session-id'] as string;
      expect(sessionId).toBeTruthy();
      expect(store.getSession(sessionId)).not.toBeNull();

      const events = res.body
        .split('\n\n')
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.startsWith('data:'))
        .map((chunk) => JSON.parse(chunk.slice('data:'.length).trim()));

      expect(events.some((ev) => ev.type === 'text_delta')).toBe(true);
      expect(events.some((ev) => ev.type === 'done')).toBe(true);
    });

    it('enforces rate limiting on /api/chat', async () => {
      const mockClient: InteractionsClient = {
        interactions: {
          create: vi.fn<InteractionsClient['interactions']['create']>().mockResolvedValue({
            id: 'int-rl',
            status: 'completed',
            output_text: 'Ok.',
            steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Ok.' }] }],
          }),
        },
      };

      const { app } = await createTestHarness({ geminiClient: mockClient, rateLimitMax: 2 });

      const r1 = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: '1' } });
      const r2 = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: '2' } });
      const r3 = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: '3' } });

      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);
      expect(r3.statusCode).toBe(429);
    });
  });

  describe('POST /api/fiscal/* (Deterministic Calculation & Fail-Closed Recovery)', () => {
    it('calculates Regime Regular deterministically without calling Gemini and persists CalcRunSnapshot', async () => {
      const mockClient: InteractionsClient = {
        interactions: {
          create: vi.fn(),
        },
      };
      const { app, store } = await createTestHarness({ geminiClient: mockClient });

      const calcRes = await app.inject({
        method: 'POST',
        url: '/api/fiscal/calculate',
        payload: {
          regime: 'regime-regular',
          input: {
            dhFatoGerador: '2026-06-01T10:00:00-03:00',
            tipoDfe: 55,
            uf: 'RS',
            municipio: 4314902,
            itens: [
              {
                nObj: 1,
                ncm: '10063021',
                cst: '200',
                cClassTrib: '200003',
                baseCalculo: 100,
              },
            ],
          },
        },
      });

      expect(calcRes.statusCode).toBe(200);
      expect(mockClient.interactions.create).not.toHaveBeenCalled();

      const body = calcRes.json();
      expect(body.calcRunId).toBeTruthy();
      expect(body.snapshot.kind).toBe('regime_regular');
      expect(body.snapshot.output.itens[0].estadoItem).toBe('CALCULADO');
      expect(body.snapshot.output.itens[0].gIBSCBS.gCBS.vCBS).toBe('0.00');
      expect(store.getCalcRun(body.calcRunId)).not.toBeNull();

      const getRunRes = await app.inject({
        method: 'GET',
        url: `/api/calc-runs/${body.calcRunId}`,
      });
      expect(getRunRes.statusCode).toBe(200);
      expect(getRunRes.json().snapshot.id).toBe(body.calcRunId);
    });

    it('returns 503 with canForceLocal: true on RemoteEngineUnavailableError and recovers with forceLocal: true', async () => {
      const failingFetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
      const remoteRouter = new FiscalEngineRouter({
        db: oficialDb,
        repo,
        config: {
          rtcRegimeRegularUrl: 'http://127.0.0.1:18080',
          fetchImpl: failingFetch as unknown as typeof fetch,
          timeoutMs: 500,
        },
      });

      const { app } = await createTestHarness({ router: remoteRouter });

      const basePayload = {
        regime: 'regime-regular',
        input: {
          dhFatoGerador: '2026-06-01',
          tipoDfe: 55,
          uf: 'RS',
          municipio: 4314902,
          itens: [
            {
              nObj: 1,
              ncm: '10063021',
              cst: '200',
              cClassTrib: '200003',
              baseCalculo: 100,
            },
          ],
        },
      };

      const failRes = await app.inject({
        method: 'POST',
        url: '/api/fiscal/calculate',
        payload: basePayload,
      });

      expect(failRes.statusCode).toBe(503);
      const failBody = failRes.json();
      expect(failBody.code).toBe('REMOTE_ENGINE_UNAVAILABLE');
      expect(failBody.capability).toBe('regimeRegular');
      expect(failBody.canForceLocal).toBe(true);

      const recoverRes = await app.inject({
        method: 'POST',
        url: '/api/fiscal/calculate',
        payload: { ...basePayload, forceLocal: true },
      });

      expect(recoverRes.statusCode).toBe(200);
      expect(recoverRes.json().snapshot.engineMode).toBe('local-ts');
    });

    it('supports /api/fiscal/compare, /api/fiscal/base-unificada, and /api/fiscal/fator-r', async () => {
      const { app } = await createTestHarness();

      const compareRes = await app.inject({
        method: 'POST',
        url: '/api/fiscal/compare',
        payload: {
          dhFatoGerador: '2027-03-10',
          tpDoc: 55,
          uf: 'RS',
          municipio: 4314902,
          itens: [
            {
              nObj: 1,
              ncm: '10063021',
              cst: '000',
              cClassTrib: '000001',
              cAtivSN: '01',
              baseCalculo: 1000,
              aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
              pIBSSN: 0.5,
              pCBSSN: 1.2,
            },
          ],
        },
      });
      expect(compareRes.statusCode).toBe(200);
      expect(compareRes.json().snapshot.kind).toBe('comparativo');
      expect(compareRes.json().snapshot.output.elegivel).toBe(true);

      const baseRes = await app.inject({
        method: 'POST',
        url: '/api/fiscal/base-unificada',
        payload: {
          anoFatoGerador: 2027,
          tipoDocumento: 55,
          natureza: 'bem',
          vProd: 1000,
          vICMS: 180,
          vPIS: 16.5,
          vCOFINS: 76,
          vIPI: 50,
        },
      });
      expect(baseRes.statusCode).toBe(200);
      expect(baseRes.json().snapshot.kind).toBe('base_unificada');
      expect(baseRes.json().output.baseRG).toBe('820.00');

      const fatorRes = await app.inject({
        method: 'POST',
        url: '/api/fiscal/fator-r',
        payload: { folha12m: 30000, rbt12m: 100000 },
      });
      expect(fatorRes.statusCode).toBe(200);
      expect(fatorRes.json().output.enquadramentoSugerido).toBe('Anexo III');
    });
  });

  describe('/api/export/* (XML, DANFSe PDF, XLSX, JSON)', () => {
    it('exports XML, DANFSe PDF, XLSX, and JSON with proper content headers', async () => {
      const { app } = await createTestHarness();

      const calcRes = await app.inject({
        method: 'POST',
        url: '/api/fiscal/calculate',
        payload: {
          regime: 'regime-regular',
          input: {
            dhFatoGerador: '2026-06-01',
            tipoDfe: 55,
            uf: 'RS',
            municipio: 4314902,
            itens: [
              {
                nObj: 1,
                ncm: '10063021',
                cst: '200',
                cClassTrib: '200003',
                baseCalculo: 100,
              },
            ],
          },
        },
      });
      const calcRunId = calcRes.json().calcRunId as string;

      // 1. XML export
      const xmlRes = await app.inject({
        method: 'POST',
        url: '/api/export/xml',
        payload: { calcRunId, tipo: 'nfe' },
      });
      expect(xmlRes.statusCode).toBe(200);
      expect(xmlRes.json().generation.supported).toBe(true);
      expect(xmlRes.json().generation.xml).toContain('<IBSCBS>');
      expect(xmlRes.json().validation.valid).toBe(true);

      // 2. DANFSe PDF export
      const danfseRes = await app.inject({
        method: 'POST',
        url: '/api/export/danfse',
        payload: { xml: SAMPLE_NFSE_XML, stc: 0, canhoto: true },
      });
      expect(danfseRes.statusCode).toBe(200);
      expect(danfseRes.headers['content-type']).toBe('application/pdf');
      expect(danfseRes.headers['content-disposition']).toContain('danfse-preview.pdf');
      expect(danfseRes.headers['x-danfse-engine-mode']).toBe('local-ts');
      expect(danfseRes.headers['x-danfse-local-preview']).toBe('true');
      expect(danfseRes.rawPayload.subarray(0, 5).toString('ascii')).toBe('%PDF-');

      // 3. XLSX export
      const xlsxRes = await app.inject({
        method: 'GET',
        url: `/api/export/xlsx/${calcRunId}`,
      });
      expect(xlsxRes.statusCode).toBe(200);
      expect(xlsxRes.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(xlsxRes.headers['content-disposition']).toContain(`auditoria-rtc-${calcRunId}.xlsx`);
      expect(xlsxRes.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

      // 4. JSON export
      const jsonRes = await app.inject({
        method: 'GET',
        url: `/api/export/json/${calcRunId}`,
      });
      expect(jsonRes.statusCode).toBe(200);
      expect(jsonRes.headers['content-type']).toContain('application/json');
      expect(jsonRes.json().id).toBe(calcRunId);
    });
  });
});

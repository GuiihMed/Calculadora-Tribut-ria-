import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DadosAbertosRepository } from '../../../src/server/db/dados-abertos-repo.js';
import { openOficialDbReadOnly } from '../../../src/server/db/oficial-db.js';
import {
  RemoteEngineUnavailableError,
  validateStaticServiceUrl,
} from '../../../src/server/engine/engine-port.js';
import { FiscalEngineRouter } from '../../../src/server/engine/engine-router.js';
import type {
  CalcRunSnapshot,
  CompareRegimesInput,
  ObservabilidadeRocOutput,
  ObservabilidadeSimplesOutput,
  OperacaoInput,
  OperacaoSimplesInput,
} from '../../../src/shared/types/fiscal.js';

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

const SAMPLE_RR_INPUT: OperacaoInput = {
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
      quantidade: 20,
      unidade: 'KG',
    },
  ],
};

const SAMPLE_SN_INPUT: OperacaoSimplesInput = {
  dhFatoGerador: '2027-03-10',
  tpDoc: 55,
  CRT: 1,
  itens: [
    {
      nObj: 1,
      cAtivSN: '01',
      cClassTrib: '000001',
      baseCalculo: 1000,
      pIBSSN: 0.5,
      pCBSSN: 1.2,
    },
  ],
};

const SAMPLE_COMPARE_INPUT: CompareRegimesInput = {
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
};

describe('validateStaticServiceUrl', () => {
  it('accepts valid http and https URLs and strips trailing slash', () => {
    expect(validateStaticServiceUrl('http://localhost:8080/', 'TEST_URL')).toBe(
      'http://localhost:8080',
    );
    expect(validateStaticServiceUrl('https://rtc.rfb.gov.br/api/', 'TEST_URL')).toBe(
      'https://rtc.rfb.gov.br/api',
    );
    expect(validateStaticServiceUrl(undefined, 'TEST_URL')).toBeUndefined();
    expect(validateStaticServiceUrl('   ', 'TEST_URL')).toBeUndefined();
  });

  it('rejects non-http/https protocols, credentials, and malformed URLs', () => {
    expect(() => validateStaticServiceUrl('file:///etc/passwd', 'RTC_REGIME_REGULAR_URL')).toThrow(
      /RTC_REGIME_REGULAR_URL/,
    );
    expect(() => validateStaticServiceUrl('ftp://example.com', 'RTC_SIMPLES_NACIONAL_URL')).toThrow(
      /RTC_SIMPLES_NACIONAL_URL/,
    );
    expect(() => validateStaticServiceUrl('javascript:alert(1)', 'DANFSE_SERVICE_URL')).toThrow();
    expect(() => validateStaticServiceUrl('data:text/plain,hello', 'DANFSE_SERVICE_URL')).toThrow();
    expect(() => validateStaticServiceUrl('not-a-valid-url', 'RTC_REGIME_REGULAR_URL')).toThrow();
    expect(() =>
      validateStaticServiceUrl('https://user:secret@example.com', 'RTC_REGIME_REGULAR_URL'),
    ).toThrow(/credenciais/i);
  });
});

describe('FiscalEngineRouter', () => {
  let db: Database.Database;
  let repo: DadosAbertosRepository;

  beforeAll(() => {
    db = openOficialDbReadOnly();
    repo = new DadosAbertosRepository(db);
  });

  afterAll(() => {
    db.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects invalid static service URLs at router construction time', () => {
    expect(
      () =>
        new FiscalEngineRouter({
          repo,
          config: { rtcRegimeRegularUrl: 'file:///tmp/evil' },
        }),
    ).toThrow(/RTC_REGIME_REGULAR_URL/);

    expect(
      () =>
        new FiscalEngineRouter({
          repo,
          config: { danfseServiceUrl: 'ftp://internal-host/danfse' },
        }),
    ).toThrow(/DANFSE_SERVICE_URL/);
  });

  it('reports independent per-capability status (only DANFSE_SERVICE_URL configured)', () => {
    const router = new FiscalEngineRouter({
      repo,
      config: {
        danfseServiceUrl: 'http://localhost:8085',
      },
    });

    const status = router.getStatus();
    expect(status.regimeRegular.mode).toBe('local-ts');
    expect(status.regimeRegular.endpointConfigured).toBe(false);
    expect(status.simplesNacional.mode).toBe('local-ts');
    expect(status.simplesNacional.endpointConfigured).toBe(false);
    expect(status.danfse.mode).toBe('remote-official');
    expect(status.danfse.endpointConfigured).toBe(true);

    expect(router.getCapabilityMode('regimeRegular')).toBe('local-ts');
    expect(router.getCapabilityMode('simplesNacional')).toBe('local-ts');
    expect(router.getCapabilityMode('danfse')).toBe('remote-official');
    expect(router.getCapabilityMode('danfse', { forceLocal: true })).toBe('local-ts');
  });

  it('detects WASM files on disk for danfse capability, reads process.env when config is omitted, and fails closed unless forceLocal is true', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'danfse-wasm-test-'));
    const wasmFile = path.join(tmpDir, 'danfse.wasm');
    const execJsFile = path.join(tmpDir, 'wasm_exec.js');
    fs.writeFileSync(wasmFile, Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    fs.writeFileSync(execJsFile, '// stub wasm_exec.js');

    try {
      vi.stubEnv('RTC_REGIME_REGULAR_URL', '');
      vi.stubEnv('RTC_SIMPLES_NACIONAL_URL', '');
      vi.stubEnv('DANFSE_SERVICE_URL', '');
      vi.stubEnv('DANFSE_WASM_PATH', wasmFile);
      vi.stubEnv('DANFSE_WASM_EXEC_JS_PATH', execJsFile);

      const router = new FiscalEngineRouter({ repo });
      const status = router.getStatus();
      expect(status.danfse.mode).toBe('remote-official');
      expect(status.danfse.endpointConfigured).toBe(true);
      expect(status.regimeRegular.mode).toBe('local-ts');
      expect(status.simplesNacional.mode).toBe('local-ts');

      await expect(router.generateDanfse(SAMPLE_NFSE_XML, 0, true)).rejects.toThrowError(
        RemoteEngineUnavailableError,
      );

      const fallbackPreview = await router.generateDanfse(SAMPLE_NFSE_XML, 0, true, {
        forceLocal: true,
      });
      expect(fallbackPreview.engineMode).toBe('local-ts');
      expect(fallbackPreview.isLocalPreview).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails closed on HTTP 503 from RTC_REGIME_REGULAR_URL and only succeeds locally with forceLocal: true', async () => {
    const fetchMock = vi.fn(async () => new Response('Service Unavailable', { status: 503 }));

    const router = new FiscalEngineRouter({
      repo,
      config: {
        rtcRegimeRegularUrl: 'http://rfb-rr.local:8080',
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    });

    await expect(router.calculateRegimeRegular(SAMPLE_RR_INPUT)).rejects.toThrowError(
      RemoteEngineUnavailableError,
    );

    try {
      await router.calculateRegimeRegular(SAMPLE_RR_INPUT);
      expect.unreachable('Expected RemoteEngineUnavailableError');
    } catch (err) {
      expect(err).toBeInstanceOf(RemoteEngineUnavailableError);
      const remoteErr = err as RemoteEngineUnavailableError;
      expect(remoteErr.capability).toBe('regimeRegular');
      expect(remoteErr.endpoint).toBe(
        'http://rfb-rr.local:8080/api/calculadora/observabilidade/regime-geral',
      );
      expect(remoteErr.statusCode).toBe(503);
      expect(remoteErr.message).toContain('forceLocal: true');
    }

    const localResult = await router.calculateRegimeRegular(SAMPLE_RR_INPUT, { forceLocal: true });
    expect(localResult.engineMode).toBe('local-ts');
    expect(localResult.output.itens[0]?.estadoItem).toBe('CALCULADO');
  });

  it('fails closed on request timeout from RTC_REGIME_REGULAR_URL', async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }),
    );

    const router = new FiscalEngineRouter({
      repo,
      config: {
        rtcRegimeRegularUrl: 'http://rfb-rr.local:8080',
        timeoutMs: 25,
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    });

    await expect(router.calculateRegimeRegular(SAMPLE_RR_INPUT)).rejects.toThrowError(
      RemoteEngineUnavailableError,
    );
  });

  it('routes Regime Regular, Base Unificada, XML generate/validate, Simples Nacional, and DANFSe to official endpoints when configured', async () => {
    const calls: string[] = [];
    const fakePdf = Buffer.from('%PDF-1.4\n%official-danfse\n%%EOF');

    const fetchMock = vi.fn(async (inputUrl: string | URL | Request) => {
      const url = String(inputUrl);
      calls.push(url);

      if (url.endsWith('/api/calculadora/observabilidade/regime-geral')) {
        const body: ObservabilidadeRocOutput = {
          modo: 'observabilidade',
          dhFatoGerador: '2026-06-01',
          xWarningDadosSimulados: false,
          avisos: [],
          errosGlobais: [],
          itens: [],
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/calculadora/base-calculo/base-calculo-unificada')) {
        return new Response(
          JSON.stringify({ baseRG: '870.00', baseIS: '840.00', baseSN: '1060.00', avisos: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/calculadora/xml/generate')) {
        return new Response('<infNFe><det nItem="1"><imposto /></det></infNFe>', {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        });
      }

      if (url.includes('/api/calculadora/xml/validate')) {
        return new Response(JSON.stringify({ valid: true, errors: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/calculadora/observabilidade/simples-nacional')) {
        const body: ObservabilidadeSimplesOutput = {
          dhFatoGerador: '2027-03-10',
          tpDoc: 55,
          CRT: 1,
          errosGlobais: [],
          avisos: [],
          itens: [],
          totais: {
            vBC: '1000.00',
            vIBSSN: '5.00',
            vCBSSN: '12.00',
            vIBSPendSusp: '0.00',
            vCBSPendSusp: '0.00',
            totalGeral: '17.00',
          },
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/calculadora/base-calculo-unificada/nfse')) {
        return new Response(
          JSON.stringify({ baseRG: '900.00', baseSN: '1000.00', avisos: [], erros: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/danfse')) {
        return new Response(fakePdf, {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    const router = new FiscalEngineRouter({
      repo,
      config: {
        rtcRegimeRegularUrl: 'http://rfb-rr.local:8080',
        rtcSimplesNacionalUrl: 'http://rfb-sn.local:8082',
        danfseServiceUrl: 'http://rfb-danfse.local:8085',
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    });

    const rrRes = await router.calculateRegimeRegular(SAMPLE_RR_INPUT);
    expect(rrRes.engineMode).toBe('remote-official');

    const baseNfeRes = await router.calculateBaseUnificadaNfe({
      anoFatoGerador: 2027,
      tipoDocumento: 55,
      natureza: 'bem',
      vProd: 1000,
    });
    expect(baseNfeRes.engineMode).toBe('remote-official');
    expect(baseNfeRes.output.baseRG).toBe('870.00');

    const snRes = await router.calculateSimplesNacional(SAMPLE_SN_INPUT);
    expect(snRes.engineMode).toBe('remote-official');

    const baseNfseRes = await router.calculateBaseUnificadaNfse({
      anoFatoGerador: 2027,
      vServ: 1000,
    });
    expect(baseNfseRes.engineMode).toBe('remote-official');
    expect(baseNfseRes.output.baseRG).toBe('900.00');

    const snapshot: CalcRunSnapshot = {
      id: 'run-1',
      kind: 'regime_regular',
      engineMode: 'remote-official',
      dhFatoGerador: '2026-06-01',
      context: {},
      input: SAMPLE_RR_INPUT,
      output: rrRes.output,
      xWarningDadosSimulados: false,
      createdAt: new Date().toISOString(),
    };
    const xmlGen = await router.generateTaxXml(snapshot, 'nfe');
    expect(xmlGen.engineMode).toBe('remote-official');
    expect(xmlGen.supported).toBe(true);
    expect(xmlGen.xml).toContain('<infNFe>');

    const xmlVal = await router.validateXml(xmlGen.xml!, 'nfe', 'nota');
    expect(xmlVal.engineMode).toBe('remote-official');
    expect(xmlVal.xsdValidationMode).toBe('xsd-official');
    expect(xmlVal.valid).toBe(true);

    const danfse = await router.generateDanfse(SAMPLE_NFSE_XML, 0, true);
    expect(danfse.engineMode).toBe('remote-official');
    expect(danfse.isLocalPreview).toBe(false);
    expect(danfse.pdf.equals(fakePdf)).toBe(true);

    expect(calls).toEqual([
      'http://rfb-rr.local:8080/api/calculadora/observabilidade/regime-geral',
      'http://rfb-rr.local:8080/api/calculadora/base-calculo/base-calculo-unificada',
      'http://rfb-sn.local:8082/api/calculadora/observabilidade/simples-nacional',
      'http://rfb-sn.local:8082/api/calculadora/base-calculo-unificada/nfse',
      'http://rfb-rr.local:8080/api/calculadora/xml/generate?tipo=nfe',
      'http://rfb-rr.local:8080/api/calculadora/xml/validate?tipo=nfe&subtipo=nota',
      'http://rfb-danfse.local:8085/api/danfse?stc=0&canhoto=true',
    ]);
  });

  it('fails closed in compareRegimes when Simples Nacional remote service fails, and runs locally with forceLocal: true', async () => {
    const fetchMock = vi.fn(async () => new Response('Bad Gateway', { status: 502 }));

    const router = new FiscalEngineRouter({
      repo,
      config: {
        rtcSimplesNacionalUrl: 'http://rfb-sn.local:8082',
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    });

    await expect(router.compareRegimes(SAMPLE_COMPARE_INPUT)).rejects.toThrowError(
      RemoteEngineUnavailableError,
    );

    const localComp = await router.compareRegimes(SAMPLE_COMPARE_INPUT, { forceLocal: true });
    expect(localComp.engineMode).toBe('local-ts');
    expect(localComp.output.elegivel).toBe(true);
    expect(localComp.output.cenarios).toHaveLength(3);
  });

  it('fails closed on DANFSe remote failure and falls back to PDFKit preview only with forceLocal: true', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    const router = new FiscalEngineRouter({
      repo,
      config: {
        danfseServiceUrl: 'http://rfb-danfse.local:8085',
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    });

    await expect(router.generateDanfse(SAMPLE_NFSE_XML, 0, true)).rejects.toThrowError(
      RemoteEngineUnavailableError,
    );

    const preview = await router.generateDanfse(SAMPLE_NFSE_XML, 0, true, { forceLocal: true });
    expect(preview.engineMode).toBe('local-ts');
    expect(preview.isLocalPreview).toBe(true);
    expect(preview.pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('runs all operations locally when no remote endpoints are configured, including calculateFatorR', async () => {
    const router = new FiscalEngineRouter({ repo, config: {} });

    const fatorR = router.calculateFatorR({ folha12m: '28000', rbt12m: '100000' });
    expect(fatorR.enquadramentoSugerido).toBe('Anexo III');

    const baseNfe = await router.calculateBaseUnificadaNfe({
      anoFatoGerador: 2027,
      tipoDocumento: 55,
      natureza: 'bem',
      vProd: 1000,
    });
    expect(baseNfe.engineMode).toBe('local-ts');

    const baseNfse = await router.calculateBaseUnificadaNfse({
      anoFatoGerador: 2027,
      vServ: 1000,
    });
    expect(baseNfse.engineMode).toBe('local-ts');

    const rr = await router.calculateRegimeRegular(SAMPLE_RR_INPUT);
    expect(rr.engineMode).toBe('local-ts');

    const sn = await router.calculateSimplesNacional(SAMPLE_SN_INPUT);
    expect(sn.engineMode).toBe('local-ts');

    const val = await router.validateXml('<IBSCBS><CST>000</CST></IBSCBS>', 'nfe', 'grupo');
    expect(val.engineMode).toBe('local-ts');
    expect(val.xsdValidationMode).toBe('structural-local');
    expect(val.valid).toBe(true);
  });
});

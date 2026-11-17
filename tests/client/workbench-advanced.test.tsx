// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompareTab } from '../../src/client/components/CompareTab';
import { MemoryLegalTab } from '../../src/client/components/MemoryLegalTab';
import { WorkbenchPane } from '../../src/client/components/WorkbenchPane';
import { XmlDanfseTab } from '../../src/client/components/XmlDanfseTab';
import type {
  CalcRunSnapshot,
  CompareRegimesOutput,
  ExtractionDraft,
  OperationContext,
} from '../../src/shared/types/fiscal';

const CONTEXT_2026: Partial<OperationContext> = {
  regime: 'comparativo',
  dhFatoGerador: '2026-07-01',
  tipoDfe: '55',
  uf: 'RS',
  municipio: 4314902,
  crt: 1,
  tpRegimeIBSCBS: 2,
};

const CONTEXT_2027: Partial<OperationContext> = {
  ...CONTEXT_2026,
  dhFatoGerador: '2027-02-01',
};

const DRAFT_WITHOUT_RATES: ExtractionDraft = {
  id: 'draft-cmp-1',
  sessionId: 'sess-cmp',
  sourceType: 'manual',
  filename: 'simulacao.xlsx',
  context: CONTEXT_2027,
  itens: [
    {
      nObj: 1,
      descricao: 'Cerveja artesanal lata 350ml',
      ncm: '22030000',
      cst: '000',
      cClassTrib: '000001',
      cAtivSN: '11',
      baseCalculo: '1000.00',
      vProd: '1000.00',
      vPIS: '16.50',
      vCOFINS: '76.00',
      vICMS: '180.00',
      vIS: '20.00',
      confidence: {
        baseCalculo: 'high',
        cClassTrib: 'high',
      },
      missingFields: [],
    },
  ],
  warnings: [],
  requiresReview: false,
  createdAt: '2026-11-17T15:00:00.000Z',
};

const REGULAR_MEMORY_SNAPSHOT: CalcRunSnapshot = {
  id: 'run-reg-mem-1',
  sessionId: 'sess-cmp',
  kind: 'regime_regular',
  engineMode: 'local-ts',
  dhFatoGerador: '2027-02-01',
  context: CONTEXT_2027,
  input: {},
  output: {
    modo: 'observabilidade',
    dhFatoGerador: '2027-02-01',
    xWarningDadosSimulados: true,
    avisos: ['Dados simulados para 2027+.'],
    errosGlobais: [],
    itens: [
      {
        nObj: 1,
        estadoItem: 'CALCULO_SIMULADO',
        erros: [],
        descricao: 'Cerveja artesanal lata 350ml',
        ncm: '22030000',
        cst: '000',
        cClassTrib: '000001',
        gIS: {
          cstIS: '000',
          cClassTribIS: '000001',
          vBCIS: '1000.00',
          pIS: '2.00',
          vIS: '20.00',
        },
        gIBSCBS: {
          CST: '000',
          cClassTrib: '000001',
          vBC: '1020.00',
          gIBSUF: {
            pIBSUF: '17.70',
            pRedAliq: '0.00',
            pAliqEfet: '17.70',
            vIBSUF: '180.54',
          },
          gIBSMun: {
            pIBSMun: '0.00',
            pRedAliq: '0.00',
            pAliqEfet: '0.00',
            vIBSMun: '0.00',
          },
          vIBS: '180.54',
          gCBS: {
            pCBS: '8.80',
            pRedAliq: '0.00',
            pAliqEfet: '8.80',
            vCBS: '89.76',
          },
        },
        memoriaCalculo: [
          {
            tributo: 'IS',
            baseCalculo: '1000.00',
            aliquotaNominal: '2.00',
            percentualReducao: '0.00',
            aliquotaEfetiva: '2.00',
            valorCalculado: '20.00',
            valorDiferimento: '0.00',
            valorDevido: '20.00',
            expressaoAplicada: 'vBCIS * pIS / 100',
            memoriaTexto: 'IS ad valorem: 1000.00 × 2,00% = R$ 20,00.',
          },
          {
            tributo: 'CBS',
            baseCalculo: '1020.00',
            aliquotaNominal: '8.80',
            percentualReducao: '0.00',
            aliquotaEfetiva: '8.80',
            valorCalculado: '89.76',
            valorDiferimento: '0.00',
            valorDevido: '89.76',
            expressaoAplicada: '(vBC + vIS) * pCBS / 100',
            memoriaTexto: 'Base CBS inclui vIS (1000.00 + 20.00 = 1020.00); 1020.00 × 8,80% = 89,76.',
          },
        ],
        fundamentacoesLegais: [
          {
            codigo: 'LC214-ART12',
            dispositivo: 'LC 214/2025, art. 12 e art. 409',
            descricao: 'Base de cálculo do IBS e da CBS integra o Imposto Seletivo',
            texto: 'O valor do Imposto Seletivo integra a base de cálculo do IBS e da CBS.',
            url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/Lcp214.htm',
          },
        ],
      },
      {
        nObj: 2,
        estadoItem: 'INCONSISTENCIA_ENTRADA',
        erros: [
          {
            code: 'REG-011',
            title: 'NCM incompatível com cClassTrib',
            description: 'NCM 99999999 sem vínculo vigente para cClassTrib 200003.',
            severity: 'error',
          },
        ],
        descricao: 'Item inválido para XML',
        ncm: '99999999',
        cst: '000',
        cClassTrib: '200003',
        memoriaCalculo: [],
        fundamentacoesLegais: [],
      },
    ],
    ISTot: { vIS: '20.00' },
    IBSCBSTot: {
      vBCIBSCBS: '1020.00',
      gIBS: {
        vIBS: '180.54',
        gIBSUF: { vIBSUF: '180.54' },
        gIBSMun: { vIBSMun: '0.00' },
      },
      gCBS: { vCBS: '89.76' },
    },
  },
  xWarningDadosSimulados: true,
  createdAt: '2026-11-17T15:05:00.000Z',
};

const SIMPLES_SNAPSHOT: CalcRunSnapshot = {
  id: 'run-sn-only-1',
  sessionId: 'sess-cmp',
  kind: 'simples_nacional',
  engineMode: 'local-ts',
  dhFatoGerador: '2027-02-01',
  context: {
    regime: 'simples-nacional',
    dhFatoGerador: '2027-02-01',
    tipoDfe: '55',
    crt: 1,
    tpRegimeIBSCBS: 2,
  },
  input: {},
  output: {
    dhFatoGerador: '2027-02-01',
    tpDoc: 55,
    CRT: 1,
    tpRegimeIBSCBS: 2,
    errosGlobais: [],
    avisos: [],
    itens: [
      {
        nObj: 1,
        estadoItem: 'CALCULADO',
        descricao: 'Serviço técnico',
        cAtivSN: '21',
        cClassTrib: '000001',
        modoFatorR: 'OPCIONAL',
        vBC: '1000.00',
        pIBSSN: '1.50',
        pCBSSN: '2.50',
        vIBSSN: '15.00',
        vCBSSN: '25.00',
        vIBSPendSusp: '0.00',
        vCBSPendSusp: '0.00',
        totalItem: '40.00',
        erros: [],
        avisos: [],
        memoriaCalculo: [
          {
            tributo: 'CBSSN',
            baseCalculo: '1000.00',
            aliquotaNominal: '2.50',
            aliquotaEfetiva: '2.50',
            valorCalculado: '25.00',
            valorDevido: '25.00',
            expressaoAplicada: 'vBC * pCBSSN / 100',
            memoriaTexto: 'NT 2026.005 v1.00: CBSSN = 1000.00 × 2,50% = 25,00.',
          },
        ],
        fundamentacoesLegais: [
          {
            codigo: 'NT2026-005',
            dispositivo: 'NT 2026.005 v1.00 (Simples Nacional)',
            descricao: 'Apuração de CBS e IBS no Simples Nacional por alíquota efetiva informada',
            texto: 'Exige pCBSSN e pIBSSN explícitos do optante pelo DAS.',
          },
        ],
      },
    ],
    totais: {
      vBC: '1000.00',
      vIBSSN: '15.00',
      vCBSSN: '25.00',
      vIBSPendSusp: '0.00',
      vCBSPendSusp: '0.00',
      totalGeral: '40.00',
    },
  },
  xWarningDadosSimulados: false,
  createdAt: '2026-11-17T15:10:00.000Z',
};

const COMPARE_OUTPUT: CompareRegimesOutput = {
  elegivel: true,
  dhFatoGerador: '2027-02-01',
  avisos: [
    'Ponte de base com Imposto Seletivo (TRBS_IN_IS_COMPOE_RECEITA = 0): no Regime Regular, o IS compõe a base de cálculo de CBS/IBS (baseCalculo + vIS); no Simples Nacional, baseCalculo é mantida sem o IS e valorImpostoSeletivo é repassado separadamente sem compor a receita bruta interna.',
  ],
  cenarios: [
    {
      cenario: 'regime_regular',
      titulo: 'Regime Regular (Apuração Normal)',
      totalIS: '20.00',
      totalCBS: '89.76',
      totalIBS: '180.54',
      totalTributos: '290.30',
      apropriacaoCreditoAdquirente:
        'Apropriação integral B2B pelo adquirente no Regime Regular: CBS e IBS apropriáveis pelo adquirente.',
      observacoes: [
        'Ponte de base com Imposto Seletivo (TRBS_IN_IS_COMPOE_RECEITA = 0): baseCalculo + vIS.',
      ],
      erros: [],
    },
    {
      cenario: 'simples_crt1',
      titulo: 'Simples Nacional (CRT=1 — Apuração pelo DAS)',
      totalIS: '20.00',
      totalCBS: '25.00',
      totalIBS: '15.00',
      totalTributos: '40.00',
      apropriacaoCreditoAdquirente:
        'Transferência limitada às alíquotas efetivas pagas no DAS (pCBSSN / pIBSSN).',
      observacoes: ['Base SN mantida sem o IS (TRBS_IN_IS_COMPOE_RECEITA = 0).'],
      erros: [],
    },
    {
      cenario: 'simples_hibrido',
      titulo: 'Simples Híbrido (CRT=1, Optante Regime Regular — tpRegimeIBSCBS=1)',
      totalIS: '20.00',
      totalCBS: '89.76',
      totalIBS: '180.54',
      totalTributos: '290.30',
      apropriacaoCreditoAdquirente:
        'Apropriação integral B2B pelo adquirente (Simples Híbrido tpRegimeIBSCBS=1 / VSN-019).',
      observacoes: ['NT 2026.005 (VSN-019): apuração fora do DAS pelo Regime Regular.'],
      erros: [],
    },
    {
      cenario: 'sublimite_crt2',
      titulo: 'Excesso de Sublimite (CRT=2 — CBS no Simples + IBS no Regime Regular)',
      totalIS: '20.00',
      totalCBS: '25.00',
      totalIBS: '180.54',
      totalTributos: '225.54',
      apropriacaoCreditoAdquirente:
        'Crédito misto B2B: CBS limitada ao DAS e IBS integral pelo Regime Regular.',
      observacoes: ['CRT=2: CBS pelo Simples e IBS pelo Regime Regular (RASN_IN_GERA_IBS=0).'],
      erros: [{ code: 'VSN-012', title: 'Aviso de sublimite', severity: 'warning' }],
    },
  ],
};

const COMPARE_SNAPSHOT: CalcRunSnapshot = {
  id: 'run-cmp-2027',
  sessionId: 'sess-cmp',
  kind: 'comparativo',
  engineMode: 'local-ts',
  dhFatoGerador: '2027-02-01',
  context: CONTEXT_2027,
  input: {},
  output: COMPARE_OUTPUT,
  xWarningDadosSimulados: false,
  createdAt: '2026-11-17T15:15:00.000Z',
};

describe('Task 13 Frontend Workbench — CompareTab, MemoryLegalTab & XmlDanfseTab', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock-object-url'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('CompareTab enforces pre-2027 notice + explicit rates, handles 503 forceLocal, compares 4 scenarios, Fator R and 2026/2027/2033 Base Unificada', async () => {
    const onContextPatch = vi.fn();
    const onSnapshotCreated = vi.fn();
    const compareBodies: Array<Record<string, unknown>> = [];
    const baseYearsRequested: number[] = [];
    let failCompareWith503 = true;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/fiscal/compare') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        compareBodies.push(body);
        if (failCompareWith503 && !body.forceLocal) {
          failCompareWith503 = false;
          return new Response(
            JSON.stringify({
              code: 'REMOTE_ENGINE_UNAVAILABLE',
              capability: 'simplesNacional',
              endpoint: 'http://localhost:8082',
              message: 'Serviço Simples Nacional oficial indisponível.',
              canForceLocal: true,
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ calcRunId: COMPARE_SNAPSHOT.id, snapshot: COMPARE_SNAPSHOT }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/fiscal/fator-r') {
        return new Response(
          JSON.stringify({
            output: {
              folha12m: '32000.00',
              rbt12m: '100000.00',
              fatorR: '0.3200',
              enquadramentoSugerido: 'Anexo III',
              avisoLegal:
                'Indicador meramente auxiliar e orientativo (LC 123/2006, art. 18, §§ 5º-J e 5º-M).',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/fiscal/base-unificada') {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          input?: { anoFatoGerador?: number };
        };
        const year = body.input?.anoFatoGerador ?? 2026;
        baseYearsRequested.push(year);
        const byYear: Record<number, { baseRG: string; baseIS: string; baseSN: string; avisos: string[] }> = {
          2026: {
            baseRG: '727.50',
            baseIS: '727.50',
            baseSN: '1000.00',
            avisos: ['2026: PIS/COFINS e ICMS/ISS deduzidos da base RG/IS.'],
          },
          2027: {
            baseRG: '840.00',
            baseIS: '820.00',
            baseSN: '1020.00',
            avisos: ['2027–2032: PIS e COFINS extintos; ICMS/ISS ainda deduzidos.'],
          },
          2033: {
            baseRG: '1020.00',
            baseIS: '1000.00',
            baseSN: '1020.00',
            avisos: ['2033+: ICMS e ISS extintos; vigência plena do IBS/CBS.'],
          },
        };
        return new Response(
          JSON.stringify({
            calcRunId: `run-bu-${year}`,
            snapshot: { ...COMPARE_SNAPSHOT, id: `run-bu-${year}`, kind: 'base_unificada' },
            output: byYear[year] ?? byYear[2026],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <CompareTab
        snapshot={null}
        draft={DRAFT_WITHOUT_RATES}
        activeContext={CONTEXT_2026}
        sessionId="sess-cmp"
        onContextPatch={onContextPatch}
        onSnapshotCreated={onSnapshotCreated}
      />,
    );

    // 1. Pre-2027 notice + one-click button
    const statusBanner = screen.getByRole('status');
    expect(statusBanner).toHaveTextContent(/NT 2026\.005.*2027-01-01/i);
    fireEvent.click(screen.getByRole('button', { name: /Simular em 2027-01-01/i }));
    expect(onContextPatch).toHaveBeenCalledWith({ dhFatoGerador: '2027-01-01' });

    // 2. Never fabricates rates: empty inputs initially, submitting without rates shows validation error
    const cbsInput = screen.getByLabelText(/Alíquota Nominal CBS/i) as HTMLInputElement;
    const pIbsSnInput = screen.getByLabelText(/pIBSSN/i) as HTMLInputElement;
    const pCbsSnInput = screen.getByLabelText(/pCBSSN/i) as HTMLInputElement;
    expect(cbsInput.value).toBe('');
    expect(pIbsSnInput.value).toBe('');
    expect(pCbsSnInput.value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: /Executar Comparativo/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Informe explicitamente/i);
    expect(compareBodies).toHaveLength(0);

    // 3. Fill explicit rates + check Sublimite CRT=2
    fireEvent.change(cbsInput, { target: { value: '8.80' } });
    fireEvent.change(screen.getByLabelText(/Alíquota Nominal IBS UF/i), {
      target: { value: '17.70' },
    });
    fireEvent.change(screen.getByLabelText(/Alíquota Nominal IBS Mun/i), {
      target: { value: '0.00' },
    });
    fireEvent.change(pIbsSnInput, { target: { value: '1.50' } });
    fireEvent.change(pCbsSnInput, { target: { value: '2.50' } });
    fireEvent.click(screen.getByLabelText(/Incluir Excesso de Sublimite \(CRT=2/i));

    fireEvent.click(screen.getByRole('button', { name: /Executar Comparativo/i }));

    // 503 fail-closed recovery button
    const forceLocalBtn = await screen.findByRole('button', {
      name: /Usar Motor Local \(TS\)/i,
    });
    fireEvent.click(forceLocalBtn);

    await waitFor(() => {
      expect(onSnapshotCreated).toHaveBeenCalledWith(COMPARE_SNAPSHOT);
    });

    expect(compareBodies).toHaveLength(2);
    expect(compareBodies[1]).toMatchObject({
      forceLocal: true,
      input: {
        dhFatoGerador: '2027-01-01',
        incluirSublimiteCrt2: true,
        itens: [
          expect.objectContaining({
            aliquotasNominais: { pCBS: '8.80', pIBSUF: '17.70', pIBSMun: '0.00' },
            pIBSSN: '1.50',
            pCBSSN: '2.50',
          }),
        ],
      },
    });

    // 4. Side-by-side 4 scenarios rendered with tabular-nums
    expect(screen.getAllByText(/Regime Regular \(Apuração Normal\)/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Simples Nacional \(CRT=1/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Simples Híbrido \(CRT=1/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Excesso de Sublimite \(CRT=2/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('290.30').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('40.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('225.54').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/TRBS_IN_IS_COMPOE_RECEITA = 0/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('VSN-012').length).toBeGreaterThanOrEqual(1);

    const tabularCell = screen.getAllByText('225.54')[0];
    expect(tabularCell?.closest('.tabular-nums, td, dd, span')).toHaveClass('tabular-nums');

    // 5. Fator R helper
    fireEvent.change(screen.getByLabelText(/Folha 12m/i), { target: { value: '32000' } });
    fireEvent.change(screen.getByLabelText(/RBT 12m/i), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: /Calcular Fator R/i }));
    await waitFor(() => {
      expect(screen.getByText('Anexo III')).toBeInTheDocument();
    });
    expect(screen.getByText(/Indicador meramente auxiliar e orientativo \(LC 123\/2006/i)).toBeInTheDocument();

    // 6. Base Unificada Yearly Comparison (2026 x 2027 x 2033)
    fireEvent.click(screen.getByRole('button', { name: /Comparar Vigências \(2026 × 2027 × 2033\)/i }));
    await waitFor(() => {
      expect(screen.getAllByText('727.50').length).toBeGreaterThanOrEqual(1);
    });
    expect(baseYearsRequested.sort()).toEqual([2026, 2027, 2033]);
    expect(screen.getByText('840.00')).toBeInTheDocument();
    expect(screen.getAllByText('1020.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/PIS e COFINS extintos/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/ICMS e ISS extintos/i).length).toBeGreaterThanOrEqual(1);
  });

  it('MemoryLegalTab renders expandable <details> traces and LC 214/2025 legal citations without eval/innerHTML', () => {
    const { container, rerender } = render(
      <MemoryLegalTab snapshot={REGULAR_MEMORY_SNAPSHOT} />,
    );

    const detailsElements = container.querySelectorAll('details');
    expect(detailsElements.length).toBeGreaterThanOrEqual(2);
    expect(detailsElements[0]).toHaveAttribute('open');

    // Trace fields with tabular-nums
    expect(screen.getByText('vBCIS * pIS / 100')).toBeInTheDocument();
    expect(screen.getByText('(vBC + vIS) * pCBS / 100')).toBeInTheDocument();
    expect(screen.getByText(/IS ad valorem: 1000\.00/i)).toBeInTheDocument();
    const cbsVals = screen.getAllByText('89.76');
    expect(cbsVals.length).toBeGreaterThanOrEqual(1);
    expect(cbsVals[0]?.closest('td')).toHaveClass('tabular-nums');

    // Legal citations
    expect(screen.getByText(/LC 214\/2025, art\. 12 e art\. 409/i)).toBeInTheDocument();
    const legalLink = screen.getByRole('link', { name: /Ver norma oficial/i });
    expect(legalLink).toHaveAttribute(
      'href',
      'https://www.planalto.gov.br/ccivil_03/leis/lcp/Lcp214.htm',
    );

    // Simples Nacional snapshot memory
    rerender(<MemoryLegalTab snapshot={SIMPLES_SNAPSHOT} />);
    expect(screen.getByText('vBC * pCBSSN / 100')).toBeInTheDocument();
    expect(screen.getByText(/NT 2026\.005 v1\.00 \(Simples Nacional\)/i)).toBeInTheDocument();
  });

  it('XmlDanfseTab blocks XML on Simples Nacional, shows excludedItems & validation on Regime Regular, and handles DANFSe Local vs Official badges', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/export/xml') {
        return new Response(
          JSON.stringify({
            generation: {
              supported: true,
              xml: '<infNFe versao="1.00" tipoDfe="nfe"><det nItem="1"><imposto><IBSCBS><CST>000</CST></IBSCBS></imposto></det></infNFe>',
              excludedItems: [
                {
                  nObj: 2,
                  code: 'REG-011',
                  message: 'NCM incompatível com cClassTrib',
                },
              ],
            },
            validation: {
              valid: true,
              xsdValidationMode: 'structural-local',
              errors: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/export/danfse') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { stc?: number };
        const isOfficial = body.stc === 1;
        return new Response(new Blob(['%PDF-1.4 mock'], { type: 'application/pdf' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'X-Danfse-Engine-Mode': isOfficial ? 'remote-official' : 'local-ts',
            'X-Danfse-Local-Preview': isOfficial ? 'false' : 'true',
          },
        });
      }
      return new Response('{}', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    // 1. Simples Nacional disables XML generation with clear notice
    const { container, rerender } = render(
      <XmlDanfseTab snapshot={SIMPLES_SNAPSHOT} activeContext={CONTEXT_2027} />,
    );

    const generateXmlBtnDisabled = screen.getByRole('button', {
      name: /Gerar & Validar XML RTC/i,
    });
    expect(generateXmlBtnDisabled).toBeDisabled();
    expect(screen.getByText(/exclusivamente ao Regime Regular/i)).toBeInTheDocument();

    // Audit downloads available
    expect(screen.getByRole('link', { name: /Baixar \.xlsx/i })).toHaveAttribute(
      'href',
      '/api/export/xlsx/run-sn-only-1',
    );
    expect(screen.getByRole('link', { name: /Baixar \.json/i })).toHaveAttribute(
      'href',
      '/api/export/json/run-sn-only-1',
    );

    // 2. Regime Regular generates XML, shows excludedItems warning, validation badge, and dark pre/code
    rerender(
      <XmlDanfseTab snapshot={REGULAR_MEMORY_SNAPSHOT} activeContext={CONTEXT_2027} />,
    );

    const generateXmlBtn = screen.getByRole('button', {
      name: /Gerar & Validar XML RTC/i,
    });
    expect(generateXmlBtn).not.toBeDisabled();
    fireEvent.click(generateXmlBtn);

    await waitFor(() => {
      expect(screen.getByText(/Itens excluídos do XML/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Item #2/i)).toBeInTheDocument();
    expect(screen.getByText(/REG-011/i)).toBeInTheDocument();
    expect(screen.getByText(/Validação Estrutural Local/i)).toBeInTheDocument();
    expect(screen.getByText(/XML Válido/i)).toBeInTheDocument();

    const pre = container.querySelector('pre.xml-code-surface');
    expect(pre).not.toBeNull();
    expect(within(pre as HTMLElement).getByText(/<infNFe/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copiar XML/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Baixar \.xml/i })).toBeInTheDocument();

    // 3. DANFSe PDF preview/download with Local Preview vs Go/WASM Oficial badge
    fireEvent.click(screen.getByRole('button', { name: /Carregar XML NFS-e de Exemplo/i }));
    const xmlTextarea = screen.getByLabelText(/XML da NFS-e/i) as HTMLTextAreaElement;
    expect(xmlTextarea.value).toContain('<NFSe');

    fireEvent.click(screen.getByRole('button', { name: /Gerar PDF DANFSe/i }));
    await waitFor(() => {
      expect(screen.getByText('Prévia Local (PDFKit)')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /Baixar PDF DANFSe/i })).toBeInTheDocument();

    // Switch stc=1 to trigger mock Go/WASM Official response
    fireEvent.change(screen.getByLabelText(/Situação \(stc\)/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Gerar PDF DANFSe/i }));
    await waitFor(() => {
      expect(screen.getByText('Go/WASM Oficial RFB')).toBeInTheDocument();
    });
  });

  it('WorkbenchPane mounts CompareTab, MemoryLegalTab, and XmlDanfseTab directly for compare/memory/xml tabs', () => {
    const { rerender } = render(
      <WorkbenchPane
        activeContext={CONTEXT_2027}
        activeTab="compare"
        draft={DRAFT_WITHOUT_RATES}
        snapshot={COMPARE_SNAPSHOT}
        sessionId="sess-cmp"
        onContextPatch={vi.fn()}
        onTabChange={vi.fn()}
        onDraftChange={vi.fn()}
        onSnapshotCreated={vi.fn()}
      />,
    );

    expect(screen.getByText(/Simulador Comparativo entre Regimes/i)).toBeInTheDocument();

    rerender(
      <WorkbenchPane
        activeContext={CONTEXT_2027}
        activeTab="memory"
        draft={DRAFT_WITHOUT_RATES}
        snapshot={REGULAR_MEMORY_SNAPSHOT}
        sessionId="sess-cmp"
        onContextPatch={vi.fn()}
        onTabChange={vi.fn()}
        onDraftChange={vi.fn()}
        onSnapshotCreated={vi.fn()}
      />,
    );

    expect(screen.getByText(/Memória de Cálculo & Fundamentação Legal/i)).toBeInTheDocument();

    rerender(
      <WorkbenchPane
        activeContext={CONTEXT_2027}
        activeTab="xml"
        draft={DRAFT_WITHOUT_RATES}
        snapshot={REGULAR_MEMORY_SNAPSHOT}
        sessionId="sess-cmp"
        onContextPatch={vi.fn()}
        onTabChange={vi.fn()}
        onDraftChange={vi.fn()}
        onSnapshotCreated={vi.fn()}
      />,
    );

    expect(screen.getByText(/XML RTC \(NF-e \/ NFC-e\) & DANFSe/i)).toBeInTheDocument();
  });

  it('syncs CompareTab on snapshot?.id / draft?.id changes, shows vISS label for NFSE, and clears XmlDanfseTab remoteFailure on snapshot change', async () => {
    const newDraft: ExtractionDraft = {
      ...DRAFT_WITHOUT_RATES,
      id: 'draft-cmp-2',
      itens: [
        {
          nObj: 1,
          descricao: 'Serviço novo draft',
          nbs: '1.1301.10.00',
          cst: '200',
          cClassTrib: '200003',
          cAtivSN: '21',
          baseCalculo: '2500.00',
          aliquotasNominais: { pCBS: '3.52', pIBSUF: '7.08', pIBSMun: '0.00' },
          pIBSSN: '1.20',
          pCBSSN: '2.10',
          confidence: { baseCalculo: 'high' },
          missingFields: [],
        },
      ],
    };

    const secondCompareSnapshot: CalcRunSnapshot = {
      ...COMPARE_SNAPSHOT,
      id: 'run-cmp-history-2',
      output: {
        ...COMPARE_OUTPUT,
        cenarios: [
          {
            ...COMPARE_OUTPUT.cenarios[0]!,
            totalTributos: '999.99',
          },
        ],
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/fiscal/compare') {
          return new Response(
            JSON.stringify({ calcRunId: COMPARE_SNAPSHOT.id, snapshot: COMPARE_SNAPSHOT }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url === '/api/export/xml') {
          return new Response(
            JSON.stringify({
              code: 'REMOTE_ENGINE_UNAVAILABLE',
              capability: 'regimeRegular',
              message: 'Serviço remoto indisponível para XML.',
              canForceLocal: true,
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const { rerender } = render(
      <CompareTab
        snapshot={COMPARE_SNAPSHOT}
        draft={DRAFT_WITHOUT_RATES}
        activeContext={{ ...CONTEXT_2027, tipoDfe: 'NFSE' }}
        sessionId="sess-cmp"
        onSnapshotCreated={vi.fn()}
      />,
    );

    // 1. NFSE context shows vISS (R$) label for Base Unificada tax field
    expect(screen.getByLabelText('vISS (R$)')).toBeInTheDocument();

    // 2. Run local comparison so localCompareSnapshot is set, then switch snapshot?.id via HistoryDialog prop
    fireEvent.change(screen.getByLabelText(/Alíquota Nominal CBS/i), { target: { value: '8.80' } });
    fireEvent.change(screen.getByLabelText(/Alíquota Nominal IBS UF/i), { target: { value: '17.70' } });
    fireEvent.change(screen.getByLabelText(/Alíquota Nominal IBS Mun/i), { target: { value: '0.00' } });
    fireEvent.change(screen.getByLabelText(/pIBSSN/i), { target: { value: '1.50' } });
    fireEvent.change(screen.getByLabelText(/pCBSSN/i), { target: { value: '2.50' } });
    fireEvent.click(screen.getByRole('button', { name: /Executar Comparativo/i }));

    await waitFor(() => {
      expect(screen.getAllByText('290.30').length).toBeGreaterThanOrEqual(1);
    });

    // Now switch snapshot?.id and draft?.id
    rerender(
      <CompareTab
        snapshot={secondCompareSnapshot}
        draft={newDraft}
        activeContext={CONTEXT_2027}
        sessionId="sess-cmp"
        onSnapshotCreated={vi.fn()}
      />,
    );

    expect(screen.getAllByText('999.99').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/Base de Cálculo \(sem IS\)/i)).toHaveValue('2500.00');
    expect(screen.getByLabelText(/Alíquota Nominal CBS/i)).toHaveValue('3.52');
    expect(screen.getByLabelText(/pIBSSN/i)).toHaveValue('1.20');
    expect(screen.getByLabelText('vICMS / vISS (R$)')).toBeInTheDocument();

    // 3. XmlDanfseTab clears XML remoteFailure when snapshot?.id changes
    rerender(
      <XmlDanfseTab snapshot={REGULAR_MEMORY_SNAPSHOT} activeContext={CONTEXT_2027} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Gerar & Validar XML RTC/i }));
    await waitFor(() => {
      expect(screen.getByText(/Serviço remoto indisponível para XML/i)).toBeInTheDocument();
    });

    rerender(
      <XmlDanfseTab
        snapshot={{ ...REGULAR_MEMORY_SNAPSHOT, id: 'run-reg-mem-2' }}
        activeContext={CONTEXT_2027}
      />,
    );
    expect(screen.queryByText(/Serviço remoto indisponível para XML/i)).not.toBeInTheDocument();
  });
});

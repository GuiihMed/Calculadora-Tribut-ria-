// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextBar } from '../../src/client/components/ContextBar';
import { ResultsTab } from '../../src/client/components/ResultsTab';
import { StagingTab } from '../../src/client/components/StagingTab';
import { WorkbenchPane } from '../../src/client/components/WorkbenchPane';
import type {
  CalcRunSnapshot,
  ExtractionDraft,
  OperationContext,
} from '../../src/shared/types/fiscal';

const BASE_CONTEXT: Partial<OperationContext> = {
  regime: 'regime-regular',
  dhFatoGerador: '2026-07-01',
  tipoDfe: '55',
  uf: 'RS',
  municipio: 4314902,
  crt: 1,
  tpRegimeIBSCBS: 2,
};

const SAMPLE_DRAFT: ExtractionDraft = {
  id: 'draft-stage-1',
  sessionId: 'sess-1',
  sourceType: 'pdf',
  filename: 'nota-exemplo.pdf',
  context: BASE_CONTEXT,
  itens: [
    {
      nObj: 1,
      descricao: 'Refrigerante lata 350ml',
      ncm: '22021000',
      cst: '000',
      cClassTrib: '',
      baseCalculo: '1000.00',
      vProd: '1000.00',
      vFrete: '50.00',
      vDesc: '0.00',
      vICMS: '180.00',
      vPIS: '16.50',
      vCOFINS: '76.00',
      aliquotasNominais: {
        pCBS: '8.80',
        pIBSUF: '17.70',
        pIBSMun: '0.00',
      },
      confidence: {
        descricao: 'high',
        ncm: 'medium',
        cClassTrib: 'missing',
        baseCalculo: 'high',
      },
      missingFields: ['cClassTrib'],
    },
  ],
  warnings: ['Verificar cClassTrib para operação 2027+'],
  requiresReview: true,
  createdAt: '2026-11-17T12:00:00.000Z',
};

const SIMULATED_REGULAR_SNAPSHOT: CalcRunSnapshot = {
  id: 'run-reg-2027',
  sessionId: 'sess-1',
  kind: 'regime_regular',
  engineMode: 'local-ts',
  dhFatoGerador: '2027-02-01',
  context: {
    regime: 'regime-regular',
    dhFatoGerador: '2027-02-01',
    tipoDfe: '55',
    uf: 'RS',
    municipio: 4314902,
  },
  input: {},
  output: {
    modo: 'observabilidade',
    dhFatoGerador: '2027-02-01',
    xWarningDadosSimulados: true,
    avisos: [],
    errosGlobais: [],
    itens: [
      {
        nObj: 1,
        estadoItem: 'CALCULO_SIMULADO',
        erros: [],
        descricao: 'Refrigerante lata 350ml',
        ncm: '22021000',
        cst: '000',
        cClassTrib: '000001',
        gIS: {
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
            pAliqEfet: '17.70',
            vIBSUF: '180.54',
          },
          gIBSMun: {
            pIBSMun: '0.00',
            pAliqEfet: '0.00',
            vIBSMun: '0.00',
          },
          vIBS: '180.54',
          gCBS: {
            pCBS: '8.80',
            pAliqEfet: '8.80',
            vCBS: '89.76',
          },
        },
        creditIndicators: {
          cClassTrib: '000001',
          cst: '000',
          descricaoClassificacao: 'Tributação integral IBS/CBS',
          apropriacaoCreditoCbs: true,
          apropriacaoCreditoIbs: true,
          creditoPresumidoFornecedor: false,
          creditoPresumidoAdquirente: false,
          creditoOperacaoAntecedente: 'Manutenção',
          resumoTexto: 'Apropriação CBS: Sim | Apropriação IBS: Sim',
        },
        memoriaCalculo: [],
        fundamentacoesLegais: [],
      },
      {
        nObj: 2,
        estadoItem: 'INCONSISTENCIA_ENTRADA',
        erros: [
          {
            code: 'REG-011',
            title: 'NCM incompatível com cClassTrib',
            description: 'O código NCM informado não possui vínculo vigente para a classificação tributária selecionada.',
            pointer: 'itens[1].ncm',
            severity: 'error',
          },
        ],
        descricao: 'Item com NCM incompatível',
        ncm: '99999999',
        cst: '000',
        cClassTrib: '200003',
        memoriaCalculo: [],
        fundamentacoesLegais: [],
      },
    ],
    ISTot: {
      vIS: '20.00',
    },
    IBSCBSTot: {
      vBCIBSCBS: '1020.00',
      gIBS: {
        vIBS: '180.54',
        gIBSUF: { vIBSUF: '180.54' },
        gIBSMun: { vIBSMun: '0.00' },
      },
      gCBS: {
        vCBS: '89.76',
      },
    },
    splitPaymentGuidance: {
      aplicavel: true,
      vCbsSujeito: '89.76',
      vIbsSujeito: '180.54',
      vTotalSujeito: '270.30',
      orientacao:
        'Valores sujeitos à liquidação financeira via Split Payment (LC 214/2025): CBS de R$ 89.76 e IBS de R$ 180.54.',
      observacaoLegal:
        'LC 214/2025, arts. 31 a 35 — Orientação qualitativa baseada exclusivamente nos débitos calculados.',
    },
  },
  xWarningDadosSimulados: true,
  createdAt: '2026-11-17T12:10:00.000Z',
};

const SIMPLES_SNAPSHOT: CalcRunSnapshot = {
  id: 'run-sn-2027',
  sessionId: 'sess-1',
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
        descricao: 'Serviço contábil',
        cAtivSN: '21',
        cClassTrib: '000001',
        modoFatorR: 'OPCIONAL',
        vBC: '5000.00',
        pIBSSN: '1.50',
        pCBSSN: '2.50',
        vIBSSN: '75.00',
        vCBSSN: '125.00',
        vIBSPendSusp: '0.00',
        vCBSPendSusp: '0.00',
        totalItem: '200.00',
        erros: [],
        avisos: [],
        memoriaCalculo: [],
        fundamentacoesLegais: [],
      },
    ],
    totais: {
      vBC: '5000.00',
      vIBSSN: '75.00',
      vCBSSN: '125.00',
      vIBSPendSusp: '0.00',
      vCBSPendSusp: '0.00',
      totalGeral: '200.00',
    },
    splitPaymentGuidance: {
      aplicavel: true,
      vCbsSujeito: '125.00',
      vIbsSujeito: '75.00',
      vTotalSujeito: '200.00',
      orientacao: 'Valores sujeitos à liquidação financeira via Split Payment no Simples Nacional.',
      observacaoLegal: 'LC 214/2025, arts. 31 a 35.',
    },
  },
  xWarningDadosSimulados: false,
  createdAt: '2026-11-17T12:15:00.000Z',
};

describe('Task 12 Fiscal Workbench — ContextBar, StagingTab, ResultsTab & WorkbenchPane', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders ContextBar with preserved IDs, switches regime/date/UF/DF-e, shows Simples fields & temporal transition badges', async () => {
    const onContextPatch = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/dados-abertos/uf') {
          return new Response(
            JSON.stringify({
              items: [
                { ufCd: 43, nome: 'Rio Grande do Sul', sigla: 'RS' },
                { ufCd: 35, nome: 'São Paulo', sigla: 'SP' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.startsWith('/api/dados-abertos/municipios')) {
          return new Response(
            JSON.stringify({
              items: [
                { muniCd: 4314902, ufCd: 43, nome: 'Porto Alegre', ufSigla: 'RS' },
                { muniCd: 3550308, ufCd: 35, nome: 'São Paulo', ufSigla: 'SP' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const { container, rerender } = render(
      <ContextBar context={BASE_CONTEXT} onContextPatch={onContextPatch} />,
    );

    // Preserved IDs
    expect(container.querySelector('#ctx-regime')).not.toBeNull();
    expect(container.querySelector('#ctx-date')).not.toBeNull();
    expect(container.querySelector('#ctx-dfe')).not.toBeNull();
    expect(container.querySelector('#ctx-uf')).not.toBeNull();

    // 2026 transition badge
    expect(screen.getByTestId('transition-badge')).toHaveTextContent(/2026 Teste/i);
    expect(screen.getByTestId('transition-badge')).toHaveTextContent(/0,9% CBS \/ 0,1% IBS/i);

    // Switch date to 2027..2032 -> 2027+ Sem PIS/COFINS
    fireEvent.change(container.querySelector('#ctx-date')!, { target: { value: '2027-05-01' } });
    expect(onContextPatch).toHaveBeenCalledWith({ dhFatoGerador: '2027-05-01' });

    rerender(
      <ContextBar
        context={{ ...BASE_CONTEXT, dhFatoGerador: '2027-05-01' }}
        onContextPatch={onContextPatch}
      />,
    );
    expect(screen.getByTestId('transition-badge')).toHaveTextContent(/2027\+ Sem PIS\/COFINS/i);

    // Switch date to >= 2033 -> 2033+ Pleno
    rerender(
      <ContextBar
        context={{ ...BASE_CONTEXT, dhFatoGerador: '2033-01-15' }}
        onContextPatch={onContextPatch}
      />,
    );
    expect(screen.getByTestId('transition-badge')).toHaveTextContent(/2033\+ Pleno/i);

    // Switch regime to simples-nacional -> exposes CRT and tpRegimeIBSCBS
    fireEvent.change(container.querySelector('#ctx-regime')!, {
      target: { value: 'simples-nacional' },
    });
    expect(onContextPatch).toHaveBeenCalledWith({ regime: 'simples-nacional' });

    rerender(
      <ContextBar
        context={{ ...BASE_CONTEXT, regime: 'simples-nacional' }}
        onContextPatch={onContextPatch}
      />,
    );
    expect(screen.getByLabelText(/CRT/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Regime IBS\/CBS/i)).toBeInTheDocument();

    // Switch DF-e to NFSE and UF to SP
    fireEvent.change(container.querySelector('#ctx-dfe')!, { target: { value: 'NFSE' } });
    expect(onContextPatch).toHaveBeenCalledWith({ tipoDfe: 'NFSE' });

    fireEvent.change(container.querySelector('#ctx-uf')!, { target: { value: 'sp' } });
    expect(onContextPatch).toHaveBeenCalledWith({ uf: 'SP' });

    // Wait for municipios lookup to populate
    await waitFor(() => {
      expect(screen.getByLabelText(/Município/i)).toBeInTheDocument();
    });
  });

  it('renders StagingTab with confidence badges, inline edits, dados-abertos autocomplete, base/fator-r helpers, calculate POST, and 503 forceLocal recovery', async () => {
    const onDraftChange = vi.fn();
    const onSnapshotCreated = vi.fn();
    const onNavigateTab = vi.fn();
    const calculatePayloads: Array<{ forceLocal?: boolean; input?: unknown }> = [];
    let failFirstWith503 = true;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/dados-abertos/ncm')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                ncmCd: '22030000',
                descricao: 'Cervejas de malte',
                inicioVigencia: '2026-01-01',
                fimVigencia: null,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('/api/dados-abertos/classtrib')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                cltrId: 1,
                cClassTrib: '000001',
                descricao: 'Tributação integral',
                cst: '000',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/fiscal/base-unificada') {
        return new Response(
          JSON.stringify({
            calcRunId: 'run-bu-1',
            snapshot: SIMULATED_REGULAR_SNAPSHOT,
            output: {
              baseRG: '870.00',
              baseIS: '840.00',
              baseSN: '1060.00',
              avisos: ['2027+: PIS e COFINS extintos'],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/fiscal/fator-r') {
        return new Response(
          JSON.stringify({
            output: {
              folha12m: '30000.00',
              rbt12m: '100000.00',
              fatorR: '0.3000',
              enquadramentoSugerido: 'Anexo III',
              avisoLegal: 'Auxílio de enquadramento (não substitui PGDAS-D).',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/fiscal/calculate') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        calculatePayloads.push(body);
        if (failFirstWith503 && !body.forceLocal) {
          failFirstWith503 = false;
          return new Response(
            JSON.stringify({
              code: 'REMOTE_ENGINE_UNAVAILABLE',
              capability: 'regimeRegular',
              endpoint: 'http://localhost:8080',
              message: 'Serviço Java oficial indisponível.',
              canForceLocal: true,
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            calcRunId: SIMULATED_REGULAR_SNAPSHOT.id,
            snapshot: SIMULATED_REGULAR_SNAPSHOT,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    function StagingHarness() {
      const [currentDraft, setCurrentDraft] = useState<ExtractionDraft | null>(SAMPLE_DRAFT);
      return (
        <StagingTab
          draft={currentDraft}
          activeContext={{ ...BASE_CONTEXT, dhFatoGerador: '2027-02-01' }}
          sessionId="sess-1"
          onDraftChange={(next) => {
            setCurrentDraft(next);
            onDraftChange(next);
          }}
          onSnapshotCreated={onSnapshotCreated}
          onNavigateTab={onNavigateTab}
        />
      );
    }

    render(<StagingHarness />);

    // Confidence badges
    expect(screen.getAllByText('Alta').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Revisar').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Faltante').length).toBeGreaterThanOrEqual(1);

    // Inline editing of ncm, cClassTrib, baseCalculo, and aliquotasNominais
    const ncmInput = screen.getByLabelText(/^NCM \(Item 1\)$/i);
    fireEvent.change(ncmInput, { target: { value: '22030000' } });

    const classTribInput = screen.getByLabelText(/^cClassTrib \(Item 1\)$/i);
    fireEvent.change(classTribInput, { target: { value: '000001' } });

    const baseInput = screen.getByLabelText(/Base de Cálculo \(Item 1\)/i);
    fireEvent.change(baseInput, { target: { value: '1250.00' } });

    const cbsRateInput = screen.getByLabelText(/Alíquota CBS % \(Item 1\)/i);
    fireEvent.change(cbsRateInput, { target: { value: '9.10' } });

    expect(onDraftChange).toHaveBeenCalled();

    // Autocomplete NCM lookup
    fireEvent.click(screen.getByRole('button', { name: /Buscar NCM \(Item 1\)/i }));
    await waitFor(() => {
      expect(screen.getByText(/22030000 — Cervejas de malte/i)).toBeInTheDocument();
    });

    // Auxiliary Base Unificada & Fator R quick panel
    fireEvent.click(screen.getByRole('button', { name: /Calcular Base Unificada/i }));
    await waitFor(() => {
      expect(screen.getByText('870.00')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Folha 12m/i), { target: { value: '30000' } });
    fireEvent.change(screen.getByLabelText(/RBT 12m/i), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: /Calcular Fator R/i }));
    await waitFor(() => {
      expect(screen.getByText(/Anexo III/i)).toBeInTheDocument();
    });

    // Primary calculate button -> first hits 503 fail-closed
    fireEvent.click(
      screen.getByRole('button', { name: /Calcular Tributos Determinísticos/i }),
    );

    const forceLocalBtn = await screen.findByRole('button', {
      name: /Usar Motor Local \(TS\)/i,
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/Serviço Java oficial indisponível/i);

    // Retry with forceLocal: true
    fireEvent.click(forceLocalBtn);

    await waitFor(() => {
      expect(onSnapshotCreated).toHaveBeenCalledWith(SIMULATED_REGULAR_SNAPSHOT);
    });
    expect(onNavigateTab).toHaveBeenCalledWith('results');
    expect(calculatePayloads).toHaveLength(2);
    expect(calculatePayloads[1]).toMatchObject({
      forceLocal: true,
      regime: 'regime-regular',
      input: {
        itens: [
          expect.objectContaining({
            ncm: '22030000',
            cClassTrib: '000001',
            baseCalculo: '1250.00',
            aliquotasNominais: expect.objectContaining({ pCBS: '9.10' }),
          }),
        ],
      },
    });
  });

  it('allows creating a manual draft with "+ Adicionar Item" when no draft is loaded in StagingTab', () => {
    const onDraftChange = vi.fn();
    render(
      <StagingTab
        draft={null}
        activeContext={BASE_CONTEXT}
        sessionId="sess-1"
        onDraftChange={onDraftChange}
        onSnapshotCreated={vi.fn()}
        onNavigateTab={vi.fn()}
      />,
    );

    const addBtn = screen.getByRole('button', { name: /\+ Adicionar Item/i });
    fireEvent.click(addBtn);

    expect(onDraftChange).toHaveBeenCalledTimes(1);
    const createdDraft = onDraftChange.mock.calls[0]?.[0] as ExtractionDraft;
    expect(createdDraft.sourceType).toBe('manual');
    expect(createdDraft.itens).toHaveLength(1);
  });

  it('renders ResultsTab with simulated banner, tabular KPIs, REG-011 native <dialog>, creditIndicators, Split Payment, and export links', () => {
    const { container, rerender } = render(
      <ResultsTab snapshot={SIMULATED_REGULAR_SNAPSHOT} />,
    );

    // Simulated warning banner
    const banner = screen.getByTestId('simulated-warning-banner');
    expect(banner).toHaveTextContent(
      /Atenção: Alíquotas simuladas \(2027\+\) — valores nominais informados pelo usuário/i,
    );

    // KPI cards with tabular-nums
    const kpiGrid = container.querySelector('.kpi-grid');
    expect(kpiGrid).not.toBeNull();
    expect(within(kpiGrid as HTMLElement).getByText('CBS')).toBeInTheDocument();
    expect(within(kpiGrid as HTMLElement).getByText('IBS UF')).toBeInTheDocument();
    expect(within(kpiGrid as HTMLElement).getByText('IBS Mun')).toBeInTheDocument();
    expect(within(kpiGrid as HTMLElement).getByText('IS')).toBeInTheDocument();
    expect(within(kpiGrid as HTMLElement).getByText('Total Tributos')).toBeInTheDocument();
    expect(within(kpiGrid as HTMLElement).getByText('89.76')).toHaveClass('tabular-nums');
    expect(within(kpiGrid as HTMLElement).getByText('180.54')).toHaveClass('tabular-nums');
    expect(within(kpiGrid as HTMLElement).getByText('20.00')).toHaveClass('tabular-nums');
    // 89.76 + 180.54 + 20.00 = 290.30
    expect(within(kpiGrid as HTMLElement).getByText('290.30')).toHaveClass('tabular-nums');

    // Item status badges & clickable REG-011 error chip -> native <dialog>
    expect(screen.getByText('CALCULO_SIMULADO')).toBeInTheDocument();
    expect(screen.getByText('INCONSISTENCIA_ENTRADA')).toBeInTheDocument();

    const errorChip = screen.getByRole('button', { name: /REG-011/i });
    fireEvent.click(errorChip);

    const dialog = container.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog).not.toHaveAttribute('role');
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
    expect(within(dialog as HTMLElement).getByText('REG-011')).toBeInTheDocument();
    expect(within(dialog as HTMLElement).getByText(/NCM incompatível com cClassTrib/i)).toBeInTheDocument();
    expect(within(dialog as HTMLElement).getByText(/itens\[1\]\.ncm/i)).toBeInTheDocument();

    // Official CreditIndicators section
    expect(screen.getByText(/Indicadores de Apropriação de Crédito/i)).toBeInTheDocument();
    expect(screen.getByText(/CBS Adquirente/i)).toBeInTheDocument();
    expect(screen.getByText(/IBS Adquirente/i)).toBeInTheDocument();
    expect(screen.getByText(/Crédito Presumido Fornecedor/i)).toBeInTheDocument();
    expect(screen.getByText(/Crédito Presumido Adquirente/i)).toBeInTheDocument();

    // Split Payment qualitative card
    expect(screen.getByText(/Split Payment & Fluxo de Caixa/i)).toBeInTheDocument();
    expect(screen.getAllByText(/LC 214\/2025, Arts\. 31/i).length).toBeGreaterThanOrEqual(1);

    // Export links
    const xlsxLink = screen.getByRole('link', { name: /Exportar Planilha Auditável/i });
    expect(xlsxLink).toHaveAttribute('href', '/api/export/xlsx/run-reg-2027');
    const jsonLink = screen.getByRole('link', { name: /Exportar JSON/i });
    expect(jsonLink).toHaveAttribute('href', '/api/export/json/run-reg-2027');

    // Simples Nacional KPIs
    rerender(<ResultsTab snapshot={SIMPLES_SNAPSHOT} />);
    expect(screen.queryByTestId('simulated-warning-banner')).not.toBeInTheDocument();
    const snKpiGrid = container.querySelector('.kpi-grid') as HTMLElement;
    expect(within(snKpiGrid).getByText('IBSSN')).toBeInTheDocument();
    expect(within(snKpiGrid).getByText('CBSSN')).toBeInTheDocument();
    expect(within(snKpiGrid).getByText('Total Simples')).toBeInTheDocument();
    expect(within(snKpiGrid).getByText('200.00')).toHaveClass('tabular-nums');
  });

  it('hosts all 5 tabs and routes slots cleanly in WorkbenchPane', () => {
    const onTabChange = vi.fn();
    render(
      <WorkbenchPane
        activeContext={BASE_CONTEXT}
        activeTab="compare"
        draft={SAMPLE_DRAFT}
        snapshot={SIMULATED_REGULAR_SNAPSHOT}
        sessionId="sess-1"
        onContextPatch={vi.fn()}
        onTabChange={onTabChange}
        onDraftChange={vi.fn()}
        onSnapshotCreated={vi.fn()}
        renderCompareTab={() => <div data-testid="slot-compare">Comparativo Slot</div>}
      />,
    );

    expect(screen.getByRole('tab', { name: /Prévia & Lote/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Resultado & Créditos/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Comparativo Regimes/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Memória & Base Legal/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /XML & DANFSe/i })).toBeInTheDocument();
    expect(screen.getByTestId('slot-compare')).toHaveTextContent('Comparativo Slot');

    fireEvent.click(screen.getByRole('tab', { name: /Resultado & Créditos/i }));
    expect(onTabChange).toHaveBeenCalledWith('results');
  });

  it('renders >200 municipios without truncation, normalizes NFSE baseIS & clears lookup on remove, and renders base_unificada in ResultsTab', async () => {
    const manyMunicipios = [
      ...Array.from({ length: 205 }, (_, i) => ({
        muniCd: 4300001 + i,
        ufCd: 43,
        nome: `Cidade ${i + 1}`,
        ufSigla: 'RS',
      })),
      { muniCd: 4314902, ufCd: 43, nome: 'Porto Alegre', ufSigla: 'RS' },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/dados-abertos/uf') {
          return new Response(
            JSON.stringify({ items: [{ ufCd: 43, nome: 'Rio Grande do Sul', sigla: 'RS' }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.startsWith('/api/dados-abertos/municipios')) {
          return new Response(JSON.stringify({ items: manyMunicipios }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.startsWith('/api/dados-abertos/ncm')) {
          return new Response(
            JSON.stringify({
              items: [
                { ncmCd: '22021000', descricao: 'Águas', inicioVigencia: '2026-01-01', fimVigencia: null },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url === '/api/fiscal/base-unificada') {
          return new Response(
            JSON.stringify({
              calcRunId: 'run-bu-nfse',
              snapshot: SIMULATED_REGULAR_SNAPSHOT,
              output: {
                baseRG: '900.00',
                baseSN: '1000.00',
                avisos: ['Regra NFS-e aplicada'],
                erros: [],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const { rerender, container } = render(
      <ContextBar context={BASE_CONTEXT} onContextPatch={vi.fn()} />,
    );

    await waitFor(() => {
      const select = container.querySelector('#ctx-municipio') as HTMLSelectElement;
      expect(select?.tagName).toBe('SELECT');
      expect(select.value).toBe('4314902');
      expect(screen.getByText(/Porto Alegre \(4314902\)/)).toBeInTheDocument();
    });

    function NfseStagingHarness() {
      const [draft, setDraft] = useState<ExtractionDraft | null>(SAMPLE_DRAFT);
      return (
        <StagingTab
          draft={draft}
          activeContext={{ ...BASE_CONTEXT, tipoDfe: 'NFSE' }}
          sessionId="sess-1"
          onDraftChange={setDraft}
          onSnapshotCreated={vi.fn()}
          onNavigateTab={vi.fn()}
        />
      );
    }

    rerender(<NfseStagingHarness />);
    expect(screen.getByLabelText(/vICMS \/ vISS \(Item 1\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Calcular Base Unificada/i }));
    await waitFor(() => {
      expect(screen.getByText('0.00')).toBeInTheDocument();
      expect(screen.getByText('900.00')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Buscar NCM \(Item 1\)/i }));
    await waitFor(() => {
      expect(screen.getByText(/22021000 — Águas/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Remover Item 1/i }));
    expect(screen.queryByText(/Dados Abertos RFB/i)).not.toBeInTheDocument();

    const baseUnificadaSnapshot: CalcRunSnapshot = {
      id: 'run-bu-1',
      sessionId: 'sess-1',
      kind: 'base_unificada',
      engineMode: 'local-ts',
      dhFatoGerador: '2027-01-01',
      context: BASE_CONTEXT,
      input: {},
      output: {
        baseRG: '870.00',
        baseIS: '840.00',
        baseSN: '1060.00',
        avisos: ['PIS/COFINS extintos em 2027'],
      },
      xWarningDadosSimulados: false,
      createdAt: '2026-11-17T12:20:00.000Z',
    };

    rerender(<ResultsTab snapshot={baseUnificadaSnapshot} />);
    expect(screen.getByText('Base Regime Regular')).toBeInTheDocument();
    expect(screen.getByText('Base Imposto Seletivo')).toBeInTheDocument();
    expect(screen.getByText('Base Simples Nacional')).toBeInTheDocument();
    expect(screen.getByText('870.00')).toHaveClass('tabular-nums');
    expect(screen.getByText('840.00')).toHaveClass('tabular-nums');
    expect(screen.getByText('1060.00')).toHaveClass('tabular-nums');
    expect(screen.getByText(/PIS\/COFINS extintos em 2027/i)).toBeInTheDocument();
  });
});

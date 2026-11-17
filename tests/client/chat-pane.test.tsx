// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '../../src/client/components/ChatPane';
import { FileDropComposer } from '../../src/client/components/FileDropComposer';
import { MessageBubble } from '../../src/client/components/MessageBubble';
import type {
  CalcRunSnapshot,
  ExtractionDraft,
  OperationContext,
  WorkspaceMessageRecord,
} from '../../src/shared/types/fiscal';

const BASE_CONTEXT: Partial<OperationContext> = {
  regime: 'regime-regular',
  dhFatoGerador: '2026-07-01',
  tipoDfe: '55',
  uf: 'RS',
  municipio: 4314902,
};

const SAMPLE_SNAPSHOT: CalcRunSnapshot = {
  id: 'run-abc-123',
  sessionId: 'sess-1',
  kind: 'regime_regular',
  engineMode: 'local-ts',
  dhFatoGerador: '2026-07-01',
  context: BASE_CONTEXT,
  input: {},
  output: {
    modo: 'observabilidade',
    dhFatoGerador: '2026-07-01',
    xWarningDadosSimulados: false,
    avisos: [],
    errosGlobais: [],
    itens: [
      {
        nObj: 1,
        estadoItem: 'CALCULADO',
        erros: [],
        cst: '000',
        cClassTrib: '000001',
        memoriaCalculo: [],
        fundamentacoesLegais: [],
      },
    ],
    IBSCBSTot: {
      vBCIBSCBS: '1000.00',
      gIBS: {
        vIBS: '1.00',
        gIBSUF: { vIBSUF: '1.00' },
        gIBSMun: { vIBSMun: '0.00' },
      },
      gCBS: {
        vCBS: '9.00',
      },
    },
    ISTot: {
      vIS: '0.00',
    },
  },
  xWarningDadosSimulados: false,
  createdAt: '2026-11-17T12:00:00.000Z',
};

const SAMPLE_DRAFT: ExtractionDraft = {
  id: 'draft-xyz-789',
  sessionId: 'sess-1',
  sourceType: 'pdf',
  filename: 'fatura-servico.pdf',
  context: BASE_CONTEXT,
  itens: [
    {
      nObj: 1,
      descricao: 'Serviço contábil',
      baseCalculo: '2500.00',
      confidence: { baseCalculo: 'high', cst: 'missing', cClassTrib: 'missing' },
      missingFields: ['cst', 'cClassTrib'],
    },
  ],
  warnings: ['Revisar classificação tributária'],
  requiresReview: true,
  createdAt: '2026-11-17T12:00:00.000Z',
};

function makeOversizedFile(name: string, sizeBytes: number): File {
  const file = new File(['x'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

describe('Task 11 Chat Copilot Pane, FileDropComposer & MessageBubble', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('enforces 5 MiB size limit, max 5 files per batch, and allowed extensions on FileDropComposer', () => {
    const onFilesSelected = vi.fn();
    const onSend = vi.fn();

    const { container } = render(
      <FileDropComposer onFilesSelected={onFilesSelected} onSend={onSend} />,
    );

    expect(screen.getByText(/store: false • PII Mascarado/i)).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input).toHaveAttribute('accept', '.xlsx,.csv,.xml,.pdf,.png,.jpg,.jpeg,.webp');
    expect(screen.getByRole('button', { name: /Anexar documento \/ planilha/i })).toBeInTheDocument();

    // 1. Reject file > 5 MiB (5_242_880 bytes)
    const bigPdf = makeOversizedFile('gigante.pdf', 5_242_881);
    fireEvent.change(input, { target: { files: [bigPdf] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/5 MiB/i);
    expect(onFilesSelected).not.toHaveBeenCalled();

    // 2. Reject unsupported extension (.exe)
    const exeFile = new File(['MZ'], 'malware.exe', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [exeFile] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/não suportada|inválid/i);
    expect(onFilesSelected).not.toHaveBeenCalled();

    // 3. Reject more than 5 files in a batch
    const sixFiles = Array.from({ length: 6 }, (_, i) =>
      new File(['a,b'], `planilha-${i + 1}.csv`, { type: 'text/csv' }),
    );
    fireEvent.change(input, { target: { files: sixFiles } });
    expect(screen.getByRole('alert')).toHaveTextContent(/5 arquivos/i);
    expect(onFilesSelected).not.toHaveBeenCalled();

    // 4. Accept valid files via drop zone and render chip with size + removal button
    const validXml = new File(['<nfeProc />'], 'nota-55.xml', { type: 'application/xml' });
    const dropZone = screen.getByTestId('file-drop-zone');
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [validXml],
      },
    });

    expect(onFilesSelected).toHaveBeenCalledTimes(1);
    expect(onFilesSelected).toHaveBeenCalledWith([validXml]);
    expect(screen.getByText('nota-55.xml')).toBeInTheDocument();

    const removeBtn = screen.getByRole('button', { name: /Remover nota-55\.xml/i });
    fireEvent.click(removeBtn);
    expect(screen.queryByText('nota-55.xml')).not.toBeInTheDocument();
  });

  it('supports Enter to send, Shift+Enter for newline, and quick-prompt chips', () => {
    const onSend = vi.fn();
    render(<FileDropComposer onSend={onSend} />);

    const textarea = screen.getByRole('textbox');

    // Shift+Enter should NOT send
    fireEvent.change(textarea, { target: { value: 'Linha 1' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    // Enter without Shift sends
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledWith('Linha 1');

    // Quick-prompt chips
    const quickChip = screen.getByRole('button', { name: /Simular NF-e Regime Regular/i });
    fireEvent.click(quickChip);
    expect(onSend).toHaveBeenCalledWith('Simular NF-e Regime Regular');
    expect(screen.getByRole('button', { name: /Comparar Simples vs Regular \(2027\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Validar NCM x cClassTrib/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Calcular Fator R/i })).toBeInTheDocument();
  });

  it('renders MessageBubble safely without HTML injection, with grounding badge, workbench chips, warning, and forceLocal recovery', () => {
    const onNavigateTab = vi.fn();
    const onRetryForceLocal = vi.fn();

    const msg: WorkspaceMessageRecord = {
      id: 'msg-assist-1',
      sessionId: 'sess-1',
      role: 'assistant',
      content:
        'Cálculo concluído.\n\n- Item 1 validado\n\n<script>window.__xss=1</script> `CST 000`',
      calcRunId: SAMPLE_SNAPSHOT.id,
      draftId: SAMPLE_DRAFT.id,
      groundingWarning: 'Divergência de texto corrigida pelo snapshot determinístico.',
      createdAt: '2026-11-17T12:00:00.000Z',
    };

    const { container } = render(
      <MessageBubble
        message={msg}
        snapshot={SAMPLE_SNAPSHOT}
        draft={SAMPLE_DRAFT}
        remoteEngineError={{
          code: 'REMOTE_ENGINE_UNAVAILABLE',
          capability: 'regimeRegular',
          endpoint: 'http://localhost:8080',
          message: 'Motor oficial remoto indisponível.',
          canForceLocal: true,
        }}
        onNavigateTab={onNavigateTab}
        onRetryForceLocal={onRetryForceLocal}
      />,
    );

    const article = container.querySelector('article.card');
    expect(article).not.toBeNull();
    // Never inject raw HTML scripts
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(/<script>window\.__xss=1<\/script>/)).toBeInTheDocument();

    // Grounding badge & tabular summary figures
    expect(screen.getByText(/Auditado pelo Motor Determinístico RFB/i)).toBeInTheDocument();
    expect(screen.getByText(/run-abc-123/)).toBeInTheDocument();
    expect(screen.getByText('1000.00')).toHaveClass('tabular-nums');
    expect(screen.getByText('9.00')).toHaveClass('tabular-nums');

    // Grounding warning alert
    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((el) => /prevalecem|snapshot/i.test(el.textContent ?? ''))).toBe(true);

    // Workbench action chips
    fireEvent.click(screen.getByRole('button', { name: /Ver Resultado & Créditos/i }));
    expect(onNavigateTab).toHaveBeenCalledWith('results');

    fireEvent.click(screen.getByRole('button', { name: /Ver Memória & Base Legal/i }));
    expect(onNavigateTab).toHaveBeenCalledWith('memory');

    fireEvent.click(screen.getByRole('button', { name: /Comparativo Regimes/i }));
    expect(onNavigateTab).toHaveBeenCalledWith('compare');

    fireEvent.click(screen.getByRole('button', { name: /Gerar XML \/ DANFSe/i }));
    expect(onNavigateTab).toHaveBeenCalledWith('xml');

    fireEvent.click(screen.getByRole('button', { name: /Revisar Prévia & Lote/i }));
    expect(onNavigateTab).toHaveBeenCalledWith('staging');

    // Manual recovery button for RemoteEngineUnavailableError
    const forceLocalBtn = screen.getByRole('button', {
      name: /Reprocessar no Motor Local TS/i,
    });
    fireEvent.click(forceLocalBtn);
    expect(onRetryForceLocal).toHaveBeenCalledTimes(1);
  });

  it('streams SSE events in ChatPane, uploads files to staging, and surfaces RemoteEngineUnavailableError recovery', async () => {
    const onSnapshotCreated = vi.fn();
    const onDraftReady = vi.fn();
    const onNavigateWorkbench = vi.fn();
    const onMessagesChange = vi.fn();
    const onRetryForceLocal = vi.fn();

    let chatCallCount = 0;
    const encoder = new TextEncoder();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === '/api/upload') {
        return new Response(
          JSON.stringify({
            drafts: [SAMPLE_DRAFT],
            attachmentSummary: 'Arquivo: fatura-servico.pdf (pdf, draftId=draft-xyz-789)',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url === '/api/chat') {
        chatCallCount += 1;
        const body = JSON.parse(String(init?.body ?? '{}'));

        if (chatCallCount === 1) {
          expect(body.attachmentSummary).toContain('draft-xyz-789');
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'tool_start',
                    toolName: 'calculate_regime_regular',
                    callId: 'call-1',
                    args: {},
                  })}\n\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'calc_run',
                    snapshot: SAMPLE_SNAPSHOT,
                  })}\n\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'tool_done',
                    toolName: 'calculate_regime_regular',
                    callId: 'call-1',
                    resultSummary: 'CBS R$ 9,00',
                    calcRunId: SAMPLE_SNAPSHOT.id,
                  })}\n\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'text_delta',
                    delta: 'Operação simulada no motor oficial.',
                  })}\n\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'done',
                    messageId: 'msg-srv-1',
                    calcRunId: SAMPLE_SNAPSHOT.id,
                  })}\n\n`,
                ),
              );
              controller.close();
            },
          });

          return new Response(stream, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'X-Session-ID': 'sess-1',
            },
          });
        }

        // Second call returns RemoteEngineUnavailableError (503, canForceLocal: true)
        return new Response(
          JSON.stringify({
            code: 'REMOTE_ENGINE_UNAVAILABLE',
            capability: 'regimeRegular',
            endpoint: 'http://localhost:8080',
            message: 'Serviço oficial RFB indisponível no momento.',
            canForceLocal: true,
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('{}', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(
      <ChatPane
        sessionId="sess-1"
        activeContext={BASE_CONTEXT}
        messages={[]}
        snapshotsById={{}}
        draftsById={{}}
        onMessagesChange={onMessagesChange}
        onSnapshotCreated={onSnapshotCreated}
        onDraftReady={onDraftReady}
        onNavigateWorkbench={onNavigateWorkbench}
        onRetryForceLocal={onRetryForceLocal}
      />,
    );

    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(screen.getByText(/Copiloto Fiscal Gemini • Zero Alucinação/i)).toBeInTheDocument();

    // Upload a PDF file
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pdfFile = new File(['%PDF-1.4'], 'fatura-servico.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [pdfFile] } });

    await waitFor(() => {
      expect(onDraftReady).toHaveBeenCalledWith(SAMPLE_DRAFT);
    });
    expect(onNavigateWorkbench).toHaveBeenCalledWith('staging');

    // Send chat message with attached summary
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Calcular operação desta fatura' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(onSnapshotCreated).toHaveBeenCalledWith(SAMPLE_SNAPSHOT);
    });
    await waitFor(() => {
      expect(screen.getByText(/Operação simulada no motor oficial\./i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Auditado pelo Motor Determinístico RFB/i)).toBeInTheDocument();

    // Trigger second chat turn that fails with RemoteEngineUnavailableError
    fireEvent.click(screen.getByRole('button', { name: /Calcular Fator R/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Reprocessar no Motor Local TS/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Reprocessar no Motor Local TS/i }));
    expect(onRetryForceLocal).toHaveBeenCalledTimes(1);
  });

  it('exercises built-in handleDefaultForceLocal for Simples Nacional (without cst) and Comparativo Regimes', async () => {
    const onSnapshotCreated = vi.fn();
    const calculatePayloads: unknown[] = [];
    const comparePayloads: unknown[] = [];

    const simplesDraftWithoutCst: ExtractionDraft = {
      id: 'draft-sn-1',
      sessionId: 'sess-sn',
      sourceType: 'csv',
      filename: 'simples.csv',
      context: { regime: 'simples-nacional', dhFatoGerador: '2027-02-01' },
      itens: [
        {
          nObj: 1,
          descricao: 'Consultoria Anexo III',
          cAtivSN: '21',
          cClassTrib: '000001',
          baseCalculo: '5000.00',
          pIBSSN: '1.50',
          pCBSSN: '2.50',
          confidence: { baseCalculo: 'high', cClassTrib: 'high' },
          missingFields: [],
        },
      ],
      warnings: [],
      requiresReview: false,
      createdAt: '2026-11-17T12:00:00.000Z',
    };

    const simplesLocalSnapshot: CalcRunSnapshot = {
      id: 'run-sn-local-1',
      sessionId: 'sess-sn',
      kind: 'simples_nacional',
      engineMode: 'local-ts',
      dhFatoGerador: '2027-02-01',
      context: { regime: 'simples-nacional', dhFatoGerador: '2027-02-01', tipoDfe: '55', crt: 1 },
      input: {},
      output: {
        dhFatoGerador: '2027-02-01',
        tpDoc: 55,
        CRT: 1,
        errosGlobais: [],
        avisos: [],
        itens: [],
        totais: {
          vBC: '5000.00',
          vIBSSN: '75.00',
          vCBSSN: '125.00',
          vIBSPendSusp: '0.00',
          vCBSPendSusp: '0.00',
          totalGeral: '200.00',
        },
      },
      xWarningDadosSimulados: false,
      createdAt: '2026-11-17T12:00:00.000Z',
    };

    const comparativoSnapshot: CalcRunSnapshot = {
      id: 'run-cmp-local-1',
      sessionId: 'sess-cmp',
      kind: 'comparativo',
      engineMode: 'local-ts',
      dhFatoGerador: '2027-02-01',
      context: { regime: 'comparativo', dhFatoGerador: '2027-02-01', tipoDfe: '55', uf: 'RS' },
      input: {},
      output: {
        elegivel: true,
        dhFatoGerador: '2027-02-01',
        cenarios: [
          {
            cenario: 'regime_regular',
            titulo: 'Regime Regular',
            totalIS: '0.00',
            totalCBS: '450.00',
            totalIBS: '50.00',
            totalTributos: '500.00',
            apropriacaoCreditoAdquirente: 'Integral',
            observacoes: [],
            erros: [],
          },
        ],
        avisos: [],
      },
      xWarningDadosSimulados: false,
      createdAt: '2026-11-17T12:00:00.000Z',
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/chat') {
        return new Response(
          JSON.stringify({
            code: 'REMOTE_ENGINE_UNAVAILABLE',
            capability: 'simplesNacional',
            endpoint: 'http://localhost:8082',
            message: 'Serviço Simples Nacional remoto indisponível.',
            canForceLocal: true,
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/fiscal/calculate') {
        calculatePayloads.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(
          JSON.stringify({ calcRunId: simplesLocalSnapshot.id, snapshot: simplesLocalSnapshot }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/fiscal/compare') {
        comparePayloads.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(
          JSON.stringify({ calcRunId: comparativoSnapshot.id, snapshot: comparativoSnapshot }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    // 1. Simples Nacional without cst
    const { rerender } = render(
      <ChatPane
        sessionId="sess-sn"
        activeContext={{ regime: 'simples-nacional', dhFatoGerador: '2027-02-01', tipoDfe: '55', crt: 1 }}
        messages={[]}
        activeDraft={simplesDraftWithoutCst}
        onSnapshotCreated={onSnapshotCreated}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Calcular Simples Nacional' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    const retryBtn = await screen.findByRole('button', { name: /Reprocessar no Motor Local TS/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(calculatePayloads).toHaveLength(1);
    });
    expect(calculatePayloads[0]).toMatchObject({
      regime: 'simples-nacional',
      forceLocal: true,
      sessionId: 'sess-sn',
      input: {
        itens: [
          {
            cAtivSN: '21',
            cClassTrib: '000001',
            baseCalculo: '5000.00',
          },
        ],
      },
    });
    expect(onSnapshotCreated).toHaveBeenCalledWith(simplesLocalSnapshot);
    await waitFor(() => {
      expect(screen.getByText(/run-sn-local-1/)).toBeInTheDocument();
    });

    // 2. Comparativo Regimes calls /api/fiscal/compare with forceLocal: true
    const comparativoDraft: ExtractionDraft = {
      ...simplesDraftWithoutCst,
      id: 'draft-cmp-1',
      itens: [
        {
          ...simplesDraftWithoutCst.itens[0]!,
          cst: '000',
        },
      ],
    };

    rerender(
      <ChatPane
        sessionId="sess-cmp"
        activeContext={{ regime: 'comparativo', dhFatoGerador: '2027-02-01', tipoDfe: '55', uf: 'RS' }}
        messages={[]}
        activeDraft={comparativoDraft}
        onSnapshotCreated={onSnapshotCreated}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Comparar regimes 2027' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: false });

    const retryCmpBtn = await screen.findByRole('button', { name: /Reprocessar no Motor Local TS/i });
    fireEvent.click(retryCmpBtn);

    await waitFor(() => {
      expect(comparePayloads).toHaveLength(1);
    });
    expect(comparePayloads[0]).toMatchObject({
      forceLocal: true,
      sessionId: 'sess-cmp',
    });
    expect(onSnapshotCreated).toHaveBeenCalledWith(comparativoSnapshot);
  });

  it('resets transient state on session switch and ignores late SSE events from previous session stream', async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const encoder = new TextEncoder();
    const onSnapshotCreated = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/upload') {
          return new Response(
            JSON.stringify({
              drafts: [SAMPLE_DRAFT],
              attachmentSummary: 'Arquivo: fatura-servico.pdf',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url === '/api/chat') {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              streamController = controller;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'text_delta', delta: 'Sessão A: ' })}\n\n`),
              );
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
          });
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const { container, rerender } = render(
      <ChatPane
        sessionId="sess-A"
        activeContext={BASE_CONTEXT}
        messages={[]}
        onSnapshotCreated={onSnapshotCreated}
      />,
    );

    // Stage an attachment on sess-A, then start a slow stream
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pdfFile = new File(['%PDF-1.4'], 'fatura-servico.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [pdfFile] } });
    await waitFor(() => {
      expect(screen.getByText('fatura-servico.pdf')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Pergunta da sessão A' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(screen.getByText(/Sessão A:/)).toBeInTheDocument();
    });

    // Switch to sess-B while sess-A stream is still open
    rerender(
      <ChatPane
        sessionId="sess-B"
        activeContext={BASE_CONTEXT}
        messages={[]}
        onSnapshotCreated={onSnapshotCreated}
      />,
    );

    // Emit late events on sess-A's stream after switching to sess-B
    streamController?.enqueue(
      encoder.encode(`data: ${JSON.stringify({ type: 'calc_run', snapshot: SAMPLE_SNAPSHOT })}\n\n`),
    );
    streamController?.enqueue(
      encoder.encode(`data: ${JSON.stringify({ type: 'text_delta', delta: 'CONTEUDO_VAZADO_SESSAO_A' })}\n\n`),
    );
    streamController?.close();

    // Wait a tick to ensure late events would have processed if unguarded
    await new Promise((r) => setTimeout(r, 30));

    expect(screen.queryByText(/CONTEUDO_VAZADO_SESSAO_A/)).not.toBeInTheDocument();
    expect(screen.queryByText('fatura-servico.pdf')).not.toBeInTheDocument();
    expect(onSnapshotCreated).not.toHaveBeenCalled();
  });
});

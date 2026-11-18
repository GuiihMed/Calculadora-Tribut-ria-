// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App';
import { ApiError, calculateFiscal, streamChatTurn } from '../../src/client/api/client';
import { HistoryDialog } from '../../src/client/components/HistoryDialog';
import { TopBar } from '../../src/client/components/TopBar';
import type { CalcRunSnapshot, EngineStatusMap, WorkspaceSession } from '../../src/shared/types/fiscal';

const MOCK_ENGINES: EngineStatusMap = {
  regimeRegular: {
    capability: 'regimeRegular',
    mode: 'local-ts',
    label: 'Motor Local (TS)',
    endpointConfigured: false,
    healthy: true,
  },
  simplesNacional: {
    capability: 'simplesNacional',
    mode: 'remote-official',
    label: 'Oficial RFB (Remoto)',
    endpointConfigured: true,
    healthy: true,
  },
  danfse: {
    capability: 'danfse',
    mode: 'local-ts',
    label: 'Motor Local (TS)',
    endpointConfigured: false,
    healthy: true,
  },
};

const MOCK_SESSIONS: WorkspaceSession[] = [
  {
    id: 'sess-1',
    title: 'Operação Cesta Básica RS',
    activeContext: {
      regime: 'regime-regular',
      dhFatoGerador: '2026-07-01',
      tipoDfe: '55',
      uf: 'RS',
      municipio: 4314902,
    },
    createdAt: '2026-11-17T12:00:00.000Z',
    updatedAt: '2026-11-17T12:05:00.000Z',
  },
];

const MOCK_SNAPSHOT: CalcRunSnapshot = {
  id: 'run-1',
  sessionId: 'sess-1',
  kind: 'regime_regular',
  engineMode: 'local-ts',
  dhFatoGerador: '2027-02-01',
  context: { regime: 'regime-regular', dhFatoGerador: '2027-02-01', tipoDfe: '55', uf: 'RS' },
  input: {},
  output: {
    modo: 'observabilidade',
    dhFatoGerador: '2027-02-01',
    xWarningDadosSimulados: true,
    avisos: [],
    errosGlobais: [],
    itens: [],
  },
  xWarningDadosSimulados: true,
  createdAt: '2026-11-17T12:05:00.000Z',
};

describe('Task 10 Frontend Shell & API Client', () => {
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

  it('renders TopBar with 3 per-capability engine badges', () => {
    render(
      <TopBar
        engineStatus={MOCK_ENGINES}
        oficialDbReady={true}
      />,
    );

    expect(screen.getByText(/Copiloto Fiscal & Calculadora RTC/i)).toBeInTheDocument();
    expect(screen.getByText('Regime Regular')).toBeInTheDocument();
    expect(screen.getByText('Simples Nacional')).toBeInTheDocument();
    expect(screen.getByText('DANFSe')).toBeInTheDocument();
  });

  it('renders native HistoryDialog with aria-labelledby and without role="dialog" or aria-modal', () => {
    const onClose = vi.fn();
    const onSelectSession = vi.fn();
    const onSelectSnapshot = vi.fn();

    const { container } = render(
      <HistoryDialog
        open={true}
        sessions={MOCK_SESSIONS}
        activeSessionId="sess-1"
        calcRuns={[MOCK_SNAPSHOT]}
        activeCalcRunId="run-1"
        onClose={onClose}
        onSelectSession={onSelectSession}
        onSelectSnapshot={onSelectSnapshot}
      />,
    );

    const dialog = container.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog).toHaveAttribute('aria-labelledby', 'history-dialog-title');
    expect(dialog).toHaveAttribute('closedby', 'any');
    expect(dialog).not.toHaveAttribute('role');
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);

    expect(screen.getByText('Operação Cesta Básica RS')).toBeInTheDocument();
    expect(screen.getByText(/Simulado 2027\+/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Carregado/i }));
    expect(onSelectSnapshot).toHaveBeenCalledWith(MOCK_SNAPSHOT);
  });

  it('loads health & sessions into Split-View App and displays 5 Workbench tabs + simulated warning', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/health') {
        return new Response(
          JSON.stringify({ status: 'ok', engines: MOCK_ENGINES, oficialDb: { ready: true } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/sessions') {
        return new Response(JSON.stringify({ sessions: MOCK_SESSIONS }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/sessions/sess-1') {
        return new Response(
          JSON.stringify({
            session: MOCK_SESSIONS[0],
            messages: [
              {
                id: 'msg-1',
                sessionId: 'sess-1',
                role: 'assistant',
                content: 'Simulação carregada.',
                createdAt: '2026-11-17T12:05:00.000Z',
              },
            ],
            calcRuns: [MOCK_SNAPSHOT],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Simulação carregada.')).toBeInTheDocument();
    });

    expect(screen.getByRole('tab', { name: /Prévia & Lote/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Resultado & Créditos/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Comparativo Regimes/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Memória & Base Legal/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /XML & DANFSe/i })).toBeInTheDocument();
    expect(screen.getByText(/Dados Simulados \(2027\+\):/i)).toBeInTheDocument();
  });

  it('throws typed ApiError with canForceLocal=true on 503 REMOTE_ENGINE_UNAVAILABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: 'REMOTE_ENGINE_UNAVAILABLE',
            capability: 'regimeRegular',
            endpoint: 'http://localhost:8080',
            message: 'Serviço remoto indisponível.',
            canForceLocal: true,
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(
      calculateFiscal({
        regime: 'regime-regular',
        input: {},
      }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      code: 'REMOTE_ENGINE_UNAVAILABLE',
      canForceLocal: true,
      capability: 'regimeRegular',
      endpoint: 'http://localhost:8080',
    });
  });

  it('parses SSE chunks cleanly in streamChatTurn', async () => {
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"text_delta","delta":"Olá "}\n\ndata: {"type":"text_delta","delta":"contador!"}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode('data: {"type":"done","messageId":"m-1"}\n\n'),
        );
        controller.close();
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(sseStream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'X-Session-ID': 'sess-99',
          },
        }),
      ),
    );

    const events: unknown[] = [];
    const result = await streamChatTurn({ message: 'Oi' }, (ev) => events.push(ev));

    expect(result.sessionId).toBe('sess-99');
    expect(events).toEqual([
      { type: 'text_delta', delta: 'Olá ' },
      { type: 'text_delta', delta: 'contador!' },
      { type: 'done', messageId: 'm-1' },
    ]);
    expect(ApiError).toBeDefined();
  });

  it('skips PATCH while UF is incomplete and surfaces context persistence errors', async () => {
    const patchPayloads: unknown[] = [];
    let shouldFailPatch = false;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/health') {
        return new Response(
          JSON.stringify({ status: 'ok', engines: MOCK_ENGINES, oficialDb: { ready: true } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/sessions') {
        return new Response(JSON.stringify({ sessions: MOCK_SESSIONS }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/sessions/sess-1') {
        return new Response(
          JSON.stringify({
            session: MOCK_SESSIONS[0],
            messages: [],
            calcRuns: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/sessions/sess-1/context' && init?.method === 'PATCH') {
        patchPayloads.push(JSON.parse(String(init.body)));
        if (shouldFailPatch) {
          return new Response(
            JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Falha ao persistir contexto.' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            session: {
              ...MOCK_SESSIONS[0],
              activeContext: { ...MOCK_SESSIONS[0]!.activeContext, uf: 'SP' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    const ufInput = await screen.findByLabelText('UF');
    await waitFor(() => {
      expect(ufInput).toHaveValue('RS');
    });

    // Incomplete 1-char UF updates local input without calling PATCH
    fireEvent.change(ufInput, { target: { value: 'S' } });
    expect(ufInput).toHaveValue('S');
    expect(patchPayloads).toHaveLength(0);

    // Complete 2-char UF triggers PATCH
    fireEvent.change(ufInput, { target: { value: 'sp' } });
    await waitFor(() => {
      expect(patchPayloads).toHaveLength(1);
    });
    expect(patchPayloads[0]).toMatchObject({ context: { uf: 'SP' } });

    // Surface persistence failure in alert banner
    shouldFailPatch = true;
    fireEvent.change(ufInput, { target: { value: 'RJ' } });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Falha ao persistir contexto.');
    });
  });
});

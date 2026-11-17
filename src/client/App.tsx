import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  FileCode2,
  GitCompareArrows,
  Layers,
  MessageSquare,
  Scale,
  TableProperties,
} from 'lucide-react';
import type {
  CalcRunSnapshot,
  EngineStatusMap,
  ExtractionDraft,
  OperationContext,
  WorkspaceSession,
} from '../shared/types/fiscal';
import {
  ApiError,
  createSession,
  fetchHealth,
  getSession,
  listSessions,
  updateSessionContext,
} from './api/client';
import { ChatPane } from './components/ChatPane';
import { HistoryDialog } from './components/HistoryDialog';
import type { ChatMessageItem, WorkbenchTabId } from './components/MessageBubble';
import { TopBar } from './components/TopBar';

export type WorkbenchTab = WorkbenchTabId;
export type MobilePane = 'chat' | 'workbench';

export const DEFAULT_OPERATION_CONTEXT: Partial<OperationContext> = {
  regime: 'regime-regular',
  dhFatoGerador: '2026-07-01',
  tipoDfe: '55',
  uf: 'RS',
  municipio: 4314902,
  crt: 1,
  tpRegimeIBSCBS: 2,
};

const WORKBENCH_TABS: Array<{ id: WorkbenchTab; label: string; icon: typeof TableProperties }> = [
  { id: 'staging', label: 'Prévia & Lote', icon: TableProperties },
  { id: 'results', label: 'Resultado & Créditos', icon: Calculator },
  { id: 'compare', label: 'Comparativo Regimes', icon: GitCompareArrows },
  { id: 'memory', label: 'Memória & Base Legal', icon: Scale },
  { id: 'xml', label: 'XML & DANFSe', icon: FileCode2 },
];

function getTransitionBadge(dhFatoGerador?: string): { label: string; tone: string } {
  const year = dhFatoGerador ? Number.parseInt(dhFatoGerador.slice(0, 4), 10) : 2026;
  if (!Number.isFinite(year) || year <= 2026) {
    return { label: '2026 Teste (Alíquotas Ref.)', tone: 'badge--info' };
  }
  if (year >= 2033) {
    return { label: '2033+ Pleno (Sem ICMS/ISS)', tone: 'badge--success' };
  }
  return { label: '2027+ Sem PIS/COFINS', tone: 'badge--warning' };
}

export function App() {
  const [engineStatus, setEngineStatus] = useState<EngineStatusMap | null>(null);
  const [oficialDbReady, setOficialDbReady] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [sessionCalcRuns, setSessionCalcRuns] = useState<CalcRunSnapshot[]>([]);
  const [draftsById, setDraftsById] = useState<Record<string, ExtractionDraft>>({});
  const [activeContext, setActiveContext] = useState<Partial<OperationContext>>(
    DEFAULT_OPERATION_CONTEXT,
  );
  const [activeDraft, setActiveDraft] = useState<ExtractionDraft | null>(null);
  const [activeSnapshot, setActiveSnapshot] = useState<CalcRunSnapshot | null>(null);
  const [activeWorkbenchTab, setActiveWorkbenchTab] = useState<WorkbenchTab>('staging');
  const [mobilePane, setMobilePane] = useState<MobilePane>('chat');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const snapshotsById = useMemo(
    () => Object.fromEntries(sessionCalcRuns.map((run) => [run.id, run])),
    [sessionCalcRuns],
  );

  const loadSessionById = useCallback(async (sessionId: string) => {
    try {
      const detail = await getSession(sessionId);
      setActiveSessionId(detail.session.id);
      setMessages(detail.messages);
      setSessionCalcRuns(detail.calcRuns);
      setActiveDraft(null);
      setDraftsById({});
      setActiveContext({
        ...DEFAULT_OPERATION_CONTEXT,
        ...detail.session.activeContext,
      });
      const latestRun = detail.calcRuns[0] ?? null;
      setActiveSnapshot(latestRun);
      setStatusMessage(null);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Não foi possível carregar a sessão selecionada.';
      setStatusMessage(msg);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapShell() {
      try {
        const [health, sessionsRes] = await Promise.all([fetchHealth(), listSessions()]);
        if (cancelled) return;

        setEngineStatus(health.engines);
        setOficialDbReady(health.oficialDb.ready);
        setSessions(sessionsRes.sessions);

        const mostRecent = sessionsRes.sessions[0];
        if (mostRecent) {
          await loadSessionById(mostRecent.id);
        }
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : 'Não foi possível conectar ao servidor BFF (/api/health).';
        setStatusMessage(msg);
      }
    }

    void bootstrapShell();
    return () => {
      cancelled = true;
    };
  }, [loadSessionById]);

  const handleNewSession = async () => {
    try {
      const { session } = await createSession({
        title: `Simulação ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
        context: activeContext,
      });
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMessages([]);
      setSessionCalcRuns([]);
      setActiveDraft(null);
      setDraftsById({});
      setActiveSnapshot(null);
      setStatusMessage(null);
    } catch (err) {
      setStatusMessage(
        err instanceof ApiError ? err.message : 'Erro ao criar nova sessão no workspace.',
      );
    }
  };

  const handleContextPatch = async (patch: Partial<OperationContext>) => {
    const nextContext: Partial<OperationContext> = { ...activeContext, ...patch };
    setActiveContext(nextContext);

    if (!activeSessionId) {
      return;
    }

    const patchKeys = Object.keys(patch);
    const hasIncompleteUf =
      patch.uf !== undefined && patch.uf.trim().length !== 2;
    if (hasIncompleteUf && patchKeys.length === 1) {
      return;
    }

    const serverContext: Partial<OperationContext> = { ...nextContext };
    if (serverContext.uf !== undefined && serverContext.uf.trim().length !== 2) {
      delete serverContext.uf;
    } else if (serverContext.uf !== undefined) {
      serverContext.uf = serverContext.uf.trim().toUpperCase();
    }

    try {
      const { session } = await updateSessionContext(activeSessionId, serverContext);
      setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)));
      setStatusMessage(null);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Não foi possível salvar o contexto da sessão.';
      setStatusMessage(msg);
    }
  };

  const transitionBadge = getTransitionBadge(activeContext.dhFatoGerador);

  return (
    <div className="app-shell">
      <TopBar
        engineStatus={engineStatus}
        oficialDbReady={oficialDbReady}
        sessionCount={sessions.length}
        onNewSession={() => {
          void handleNewSession();
        }}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      <nav className="mobile-pane-switcher" aria-label="Alternar área de trabalho">
        <button
          type="button"
          className="mobile-pane-btn"
          aria-pressed={mobilePane === 'chat'}
          onClick={() => setMobilePane('chat')}
        >
          <MessageSquare size={16} aria-hidden="true" />
          <span>Copiloto Chat</span>
        </button>
        <button
          type="button"
          className="mobile-pane-btn"
          aria-pressed={mobilePane === 'workbench'}
          onClick={() => setMobilePane('workbench')}
        >
          <Layers size={16} aria-hidden="true" />
          <span>Mesa Fiscal</span>
        </button>
      </nav>

      <main className="split-workspace">
        {/* Left Pane: Copiloto Fiscal (Chat Gemini) */}
        <section
          aria-label="Copiloto Fiscal Gemini"
          className={`pane-chat ${mobilePane !== 'chat' ? 'pane-hidden-mobile' : ''}`}
        >
          <ChatPane
            sessionId={activeSessionId}
            activeContext={activeContext}
            messages={messages}
            snapshotsById={snapshotsById}
            draftsById={draftsById}
            activeDraft={activeDraft}
            statusMessage={statusMessage}
            onMessagesChange={setMessages}
            onSessionResolved={(resolvedId) => {
              setActiveSessionId(resolvedId);
              void listSessions()
                .then((res) => setSessions(res.sessions))
                .catch(() => {
                  // non-fatal background refresh
                });
            }}
            onSnapshotCreated={(snapshot) => {
              setActiveSnapshot(snapshot);
              setSessionCalcRuns((prev) => [
                snapshot,
                ...prev.filter((r) => r.id !== snapshot.id),
              ]);
            }}
            onDraftReady={(draft) => {
              setActiveDraft(draft);
              setDraftsById((prev) => ({ ...prev, [draft.id]: draft }));
            }}
            onSelectSnapshot={(snapshot) => {
              setActiveSnapshot(snapshot);
            }}
            onSelectDraft={(draft) => {
              setActiveDraft(draft);
            }}
            onNavigateWorkbench={(tab) => {
              setActiveWorkbenchTab(tab);
              setMobilePane('workbench');
            }}
          />
        </section>

        {/* Right Pane: Mesa Fiscal Determinística */}
        <section
          aria-label="Mesa Fiscal Determinística"
          className={`pane-workbench ${mobilePane !== 'workbench' ? 'pane-hidden-mobile' : ''}`}
        >
          <div className="context-bar">
            <div className="context-bar__fields">
              <div className="context-field">
                <label htmlFor="ctx-regime">Regime</label>
                <select
                  id="ctx-regime"
                  value={activeContext.regime ?? 'regime-regular'}
                  onChange={(e) => {
                    void handleContextPatch({
                      regime: e.target.value as OperationContext['regime'],
                    });
                  }}
                >
                  <option value="regime-regular">Regime Regular</option>
                  <option value="simples-nacional">Simples Nacional</option>
                  <option value="comparativo">Comparativo Regimes</option>
                </select>
              </div>

              <div className="context-field">
                <label htmlFor="ctx-data">Fato Gerador</label>
                <input
                  id="ctx-data"
                  type="date"
                  className="tabular-nums"
                  value={(activeContext.dhFatoGerador ?? '2026-07-01').slice(0, 10)}
                  onChange={(e) => {
                    if (e.target.value) {
                      void handleContextPatch({ dhFatoGerador: e.target.value });
                    }
                  }}
                />
              </div>

              <div className="context-field">
                <label htmlFor="ctx-dfe">DF-e</label>
                <select
                  id="ctx-dfe"
                  value={activeContext.tipoDfe ?? '55'}
                  onChange={(e) => {
                    void handleContextPatch({
                      tipoDfe: e.target.value as OperationContext['tipoDfe'],
                    });
                  }}
                >
                  <option value="55">NF-e (55)</option>
                  <option value="65">NFC-e (65)</option>
                  <option value="NFSE">NFS-e</option>
                </select>
              </div>

              <div className="context-field">
                <label htmlFor="ctx-uf">UF</label>
                <input
                  id="ctx-uf"
                  type="text"
                  maxLength={2}
                  style={{ inlineSize: '3.25rem', textTransform: 'uppercase' }}
                  value={activeContext.uf ?? 'RS'}
                  onChange={(e) => {
                    const uf = e.target.value.toUpperCase();
                    void handleContextPatch({ uf });
                  }}
                />
              </div>
            </div>

            <span className={`badge ${transitionBadge.tone}`}>{transitionBadge.label}</span>
          </div>

          <div className="workbench-tabs" role="tablist" aria-label="Abas da Mesa Fiscal">
            {WORKBENCH_TABS.map(({ id, label, icon: Icon }) => {
              const selected = activeWorkbenchTab === id;
              return (
                <button
                  key={id}
                  id={`tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`panel-${id}`}
                  className="tab-btn"
                  onClick={() => setActiveWorkbenchTab(id)}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          <div
            id={`panel-${activeWorkbenchTab}`}
            role="tabpanel"
            aria-labelledby={`tab-${activeWorkbenchTab}`}
            className="pane-scroll"
          >
            {activeSnapshot?.xWarningDadosSimulados && (
              <div className="banner banner--warning" role="status">
                <span>
                  <AlertTriangle
                    size={15}
                    aria-hidden="true"
                    style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
                  />
                  <strong>Dados Simulados (2027+):</strong> Cálculo utiliza alíquotas nominais
                  informadas para vigência futura sem alíquota de referência definitiva no banco RFB.
                </span>
              </div>
            )}

            <div className="stack">
              <div className="kpi-grid">
                <article className="kpi-card">
                  <span className="kpi-card__label">Regime Ativo</span>
                  <span className="kpi-value">
                    {activeContext.regime === 'simples-nacional'
                      ? 'Simples Nacional'
                      : activeContext.regime === 'comparativo'
                        ? 'Comparativo'
                        : 'Regime Regular'}
                  </span>
                  <span className="kpi-card__hint tabular-nums">
                    DF-e {activeContext.tipoDfe ?? '55'} &bull; UF {activeContext.uf ?? 'RS'}
                  </span>
                </article>

                <article className="kpi-card">
                  <span className="kpi-card__label">Prévia / Rascunho</span>
                  <span className="kpi-value tabular-nums">
                    {activeDraft ? `${activeDraft.itens.length} itens` : '0 itens'}
                  </span>
                  <span className="kpi-card__hint">
                    {activeDraft ? activeDraft.filename : 'Nenhum documento em staging'}
                  </span>
                </article>

                <article className="kpi-card">
                  <span className="kpi-card__label">Último Snapshot</span>
                  <span className="kpi-value tabular-nums">
                    {activeSnapshot ? activeSnapshot.kind : 'Aguardando'}
                  </span>
                  <span className="kpi-card__hint">
                    {activeSnapshot
                      ? activeSnapshot.engineMode === 'remote-official'
                        ? 'Oficial RFB'
                        : 'Motor Local (TS)'
                      : 'Execute um cálculo para visualizar'}
                  </span>
                </article>
              </div>

              <article className="card">
                <div className="card__header">
                  <h3 className="card__title">
                    {WORKBENCH_TABS.find((t) => t.id === activeWorkbenchTab)?.label}
                  </h3>
                  <span className="badge badge--neutral">
                    {activeWorkbenchTab}
                  </span>
                </div>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  Painel estrutural da Mesa Fiscal Determinística pronto para os módulos de Prévia
                  Editável, Resultados &amp; Créditos, Comparativo de Regimes, Memória de Cálculo e
                  XML/DANFSe.
                </p>
              </article>
            </div>
          </div>
        </section>
      </main>

      <HistoryDialog
        open={historyOpen}
        sessions={sessions}
        activeSessionId={activeSessionId}
        calcRuns={sessionCalcRuns}
        activeCalcRunId={activeSnapshot?.id ?? null}
        onClose={() => setHistoryOpen(false)}
        onSelectSession={(sessionId) => {
          void loadSessionById(sessionId);
        }}
        onSelectSnapshot={(snapshot) => {
          setActiveSnapshot(snapshot);
          setActiveWorkbenchTab(snapshot.kind === 'comparativo' ? 'compare' : 'results');
        }}
      />
    </div>
  );
}
export default App;

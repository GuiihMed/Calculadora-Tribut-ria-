import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, MessageSquare } from 'lucide-react';
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
import { HistorySidebar } from './components/HistorySidebar';
import type { ChatMessageItem, WorkbenchTabId } from './components/MessageBubble';
import { TopBar } from './components/TopBar';
import { WorkbenchPane } from './components/WorkbenchPane';

export type WorkbenchTab = WorkbenchTabId;
export type MobilePane = 'chat' | 'workbench';

export const DEFAULT_OPERATION_CONTEXT: Partial<OperationContext> = {
  regime: 'regime-regular',
  dhFatoGerador: '2026-07-01',
  tipoDfe: '55',
  uf: 'PB',
  municipio: 2507507,
  crt: 1,
  tpRegimeIBSCBS: 2,
};

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
  const [historyOpen, setHistoryOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1280 : false,
  );
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

  return (
    <div className="app-shell">
      <TopBar
        engineStatus={engineStatus}
        oficialDbReady={oficialDbReady}
        sessionCount={sessions.length}
        onNewSession={() => {
          void handleNewSession();
        }}
        onOpenHistory={() => setHistoryOpen((prev) => !prev)}
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

      <main className={`split-workspace ${historyOpen ? 'split-workspace--with-history' : ''}`}>
        {/* Left Sidebar: Histórico estilo Gemini */}
        <HistorySidebar
          open={historyOpen}
          sessions={sessions}
          activeSessionId={activeSessionId}
          calcRuns={sessionCalcRuns}
          activeCalcRunId={activeSnapshot?.id ?? null}
          onClose={() => setHistoryOpen(false)}
          onNewSession={() => {
            void handleNewSession();
          }}
          onSelectSession={(sessionId) => {
            void loadSessionById(sessionId);
          }}
          onSelectSnapshot={(snapshot) => {
            setActiveSnapshot(snapshot);
            setActiveWorkbenchTab(snapshot.kind === 'comparativo' ? 'compare' : 'results');
            setMobilePane('workbench');
          }}
        />

        {/* Center Pane: Copiloto Fiscal (Chat Gemini) */}
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
          <WorkbenchPane
            activeContext={activeContext}
            activeTab={activeWorkbenchTab}
            draft={activeDraft}
            snapshot={activeSnapshot}
            sessionId={activeSessionId}
            onContextPatch={(patch) => {
              void handleContextPatch(patch);
            }}
            onTabChange={setActiveWorkbenchTab}
            onDraftChange={(updatedDraft) => {
              setActiveDraft(updatedDraft);
              setDraftsById((prev) => ({ ...prev, [updatedDraft.id]: updatedDraft }));
            }}
            onSnapshotCreated={(snapshot) => {
              setActiveSnapshot(snapshot);
              setSessionCalcRuns((prev) => [
                snapshot,
                ...prev.filter((r) => r.id !== snapshot.id),
              ]);
            }}
          />
        </section>
      </main>
    </div>
  );
}
export default App;

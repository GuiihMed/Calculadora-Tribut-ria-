import { Calculator, Clock, MessageSquare, PanelLeftClose, SquarePen } from 'lucide-react';
import type { CalcRunSnapshot, WorkspaceSession } from '../../shared/types/fiscal';

export interface HistorySidebarProps {
  open: boolean;
  sessions: WorkspaceSession[];
  activeSessionId: string | null;
  calcRuns: CalcRunSnapshot[];
  activeCalcRunId: string | null;
  onClose: () => void;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onSelectSnapshot: (snapshot: CalcRunSnapshot) => void;
}

const REGIME_LABELS: Record<string, string> = {
  'regime-regular': 'Regime Regular',
  'simples-nacional': 'Simples Nacional',
  comparativo: 'Comparativo',
};

const KIND_LABELS: Record<CalcRunSnapshot['kind'], string> = {
  regime_regular: 'Regime Regular',
  simples_nacional: 'Simples Nacional',
  comparativo: 'Comparativo',
  base_unificada: 'Base Unificada',
};

function formatShortDatePtBr(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function HistorySidebar({
  open,
  sessions,
  activeSessionId,
  calcRuns,
  activeCalcRunId,
  onClose,
  onNewSession,
  onSelectSession,
  onSelectSnapshot,
}: HistorySidebarProps) {
  if (!open) {
    return null;
  }

  return (
    <aside className="history-sidebar" aria-label="Histórico de conversas e cálculos">
      <div className="history-sidebar__header">
        <button
          type="button"
          className="history-sidebar__new-btn"
          onClick={onNewSession}
        >
          <SquarePen size={15} aria-hidden="true" />
          <span>Nova conversa</span>
        </button>

        <button
          type="button"
          className="history-sidebar__close"
          aria-label="Recolher barra lateral"
          title="Recolher histórico"
          onClick={onClose}
        >
          <PanelLeftClose size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="history-sidebar__scroll">
        <section className="history-sidebar__section" aria-label="Conversas recentes">
          <p className="history-sidebar__section-label">
            Recentes
          </p>
          {sessions.length === 0 ? (
            <p className="history-sidebar__empty">
              Nenhuma conversa salva ainda.
            </p>
          ) : (
            <ul className="history-sidebar__list">
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const regimeLabel = session.activeContext.regime
                  ? REGIME_LABELS[session.activeContext.regime] ?? session.activeContext.regime
                  : 'Regime Regular';

                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={`history-sidebar__item ${isActive ? 'history-sidebar__item--active' : ''}`}
                      onClick={() => onSelectSession(session.id)}
                    >
                      <span className="history-sidebar__item-title">
                        <MessageSquare size={14} className="history-sidebar__item-icon" aria-hidden="true" />
                        <span className="history-sidebar__item-text">
                          {session.title || 'Simulação sem título'}
                        </span>
                      </span>
                      <span className="history-sidebar__item-meta tabular-nums">
                        {regimeLabel} &bull; {formatShortDatePtBr(session.updatedAt)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {calcRuns.length > 0 && (
          <section className="history-sidebar__section" aria-label="Cálculos da conversa">
            <p className="history-sidebar__section-label">
              Cálculos ({calcRuns.length})
            </p>
            <ul className="history-sidebar__list">
              {calcRuns.map((run) => {
                const isLoaded = run.id === activeCalcRunId;
                return (
                  <li key={run.id}>
                    <button
                      type="button"
                      className={`history-sidebar__item ${isLoaded ? 'history-sidebar__item--active' : ''}`}
                      onClick={() => onSelectSnapshot(run)}
                    >
                      <span className="history-sidebar__item-title">
                        <Calculator size={13} className="history-sidebar__item-icon" aria-hidden="true" />
                        <span className="history-sidebar__item-text">{KIND_LABELS[run.kind]}</span>
                      </span>
                      <span className="history-sidebar__item-meta tabular-nums">
                        <Clock size={11} aria-hidden="true" />
                        <span>{run.dhFatoGerador}</span>
                        {run.xWarningDadosSimulados && (
                          <span className="history-sidebar__sim-tag">2027+</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}

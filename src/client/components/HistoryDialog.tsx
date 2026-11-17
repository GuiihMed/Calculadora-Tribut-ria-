import { useEffect, useRef } from 'react';
import { Calculator, Clock, FolderOpen, X } from 'lucide-react';
import type { CalcRunSnapshot, WorkspaceSession } from '../../shared/types/fiscal';

export interface HistoryDialogProps {
  open: boolean;
  sessions: WorkspaceSession[];
  activeSessionId: string | null;
  calcRuns: CalcRunSnapshot[];
  activeCalcRunId: string | null;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onSelectSnapshot: (snapshot: CalcRunSnapshot) => void;
}

const REGIME_LABELS: Record<string, string> = {
  'regime-regular': 'Regime Regular',
  'simples-nacional': 'Simples Nacional',
  comparativo: 'Comparativo Regimes',
};

const KIND_LABELS: Record<CalcRunSnapshot['kind'], string> = {
  regime_regular: 'Regime Regular',
  simples_nacional: 'Simples Nacional',
  comparativo: 'Comparativo Regimes',
  base_unificada: 'Base Unificada',
};

function formatDateTimePtBr(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function HistoryDialog({
  open,
  sessions,
  activeSessionId,
  calcRuns,
  activeCalcRunId,
  onClose,
  onSelectSession,
  onSelectSnapshot,
}: HistoryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleDialogClose = () => {
    if (open) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="native-dialog"
      aria-labelledby="history-dialog-title"
      closedby="any"
      onClose={handleDialogClose}
    >
      <div className="dialog__header">
        <h2 id="history-dialog-title" className="dialog__title">
          Histórico &amp; Sessões Salvas
        </h2>
        <form method="dialog">
          <button
            type="submit"
            value="close"
            className="btn btn--sm"
            aria-label="Fechar janela de histórico"
          >
            <X size={14} aria-hidden="true" />
            <span>Fechar</span>
          </button>
        </form>
      </div>

      <div className="dialog__body">
        <section aria-labelledby="history-sessions-heading">
          <h3 id="history-sessions-heading" className="dialog__section-title">
            Sessões de Trabalho ({sessions.length})
          </h3>
          {sessions.length === 0 ? (
            <p className="empty-state">
              Nenhuma sessão persistida ainda. Inicie uma conversa ou crie uma nova sessão.
            </p>
          ) : (
            <ul className="dialog__list">
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const regimeLabel = session.activeContext.regime
                  ? REGIME_LABELS[session.activeContext.regime] ?? session.activeContext.regime
                  : 'Regime Regular';
                const dataLabel = session.activeContext.dhFatoGerador ?? 'Sem data';

                return (
                  <li
                    key={session.id}
                    className={`dialog__item ${isActive ? 'dialog__item--active' : ''}`}
                  >
                    <div className="dialog__item-meta">
                      <span className="dialog__item-title">
                        {session.title || 'Simulação sem título'}
                      </span>
                      <span className="dialog__item-sub tabular-nums">
                        {regimeLabel} &bull; Fato gerador: {dataLabel} &bull; Atualizada em{' '}
                        {formatDateTimePtBr(session.updatedAt)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`btn btn--sm ${isActive ? 'btn--primary' : ''}`}
                      onClick={() => {
                        onSelectSession(session.id);
                        dialogRef.current?.close();
                      }}
                    >
                      <FolderOpen size={14} aria-hidden="true" />
                      <span>{isActive ? 'Sessão Ativa' : 'Abrir Sessão'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="history-runs-heading">
          <h3 id="history-runs-heading" className="dialog__section-title">
            Cálculos Determinísticos da Sessão ({calcRuns.length})
          </h3>
          {calcRuns.length === 0 ? (
            <p className="empty-state">
              Nenhum cálculo executado nesta sessão até o momento.
            </p>
          ) : (
            <ul className="dialog__list">
              {calcRuns.map((run) => {
                const isSelected = run.id === activeCalcRunId;
                return (
                  <li
                    key={run.id}
                    className={`dialog__item ${isSelected ? 'dialog__item--active' : ''}`}
                  >
                    <div className="dialog__item-meta">
                      <span className="dialog__item-title">
                        {KIND_LABELS[run.kind]} &bull;{' '}
                        <span className="badge badge--neutral">
                          {run.engineMode === 'remote-official' ? 'Oficial RFB' : 'Motor Local TS'}
                        </span>
                        {run.xWarningDadosSimulados && (
                          <>
                            {' '}
                            <span className="badge badge--warning">Simulado 2027+</span>
                          </>
                        )}
                      </span>
                      <span className="dialog__item-sub tabular-nums">
                        <Clock size={12} aria-hidden="true" /> {formatDateTimePtBr(run.createdAt)} &bull;
                        Fato gerador: {run.dhFatoGerador}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`btn btn--sm ${isSelected ? 'btn--primary' : ''}`}
                      onClick={() => {
                        onSelectSnapshot(run);
                        dialogRef.current?.close();
                      }}
                    >
                      <Calculator size={14} aria-hidden="true" />
                      <span>{isSelected ? 'Carregado' : 'Carregar na Mesa'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="dialog__footer">
        <form method="dialog">
          <button type="submit" value="close" className="btn">
            Fechar
          </button>
        </form>
      </div>
    </dialog>
  );
}

import { History, Plus } from 'lucide-react';
import type { EngineCapabilityKey, EngineCapabilityStatus, EngineStatusMap } from '../../shared/types/fiscal';

export interface TopBarProps {
  engineStatus: EngineStatusMap | null;
  oficialDbReady: boolean | null;
  onNewSession: () => void;
  onOpenHistory: () => void;
  sessionCount?: number;
}

const CAPABILITY_LABELS: Array<{ key: EngineCapabilityKey; title: string }> = [
  { key: 'regimeRegular', title: 'Regime Regular' },
  { key: 'simplesNacional', title: 'Simples Nacional' },
  { key: 'danfse', title: 'DANFSe' },
];

function getModeText(cap?: EngineCapabilityStatus): string {
  if (!cap) {
    return 'Verificando...';
  }
  return cap.mode === 'remote-official' ? 'Oficial RFB (Remoto)' : 'Motor Local (TS)';
}

function getBadgeVariantClass(cap?: EngineCapabilityStatus): string {
  if (!cap) {
    return 'engine-badge--local';
  }
  if (cap.healthy === false) {
    return 'engine-badge--unhealthy';
  }
  return cap.mode === 'remote-official' ? 'engine-badge--remote' : 'engine-badge--local';
}

export function TopBar({
  engineStatus,
  oficialDbReady,
  onNewSession,
  onOpenHistory,
  sessionCount,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <div className="topbar__logo" aria-hidden="true">
          RTC
        </div>
        <div className="topbar__titles">
          <h1 className="topbar__title">Copiloto Fiscal &amp; Calculadora RTC</h1>
          <p className="topbar__subtitle">
            LC 214/2025 &bull; NT 2026.005 v1.00
            {oficialDbReady === false ? ' • Base RFB Indisponível' : ''}
          </p>
        </div>
      </div>

      <div className="topbar__status-group" aria-label="Status dos motores determinísticos por capacidade">
        {CAPABILITY_LABELS.map(({ key, title }) => {
          const cap = engineStatus?.[key];
          const modeLabel = getModeText(cap);
          const tooltip = cap?.detail ?? `${title}: ${modeLabel}`;

          return (
            <span
              key={key}
              className={`engine-badge ${getBadgeVariantClass(cap)}`}
              title={tooltip}
            >
              <span className="engine-badge__dot" aria-hidden="true" />
              <span>{title}:</span>
              <span className="engine-badge__mode">{modeLabel}</span>
            </span>
          );
        })}
      </div>

      <div className="topbar__actions">
        <button type="button" className="btn btn--navy-ghost" onClick={onOpenHistory}>
          <History size={15} aria-hidden="true" />
          <span>
            Histórico &amp; Sessões{typeof sessionCount === 'number' && sessionCount > 0 ? ` (${sessionCount})` : ''}
          </span>
        </button>

        <button type="button" className="btn btn--primary" onClick={onNewSession}>
          <Plus size={15} aria-hidden="true" />
          <span>Nova Sessão</span>
        </button>
      </div>
    </header>
  );
}

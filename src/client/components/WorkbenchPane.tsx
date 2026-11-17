import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Calculator,
  FileCode2,
  GitCompareArrows,
  Scale,
  TableProperties,
} from 'lucide-react';
import type {
  CalcRunSnapshot,
  ExtractionDraft,
  OperationContext,
} from '../../shared/types/fiscal';
import { ContextBar } from './ContextBar';
import type { WorkbenchTabId } from './MessageBubble';
import { ResultsTab } from './ResultsTab';
import { StagingTab } from './StagingTab';

export interface WorkbenchPaneProps {
  activeContext: Partial<OperationContext>;
  activeTab: WorkbenchTabId;
  draft: ExtractionDraft | null;
  snapshot: CalcRunSnapshot | null;
  sessionId: string | null;
  onContextPatch: (patch: Partial<OperationContext>) => void;
  onTabChange: (tab: WorkbenchTabId) => void;
  onDraftChange: (draft: ExtractionDraft) => void;
  onSnapshotCreated: (snapshot: CalcRunSnapshot) => void;
  renderCompareTab?: (ctx: {
    snapshot: CalcRunSnapshot | null;
    draft: ExtractionDraft | null;
    activeContext: Partial<OperationContext>;
    sessionId: string | null;
    onSnapshotCreated: (snapshot: CalcRunSnapshot) => void;
  }) => ReactNode;
  renderMemoryTab?: (ctx: { snapshot: CalcRunSnapshot | null }) => ReactNode;
  renderXmlTab?: (ctx: {
    snapshot: CalcRunSnapshot | null;
    activeContext: Partial<OperationContext>;
  }) => ReactNode;
}

export const WORKBENCH_TABS: Array<{
  id: WorkbenchTabId;
  label: string;
  icon: typeof TableProperties;
}> = [
  { id: 'staging', label: 'Prévia & Lote', icon: TableProperties },
  { id: 'results', label: 'Resultado & Créditos', icon: Calculator },
  { id: 'compare', label: 'Comparativo Regimes', icon: GitCompareArrows },
  { id: 'memory', label: 'Memória & Base Legal', icon: Scale },
  { id: 'xml', label: 'XML & DANFSe', icon: FileCode2 },
];

export function WorkbenchPane({
  activeContext,
  activeTab,
  draft,
  snapshot,
  sessionId,
  onContextPatch,
  onTabChange,
  onDraftChange,
  onSnapshotCreated,
  renderCompareTab,
  renderMemoryTab,
  renderXmlTab,
}: WorkbenchPaneProps) {
  const activeTabLabel =
    WORKBENCH_TABS.find((t) => t.id === activeTab)?.label ?? activeTab;

  return (
    <>
      <ContextBar context={activeContext} onContextPatch={onContextPatch} />

      <div className="workbench-tabs" role="tablist" aria-label="Abas da Mesa Fiscal">
        {WORKBENCH_TABS.map(({ id, label, icon: Icon }) => {
          const selected = activeTab === id;
          return (
            <button
              key={id}
              id={`tab-${id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${id}`}
              className="tab-btn"
              onClick={() => onTabChange(id)}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        className="pane-scroll"
      >
        {snapshot?.xWarningDadosSimulados && activeTab !== 'results' && (
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

        {activeTab === 'staging' && (
          <StagingTab
            draft={draft}
            activeContext={activeContext}
            sessionId={sessionId}
            onDraftChange={onDraftChange}
            onSnapshotCreated={onSnapshotCreated}
            onNavigateTab={onTabChange}
          />
        )}

        {activeTab === 'results' && (
          <ResultsTab
            snapshot={snapshot}
            onNavigateStaging={() => onTabChange('staging')}
            onNavigateCompare={() => onTabChange('compare')}
          />
        )}

        {activeTab === 'compare' &&
          (renderCompareTab ? (
            renderCompareTab({
              snapshot,
              draft,
              activeContext,
              sessionId,
              onSnapshotCreated,
            })
          ) : (
            <article className="card">
              <div className="card__header">
                <h3 className="card__title">{activeTabLabel}</h3>
                <span className="badge badge--neutral">compare</span>
              </div>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Selecione &ldquo;Comparativo Regimes&rdquo; na barra de contexto para simular lado
                a lado Regime Regular, Simples Nacional (CRT=1) e Simples Híbrido em datas a partir
                de 2027-01-01.
              </p>
            </article>
          ))}

        {activeTab === 'memory' &&
          (renderMemoryTab ? (
            renderMemoryTab({ snapshot })
          ) : (
            <article className="card">
              <div className="card__header">
                <h3 className="card__title">{activeTabLabel}</h3>
                <span className="badge badge--neutral">memory</span>
              </div>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                A memória de cálculo passo a passo, fórmulas AST e fundamentações legais da LC
                214/2025 serão exibidas após a execução de um cálculo determinístico.
              </p>
            </article>
          ))}

        {activeTab === 'xml' &&
          (renderXmlTab ? (
            renderXmlTab({ snapshot, activeContext })
          ) : (
            <article className="card">
              <div className="card__header">
                <h3 className="card__title">{activeTabLabel}</h3>
                <span className="badge badge--neutral">xml</span>
              </div>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Geração de XML dos grupos IBSCBS/IS para NF-e/NFC-e e prévia de DANFSe a partir de
                XML de NFS-e.
              </p>
            </article>
          ))}
      </div>
    </>
  );
}

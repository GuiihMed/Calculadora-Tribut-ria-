import { Fragment, type ReactNode } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  FileCode2,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  Scale,
  ShieldCheck,
  TableProperties,
  Wrench,
} from 'lucide-react';
import type {
  BaseCalculoUnificadaOutput,
  CalcRunSnapshot,
  CompareRegimesOutput,
  EngineCapabilityKey,
  ExtractionDraft,
  ObservabilidadeRocOutput,
  ObservabilidadeSimplesOutput,
  WorkspaceMessageRecord,
} from '../../shared/types/fiscal';

export type WorkbenchTabId = 'staging' | 'results' | 'compare' | 'memory' | 'xml';

export interface RemoteEngineErrorInfo {
  code?: string;
  capability?: EngineCapabilityKey;
  endpoint?: string;
  message: string;
  canForceLocal: boolean;
}

export interface ToolActivityBadge {
  callId: string;
  toolName: string;
  status: 'running' | 'done';
  resultSummary?: string;
  calcRunId?: string;
}

export interface ChatMessageItem extends WorkspaceMessageRecord {
  snapshot?: CalcRunSnapshot;
  draft?: ExtractionDraft;
  toolActivities?: ToolActivityBadge[];
  remoteEngineError?: RemoteEngineErrorInfo;
  isStreaming?: boolean;
  attachmentNames?: string[];
}

export interface MessageBubbleProps {
  message: ChatMessageItem;
  snapshot?: CalcRunSnapshot | null;
  draft?: ExtractionDraft | null;
  remoteEngineError?: RemoteEngineErrorInfo | null;
  onNavigateTab?: (tab: WorkbenchTabId) => void;
  onSelectSnapshot?: (snapshot: CalcRunSnapshot) => void;
  onSelectDraft?: (draft: ExtractionDraft) => void;
  onRetryForceLocal?: (error: RemoteEngineErrorInfo) => void;
}

function renderInlineNodes(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRegex = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={`${keyPrefix}-code-${partIdx}`}>{token.slice(1, -1)}</code>,
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-bold-${partIdx}`}>{token.slice(2, -2)}</strong>,
      );
    } else {
      nodes.push(token);
    }
    lastIndex = match.index + token.length;
    partIdx += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

function renderTextBlocks(segment: string, segmentKey: string): ReactNode[] {
  const lines = segment.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  let blockIdx = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Bullet list
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^[-*•]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`${segmentKey}-ul-${blockIdx}`} className="msg-md__list">
          {items.map((item, idx) => (
            <li key={`${segmentKey}-li-${blockIdx}-${idx}`}>
              {renderInlineNodes(item, `${segmentKey}-li-${blockIdx}-${idx}`)}
            </li>
          ))}
        </ul>,
      );
      blockIdx += 1;
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`${segmentKey}-ol-${blockIdx}`} className="msg-md__list">
          {items.map((item, idx) => (
            <li key={`${segmentKey}-oli-${blockIdx}-${idx}`}>
              {renderInlineNodes(item, `${segmentKey}-oli-${blockIdx}-${idx}`)}
            </li>
          ))}
        </ol>,
      );
      blockIdx += 1;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote key={`${segmentKey}-bq-${blockIdx}`} className="msg-md__quote">
          {quoteLines.map((qLine, idx) => (
            <Fragment key={`${segmentKey}-bql-${blockIdx}-${idx}`}>
              {idx > 0 && <br />}
              {renderInlineNodes(qLine, `${segmentKey}-bql-${blockIdx}-${idx}`)}
            </Fragment>
          ))}
        </blockquote>,
      );
      blockIdx += 1;
      continue;
    }

    // Heading
    if (/^#{1,4}\s+/.test(trimmed)) {
      const headingText = trimmed.replace(/^#{1,4}\s+/, '');
      blocks.push(
        <p key={`${segmentKey}-h-${blockIdx}`} className="msg-md__heading">
          {renderInlineNodes(headingText, `${segmentKey}-h-${blockIdx}`)}
        </p>,
      );
      i += 1;
      blockIdx += 1;
      continue;
    }

    // Paragraph (collect consecutive regular lines)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const candidate = (lines[i] ?? '').trim();
      if (
        !candidate ||
        /^[-*•]\s+/.test(candidate) ||
        /^\d+\.\s+/.test(candidate) ||
        candidate.startsWith('>') ||
        /^#{1,4}\s+/.test(candidate)
      ) {
        break;
      }
      paraLines.push(lines[i] ?? '');
      i += 1;
    }
    blocks.push(
      <p key={`${segmentKey}-p-${blockIdx}`} className="msg-md__para">
        {paraLines.map((pLine, idx) => (
          <Fragment key={`${segmentKey}-pl-${blockIdx}-${idx}`}>
            {idx > 0 && <br />}
            {renderInlineNodes(pLine, `${segmentKey}-pl-${blockIdx}-${idx}`)}
          </Fragment>
        ))}
      </p>,
    );
    blockIdx += 1;
  }

  return blocks;
}

function SafeMarkdownContent({ content }: { content: string }) {
  if (!content) {
    return null;
  }

  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <div className="msg-md">
      {parts.map((part, idx) => {
        if (part.startsWith('```') && part.endsWith('```') && part.length >= 6) {
          const inner = part.slice(3, -3).replace(/^[a-zA-Z0-9_-]+\r?\n/, '');
          return (
            <pre key={`codeblock-${idx}`} className="msg-md__pre">
              <code>{inner}</code>
            </pre>
          );
        }
        return <Fragment key={`textseg-${idx}`}>{renderTextBlocks(part, `seg-${idx}`)}</Fragment>;
      })}
    </div>
  );
}

interface SnapshotSummaryEntry {
  label: string;
  value: string;
}

function extractSnapshotSummary(snapshot: CalcRunSnapshot): SnapshotSummaryEntry[] {
  if (snapshot.kind === 'regime_regular') {
    const out = snapshot.output as ObservabilidadeRocOutput;
    const entries: SnapshotSummaryEntry[] = [];
    if (out.IBSCBSTot?.vBCIBSCBS !== undefined) {
      entries.push({ label: 'Base CBS/IBS', value: out.IBSCBSTot.vBCIBSCBS });
    }
    if (out.IBSCBSTot?.gCBS?.vCBS !== undefined) {
      entries.push({ label: 'CBS (R$)', value: out.IBSCBSTot.gCBS.vCBS });
    }
    if (out.IBSCBSTot?.gIBS?.vIBS !== undefined) {
      entries.push({ label: 'IBS (R$)', value: out.IBSCBSTot.gIBS.vIBS });
    }
    if (out.ISTot?.vIS !== undefined) {
      entries.push({ label: 'IS (R$)', value: out.ISTot.vIS });
    }
    entries.push({ label: 'Itens', value: String(out.itens?.length ?? 0) });
    return entries;
  }

  if (snapshot.kind === 'simples_nacional') {
    const out = snapshot.output as ObservabilidadeSimplesOutput;
    return [
      { label: 'Base SN', value: out.totais?.vBC ?? '0.00' },
      { label: 'CBS SN', value: out.totais?.vCBSSN ?? '0.00' },
      { label: 'IBS SN', value: out.totais?.vIBSSN ?? '0.00' },
      { label: 'Total SN', value: out.totais?.totalGeral ?? '0.00' },
    ];
  }

  if (snapshot.kind === 'comparativo') {
    const out = snapshot.output as CompareRegimesOutput;
    return (out.cenarios ?? []).slice(0, 4).map((c) => ({
      label: c.titulo,
      value: c.totalTributos,
    }));
  }

  if (snapshot.kind === 'base_unificada') {
    const out = snapshot.output as BaseCalculoUnificadaOutput;
    return [
      { label: 'Base RG', value: out.baseRG },
      { label: 'Base IS', value: out.baseIS },
      { label: 'Base SN', value: out.baseSN },
    ];
  }

  return [];
}

function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MessageBubble({
  message,
  snapshot: propSnapshot,
  draft: propDraft,
  remoteEngineError: propRemoteError,
  onNavigateTab,
  onSelectSnapshot,
  onSelectDraft,
  onRetryForceLocal,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const resolvedSnapshot = propSnapshot ?? message.snapshot ?? null;
  const resolvedDraft = propDraft ?? message.draft ?? null;
  const effectiveCalcRunId = message.calcRunId ?? resolvedSnapshot?.id;
  const effectiveDraftId = message.draftId ?? resolvedDraft?.id;
  const resolvedRemoteError = propRemoteError ?? message.remoteEngineError ?? null;

  const summaryEntries = resolvedSnapshot ? extractSnapshotSummary(resolvedSnapshot) : [];
  const engineModeLabel =
    resolvedSnapshot?.engineMode === 'remote-official' ? 'Oficial RFB' : 'Motor Local (TS)';

  const handleOpenCalcTab = (tab: WorkbenchTabId) => {
    if (resolvedSnapshot) {
      onSelectSnapshot?.(resolvedSnapshot);
    }
    onNavigateTab?.(tab);
  };

  const handleOpenDraftTab = () => {
    if (resolvedDraft) {
      onSelectDraft?.(resolvedDraft);
    }
    onNavigateTab?.('staging');
  };

  return (
    <article
      className={`card message-bubble ${isUser ? 'message-bubble--user' : 'message-bubble--assistant'}`}
    >
      <div className="card__header message-bubble__header">
        <div className="message-bubble__identity">
          <span className="card__title">
            {isUser ? 'Você' : 'Copiloto Fiscal'}
          </span>
          {!isUser && effectiveCalcRunId && (
            <span className="badge badge--success">
              <ShieldCheck size={12} aria-hidden="true" />
              <span>Auditado pelo Motor Determinístico RFB</span>
            </span>
          )}
          {message.isStreaming && (
            <span className="badge badge--info">
              <Loader2 size={12} className="spin" aria-hidden="true" />
              <span>Analisando...</span>
            </span>
          )}
        </div>
        <span className="card__meta tabular-nums">
          {formatMessageTime(message.createdAt)}
        </span>
      </div>

      {message.attachmentNames && message.attachmentNames.length > 0 && (
        <div className="message-bubble__attachments">
          {message.attachmentNames.map((name) => (
            <span key={name} className="badge badge--neutral">
              {name}
            </span>
          ))}
        </div>
      )}

      {message.toolActivities && message.toolActivities.length > 0 && (
        <div className="message-bubble__tools" aria-label="Ferramentas fiscais acionadas">
          {message.toolActivities.map((tool) => (
            <span
              key={tool.callId}
              className={`badge ${tool.status === 'running' ? 'badge--info' : 'badge--neutral'}`}
            >
              {tool.status === 'running' ? (
                <Wrench size={11} aria-hidden="true" />
              ) : (
                <CheckCircle2 size={11} aria-hidden="true" />
              )}
              <span>
                {tool.toolName}
                {tool.resultSummary ? ` • ${tool.resultSummary}` : ''}
              </span>
            </span>
          ))}
        </div>
      )}

      {message.content ? (
        <SafeMarkdownContent content={message.content} />
      ) : message.isStreaming ? (
        <p className="msg-md__para" style={{ color: 'var(--text-muted)' }}>
          Consultando tabelas oficiais e motor determinístico...
        </p>
      ) : null}

      {message.groundingWarning && (
        <div className="banner banner--warning message-bubble__alert" role="alert">
          <span>
            <AlertTriangle
              size={15}
              aria-hidden="true"
              style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
            />
            <strong>Os totais do CalcRunSnapshot determinístico prevalecem</strong> sobre
            qualquer número divergente na explicação: {message.groundingWarning}
          </span>
        </div>
      )}

      {!isUser && effectiveCalcRunId && (
        <div className="grounding-box">
          <div className="grounding-box__meta">
            <span className="grounding-box__id">
              CalcRun: <code className="tabular-nums">{effectiveCalcRunId}</code>
            </span>
            <span className="badge badge--info">{engineModeLabel}</span>
          </div>

          {summaryEntries.length > 0 && (
            <dl className="grounding-box__figures">
              {summaryEntries.map((entry) => (
                <div key={entry.label} className="grounding-box__stat">
                  <dt>{entry.label}</dt>
                  <dd className="tabular-nums">{entry.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="grounding-box__actions">
            <button
              type="button"
              className="chip-btn chip-btn--action"
              onClick={() => handleOpenCalcTab('results')}
            >
              <Calculator size={13} aria-hidden="true" />
              <span>Ver Resultado &amp; Créditos</span>
            </button>
            <button
              type="button"
              className="chip-btn chip-btn--action"
              onClick={() => handleOpenCalcTab('memory')}
            >
              <Scale size={13} aria-hidden="true" />
              <span>Ver Memória &amp; Base Legal</span>
            </button>
            <button
              type="button"
              className="chip-btn chip-btn--action"
              onClick={() => handleOpenCalcTab('compare')}
            >
              <GitCompareArrows size={13} aria-hidden="true" />
              <span>Comparativo Regimes</span>
            </button>
            <button
              type="button"
              className="chip-btn chip-btn--action"
              onClick={() => handleOpenCalcTab('xml')}
            >
              <FileCode2 size={13} aria-hidden="true" />
              <span>Gerar XML / DANFSe</span>
            </button>
          </div>
        </div>
      )}

      {!isUser && effectiveDraftId && (
        <div className="grounding-box__actions" style={{ marginBlockStart: 'var(--space-2)' }}>
          <button
            type="button"
            className="chip-btn chip-btn--action"
            onClick={handleOpenDraftTab}
          >
            <TableProperties size={13} aria-hidden="true" />
            <span>Revisar Prévia &amp; Lote</span>
          </button>
        </div>
      )}

      {resolvedRemoteError && resolvedRemoteError.canForceLocal && (
        <div className="recovery-card" role="alert">
          <div className="recovery-card__header">
            <AlertTriangle size={16} aria-hidden="true" />
            <strong>Motor Oficial RFB Remoto Indisponível (Fail-Closed)</strong>
          </div>
          <p className="recovery-card__body">
            {resolvedRemoteError.message}
            {resolvedRemoteError.capability ? ` (Capacidade: ${resolvedRemoteError.capability}` : ''}
            {resolvedRemoteError.endpoint ? ` • Endpoint: ${resolvedRemoteError.endpoint})` : resolvedRemoteError.capability ? ')' : ''}
          </p>
          <div className="recovery-card__actions">
            <button
              type="button"
              className="btn btn--warning btn--sm"
              onClick={() => onRetryForceLocal?.(resolvedRemoteError)}
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span>Reprocessar no Motor Local TS</span>
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

import { BookOpen, ExternalLink, Scale } from 'lucide-react';
import type {
  BaseCalculoUnificadaOutput,
  CalcRunSnapshot,
  CompareRegimesOutput,
  FundamentacaoLegal,
  MemoriaCalculoTributo,
  ObservabilidadeRocItemOutput,
  ObservabilidadeRocOutput,
  ObservabilidadeSimplesItemOutput,
  ObservabilidadeSimplesOutput,
} from '../../shared/types/fiscal';

export interface MemoryLegalTabProps {
  snapshot: CalcRunSnapshot | null;
  onNavigateStaging?: () => void;
}

interface TraceAccordionEntry {
  key: string;
  heading: string;
  subtitle: string;
  estadoItem?: string;
  memoriaCalculo: MemoriaCalculoTributo[];
  fundamentacoesLegais: FundamentacaoLegal[];
  errorSummary?: string;
}

function isSafeHttpUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

function fromRocItems(
  prefix: string,
  itens: ObservabilidadeRocItemOutput[],
): TraceAccordionEntry[] {
  return itens.map((item) => ({
    key: `${prefix}-rg-${item.nObj}`,
    heading: `${prefix ? `${prefix} — ` : ''}Item #${item.nObj}${
      item.descricao ? ` · ${item.descricao}` : ''
    }`,
    subtitle: `CST ${item.cst} / cClassTrib ${item.cClassTrib}${
      item.ncm ? ` · NCM ${item.ncm}` : item.nbs ? ` · NBS ${item.nbs}` : ''
    }`,
    estadoItem: item.estadoItem,
    memoriaCalculo: item.memoriaCalculo ?? [],
    fundamentacoesLegais: item.fundamentacoesLegais ?? [],
    errorSummary:
      item.erros.length > 0
        ? item.erros.map((e) => `${e.code}${e.title ? `: ${e.title}` : ''}`).join(' | ')
        : undefined,
  }));
}

function fromSimplesItems(
  prefix: string,
  itens: ObservabilidadeSimplesItemOutput[],
): TraceAccordionEntry[] {
  return itens.map((item) => ({
    key: `${prefix}-sn-${item.nObj}`,
    heading: `${prefix ? `${prefix} — ` : ''}Item #${item.nObj}${
      item.descricao ? ` · ${item.descricao}` : ''
    }`,
    subtitle: `cAtivSN ${item.cAtivSN} / cClassTrib ${item.cClassTrib} · Fator R: ${item.modoFatorR}`,
    estadoItem: item.estadoItem,
    memoriaCalculo: item.memoriaCalculo ?? [],
    fundamentacoesLegais: item.fundamentacoesLegais ?? [],
    errorSummary:
      item.erros.length > 0
        ? item.erros.map((e) => `${e.code}${e.title ? `: ${e.title}` : ''}`).join(' | ')
        : undefined,
  }));
}

function buildTraceEntries(snapshot: CalcRunSnapshot): TraceAccordionEntry[] {
  if (snapshot.kind === 'regime_regular') {
    const out = snapshot.output as ObservabilidadeRocOutput;
    return fromRocItems('', out.itens ?? []);
  }

  if (snapshot.kind === 'simples_nacional') {
    const out = snapshot.output as ObservabilidadeSimplesOutput;
    return fromSimplesItems('', out.itens ?? []);
  }

  if (snapshot.kind === 'comparativo') {
    const out = snapshot.output as CompareRegimesOutput;
    const entries: TraceAccordionEntry[] = [];
    for (const cen of out.cenarios ?? []) {
      if (!cen.detalhe) {
        entries.push({
          key: `cmp-${cen.cenario}`,
          heading: cen.titulo,
          subtitle: `IS ${cen.totalIS} · CBS ${cen.totalCBS} · IBS ${cen.totalIBS} · Total ${cen.totalTributos}`,
          memoriaCalculo: [],
          fundamentacoesLegais: [],
          errorSummary:
            cen.erros.length > 0
              ? cen.erros.map((e) => `${e.code}${e.title ? `: ${e.title}` : ''}`).join(' | ')
              : undefined,
        });
        continue;
      }

      if ('totais' in cen.detalhe) {
        entries.push(...fromSimplesItems(cen.titulo, cen.detalhe.itens ?? []));
      } else {
        entries.push(...fromRocItems(cen.titulo, cen.detalhe.itens ?? []));
      }
    }
    return entries;
  }

  const baseOut = snapshot.output as BaseCalculoUnificadaOutput;
  return [
    {
      key: 'base-unificada-summary',
      heading: 'Base de Cálculo Unificada (NF-e / NFC-e / NFS-e)',
      subtitle: `baseRG: ${baseOut.baseRG} · baseIS: ${baseOut.baseIS} · baseSN: ${baseOut.baseSN}`,
      memoriaCalculo: [],
      fundamentacoesLegais: [
        {
          codigo: 'LC214-BASE',
          dispositivo: 'LC 214/2025, art. 12 e EC 132/2023',
          descricao: 'Base de cálculo unificada e transição tributária 2026–2033',
          texto:
            baseOut.avisos?.join(' • ') ||
            'Exclui tributos em extinção conforme ano do fato gerador.',
        },
      ],
    },
  ];
}

export function MemoryLegalTab({
  snapshot,
  onNavigateStaging,
}: MemoryLegalTabProps) {
  if (!snapshot) {
    return (
      <article className="card">
        <div className="empty-state">
          <strong>Nenhuma memória de cálculo disponível</strong>
          <p style={{ margin: '0 0 var(--space-3)' }}>
            Execute um cálculo determinístico (Regime Regular, Simples Nacional ou
            Comparativo) para inspecionar as fórmulas passo a passo e as fundamentações
            legais da LC 214/2025 e NT 2026.005.
          </p>
          {onNavigateStaging && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={onNavigateStaging}
            >
              Ir para Prévia &amp; Lote
            </button>
          )}
        </div>
      </article>
    );
  }

  const entries = buildTraceEntries(snapshot);

  return (
    <div className="stack">
      <article className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">
              <Scale
                size={16}
                aria-hidden="true"
                style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
              />
              Memória de Cálculo &amp; Fundamentação Legal (LC 214/2025 &amp; NT 2026.005)
            </h3>
            <span className="card__meta tabular-nums">
              Snapshot <code>{snapshot.id}</code> &bull; Vigência: {snapshot.dhFatoGerador}{' '}
              &bull; {entries.length}{' '}
              {entries.length === 1 ? 'registro auditável' : 'registros auditáveis'}
            </span>
          </div>
          <span className="badge badge--info">
            {snapshot.engineMode === 'remote-official' ? 'Oficial RFB' : 'Motor Local (TS)'}
          </span>
        </div>

        {entries.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            Nenhum item com memória de cálculo registrada neste snapshot.
          </p>
        ) : (
          <div className="memory-accordion-list">
            {entries.map((entry) => (
              <details key={entry.key} className="memory-accordion" open>
                <summary className="memory-accordion__summary">
                  <div className="memory-accordion__title-wrap">
                    <strong>{entry.heading}</strong>
                    <span className="card__meta tabular-nums">{entry.subtitle}</span>
                  </div>
                  {entry.estadoItem && (
                    <span className="badge badge--neutral">{entry.estadoItem}</span>
                  )}
                </summary>

                <div className="memory-accordion__body">
                  {entry.errorSummary && (
                    <div className="banner banner--danger" role="status">
                      <span className="tabular-nums">{entry.errorSummary}</span>
                    </div>
                  )}

                  <div>
                    <h4 className="memory-section-title">
                      Memória de Cálculo Passo a Passo
                    </h4>
                    {entry.memoriaCalculo.length === 0 ? (
                      <p className="aux-panel__hint">
                        Sem linhas de memória tributária calculadas para este item.
                      </p>
                    ) : (
                      <div className="table-wrapper">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th scope="col">Tributo</th>
                              <th scope="col" className="num">
                                Base (vBC)
                              </th>
                              <th scope="col" className="num">
                                Alíq. Nominal
                              </th>
                              <th scope="col" className="num">
                                Redução (%)
                              </th>
                              <th scope="col" className="num">
                                Alíq. Efetiva
                              </th>
                              <th scope="col" className="num">
                                Valor Calculado
                              </th>
                              <th scope="col" className="num">
                                Diferimento
                              </th>
                              <th scope="col" className="num">
                                Valor Devido
                              </th>
                              <th scope="col">Expressão &amp; Rastro</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.memoriaCalculo.map((step, idx) => (
                              <tr key={`${entry.key}-step-${step.tributo}-${idx}`}>
                                <th scope="row">{step.tributo}</th>
                                <td className="num tabular-nums">{step.baseCalculo}</td>
                                <td className="num tabular-nums">
                                  {step.aliquotaNominal ?? '—'}
                                </td>
                                <td className="num tabular-nums">
                                  {step.percentualReducao ?? '0.00'}
                                </td>
                                <td className="num tabular-nums">
                                  {step.aliquotaEfetiva ?? '—'}
                                </td>
                                <td className="num tabular-nums">{step.valorCalculado}</td>
                                <td className="num tabular-nums">
                                  {step.valorDiferimento ?? '0.00'}
                                </td>
                                <td className="num tabular-nums">
                                  <strong>{step.valorDevido}</strong>
                                </td>
                                <td>
                                  <div className="memory-trace-cell">
                                    {step.expressaoAplicada && (
                                      <code>{step.expressaoAplicada}</code>
                                    )}
                                    {step.memoriaTexto && <span>{step.memoriaTexto}</span>}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="memory-section-title">
                      <BookOpen
                        size={13}
                        aria-hidden="true"
                        style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.25rem' }}
                      />
                      Fundamentação Legal (FUNDAMENTACAO_LEGAL)
                    </h4>
                    {entry.fundamentacoesLegais.length === 0 ? (
                      <p className="aux-panel__hint">
                        Nenhuma fundamentação legal específica vinculada a este item.
                      </p>
                    ) : (
                      <ul className="legal-citation-list">
                        {entry.fundamentacoesLegais.map((cit, idx) => (
                          <li
                            key={`${entry.key}-legal-${cit.codigo ?? cit.dispositivo}-${idx}`}
                            className="legal-citation-item"
                          >
                            <div className="legal-citation-item__header">
                              <strong>{cit.dispositivo}</strong>
                              {cit.codigo && (
                                <span className="badge badge--neutral tabular-nums">
                                  {cit.codigo}
                                </span>
                              )}
                            </div>
                            {cit.descricao && (
                              <p className="legal-citation-item__desc">{cit.descricao}</p>
                            )}
                            {cit.texto && (
                              <p className="legal-citation-item__text">{cit.texto}</p>
                            )}
                            {isSafeHttpUrl(cit.url) && (
                              <a
                                href={cit.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="legal-citation-item__link"
                              >
                                <ExternalLink size={12} aria-hidden="true" />
                                <span>Ver norma oficial</span>
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

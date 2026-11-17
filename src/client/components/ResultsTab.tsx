import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  ShieldCheck,
  X,
} from 'lucide-react';
import type {
  BaseCalculoUnificadaOutput,
  CalcRunSnapshot,
  CreditIndicators,
  EstadoItem,
  FiscalErrorItem,
  ObservabilidadeRocItemOutput,
  ObservabilidadeRocOutput,
  ObservabilidadeSimplesItemOutput,
  ObservabilidadeSimplesOutput,
  SplitPaymentGuidance,
} from '../../shared/types/fiscal';
import {
  getExportJsonUrl,
  getExportXlsxUrl,
  lookupErros,
} from '../api/client';

export interface ResultsTabProps {
  snapshot: CalcRunSnapshot | null;
  onNavigateStaging?: () => void;
  onNavigateCompare?: () => void;
}

const ESTADO_TONE: Record<EstadoItem, string> = {
  CALCULADO: 'badge--success',
  CALCULO_SIMULADO: 'badge--warning',
  INCONSISTENCIA_ENTRADA: 'badge--danger',
  NAO_IMPLEMENTADO: 'badge--neutral',
  NAO_CALCULADO: 'badge--neutral',
  FALHA_TECNICA: 'badge--danger',
};

function sumDecimals2(values: Array<string | undefined>): string {
  let cents = 0;
  for (const raw of values) {
    if (!raw) continue;
    const normalized = raw.trim().replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed)) {
      cents += Math.round(parsed * 100);
    }
  }
  return (cents / 100).toFixed(2);
}

function buildFallbackSplitPayment(
  vCbs: string,
  vIbs: string,
): SplitPaymentGuidance {
  const total = sumDecimals2([vCbs, vIbs]);
  const aplicavel = Number.parseFloat(total) > 0;
  return {
    aplicavel,
    vCbsSujeito: vCbs,
    vIbsSujeito: vIbs,
    vTotalSujeito: total,
    orientacao: aplicavel
      ? `Retenção automática na liquidação financeira (Split Payment) de R$ ${total} (CBS R$ ${vCbs} + IBS R$ ${vIbs}), segregada do faturamento comercial bruto antes do repasse líquido ao fornecedor.`
      : 'Sem débito apurado de CBS ou IBS sujeito à retenção apartada na liquidação financeira para esta operação.',
    observacaoLegal:
      'LC 214/2025, Arts. 31–35 — Orientação qualitativa de fluxo de caixa baseada exclusivamente nos débitos calculados pelo motor determinístico.',
  };
}

interface ErrorDialogModalProps {
  error: FiscalErrorItem | null;
  onClose: () => void;
}

function ErrorDetailDialog({ error, onClose }: ErrorDialogModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [enriched, setEnriched] = useState<FiscalErrorItem | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (error && !dialog.open) {
      dialog.showModal();
    } else if (!error && dialog.open) {
      dialog.close();
    }
  }, [error]);

  useEffect(() => {
    if (!error) {
      setEnriched(null);
      return;
    }
    setEnriched(error);

    if (error.title && error.description) {
      return;
    }

    let cancelled = false;
    void lookupErros(error.code)
      .then((res) => {
        if (!cancelled && res.item) {
          setEnriched({
            ...error,
            title: error.title ?? res.item.titulo,
            description: error.description ?? res.item.descricao,
            pointer: error.pointer ?? res.item.campoDefault ?? undefined,
          });
        }
      })
      .catch(() => {
        // Optional catalog enrichment
      });

    return () => {
      cancelled = true;
    };
  }, [error]);

  const active = enriched ?? error;

  return (
    <dialog
      ref={dialogRef}
      className="native-dialog"
      aria-labelledby="error-detail-dialog-title"
      closedby="any"
      onClose={() => {
        if (error) onClose();
      }}
    >
      <div className="dialog__header">
        <h2 id="error-detail-dialog-title" className="dialog__title">
          Detalhe da Inconsistência Fiscal
        </h2>
        <form method="dialog">
          <button
            type="submit"
            value="close"
            className="btn btn--sm"
            aria-label="Fechar detalhe do erro"
          >
            <X size={14} aria-hidden="true" />
            <span>Fechar</span>
          </button>
        </form>
      </div>

      {active && (
        <div className="dialog__body">
          <div className="dialog__item">
            <div className="dialog__item-meta">
              <span className="badge badge--danger tabular-nums">{active.code}</span>
              <span className="dialog__item-title" style={{ marginBlockStart: 'var(--space-2)' }}>
                {active.title ?? 'Inconsistência de entrada ou regra tributária'}
              </span>
            </div>
          </div>

          <div>
            <h3 className="dialog__section-title">Descrição Oficial</h3>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
              {active.description ??
                'Verifique os dados informados no item para compatibilidade com a regra da Receita Federal.'}
            </p>
          </div>

          {active.pointer && (
            <div>
              <h3 className="dialog__section-title">Ponteiro do Campo</h3>
              <code className="tabular-nums">{active.pointer}</code>
            </div>
          )}
        </div>
      )}

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

function CreditIndicatorsSection({
  entries,
}: {
  entries: Array<{ nObj: number; credit: CreditIndicators }>;
}) {
  return (
    <article className="card">
      <div className="card__header">
        <h3 className="card__title">
          <ShieldCheck
            size={15}
            aria-hidden="true"
            style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
          />
          Indicadores de Apropriação de Crédito (CLASSIFICACAO_TRIBUTARIA)
        </h3>
        <span className="card__meta">Dados oficiais RFB</span>
      </div>

      {entries.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          Nenhum indicador de crédito vinculado aos itens calculados deste snapshot.
        </p>
      ) : (
        <div className="credit-grid">
          {entries.map(({ nObj, credit }) => (
            <div
              key={`credit-${nObj}-${credit.cClassTrib}`}
              className="credit-card"
            >
              <div className="credit-card__header">
                <span className="badge badge--info tabular-nums">
                  Item #{nObj} &bull; cClassTrib {credit.cClassTrib}
                </span>
                {credit.creditoOperacaoAntecedente && (
                  <span className="badge badge--neutral">
                    Op. Antecedente: {credit.creditoOperacaoAntecedente}
                  </span>
                )}
              </div>
              {credit.descricaoClassificacao && (
                <p className="credit-card__desc">{credit.descricaoClassificacao}</p>
              )}
              <dl className="credit-flags">
                <div className="credit-flag">
                  <dt>CBS Adquirente</dt>
                  <dd>
                    <span
                      className={`badge ${credit.apropriacaoCreditoCbs ? 'badge--success' : 'badge--neutral'}`}
                    >
                      {credit.apropriacaoCreditoCbs ? 'Permite Crédito' : 'Vedado'}
                    </span>
                  </dd>
                </div>
                <div className="credit-flag">
                  <dt>IBS Adquirente</dt>
                  <dd>
                    <span
                      className={`badge ${credit.apropriacaoCreditoIbs ? 'badge--success' : 'badge--neutral'}`}
                    >
                      {credit.apropriacaoCreditoIbs ? 'Permite Crédito' : 'Vedado'}
                    </span>
                  </dd>
                </div>
                <div className="credit-flag">
                  <dt>Crédito Presumido Fornecedor</dt>
                  <dd>
                    <span
                      className={`badge ${credit.creditoPresumidoFornecedor ? 'badge--info' : 'badge--neutral'}`}
                    >
                      {credit.creditoPresumidoFornecedor ? 'Sim' : 'Não'}
                    </span>
                  </dd>
                </div>
                <div className="credit-flag">
                  <dt>Crédito Presumido Adquirente</dt>
                  <dd>
                    <span
                      className={`badge ${credit.creditoPresumidoAdquirente ? 'badge--info' : 'badge--neutral'}`}
                    >
                      {credit.creditoPresumidoAdquirente ? 'Sim' : 'Não'}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function SplitPaymentCard({ guidance }: { guidance: SplitPaymentGuidance }) {
  return (
    <article className="card">
      <div className="card__header">
        <h3 className="card__title">
          <Banknote
            size={15}
            aria-hidden="true"
            style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
          />
          Split Payment &amp; Fluxo de Caixa (LC 214/2025, Arts. 31–35)
        </h3>
        <span className={`badge ${guidance.aplicavel ? 'badge--info' : 'badge--neutral'}`}>
          {guidance.aplicavel ? 'Sujeito à segregação' : 'Sem débito a segregar'}
        </span>
      </div>

      <p style={{ margin: '0 0 var(--space-3)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
        No mecanismo de Split Payment, os valores devidos de CBS e IBS são retidos
        automaticamente na liquidação financeira do pagamento e recolhidos aos entes,
        reduzindo o repasse líquido em relação ao faturamento comercial bruto.
      </p>

      <dl className="grounding-box__figures" style={{ marginBlockEnd: 'var(--space-3)' }}>
        <div className="grounding-box__stat">
          <dt>CBS Sujeito (R$)</dt>
          <dd className="tabular-nums">{guidance.vCbsSujeito}</dd>
        </div>
        <div className="grounding-box__stat">
          <dt>IBS Sujeito (R$)</dt>
          <dd className="tabular-nums">{guidance.vIbsSujeito}</dd>
        </div>
        <div className="grounding-box__stat">
          <dt>Total Retenção Apartada (R$)</dt>
          <dd className="tabular-nums">{guidance.vTotalSujeito}</dd>
        </div>
      </dl>

      <p style={{ margin: '0 0 var(--space-2)', fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
        {guidance.orientacao}
      </p>
      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        <Info
          size={13}
          aria-hidden="true"
          style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.25rem' }}
        />
        {guidance.observacaoLegal}
      </p>
    </article>
  );
}

export function ResultsTab({
  snapshot,
  onNavigateStaging,
  onNavigateCompare,
}: ResultsTabProps) {
  const [selectedError, setSelectedError] = useState<FiscalErrorItem | null>(null);

  if (!snapshot) {
    return (
      <article className="card">
        <div className="empty-state">
          <strong>Nenhum cálculo determinístico executado</strong>
          <p style={{ margin: '0 0 var(--space-3)' }}>
            Revise os itens na aba Prévia &amp; Lote ou solicite uma simulação ao Copiloto
            para visualizar os tributos, indicadores de crédito e Split Payment.
          </p>
          {onNavigateStaging && (
            <button type="button" className="btn btn--primary btn--sm" onClick={onNavigateStaging}>
              Ir para Prévia &amp; Lote
            </button>
          )}
        </div>
      </article>
    );
  }

  if (snapshot.kind === 'comparativo') {
    return (
      <article className="card">
        <div className="empty-state">
          <strong>Snapshot de Comparativo entre Regimes ativo</strong>
          <p style={{ margin: '0 0 var(--space-3)' }}>
            O último cálculo executado é um comparativo multi-cenário. Visualize o quadro
            lado a lado na aba Comparativo Regimes.
          </p>
          {onNavigateCompare && (
            <button type="button" className="btn btn--primary btn--sm" onClick={onNavigateCompare}>
              Abrir Comparativo Regimes
            </button>
          )}
        </div>
      </article>
    );
  }

  if (snapshot.kind === 'base_unificada') {
    const baseOut = snapshot.output as BaseCalculoUnificadaOutput;
    return (
      <div className="stack">
        <article className="card">
          <div className="card__header">
            <div>
              <h3 className="card__title">Base de Cálculo Unificada</h3>
              <span className="card__meta tabular-nums">
                Snapshot <code>{snapshot.id}</code> &bull; Fato gerador: {snapshot.dhFatoGerador} &bull;{' '}
                {snapshot.engineMode === 'remote-official' ? 'Oficial RFB' : 'Motor Local (TS)'}
              </span>
            </div>

            <div className="staging-header-actions">
              <a
                href={getExportXlsxUrl(snapshot.id)}
                download
                className="btn btn--sm"
              >
                <FileSpreadsheet size={14} aria-hidden="true" />
                <span>Exportar Planilha Auditável (.xlsx)</span>
              </a>
              <a
                href={getExportJsonUrl(snapshot.id)}
                download
                className="btn btn--sm"
              >
                <Download size={14} aria-hidden="true" />
                <span>Exportar JSON</span>
              </a>
            </div>
          </div>

          <div className="kpi-grid">
            <article className="kpi-card">
              <span className="kpi-card__label">Base Regime Regular</span>
              <span className="kpi-value tabular-nums">{baseOut.baseRG}</span>
              <span className="kpi-card__hint">Base CBS / IBS</span>
            </article>
            <article className="kpi-card">
              <span className="kpi-card__label">Base Imposto Seletivo</span>
              <span className="kpi-value tabular-nums">{baseOut.baseIS}</span>
              <span className="kpi-card__hint">Base IS</span>
            </article>
            <article className="kpi-card">
              <span className="kpi-card__label">Base Simples Nacional</span>
              <span className="kpi-value tabular-nums">{baseOut.baseSN}</span>
              <span className="kpi-card__hint">Base RBT / Simples</span>
            </article>
          </div>

          {baseOut.avisos && baseOut.avisos.length > 0 && (
            <div className="banner banner--info" role="status">
              <span>{baseOut.avisos.join(' • ')}</span>
            </div>
          )}
        </article>
      </div>
    );
  }

  const isSimples = snapshot.kind === 'simples_nacional';
  const regularOut = !isSimples ? (snapshot.output as ObservabilidadeRocOutput) : null;
  const simplesOut = isSimples ? (snapshot.output as ObservabilidadeSimplesOutput) : null;

  const simulatedWarning =
    snapshot.xWarningDadosSimulados || Boolean(regularOut?.xWarningDadosSimulados);

  const globalErrors =
    regularOut?.errosGlobais ?? simplesOut?.errosGlobais ?? [];
  const avisos = regularOut?.avisos ?? simplesOut?.avisos ?? [];

  const creditEntries: Array<{ nObj: number; credit: CreditIndicators }> = [];
  if (regularOut) {
    for (const item of regularOut.itens ?? []) {
      if (item.creditIndicators) {
        creditEntries.push({ nObj: item.nObj, credit: item.creditIndicators });
      }
    }
  } else if (simplesOut) {
    for (const item of simplesOut.itens ?? []) {
      if (item.creditIndicators) {
        creditEntries.push({ nObj: item.nObj, credit: item.creditIndicators });
      }
    }
  }

  const splitGuidance: SplitPaymentGuidance = isSimples
    ? simplesOut?.splitPaymentGuidance ??
      buildFallbackSplitPayment(
        simplesOut?.totais?.vCBSSN ?? '0.00',
        simplesOut?.totais?.vIBSSN ?? '0.00',
      )
    : regularOut?.splitPaymentGuidance ??
      buildFallbackSplitPayment(
        regularOut?.IBSCBSTot?.gCBS?.vCBS ?? '0.00',
        regularOut?.IBSCBSTot?.gIBS?.vIBS ?? '0.00',
      );

  const vCbs = regularOut?.IBSCBSTot?.gCBS?.vCBS ?? '0.00';
  const vIbsUf = regularOut?.IBSCBSTot?.gIBS?.gIBSUF?.vIBSUF ?? '0.00';
  const vIbsMun = regularOut?.IBSCBSTot?.gIBS?.gIBSMun?.vIBSMun ?? '0.00';
  const vIbsTot = regularOut?.IBSCBSTot?.gIBS?.vIBS ?? sumDecimals2([vIbsUf, vIbsMun]);
  const vIs = regularOut?.ISTot?.vIS ?? '0.00';
  const totalRegular = sumDecimals2([vCbs, vIbsTot, vIs]);

  return (
    <div className="stack">
      {simulatedWarning && (
        <div
          className="banner banner--warning"
          role="status"
          data-testid="simulated-warning-banner"
        >
          <span>
            <AlertTriangle
              size={15}
              aria-hidden="true"
              style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
            />
            <strong>Atenção: Alíquotas simuladas (2027+) — valores nominais informados pelo usuário</strong>
          </span>
        </div>
      )}

      {/* Header & Exports */}
      <article className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">
              Resultado Determinístico &amp; Créditos
            </h3>
            <span className="card__meta tabular-nums">
              Snapshot <code>{snapshot.id}</code> &bull; Fato gerador: {snapshot.dhFatoGerador} &bull;{' '}
              {snapshot.engineMode === 'remote-official' ? 'Oficial RFB' : 'Motor Local (TS)'}
            </span>
          </div>

          <div className="staging-header-actions">
            <a
              href={getExportXlsxUrl(snapshot.id)}
              download
              className="btn btn--sm"
            >
              <FileSpreadsheet size={14} aria-hidden="true" />
              <span>Exportar Planilha Auditável (.xlsx)</span>
            </a>
            <a
              href={getExportJsonUrl(snapshot.id)}
              download
              className="btn btn--sm"
            >
              <Download size={14} aria-hidden="true" />
              <span>Exportar JSON</span>
            </a>
          </div>
        </div>

        {avisos.length > 0 && (
          <div className="banner banner--info" role="status">
            <span>{avisos.join(' • ')}</span>
          </div>
        )}

        {globalErrors.length > 0 && (
          <div className="banner banner--danger" role="alert">
            <div className="error-chip-row">
              <strong>Erros Globais:</strong>
              {globalErrors.map((err, i) => (
                <button
                  key={`global-err-${err.code}-${i}`}
                  type="button"
                  className="chip-btn chip-btn--error"
                  onClick={() => setSelectedError(err)}
                >
                  {err.code}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* KPI Grid */}
        {isSimples && simplesOut ? (
          <div className="kpi-grid">
            <article className="kpi-card">
              <span className="kpi-card__label">IBSSN</span>
              <span className="kpi-value tabular-nums">
                {simplesOut.totais?.vIBSSN ?? '0.00'}
              </span>
              <span className="kpi-card__hint tabular-nums">
                Base SN: R$ {simplesOut.totais?.vBC ?? '0.00'}
              </span>
            </article>
            <article className="kpi-card">
              <span className="kpi-card__label">CBSSN</span>
              <span className="kpi-value tabular-nums">
                {simplesOut.totais?.vCBSSN ?? '0.00'}
              </span>
              <span className="kpi-card__hint">
                CRT {simplesOut.CRT} &bull; DAS / Simples
              </span>
            </article>
            <article className="kpi-card">
              <span className="kpi-card__label">Total Simples</span>
              <span className="kpi-value tabular-nums">
                {simplesOut.totais?.totalGeral ?? '0.00'}
              </span>
              <span className="kpi-card__hint">
                {simplesOut.itens.length} {simplesOut.itens.length === 1 ? 'item' : 'itens'}
              </span>
            </article>
          </div>
        ) : (
          <div className="kpi-grid">
            <article className="kpi-card">
              <span className="kpi-card__label">CBS</span>
              <span className="kpi-value tabular-nums">{vCbs}</span>
              <span className="kpi-card__hint tabular-nums">
                Base: R$ {regularOut?.IBSCBSTot?.vBCIBSCBS ?? '0.00'}
              </span>
            </article>
            <article className="kpi-card">
              <span className="kpi-card__label">IBS UF</span>
              <span className="kpi-value tabular-nums">{vIbsUf}</span>
              <span className="kpi-card__hint">Competência Estadual</span>
            </article>
            <article className="kpi-card">
              <span className="kpi-card__label">IBS Mun</span>
              <span className="kpi-value tabular-nums">{vIbsMun}</span>
              <span className="kpi-card__hint">Competência Municipal</span>
            </article>
            <article className="kpi-card">
              <span className="kpi-card__label">IS</span>
              <span className="kpi-value tabular-nums">{vIs}</span>
              <span className="kpi-card__hint">Imposto Seletivo</span>
            </article>
            <article className="kpi-card">
              <span className="kpi-card__label">Total Tributos</span>
              <span className="kpi-value tabular-nums">{totalRegular}</span>
              <span className="kpi-card__hint">
                {regularOut?.itens?.length ?? 0}{' '}
                {(regularOut?.itens?.length ?? 0) === 1 ? 'item' : 'itens'}
              </span>
            </article>
          </div>
        )}

        {/* Itemized Results Table */}
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              {isSimples ? (
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Descrição / Atividade</th>
                  <th scope="col">cClassTrib</th>
                  <th scope="col">Modo Fator R</th>
                  <th scope="col" className="num">Base (vBC)</th>
                  <th scope="col" className="num">CBSSN</th>
                  <th scope="col" className="num">IBSSN</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Ocorrências</th>
                </tr>
              ) : (
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Descrição / NCM·NBS</th>
                  <th scope="col">CST / cClassTrib</th>
                  <th scope="col" className="num">Base (vBC)</th>
                  <th scope="col" className="num">CBS</th>
                  <th scope="col" className="num">IBS UF</th>
                  <th scope="col" className="num">IBS Mun</th>
                  <th scope="col" className="num">IS</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Ocorrências</th>
                </tr>
              )}
            </thead>
            <tbody>
              {isSimples && simplesOut
                ? simplesOut.itens.map((item: ObservabilidadeSimplesItemOutput) => (
                    <tr key={`res-sn-item-${item.nObj}`}>
                      <th scope="row" className="tabular-nums">
                        {item.nObj}
                      </th>
                      <td>
                        <div>{item.descricao || `Item ${item.nObj}`}</div>
                        <small className="card__meta tabular-nums">
                          cAtivSN: {item.cAtivSN}
                        </small>
                      </td>
                      <td className="tabular-nums">{item.cClassTrib}</td>
                      <td>
                        <span className="badge badge--neutral">{item.modoFatorR}</span>
                      </td>
                      <td className="num tabular-nums">{item.vBC}</td>
                      <td className="num tabular-nums">{item.vCBSSN ?? '0.00'}</td>
                      <td className="num tabular-nums">{item.vIBSSN ?? '0.00'}</td>
                      <td className="num tabular-nums">{item.totalItem}</td>
                      <td>
                        <span className={`badge ${ESTADO_TONE[item.estadoItem]}`}>
                          {item.estadoItem}
                        </span>
                      </td>
                      <td>
                        {item.erros.length === 0 ? (
                          <span className="badge badge--success">
                            <CheckCircle2 size={11} aria-hidden="true" /> OK
                          </span>
                        ) : (
                          <div className="error-chip-row">
                            {item.erros.map((err, errIdx) => (
                              <button
                                key={`sn-err-${item.nObj}-${err.code}-${errIdx}`}
                                type="button"
                                className="chip-btn chip-btn--error tabular-nums"
                                onClick={() => setSelectedError(err)}
                              >
                                {err.code}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                : (regularOut?.itens ?? []).map((item: ObservabilidadeRocItemOutput) => (
                    <tr key={`res-rg-item-${item.nObj}`}>
                      <th scope="row" className="tabular-nums">
                        {item.nObj}
                      </th>
                      <td>
                        <div>{item.descricao || `Item ${item.nObj}`}</div>
                        {(item.ncm || item.nbs) && (
                          <small className="card__meta tabular-nums">
                            {item.ncm ? `NCM ${item.ncm}` : `NBS ${item.nbs}`}
                          </small>
                        )}
                      </td>
                      <td className="tabular-nums">
                        {item.cst} / {item.cClassTrib}
                      </td>
                      <td className="num tabular-nums">
                        {item.gIBSCBS?.vBC ?? item.gIS?.vBCIS ?? '—'}
                      </td>
                      <td className="num tabular-nums">
                        {item.gIBSCBS?.gCBS?.vCBS ?? '0.00'}
                      </td>
                      <td className="num tabular-nums">
                        {item.gIBSCBS?.gIBSUF?.vIBSUF ?? '0.00'}
                      </td>
                      <td className="num tabular-nums">
                        {item.gIBSCBS?.gIBSMun?.vIBSMun ?? '0.00'}
                      </td>
                      <td className="num tabular-nums">{item.gIS?.vIS ?? '0.00'}</td>
                      <td>
                        <span className={`badge ${ESTADO_TONE[item.estadoItem]}`}>
                          {item.estadoItem}
                        </span>
                      </td>
                      <td>
                        {item.erros.length === 0 ? (
                          <span className="badge badge--success">
                            <CheckCircle2 size={11} aria-hidden="true" /> OK
                          </span>
                        ) : (
                          <div className="error-chip-row">
                            {item.erros.map((err, errIdx) => (
                              <button
                                key={`rg-err-${item.nObj}-${err.code}-${errIdx}`}
                                type="button"
                                className="chip-btn chip-btn--error tabular-nums"
                                onClick={() => setSelectedError(err)}
                              >
                                {err.code}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </article>

      <CreditIndicatorsSection entries={creditEntries} />
      <SplitPaymentCard guidance={splitGuidance} />

      <ErrorDetailDialog
        error={selectedError}
        onClose={() => setSelectedError(null)}
      />
    </div>
  );
}

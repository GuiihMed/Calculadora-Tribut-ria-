import { useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AliquotasNominaisInput,
  BaseCalculoUnificadaOutput,
  CalcRunSnapshot,
  ExtractionDraft,
  ExtractionDraftItem,
  FatorRAuxiliarOutput,
  FieldConfidence,
  OperationContext,
} from '../../shared/types/fiscal';
import {
  ApiError,
  type AtividadeSimplesLookupItem,
  calculateBaseUnificada,
  calculateFatorR,
  calculateFiscal,
  type ClassTribLookupItem,
  compareFiscalRegimes,
  listAtividadesSimples,
  type NbsLookupItem,
  type NcmLookupItem,
  searchClassTrib,
  searchNbs,
  searchNcm,
} from '../api/client';
import type { WorkbenchTabId } from './MessageBubble';

export interface StagingTabProps {
  draft: ExtractionDraft | null;
  activeContext: Partial<OperationContext>;
  sessionId: string | null;
  onDraftChange: (draft: ExtractionDraft) => void;
  onSnapshotCreated: (snapshot: CalcRunSnapshot) => void;
  onNavigateTab: (tab: WorkbenchTabId) => void;
}

interface LookupState {
  itemIndex: number;
  kind: 'ncm' | 'nbs' | 'cClassTrib' | 'cAtivSN';
  loading: boolean;
  error?: string;
  ncmItems?: NcmLookupItem[];
  nbsItems?: NbsLookupItem[];
  classTribItems?: ClassTribLookupItem[];
  atividadesItems?: AtividadeSimplesLookupItem[];
}

interface RemoteFailureState {
  message: string;
  capability?: string;
  endpoint?: string;
}

function createBlankItem(nObj: number): ExtractionDraftItem {
  return {
    nObj,
    descricao: '',
    ncm: '',
    nbs: '',
    cst: '',
    cClassTrib: '',
    cAtivSN: '',
    baseCalculo: '',
    vProd: '',
    vFrete: '',
    vDesc: '',
    vICMS: '',
    vPIS: '',
    vCOFINS: '',
    aliquotasNominais: { pCBS: '', pIBSUF: '', pIBSMun: '' },
    pIBSSN: '',
    pCBSSN: '',
    confidence: {},
    missingFields: [],
  };
}

function createManualDraft(
  context: Partial<OperationContext>,
  sessionId: string | null,
): ExtractionDraft {
  return {
    id: `manual-${Date.now()}`,
    sessionId: sessionId ?? undefined,
    sourceType: 'manual',
    filename: 'Simulação Manual (Mesa Fiscal)',
    context,
    itens: [createBlankItem(1)],
    warnings: [],
    requiresReview: false,
    createdAt: new Date().toISOString(),
  };
}

function getFieldConfidence(
  item: ExtractionDraftItem,
  field: string,
): FieldConfidence | null {
  if (item.confidence && item.confidence[field]) {
    return item.confidence[field];
  }
  if (item.missingFields?.includes(field)) {
    return 'missing';
  }
  return null;
}

function getItemOverallConfidence(item: ExtractionDraftItem): FieldConfidence {
  const values = Object.values(item.confidence ?? {});
  if (item.missingFields.length > 0 || values.includes('missing')) {
    return 'missing';
  }
  if (values.includes('low') || values.includes('medium')) {
    return 'medium';
  }
  if (values.includes('high')) {
    return 'high';
  }
  return 'medium';
}

function ConfidenceBadge({
  confidence,
  labelPrefix,
}: {
  confidence: FieldConfidence | null;
  labelPrefix?: string;
}) {
  if (!confidence) {
    return null;
  }
  const map: Record<FieldConfidence, { label: string; tone: string }> = {
    high: { label: 'Alta', tone: 'badge--success' },
    medium: { label: 'Revisar', tone: 'badge--warning' },
    low: { label: 'Revisar', tone: 'badge--warning' },
    missing: { label: 'Faltante', tone: 'badge--danger' },
  };
  const entry = map[confidence];
  return (
    <span className={`badge ${entry.tone}`}>
      {labelPrefix ? `${labelPrefix}: ` : ''}
      {entry.label}
    </span>
  );
}

function cleanDecimal(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(',', '.');
}

function resolveTpDoc(tipoDfe: OperationContext['tipoDfe'] | undefined): number {
  if (tipoDfe === '65') return 65;
  if (tipoDfe === 'NFSE') return 99;
  return 55;
}

function buildCleanAliquotas(
  aliquotas: AliquotasNominaisInput | undefined,
): AliquotasNominaisInput | undefined {
  if (!aliquotas) {
    return undefined;
  }
  const pCBS = cleanDecimal(
    aliquotas.pCBS !== undefined ? String(aliquotas.pCBS) : undefined,
  );
  const pIBSUF = cleanDecimal(
    aliquotas.pIBSUF !== undefined ? String(aliquotas.pIBSUF) : undefined,
  );
  const pIBSMun = cleanDecimal(
    aliquotas.pIBSMun !== undefined ? String(aliquotas.pIBSMun) : undefined,
  );
  if (!pCBS && !pIBSUF && !pIBSMun) {
    return undefined;
  }
  return {
    ...(pCBS ? { pCBS } : {}),
    ...(pIBSUF ? { pIBSUF } : {}),
    ...(pIBSMun ? { pIBSMun } : {}),
  };
}

export function StagingTab({
  draft,
  activeContext,
  sessionId,
  onDraftChange,
  onSnapshotCreated,
  onNavigateTab,
}: StagingTabProps) {
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [lookup, setLookup] = useState<LookupState | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [remoteFailure, setRemoteFailure] = useState<RemoteFailureState | null>(null);

  // Auxiliary Base Unificada & Fator R quick panel state
  const [baseNatureza, setBaseNatureza] = useState<'bem' | 'servico'>('bem');
  const [baseResult, setBaseResult] = useState<BaseCalculoUnificadaOutput | null>(null);
  const [baseLoading, setBaseLoading] = useState(false);
  const [baseError, setBaseError] = useState<string | null>(null);

  const [folha12m, setFolha12m] = useState('');
  const [rbt12m, setRbt12m] = useState('');
  const [fatorRResult, setFatorRResult] = useState<FatorRAuxiliarOutput | null>(null);
  const [fatorRLoading, setFatorRLoading] = useState(false);
  const [fatorRError, setFatorRError] = useState<string | null>(null);

  const regime = activeContext.regime ?? 'regime-regular';
  const dhFatoGerador = activeContext.dhFatoGerador ?? '2026-07-01';
  const itens = draft?.itens ?? [];
  const safeSelectedIndex =
    selectedItemIndex >= 0 && selectedItemIndex < itens.length ? selectedItemIndex : 0;

  const handleAddItem = () => {
    setCalcError(null);
    setRemoteFailure(null);
    if (!draft) {
      const created = createManualDraft(activeContext, sessionId);
      onDraftChange(created);
      setSelectedItemIndex(0);
      return;
    }
    const nextNObj =
      draft.itens.reduce((max, item) => Math.max(max, item.nObj), 0) + 1;
    const nextDraft: ExtractionDraft = {
      ...draft,
      itens: [...draft.itens, createBlankItem(nextNObj)],
    };
    onDraftChange(nextDraft);
    setSelectedItemIndex(nextDraft.itens.length - 1);
  };

  const handleStartPreset = (preset: 'mercadoria' | 'servico') => {
    setCalcError(null);
    setRemoteFailure(null);
    const baseItem = createBlankItem(1);
    const presetItem: ExtractionDraftItem =
      preset === 'mercadoria'
        ? {
            ...baseItem,
            descricao: 'Bebida não alcoólica (Exemplo)',
            ncm: '22021000',
            cst: '000',
            cClassTrib: '000001',
            cAtivSN: '11',
            baseCalculo: '1000.00',
            vProd: '1000.00',
          }
        : {
            ...baseItem,
            descricao: 'Serviço de consultoria (Exemplo)',
            nbs: '101011000',
            cst: '000',
            cClassTrib: '000001',
            cAtivSN: '11',
            baseCalculo: '5000.00',
            vProd: '5000.00',
          };

    onDraftChange({
      id: `manual-${Date.now()}`,
      sessionId: sessionId ?? undefined,
      sourceType: 'manual',
      filename:
        preset === 'mercadoria'
          ? 'Calculadora Manual — Mercadoria'
          : 'Calculadora Manual — Serviço',
      context: activeContext,
      itens: [presetItem],
      warnings: [],
      requiresReview: false,
      createdAt: new Date().toISOString(),
    });
    setSelectedItemIndex(0);
  };

  const handleRemoveItem = (index: number) => {
    if (!draft) return;
    setLookup(null);
    const nextItens = draft.itens.filter((_, i) => i !== index);
    onDraftChange({
      ...draft,
      itens: nextItens,
    });
    setSelectedItemIndex(Math.max(0, index - 1));
  };

  const updateItem = (
    index: number,
    updater: (item: ExtractionDraftItem) => ExtractionDraftItem,
  ) => {
    if (!draft) return;
    const nextItens = draft.itens.map((it, i) => (i === index ? updater(it) : it));
    onDraftChange({
      ...draft,
      itens: nextItens,
    });
  };

  const handleItemFieldChange = (
    index: number,
    field: keyof ExtractionDraftItem,
    value: string,
  ) => {
    updateItem(index, (item) => {
      const nextConfidence: Record<string, FieldConfidence> = {
        ...item.confidence,
        [field]: value.trim().length > 0 ? 'high' : 'missing',
      };
      const nextMissing =
        value.trim().length > 0
          ? item.missingFields.filter((f) => f !== field)
          : Array.from(new Set([...item.missingFields, field]));
      return {
        ...item,
        [field]: value,
        confidence: nextConfidence,
        missingFields: nextMissing,
      };
    });
  };

  const handleAliquotaChange = (
    index: number,
    key: 'pCBS' | 'pIBSUF' | 'pIBSMun',
    value: string,
  ) => {
    updateItem(index, (item) => {
      const nextAliquotas: AliquotasNominaisInput = {
        ...(item.aliquotasNominais ?? {}),
        [key]: value,
      };
      return {
        ...item,
        aliquotasNominais: nextAliquotas,
        confidence: {
          ...item.confidence,
          aliquotasNominais: value.trim().length > 0 ? 'high' : 'medium',
        },
        missingFields: item.missingFields.filter((f) => f !== 'aliquotasNominais'),
      };
    });
  };

  const runLookup = async (
    index: number,
    kind: LookupState['kind'],
    query: string,
  ) => {
    setLookup({ itemIndex: index, kind, loading: true });
    try {
      if (kind === 'ncm') {
        const ncmItems = await searchNcm(query.trim(), dhFatoGerador);
        setLookup({ itemIndex: index, kind, loading: false, ncmItems });
        return;
      }
      if (kind === 'nbs') {
        const nbsItems = await searchNbs(query.trim(), dhFatoGerador);
        setLookup({ itemIndex: index, kind, loading: false, nbsItems });
        return;
      }
      if (kind === 'cClassTrib') {
        const currentCst = itens[index]?.cst?.trim() || undefined;
        const classTribItems = await searchClassTrib(
          query.trim(),
          currentCst,
          dhFatoGerador,
        );
        setLookup({ itemIndex: index, kind, loading: false, classTribItems });
        return;
      }
      const cClassTrib = itens[index]?.cClassTrib?.trim() || undefined;
      const allAtividades = await listAtividadesSimples(
        dhFatoGerador.slice(0, 4) < '2027' ? '2027-01-01' : dhFatoGerador,
        {
          cClassTrib,
          tipoDocumento: resolveTpDoc(activeContext.tipoDfe),
        },
      );
      const needle = query.trim().toLowerCase();
      const filtered = needle
        ? allAtividades.filter(
            (a) =>
              a.cAtivSN.toLowerCase().includes(needle) ||
              a.descricao.toLowerCase().includes(needle),
          )
        : allAtividades;
      setLookup({
        itemIndex: index,
        kind,
        loading: false,
        atividadesItems: filtered.slice(0, 15),
      });
    } catch (err) {
      setLookup({
        itemIndex: index,
        kind,
        loading: false,
        error:
          err instanceof Error
            ? err.message
            : 'Falha ao consultar Dados Abertos da RFB.',
      });
    }
  };

  const handleCalculateBaseUnificada = async () => {
    const item = itens[safeSelectedIndex];
    if (!item) return;

    setBaseLoading(true);
    setBaseError(null);
    try {
      const year = Number.parseInt(dhFatoGerador.slice(0, 4), 10);
      const anoFatoGerador = Number.isFinite(year) && year >= 2026 ? year : 2026;
      const isNfse = activeContext.tipoDfe === 'NFSE';
      const vProdOrServ =
        cleanDecimal(item.vProd) ?? cleanDecimal(item.baseCalculo) ?? '0.00';

      const res = await calculateBaseUnificada({
        modelo: isNfse ? 'nfse' : 'nfe',
        sessionId: sessionId ?? undefined,
        context: activeContext,
        input: isNfse
          ? {
              anoFatoGerador,
              vServ: vProdOrServ,
              vDescIncond: cleanDecimal(item.vDesc) ?? '0',
              vISS: cleanDecimal(item.vICMS) ?? '0',
              vPIS: cleanDecimal(item.vPIS) ?? '0',
              vCOFINS: cleanDecimal(item.vCOFINS) ?? '0',
            }
          : {
              anoFatoGerador,
              tipoDocumento: resolveTpDoc(activeContext.tipoDfe),
              natureza: baseNatureza,
              ...(baseNatureza === 'bem'
                ? { vProd: vProdOrServ }
                : { vServ: vProdOrServ }),
              vFrete: cleanDecimal(item.vFrete) ?? '0',
              vDesc: cleanDecimal(item.vDesc) ?? '0',
              vICMS: cleanDecimal(item.vICMS) ?? '0',
              vPIS: cleanDecimal(item.vPIS) ?? '0',
              vCOFINS: cleanDecimal(item.vCOFINS) ?? '0',
            },
      });
      const normalizedOutput: BaseCalculoUnificadaOutput = {
        baseRG: res.output.baseRG,
        baseIS: 'baseIS' in res.output && res.output.baseIS ? res.output.baseIS : '0.00',
        baseSN: res.output.baseSN,
        avisos: res.output.avisos ?? [],
      };
      setBaseResult(normalizedOutput);
    } catch (err) {
      setBaseError(
        err instanceof Error
          ? err.message
          : 'Erro ao calcular Base de Cálculo Unificada.',
      );
    } finally {
      setBaseLoading(false);
    }
  };

  const handleCalculateFatorR = async () => {
    const folha = cleanDecimal(folha12m);
    const rbt = cleanDecimal(rbt12m);
    if (!folha || !rbt) {
      setFatorRError('Informe Folha 12m e RBT 12m numéricos para calcular o Fator R.');
      return;
    }
    setFatorRLoading(true);
    setFatorRError(null);
    try {
      const res = await calculateFatorR({ folha12m: folha, rbt12m: rbt });
      setFatorRResult(res.output);
    } catch (err) {
      setFatorRError(
        err instanceof Error ? err.message : 'Erro ao calcular Fator R.',
      );
    } finally {
      setFatorRLoading(false);
    }
  };

  const handleCalculateDeterministic = async (forceLocal = false) => {
    if (itens.length === 0) {
      setCalcError('Adicione ao menos 1 item antes de calcular.');
      return;
    }

    setIsCalculating(true);
    setCalcError(null);
    if (forceLocal) {
      setRemoteFailure(null);
    }

    try {
      if (regime === 'comparativo') {
        const res = await compareFiscalRegimes({
          sessionId: sessionId ?? undefined,
          context: activeContext,
          forceLocal,
          input: {
            dhFatoGerador,
            tpDoc: resolveTpDoc(activeContext.tipoDfe),
            uf: activeContext.uf ?? 'RS',
            ...(activeContext.municipio ? { municipio: activeContext.municipio } : {}),
            ...(activeContext.tpEnteGov !== undefined
              ? { tpEnteGov: activeContext.tpEnteGov }
              : {}),
            itens: itens.map((it, idx) => ({
              nObj: it.nObj || idx + 1,
              ...(it.descricao ? { descricao: it.descricao } : {}),
              ...(it.ncm ? { ncm: it.ncm } : {}),
              ...(it.nbs ? { nbs: it.nbs } : {}),
              cst: it.cst?.trim() || '000',
              cClassTrib: it.cClassTrib?.trim() || '000001',
              cAtivSN: it.cAtivSN?.trim() || '11',
              baseCalculo: cleanDecimal(it.baseCalculo) ?? '0.00',
              aliquotasNominais: buildCleanAliquotas(it.aliquotasNominais) ?? {},
              pIBSSN: cleanDecimal(it.pIBSSN) ?? null,
              pCBSSN: cleanDecimal(it.pCBSSN) ?? null,
            })),
          },
        });
        setRemoteFailure(null);
        onSnapshotCreated(res.snapshot);
        onNavigateTab('compare');
        return;
      }

      if (regime === 'simples-nacional') {
        const res = await calculateFiscal({
          regime: 'simples-nacional',
          sessionId: sessionId ?? undefined,
          context: activeContext,
          forceLocal,
          input: {
            dhFatoGerador,
            tpDoc: resolveTpDoc(activeContext.tipoDfe),
            CRT: activeContext.crt ?? 1,
            tpRegimeIBSCBS: activeContext.tpRegimeIBSCBS ?? 2,
            ...(activeContext.tpEnteGov !== undefined
              ? { tpEnteGov: activeContext.tpEnteGov }
              : {}),
            itens: itens.map((it, idx) => ({
              nObj: it.nObj || idx + 1,
              ...(it.descricao ? { descricao: it.descricao } : {}),
              cAtivSN: it.cAtivSN?.trim() || '11',
              cClassTrib: it.cClassTrib?.trim() || '000001',
              ...(it.cst?.trim() ? { cst: it.cst.trim() } : {}),
              baseCalculo: cleanDecimal(it.baseCalculo) ?? '0.00',
              ...(cleanDecimal(it.vIS) ? { valorImpostoSeletivo: cleanDecimal(it.vIS) } : {}),
              pIBSSN: cleanDecimal(it.pIBSSN) ?? null,
              pCBSSN: cleanDecimal(it.pCBSSN) ?? null,
            })),
          },
        });
        setRemoteFailure(null);
        onSnapshotCreated(res.snapshot);
        onNavigateTab('results');
        return;
      }

      // Regime Regular
      const res = await calculateFiscal({
        regime: 'regime-regular',
        sessionId: sessionId ?? undefined,
        context: activeContext,
        modo: 'observabilidade',
        forceLocal,
        input: {
          dhFatoGerador,
          uf: activeContext.uf ?? 'RS',
          ...(activeContext.municipio ? { municipio: activeContext.municipio } : {}),
          tipoDfe: activeContext.tipoDfe ?? '55',
          ...(activeContext.tpEnteGov !== undefined
            ? { tpEnteGov: activeContext.tpEnteGov }
            : {}),
          itens: itens.map((it, idx) => {
            const aliquotas = buildCleanAliquotas(it.aliquotasNominais);
            return {
              nObj: it.nObj || idx + 1,
              ...(it.descricao ? { descricao: it.descricao } : {}),
              ...(it.ncm?.trim() ? { ncm: it.ncm.trim() } : {}),
              ...(it.nbs?.trim() ? { nbs: it.nbs.trim() } : {}),
              cst: it.cst?.trim() || '000',
              cClassTrib: it.cClassTrib?.trim() || '000001',
              ...(cleanDecimal(it.baseCalculo)
                ? { baseCalculo: cleanDecimal(it.baseCalculo) }
                : {}),
              ...(cleanDecimal(it.quantidade)
                ? { quantidade: cleanDecimal(it.quantidade) }
                : {}),
              ...(it.unidade?.trim() ? { unidade: it.unidade.trim() } : {}),
              ...(aliquotas ? { aliquotasNominais: aliquotas } : {}),
            };
          }),
        },
      });
      setRemoteFailure(null);
      onSnapshotCreated(res.snapshot);
      onNavigateTab('results');
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 503 || err.canForceLocal || err.code === 'REMOTE_ENGINE_UNAVAILABLE')
      ) {
        setRemoteFailure({
          message: err.message,
          capability: err.capability,
          endpoint: err.endpoint,
        });
      } else {
        setCalcError(
          err instanceof Error
            ? err.message
            : 'Falha ao executar cálculo determinístico.',
        );
      }
    } finally {
      setIsCalculating(false);
    }
  };

  return (
    <div className="stack">
      <article className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">Prévia &amp; Lote (Human-in-the-Loop)</h3>
            <span className="card__meta">
              {draft
                ? `${draft.filename} • Origem: ${draft.sourceType.toUpperCase()} • ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`
                : 'Nenhum documento em staging. Crie uma simulação manual ou envie arquivos no Copiloto.'}
            </span>
          </div>
          <div className="staging-header-actions">
            <button
              type="button"
              className="btn btn--sm"
              onClick={handleAddItem}
            >
              <Plus size={14} aria-hidden="true" />
              <span>+ Adicionar Item</span>
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={isCalculating || itens.length === 0}
              onClick={() => {
                void handleCalculateDeterministic(false);
              }}
            >
              <Calculator size={14} aria-hidden="true" />
              <span>
                {isCalculating ? 'Calculando...' : 'Calcular Tributos Determinísticos'}
              </span>
            </button>
          </div>
        </div>

        {draft?.warnings && draft.warnings.length > 0 && (
          <div className="banner banner--warning" role="status">
            <span>
              <AlertTriangle
                size={15}
                aria-hidden="true"
                style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
              />
              {draft.warnings.join(' • ')}
            </span>
          </div>
        )}

        {remoteFailure && (
          <div className="recovery-card" role="alert">
            <div className="recovery-card__header">
              <AlertTriangle size={16} aria-hidden="true" />
              <strong>Motor Oficial Remoto Indisponível (Fail-Closed)</strong>
            </div>
            <p className="recovery-card__body">
              {remoteFailure.message}
              {remoteFailure.capability ? ` (${remoteFailure.capability})` : ''}
              {remoteFailure.endpoint ? ` • ${remoteFailure.endpoint}` : ''}
            </p>
            <div className="recovery-card__actions">
              <button
                type="button"
                className="btn btn--warning btn--sm"
                disabled={isCalculating}
                onClick={() => {
                  void handleCalculateDeterministic(true);
                }}
              >
                <RefreshCw size={14} aria-hidden="true" />
                <span>[Usar Motor Local (TS)]</span>
              </button>
            </div>
          </div>
        )}

        {calcError && (
          <div className="banner banner--danger" role="alert">
            <span>{calcError}</span>
          </div>
        )}

        {itens.length === 0 ? (
          <div className="manual-calc-empty">
            <div className="manual-calc-empty__icon" aria-hidden="true">
              <Calculator size={22} />
            </div>
            <h4 className="manual-calc-empty__title">Calculadora Manual ou Lote</h4>
            <p className="manual-calc-empty__desc">
              Preencha os campos fiscais manualmente (NCM/NBS, CST, cClassTrib, Base de Cálculo e alíquotas) ou envie XML, PDF ou planilha no chat ao lado.
            </p>
            <div className="manual-calc-empty__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={handleAddItem}
              >
                <Plus size={14} aria-hidden="true" />
                <span>Iniciar Cálculo Manual</span>
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => handleStartPreset('mercadoria')}
              >
                <Sparkles size={13} aria-hidden="true" />
                <span>Exemplo: Mercadoria</span>
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => handleStartPreset('servico')}
              >
                <Sparkles size={13} aria-hidden="true" />
                <span>Exemplo: Serviço</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="staging-items">
            {itens.map((item, idx) => {
              const itemNum = item.nObj || idx + 1;
              const overallConfidence = getItemOverallConfidence(item);
              const isSelected = safeSelectedIndex === idx;
              const activeLookup =
                lookup && lookup.itemIndex === idx ? lookup : null;

              return (
                <section
                  key={`staging-item-${itemNum}-${idx}`}
                  className={`staging-item-card ${isSelected ? 'staging-item-card--selected' : ''}`}
                  onFocus={() => setSelectedItemIndex(idx)}
                  onClick={() => setSelectedItemIndex(idx)}
                >
                  <div className="staging-item-card__header">
                    <div className="staging-item-card__title">
                      <span className="badge badge--neutral tabular-nums">
                        Item #{itemNum}
                      </span>
                      <ConfidenceBadge confidence={overallConfidence} />
                    </div>
                    <button
                      type="button"
                      className="btn btn--sm"
                      aria-label={`Remover Item ${itemNum}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveItem(idx);
                      }}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                      <span>Remover</span>
                    </button>
                  </div>

                  <div className="staging-grid">
                    <div className="staging-field staging-field--wide">
                      <div className="staging-field__label-row">
                        <label htmlFor={`st-desc-${idx}`}>
                          Descrição (Item {itemNum})
                        </label>
                        <ConfidenceBadge
                          confidence={getFieldConfidence(item, 'descricao')}
                        />
                      </div>
                      <input
                        id={`st-desc-${idx}`}
                        type="text"
                        value={item.descricao ?? ''}
                        placeholder="Ex.: Serviço contábil / Mercadoria"
                        onChange={(e) =>
                          handleItemFieldChange(idx, 'descricao', e.target.value)
                        }
                      />
                    </div>

                    <div className="staging-field">
                      <div className="staging-field__label-row">
                        <label htmlFor={`st-ncm-${idx}`}>
                          NCM (Item {itemNum})
                        </label>
                        <ConfidenceBadge
                          confidence={getFieldConfidence(item, 'ncm')}
                        />
                      </div>
                      <div className="staging-input-group">
                        <input
                          id={`st-ncm-${idx}`}
                          type="text"
                          className="tabular-nums"
                          value={item.ncm ?? ''}
                          placeholder="8 dígitos"
                          onChange={(e) =>
                            handleItemFieldChange(idx, 'ncm', e.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="btn btn--sm"
                          aria-label={`Buscar NCM (Item ${itemNum})`}
                          onClick={() => {
                            void runLookup(idx, 'ncm', item.ncm ?? '');
                          }}
                        >
                          <Search size={13} aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="staging-field">
                      <div className="staging-field__label-row">
                        <label htmlFor={`st-nbs-${idx}`}>
                          NBS (Item {itemNum})
                        </label>
                        <ConfidenceBadge
                          confidence={getFieldConfidence(item, 'nbs')}
                        />
                      </div>
                      <div className="staging-input-group">
                        <input
                          id={`st-nbs-${idx}`}
                          type="text"
                          className="tabular-nums"
                          value={item.nbs ?? ''}
                          placeholder="Código NBS"
                          onChange={(e) =>
                            handleItemFieldChange(idx, 'nbs', e.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="btn btn--sm"
                          aria-label={`Buscar NBS (Item ${itemNum})`}
                          onClick={() => {
                            void runLookup(idx, 'nbs', item.nbs ?? '');
                          }}
                        >
                          <Search size={13} aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="staging-field">
                      <div className="staging-field__label-row">
                        <label htmlFor={`st-cst-${idx}`}>
                          CST (Item {itemNum})
                        </label>
                        <ConfidenceBadge
                          confidence={getFieldConfidence(item, 'cst')}
                        />
                      </div>
                      <input
                        id={`st-cst-${idx}`}
                        type="text"
                        className="tabular-nums"
                        value={item.cst ?? ''}
                        placeholder="000"
                        onChange={(e) =>
                          handleItemFieldChange(idx, 'cst', e.target.value)
                        }
                      />
                    </div>

                    <div className="staging-field">
                      <div className="staging-field__label-row">
                        <label htmlFor={`st-classtrib-${idx}`}>
                          cClassTrib (Item {itemNum})
                        </label>
                        <ConfidenceBadge
                          confidence={getFieldConfidence(item, 'cClassTrib')}
                        />
                      </div>
                      <div className="staging-input-group">
                        <input
                          id={`st-classtrib-${idx}`}
                          type="text"
                          className="tabular-nums"
                          value={item.cClassTrib ?? ''}
                          placeholder="000001"
                          onChange={(e) =>
                            handleItemFieldChange(idx, 'cClassTrib', e.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="btn btn--sm"
                          aria-label={`Buscar cClassTrib (Item ${itemNum})`}
                          onClick={() => {
                            void runLookup(
                              idx,
                              'cClassTrib',
                              item.cClassTrib ?? '',
                            );
                          }}
                        >
                          <Search size={13} aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="staging-field">
                      <div className="staging-field__label-row">
                        <label htmlFor={`st-ativsn-${idx}`}>
                          cAtivSN (Item {itemNum})
                        </label>
                        <ConfidenceBadge
                          confidence={getFieldConfidence(item, 'cAtivSN')}
                        />
                      </div>
                      <div className="staging-input-group">
                        <input
                          id={`st-ativsn-${idx}`}
                          type="text"
                          className="tabular-nums"
                          value={item.cAtivSN ?? ''}
                          placeholder="Ex.: 11"
                          onChange={(e) =>
                            handleItemFieldChange(idx, 'cAtivSN', e.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="btn btn--sm"
                          aria-label={`Buscar Atividade SN (Item ${itemNum})`}
                          onClick={() => {
                            void runLookup(idx, 'cAtivSN', item.cAtivSN ?? '');
                          }}
                        >
                          <Search size={13} aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className="staging-field">
                      <div className="staging-field__label-row">
                        <label htmlFor={`st-bc-${idx}`}>
                          Base de Cálculo (Item {itemNum})
                        </label>
                        <ConfidenceBadge
                          confidence={getFieldConfidence(item, 'baseCalculo')}
                        />
                      </div>
                      <input
                        id={`st-bc-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={item.baseCalculo ?? ''}
                        placeholder="0.00"
                        onChange={(e) =>
                          handleItemFieldChange(idx, 'baseCalculo', e.target.value)
                        }
                      />
                    </div>

                    <div className="staging-field">
                      <label htmlFor={`st-vprod-${idx}`}>
                        vProd (Item {itemNum})
                      </label>
                      <input
                        id={`st-vprod-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={item.vProd ?? ''}
                        onChange={(e) =>
                          handleItemFieldChange(idx, 'vProd', e.target.value)
                        }
                      />
                    </div>

                    <div className="staging-field">
                      <label htmlFor={`st-vfrete-${idx}`}>
                        vFrete (Item {itemNum})
                      </label>
                      <input
                        id={`st-vfrete-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={item.vFrete ?? ''}
                        onChange={(e) =>
                          handleItemFieldChange(idx, 'vFrete', e.target.value)
                        }
                      />
                    </div>

                    <div className="staging-field">
                      <label htmlFor={`st-vdesc-${idx}`}>
                        vDesc (Item {itemNum})
                      </label>
                      <input
                        id={`st-vdesc-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={item.vDesc ?? ''}
                        onChange={(e) =>
                          handleItemFieldChange(idx, 'vDesc', e.target.value)
                        }
                      />
                    </div>

                    <div className="staging-field">
                      <label htmlFor={`st-vicms-${idx}`}>
                        vICMS / vISS (Item {itemNum})
                      </label>
                      <input
                        id={`st-vicms-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={item.vICMS ?? ''}
                        onChange={(e) =>
                          handleItemFieldChange(idx, 'vICMS', e.target.value)
                        }
                      />
                    </div>

                    <div className="staging-field">
                      <label htmlFor={`st-vpis-${idx}`}>
                        vPIS (Item {itemNum})
                      </label>
                      <input
                        id={`st-vpis-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={item.vPIS ?? ''}
                        onChange={(e) =>
                          handleItemFieldChange(idx, 'vPIS', e.target.value)
                        }
                      />
                    </div>

                    <div className="staging-field">
                      <label htmlFor={`st-vcofins-${idx}`}>
                        vCOFINS (Item {itemNum})
                      </label>
                      <input
                        id={`st-vcofins-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={item.vCOFINS ?? ''}
                        onChange={(e) =>
                          handleItemFieldChange(idx, 'vCOFINS', e.target.value)
                        }
                      />
                    </div>

                    <div className="staging-field">
                      <label htmlFor={`st-pcbs-${idx}`}>
                        Alíquota CBS % (Item {itemNum})
                      </label>
                      <input
                        id={`st-pcbs-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={
                          item.aliquotasNominais?.pCBS !== undefined
                            ? String(item.aliquotasNominais.pCBS)
                            : ''
                        }
                        placeholder="2027+"
                        onChange={(e) =>
                          handleAliquotaChange(idx, 'pCBS', e.target.value)
                        }
                      />
                    </div>

                    <div className="staging-field">
                      <label htmlFor={`st-pibsuf-${idx}`}>
                        Alíquota IBS UF % (Item {itemNum})
                      </label>
                      <input
                        id={`st-pibsuf-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={
                          item.aliquotasNominais?.pIBSUF !== undefined
                            ? String(item.aliquotasNominais.pIBSUF)
                            : ''
                        }
                        placeholder="2027+"
                        onChange={(e) =>
                          handleAliquotaChange(idx, 'pIBSUF', e.target.value)
                        }
                      />
                    </div>

                    <div className="staging-field">
                      <label htmlFor={`st-pibsmun-${idx}`}>
                        Alíquota IBS Mun % (Item {itemNum})
                      </label>
                      <input
                        id={`st-pibsmun-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={
                          item.aliquotasNominais?.pIBSMun !== undefined
                            ? String(item.aliquotasNominais.pIBSMun)
                            : ''
                        }
                        placeholder="2027+"
                        onChange={(e) =>
                          handleAliquotaChange(idx, 'pIBSMun', e.target.value)
                        }
                      />
                    </div>

                    <div className="staging-field">
                      <label htmlFor={`st-pibssn-${idx}`}>
                        pIBSSN % (Item {itemNum})
                      </label>
                      <input
                        id={`st-pibssn-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={item.pIBSSN ?? ''}
                        placeholder="PGDAS-D"
                        onChange={(e) =>
                          handleItemFieldChange(idx, 'pIBSSN', e.target.value)
                        }
                      />
                    </div>

                    <div className="staging-field">
                      <label htmlFor={`st-pcbssn-${idx}`}>
                        pCBSSN % (Item {itemNum})
                      </label>
                      <input
                        id={`st-pcbssn-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="tabular-nums"
                        value={item.pCBSSN ?? ''}
                        placeholder="PGDAS-D"
                        onChange={(e) =>
                          handleItemFieldChange(idx, 'pCBSSN', e.target.value)
                        }
                      />
                    </div>
                  </div>

                  {activeLookup && (
                    <div className="lookup-popover" aria-label="Sugestões oficiais RFB">
                      <div className="lookup-popover__header">
                        <strong>
                          Dados Abertos RFB ({activeLookup.kind.toUpperCase()})
                        </strong>
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={() => setLookup(null)}
                        >
                          Fechar
                        </button>
                      </div>

                      {activeLookup.loading && (
                        <p className="lookup-popover__status">Consultando SQLite oficial...</p>
                      )}
                      {activeLookup.error && (
                        <p className="lookup-popover__status">{activeLookup.error}</p>
                      )}

                      {activeLookup.ncmItems && (
                        <ul className="lookup-list">
                          {activeLookup.ncmItems.length === 0 ? (
                            <li className="lookup-list__empty">Nenhum NCM encontrado.</li>
                          ) : (
                            activeLookup.ncmItems.slice(0, 10).map((ncm) => (
                              <li key={ncm.ncmCd}>
                                <button
                                  type="button"
                                  className="lookup-option"
                                  onClick={() => {
                                    handleItemFieldChange(idx, 'ncm', ncm.ncmCd);
                                    setLookup(null);
                                  }}
                                >
                                  <span className="tabular-nums">
                                    {ncm.ncmCd} — {ncm.descricao}
                                  </span>
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      )}

                      {activeLookup.nbsItems && (
                        <ul className="lookup-list">
                          {activeLookup.nbsItems.length === 0 ? (
                            <li className="lookup-list__empty">Nenhum NBS encontrado.</li>
                          ) : (
                            activeLookup.nbsItems.slice(0, 10).map((nbs) => (
                              <li key={nbs.nbsCd}>
                                <button
                                  type="button"
                                  className="lookup-option"
                                  onClick={() => {
                                    handleItemFieldChange(idx, 'nbs', nbs.nbsCd);
                                    setLookup(null);
                                  }}
                                >
                                  <span className="tabular-nums">
                                    {nbs.nbsCd} — {nbs.descricao}
                                  </span>
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      )}

                      {activeLookup.classTribItems && (
                        <ul className="lookup-list">
                          {activeLookup.classTribItems.length === 0 ? (
                            <li className="lookup-list__empty">
                              Nenhuma classificação tributária encontrada.
                            </li>
                          ) : (
                            activeLookup.classTribItems.slice(0, 10).map((ct) => (
                              <li key={`${ct.cltrId}-${ct.cClassTrib}`}>
                                <button
                                  type="button"
                                  className="lookup-option"
                                  onClick={() => {
                                    updateItem(idx, (prev) => ({
                                      ...prev,
                                      cst: ct.cst || prev.cst,
                                      cClassTrib: ct.cClassTrib,
                                      confidence: {
                                        ...prev.confidence,
                                        cst: 'high',
                                        cClassTrib: 'high',
                                      },
                                      missingFields: prev.missingFields.filter(
                                        (f) => f !== 'cst' && f !== 'cClassTrib',
                                      ),
                                    }));
                                    setLookup(null);
                                  }}
                                >
                                  <span className="tabular-nums">
                                    CST {ct.cst} / {ct.cClassTrib} — {ct.descricao}
                                  </span>
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      )}

                      {activeLookup.atividadesItems && (
                        <ul className="lookup-list">
                          {activeLookup.atividadesItems.length === 0 ? (
                            <li className="lookup-list__empty">
                              Nenhuma atividade do Simples Nacional encontrada.
                            </li>
                          ) : (
                            activeLookup.atividadesItems.map((ativ) => (
                              <li key={ativ.atsnId}>
                                <button
                                  type="button"
                                  className="lookup-option"
                                  onClick={() => {
                                    handleItemFieldChange(idx, 'cAtivSN', ativ.cAtivSN);
                                    setLookup(null);
                                  }}
                                >
                                  <span className="tabular-nums">
                                    {ativ.cAtivSN} ({ativ.rotuloCurtoAnexo}) — {ativ.descricao}
                                  </span>
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </article>

      {/* Auxiliary Tools: Base Unificada & Fator R */}
      <article className="card">
        <div className="card__header">
          <h3 className="card__title">
            <Sparkles
              size={15}
              aria-hidden="true"
              style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
            />
            Auxiliares Determinísticos (Base Unificada &amp; Fator R)
          </h3>
          <span className="card__meta">
            Item ativo: #{itens[safeSelectedIndex]?.nObj ?? 1}
          </span>
        </div>

        <div className="aux-grid">
          <div className="aux-panel">
            <div className="aux-panel__header">
              <strong>Base de Cálculo Unificada</strong>
              <select
                aria-label="Natureza para Base Unificada"
                value={baseNatureza}
                onChange={(e) =>
                  setBaseNatureza(e.target.value as 'bem' | 'servico')
                }
              >
                <option value="bem">Mercadoria / Bem</option>
                <option value="servico">Serviço</option>
              </select>
            </div>
            <p className="aux-panel__hint">
              Usa vProd, vFrete, vDesc, vICMS/vISS, vPIS e vCOFINS do item selecionado conforme
              vigência ({dhFatoGerador.slice(0, 4)}).
            </p>
            <button
              type="button"
              className="btn btn--sm"
              disabled={baseLoading || itens.length === 0}
              onClick={() => {
                void handleCalculateBaseUnificada();
              }}
            >
              {baseLoading ? 'Calculando...' : 'Calcular Base Unificada'}
            </button>
            {baseError && (
              <p className="aux-panel__error" role="alert">
                {baseError}
              </p>
            )}
            {baseResult && (
              <div className="aux-panel__result">
                <dl className="grounding-box__figures">
                  <div className="grounding-box__stat">
                    <dt>Base RG</dt>
                    <dd className="tabular-nums">{baseResult.baseRG}</dd>
                  </div>
                  <div className="grounding-box__stat">
                    <dt>Base IS</dt>
                    <dd className="tabular-nums">{baseResult.baseIS}</dd>
                  </div>
                  <div className="grounding-box__stat">
                    <dt>Base SN</dt>
                    <dd className="tabular-nums">{baseResult.baseSN}</dd>
                  </div>
                </dl>
                {baseResult.avisos.length > 0 && (
                  <p className="aux-panel__hint">{baseResult.avisos.join(' • ')}</p>
                )}
                <button
                  type="button"
                  className="chip-btn chip-btn--action"
                  onClick={() =>
                    handleItemFieldChange(
                      safeSelectedIndex,
                      'baseCalculo',
                      regime === 'simples-nacional'
                        ? baseResult.baseSN
                        : baseResult.baseRG,
                    )
                  }
                >
                  Aplicar base calculada ao Item #{itens[safeSelectedIndex]?.nObj ?? 1}
                </button>
              </div>
            )}
          </div>

          <div className="aux-panel">
            <div className="aux-panel__header">
              <strong>Auxiliar de Fator R (Simples Nacional)</strong>
            </div>
            <div className="staging-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="staging-field">
                <label htmlFor="aux-folha-12m">Folha 12m (R$)</label>
                <input
                  id="aux-folha-12m"
                  type="text"
                  inputMode="decimal"
                  className="tabular-nums"
                  placeholder="30000.00"
                  value={folha12m}
                  onChange={(e) => setFolha12m(e.target.value)}
                />
              </div>
              <div className="staging-field">
                <label htmlFor="aux-rbt-12m">RBT 12m (R$)</label>
                <input
                  id="aux-rbt-12m"
                  type="text"
                  inputMode="decimal"
                  className="tabular-nums"
                  placeholder="100000.00"
                  value={rbt12m}
                  onChange={(e) => setRbt12m(e.target.value)}
                />
              </div>
            </div>
            <button
              type="button"
              className="btn btn--sm"
              disabled={fatorRLoading}
              onClick={() => {
                void handleCalculateFatorR();
              }}
            >
              {fatorRLoading ? 'Calculando...' : 'Calcular Fator R'}
            </button>
            {fatorRError && (
              <p className="aux-panel__error" role="alert">
                {fatorRError}
              </p>
            )}
            {fatorRResult && (
              <div className="aux-panel__result">
                <div className="aux-panel__header">
                  <span className="tabular-nums">
                    Fator R: <strong>{fatorRResult.fatorR}</strong>
                  </span>
                  <span className="badge badge--info">
                    {fatorRResult.enquadramentoSugerido}
                  </span>
                </div>
                <p className="aux-panel__hint">{fatorRResult.avisoLegal}</p>
              </div>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}

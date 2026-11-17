import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  Download,
  FileSpreadsheet,
  GitCompareArrows,
  RefreshCw,
  Scale,
} from 'lucide-react';
import type {
  BaseCalculoUnificadaOutput,
  CalcRunSnapshot,
  CompareRegimesItemInput,
  CompareRegimesOutput,
  ExtractionDraft,
  FatorRAuxiliarOutput,
  OperationContext,
  RegimeComparisonScenario,
} from '../../shared/types/fiscal';
import {
  ApiError,
  calculateBaseUnificada,
  calculateFatorR,
  compareFiscalRegimes,
  getExportJsonUrl,
  getExportXlsxUrl,
} from '../api/client';

export interface CompareTabProps {
  snapshot: CalcRunSnapshot | null;
  draft: ExtractionDraft | null;
  activeContext: Partial<OperationContext>;
  sessionId: string | null;
  onContextPatch?: (patch: Partial<OperationContext>) => void;
  onSnapshotCreated: (snapshot: CalcRunSnapshot) => void;
}

interface RemoteFailureState {
  message: string;
  capability?: string;
  endpoint?: string;
}

interface YearlyBaseRow {
  year: 2026 | 2027 | 2033;
  label: string;
  output: BaseCalculoUnificadaOutput;
}

const SIMPLES_START_DATE = '2027-01-01';

const SCENARIO_SHORT_TAG: Record<RegimeComparisonScenario['cenario'], string> = {
  regime_regular: 'Regime Regular',
  simples_crt1: 'Simples CRT=1',
  simples_hibrido: 'Simples Híbrido',
  sublimite_crt2: 'Sublimite CRT=2',
};

function cleanDecimal(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(',', '.');
}

function isValidDecimal(raw: string | undefined): boolean {
  const cleaned = cleanDecimal(raw);
  return cleaned !== undefined && /^-?\d+(\.\d+)?$/.test(cleaned);
}

function resolveTpDoc(tipoDfe: OperationContext['tipoDfe'] | undefined): number {
  if (tipoDfe === '65') return 65;
  if (tipoDfe === 'NFSE') return 99;
  return 55;
}

function formatFatorRPercent(fatorR: string): string {
  const parsed = Number.parseFloat(fatorR);
  if (!Number.isFinite(parsed)) {
    return '0.00%';
  }
  return `${(parsed * 100).toFixed(2)}%`;
}

export function CompareTab({
  snapshot,
  draft,
  activeContext,
  sessionId,
  onContextPatch,
  onSnapshotCreated,
}: CompareTabProps) {
  const firstDraftItem = draft?.itens?.[0];

  const [simDate, setSimDate] = useState<string>(
    activeContext.dhFatoGerador ?? '2026-07-01',
  );
  const [baseCalculo, setBaseCalculo] = useState<string>(
    firstDraftItem?.baseCalculo ?? '1000.00',
  );
  const [cst, setCst] = useState<string>(firstDraftItem?.cst ?? '000');
  const [cClassTrib, setCClassTrib] = useState<string>(
    firstDraftItem?.cClassTrib?.trim() || '000001',
  );
  const [cAtivSN, setCAtivSN] = useState<string>(
    firstDraftItem?.cAtivSN?.trim() || '11',
  );
  const [ncm, setNcm] = useState<string>(firstDraftItem?.ncm ?? '');
  const [nbs, setNbs] = useState<string>(firstDraftItem?.nbs ?? '');

  // Never fabricate rates: default strictly to draft value if provided, else ''
  const [pCBS, setPCBS] = useState<string>(
    firstDraftItem?.aliquotasNominais?.pCBS !== undefined
      ? String(firstDraftItem.aliquotasNominais.pCBS)
      : '',
  );
  const [pIBSUF, setPIBSUF] = useState<string>(
    firstDraftItem?.aliquotasNominais?.pIBSUF !== undefined
      ? String(firstDraftItem.aliquotasNominais.pIBSUF)
      : '',
  );
  const [pIBSMun, setPIBSMun] = useState<string>(
    firstDraftItem?.aliquotasNominais?.pIBSMun !== undefined
      ? String(firstDraftItem.aliquotasNominais.pIBSMun)
      : '',
  );
  const [pIBSSN, setPIBSSN] = useState<string>(firstDraftItem?.pIBSSN ?? '');
  const [pCBSSN, setPCBSSN] = useState<string>(firstDraftItem?.pCBSSN ?? '');

  const [isValorInformado, setIsValorInformado] = useState<string>(
    firstDraftItem?.vIS ?? '',
  );
  const [isAliquotaAdValorem, setIsAliquotaAdValorem] = useState<string>('');
  const [incluirSublimiteCrt2, setIncluirSublimiteCrt2] = useState<boolean>(false);

  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [remoteFailure, setRemoteFailure] = useState<RemoteFailureState | null>(null);
  const [localCompareSnapshot, setLocalCompareSnapshot] =
    useState<CalcRunSnapshot | null>(null);

  // Fator R Auxiliary state
  const [folha12m, setFolha12m] = useState<string>('');
  const [rbt12m, setRbt12m] = useState<string>('');
  const [fatorRResult, setFatorRResult] = useState<FatorRAuxiliarOutput | null>(null);
  const [fatorRLoading, setFatorRLoading] = useState<boolean>(false);
  const [fatorRError, setFatorRError] = useState<string | null>(null);

  // Base Unificada Yearly Comparison (2026 x 2027 x 2033)
  const [buNatureza, setBuNatureza] = useState<'bem' | 'servico'>('bem');
  const [buVProd, setBuVProd] = useState<string>(
    firstDraftItem?.vProd ?? firstDraftItem?.baseCalculo ?? '1000.00',
  );
  const [buVFrete, setBuVFrete] = useState<string>(firstDraftItem?.vFrete ?? '0.00');
  const [buVDesc, setBuVDesc] = useState<string>(firstDraftItem?.vDesc ?? '0.00');
  const [buVPIS, setBuVPIS] = useState<string>(firstDraftItem?.vPIS ?? '16.50');
  const [buVCOFINS, setBuVCOFINS] = useState<string>(firstDraftItem?.vCOFINS ?? '76.00');
  const [buVICMS, setBuVICMS] = useState<string>(firstDraftItem?.vICMS ?? '180.00');
  const [buVIS, setBuVIS] = useState<string>(firstDraftItem?.vIS ?? '20.00');
  const [buRows, setBuRows] = useState<YearlyBaseRow[]>([]);
  const [buLoading, setBuLoading] = useState<boolean>(false);
  const [buError, setBuError] = useState<string | null>(null);

  useEffect(() => {
    if (activeContext.dhFatoGerador) {
      setSimDate(activeContext.dhFatoGerador);
    }
  }, [activeContext.dhFatoGerador]);

  useEffect(() => {
    setLocalCompareSnapshot((prev) =>
      prev && prev.id === snapshot?.id ? prev : null,
    );
  }, [snapshot?.id]);

  useEffect(() => {
    const item = draft?.itens?.[0];
    setBaseCalculo(item?.baseCalculo ?? '1000.00');
    setCst(item?.cst ?? '000');
    setCClassTrib(item?.cClassTrib?.trim() || '000001');
    setCAtivSN(item?.cAtivSN?.trim() || '11');
    setNcm(item?.ncm ?? '');
    setNbs(item?.nbs ?? '');
    setPCBS(
      item?.aliquotasNominais?.pCBS !== undefined
        ? String(item.aliquotasNominais.pCBS)
        : '',
    );
    setPIBSUF(
      item?.aliquotasNominais?.pIBSUF !== undefined
        ? String(item.aliquotasNominais.pIBSUF)
        : '',
    );
    setPIBSMun(
      item?.aliquotasNominais?.pIBSMun !== undefined
        ? String(item.aliquotasNominais.pIBSMun)
        : '',
    );
    setPIBSSN(item?.pIBSSN ?? '');
    setPCBSSN(item?.pCBSSN ?? '');
    setIsValorInformado(item?.vIS ?? '');
    setIsAliquotaAdValorem('');
    setBuVProd(item?.vProd ?? item?.baseCalculo ?? '1000.00');
    setBuVFrete(item?.vFrete ?? '0.00');
    setBuVDesc(item?.vDesc ?? '0.00');
    setBuVPIS(item?.vPIS ?? '16.50');
    setBuVCOFINS(item?.vCOFINS ?? '76.00');
    setBuVICMS(item?.vICMS ?? '180.00');
    setBuVIS(item?.vIS ?? '20.00');
  }, [draft?.id]);

  const effectiveCompareSnapshot =
    localCompareSnapshot ??
    (snapshot?.kind === 'comparativo' ? snapshot : null);
  const compareOutput =
    effectiveCompareSnapshot?.kind === 'comparativo'
      ? (effectiveCompareSnapshot.output as CompareRegimesOutput)
      : null;

  const isPre2027 = simDate.trim().slice(0, 10) < SIMPLES_START_DATE;

  const handleSimulate2027 = () => {
    setSimDate(SIMPLES_START_DATE);
    setCompareError(null);
    onContextPatch?.({ dhFatoGerador: SIMPLES_START_DATE });
  };

  const handleRunCompare = async (forceLocal = false) => {
    setCompareError(null);
    if (forceLocal) {
      setRemoteFailure(null);
    }

    const refDate = simDate.trim().slice(0, 10);
    if (refDate < SIMPLES_START_DATE) {
      setCompareError(
        `As tabelas do Simples Nacional (NT 2026.005) iniciam em ${SIMPLES_START_DATE}. Clique em "Simular em 2027-01-01" ou ajuste a data.`,
      );
      return;
    }

    if (
      !isValidDecimal(baseCalculo) ||
      !isValidDecimal(pCBS) ||
      !isValidDecimal(pIBSUF) ||
      !isValidDecimal(pIBSMun) ||
      !isValidDecimal(pIBSSN) ||
      !isValidDecimal(pCBSSN)
    ) {
      setCompareError(
        'Informe explicitamente a base de cálculo e todas as alíquotas nominais (CBS, IBS UF, IBS Mun) e do Simples Nacional (pIBSSN, pCBSSN) antes de executar o comparativo.',
      );
      return;
    }

    const cleanBase = cleanDecimal(baseCalculo)!;
    const cleanPCBS = cleanDecimal(pCBS)!;
    const cleanPIBSUF = cleanDecimal(pIBSUF)!;
    const cleanPIBSMun = cleanDecimal(pIBSMun)!;
    const cleanPIBSSN = cleanDecimal(pIBSSN)!;
    const cleanPCBSSN = cleanDecimal(pCBSSN)!;

    const cleanIsVal = cleanDecimal(isValorInformado);
    const cleanIsAliq = cleanDecimal(isAliquotaAdValorem);
    const impostoSeletivoPayload =
      cleanIsVal || cleanIsAliq
        ? {
            baseCalculo: cleanBase,
            ...(cleanIsVal ? { valorInformado: cleanIsVal } : {}),
            ...(cleanIsAliq ? { aliquotaAdValorem: cleanIsAliq } : {}),
          }
        : undefined;

    const primaryItem: CompareRegimesItemInput = {
      nObj: firstDraftItem?.nObj ?? 1,
      ...(firstDraftItem?.descricao ? { descricao: firstDraftItem.descricao } : {}),
      ...(ncm.trim() ? { ncm: ncm.trim() } : {}),
      ...(nbs.trim() ? { nbs: nbs.trim() } : {}),
      cst: cst.trim() || '000',
      cClassTrib: cClassTrib.trim() || '000001',
      cAtivSN: cAtivSN.trim() || '11',
      baseCalculo: cleanBase,
      aliquotasNominais: {
        pCBS: cleanPCBS,
        pIBSUF: cleanPIBSUF,
        pIBSMun: cleanPIBSMun,
      },
      ...(impostoSeletivoPayload ? { impostoSeletivo: impostoSeletivoPayload } : {}),
      pIBSSN: cleanPIBSSN,
      pCBSSN: cleanPCBSSN,
    };

    const extraItems: CompareRegimesItemInput[] =
      draft && draft.itens.length > 1
        ? draft.itens.slice(1).map((it, idx) => ({
            nObj: it.nObj || idx + 2,
            ...(it.descricao ? { descricao: it.descricao } : {}),
            ...(it.ncm ? { ncm: it.ncm } : {}),
            ...(it.nbs ? { nbs: it.nbs } : {}),
            cst: it.cst?.trim() || '000',
            cClassTrib: it.cClassTrib?.trim() || '000001',
            cAtivSN: it.cAtivSN?.trim() || cAtivSN.trim() || '11',
            baseCalculo: cleanDecimal(it.baseCalculo) ?? cleanBase,
            aliquotasNominais: {
              pCBS:
                cleanDecimal(
                  it.aliquotasNominais?.pCBS !== undefined
                    ? String(it.aliquotasNominais.pCBS)
                    : undefined,
                ) ?? cleanPCBS,
              pIBSUF:
                cleanDecimal(
                  it.aliquotasNominais?.pIBSUF !== undefined
                    ? String(it.aliquotasNominais.pIBSUF)
                    : undefined,
                ) ?? cleanPIBSUF,
              pIBSMun:
                cleanDecimal(
                  it.aliquotasNominais?.pIBSMun !== undefined
                    ? String(it.aliquotasNominais.pIBSMun)
                    : undefined,
                ) ?? cleanPIBSMun,
            },
            pIBSSN: cleanDecimal(it.pIBSSN) ?? cleanPIBSSN,
            pCBSSN: cleanDecimal(it.pCBSSN) ?? cleanPCBSSN,
          }))
        : [];

    setIsComparing(true);
    try {
      const res = await compareFiscalRegimes({
        sessionId: sessionId ?? undefined,
        context: {
          ...activeContext,
          regime: 'comparativo',
          dhFatoGerador: refDate,
        },
        forceLocal,
        input: {
          dhFatoGerador: refDate,
          tpDoc: resolveTpDoc(activeContext.tipoDfe),
          uf: activeContext.uf ?? 'RS',
          ...(activeContext.municipio ? { municipio: activeContext.municipio } : {}),
          ...(activeContext.tpEnteGov !== undefined
            ? { tpEnteGov: activeContext.tpEnteGov }
            : {}),
          incluirSublimiteCrt2,
          itens: [primaryItem, ...extraItems],
        },
      });
      setRemoteFailure(null);
      setLocalCompareSnapshot(res.snapshot);
      onSnapshotCreated(res.snapshot);
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
        setCompareError(
          err instanceof Error
            ? err.message
            : 'Erro ao executar o comparativo entre regimes.',
        );
      }
    } finally {
      setIsComparing(false);
    }
  };

  const handleCalculateFatorR = async () => {
    const folha = cleanDecimal(folha12m);
    const rbt = cleanDecimal(rbt12m);
    if (!folha || !rbt || !isValidDecimal(folha) || !isValidDecimal(rbt)) {
      setFatorRError('Informe valores numéricos válidos para Folha 12m e RBT 12m.');
      return;
    }

    setFatorRLoading(true);
    setFatorRError(null);
    try {
      const res = await calculateFatorR({ folha12m: folha, rbt12m: rbt });
      setFatorRResult(res.output);
    } catch (err) {
      setFatorRError(
        err instanceof Error ? err.message : 'Falha ao calcular Fator R auxiliar.',
      );
    } finally {
      setFatorRLoading(false);
    }
  };

  const handleCompareBaseUnificada = async () => {
    setBuLoading(true);
    setBuError(null);

    const years: Array<{ year: 2026 | 2027 | 2033; label: string }> = [
      { year: 2026, label: '2026 (Teste)' },
      { year: 2027, label: '2027–2032 (Sem PIS/COFINS)' },
      { year: 2033, label: '2033+ (Pleno sem ICMS/ISS)' },
    ];

    const isNfse = activeContext.tipoDfe === 'NFSE';
    const vBase = cleanDecimal(buVProd) ?? '0.00';

    try {
      const responses = await Promise.all(
        years.map(async ({ year, label }) => {
          const res = await calculateBaseUnificada({
            modelo: isNfse ? 'nfse' : 'nfe',
            sessionId: sessionId ?? undefined,
            context: activeContext,
            input: isNfse
              ? {
                  anoFatoGerador: year,
                  vServ: vBase,
                  vDescIncond: cleanDecimal(buVDesc) ?? '0',
                  vISS: cleanDecimal(buVICMS) ?? '0',
                  vPIS: cleanDecimal(buVPIS) ?? '0',
                  vCOFINS: cleanDecimal(buVCOFINS) ?? '0',
                }
              : {
                  anoFatoGerador: year,
                  tipoDocumento: resolveTpDoc(activeContext.tipoDfe),
                  natureza: buNatureza,
                  ...(buNatureza === 'bem' ? { vProd: vBase } : { vServ: vBase }),
                  vFrete: cleanDecimal(buVFrete) ?? '0',
                  vDesc: cleanDecimal(buVDesc) ?? '0',
                  vIS: cleanDecimal(buVIS) ?? '0',
                  vPIS: cleanDecimal(buVPIS) ?? '0',
                  vCOFINS: cleanDecimal(buVCOFINS) ?? '0',
                  ...(buNatureza === 'bem'
                    ? { vICMS: cleanDecimal(buVICMS) ?? '0' }
                    : { vISS: cleanDecimal(buVICMS) ?? '0' }),
                },
          });

          const normalized: BaseCalculoUnificadaOutput = {
            baseRG: res.output.baseRG,
            baseIS: 'baseIS' in res.output && res.output.baseIS ? res.output.baseIS : '0.00',
            baseSN: res.output.baseSN,
            avisos: res.output.avisos ?? [],
          };

          return { year, label, output: normalized };
        }),
      );

      setBuRows(responses);
    } catch (err) {
      setBuError(
        err instanceof Error
          ? err.message
          : 'Erro ao comparar vigências anuais da Base Unificada.',
      );
    } finally {
      setBuLoading(false);
    }
  };

  return (
    <div className="stack">
      {/* Pre-2027 Notice */}
      {isPre2027 && (
        <div className="banner banner--warning" role="status">
          <span>
            <AlertTriangle
              size={15}
              aria-hidden="true"
              style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
            />
            <strong>Vigência pré-2027 ({simDate.slice(0, 10)}):</strong> As tabelas do
            Simples Nacional (NT 2026.005 v1.00) iniciam em <code>2027-01-01</code>. Antes
            dessa data aplicam-se apenas as alíquotas de referência 2026 no Regime Regular.
          </span>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={handleSimulate2027}
          >
            Simular em 2027-01-01
          </button>
        </div>
      )}

      {/* Explicit Rates & Comparison Form */}
      <article className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">
              <GitCompareArrows
                size={16}
                aria-hidden="true"
                style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
              />
              Simulador Comparativo entre Regimes (LC 214/2025 × NT 2026.005)
            </h3>
            <span className="card__meta">
              Informe alíquotas nominais (Regime Regular) e alíquotas efetivas do DAS
              (pIBSSN / pCBSSN) explicitamente — nenhuma taxa é estimada ou inventada.
            </span>
          </div>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={isComparing}
            onClick={() => {
              void handleRunCompare(false);
            }}
          >
            <Calculator size={14} aria-hidden="true" />
            <span>{isComparing ? 'Comparando...' : 'Executar Comparativo'}</span>
          </button>
        </div>

        <div className="staging-grid">
          <div className="staging-field">
            <label htmlFor="cmp-date">Data Fato Gerador</label>
            <input
              id="cmp-date"
              type="date"
              value={simDate.slice(0, 10)}
              onChange={(e) => setSimDate(e.target.value)}
            />
          </div>

          <div className="staging-field">
            <label htmlFor="cmp-base">Base de Cálculo (sem IS)</label>
            <input
              id="cmp-base"
              type="text"
              inputMode="decimal"
              className="tabular-nums"
              value={baseCalculo}
              onChange={(e) => setBaseCalculo(e.target.value)}
            />
          </div>

          <div className="staging-field">
            <label htmlFor="cmp-cst">CST</label>
            <input
              id="cmp-cst"
              type="text"
              className="tabular-nums"
              value={cst}
              onChange={(e) => setCst(e.target.value)}
            />
          </div>

          <div className="staging-field">
            <label htmlFor="cmp-classtrib">cClassTrib</label>
            <input
              id="cmp-classtrib"
              type="text"
              className="tabular-nums"
              value={cClassTrib}
              onChange={(e) => setCClassTrib(e.target.value)}
            />
          </div>

          <div className="staging-field">
            <label htmlFor="cmp-cativsn">cAtivSN (Simples)</label>
            <input
              id="cmp-cativsn"
              type="text"
              className="tabular-nums"
              value={cAtivSN}
              onChange={(e) => setCAtivSN(e.target.value)}
            />
          </div>

          <div className="staging-field">
            <label htmlFor="cmp-ncm">NCM (Opcional)</label>
            <input
              id="cmp-ncm"
              type="text"
              className="tabular-nums"
              value={ncm}
              onChange={(e) => setNcm(e.target.value)}
              placeholder="Ex.: 22030000"
            />
          </div>

          <div className="staging-field">
            <label htmlFor="cmp-nbs">NBS (Opcional)</label>
            <input
              id="cmp-nbs"
              type="text"
              className="tabular-nums"
              value={nbs}
              onChange={(e) => setNbs(e.target.value)}
              placeholder="Ex.: 1.0101"
            />
          </div>

          <div className="staging-field">
            <label htmlFor="cmp-pcbs">Alíquota Nominal CBS (%)</label>
            <input
              id="cmp-pcbs"
              type="text"
              inputMode="decimal"
              className="tabular-nums"
              value={pCBS}
              onChange={(e) => setPCBS(e.target.value)}
              placeholder="Obrigatório (ex.: 8.80)"
            />
          </div>

          <div className="staging-field">
            <label htmlFor="cmp-pibsuf">Alíquota Nominal IBS UF (%)</label>
            <input
              id="cmp-pibsuf"
              type="text"
              inputMode="decimal"
              className="tabular-nums"
              value={pIBSUF}
              onChange={(e) => setPIBSUF(e.target.value)}
              placeholder="Obrigatório (ex.: 17.70)"
            />
          </div>

          <div className="staging-field">
            <label htmlFor="cmp-pibsmun">Alíquota Nominal IBS Mun (%)</label>
            <input
              id="cmp-pibsmun"
              type="text"
              inputMode="decimal"
              className="tabular-nums"
              value={pIBSMun}
              onChange={(e) => setPIBSMun(e.target.value)}
              placeholder="Obrigatório (ex.: 0.00)"
            />
          </div>

          <div className="staging-field">
            <label htmlFor="cmp-pibssn">Alíquota Efetiva pIBSSN (%)</label>
            <input
              id="cmp-pibssn"
              type="text"
              inputMode="decimal"
              className="tabular-nums"
              value={pIBSSN}
              onChange={(e) => setPIBSSN(e.target.value)}
              placeholder="PGDAS-D explícito"
            />
          </div>

          <div className="staging-field">
            <label htmlFor="cmp-pcbssn">Alíquota Efetiva pCBSSN (%)</label>
            <input
              id="cmp-pcbssn"
              type="text"
              inputMode="decimal"
              className="tabular-nums"
              value={pCBSSN}
              onChange={(e) => setPCBSSN(e.target.value)}
              placeholder="PGDAS-D explícito"
            />
          </div>

          <div className="staging-field">
            <label htmlFor="cmp-is-val">IS Informado R$ (Opcional)</label>
            <input
              id="cmp-is-val"
              type="text"
              inputMode="decimal"
              className="tabular-nums"
              value={isValorInformado}
              onChange={(e) => setIsValorInformado(e.target.value)}
              placeholder="Ex.: 20.00"
            />
          </div>

          <div className="staging-field">
            <label htmlFor="cmp-is-aliq">IS Ad Valorem % (Opcional)</label>
            <input
              id="cmp-is-aliq"
              type="text"
              inputMode="decimal"
              className="tabular-nums"
              value={isAliquotaAdValorem}
              onChange={(e) => setIsAliquotaAdValorem(e.target.value)}
              placeholder="Ex.: 2.00"
            />
          </div>
        </div>

        <div className="compare-checkbox-row">
          <label className="compare-checkbox-label">
            <input
              type="checkbox"
              checked={incluirSublimiteCrt2}
              onChange={(e) => setIncluirSublimiteCrt2(e.target.checked)}
            />
            <span>Incluir Excesso de Sublimite (CRT=2 — CBS Simples + IBS Regular)</span>
          </label>
        </div>

        {compareError && (
          <div className="banner banner--danger" role="alert" style={{ marginBlockStart: 'var(--space-3)', marginBlockEnd: 0 }}>
            <span>{compareError}</span>
          </div>
        )}

        {remoteFailure && (
          <div className="recovery-card" role="alert">
            <div className="recovery-card__header">
              <AlertTriangle size={15} aria-hidden="true" />
              <strong>Serviço Oficial Indisponível (Fail-Closed)</strong>
            </div>
            <p className="recovery-card__body">{remoteFailure.message}</p>
            <div className="recovery-card__actions">
              <button
                type="button"
                className="btn btn--warning btn--sm"
                disabled={isComparing}
                onClick={() => {
                  void handleRunCompare(true);
                }}
              >
                <RefreshCw size={13} aria-hidden="true" />
                <span>Usar Motor Local (TS)</span>
              </button>
            </div>
          </div>
        )}
      </article>

      {/* Side-by-Side Scenarios Result */}
      {compareOutput && effectiveCompareSnapshot && (
        <article className="card">
          <div className="card__header">
            <div>
              <h3 className="card__title">Quadro Comparativo Determinístico</h3>
              <span className="card__meta tabular-nums">
                Snapshot <code>{effectiveCompareSnapshot.id}</code> &bull; Vigência:{' '}
                {compareOutput.dhFatoGerador} &bull;{' '}
                {effectiveCompareSnapshot.engineMode === 'remote-official'
                  ? 'Oficial RFB'
                  : 'Motor Local (TS)'}
              </span>
            </div>
            <div className="staging-header-actions">
              <a
                href={getExportXlsxUrl(effectiveCompareSnapshot.id)}
                download
                className="btn btn--sm"
              >
                <FileSpreadsheet size={14} aria-hidden="true" />
                <span>Exportar .xlsx</span>
              </a>
              <a
                href={getExportJsonUrl(effectiveCompareSnapshot.id)}
                download
                className="btn btn--sm"
              >
                <Download size={14} aria-hidden="true" />
                <span>Exportar .json</span>
              </a>
            </div>
          </div>

          {!compareOutput.elegivel && compareOutput.motivoInelegibilidade && (
            <div className="banner banner--warning" role="status">
              <span>{compareOutput.motivoInelegibilidade}</span>
            </div>
          )}

          {compareOutput.avisos.length > 0 && (
            <div className="banner banner--info" role="status">
              <span>{compareOutput.avisos.join(' • ')}</span>
            </div>
          )}

          {compareOutput.cenarios.length > 0 && (
            <>
              <div className="table-wrapper" style={{ marginBlockEnd: 'var(--space-4)' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Cenário</th>
                      <th scope="col" className="num">
                        IS (R$)
                      </th>
                      <th scope="col" className="num">
                        CBS (R$)
                      </th>
                      <th scope="col" className="num">
                        IBS (R$)
                      </th>
                      <th scope="col" className="num">
                        Total Tributos (R$)
                      </th>
                      <th scope="col">Ocorrências</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareOutput.cenarios.map((cen) => (
                      <tr key={`tbl-${cen.cenario}`}>
                        <th scope="row">{cen.titulo}</th>
                        <td className="num tabular-nums">{cen.totalIS}</td>
                        <td className="num tabular-nums">{cen.totalCBS}</td>
                        <td className="num tabular-nums">{cen.totalIBS}</td>
                        <td className="num tabular-nums">
                          <strong>{cen.totalTributos}</strong>
                        </td>
                        <td>
                          {cen.erros.length === 0 ? (
                            <span className="badge badge--success">OK</span>
                          ) : (
                            <span className="badge badge--warning tabular-nums">
                              {cen.erros.map((e) => e.code).join(', ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="compare-grid">
                {compareOutput.cenarios.map((cen) => (
                  <section
                    key={`card-${cen.cenario}`}
                    className="compare-card"
                    aria-label={cen.titulo}
                  >
                    <div className="compare-card__header">
                      <span className="badge badge--info">
                        {SCENARIO_SHORT_TAG[cen.cenario]}
                      </span>
                      <span className="kpi-value tabular-nums">
                        R$ {cen.totalTributos}
                      </span>
                    </div>
                    <h4 className="compare-card__title">{cen.titulo}</h4>

                    <dl className="compare-card__metrics">
                      <div>
                        <dt>Total IS</dt>
                        <dd className="tabular-nums">{cen.totalIS}</dd>
                      </div>
                      <div>
                        <dt>Total CBS</dt>
                        <dd className="tabular-nums">{cen.totalCBS}</dd>
                      </div>
                      <div>
                        <dt>Total IBS</dt>
                        <dd className="tabular-nums">{cen.totalIBS}</dd>
                      </div>
                      <div>
                        <dt>Total Tributos</dt>
                        <dd className="tabular-nums">{cen.totalTributos}</dd>
                      </div>
                    </dl>

                    <div className="compare-card__section">
                      <strong>Crédito ao Adquirente B2B:</strong>
                      <p>{cen.apropriacaoCreditoAdquirente}</p>
                    </div>

                    {cen.observacoes.length > 0 && (
                      <div className="compare-card__section">
                        <strong>Observações / Ponte de Base:</strong>
                        <ul>
                          {cen.observacoes.map((obs, idx) => (
                            <li key={`${cen.cenario}-obs-${idx}`}>{obs}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {cen.erros.length > 0 && (
                      <div className="compare-card__section">
                        <strong>Alertas / Erros:</strong>
                        <ul>
                          {cen.erros.map((err, idx) => (
                            <li key={`${cen.cenario}-err-${idx}`}>
                              <span className="badge badge--danger tabular-nums">
                                {err.code}
                              </span>{' '}
                              {err.title ?? err.description ?? ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </>
          )}
        </article>
      )}

      {/* Auxiliary Panels: Fator R & Base Unificada Yearly Comparison */}
      <div className="aux-grid">
        {/* Simulador Fator R Auxiliar */}
        <article className="aux-panel">
          <div className="aux-panel__header">
            <strong>
              <Scale
                size={14}
                aria-hidden="true"
                style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.25rem' }}
              />
              Simulador Fator R Auxiliar
            </strong>
            <span className="badge badge--neutral">LC 123/2006</span>
          </div>

          <p className="aux-panel__hint">
            Calcula <code>Folha 12m ÷ RBT12</code> (&ge; 28% sugere Anexo III; &lt; 28%
            sugere Anexo V).
          </p>

          <div className="staging-grid">
            <div className="staging-field">
              <label htmlFor="cmp-fator-folha">Folha 12m (R$)</label>
              <input
                id="cmp-fator-folha"
                type="text"
                inputMode="decimal"
                className="tabular-nums"
                value={folha12m}
                onChange={(e) => setFolha12m(e.target.value)}
                placeholder="Ex.: 32000.00"
              />
            </div>

            <div className="staging-field">
              <label htmlFor="cmp-fator-rbt">RBT 12m (R$)</label>
              <input
                id="cmp-fator-rbt"
                type="text"
                inputMode="decimal"
                className="tabular-nums"
                value={rbt12m}
                onChange={(e) => setRbt12m(e.target.value)}
                placeholder="Ex.: 100000.00"
              />
            </div>
          </div>

          <div>
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
          </div>

          {fatorRError && <p className="aux-panel__error">{fatorRError}</p>}

          {fatorRResult && (
            <div className="aux-panel__result">
              <div className="staging-header-actions">
                <span className="badge badge--info tabular-nums">
                  Fator R: {fatorRResult.fatorR} ({formatFatorRPercent(fatorRResult.fatorR)})
                </span>
                <span
                  className={`badge ${
                    fatorRResult.enquadramentoSugerido === 'Anexo III'
                      ? 'badge--success'
                      : fatorRResult.enquadramentoSugerido === 'Anexo V'
                        ? 'badge--warning'
                        : 'badge--neutral'
                  }`}
                >
                  {fatorRResult.enquadramentoSugerido}
                </span>
              </div>
              <p className="aux-panel__hint">{fatorRResult.avisoLegal}</p>
            </div>
          )}
        </article>

        {/* Comparativo Anual da Base Unificada (2026 x 2027 x 2033) */}
        <article className="aux-panel">
          <div className="aux-panel__header">
            <strong>Comparativo Anual da Base Unificada (2026 × 2027 × 2033)</strong>
            <select
              aria-label="Natureza Base Unificada"
              value={buNatureza}
              onChange={(e) => setBuNatureza(e.target.value as 'bem' | 'servico')}
            >
              <option value="bem">Bem (vProd + vICMS)</option>
              <option value="servico">Serviço (vServ + vISS)</option>
            </select>
          </div>

          <p className="aux-panel__hint">
            Demonstra o impacto da extinção de PIS/COFINS (2027) e ICMS/ISS (2033) sobre{' '}
            <code>baseRG</code>, <code>baseIS</code> e <code>baseSN</code>.
          </p>

          <div className="staging-grid">
            <div className="staging-field">
              <label htmlFor="bu-vprod">
                {activeContext.tipoDfe === 'NFSE' || buNatureza === 'servico'
                  ? 'vServ (R$)'
                  : 'vProd (R$)'}
              </label>
              <input
                id="bu-vprod"
                type="text"
                inputMode="decimal"
                className="tabular-nums"
                value={buVProd}
                onChange={(e) => setBuVProd(e.target.value)}
              />
            </div>

            <div className="staging-field">
              <label htmlFor="bu-vpis">vPIS (R$)</label>
              <input
                id="bu-vpis"
                type="text"
                inputMode="decimal"
                className="tabular-nums"
                value={buVPIS}
                onChange={(e) => setBuVPIS(e.target.value)}
              />
            </div>

            <div className="staging-field">
              <label htmlFor="bu-vcofins">vCOFINS (R$)</label>
              <input
                id="bu-vcofins"
                type="text"
                inputMode="decimal"
                className="tabular-nums"
                value={buVCOFINS}
                onChange={(e) => setBuVCOFINS(e.target.value)}
              />
            </div>

            <div className="staging-field">
              <label htmlFor="bu-vicms">
                {activeContext.tipoDfe === 'NFSE' || buNatureza === 'servico'
                  ? 'vISS (R$)'
                  : 'vICMS / vISS (R$)'}
              </label>
              <input
                id="bu-vicms"
                type="text"
                inputMode="decimal"
                className="tabular-nums"
                value={buVICMS}
                onChange={(e) => setBuVICMS(e.target.value)}
              />
            </div>

            <div className="staging-field">
              <label htmlFor="bu-vis">vIS (R$)</label>
              <input
                id="bu-vis"
                type="text"
                inputMode="decimal"
                className="tabular-nums"
                value={buVIS}
                onChange={(e) => setBuVIS(e.target.value)}
              />
            </div>

            <div className="staging-field">
              <label htmlFor="bu-vfrete">vFrete (R$)</label>
              <input
                id="bu-vfrete"
                type="text"
                inputMode="decimal"
                className="tabular-nums"
                value={buVFrete}
                onChange={(e) => setBuVFrete(e.target.value)}
              />
            </div>

            <div className="staging-field">
              <label htmlFor="bu-vdesc">vDesc (R$)</label>
              <input
                id="bu-vdesc"
                type="text"
                inputMode="decimal"
                className="tabular-nums"
                value={buVDesc}
                onChange={(e) => setBuVDesc(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="button"
              className="btn btn--sm"
              disabled={buLoading}
              onClick={() => {
                void handleCompareBaseUnificada();
              }}
            >
              {buLoading
                ? 'Calculando vigências...'
                : 'Comparar Vigências (2026 × 2027 × 2033)'}
            </button>
          </div>

          {buError && <p className="aux-panel__error">{buError}</p>}

          {buRows.length > 0 && (
            <div className="aux-panel__result">
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Vigência</th>
                      <th scope="col" className="num">
                        baseRG
                      </th>
                      <th scope="col" className="num">
                        baseIS
                      </th>
                      <th scope="col" className="num">
                        baseSN
                      </th>
                      <th scope="col">Regras Aplicadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buRows.map((row) => (
                      <tr key={`bu-year-${row.year}`}>
                        <th scope="row">{row.label}</th>
                        <td className="num tabular-nums">{row.output.baseRG}</td>
                        <td className="num tabular-nums">{row.output.baseIS}</td>
                        <td className="num tabular-nums">{row.output.baseSN}</td>
                        <td>
                          <small className="card__meta">
                            {row.output.avisos.join(' • ') || '—'}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

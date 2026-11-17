import type Database from 'better-sqlite3';
import type { Decimal } from 'decimal.js';
import {
  divideBy100,
  FiscalDecimal,
  formatCurrency,
  formatQuantity,
  formatRate,
  roundInternal8,
  totalizeExact,
} from '../../shared/rounding.js';
import type {
  DecimalInput,
  EstadoItem,
  FiscalErrorItem,
  FundamentacaoLegal,
  MemoriaCalculoTributo,
  ObservabilidadeRocItemOutput,
  ObservabilidadeRocOutput,
  OperacaoInput,
  OperacaoItemInput,
  SplitPaymentGuidance,
} from '../../shared/types/fiscal.js';
import {
  DadosAbertosRepository,
  type ClassificacaoTributariaRow,
  type SituacaoTributariaRow,
  type TratamentoTributarioRow,
} from '../db/dados-abertos-repo.js';
import { AstSecurityError, evaluateTaxExpression } from './ast-evaluator.js';
import { lookupErrorDescription } from './error-catalog.js';

const TRIBUTE_IS = 1;
const TRIBUTE_CBS = 2;
const TRIBUTE_IBS_UF = 3;
const TRIBUTE_IBS_MUN = 4;

const ANO_OBRIGATORIO_ALIQUOTAS_NOMINAIS = 2027;
const CSTS_ALIQUOTAS_FICTICIAS = new Set(['010', '220', '221']);

const PBIO_PCT = new FiscalDecimal('30');
const PDIF_MONO_PCT = new FiscalDecimal('100');
const VARIACAO_EAC = new FiscalDecimal('5');
const ALIQUOTA_EAC = new FiscalDecimal('0.1922');
const ALIQUOTA_GASOLINA_TIPO_A = new FiscalDecimal('0.7925');

const TRIO_RIGIDO_SIGLAS = new Set(['NFE', 'NFCE', 'NFSE']);
const NCM_APLICAVEL_SIGLAS = new Set(['NFSE', 'NFE', 'NFCE']);
const NBS_APLICAVEL_SIGLAS = new Set(['NFSE']);
const IMPOSTO_SELETIVO_SIGLAS = new Set(['NFE', 'NFCE']);
const SEM_TRATAMENTO_CALCULADORA_SIGLAS = new Set(['NFEABI', 'DERE']);
const EXCEPTION_NOMENCLATURA_CLTR = new Set(['200038']);

const IS_AD_VALOREM_SPECS = {
  ncm: {
    table: 'ALIQUOTA_AD_VALOREM_PRODUTO',
    excTable: 'EXCECAO_AD_VALOREM_PRODUTO',
    refTable: 'NCM',
    refCodeCol: 'NCM_CD',
    idCol: 'AAVP_ID',
    codeCol: 'AAVP_NCM_CD',
    advCol: 'AAVP_AADV_ID',
    startCol: 'AAVP_INICIO_VIGENCIA',
    endCol: 'AAVP_FIM_VIGENCIA',
    excCodeCol: 'EAVP_NCM_CD',
    excFkCol: 'EAVP_AAVP_ID',
    excStartCol: 'EAVP_INICIO_VIGENCIA',
    excEndCol: 'EAVP_FIM_VIGENCIA',
  },
  nbs: {
    table: 'ALIQUOTA_AD_VALOREM_SERVICO',
    excTable: 'EXCECAO_AD_VALOREM_SERVICO',
    refTable: 'NBS',
    refCodeCol: 'NBS_CD',
    idCol: 'AAVS_ID',
    codeCol: 'AAVS_NBS_CD',
    advCol: 'AAVS_AADV_ID',
    startCol: 'AAVS_INICIO_VIGENCIA',
    endCol: 'AAVS_FIM_VIGENCIA',
    excCodeCol: 'EAVS_NBS_CD',
    excFkCol: 'EAVS_AAVS_ID',
    excStartCol: 'EAVS_INICIO_VIGENCIA',
    excEndCol: 'EAVS_FIM_VIGENCIA',
  },
} as const;

class EngineValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly pointerField?: string | null,
    public readonly estadoOverride?: EstadoItem,
  ) {
    super(message);
    this.name = 'EngineValidationError';
  }
}

interface ResolvedTipoDfe {
  id: number;
  tipo: number;
  sigla: string;
  siglaNormalizada: string;
}

interface CbsIbsComponentCalc {
  tributeId: 2 | 3 | 4;
  tributoNome: 'CBS' | 'IBSUF' | 'IBSMun';
  baseCalculo: Decimal;
  aliquotaNominalPct: Decimal;
  aliquotaEfetivaPct: Decimal;
  percentualReducaoPct: Decimal | null;
  inGrupoReducao: boolean;
  tributoCalculado: Decimal;
  tributoDevido: Decimal;
  valorDiferimento: Decimal | null;
  percentualDiferimentoPct: Decimal | null;
  memoria: MemoriaCalculoTributo;
}

interface ImpostoSeletivoCalc {
  cstIS: string;
  cClassTribIS: string;
  vBCIS: Decimal;
  pIS: Decimal | null;
  pISEspec: Decimal | null;
  uTrib?: string;
  qTrib?: Decimal;
  vIS: Decimal;
  memoria: MemoriaCalculoTributo;
  fundamentacoes: FundamentacaoLegal[];
}

function normalizeSiglaDfe(sigla: string): string {
  return sigla.toUpperCase().replace(/[\s\-_]/g, '');
}

function parseCalendarDate(dhFatoGerador: string | undefined): string {
  if (typeof dhFatoGerador !== 'string' || !dhFatoGerador.trim()) {
    throw new EngineValidationError(
      'REG-021',
      'A data do fato gerador (dhFatoGerador) não foi informada.',
      'dhFatoGerador',
    );
  }
  const datePart = dhFatoGerador.trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) {
    throw new EngineValidationError(
      'REG-021',
      `Data do fato gerador inválida: '${dhFatoGerador}'. Esperado formato YYYY-MM-DD.`,
      'dhFatoGerador',
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() + 1 !== month ||
    utc.getUTCDate() !== day
  ) {
    throw new EngineValidationError(
      'REG-021',
      `Data do fato gerador inexistente no calendário: '${datePart}'.`,
      'dhFatoGerador',
    );
  }
  return datePart;
}

function parseDecimalValue(value: DecimalInput, fieldName: string): Decimal {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new EngineValidationError(
        'REG-024',
        `Valor numérico inválido para '${fieldName}'.`,
        fieldName,
      );
    }
    return new FiscalDecimal(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new EngineValidationError(
        'REG-024',
        `Valor decimal inválido para '${fieldName}': '${value}'.`,
        fieldName,
      );
    }
    return new FiscalDecimal(trimmed);
  }
  throw new EngineValidationError(
    'REG-024',
    `Tipo inválido para '${fieldName}'.`,
    fieldName,
  );
}

function makeFiscalError(
  code: string,
  detail: string,
  pointer: string,
): { error: FiscalErrorItem; estado: EstadoItem } {
  const entry = lookupErrorDescription(code);
  return {
    error: {
      code,
      title: entry?.titulo ?? 'Erro de validação',
      description: detail,
      pointer,
      severity: 'error',
    },
    estado: entry?.estadoDefault ?? 'INCONSISTENCIA_ENTRADA',
  };
}

function buildPointer(itemIndex: number | null, field?: string | null): string {
  const base = itemIndex === null ? '#' : `#/itens/${itemIndex}`;
  if (!field) {
    return base;
  }
  return `${base}/${field}`;
}

function renderMemoriaTexto(
  template: string | undefined,
  valores: Record<string, string>,
): string {
  if (!template || !template.trim()) {
    return 'Texto de memória de cálculo não encontrado';
  }
  return template.replace(/\[([^\]]+)\]/g, (_full, key: string) => {
    return Object.prototype.hasOwnProperty.call(valores, key) ? valores[key]! : '';
  });
}

function buildSplitPaymentGuidance(vCbs: Decimal, vIbs: Decimal): SplitPaymentGuidance {
  const vCbsSujeito = formatCurrency(vCbs);
  const vIbsSujeito = formatCurrency(vIbs);
  const vTotalSujeito = formatCurrency(vCbs.plus(vIbs));
  const aplicavel = vCbs.plus(vIbs).gt(0);

  const orientacao = aplicavel
    ? `Valores sujeitos à liquidação financeira via Split Payment (LC 214/2025): CBS de R$ ${vCbsSujeito} e IBS de R$ ${vIbsSujeito} (total de R$ ${vTotalSujeito}), segregados conforme liquidação eletrônica pelo valor devido na operação.`
    : `Sem débito de CBS (R$ ${vCbsSujeito}) ou IBS (R$ ${vIbsSujeito}) a segregar via Split Payment para este enquadramento tributário.`;

  return {
    aplicavel,
    vCbsSujeito,
    vIbsSujeito,
    vTotalSujeito,
    orientacao,
    observacaoLegal:
      'LC 214/2025, arts. 31 a 35 — Orientação qualitativa baseada exclusivamente nos débitos calculados de CBS e IBS (sem aplicação de alíquota de retenção presumida).',
  };
}

/**
 * Deterministic Regime Regular calculation engine (`LocalTsEngine` Part 1).
 * Mirrors RFB's `ObservabilidadeService`, `ProcessamentoItemService`,
 * `CalculoImpostoSeletivoService`, and `CalculoCbsIbsService` over `rtc-oficial.db`.
 */
export class RegimeRegularEngine {
  private readonly repo: DadosAbertosRepository;

  constructor(
    private readonly db: Database.Database,
    repo?: DadosAbertosRepository,
  ) {
    this.repo = repo ?? new DadosAbertosRepository(db);
  }

  calculate(
    operacao: OperacaoInput,
    mode: 'observabilidade' | 'estrito' = 'observabilidade',
  ): ObservabilidadeRocOutput {
    const errosGlobais: FiscalErrorItem[] = [];
    let refDate = '';

    try {
      refDate = parseCalendarDate(operacao?.dhFatoGerador);
    } catch (err) {
      const vex =
        err instanceof EngineValidationError
          ? err
          : new EngineValidationError('REG-021', 'Data do fato gerador inválida.', 'dhFatoGerador');
      errosGlobais.push(
        makeFiscalError(vex.code, vex.message, buildPointer(null, vex.pointerField)).error,
      );
      return {
        modo: mode,
        dhFatoGerador: operacao?.dhFatoGerador ?? '',
        xWarningDadosSimulados: false,
        avisos: [],
        errosGlobais,
        itens: [],
      };
    }

    const year = Number(refDate.slice(0, 4));
    const itensInput = Array.isArray(operacao.itens) ? operacao.itens : [];
    if (itensInput.length === 0) {
      errosGlobais.push(
        makeFiscalError('VAL-003', 'A lista de itens da operação não pode estar vazia.', '#/itens')
          .error,
      );
    }

    let resolvedUfCd: number | null = operacao.ufCd ?? null;
    let resolvedUfSigla: string | undefined = operacao.uf?.trim().toUpperCase();
    const resolvedMuniCd: number | null = operacao.municipio ?? null;
    let resolvedTipoDfe: ResolvedTipoDfe | null = null;

    if (errosGlobais.length === 0) {
      try {
        if (resolvedMuniCd !== null) {
          const muniInfo = this.validateMunicipio(resolvedMuniCd, resolvedUfSigla, resolvedUfCd);
          resolvedUfCd = muniInfo.ufCd;
          resolvedUfSigla = muniInfo.ufSigla;
        } else if (resolvedUfSigla) {
          resolvedUfCd = this.validateUfBySigla(resolvedUfSigla);
        } else if (resolvedUfCd !== null) {
          resolvedUfSigla = this.validateUfByCode(resolvedUfCd);
        }

        if (operacao.tipoDfe !== undefined && operacao.tipoDfe !== null && `${operacao.tipoDfe}`.trim() !== '') {
          resolvedTipoDfe = this.resolveTipoDfe(operacao.tipoDfe, refDate);
        }
      } catch (err) {
        if (err instanceof EngineValidationError) {
          errosGlobais.push(
            makeFiscalError(err.code, err.message, buildPointer(null, err.pointerField)).error,
          );
        } else {
          errosGlobais.push(
            makeFiscalError(
              'CAL-999',
              err instanceof Error ? err.message : 'Erro interno na validação global.',
              '#',
            ).error,
          );
        }
      }
    }

    const xWarningDadosSimulados = this.computeWarningDadosSimulados(year, itensInput);

    if (errosGlobais.length > 0) {
      return {
        modo: mode,
        dhFatoGerador: operacao.dhFatoGerador,
        xWarningDadosSimulados,
        avisos: this.buildAvisos(xWarningDadosSimulados, year),
        errosGlobais,
        itens: [],
      };
    }

    let pRedCompraGov = new FiscalDecimal(0);
    if (operacao.tpEnteGov !== undefined && operacao.tpEnteGov !== null) {
      if (operacao.pRedCompraGov !== undefined && operacao.pRedCompraGov !== null) {
        pRedCompraGov = parseDecimalValue(operacao.pRedCompraGov, 'pRedCompraGov');
      } else {
        const dbRedutor = this.repo.getRedutorCompraGov(refDate);
        if (dbRedutor === null) {
          errosGlobais.push(
            makeFiscalError(
              'CAL-009',
              `Redutor de compra governamental não encontrado na data ${refDate}.`,
              '#/tpEnteGov',
            ).error,
          );
          return {
            modo: mode,
            dhFatoGerador: operacao.dhFatoGerador,
            xWarningDadosSimulados,
            avisos: this.buildAvisos(xWarningDadosSimulados, year),
            errosGlobais,
            itens: [],
          };
        }
        pRedCompraGov = new FiscalDecimal(dbRedutor);
      }
    }

    const itemResults: Array<{
      output: ObservabilidadeRocItemOutput;
      unroundedIS: Decimal | null;
      unroundedVBC: Decimal | null;
      unroundedVCBS: Decimal | null;
      unroundedVIBSUF: Decimal | null;
      unroundedVIBSMun: Decimal | null;
      unroundedVDifCBS: Decimal | null;
      unroundedVDifIBSUF: Decimal | null;
      unroundedVDifIBSMun: Decimal | null;
    }> = [];

    for (let i = 0; i < itensInput.length; i += 1) {
      itemResults.push(
        this.processItem(
          itensInput[i]!,
          i,
          refDate,
          year,
          resolvedUfCd,
          resolvedMuniCd,
          resolvedTipoDfe,
          operacao.tpEnteGov ?? null,
          pRedCompraGov,
        ),
      );
    }

    const itens = itemResults.map((r) => r.output);
    const failedItems = itens.filter((item) => item.erros.length > 0);

    if (mode === 'estrito' && failedItems.length > 0) {
      for (const failed of failedItems) {
        errosGlobais.push(...failed.erros);
      }
      return {
        modo: 'estrito',
        dhFatoGerador: operacao.dhFatoGerador,
        xWarningDadosSimulados,
        avisos: this.buildAvisos(xWarningDadosSimulados, year),
        errosGlobais,
        itens,
      };
    }

    const validResults = itemResults.filter(
      (r) =>
        r.output.estadoItem === 'CALCULADO' || r.output.estadoItem === 'CALCULO_SIMULADO',
    );

    let ISTot: ObservabilidadeRocOutput['ISTot'];
    let IBSCBSTot: ObservabilidadeRocOutput['IBSCBSTot'];
    let splitPaymentGuidance: SplitPaymentGuidance | undefined;

    if (validResults.length > 0) {
      const isValues = validResults
        .map((r) => r.unroundedIS)
        .filter((v): v is Decimal => v !== null);
      if (isValues.length > 0) {
        ISTot = { vIS: formatCurrency(totalizeExact(isValues)) };
      }

      const vBCList = validResults
        .map((r) => r.unroundedVBC)
        .filter((v): v is Decimal => v !== null);
      const vIBSUFList = validResults
        .map((r) => r.unroundedVIBSUF)
        .filter((v): v is Decimal => v !== null);
      const vIBSMunList = validResults
        .map((r) => r.unroundedVIBSMun)
        .filter((v): v is Decimal => v !== null);
      const vCBSList = validResults
        .map((r) => r.unroundedVCBS)
        .filter((v): v is Decimal => v !== null);
      const vDifIBSUFList = validResults
        .map((r) => r.unroundedVDifIBSUF)
        .filter((v): v is Decimal => v !== null);
      const vDifIBSMunList = validResults
        .map((r) => r.unroundedVDifIBSMun)
        .filter((v): v is Decimal => v !== null);
      const vDifCBSList = validResults
        .map((r) => r.unroundedVDifCBS)
        .filter((v): v is Decimal => v !== null);

      const totVBC = totalizeExact(vBCList);
      const totVIBSUF = totalizeExact(vIBSUFList);
      const totVIBSMun = totalizeExact(vIBSMunList);
      const totVIBS = totVIBSUF.plus(totVIBSMun);
      const totVCBS = totalizeExact(vCBSList);

      IBSCBSTot = {
        vBCIBSCBS: formatCurrency(totVBC),
        gIBS: {
          vIBS: formatCurrency(totVIBS),
          gIBSUF: {
            vIBSUF: formatCurrency(totVIBSUF),
            ...(vDifIBSUFList.length > 0
              ? { vDif: formatCurrency(totalizeExact(vDifIBSUFList)) }
              : {}),
          },
          gIBSMun: {
            vIBSMun: formatCurrency(totVIBSMun),
            ...(vDifIBSMunList.length > 0
              ? { vDif: formatCurrency(totalizeExact(vDifIBSMunList)) }
              : {}),
          },
        },
        gCBS: {
          vCBS: formatCurrency(totVCBS),
          ...(vDifCBSList.length > 0
            ? { vDif: formatCurrency(totalizeExact(vDifCBSList)) }
            : {}),
        },
      };

      splitPaymentGuidance = buildSplitPaymentGuidance(totVCBS, totVIBS);
    }

    return {
      modo: mode,
      dhFatoGerador: operacao.dhFatoGerador,
      xWarningDadosSimulados,
      avisos: this.buildAvisos(xWarningDadosSimulados, year),
      errosGlobais,
      itens,
      ...(ISTot ? { ISTot } : {}),
      ...(IBSCBSTot ? { IBSCBSTot } : {}),
      ...(splitPaymentGuidance ? { splitPaymentGuidance } : {}),
    };
  }

  private computeWarningDadosSimulados(year: number, itens: OperacaoItemInput[]): boolean {
    if (year >= ANO_OBRIGATORIO_ALIQUOTAS_NOMINAIS) {
      return true;
    }
    if (year >= 2026) {
      for (const item of itens) {
        if (CSTS_ALIQUOTAS_FICTICIAS.has(item.cst?.trim() ?? '')) {
          return true;
        }
      }
    }
    return false;
  }

  private buildAvisos(xWarningDadosSimulados: boolean, year: number): string[] {
    if (!xWarningDadosSimulados) {
      return [];
    }
    if (year >= ANO_OBRIGATORIO_ALIQUOTAS_NOMINAIS) {
      return [
        'Cálculos realizados a partir de 2027 utilizam alíquotas nominais informadas (simulação), pois as alíquotas de referência definitivas ainda não estão publicadas no catálogo.',
      ];
    }
    return ['Operação contém CST com alíquota fictícia parametrizada para simulação em 2026.'];
  }

  private processItem(
    item: OperacaoItemInput,
    index: number,
    refDate: string,
    year: number,
    ufCd: number | null,
    muniCd: number | null,
    tipoDfe: ResolvedTipoDfe | null,
    tpEnteGov: 1 | 2 | 3 | 4 | null,
    pRedCompraGov: Decimal,
  ): {
    output: ObservabilidadeRocItemOutput;
    unroundedIS: Decimal | null;
    unroundedVBC: Decimal | null;
    unroundedVCBS: Decimal | null;
    unroundedVIBSUF: Decimal | null;
    unroundedVIBSMun: Decimal | null;
    unroundedVDifCBS: Decimal | null;
    unroundedVDifIBSUF: Decimal | null;
    unroundedVDifIBSMun: Decimal | null;
  } {
    const nObj = item.nObj ?? item.numero ?? index + 1;
    const ncm = item.ncm?.trim() || undefined;
    const nbs = item.nbs?.trim() || undefined;
    const cst = item.cst?.trim() ?? '';
    const cClassTrib = item.cClassTrib?.trim() ?? '';

    const failItem = (
      code: string,
      detail: string,
      field?: string | null,
      estadoOverride?: EstadoItem,
    ) => {
      const { error, estado } = makeFiscalError(code, detail, buildPointer(index, field));
      return {
        output: {
          nObj,
          estadoItem: estadoOverride ?? estado,
          erros: [error],
          ...(item.descricao ? { descricao: item.descricao } : {}),
          ...(ncm ? { ncm } : {}),
          ...(nbs ? { nbs } : {}),
          cst,
          cClassTrib,
          memoriaCalculo: [],
          fundamentacoesLegais: [],
        } satisfies ObservabilidadeRocItemOutput,
        unroundedIS: null,
        unroundedVBC: null,
        unroundedVCBS: null,
        unroundedVIBSUF: null,
        unroundedVIBSMun: null,
        unroundedVDifCBS: null,
        unroundedVDifIBSUF: null,
        unroundedVDifIBSMun: null,
      };
    };

    try {
      // 1. Structural item validation
      if (!cst) {
        throw new EngineValidationError('VAL-002', "Campo 'cst' não pode estar em branco.", 'cst');
      }
      if (!/^\d{3}$/.test(cst)) {
        throw new EngineValidationError(
          'VAL-009',
          `Campo 'cst' deve conter exatamente 3 dígitos, recebido: '${cst}'.`,
          'cst',
        );
      }
      if (!cClassTrib) {
        throw new EngineValidationError(
          'VAL-002',
          "Campo 'cClassTrib' não pode estar em branco.",
          'cClassTrib',
        );
      }
      if (!/^\d{6}$/.test(cClassTrib)) {
        throw new EngineValidationError(
          'VAL-009',
          `Campo 'cClassTrib' deve conter exatamente 6 dígitos, recebido: '${cClassTrib}'.`,
          'cClassTrib',
        );
      }

      const quantidade =
        item.quantidade !== undefined && item.quantidade !== null
          ? parseDecimalValue(item.quantidade, 'quantidade')
          : new FiscalDecimal(1);
      if (quantidade.lte(0)) {
        throw new EngineValidationError(
          'REG-023',
          'A quantidade do item deve ser maior do que zero.',
          'quantidade',
        );
      }
      const unidade = item.unidade?.trim() || 'UN';

      // 2. Base de cálculo validation & IS derivation (ProcessamentoItemService.validarBaseCalculoLegado)
      const { baseCalculoInformada, impostoSeletivoInformado } = this.validateAndResolveBaseCalculo(
        item,
      );

      // 3. NCM / NBS existence & exclusivity
      if (ncm && nbs) {
        throw new EngineValidationError(
          'REG-001',
          'Apenas uma nomenclatura (NCM ou NBS) deve ser informada por item.',
          null,
        );
      }
      if (ncm && !this.existsNcm(ncm, refDate)) {
        throw new EngineValidationError(
          'REG-002',
          `NCM '${ncm}' não encontrada ou fora de vigência na data ${refDate}.`,
          'ncm',
        );
      }
      if (nbs && !this.existsNbs(nbs, refDate)) {
        throw new EngineValidationError(
          'REG-003',
          `NBS '${nbs}' não encontrada ou fora de vigência na data ${refDate}.`,
          'nbs',
        );
      }

      // 4. CST validation (CBS/IBS group = 2)
      const sitrCbs = this.lookupSituacaoTributaria(cst, TRIBUTE_CBS, refDate);
      if (!sitrCbs) {
        throw new EngineValidationError(
          'REG-004',
          `Situação tributária (CST) '${cst}' não encontrada para CBS e IBS na data ${refDate}.`,
          'cst',
        );
      }

      // 5. Temporal aliquotasNominais validation
      this.validateAliquotasNominais(item, year, sitrCbs);

      // 6. Classification & Tratamento Tributário lookup
      const origClassif = this.repo.lookupClassificacao(cClassTrib, TRIBUTE_CBS, refDate);
      if (!origClassif) {
        throw new EngineValidationError(
          'REG-005',
          `Classificação tributária '${cClassTrib}' não encontrada ou fora de vigência na data ${refDate}.`,
          'cClassTrib',
        );
      }
      if (origClassif.cst !== cst) {
        throw new EngineValidationError(
          'REG-006',
          `Classificação tributária '${cClassTrib}' pertence ao CST '${origClassif.cst}' e não está vinculada ao CST '${cst}'.`,
          'cClassTrib',
        );
      }
      if (tipoDfe && !this.checkTipoDfeLink(tipoDfe.id, origClassif.cltrId, refDate)) {
        throw new EngineValidationError(
          'REG-029',
          `Classificação tributária '${cClassTrib}' não vinculada ao tipo de documento fiscal ${tipoDfe.tipo}.`,
          'cClassTrib',
        );
      }
      const origTratamento = this.repo.getTratamentoParaClassificacao(origClassif.cltrId, refDate);
      if (!origTratamento) {
        throw new EngineValidationError(
          'REG-008',
          `Tratamento de classificação tributária não encontrado para '${cClassTrib}' na data ${refDate}.`,
          'cClassTrib',
        );
      }

      let effectiveClassif: ClassificacaoTributariaRow = origClassif;
      let effectiveTratamento: TratamentoTributarioRow = origTratamento;
      let temDesoneracao = false;

      if (origTratamento.inExigeGrupoDesoneracao) {
        if (
          !item.tributacaoRegular ||
          !item.tributacaoRegular.cst?.trim() ||
          !item.tributacaoRegular.cClassTrib?.trim()
        ) {
          throw new EngineValidationError(
            'REG-009',
            `O grupo de tributação regular é obrigatório para a classificação '${cClassTrib}'.`,
            'tributacaoRegular',
          );
        }
        const trCst = item.tributacaoRegular.cst.trim();
        const trCClassTrib = item.tributacaoRegular.cClassTrib.trim();
        const trClassif = this.repo.lookupClassificacao(trCClassTrib, TRIBUTE_CBS, refDate);
        if (!trClassif) {
          throw new EngineValidationError(
            'REG-005',
            `Classificação de tributação regular '${trCClassTrib}' não encontrada na data ${refDate}.`,
            'tributacaoRegular/cClassTrib',
          );
        }
        if (trClassif.cst !== trCst) {
          throw new EngineValidationError(
            'REG-006',
            `Classificação tributária '${trCClassTrib}' não vinculada ao CST '${trCst}' na tributação regular.`,
            'tributacaoRegular/cClassTrib',
          );
        }
        if (tipoDfe && !this.checkTipoDfeLink(tipoDfe.id, trClassif.cltrId, refDate)) {
          throw new EngineValidationError(
            'REG-029',
            `Classificação tributária '${trCClassTrib}' não vinculada ao tipo de documento ${tipoDfe.tipo}.`,
            'tributacaoRegular/cClassTrib',
          );
        }
        const trTratamento = this.repo.getTratamentoParaClassificacao(trClassif.cltrId, refDate);
        if (!trTratamento) {
          throw new EngineValidationError(
            'REG-008',
            `Tratamento tributário não encontrado para '${trCClassTrib}'.`,
            'tributacaoRegular/cClassTrib',
          );
        }
        if (trTratamento.inIncompativelComSuspensao) {
          throw new EngineValidationError(
            'REG-010',
            `A classificação tributária '${trCClassTrib}' (CST '${trCst}') é incompatível com suspensão.`,
            'tributacaoRegular/cClassTrib',
          );
        }
        effectiveClassif = trClassif;
        effectiveTratamento = trTratamento;
        temDesoneracao = true;
      } else if (item.tributacaoRegular?.cClassTrib && tipoDfe) {
        const extraClassif = this.repo.lookupClassificacao(
          item.tributacaoRegular.cClassTrib.trim(),
          TRIBUTE_CBS,
          refDate,
        );
        if (!extraClassif) {
          throw new EngineValidationError(
            'REG-005',
            `Classificação tributária '${item.tributacaoRegular.cClassTrib}' não encontrada.`,
            'tributacaoRegular/cClassTrib',
          );
        }
        if (!this.checkTipoDfeLink(tipoDfe.id, extraClassif.cltrId, refDate)) {
          throw new EngineValidationError(
            'REG-029',
            `Classificação tributária '${item.tributacaoRegular.cClassTrib}' não vinculada ao tipo de documento ${tipoDfe.tipo}.`,
            'tributacaoRegular/cClassTrib',
          );
        }
      }

      // 7. Priority unimplemented classification check (TRTR_IN_POSSUI_AJUSTE = 1 -> CAL-007 / NAO_IMPLEMENTADO)
      if (origTratamento.inPossuiAjuste || effectiveTratamento.inPossuiAjuste) {
        const unimplCode = origTratamento.inPossuiAjuste
          ? origClassif.cClassTrib
          : effectiveClassif.cClassTrib;
        throw new EngineValidationError(
          'CAL-007',
          `Classificação tributária '${unimplCode}' possui ajuste ainda não implementado.`,
          'cClassTrib',
          'NAO_IMPLEMENTADO',
        );
      }

      // 8. Nomenclature annex validation
      this.validateNomenclature(ncm, nbs, effectiveClassif, refDate, tipoDfe);

      // 9. Imposto Seletivo resolution & calculation
      const isCalc = this.resolveAndCalculateIs(
        item,
        ncm,
        nbs,
        refDate,
        year,
        tipoDfe,
      );
      const impostoSeletivoCalculado = isCalc ? isCalc.vIS : new FiscalDecimal(0);

      // 10. Calculate CBS, IBS UF, IBS Mun
      const cbsCalc = this.calculateCbsIbsComponent(
        TRIBUTE_CBS,
        'CBS',
        ufCd,
        muniCd,
        item,
        effectiveClassif,
        effectiveTratamento,
        origClassif,
        origTratamento,
        baseCalculoInformada,
        impostoSeletivoInformado,
        impostoSeletivoCalculado,
        quantidade,
        unidade,
        temDesoneracao,
        refDate,
        tpEnteGov,
        pRedCompraGov,
      );

      const ibsUfCalc = this.calculateCbsIbsComponent(
        TRIBUTE_IBS_UF,
        'IBSUF',
        ufCd,
        muniCd,
        item,
        effectiveClassif,
        effectiveTratamento,
        origClassif,
        origTratamento,
        baseCalculoInformada,
        impostoSeletivoInformado,
        impostoSeletivoCalculado,
        quantidade,
        unidade,
        temDesoneracao,
        refDate,
        tpEnteGov,
        pRedCompraGov,
      );

      const ibsMunCalc = this.calculateCbsIbsComponent(
        TRIBUTE_IBS_MUN,
        'IBSMun',
        ufCd,
        muniCd,
        item,
        effectiveClassif,
        effectiveTratamento,
        origClassif,
        origTratamento,
        baseCalculoInformada,
        impostoSeletivoInformado,
        impostoSeletivoCalculado,
        quantidade,
        unidade,
        temDesoneracao,
        refDate,
        tpEnteGov,
        pRedCompraGov,
      );

      // Compra governamental transfer redistribution when tpEnteGov is present
      if (tpEnteGov !== null && sitrCbs.indGIbsCbs) {
        this.applyCompraGovernamentalTransfer(
          tpEnteGov,
          refDate,
          cbsCalc,
          ibsUfCalc,
          ibsMunCalc,
        );
      }

      const hasManualRates = this.hasAnyNominalRatesInput(item);
      const estadoItem: EstadoItem = hasManualRates ? 'CALCULO_SIMULADO' : 'CALCULADO';

      const gIS = isCalc
        ? {
            cstIS: isCalc.cstIS,
            cClassTribIS: isCalc.cClassTribIS,
            vBCIS: formatCurrency(isCalc.vBCIS),
            ...(isCalc.pIS !== null ? { pIS: formatRate(isCalc.pIS) } : {}),
            ...(isCalc.pISEspec !== null ? { pISEspec: formatRate(isCalc.pISEspec) } : {}),
            ...(isCalc.uTrib ? { uTrib: isCalc.uTrib } : {}),
            ...(isCalc.qTrib !== undefined ? { qTrib: formatQuantity(isCalc.qTrib) } : {}),
            vIS: formatCurrency(isCalc.vIS),
          }
        : undefined;

      const emitGroupIbsCbs = sitrCbs.indGIbsCbs;
      const vIbsItemUnrounded = emitGroupIbsCbs
        ? ibsUfCalc.tributoDevido.plus(ibsMunCalc.tributoDevido)
        : new FiscalDecimal(0);
      const vCbsItemUnrounded = emitGroupIbsCbs ? cbsCalc.tributoDevido : new FiscalDecimal(0);

      const gIBSCBS = emitGroupIbsCbs
        ? {
            CST: cst,
            cClassTrib,
            vBC: formatCurrency(cbsCalc.baseCalculo),
            gIBSUF: {
              pIBSUF: formatRate(ibsUfCalc.aliquotaNominalPct),
              ...(ibsUfCalc.inGrupoReducao && ibsUfCalc.percentualReducaoPct !== null
                ? { pRedAliq: formatRate(ibsUfCalc.percentualReducaoPct) }
                : {}),
              pAliqEfet: formatRate(ibsUfCalc.aliquotaEfetivaPct),
              vIBSUF: formatCurrency(ibsUfCalc.tributoDevido),
              ...(ibsUfCalc.valorDiferimento !== null
                ? { vDif: formatCurrency(ibsUfCalc.valorDiferimento) }
                : {}),
            },
            gIBSMun: {
              pIBSMun: formatRate(ibsMunCalc.aliquotaNominalPct),
              ...(ibsMunCalc.inGrupoReducao && ibsMunCalc.percentualReducaoPct !== null
                ? { pRedAliq: formatRate(ibsMunCalc.percentualReducaoPct) }
                : {}),
              pAliqEfet: formatRate(ibsMunCalc.aliquotaEfetivaPct),
              vIBSMun: formatCurrency(ibsMunCalc.tributoDevido),
              ...(ibsMunCalc.valorDiferimento !== null
                ? { vDif: formatCurrency(ibsMunCalc.valorDiferimento) }
                : {}),
            },
            vIBS: formatCurrency(vIbsItemUnrounded),
            gCBS: {
              pCBS: formatRate(cbsCalc.aliquotaNominalPct),
              ...(cbsCalc.inGrupoReducao && cbsCalc.percentualReducaoPct !== null
                ? { pRedAliq: formatRate(cbsCalc.percentualReducaoPct) }
                : {}),
              pAliqEfet: formatRate(cbsCalc.aliquotaEfetivaPct),
              vCBS: formatCurrency(cbsCalc.tributoDevido),
              ...(cbsCalc.valorDiferimento !== null
                ? { vDif: formatCurrency(cbsCalc.valorDiferimento) }
                : {}),
            },
          }
        : undefined;

      const memoriaCalculo: MemoriaCalculoTributo[] = [];
      if (isCalc) {
        memoriaCalculo.push(isCalc.memoria);
      }
      if (emitGroupIbsCbs) {
        memoriaCalculo.push(cbsCalc.memoria, ibsUfCalc.memoria, ibsMunCalc.memoria);
      }

      const fundMap = new Map<string, FundamentacaoLegal>();
      for (const f of this.repo.getFundamentacoesLegais(origClassif.cltrId, refDate)) {
        if (f.codigo) {
          fundMap.set(f.codigo, f);
        }
      }
      if (isCalc) {
        for (const f of isCalc.fundamentacoes) {
          if (f.codigo) {
            fundMap.set(f.codigo, f);
          }
        }
      }

      const creditIndicators = this.repo.getCreditIndicators(cClassTrib, refDate);
      const splitPaymentGuidance = buildSplitPaymentGuidance(vCbsItemUnrounded, vIbsItemUnrounded);

      return {
        output: {
          nObj,
          estadoItem,
          erros: [],
          ...(item.descricao ? { descricao: item.descricao } : {}),
          ...(ncm ? { ncm } : {}),
          ...(nbs ? { nbs } : {}),
          cst,
          cClassTrib,
          ...(gIS ? { gIS } : {}),
          ...(gIBSCBS ? { gIBSCBS } : {}),
          creditIndicators,
          splitPaymentGuidance,
          memoriaCalculo,
          fundamentacoesLegais: [...fundMap.values()],
        },
        unroundedIS: isCalc ? isCalc.vIS : null,
        unroundedVBC: emitGroupIbsCbs ? cbsCalc.baseCalculo : null,
        unroundedVCBS: emitGroupIbsCbs ? cbsCalc.tributoDevido : null,
        unroundedVIBSUF: emitGroupIbsCbs ? ibsUfCalc.tributoDevido : null,
        unroundedVIBSMun: emitGroupIbsCbs ? ibsMunCalc.tributoDevido : null,
        unroundedVDifCBS: emitGroupIbsCbs ? cbsCalc.valorDiferimento : null,
        unroundedVDifIBSUF: emitGroupIbsCbs ? ibsUfCalc.valorDiferimento : null,
        unroundedVDifIBSMun: emitGroupIbsCbs ? ibsMunCalc.valorDiferimento : null,
      };
    } catch (err) {
      if (err instanceof EngineValidationError) {
        return failItem(err.code, err.message, err.pointerField, err.estadoOverride);
      }
      if (err instanceof AstSecurityError) {
        return failItem('CAL-008', err.message, null, 'FALHA_TECNICA');
      }
      return failItem(
        'CAL-999',
        err instanceof Error ? err.message : 'Erro interno ao processar item.',
        null,
        'FALHA_TECNICA',
      );
    }
  }

  private validateAndResolveBaseCalculo(item: OperacaoItemInput): {
    baseCalculoInformada: Decimal;
    impostoSeletivoInformado: Decimal;
  } {
    const hasItemBc =
      item.baseCalculo !== undefined &&
      item.baseCalculo !== null &&
      `${item.baseCalculo}`.trim() !== '';

    const isGroup = item.impostoSeletivo;
    if (!isGroup) {
      if (!hasItemBc) {
        throw new EngineValidationError(
          'REG-025',
          'A base de cálculo de CBS e IBS é obrigatória quando o grupo do Imposto Seletivo não é informado.',
          'baseCalculo',
        );
      }
      const bc = parseDecimalValue(item.baseCalculo!, 'baseCalculo');
      if (bc.lt(0)) {
        throw new EngineValidationError(
          'VAL-013',
          'A base de cálculo não pode ser negativa.',
          'baseCalculo',
        );
      }
      return {
        baseCalculoInformada: bc,
        impostoSeletivoInformado: new FiscalDecimal(0),
      };
    }

    if (
      isGroup.baseCalculo === undefined ||
      isGroup.baseCalculo === null ||
      `${isGroup.baseCalculo}`.trim() === ''
    ) {
      throw new EngineValidationError(
        'REG-023',
        'A base de cálculo do Imposto Seletivo deve ser informada quando o grupo de Imposto Seletivo é informado.',
        'impostoSeletivo/baseCalculo',
      );
    }

    const bcIS = parseDecimalValue(isGroup.baseCalculo, 'impostoSeletivo/baseCalculo');
    if (bcIS.lt(0)) {
      throw new EngineValidationError(
        'VAL-013',
        'A base de cálculo do Imposto Seletivo não pode ser negativa.',
        'impostoSeletivo/baseCalculo',
      );
    }

    const rawIsInf = isGroup.valorInformado ?? item.impostoSeletivoInformado;
    const hasIsInf = rawIsInf !== undefined && rawIsInf !== null && `${rawIsInf}`.trim() !== '';
    const isInfVal = hasIsInf ? parseDecimalValue(rawIsInf, 'valorInformado') : new FiscalDecimal(0);
    if (isInfVal.lt(0)) {
      throw new EngineValidationError(
        'VAL-013',
        'O Imposto Seletivo informado não pode ser negativo.',
        'impostoSeletivo/valorInformado',
      );
    }

    if (!hasItemBc) {
      return {
        baseCalculoInformada: roundInternal8(bcIS.plus(isInfVal)),
        impostoSeletivoInformado: isInfVal,
      };
    }

    const bcItem = parseDecimalValue(item.baseCalculo!, 'baseCalculo');
    if (bcItem.lt(0)) {
      throw new EngineValidationError(
        'VAL-013',
        'A base de cálculo não pode ser negativa.',
        'baseCalculo',
      );
    }

    if (hasIsInf) {
      if (!bcItem.eq(bcIS.plus(isInfVal))) {
        throw new EngineValidationError(
          'REG-026',
          `Base de cálculo de CBS/IBS (${bcItem.toFixed(2)}) difere de BC(IS) (${bcIS.toFixed(2)}) + IS informado (${isInfVal.toFixed(2)}).`,
          'baseCalculo',
        );
      }
    } else if (bcItem.lt(bcIS)) {
      throw new EngineValidationError(
        'REG-027',
        `Base de cálculo de CBS/IBS (${bcItem.toFixed(2)}) é menor que a base de cálculo do IS (${bcIS.toFixed(2)}).`,
        'baseCalculo',
      );
    }

    return {
      baseCalculoInformada: bcItem,
      impostoSeletivoInformado: isInfVal,
    };
  }

  private hasAnyNominalRatesInput(item: OperacaoItemInput): boolean {
    const a = item.aliquotasNominais;
    if (!a) {
      return false;
    }
    return (
      (a.pCBS !== undefined && a.pCBS !== null) ||
      (a.pIBSUF !== undefined && a.pIBSUF !== null) ||
      (a.pIBSMun !== undefined && a.pIBSMun !== null)
    );
  }

  private validateAliquotasNominais(
    item: OperacaoItemInput,
    year: number,
    sitrCbs: SituacaoTributariaRow,
  ): void {
    const hasCbsIbsRates = this.hasAnyNominalRatesInput(item);
    const hasIsRates =
      item.impostoSeletivo !== undefined &&
      ((item.impostoSeletivo.aliquotaAdValorem !== undefined &&
        item.impostoSeletivo.aliquotaAdValorem !== null) ||
        (item.impostoSeletivo.aliquotaAdRem !== undefined &&
          item.impostoSeletivo.aliquotaAdRem !== null));

    if (year < ANO_OBRIGATORIO_ALIQUOTAS_NOMINAIS) {
      if (hasCbsIbsRates || hasIsRates) {
        throw new EngineValidationError(
          'REG-036',
          'As alíquotas nominais não podem ser informadas para fato gerador anterior a 01/01/2027.',
          'aliquotasNominais',
        );
      }
      return;
    }

    if (!sitrCbs.indGIbsCbs) {
      return;
    }

    const a = item.aliquotasNominais;
    if (
      !a ||
      a.pCBS === undefined ||
      a.pCBS === null ||
      a.pIBSUF === undefined ||
      a.pIBSUF === null ||
      a.pIBSMun === undefined ||
      a.pIBSMun === null
    ) {
      throw new EngineValidationError(
        'REG-037',
        'As alíquotas nominais (pCBS, pIBSUF e pIBSMun) são obrigatórias para fato gerador a partir de 01/01/2027.',
        'aliquotasNominais',
      );
    }

    const pCBS = parseDecimalValue(a.pCBS, 'aliquotasNominais/pCBS');
    const pIBSUF = parseDecimalValue(a.pIBSUF, 'aliquotasNominais/pIBSUF');
    const pIBSMun = parseDecimalValue(a.pIBSMun, 'aliquotasNominais/pIBSMun');
    if (pCBS.lt(0) || pIBSUF.lt(0) || pIBSMun.lt(0)) {
      throw new EngineValidationError(
        'CAL-005',
        'As alíquotas nominais não podem ser negativas.',
        'aliquotasNominais',
      );
    }
  }

  private validateNomenclature(
    ncm: string | undefined,
    nbs: string | undefined,
    classif: ClassificacaoTributariaRow,
    refDate: string,
    tipoDfe: ResolvedTipoDfe | null,
  ): void {
    const hasNcmAnnex = this.hasNomenclatureAnnex('ncm', classif.cltrId, refDate);
    const hasNbsAnnex = this.hasNomenclatureAnnex('nbs', classif.cltrId, refDate);

    if (tipoDfe) {
      const result = this.determineNomenclaturaForDfe(
        tipoDfe,
        classif.cltrId,
        classif.cClassTrib,
        hasNcmAnnex,
        hasNbsAnnex,
        refDate,
      );

      switch (result) {
        case 'NCM':
        case 'EXCECAO_NCM':
          if (nbs) {
            throw new EngineValidationError(
              'REG-030',
              `NBS não é compatível com a classificação '${classif.cClassTrib}' para o documento ${tipoDfe.sigla}.`,
              'nbs',
            );
          }
          this.validateCodeAgainstAnnex('ncm', ncm, classif, hasNcmAnnex, refDate, true);
          return;

        case 'NBS':
        case 'EXCECAO_NBS':
          if (ncm) {
            throw new EngineValidationError(
              'REG-030',
              `NCM não é compatível com a classificação '${classif.cClassTrib}' para o documento ${tipoDfe.sigla}.`,
              'ncm',
            );
          }
          this.validateCodeAgainstAnnex('nbs', nbs, classif, hasNbsAnnex, refDate, true);
          return;

        case 'MISTO':
          if (ncm) {
            this.validateCodeAgainstAnnex('ncm', ncm, classif, hasNcmAnnex, refDate, true);
          } else if (nbs) {
            this.validateCodeAgainstAnnex('nbs', nbs, classif, hasNbsAnnex, refDate, true);
          } else {
            throw new EngineValidationError(
              'REG-033',
              `Nomenclatura obrigatória (NCM ou NBS) não informada para '${classif.cClassTrib}' no documento ${tipoDfe.sigla}.`,
              null,
            );
          }
          return;

        case 'SEM':
          if (!ncm && !nbs) {
            return;
          }
          if (TRIO_RIGIDO_SIGLAS.has(tipoDfe.siglaNormalizada)) {
            if (tipoDfe.siglaNormalizada === 'NFSE' && ncm) {
              throw new EngineValidationError(
                'REG-030',
                `NCM não é compatível com NFS-e para a classificação '${classif.cClassTrib}'.`,
                'ncm',
              );
            }
            if (tipoDfe.siglaNormalizada !== 'NFSE' && nbs) {
              throw new EngineValidationError(
                'REG-030',
                `NBS não é compatível com ${tipoDfe.sigla} para a classificação '${classif.cClassTrib}'.`,
                'nbs',
              );
            }
            return;
          }
          if (ncm && hasNcmAnnex) {
            this.validateCodeAgainstAnnex('ncm', ncm, classif, true, refDate, true);
          } else if (nbs && hasNbsAnnex) {
            this.validateCodeAgainstAnnex('nbs', nbs, classif, true, refDate, true);
          }
          return;
      }
    }

    // Sem tpDoc informado (ProcessamentoItemService lines 208-223)
    if (!ncm && !nbs) {
      if (hasNcmAnnex) {
        throw new EngineValidationError(
          'REG-015',
          'O código NCM completo (8 dígitos) é obrigatório para esta classificação tributária.',
          'ncm',
        );
      }
      if (hasNbsAnnex) {
        throw new EngineValidationError(
          'REG-016',
          'O código NBS completo (9 dígitos) é obrigatório para esta classificação tributária.',
          'nbs',
        );
      }
      return;
    }

    if (ncm) {
      this.validateCodeAgainstAnnex('ncm', ncm, classif, hasNcmAnnex, refDate, false);
      return;
    }

    if (nbs) {
      this.validateCodeAgainstAnnex('nbs', nbs, classif, hasNbsAnnex, refDate, false);
    }
  }

  private validateCodeAgainstAnnex(
    kind: 'ncm' | 'nbs',
    code: string | undefined,
    classif: ClassificacaoTributariaRow,
    hasAnnex: boolean,
    refDate: string,
    alwaysRequireFullLength: boolean,
  ): void {
    const requiredLen = kind === 'ncm' ? 8 : 9;
    const upper = kind.toUpperCase();
    const isComplete = code !== undefined && code.length === requiredLen;

    if ((alwaysRequireFullLength || hasAnnex) && !isComplete) {
      throw new EngineValidationError(
        kind === 'ncm' ? 'REG-015' : 'REG-016',
        `O código ${upper} completo (${requiredLen} dígitos) é obrigatório para esta classificação tributária.`,
        kind,
      );
    }

    if (isComplete && hasAnnex) {
      const compatible =
        kind === 'ncm'
          ? this.repo.checkNcmCompatByClassTrib(code, classif.cClassTrib, refDate)
          : this.repo.checkNbsCompatByClassTrib(code, classif.cClassTrib, refDate);
      if (!compatible) {
        throw new EngineValidationError(
          kind === 'ncm' ? 'REG-011' : 'REG-012',
          `${upper} de código ${code} não vinculada à Classificação Tributária de código ${classif.cClassTrib} (CBS e IBS)`,
          kind,
        );
      }
    }
  }

  private determineNomenclaturaForDfe(
    tipoDfe: ResolvedTipoDfe,
    cltrId: number,
    cClassTrib: string,
    hasNcmAnnex: boolean,
    hasNbsAnnex: boolean,
    refDate: string,
  ): 'SEM' | 'NCM' | 'NBS' | 'MISTO' | 'EXCECAO_NCM' | 'EXCECAO_NBS' {
    if (!this.checkTipoDfeLink(tipoDfe.id, cltrId, refDate)) {
      return 'SEM';
    }
    if (EXCEPTION_NOMENCLATURA_CLTR.has(cClassTrib)) {
      if (tipoDfe.siglaNormalizada === 'NFE' || tipoDfe.siglaNormalizada === 'NFCE') {
        return 'EXCECAO_NCM';
      }
      if (tipoDfe.siglaNormalizada === 'NFSE') {
        return 'EXCECAO_NBS';
      }
      return 'SEM';
    }
    if (
      NCM_APLICAVEL_SIGLAS.has(tipoDfe.siglaNormalizada) &&
      !NBS_APLICAVEL_SIGLAS.has(tipoDfe.siglaNormalizada)
    ) {
      return hasNcmAnnex ? 'NCM' : 'SEM';
    }
    if (NBS_APLICAVEL_SIGLAS.has(tipoDfe.siglaNormalizada)) {
      if (hasNcmAnnex && hasNbsAnnex) return 'MISTO';
      if (hasNcmAnnex) return 'NCM';
      if (hasNbsAnnex) return 'NBS';
      return 'SEM';
    }
    return 'SEM';
  }

  private resolveAndCalculateIs(
    item: OperacaoItemInput,
    ncm: string | undefined,
    nbs: string | undefined,
    refDate: string,
    year: number,
    tipoDfe: ResolvedTipoDfe | null,
  ): ImpostoSeletivoCalc | null {
    const isInput = item.impostoSeletivo;
    let adValorem =
      isInput?.aliquotaAdValorem !== undefined && isInput.aliquotaAdValorem !== null
        ? parseDecimalValue(isInput.aliquotaAdValorem, 'impostoSeletivo/aliquotaAdValorem')
        : null;
    let adRem =
      isInput?.aliquotaAdRem !== undefined && isInput.aliquotaAdRem !== null
        ? parseDecimalValue(isInput.aliquotaAdRem, 'impostoSeletivo/aliquotaAdRem')
        : null;

    if (adValorem !== null && adValorem.lt(0)) {
      throw new EngineValidationError(
        'CAL-005',
        'Alíquota ad valorem do Imposto Seletivo não pode ser negativa.',
        'impostoSeletivo/aliquotaAdValorem',
      );
    }
    if (adRem !== null && adRem.lt(0)) {
      throw new EngineValidationError(
        'CAL-005',
        'Alíquota ad rem do Imposto Seletivo não pode ser negativa.',
        'impostoSeletivo/aliquotaAdRem',
      );
    }

    if (adRem !== null && !isInput?.unidade?.trim()) {
      throw new EngineValidationError(
        'REG-023',
        'A unidade de medida do Imposto Seletivo deve ser informada quando a alíquota ad rem é informada pelo usuário.',
        'impostoSeletivo/unidade',
      );
    }

    let dbHasAdValorem = false;
    let dbHasAdRem = false;
    let unidadeMedida = adRem !== null ? isInput?.unidade?.trim() : undefined;

    if (ncm && ncm.length === 8) {
      const dbAdv = this.lookupIsAdValorem('ncm', ncm, refDate);
      dbHasAdValorem = dbAdv.exists;
      if (adValorem === null && dbAdv.valor !== null) {
        adValorem = new FiscalDecimal(dbAdv.valor);
      }

      const dbAdr = this.lookupIsAdRemNcm(ncm, refDate);
      dbHasAdRem = dbAdr !== null;
      if (adRem === null && dbAdr !== null) {
        if (dbAdr.valor !== null) {
          adRem = new FiscalDecimal(dbAdr.valor);
        }
        if (dbAdr.unidade) {
          unidadeMedida = dbAdr.unidade;
        }
      }
    } else if (nbs && nbs.length === 9) {
      const dbAdvServ = this.lookupIsAdValorem('nbs', nbs, refDate);
      dbHasAdValorem = dbAdvServ.exists;
      if (adValorem === null && dbAdvServ.valor !== null) {
        adValorem = new FiscalDecimal(dbAdvServ.valor);
      }
    }

    const hasResolvedRate = adValorem !== null || adRem !== null;
    const existeIncidenciaIS = dbHasAdValorem || dbHasAdRem;

    if (tipoDfe && !IMPOSTO_SELETIVO_SIGLAS.has(tipoDfe.siglaNormalizada) && hasResolvedRate) {
      const label = ncm ? 'NCM' : 'NBS';
      const code = ncm ?? nbs ?? '';
      throw new EngineValidationError(
        'REG-032',
        `O ${label} ${code} está sujeito ao Imposto Seletivo, não admitido para o documento ${tipoDfe.sigla}.`,
        'impostoSeletivo',
      );
    }

    if (!hasResolvedRate && year >= ANO_OBRIGATORIO_ALIQUOTAS_NOMINAIS && existeIncidenciaIS) {
      const label = ncm ? 'NCM' : 'NBS';
      const code = ncm ?? nbs ?? '';
      if (!isInput) {
        throw new EngineValidationError(
          'REG-013',
          `Os dados do Imposto Seletivo são obrigatórios para ${label} ${code} em ${refDate}.`,
          'impostoSeletivo',
        );
      }
      throw new EngineValidationError(
        'REG-035',
        `A alíquota do Imposto Seletivo para ${label} ${code} ainda não está definida em lei e não foi informada.`,
        'impostoSeletivo',
      );
    }

    if (!hasResolvedRate) {
      if (isInput && !existeIncidenciaIS) {
        const label = ncm ? 'NCM' : 'NBS';
        const code = ncm ?? nbs ?? '';
        throw new EngineValidationError(
          'REG-014',
          `O ${label} ${code} não está sujeito ao Imposto Seletivo.`,
          'impostoSeletivo',
        );
      }
      return null;
    }

    if (!isInput) {
      throw new EngineValidationError(
        'REG-013',
        'Os dados do Imposto Seletivo são obrigatórios para este item.',
        'impostoSeletivo',
      );
    }

    let qTrib: Decimal | undefined;
    if (isInput.quantidade !== undefined && isInput.quantidade !== null) {
      qTrib = parseDecimalValue(isInput.quantidade, 'impostoSeletivo/quantidade');
      if (qTrib.lte(0)) {
        throw new EngineValidationError(
          'REG-023',
          'A quantidade do Imposto Seletivo deve ser maior do que zero.',
          'impostoSeletivo/quantidade',
        );
      }
    }

    if (adRem !== null) {
      if (qTrib === undefined) {
        throw new EngineValidationError(
          'REG-023',
          'A quantidade do Imposto Seletivo deve ser informada para alíquota ad rem.',
          'impostoSeletivo/quantidade',
        );
      }
      if (!isInput.unidade?.trim()) {
        throw new EngineValidationError(
          'REG-023',
          'A unidade de medida do Imposto Seletivo deve ser informada para alíquota ad rem.',
          'impostoSeletivo/unidade',
        );
      }
    }

    const cstIS = isInput.cstIS?.trim() ?? '';
    const cClassTribIS = isInput.cClassTribIS?.trim() ?? '';

    if (!cstIS) {
      throw new EngineValidationError(
        'VAL-002',
        "Campo 'cstIS' do Imposto Seletivo é obrigatório.",
        'impostoSeletivo/cstIS',
      );
    }
    const sitrIs = this.lookupSituacaoTributaria(cstIS, TRIBUTE_IS, refDate);
    if (!sitrIs) {
      throw new EngineValidationError(
        'REG-004',
        `Situação tributária (CST) '${cstIS}' não encontrada para Imposto Seletivo na data ${refDate}.`,
        'impostoSeletivo/cstIS',
      );
    }

    if (!cClassTribIS) {
      throw new EngineValidationError(
        'VAL-002',
        "Campo 'cClassTribIS' do Imposto Seletivo é obrigatório.",
        'impostoSeletivo/cClassTribIS',
      );
    }
    // Explicit tributeId = 1 to avoid CLTR_CD collision with CBS/IBS ('000001'..'000005')
    const isClassif = this.repo.lookupClassificacao(cClassTribIS, TRIBUTE_IS, refDate);
    if (!isClassif) {
      throw new EngineValidationError(
        'REG-005',
        `Classificação tributária '${cClassTribIS}' não encontrada para Imposto Seletivo na data ${refDate}.`,
        'impostoSeletivo/cClassTribIS',
      );
    }
    if (isClassif.cst !== cstIS) {
      throw new EngineValidationError(
        'REG-006',
        `Classificação '${cClassTribIS}' não vinculada ao CST '${cstIS}' (Imposto Seletivo).`,
        'impostoSeletivo/cClassTribIS',
      );
    }

    const isTratamento = this.repo.getTratamentoParaClassificacao(isClassif.cltrId, refDate);
    if (!isTratamento) {
      throw new EngineValidationError(
        'REG-008',
        `Tratamento tributário não encontrado para IS '${cClassTribIS}'.`,
        'impostoSeletivo/cClassTribIS',
      );
    }

    const bcInformada = parseDecimalValue(isInput.baseCalculo!, 'impostoSeletivo/baseCalculo');
    const quantidade = qTrib ?? new FiscalDecimal(1);
    const adValoremFactor = adValorem !== null ? roundInternal8(divideBy100(adValorem)) : new FiscalDecimal(0);
    const adRemVal = adRem ?? new FiscalDecimal(0);

    const varsBase = {
      quantidade,
      aliquota: null,
      aliquotaEfetiva: null,
      baseCalculoInformada: bcInformada,
      impostoSeletivoInformado: new FiscalDecimal(0),
      impostoSeletivoCalculado: new FiscalDecimal(0),
      percentualReducao: new FiscalDecimal(0),
      aliquotaPadraoOuReferencia: new FiscalDecimal(0),
      aliquotaReferencia: new FiscalDecimal(0),
      aliquotaAdValorem: adValoremFactor,
      aliquotaAdRem: adRemVal,
      ajuste: new FiscalDecimal(0),
      redutor: new FiscalDecimal(0),
    };

    const resultadoBC = evaluateTaxExpression(isTratamento.expressaoBaseCalculo, varsBase);
    const resultadoCalc = evaluateTaxExpression(isTratamento.expressaoTributoCalculado, {
      ...varsBase,
      baseCalculo: resultadoBC,
    });
    const resultadoDevido = isTratamento.expressaoTributoDevido?.trim()
      ? evaluateTaxExpression(isTratamento.expressaoTributoDevido, {
          ...varsBase,
          baseCalculo: resultadoBC,
          tributoCalculado: resultadoCalc,
        })
      : resultadoCalc;

    const fundIs = this.repo.getFundamentacoesLegais(isClassif.cltrId, refDate);
    const norma = fundIs[0]?.descricao ?? '';
    const uTrib = isInput.unidade?.trim() || unidadeMedida;

    const memoriaTexto = renderMemoriaTexto(isClassif.memoriaCalculo, {
      norma,
      tratamento: isTratamento.descricao,
      base_calculo: formatCurrency(resultadoBC),
      aliquota_ad_valorem: adValorem !== null ? formatRate(adValorem) : '0.00',
      aliquota_ad_rem: adRem !== null ? formatRate(adRem) : '0.00',
      quantidade: qTrib !== undefined ? formatQuantity(qTrib) : '',
      unidade: uTrib ?? '',
    });

    const memoria: MemoriaCalculoTributo = {
      tributo: 'IS',
      baseCalculo: formatCurrency(resultadoBC),
      ...(adValorem !== null ? { aliquotaNominal: formatRate(adValorem) } : {}),
      ...(adValorem !== null ? { aliquotaEfetiva: formatRate(adValorem) } : {}),
      valorCalculado: formatCurrency(resultadoCalc),
      valorDevido: formatCurrency(resultadoDevido),
      expressaoAplicada: isTratamento.expressaoTributoCalculado,
      memoriaTexto,
    };

    return {
      cstIS,
      cClassTribIS,
      vBCIS: resultadoBC,
      pIS: adValorem,
      pISEspec: adRem,
      ...(uTrib ? { uTrib } : {}),
      ...(qTrib !== undefined ? { qTrib } : {}),
      vIS: resultadoDevido,
      memoria,
      fundamentacoes: fundIs,
    };
  }

  private calculateCbsIbsComponent(
    tributeId: 2 | 3 | 4,
    tributoNome: 'CBS' | 'IBSUF' | 'IBSMun',
    ufCd: number | null,
    muniCd: number | null,
    item: OperacaoItemInput,
    classif: ClassificacaoTributariaRow,
    tratamento: TratamentoTributarioRow,
    origClassif: ClassificacaoTributariaRow,
    origTratamento: TratamentoTributarioRow,
    baseCalculoInformada: Decimal,
    impostoSeletivoInformado: Decimal,
    impostoSeletivoCalculado: Decimal,
    quantidade: Decimal,
    unidade: string,
    temDesoneracao: boolean,
    refDate: string,
    tpEnteGov: 1 | 2 | 3 | 4 | null,
    pRedCompraGov: Decimal,
  ): CbsIbsComponentCalc {
    let valorPercentualReducao: Decimal | null = null;
    if (tratamento.inPossuiPercentualReducao) {
      const pct = this.repo.getPercentualReducao(classif.cltrId, tributeId, refDate);
      if (pct === null) {
        throw new EngineValidationError(
          'CAL-010',
          `Percentual de redução não encontrado para classificação '${classif.cClassTrib}' e tributo ${tributeId} em ${refDate}.`,
        );
      }
      valorPercentualReducao = roundInternal8(divideBy100(pct));
    }

    const tipoAliquota = classif.cClassTrib === '510001' ? 'Padrão' : classif.tipoAliquota;
    const rawNominalInput = this.getNominalRateForTribute(tributeId, item);
    const aliquotaInformada =
      rawNominalInput !== null ? parseDecimalValue(rawNominalInput, 'aliquotasNominais') : null;

    let valorAliquota = new FiscalDecimal(0);
    let aliquotaInformadaAplicada = false;
    let aliquotaDivididaPorCem = false;

    let valorAliquotaAdRemPrincipal: Decimal | null = null;
    let valorAliquotaAdRemSecundaria: Decimal | null = null;
    let variacaoPontoPercentual: Decimal | null = null;
    let pBio: Decimal | null = null;
    let pDifMono: Decimal | null = null;

    switch (tipoAliquota) {
      case 'Padrão': {
        if (aliquotaInformada !== null) {
          valorAliquota = roundInternal8(divideBy100(aliquotaInformada));
          aliquotaInformadaAplicada = true;
        } else {
          const padrao = this.repo.getAliquotaPadrao(
            tributeId,
            tributeId === TRIBUTE_IBS_UF ? ufCd : null,
            tributeId === TRIBUTE_IBS_MUN ? muniCd : null,
            refDate,
          );
          if (!padrao) {
            throw new EngineValidationError(
              'CAL-002',
              `Alíquota padrão não encontrada para tributo ${tributeId} na data ${refDate}.`,
            );
          }
          valorAliquota = roundInternal8(divideBy100(padrao.valorAplicavel));
        }
        aliquotaDivididaPorCem = true;
        break;
      }

      case 'Uniforme nacional (referência)': {
        if (aliquotaInformada !== null) {
          valorAliquota = roundInternal8(divideBy100(aliquotaInformada));
          aliquotaInformadaAplicada = true;
        } else {
          const ref = this.repo.getAliquotaReferencia(tributeId, refDate);
          if (ref === null) {
            throw new EngineValidationError(
              'CAL-003',
              `Alíquota de referência não encontrada para tributo ${tributeId} na data ${refDate}.`,
            );
          }
          valorAliquota = roundInternal8(divideBy100(ref));
        }
        aliquotaDivididaPorCem = true;
        break;
      }

      case 'Uniforme setorial': {
        if (tratamento.inPossuiMonofasia) {
          valorAliquotaAdRemPrincipal = ALIQUOTA_GASOLINA_TIPO_A;
          valorAliquotaAdRemSecundaria = ALIQUOTA_EAC;
          pBio = roundInternal8(divideBy100(PBIO_PCT));
          pDifMono = roundInternal8(divideBy100(PDIF_MONO_PCT));
          variacaoPontoPercentual = VARIACAO_EAC;
        } else if (aliquotaInformada !== null) {
          valorAliquota = roundInternal8(divideBy100(aliquotaInformada));
          aliquotaInformadaAplicada = true;
          aliquotaDivididaPorCem = true;
        } else {
          const nbsVal = item.nbs?.trim()
            ? this.lookupUniformeSetorialNbs(item.nbs.trim(), tributeId, classif.cltrId, refDate)
            : null;
          const fallbackVal =
            nbsVal ?? this.lookupAliquotaPorClassificacao(tributeId, classif.cltrId, refDate);
          if (fallbackVal === null) {
            throw new EngineValidationError(
              'REG-023',
              `Alíquota uniforme setorial não encontrada em ${refDate}.`,
            );
          }
          valorAliquota = roundInternal8(divideBy100(fallbackVal));
          aliquotaDivididaPorCem = true;
        }
        break;
      }

      case 'Fixa': {
        if (aliquotaInformada !== null) {
          valorAliquota = roundInternal8(divideBy100(aliquotaInformada));
          aliquotaInformadaAplicada = true;
        } else {
          const fixaVal = this.lookupAliquotaPorClassificacao(tributeId, classif.cltrId, refDate);
          if (fixaVal === null) {
            throw new EngineValidationError(
              'REG-023',
              `Alíquota fixa não encontrada em ${refDate}.`,
            );
          }
          valorAliquota = roundInternal8(divideBy100(fixaVal));
        }
        aliquotaDivididaPorCem = true;
        break;
      }

      case 'Sem alíquota': {
        if (aliquotaInformada !== null) {
          valorAliquota = roundInternal8(divideBy100(aliquotaInformada));
          aliquotaInformadaAplicada = true;
          aliquotaDivididaPorCem = true;
        } else {
          valorAliquota = new FiscalDecimal(0);
        }
        break;
      }

      case 'Alíquotas Combinadas (Ad Valorem e Ad Rem)':
        break;

      default:
        throw new EngineValidationError(
          'CAL-006',
          `Tipo de alíquota desconhecido '${tipoAliquota}' para classificação '${classif.cClassTrib}'.`,
        );
    }

    const baseVars: Record<string, Decimal | null> = {
      quantidade,
      percentualReducao: valorPercentualReducao,
      pRedutorCompraGov: pRedCompraGov,
      aliquotaPadraoOuReferencia: null,
      aliquotaReferencia: null,
      aliquotaAdValorem: null,
      aliquotaAdRem: null,
      ajuste: null,
      redutor: null,
      aliquotaAdRemPrincipal: valorAliquotaAdRemPrincipal,
      aliquotaAdRemSecundaria: valorAliquotaAdRemSecundaria,
      variacaoPontoPercentual,
      pBio,
      percentualDiferimento: pDifMono,
      baseCalculoInformada,
      impostoSeletivoInformado,
      impostoSeletivoCalculado,
    };

    const exprAliq = tratamento.expressaoAliquota?.trim() ?? '';
    let resultadoAliquota: Decimal = valorAliquota;
    if (exprAliq) {
      resultadoAliquota = evaluateTaxExpression(exprAliq, {
        ...baseVars,
        aliquota: valorAliquota,
      });
    }

    const exprAliqEfet = tratamento.expressaoAliquotaEfetiva?.trim() ?? '';
    let resultadoAliquotaEfetiva: Decimal = resultadoAliquota;
    if (exprAliqEfet) {
      resultadoAliquotaEfetiva = evaluateTaxExpression(exprAliqEfet, {
        ...baseVars,
        aliquota: resultadoAliquota,
      });
    }

    let resultadoBaseCalculo = evaluateTaxExpression(tratamento.expressaoBaseCalculo, {
      ...baseVars,
      aliquota: resultadoAliquota,
      aliquotaEfetiva: resultadoAliquotaEfetiva,
    });
    if (resultadoBaseCalculo.lt(0)) {
      resultadoBaseCalculo = new FiscalDecimal(0);
    }

    let resultadoTributoCalculado = evaluateTaxExpression(tratamento.expressaoTributoCalculado, {
      ...baseVars,
      baseCalculo: resultadoBaseCalculo,
      aliquota: resultadoAliquota,
      aliquotaEfetiva: resultadoAliquotaEfetiva,
    });

    let resultadoTributoDevido = tratamento.expressaoTributoDevido?.trim()
      ? evaluateTaxExpression(tratamento.expressaoTributoDevido, {
          ...baseVars,
          tributoCalculado: resultadoTributoCalculado,
          baseCalculo: resultadoBaseCalculo,
          aliquota: resultadoAliquota,
          aliquotaEfetiva: resultadoAliquotaEfetiva,
        })
      : resultadoTributoCalculado;

    let resultadoPercentualDiferimento: Decimal | null = null;
    let resultadoValorDiferimento: Decimal | null = null;

    if (
      tratamento.expressaoPercentualDiferimento?.trim() &&
      tratamento.expressaoValorDiferimento?.trim()
    ) {
      resultadoPercentualDiferimento = evaluateTaxExpression(
        tratamento.expressaoPercentualDiferimento,
        {
          ...baseVars,
          tributoCalculado: resultadoTributoCalculado,
          baseCalculo: resultadoBaseCalculo,
          aliquota: resultadoAliquota,
          aliquotaEfetiva: resultadoAliquotaEfetiva,
        },
      );
      resultadoValorDiferimento = evaluateTaxExpression(tratamento.expressaoValorDiferimento, {
        ...baseVars,
        percentualDiferimento: resultadoPercentualDiferimento,
        tributoCalculado: resultadoTributoCalculado,
        baseCalculo: resultadoBaseCalculo,
        aliquota: resultadoAliquota,
        aliquotaEfetiva: resultadoAliquotaEfetiva,
      });
      // Keep pre-deferral resultadoTributoCalculado intact; deduct resultadoValorDiferimento once for resultadoTributoDevido
      resultadoTributoDevido = roundInternal8(
        resultadoTributoCalculado.minus(resultadoValorDiferimento),
      );
      if (resultadoTributoCalculado.lt(0)) {
        resultadoTributoCalculado = new FiscalDecimal(0);
      }
      if (resultadoTributoDevido.lt(0)) {
        resultadoTributoDevido = new FiscalDecimal(0);
      }
    }

    const inGrupoReducao =
      classif.sitrIndGRed && !(temDesoneracao && tpEnteGov === null);

    const aliquotaNominalPct = aliquotaDivididaPorCem
      ? resultadoAliquota.mul(100)
      : resultadoAliquota;
    const aliquotaEfetivaPct = aliquotaDivididaPorCem
      ? resultadoAliquotaEfetiva.mul(100)
      : resultadoAliquotaEfetiva;
    const percentualReducaoPct =
      valorPercentualReducao !== null ? valorPercentualReducao.mul(100) : null;
    const percentualDiferimentoPct =
      resultadoPercentualDiferimento !== null ? resultadoPercentualDiferimento.mul(100) : null;

    const finalCalculado = temDesoneracao ? new FiscalDecimal(0) : resultadoTributoCalculado;
    const finalDevido = temDesoneracao ? new FiscalDecimal(0) : resultadoTributoDevido;
    const finalAliquotaPct = temDesoneracao ? new FiscalDecimal(0) : aliquotaNominalPct;
    const finalEfetivaPct = temDesoneracao ? new FiscalDecimal(0) : aliquotaEfetivaPct;

    const fundMemoria = this.repo.getFundamentacoesLegais(origClassif.cltrId, refDate);
    const memoriaTexto = renderMemoriaTexto(origClassif.memoriaCalculo, {
      norma: fundMemoria[0]?.descricao ?? '',
      tratamento: origTratamento.descricao,
      base_calculo: formatCurrency(resultadoBaseCalculo),
      aliquota_ad_valorem: formatRate(finalAliquotaPct),
      aliquota_ad_rem: '0',
      quantidade: formatQuantity(quantidade),
      unidade,
      percentual_reducao:
        inGrupoReducao && percentualReducaoPct !== null ? formatRate(percentualReducaoPct) : '0',
      percentual_diferimento:
        percentualDiferimentoPct !== null ? formatRate(percentualDiferimentoPct) : '0',
      valor_diferimento:
        resultadoValorDiferimento !== null ? formatCurrency(resultadoValorDiferimento) : '0',
      aliquota_desoneracao: '0',
      montante_desoneracao: '0',
    });

    const memoria: MemoriaCalculoTributo = {
      tributo: tributoNome,
      baseCalculo: formatCurrency(resultadoBaseCalculo),
      aliquotaNominal: formatRate(finalAliquotaPct),
      ...(inGrupoReducao && percentualReducaoPct !== null
        ? { percentualReducao: formatRate(percentualReducaoPct) }
        : {}),
      aliquotaEfetiva: formatRate(finalEfetivaPct),
      valorCalculado: formatCurrency(finalCalculado),
      ...(resultadoValorDiferimento !== null
        ? { valorDiferimento: formatCurrency(resultadoValorDiferimento) }
        : {}),
      valorDevido: formatCurrency(finalDevido),
      expressaoAplicada: tratamento.expressaoTributoCalculado,
      memoriaTexto,
    };

    return {
      tributeId,
      tributoNome,
      baseCalculo: resultadoBaseCalculo,
      aliquotaNominalPct: finalAliquotaPct,
      aliquotaEfetivaPct: finalEfetivaPct,
      percentualReducaoPct,
      inGrupoReducao,
      tributoCalculado: finalCalculado,
      tributoDevido: finalDevido,
      valorDiferimento: resultadoValorDiferimento,
      percentualDiferimentoPct,
      memoria,
    };
  }

  private applyCompraGovernamentalTransfer(
    tpEnteGov: 1 | 2 | 3 | 4,
    refDate: string,
    cbs: CbsIbsComponentCalc,
    ibsUf: CbsIbsComponentCalc,
    ibsMun: CbsIbsComponentCalc,
  ): void {
    const year = Number(refDate.slice(0, 4));
    if (year < 2027) {
      return;
    }

    const pTransfCbs = this.repo.getTransferenciaCbs(refDate);
    if (pTransfCbs === null) {
      throw new EngineValidationError(
        'CAL-009',
        `Percentual de transferência da CBS para compra governamental não encontrado em ${refDate}.`,
      );
    }

    cbs.inGrupoReducao = true;
    ibsUf.inGrupoReducao = true;
    ibsMun.inGrupoReducao = true;

    const totalAliq = cbs.aliquotaEfetivaPct
      .plus(ibsUf.aliquotaEfetivaPct)
      .plus(ibsMun.aliquotaEfetivaPct);
    const totalTrib = cbs.tributoDevido.plus(ibsUf.tributoDevido).plus(ibsMun.tributoDevido);

    if (tpEnteGov === 1) {
      // União absorve IBS UF e IBS Mun
      cbs.aliquotaEfetivaPct = totalAliq;
      cbs.tributoDevido = totalTrib;
      ibsUf.aliquotaEfetivaPct = new FiscalDecimal(0);
      ibsUf.tributoDevido = new FiscalDecimal(0);
      ibsMun.aliquotaEfetivaPct = new FiscalDecimal(0);
      ibsMun.tributoDevido = new FiscalDecimal(0);
    } else {
      const pTransfDec = divideBy100(pTransfCbs);
      const aliqTransf = cbs.aliquotaEfetivaPct.mul(pTransfDec);
      const tribTransf = cbs.tributoDevido.mul(pTransfDec);

      cbs.aliquotaEfetivaPct = cbs.aliquotaEfetivaPct.minus(aliqTransf);
      cbs.tributoDevido = cbs.tributoDevido.minus(tribTransf);

      const destinoAliq = aliqTransf.plus(ibsUf.aliquotaEfetivaPct).plus(ibsMun.aliquotaEfetivaPct);
      const destinoTrib = tribTransf.plus(ibsUf.tributoDevido).plus(ibsMun.tributoDevido);

      if (tpEnteGov === 2 || tpEnteGov === 3) {
        // Estado / DF absorve Município + fração CBS
        ibsUf.aliquotaEfetivaPct = destinoAliq;
        ibsUf.tributoDevido = destinoTrib;
        ibsMun.aliquotaEfetivaPct = new FiscalDecimal(0);
        ibsMun.tributoDevido = new FiscalDecimal(0);
      } else {
        // Município absorve UF + fração CBS
        ibsUf.aliquotaEfetivaPct = new FiscalDecimal(0);
        ibsUf.tributoDevido = new FiscalDecimal(0);
        ibsMun.aliquotaEfetivaPct = destinoAliq;
        ibsMun.tributoDevido = destinoTrib;
      }
    }

    cbs.memoria.aliquotaEfetiva = formatRate(cbs.aliquotaEfetivaPct);
    cbs.memoria.valorDevido = formatCurrency(cbs.tributoDevido);
    ibsUf.memoria.aliquotaEfetiva = formatRate(ibsUf.aliquotaEfetivaPct);
    ibsUf.memoria.valorDevido = formatCurrency(ibsUf.tributoDevido);
    ibsMun.memoria.aliquotaEfetiva = formatRate(ibsMun.aliquotaEfetivaPct);
    ibsMun.memoria.valorDevido = formatCurrency(ibsMun.tributoDevido);
  }

  private getNominalRateForTribute(
    tributeId: 2 | 3 | 4,
    item: OperacaoItemInput,
  ): DecimalInput | null {
    const a = item.aliquotasNominais;
    if (!a) {
      return null;
    }
    if (tributeId === TRIBUTE_CBS) return a.pCBS ?? null;
    if (tributeId === TRIBUTE_IBS_UF) return a.pIBSUF ?? null;
    return a.pIBSMun ?? null;
  }

  private validateUfBySigla(sigla: string): number {
    const row = this.db
      .prepare('SELECT UF_CD AS ufCd FROM UF WHERE UPPER(UF_SIGLA) = UPPER(?) LIMIT 1')
      .get(sigla) as { ufCd: number } | undefined;
    if (!row) {
      throw new EngineValidationError('REG-020', `UF '${sigla}' não encontrada.`, 'uf');
    }
    return row.ufCd;
  }

  private validateUfByCode(ufCd: number): string {
    const row = this.db
      .prepare('SELECT UF_SIGLA AS sigla FROM UF WHERE UF_CD = ? LIMIT 1')
      .get(ufCd) as { sigla: string } | undefined;
    if (!row) {
      throw new EngineValidationError('REG-020', `UF de código ${ufCd} não encontrada.`, 'ufCd');
    }
    return row.sigla;
  }

  private validateMunicipio(
    muniCd: number,
    ufSigla?: string,
    ufCd?: number | null,
  ): { muniCd: number; ufCd: number; ufSigla: string } {
    const row = this.db
      .prepare(
        `SELECT m.MUNI_CD AS muniCd, m.MUNI_UF_CD AS ufCd, u.UF_SIGLA AS ufSigla
         FROM MUNICIPIO m
         JOIN UF u ON u.UF_CD = m.MUNI_UF_CD
         WHERE m.MUNI_CD = ?
         LIMIT 1`,
      )
      .get(muniCd) as { muniCd: number; ufCd: number; ufSigla: string } | undefined;

    if (!row) {
      throw new EngineValidationError(
        'REG-019',
        `Município de código ${muniCd} não encontrado.`,
        'municipio',
      );
    }

    if (ufSigla) {
      this.validateUfBySigla(ufSigla);
      if (row.ufSigla.toUpperCase() !== ufSigla.toUpperCase()) {
        throw new EngineValidationError(
          'REG-018',
          `Município ${muniCd} pertence à UF '${row.ufSigla}' e não à UF '${ufSigla}'.`,
          'municipio',
        );
      }
    }

    if (ufCd !== undefined && ufCd !== null) {
      this.validateUfByCode(ufCd);
      if (row.ufCd !== ufCd) {
        throw new EngineValidationError(
          'REG-018',
          `Município ${muniCd} pertence à UF ${row.ufCd} e não à UF ${ufCd}.`,
          'municipio',
        );
      }
    }

    return row;
  }

  private resolveTipoDfe(tipoDfe: string | number, refDate: string): ResolvedTipoDfe {
    const raw = `${tipoDfe}`.trim();
    const row = /^\d+$/.test(raw)
      ? (this.db
          .prepare(
            `SELECT TPDF_ID AS id, TPDF_TIPO AS tipo, TPDF_SIGLA AS sigla
             FROM TIPO_DFE
             WHERE TPDF_TIPO = ?
               AND TPDF_INICIO_VIGENCIA <= ?
               AND (TPDF_FIM_VIGENCIA IS NULL OR TPDF_FIM_VIGENCIA >= ?)
             LIMIT 1`,
          )
          .get(Number.parseInt(raw, 10), refDate, refDate) as
          | { id: number; tipo: number; sigla: string }
          | undefined)
      : (this.db
          .prepare(
            `SELECT TPDF_ID AS id, TPDF_TIPO AS tipo, TPDF_SIGLA AS sigla
             FROM TIPO_DFE
             WHERE UPPER(REPLACE(REPLACE(REPLACE(TPDF_SIGLA, ' ', ''), '-', ''), '_', '')) = ?
               AND TPDF_INICIO_VIGENCIA <= ?
               AND (TPDF_FIM_VIGENCIA IS NULL OR TPDF_FIM_VIGENCIA >= ?)
             LIMIT 1`,
          )
          .get(normalizeSiglaDfe(raw), refDate, refDate) as
          | { id: number; tipo: number; sigla: string }
          | undefined);

    if (!row) {
      throw new EngineValidationError(
        'REG-028',
        `Tipo de documento fiscal '${raw}' não encontrado ou fora de vigência em ${refDate}.`,
        'tpDoc',
      );
    }

    const siglaNormalizada = normalizeSiglaDfe(row.sigla);
    if (SEM_TRATAMENTO_CALCULADORA_SIGLAS.has(siglaNormalizada)) {
      throw new EngineValidationError(
        'CAL-007',
        `Tipo de documento fiscal ${row.tipo} (${row.sigla}) não possui tratamento implementado na Calculadora.`,
        'tpDoc',
        'NAO_IMPLEMENTADO',
      );
    }

    return { ...row, siglaNormalizada };
  }

  private existsNcm(ncm: string, refDate: string): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM NCM
           WHERE NCM_CD = ?
             AND NCM_INICIO_VIGENCIA <= ?
             AND (NCM_FIM_VIGENCIA IS NULL OR NCM_FIM_VIGENCIA >= ?)
           LIMIT 1`,
        )
        .get(ncm, refDate, refDate) !== undefined
    );
  }

  private existsNbs(nbs: string, refDate: string): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM NBS
           WHERE NBS_CD = ?
             AND NBS_INICIO_VIGENCIA <= ?
             AND (NBS_FIM_VIGENCIA IS NULL OR NBS_FIM_VIGENCIA >= ?)
           LIMIT 1`,
        )
        .get(nbs, refDate, refDate) !== undefined
    );
  }

  private lookupSituacaoTributaria(
    cst: string,
    tributeId: number,
    refDate: string,
  ): SituacaoTributariaRow | null {
    const list = this.repo.lookupSituacoesTributarias(tributeId, refDate);
    return list.find((row) => row.cst === cst) ?? null;
  }

  private checkTipoDfeLink(tpdfId: number, cltrId: number, refDate: string): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1
           FROM TIPO_DFE_CLASSIFICACAO
           WHERE TDCL_TPDF_ID = ?
             AND TDCL_CLTR_ID = ?
             AND TDCL_INICIO_VIGENCIA <= ?
             AND (TDCL_FIM_VIGENCIA IS NULL OR TDCL_FIM_VIGENCIA >= ?)
           LIMIT 1`,
        )
        .get(tpdfId, cltrId, refDate, refDate) !== undefined
    );
  }

  private hasNomenclatureAnnex(kind: 'ncm' | 'nbs', cltrId: number, refDate: string): boolean {
    const sql =
      kind === 'ncm'
        ? `SELECT 1 FROM NCM_APLICAVEL
           WHERE NCMA_CLTR_ID = ?
             AND NCMA_INICIO_VIGENCIA <= ?
             AND (NCMA_FIM_VIGENCIA IS NULL OR NCMA_FIM_VIGENCIA >= ?)
           LIMIT 1`
        : `SELECT 1 FROM NBS_APLICAVEL
           WHERE NBSA_CLTR_ID = ?
             AND NBSA_INICIO_VIGENCIA <= ?
             AND (NBSA_FIM_VIGENCIA IS NULL OR NBSA_FIM_VIGENCIA >= ?)
           LIMIT 1`;
    return this.db.prepare(sql).get(cltrId, refDate, refDate) !== undefined;
  }

  private lookupIsAdValorem(
    kind: 'ncm' | 'nbs',
    code: string,
    refDate: string,
  ): { exists: boolean; valor: number | null } {
    const s = IS_AD_VALOREM_SPECS[kind];
    const row = this.db
      .prepare(
        `SELECT adv.AADV_VALOR AS valor
         FROM ${s.table} a
         JOIN ALIQUOTA_AD_VALOREM adv ON adv.AADV_ID = a.${s.advCol}
         WHERE EXISTS (SELECT 1 FROM ${s.refTable} r WHERE r.${s.refCodeCol} = ?)
           AND a.${s.codeCol} = SUBSTR(?, 1, LENGTH(a.${s.codeCol}))
           AND adv.AADV_TBTO_ID = 1
           AND a.${s.startCol} <= ?
           AND (a.${s.endCol} IS NULL OR a.${s.endCol} >= ?)
           AND NOT EXISTS (
             SELECT 1 FROM ${s.excTable} e
             WHERE e.${s.excCodeCol} = SUBSTR(?, 1, LENGTH(e.${s.excCodeCol}))
               AND e.${s.excFkCol} = a.${s.idCol}
               AND e.${s.excStartCol} <= ?
               AND (e.${s.excEndCol} IS NULL OR e.${s.excEndCol} >= ?)
           )
           AND NOT EXISTS (
             SELECT 1 FROM ${s.excTable} e
             WHERE e.${s.excCodeCol} = SUBSTR(a.${s.codeCol}, 1, LENGTH(e.${s.excCodeCol}))
               AND e.${s.excFkCol} = a.${s.idCol}
               AND e.${s.excStartCol} <= ?
               AND (e.${s.excEndCol} IS NULL OR e.${s.excEndCol} >= ?)
           )
         ORDER BY LENGTH(a.${s.codeCol}) DESC
         LIMIT 1`,
      )
      .get(code, code, refDate, refDate, code, refDate, refDate, refDate, refDate) as
      | { valor: number | null }
      | undefined;

    return row ? { exists: true, valor: row.valor } : { exists: false, valor: null };
  }

  private lookupIsAdRemNcm(
    ncm: string,
    refDate: string,
  ): { valor: number | null; unidade: string | null } | null {
    const row = this.db
      .prepare(
        `SELECT adr.AARE_VALOR AS valor, u.UNMD_SIGLA AS unidade
         FROM ALIQUOTA_AD_REM_PRODUTO a
         JOIN ALIQUOTA_AD_REM adr ON adr.AARE_ID = a.AARP_AARE_ID
         LEFT JOIN UNIDADE_MEDIDA u ON u.UNMD_ID = adr.AARE_UNMD_ID
         WHERE EXISTS (SELECT 1 FROM NCM n WHERE n.NCM_CD = ?)
           AND a.AARP_NCM_CD = SUBSTR(?, 1, LENGTH(a.AARP_NCM_CD))
           AND adr.AARE_TBTO_ID = 1
           AND a.AARP_INICIO_VIGENCIA <= ?
           AND (a.AARP_FIM_VIGENCIA IS NULL OR a.AARP_FIM_VIGENCIA >= ?)
           AND NOT EXISTS (
             SELECT 1 FROM EXCECAO_AD_REM_PRODUTO e
             WHERE e.EARP_NCM_CD = SUBSTR(?, 1, LENGTH(e.EARP_NCM_CD))
               AND e.EARP_AARP_ID = a.AARP_ID
               AND e.EARP_INICIO_VIGENCIA <= ?
               AND (e.EARP_FIM_VIGENCIA IS NULL OR e.EARP_FIM_VIGENCIA >= ?)
           )
           AND NOT EXISTS (
             SELECT 1 FROM EXCECAO_AD_REM_PRODUTO e
             WHERE e.EARP_NCM_CD = SUBSTR(a.AARP_NCM_CD, 1, LENGTH(e.EARP_NCM_CD))
               AND e.EARP_AARP_ID = a.AARP_ID
               AND e.EARP_INICIO_VIGENCIA <= ?
               AND (e.EARP_FIM_VIGENCIA IS NULL OR e.EARP_FIM_VIGENCIA >= ?)
           )
         ORDER BY LENGTH(a.AARP_NCM_CD) DESC
         LIMIT 1`,
      )
      .get(ncm, ncm, refDate, refDate, ncm, refDate, refDate, refDate, refDate) as
      | { valor: number | null; unidade: string | null }
      | undefined;

    return row ?? null;
  }

  private lookupUniformeSetorialNbs(
    nbs: string,
    tributeId: number,
    cltrId: number,
    refDate: string,
  ): number | null {
    const row = this.db
      .prepare(
        `SELECT adv.AADV_VALOR AS valor
         FROM ALIQUOTA_AD_VALOREM_SERVICO a
         JOIN ALIQUOTA_AD_VALOREM adv ON adv.AADV_ID = a.AAVS_AADV_ID
         WHERE EXISTS (SELECT 1 FROM NBS n WHERE n.NBS_CD = ?)
           AND a.AAVS_NBS_CD = SUBSTR(?, 1, LENGTH(a.AAVS_NBS_CD))
           AND adv.AADV_TBTO_ID = ?
           AND adv.AADV_CLTR_ID = ?
           AND a.AAVS_INICIO_VIGENCIA <= ?
           AND (a.AAVS_FIM_VIGENCIA IS NULL OR a.AAVS_FIM_VIGENCIA >= ?)
         ORDER BY LENGTH(a.AAVS_NBS_CD) DESC
         LIMIT 1`,
      )
      .get(nbs, nbs, tributeId, cltrId, refDate, refDate) as { valor: number | null } | undefined;

    return row?.valor ?? null;
  }

  private lookupAliquotaPorClassificacao(
    tributeId: number,
    cltrId: number,
    refDate: string,
  ): number | null {
    const row = this.db
      .prepare(
        `SELECT AADV_VALOR AS valor
         FROM ALIQUOTA_AD_VALOREM
         WHERE AADV_TBTO_ID = ?
           AND AADV_CLTR_ID = ?
           AND AADV_INICIO_VIGENCIA <= ?
           AND (AADV_FIM_VIGENCIA IS NULL OR AADV_FIM_VIGENCIA >= ?)
         ORDER BY AADV_INICIO_VIGENCIA DESC
         LIMIT 1`,
      )
      .get(tributeId, cltrId, refDate, refDate) as { valor: number | null } | undefined;

    return row?.valor ?? null;
  }
}

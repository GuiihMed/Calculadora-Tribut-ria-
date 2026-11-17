import type Database from 'better-sqlite3';
import type { Decimal } from 'decimal.js';
import {
  divideBy100,
  FiscalDecimal,
  formatCurrency,
  formatRate,
  multiplyInternal,
  subtractInternal,
  totalizeExact,
} from '../../shared/rounding.js';
import type {
  CreditIndicators,
  DecimalInput,
  EstadoItem,
  FiscalErrorItem,
  FundamentacaoLegal,
  MemoriaCalculoTributo,
  ModoFatorR,
  ObservabilidadeSimplesItemOutput,
  ObservabilidadeSimplesOutput,
  OperacaoSimplesInput,
  OperacaoSimplesItemInput,
  SplitPaymentGuidance,
} from '../../shared/types/fiscal.js';
import {
  type AtividadeSimplesRow,
  type ClassificacaoTributariaRow,
  DadosAbertosRepository,
  type RegimeApuracaoSimplesRow,
  type TipoReceitaBrutaSimplesRow,
} from '../db/dados-abertos-repo.js';
import { lookupErrorDescription } from './error-catalog.js';

const TRIBUTE_CBS = 2;
const TPDOCS_SEM_TRATAMENTO_CALCULADORA = new Set([77, 94]);

interface SplitTaxValue {
  devido: Decimal;
  pendenteSuspenso: Decimal;
}

interface ItemCalcResult {
  output: ObservabilidadeSimplesItemOutput;
  unroundedVBC: Decimal | null;
  unroundedVIBSSN: Decimal | null;
  unroundedVCBSSN: Decimal | null;
  unroundedVIBSPendSusp: Decimal | null;
  unroundedVCBSPendSusp: Decimal | null;
  unroundedTotalItem: Decimal | null;
}

function makeVsnError(
  code: string,
  detail: string,
  pointer: string,
): { error: FiscalErrorItem; estado: EstadoItem } {
  const entry = lookupErrorDescription(code);
  return {
    error: {
      code,
      title: entry?.titulo ?? 'Erro de validação Simples Nacional',
      description: detail,
      pointer,
      severity: 'error',
    },
    estado: entry?.estadoDefault ?? 'INCONSISTENCIA_ENTRADA',
  };
}

function parseCalendarDate(dhFatoGerador: string | undefined): string | null {
  if (typeof dhFatoGerador !== 'string' || !dhFatoGerador.trim()) {
    return null;
  }
  const datePart = dhFatoGerador.trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) {
    return null;
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
    return null;
  }
  return datePart;
}

function parseNonNegativeDecimal(
  raw: DecimalInput | null | undefined,
): { present: boolean; value: Decimal | null; invalid: boolean } {
  if (raw === undefined || raw === null) {
    return { present: false, value: null, invalid: false };
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) {
      return { present: true, value: null, invalid: true };
    }
    return { present: true, value: new FiscalDecimal(raw), invalid: false };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { present: false, value: null, invalid: false };
    }
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { present: true, value: null, invalid: true };
    }
    const dec = new FiscalDecimal(trimmed);
    if (dec.isNegative()) {
      return { present: true, value: null, invalid: true };
    }
    return { present: true, value: dec, invalid: false };
  }
  return { present: true, value: null, invalid: true };
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
      'LC 214/2025, arts. 31 a 35 — Orientação qualitativa baseada exclusivamente nos débitos calculados de CBS e IBS no Simples Nacional.',
  };
}

function zeroTotals() {
  return {
    vBC: '0.00',
    vIBSSN: '0.00',
    vCBSSN: '0.00',
    vIBSPendSusp: '0.00',
    vCBSPendSusp: '0.00',
    totalGeral: '0.00',
  };
}

function repartirPorRegime(
  regime: RegimeApuracaoSimplesRow,
  valor: Decimal,
  pendenteSuspenso: boolean,
): SplitTaxValue {
  const destino = pendenteSuspenso ? regime.destinoPendenteSuspenso : regime.destinoDevido;
  switch (destino) {
    case 'DEVIDO':
      return { devido: valor, pendenteSuspenso: new FiscalDecimal(0) };
    case 'PENDENTE_SUSPENSO':
      return { devido: new FiscalDecimal(0), pendenteSuspenso: valor };
    case 'ZERO':
      return { devido: new FiscalDecimal(0), pendenteSuspenso: new FiscalDecimal(0) };
  }
}

/**
 * Deterministic Simples Nacional calculation engine following RFB NT 2026.005 v1.00.
 * Mirrors `SimplesNacionalObservabilidadeService` and `SimplesNacionalCalculoService`
 * over `rtc-oficial.db`.
 */
export class SimplesNacionalEngine {
  private readonly repo: DadosAbertosRepository;

  constructor(
    private readonly db: Database.Database,
    repo?: DadosAbertosRepository,
  ) {
    this.repo = repo ?? new DadosAbertosRepository(db);
  }

  calculate(operacao: OperacaoSimplesInput): ObservabilidadeSimplesOutput {
    const errosGlobais: FiscalErrorItem[] = [];
    const avisosGlobais: string[] = [];

    const safeTpDoc = typeof operacao?.tpDoc === 'number' ? operacao.tpDoc : 0;
    const safeCrt = (
      operacao?.CRT === 1 || operacao?.CRT === 2 || operacao?.CRT === 3 ? operacao.CRT : 1
    ) as 1 | 2 | 3;

    const emptyErrorOutput = (): ObservabilidadeSimplesOutput => ({
      dhFatoGerador: operacao?.dhFatoGerador ?? '',
      tpDoc: safeTpDoc,
      CRT: safeCrt,
      tpRegimeIBSCBS: operacao?.tpRegimeIBSCBS ?? null,
      tpEnteGov: operacao?.tpEnteGov ?? null,
      errosGlobais,
      avisos: avisosGlobais,
      itens: [],
      totais: zeroTotals(),
    });

    const refDate = parseCalendarDate(operacao?.dhFatoGerador);
    if (refDate === null) {
      errosGlobais.push(
        makeVsnError(
          'VSN-012',
          `Data do fato gerador ausente ou inválida: '${operacao?.dhFatoGerador ?? ''}'. Esperado YYYY-MM-DD.`,
          '#/dhFatoGerador',
        ).error,
      );
      return emptyErrorOutput();
    }

    // Validate tpDoc
    const tpDoc = operacao.tpDoc;
    if (tpDoc === undefined || tpDoc === null || !Number.isInteger(tpDoc)) {
      errosGlobais.push(
        makeVsnError(
          'VSN-014',
          'O tipo de documento fiscal (tpDoc) é obrigatório e não foi informado.',
          '#/tpDoc',
        ).error,
      );
    } else if (TPDOCS_SEM_TRATAMENTO_CALCULADORA.has(tpDoc)) {
      errosGlobais.push(
        makeVsnError(
          'VSN-015',
          `Tipo de documento fiscal (tpDoc) ${tpDoc} ainda não possui tratamento implementado no cálculo do Simples Nacional.`,
          '#/tpDoc',
        ).error,
      );
    } else if (!this.repo.isTipoDfeHabilitadoSimples(tpDoc, refDate)) {
      errosGlobais.push(
        makeVsnError(
          'VSN-015',
          `Tipo de documento fiscal (tpDoc) ${tpDoc} não está habilitado para o cálculo do Simples Nacional na data '${refDate}'.`,
          '#/tpDoc',
        ).error,
      );
    }

    // Validate CRT and tpRegimeIBSCBS scope (regras C21a-10/20/30)
    const rawCrt = operacao.CRT as number | undefined;
    const rawTpRegime = operacao.tpRegimeIBSCBS as number | null | undefined;
    const tpRegimeInformado = rawTpRegime !== undefined && rawTpRegime !== null;

    let scopeInCalculableRange = false;
    if (rawCrt === undefined || rawCrt === null || !Number.isInteger(rawCrt) || rawCrt < 1 || rawCrt > 4) {
      errosGlobais.push(
        makeVsnError(
          'VSN-016',
          `O Código de Regime Tributário (CRT) é obrigatório e deve ser 1, 2, 3 ou 4; recebido: '${String(rawCrt)}'.`,
          '#/CRT',
        ).error,
      );
    } else if (tpRegimeInformado && (!Number.isInteger(rawTpRegime) || (rawTpRegime !== 1 && rawTpRegime !== 2))) {
      errosGlobais.push(
        makeVsnError(
          'VSN-017',
          `Tipo de regime de apuração do IBS/CBS (tpRegimeIBSCBS) inválido: '${String(rawTpRegime)}' (esperado 1 ou 2).`,
          '#/tpRegimeIBSCBS',
        ).error,
      );
    } else {
      let hasScopeRejection = false;
      if (rawCrt === 4 && tpRegimeInformado) {
        errosGlobais.push(
          makeVsnError(
            'VSN-018',
            'CRT=4 (MEI) não admite tpRegimeIBSCBS algum (regra C21a-30 da NT 2026.005).',
            '#/tpRegimeIBSCBS',
          ).error,
        );
        hasScopeRejection = true;
      } else if ((rawCrt === 1 || rawCrt === 2) && rawTpRegime === 2) {
        errosGlobais.push(
          makeVsnError(
            'VSN-018',
            `CRT=${rawCrt} não admite tpRegimeIBSCBS=2 (regra C21a-10 da NT 2026.005).`,
            '#/tpRegimeIBSCBS',
          ).error,
        );
        hasScopeRejection = true;
      } else if (rawCrt === 3 && rawTpRegime === 1) {
        errosGlobais.push(
          makeVsnError(
            'VSN-018',
            'CRT=3 não admite tpRegimeIBSCBS=1 (regra C21a-20 da NT 2026.005).',
            '#/tpRegimeIBSCBS',
          ).error,
        );
        hasScopeRejection = true;
      }

      if (rawCrt === 4) {
        errosGlobais.push(
          makeVsnError(
            'VSN-019',
            'Operação fora do escopo do cálculo assistido do Simples Nacional: MEI (CRT=4).',
            '#/CRT',
          ).error,
        );
        hasScopeRejection = true;
      }
      if (rawTpRegime === 1) {
        errosGlobais.push(
          makeVsnError(
            'VSN-019',
            'Operação fora do escopo do cálculo assistido do Simples Nacional: optante pelo regime regular do IBS/CBS (tpRegimeIBSCBS=1).',
            '#/tpRegimeIBSCBS',
          ).error,
        );
        hasScopeRejection = true;
      }
      if (rawCrt === 3 && !tpRegimeInformado) {
        errosGlobais.push(
          makeVsnError(
            'VSN-019',
            'Operação fora do escopo do cálculo assistido do Simples Nacional: CRT=3 sem tpRegimeIBSCBS=2 (regime normal puro).',
            '#/CRT',
          ).error,
        );
        hasScopeRejection = true;
      }

      scopeInCalculableRange = !hasScopeRejection;
    }

    // Validate tpEnteGov
    const rawTpEnteGov = operacao.tpEnteGov as number | null | undefined;
    let tpEnteGov: 1 | 2 | 3 | 4 | null = null;
    if (rawTpEnteGov !== undefined && rawTpEnteGov !== null) {
      if (!Number.isInteger(rawTpEnteGov) || rawTpEnteGov < 1 || rawTpEnteGov > 4) {
        errosGlobais.push(
          makeVsnError(
            'VSN-024',
            `Tipo de ente governamental (tpEnteGov) inválido: '${String(rawTpEnteGov)}' (esperado 1, 2, 3 ou 4).`,
            '#/tpEnteGov',
          ).error,
        );
      } else {
        tpEnteGov = rawTpEnteGov as 1 | 2 | 3 | 4;
      }
    }

    // Validate itens non-empty
    const itensInput = Array.isArray(operacao.itens) ? operacao.itens : [];
    if (itensInput.length === 0) {
      errosGlobais.push(
        makeVsnError(
          'VSN-011',
          'A lista de itens da operação é obrigatória e não pode estar vazia.',
          '#/itens',
        ).error,
      );
    }

    // Resolve regime matrix row when scope is in calculable range
    let regime: RegimeApuracaoSimplesRow | null = null;
    if (scopeInCalculableRange) {
      const lookupTpRegime = rawCrt === 3 ? 2 : null;
      regime = this.repo.getRegimeApuracaoSimples(rawCrt as number, lookupTpRegime, refDate);
      if (!regime) {
        errosGlobais.push(
          makeVsnError(
            'VSN-026',
            `Não há parametrização de regime de apuração do Simples Nacional vigente para CRT=${rawCrt} e tpRegimeIBSCBS=${rawTpRegime ?? 'null'} na data '${refDate}'.`,
            '#/CRT',
          ).error,
        );
      }
    }

    // Resolve compra gov transition factor when tpEnteGov is 2, 3, or 4
    let fatorTransicaoCompraGov: Decimal | null = null;
    if (tpEnteGov !== null && tpEnteGov !== 1) {
      const fator = this.repo.getFatorTransicaoCompraGovSimples(refDate);
      if (fator === null) {
        errosGlobais.push(
          makeVsnError(
            'VSN-025',
            `Não há parametrização de transição de compra governamental vigente para a data '${refDate}'.`,
            '#/dhFatoGerador',
          ).error,
        );
      } else {
        fatorTransicaoCompraGov = new FiscalDecimal(fator);
      }
    }

    if (errosGlobais.length > 0 || !regime) {
      return emptyErrorOutput();
    }

    const atividades = this.repo.getAtividadesSimples(refDate);
    const atividadesByCode = new Map<string, AtividadeSimplesRow>(
      atividades.map((a) => [a.cAtivSN, a]),
    );

    const itemResults: ItemCalcResult[] = itensInput.map((item, idx) =>
      this.processItem(
        item,
        idx,
        refDate,
        tpDoc,
        regime,
        tpEnteGov,
        fatorTransicaoCompraGov,
        atividadesByCode,
      ),
    );

    const calculados = itemResults.filter((r) => r.output.estadoItem === 'CALCULADO');
    const totalVBC = totalizeExact(calculados.map((r) => r.unroundedVBC ?? 0));
    const totalVIBSSN = totalizeExact(calculados.map((r) => r.unroundedVIBSSN ?? 0));
    const totalVCBSSN = totalizeExact(calculados.map((r) => r.unroundedVCBSSN ?? 0));
    const totalVIBSPendSusp = totalizeExact(calculados.map((r) => r.unroundedVIBSPendSusp ?? 0));
    const totalVCBSPendSusp = totalizeExact(calculados.map((r) => r.unroundedVCBSPendSusp ?? 0));
    const totalGeral = totalizeExact(calculados.map((r) => r.unroundedTotalItem ?? 0));

    return {
      dhFatoGerador: operacao.dhFatoGerador,
      tpDoc,
      CRT: safeCrt,
      tpRegimeIBSCBS: operacao.tpRegimeIBSCBS ?? null,
      tpEnteGov,
      errosGlobais: [],
      avisos: avisosGlobais,
      itens: itemResults.map((r) => r.output),
      totais: {
        vBC: formatCurrency(totalVBC),
        vIBSSN: formatCurrency(totalVIBSSN),
        vCBSSN: formatCurrency(totalVCBSSN),
        vIBSPendSusp: formatCurrency(totalVIBSPendSusp),
        vCBSPendSusp: formatCurrency(totalVCBSPendSusp),
        totalGeral: formatCurrency(totalGeral),
      },
      splitPaymentGuidance: buildSplitPaymentGuidance(totalVCBSSN, totalVIBSSN),
    };
  }

  private processItem(
    item: OperacaoSimplesItemInput,
    index: number,
    refDate: string,
    tpDoc: number,
    regime: RegimeApuracaoSimplesRow,
    tpEnteGov: 1 | 2 | 3 | 4 | null,
    fatorTransicaoCompraGov: Decimal | null,
    atividadesByCode: Map<string, AtividadeSimplesRow>,
  ): ItemCalcResult {
    const nObj = item.nObj ?? index + 1;
    const cAtivSN = (item.cAtivSN ?? '').trim();
    const cClassTrib = (item.cClassTrib ?? '').trim();
    const erros: FiscalErrorItem[] = [];
    const avisos: string[] = [];

    const makeEmptyResult = (
      estadoItem: EstadoItem,
      modoFatorR: ModoFatorR,
      extra?: {
        vRBSNitem?: string;
        tpRBSN?: number;
        tpRBSNDescricao?: string;
        fundamentacoesLegais?: FundamentacaoLegal[];
        creditIndicators?: CreditIndicators | null;
      },
    ): ItemCalcResult => ({
      output: {
        nObj,
        estadoItem,
        ...(item.descricao ? { descricao: item.descricao } : {}),
        cAtivSN,
        cClassTrib,
        modoFatorR,
        ...(extra?.vRBSNitem !== undefined ? { vRBSNitem: extra.vRBSNitem } : {}),
        ...(extra?.tpRBSN !== undefined ? { tpRBSN: extra.tpRBSN } : {}),
        ...(extra?.tpRBSNDescricao !== undefined ? { tpRBSNDescricao: extra.tpRBSNDescricao } : {}),
        vBC: '0.00',
        pIBSSN: null,
        pCBSSN: null,
        vIBSSN: null,
        vCBSSN: null,
        vIBSPendSusp: null,
        vCBSPendSusp: null,
        totalItem: '0.00',
        erros,
        avisos,
        memoriaCalculo: [],
        fundamentacoesLegais: extra?.fundamentacoesLegais ?? [],
        creditIndicators: extra?.creditIndicators ?? null,
      },
      unroundedVBC: null,
      unroundedVIBSSN: null,
      unroundedVCBSSN: null,
      unroundedVIBSPendSusp: null,
      unroundedVCBSPendSusp: null,
      unroundedTotalItem: null,
    });

    // 0. Priority check: cClassTrib with TRTR_IN_POSSUI_AJUSTE = 1 -> NAO_IMPLEMENTADO (VSN-027)
    let classificacao: ClassificacaoTributariaRow | null = null;
    if (cClassTrib.length > 0) {
      classificacao = this.repo.lookupClassificacao(cClassTrib, TRIBUTE_CBS, refDate);
      if (classificacao) {
        const tratamento = this.repo.getTratamentoParaClassificacao(classificacao.cltrId, refDate);
        if (tratamento?.inPossuiAjuste) {
          erros.push(
            makeVsnError(
              'VSN-027',
              `A classificação tributária '${cClassTrib}' ainda não possui tratamento implementado no cálculo do Simples Nacional na data '${refDate}'.`,
              `#/itens/${index}/cClassTrib`,
            ).error,
          );
          return makeEmptyResult('NAO_IMPLEMENTADO', 'NAO_APLICAVEL');
        }
      }
    }

    // 1. Validate monetary inputs
    const baseParsed = parseNonNegativeDecimal(item.baseCalculo);
    if (!baseParsed.present) {
      erros.push(
        makeVsnError(
          'VSN-001',
          'A base de cálculo do Simples Nacional é obrigatória e não foi informada.',
          `#/itens/${index}/baseCalculo`,
        ).error,
      );
    } else if (baseParsed.invalid) {
      erros.push(
        makeVsnError(
          'VSN-002',
          `Base de cálculo inválida ou negativa: '${String(item.baseCalculo)}'.`,
          `#/itens/${index}/baseCalculo`,
        ).error,
      );
    }

    const isParsed = parseNonNegativeDecimal(item.valorImpostoSeletivo);
    if (isParsed.invalid) {
      erros.push(
        makeVsnError(
          'VSN-003',
          `Valor do Imposto Seletivo inválido ou negativo: '${String(item.valorImpostoSeletivo)}'.`,
          `#/itens/${index}/valorImpostoSeletivo`,
        ).error,
      );
    }
    const valorIs = isParsed.value ?? new FiscalDecimal(0);

    // 2. Resolve tpRBSN from cClassTrib
    let tipoReceita: TipoReceitaBrutaSimplesRow | null = null;
    if (!cClassTrib) {
      erros.push(
        makeVsnError(
          'VSN-020',
          'O código de classificação tributária (cClassTrib) é obrigatório e não foi informado.',
          `#/itens/${index}/cClassTrib`,
        ).error,
      );
    } else if (!classificacao) {
      erros.push(
        makeVsnError(
          'VSN-021',
          `O cClassTrib '${cClassTrib}' não existe ou não está vigente na data '${refDate}': o tpRBSN não pôde ser determinado.`,
          `#/itens/${index}/cClassTrib`,
        ).error,
      );
    } else if (!this.repo.checkTipoDfeCompat(String(tpDoc), classificacao.cltrId, refDate)) {
      erros.push(
        makeVsnError(
          'VSN-022',
          `O cClassTrib '${cClassTrib}' não é admissível para o tipo de documento fiscal ${tpDoc}.`,
          `#/itens/${index}/cClassTrib`,
        ).error,
      );
    } else {
      tipoReceita = this.repo.getTipoReceitaBrutaSimples(classificacao.tpRbsn, refDate);
      if (!tipoReceita) {
        erros.push(
          makeVsnError(
            'VSN-026',
            `Não há parametrização de efeito vigente para tpRBSN=${classificacao.tpRbsn} na data '${refDate}'.`,
            `#/itens/${index}/cClassTrib`,
          ).error,
        );
      }
    }

    // 3. Validate cAtivSN (missing/unknown/inadmissible => NAO_CALCULADO without error)
    let cAtivSNValido = false;
    let modoFatorR: ModoFatorR = 'NAO_APLICAVEL';
    if (cAtivSN.length > 0) {
      const atividade = atividadesByCode.get(cAtivSN);
      if (atividade) {
        modoFatorR = atividade.modoFatorR;
        const admissivel = this.repo.isAtividadeAdmissivelDocumentoSimples(
          atividade.atsnId,
          tpDoc,
          refDate,
        );
        if (admissivel) {
          cAtivSNValido = true;
          if (atividade.naoTributavel && tipoReceita?.vedadoNaoTributavel) {
            erros.push(
              makeVsnError(
                'VSN-023',
                `O código de atividade '${cAtivSN}' (Operações não Tributáveis) é incompatível com cClassTrib de tpRBSN=${tipoReceita.tpRbsn}.`,
                `#/itens/${index}/cAtivSN`,
              ).error,
            );
          }
        }
      }
    }

    // 4. Conditional effective rates (only required when used by calculation)
    const aliquotasExigidas = cAtivSNValido && tipoReceita !== null && tipoReceita.exigeAliquota;
    const pIbsExigida = aliquotasExigidas && regime.geraIbs;

    const pCbsParsed = parseNonNegativeDecimal(item.pCBSSN);
    if (!pCbsParsed.present) {
      if (aliquotasExigidas) {
        erros.push(
          makeVsnError(
            'VSN-004',
            'A alíquota efetiva de CBS do Simples Nacional (pCBSSN) é exigida para o cálculo do item e não foi informada.',
            `#/itens/${index}/pCBSSN`,
          ).error,
        );
      }
    } else if (pCbsParsed.invalid) {
      erros.push(
        makeVsnError(
          'VSN-005',
          `Alíquota pCBSSN inválida ou negativa: '${String(item.pCBSSN)}'.`,
          `#/itens/${index}/pCBSSN`,
        ).error,
      );
    }

    const pIbsParsed = parseNonNegativeDecimal(item.pIBSSN);
    if (!pIbsParsed.present) {
      if (pIbsExigida) {
        erros.push(
          makeVsnError(
            'VSN-006',
            'A alíquota efetiva de IBS do Simples Nacional (pIBSSN) é exigida para o cálculo do item e não foi informada.',
            `#/itens/${index}/pIBSSN`,
          ).error,
        );
      }
    } else if (pIbsParsed.invalid) {
      erros.push(
        makeVsnError(
          'VSN-007',
          `Alíquota pIBSSN inválida ou negativa: '${String(item.pIBSSN)}'.`,
          `#/itens/${index}/pIBSSN`,
        ).error,
      );
    }

    const fundamentacoesLegais = classificacao
      ? this.repo.getFundamentacoesLegais(classificacao.cltrId, refDate)
      : [];
    const creditIndicators = classificacao
      ? this.repo.getCreditIndicators(classificacao.cClassTrib, refDate)
      : null;

    if (erros.length > 0 || !tipoReceita || baseParsed.value === null) {
      return makeEmptyResult('INCONSISTENCIA_ENTRADA', modoFatorR, {
        fundamentacoesLegais,
        creditIndicators,
      });
    }

    // 5. Gross revenue of the item (NT 2026.005 P26)
    const baseCalculo = baseParsed.value;
    const vRBSNitem = tipoReceita.compoeReceita
      ? tipoReceita.isCompoeReceita
        ? totalizeExact([baseCalculo, valorIs])
        : baseCalculo
      : new FiscalDecimal(0);

    // 6. Short-circuit NAO_CALCULADO when cAtivSN is missing/unknown/inadmissible
    if (!cAtivSNValido) {
      avisos.push(
        'cAtivSN ausente, fora de vigência ou inadmissível para o tipo de documento: item não calculado (reportando apenas vRBSNitem e tpRBSN).',
      );
      return makeEmptyResult('NAO_CALCULADO', modoFatorR, {
        vRBSNitem: formatCurrency(vRBSNitem),
        tpRBSN: tipoReceita.tpRbsn,
        tpRBSNDescricao: tipoReceita.descricao,
        fundamentacoesLegais,
        creditIndicators,
      });
    }

    // 7. Compra governamental transformation pipeline (pRedutor is NOT applied in SN)
    const { pIbsEff, pCbsEff } = this.transformCompraGovRates(
      pIbsParsed.value,
      pCbsParsed.value,
      tpEnteGov,
      fatorTransicaoCompraGov,
    );

    // 8. Taxable base vBC & tax values
    const fatorReceita = new FiscalDecimal(tipoReceita.fatorReceita);
    const vBC = multiplyInternal(vRBSNitem, fatorReceita);

    const calcRawTax = (aliquota: Decimal | null): Decimal => {
      if (aliquota === null || fatorReceita.isZero()) {
        return new FiscalDecimal(0);
      }
      return multiplyInternal(multiplyInternal(vRBSNitem, fatorReceita), divideBy100(aliquota));
    };

    const valorIbs = calcRawTax(pIbsEff);
    const valorCbs = calcRawTax(pCbsEff);

    const ibs = regime.geraIbs
      ? repartirPorRegime(regime, valorIbs, tipoReceita.pendenteSuspenso)
      : null;
    const cbs = repartirPorRegime(regime, valorCbs, tipoReceita.pendenteSuspenso);

    const totalItem = totalizeExact([
      ibs ? ibs.devido : new FiscalDecimal(0),
      cbs.devido,
      valorIs,
    ]);

    const memoriaCalculo: MemoriaCalculoTributo[] = [];
    if (regime.geraIbs) {
      const pIbsFormatted = pIbsEff !== null ? formatRate(pIbsEff) : '0.00';
      memoriaCalculo.push({
        tributo: 'IBSSN',
        baseCalculo: formatCurrency(vBC),
        aliquotaNominal: pIbsFormatted,
        aliquotaEfetiva: pIbsFormatted,
        valorCalculado: formatCurrency(valorIbs),
        valorDevido: formatCurrency(ibs!.devido),
        expressaoAplicada: 'vBC * (pIBSSN / 100)',
        memoriaTexto: `IBSSN = ${formatCurrency(vBC)} × ${pIbsFormatted}% = ${formatCurrency(valorIbs)} (devido: ${formatCurrency(ibs!.devido)}, pendente/suspenso: ${formatCurrency(ibs!.pendenteSuspenso)})`,
      });
    }
    const pCbsFormatted = pCbsEff !== null ? formatRate(pCbsEff) : '0.00';
    memoriaCalculo.push({
      tributo: 'CBSSN',
      baseCalculo: formatCurrency(vBC),
      aliquotaNominal: pCbsFormatted,
      aliquotaEfetiva: pCbsFormatted,
      valorCalculado: formatCurrency(valorCbs),
      valorDevido: formatCurrency(cbs.devido),
      expressaoAplicada: 'vBC * (pCBSSN / 100)',
      memoriaTexto: `CBSSN = ${formatCurrency(vBC)} × ${pCbsFormatted}% = ${formatCurrency(valorCbs)} (devido: ${formatCurrency(cbs.devido)}, pendente/suspenso: ${formatCurrency(cbs.pendenteSuspenso)})`,
    });

    return {
      output: {
        nObj,
        estadoItem: 'CALCULADO',
        ...(item.descricao ? { descricao: item.descricao } : {}),
        cAtivSN,
        cClassTrib,
        modoFatorR,
        vRBSNitem: formatCurrency(vRBSNitem),
        tpRBSN: tipoReceita.tpRbsn,
        tpRBSNDescricao: tipoReceita.descricao,
        vBC: formatCurrency(vBC),
        pIBSSN: regime.geraIbs && pIbsEff !== null ? formatRate(pIbsEff) : null,
        pCBSSN: pCbsEff !== null ? formatRate(pCbsEff) : null,
        vIBSSN: ibs !== null ? formatCurrency(ibs.devido) : null,
        vCBSSN: formatCurrency(cbs.devido),
        vIBSPendSusp: ibs !== null ? formatCurrency(ibs.pendenteSuspenso) : null,
        vCBSPendSusp: formatCurrency(cbs.pendenteSuspenso),
        totalItem: formatCurrency(totalItem),
        erros: [],
        avisos,
        memoriaCalculo,
        fundamentacoesLegais,
        creditIndicators,
      },
      unroundedVBC: vBC,
      unroundedVIBSSN: ibs ? ibs.devido : new FiscalDecimal(0),
      unroundedVCBSSN: cbs.devido,
      unroundedVIBSPendSusp: ibs ? ibs.pendenteSuspenso : new FiscalDecimal(0),
      unroundedVCBSPendSusp: cbs.pendenteSuspenso,
      unroundedTotalItem: totalItem,
    };
  }

  private transformCompraGovRates(
    pIbs: Decimal | null,
    pCbs: Decimal | null,
    tpEnteGov: 1 | 2 | 3 | 4 | null,
    fatorTransicao: Decimal | null,
  ): { pIbsEff: Decimal | null; pCbsEff: Decimal | null } {
    // Step 1: pRedutor is deliberately NOT applied in Simples Nacional (NT 2026.005 §5.3.3).
    // Step 2: CBS <-> IBS rate displacement for public entity acquisitions (arts. 372 & 473).
    if (tpEnteGov === null || (pIbs === null && pCbs === null)) {
      return { pIbsEff: pIbs, pCbsEff: pCbs };
    }

    const pIbsVal = pIbs ?? new FiscalDecimal(0);
    const pCbsVal = pCbs ?? new FiscalDecimal(0);

    if (tpEnteGov === 1) {
      return {
        pIbsEff: new FiscalDecimal(0),
        pCbsEff: totalizeExact([pCbsVal, pIbsVal]),
      };
    }

    if (fatorTransicao === null) {
      throw new Error(`Fator de transição de compra governamental não resolvido para tpEnteGov=${tpEnteGov}`);
    }

    const pIbsEff = totalizeExact([pIbsVal, multiplyInternal(fatorTransicao, pCbsVal)]);
    const pCbsEff = multiplyInternal(subtractInternal(1, fatorTransicao), pCbsVal);
    return { pIbsEff, pCbsEff };
  }
}

import type { Decimal } from 'decimal.js';
import {
  FiscalDecimal,
  formatCurrency,
  totalizeExact,
} from '../../shared/rounding.js';
import type {
  CompareRegimesInput,
  CompareRegimesItemInput,
  CompareRegimesOutput,
  CreditIndicators,
  DecimalInput,
  FiscalErrorItem,
  ObservabilidadeRocOutput,
  ObservabilidadeSimplesOutput,
  OperacaoInput,
  OperacaoItemInput,
  OperacaoSimplesInput,
  OperacaoSimplesItemInput,
  RegimeComparisonScenario,
} from '../../shared/types/fiscal.js';
import type { RegimeRegularEngine } from './regime-regular-engine.js';
import type { SimplesNacionalEngine } from './simples-nacional-engine.js';

const SIMPLES_NT_2026_005_START_DATE = '2027-01-01';

function parseIsoCalendarDate(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  const datePart = raw.trim().slice(0, 10);
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

function tryParseFiscalDecimal(value: DecimalInput | undefined | null): Decimal | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new FiscalDecimal(value) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return null;
    }
    return new FiscalDecimal(trimmed);
  }
  return null;
}

function toRegimeRegularItem(item: CompareRegimesItemInput, index: number): OperacaoItemInput {
  const nObj = item.nObj ?? index + 1;

  let baseCalculo: DecimalInput | undefined = item.baseCalculo;
  let impostoSeletivo = item.impostoSeletivo;

  if (impostoSeletivo) {
    const bcIs = impostoSeletivo.baseCalculo ?? item.baseCalculo;
    impostoSeletivo = {
      ...impostoSeletivo,
      baseCalculo: bcIs,
    };

    const bcDec = tryParseFiscalDecimal(item.baseCalculo);
    const isInfDec = tryParseFiscalDecimal(impostoSeletivo.valorInformado);
    if (bcDec !== null && isInfDec !== null) {
      // CompareRegimesItemInput.baseCalculo represents the base BEFORE Imposto Seletivo.
      // When valorInformado is also passed to RegimeRegularEngine, REG-026 requires
      // item.baseCalculo == bcIS + valorInformado so (base - isInf + isCalc) == base + vIS.
      baseCalculo = bcDec.plus(isInfDec).toString();
    }
  }

  return {
    nObj,
    ...(item.descricao ? { descricao: item.descricao } : {}),
    ...(item.ncm ? { ncm: item.ncm } : {}),
    ...(item.nbs ? { nbs: item.nbs } : {}),
    cst: item.cst,
    cClassTrib: item.cClassTrib,
    ...(baseCalculo !== undefined ? { baseCalculo } : {}),
    ...(item.quantidade !== undefined ? { quantidade: item.quantidade } : {}),
    ...(item.unidade ? { unidade: item.unidade } : {}),
    aliquotasNominais: item.aliquotasNominais,
    ...(impostoSeletivo ? { impostoSeletivo } : {}),
  };
}

function summarizeRegimeRegularCredits(
  output: ObservabilidadeRocOutput,
  isHibrido: boolean,
): string {
  const indicators = output.itens
    .map((item) => item.creditIndicators)
    .filter((c): c is CreditIndicators => c !== null && c !== undefined);

  const prefix = isHibrido
    ? 'Apropriação integral B2B pelo adquirente (Simples Híbrido tpRegimeIBSCBS=1 / VSN-019): '
    : 'Apropriação integral B2B pelo adquirente no Regime Regular: ';

  if (indicators.length === 0) {
    return `${prefix}conforme classificação tributária (CLASSIFICACAO_TRIBUTARIA).`;
  }

  const anyCbs = indicators.some((c) => c.apropriacaoCreditoCbs);
  const anyIbs = indicators.some((c) => c.apropriacaoCreditoIbs);
  const anyPresumidoAdq = indicators.some((c) => c.creditoPresumidoAdquirente);
  const antecedents = [...new Set(indicators.map((c) => c.creditoOperacaoAntecedente).filter(Boolean))];

  const parts: string[] = [];
  if (anyCbs && anyIbs) {
    parts.push('CBS e IBS apropriáveis pelo adquirente');
  } else if (anyCbs) {
    parts.push('apenas CBS apropriável pelo adquirente');
  } else if (anyIbs) {
    parts.push('apenas IBS apropriável pelo adquirente');
  } else {
    parts.push('sem apropriação de crédito de CBS/IBS nesta classificação');
  }

  if (anyPresumidoAdq) {
    parts.push('com previsão de crédito presumido ao adquirente');
  }
  if (antecedents.length > 0) {
    parts.push(`operação antecedente: ${antecedents.join('/')}`);
  }

  return `${prefix}${parts.join('; ')}.`;
}

function collectRegimeRegularErrors(output: ObservabilidadeRocOutput): FiscalErrorItem[] {
  return [...output.errosGlobais, ...output.itens.flatMap((item) => item.erros)];
}

function collectSimplesErrors(output: ObservabilidadeSimplesOutput): FiscalErrorItem[] {
  return [...output.errosGlobais, ...output.itens.flatMap((item) => item.erros)];
}

export interface CompareRegimesCalculators {
  calculateRegimeRegular: (input: OperacaoInput) => Promise<ObservabilidadeRocOutput>;
  calculateSimplesNacional: (input: OperacaoSimplesInput) => Promise<ObservabilidadeSimplesOutput>;
}

const BASE_BRIDGE_NOTE =
  'Ponte de base com Imposto Seletivo (TRBS_IN_IS_COMPOE_RECEITA = 0): no Regime Regular, o IS compõe a base de cálculo de CBS/IBS (baseCalculo + vIS); no Simples Nacional, baseCalculo é mantida sem o IS e valorImpostoSeletivo é repassado separadamente sem compor a receita bruta interna.';

function checkCompareEligibility(input: CompareRegimesInput): CompareRegimesOutput | null {
  const refDate = parseIsoCalendarDate(input.dhFatoGerador);
  if (!refDate) {
    return {
      elegivel: false,
      motivoInelegibilidade: `Data do fato gerador inválida ('${input.dhFatoGerador}'). As tabelas do Simples Nacional (NT 2026.005 v1.00) iniciam em ${SIMPLES_NT_2026_005_START_DATE}.`,
      dhFatoGerador: input.dhFatoGerador,
      cenarios: [],
      avisos: [
        `Informe uma data válida no formato YYYY-MM-DD a partir de ${SIMPLES_NT_2026_005_START_DATE}.`,
      ],
    };
  }

  if (refDate < SIMPLES_NT_2026_005_START_DATE) {
    return {
      elegivel: false,
      motivoInelegibilidade: `As tabelas do Simples Nacional (NT 2026.005 v1.00) entram em vigência apenas em ${SIMPLES_NT_2026_005_START_DATE}. Para a data informada (${refDate}), o comparativo com o Simples Nacional não é elegível.`,
      dhFatoGerador: input.dhFatoGerador,
      cenarios: [],
      avisos: [
        `Simples Nacional NT 2026.005 v1.00 inicia vigência em ${SIMPLES_NT_2026_005_START_DATE}; operações anteriores utilizam apenas alíquotas de referência 2026 no Regime Regular.`,
      ],
    };
  }

  return null;
}

function buildRegimeRegularCompareInput(input: CompareRegimesInput): OperacaoInput {
  return {
    dhFatoGerador: input.dhFatoGerador,
    tipoDfe: input.tpDoc,
    ...(input.uf ? { uf: input.uf } : {}),
    ...(input.ufCd !== undefined ? { ufCd: input.ufCd } : {}),
    ...(input.municipio !== undefined ? { municipio: input.municipio } : {}),
    ...(input.tpEnteGov !== undefined ? { tpEnteGov: input.tpEnteGov } : {}),
    itens: input.itens.map((item, idx) => toRegimeRegularItem(item, idx)),
  };
}

function prepareAfterRegimeRegular(
  input: CompareRegimesInput,
  rrOutput: ObservabilidadeRocOutput,
) {
  const avisos: string[] = [];
  const hasAnyImpostoSeletivo = input.itens.some((item) => Boolean(item.impostoSeletivo));

  const rrTotalIS = rrOutput.ISTot?.vIS ?? '0.00';
  const rrTotalCBS = rrOutput.IBSCBSTot?.gCBS.vCBS ?? '0.00';
  const rrTotalIBS = rrOutput.IBSCBSTot?.gIBS.vIBS ?? '0.00';
  const rrTotalTributos = formatCurrency(totalizeExact([rrTotalIS, rrTotalCBS, rrTotalIBS]));

  const isValueByObj = new Map<number, string>();
  input.itens.forEach((item, idx) => {
    const nObj = item.nObj ?? idx + 1;
    const rrItem = rrOutput.itens.find((it) => it.nObj === nObj) ?? rrOutput.itens[idx];
    if (rrItem?.gIS?.vIS) {
      isValueByObj.set(nObj, rrItem.gIS.vIS);
    } else {
      const isInfDec = tryParseFiscalDecimal(item.impostoSeletivo?.valorInformado);
      if (isInfDec !== null) {
        isValueByObj.set(nObj, formatCurrency(isInfDec));
      }
    }
  });

  if (hasAnyImpostoSeletivo) {
    avisos.push(BASE_BRIDGE_NOTE);
  }
  if (rrOutput.xWarningDadosSimulados) {
    avisos.push(...rrOutput.avisos);
  }

  const rrErrors = collectRegimeRegularErrors(rrOutput);

  const regimeRegularScenario: RegimeComparisonScenario = {
    cenario: 'regime_regular',
    titulo: 'Regime Regular (Apuração Normal)',
    totalIS: rrTotalIS,
    totalCBS: rrTotalCBS,
    totalIBS: rrTotalIBS,
    totalTributos: rrTotalTributos,
    apropriacaoCreditoAdquirente: summarizeRegimeRegularCredits(rrOutput, false),
    observacoes: hasAnyImpostoSeletivo ? [BASE_BRIDGE_NOTE, ...rrOutput.avisos] : [...rrOutput.avisos],
    erros: rrErrors,
    detalhe: rrOutput,
  };

  const snItems: OperacaoSimplesItemInput[] = input.itens.map((item, idx) => {
    const nObj = item.nObj ?? idx + 1;
    const vIs = isValueByObj.get(nObj);
    return {
      nObj,
      ...(item.descricao ? { descricao: item.descricao } : {}),
      cAtivSN: item.cAtivSN,
      cClassTrib: item.cClassTrib,
      cst: item.cst,
      ...(item.tpRBSN !== undefined ? { tpRBSN: item.tpRBSN } : {}),
      baseCalculo: item.baseCalculo,
      ...(vIs !== undefined ? { valorImpostoSeletivo: vIs } : {}),
      pIBSSN: item.pIBSSN,
      pCBSSN: item.pCBSSN,
    };
  });

  const snCrt1Input: OperacaoSimplesInput = {
    dhFatoGerador: input.dhFatoGerador,
    tpDoc: input.tpDoc,
    CRT: 1,
    tpRegimeIBSCBS: null,
    ...(input.tpEnteGov !== undefined ? { tpEnteGov: input.tpEnteGov } : {}),
    itens: snItems,
  };

  const snCrt2Input: OperacaoSimplesInput | null = input.incluirSublimiteCrt2
    ? {
        ...snCrt1Input,
        CRT: 2,
        tpRegimeIBSCBS: null,
      }
    : null;

  return {
    avisos,
    hasAnyImpostoSeletivo,
    isValueByObj,
    rrOutput,
    rrTotalIS,
    rrTotalCBS,
    rrTotalIBS,
    rrTotalTributos,
    rrErrors,
    regimeRegularScenario,
    snCrt1Input,
    snCrt2Input,
  };
}

function finalizeCompareOutput(
  input: CompareRegimesInput,
  prep: ReturnType<typeof prepareAfterRegimeRegular>,
  snCrt1Output: ObservabilidadeSimplesOutput,
  snCrt2Output: ObservabilidadeSimplesOutput | null,
): CompareRegimesOutput {
  const {
    avisos,
    hasAnyImpostoSeletivo,
    isValueByObj,
    rrOutput,
    rrTotalIS,
    rrTotalCBS,
    rrTotalIBS,
    rrTotalTributos,
    rrErrors,
    regimeRegularScenario,
  } = prep;

  const snCrt1IsValues = snCrt1Output.itens
    .filter((it) => it.estadoItem === 'CALCULADO')
    .map((it) => isValueByObj.get(it.nObj) ?? '0');
  const snCrt1TotalIS = formatCurrency(totalizeExact(snCrt1IsValues));

  const crt1Observacoes = [
    ...snCrt1Output.avisos,
    ...snCrt1Output.itens.flatMap((it) => it.avisos),
  ];
  if (hasAnyImpostoSeletivo) {
    crt1Observacoes.unshift(BASE_BRIDGE_NOTE);
  }

  const simplesCrt1Scenario: RegimeComparisonScenario = {
    cenario: 'simples_crt1',
    titulo: 'Simples Nacional (CRT=1 — Apuração pelo DAS)',
    totalIS: snCrt1TotalIS,
    totalCBS: snCrt1Output.totais.vCBSSN,
    totalIBS: snCrt1Output.totais.vIBSSN,
    totalTributos: snCrt1Output.totais.totalGeral,
    apropriacaoCreditoAdquirente:
      'Transferência limitada às alíquotas efetivas pagas no DAS (pCBSSN / pIBSSN) informadas pelo optante (LC 214/2025).',
    observacoes: crt1Observacoes,
    erros: collectSimplesErrors(snCrt1Output),
    detalhe: snCrt1Output,
  };

  // 3. Simples Híbrido (CRT=1, Optante Regime Regular — tpRegimeIBSCBS=1 / VSN-019)
  // Reuses the deterministic Regime Regular calculation (rrOutput) per NT 2026.005 VSN-019.
  const hibridoObservacoes = [
    'NT 2026.005 (VSN-019): optante do Simples Nacional com tpRegimeIBSCBS=1 apura CBS e IBS fora do DAS, pelo Regime Regular.',
    ...(hasAnyImpostoSeletivo ? [BASE_BRIDGE_NOTE] : []),
    ...rrOutput.avisos,
  ];

  const simplesHibridoScenario: RegimeComparisonScenario = {
    cenario: 'simples_hibrido',
    titulo: 'Simples Híbrido (CRT=1, Optante Regime Regular — tpRegimeIBSCBS=1)',
    totalIS: rrTotalIS,
    totalCBS: rrTotalCBS,
    totalIBS: rrTotalIBS,
    totalTributos: rrTotalTributos,
    apropriacaoCreditoAdquirente: summarizeRegimeRegularCredits(rrOutput, true),
    observacoes: hibridoObservacoes,
    erros: rrErrors,
    detalhe: rrOutput,
  };

  const cenarios: RegimeComparisonScenario[] = [
    regimeRegularScenario,
    simplesCrt1Scenario,
    simplesHibridoScenario,
  ];

  // 4. Optional Excesso de Sublimite (CRT=2 — CBS no Simples + IBS no Regime Regular)
  if (snCrt2Output) {
    const subTotalIS = rrTotalIS;
    const subTotalCBS = snCrt2Output.totais.vCBSSN;
    const subTotalIBS = rrTotalIBS;
    const subTotalTributos = formatCurrency(totalizeExact([subTotalIS, subTotalCBS, subTotalIBS]));

    const subObservacoes = [
      'CRT=2 (Excesso de Sublimite estadual): conforme RASN_IN_GERA_IBS=0 na NT 2026.005, a CBS é apurada pelo Simples Nacional e o IBS é apurado pelo Regime Regular.',
      ...(hasAnyImpostoSeletivo ? [BASE_BRIDGE_NOTE] : []),
      ...snCrt2Output.avisos,
      ...rrOutput.avisos,
    ];

    cenarios.push({
      cenario: 'sublimite_crt2',
      titulo: 'Excesso de Sublimite (CRT=2 — CBS no Simples + IBS no Regime Regular)',
      totalIS: subTotalIS,
      totalCBS: subTotalCBS,
      totalIBS: subTotalIBS,
      totalTributos: subTotalTributos,
      apropriacaoCreditoAdquirente:
        'Crédito misto B2B: CBS limitada à alíquota efetiva paga no DAS (pCBSSN) e IBS com apropriação integral conforme Regime Regular.',
      observacoes: subObservacoes,
      erros: [
        ...collectSimplesErrors(snCrt2Output),
        ...rrErrors,
      ],
      detalhe: snCrt2Output,
    });
  }

  return {
    elegivel: true,
    dhFatoGerador: input.dhFatoGerador,
    cenarios,
    avisos: [...new Set(avisos)],
  };
}

/**
 * Deterministic side-by-side comparison between Regime Regular, Simples Nacional (CRT=1),
 * Simples Híbrido (CRT=1, tpRegimeIBSCBS=1), and optional Excesso de Sublimite (CRT=2).
 */
export function compareRegimes(
  input: CompareRegimesInput,
  rr: RegimeRegularEngine,
  sn: SimplesNacionalEngine,
): CompareRegimesOutput {
  const ineligible = checkCompareEligibility(input);
  if (ineligible) {
    return ineligible;
  }

  const rrOutput = rr.calculate(buildRegimeRegularCompareInput(input), 'observabilidade');
  const prep = prepareAfterRegimeRegular(input, rrOutput);
  const snCrt1Output = sn.calculate(prep.snCrt1Input);
  const snCrt2Output = prep.snCrt2Input ? sn.calculate(prep.snCrt2Input) : null;

  return finalizeCompareOutput(input, prep, snCrt1Output, snCrt2Output);
}

/**
 * Async variant of `compareRegimes` used by `FiscalEngineRouter` to route each
 * regime calculation independently across local or remote-official connectors.
 */
export async function compareRegimesAsync(
  input: CompareRegimesInput,
  calculators: CompareRegimesCalculators,
): Promise<CompareRegimesOutput> {
  const ineligible = checkCompareEligibility(input);
  if (ineligible) {
    return ineligible;
  }

  const rrOutput = await calculators.calculateRegimeRegular(buildRegimeRegularCompareInput(input));
  const prep = prepareAfterRegimeRegular(input, rrOutput);
  const snCrt1Output = await calculators.calculateSimplesNacional(prep.snCrt1Input);
  const snCrt2Output = prep.snCrt2Input
    ? await calculators.calculateSimplesNacional(prep.snCrt2Input)
    : null;

  return finalizeCompareOutput(input, prep, snCrt1Output, snCrt2Output);
}

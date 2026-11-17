import type { Decimal } from 'decimal.js';
import {
  FiscalDecimal,
  formatCurrency,
  roundInternal8,
  totalizeExact,
} from '../../shared/rounding.js';
import type {
  BaseCalculoUnificadaInput,
  BaseCalculoUnificadaNfseInput,
  BaseCalculoUnificadaNfseOutput,
  BaseCalculoUnificadaOutput,
  DecimalInput,
  FiscalErrorItem,
} from '../../shared/types/fiscal.js';

type BaseKind = 'RG' | 'IS' | 'SN';
type OperationKind = 'SOMA' | 'SUBTRAI';
type NaturezaKind = 'bem' | 'servico';

interface ElementoSpec {
  key: keyof BaseCalculoUnificadaInput;
  tag: string;
  operacao: OperationKind;
  bases: ReadonlySet<BaseKind>;
  natureza: NaturezaKind | null;
  anoInicio: number;
  anoFim: number;
  modelos: ReadonlySet<number>;
}

const ELEMENTOS_NFE: readonly ElementoSpec[] = [
  {
    key: 'vProd',
    tag: 'vProd',
    operacao: 'SOMA',
    bases: new Set<BaseKind>(['RG', 'IS', 'SN']),
    natureza: null,
    anoInicio: 2026,
    anoFim: 2033,
    modelos: new Set([55, 65]),
  },
  {
    key: 'vServ',
    tag: 'vServ',
    operacao: 'SOMA',
    bases: new Set<BaseKind>(['RG', 'IS', 'SN']),
    natureza: 'servico',
    anoInicio: 2026,
    anoFim: 2033,
    modelos: new Set([55, 65]),
  },
  {
    key: 'vFrete',
    tag: 'vFrete',
    operacao: 'SOMA',
    bases: new Set<BaseKind>(['RG', 'IS', 'SN']),
    natureza: null,
    anoInicio: 2026,
    anoFim: 2033,
    modelos: new Set([55, 65]),
  },
  {
    key: 'vSeg',
    tag: 'vSeg',
    operacao: 'SOMA',
    bases: new Set<BaseKind>(['RG', 'IS', 'SN']),
    natureza: null,
    anoInicio: 2026,
    anoFim: 2033,
    modelos: new Set([55, 65]),
  },
  {
    key: 'vOutro',
    tag: 'vOutro',
    operacao: 'SOMA',
    bases: new Set<BaseKind>(['RG', 'IS', 'SN']),
    natureza: null,
    anoInicio: 2026,
    anoFim: 2033,
    modelos: new Set([55, 65]),
  },
  {
    key: 'vII',
    tag: 'vII',
    operacao: 'SOMA',
    bases: new Set<BaseKind>(['RG', 'IS']),
    natureza: 'bem',
    anoInicio: 2026,
    anoFim: 2033,
    modelos: new Set([55]),
  },
  {
    key: 'vIS',
    tag: 'vIS',
    operacao: 'SOMA',
    bases: new Set<BaseKind>(['RG', 'SN']),
    natureza: null,
    anoInicio: 2027,
    anoFim: 2033,
    modelos: new Set([55, 65]),
  },
  {
    key: 'vDesc',
    tag: 'vDesc',
    operacao: 'SUBTRAI',
    bases: new Set<BaseKind>(['RG', 'IS', 'SN']),
    natureza: null,
    anoInicio: 2026,
    anoFim: 2033,
    modelos: new Set([55, 65]),
  },
  {
    key: 'vPIS',
    tag: 'vPIS',
    operacao: 'SUBTRAI',
    bases: new Set<BaseKind>(['RG', 'IS']),
    natureza: null,
    anoInicio: 2026,
    anoFim: 2026,
    modelos: new Set([55, 65]),
  },
  {
    key: 'vCOFINS',
    tag: 'vCOFINS',
    operacao: 'SUBTRAI',
    bases: new Set<BaseKind>(['RG', 'IS']),
    natureza: null,
    anoInicio: 2026,
    anoFim: 2026,
    modelos: new Set([55, 65]),
  },
  {
    key: 'vICMS',
    tag: 'vICMS',
    operacao: 'SUBTRAI',
    bases: new Set<BaseKind>(['RG', 'IS']),
    natureza: 'bem',
    anoInicio: 2026,
    anoFim: 2032,
    modelos: new Set([55, 65]),
  },
  {
    key: 'vFCP',
    tag: 'vFCP',
    operacao: 'SUBTRAI',
    bases: new Set<BaseKind>(['RG', 'IS']),
    natureza: 'bem',
    anoInicio: 2026,
    anoFim: 2032,
    modelos: new Set([55, 65]),
  },
  {
    key: 'vISS',
    tag: 'vISS',
    operacao: 'SUBTRAI',
    bases: new Set<BaseKind>(['RG', 'IS']),
    natureza: 'servico',
    anoInicio: 2026,
    anoFim: 2032,
    modelos: new Set([55, 65]),
  },
];

const ANO_EXTINCAO_PIS_COFINS = 2027;
const ANO_EXTINCAO_ISSQN = 2033;

function toDecimalOrZero(value: DecimalInput | undefined): Decimal {
  if (value === undefined) {
    return new FiscalDecimal(0);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError('Valor numérico inválido para componente da base de cálculo.');
    }
    return new FiscalDecimal(value);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return new FiscalDecimal(0);
  }
  return new FiscalDecimal(trimmed);
}

function getMotivoNaoComposicao(
  spec: ElementoSpec,
  ano: number,
  natureza: NaturezaKind,
  tipoDocumento: number,
): string | null {
  if (ano < spec.anoInicio || ano > spec.anoFim) {
    return `Campo ${spec.tag} não compõe as bases para o ano ${ano} (vigência ${spec.anoInicio}–${spec.anoFim}) e foi ignorado no cálculo`;
  }
  if (spec.natureza !== null && spec.natureza !== natureza) {
    return `Campo ${spec.tag} não compõe as bases para a natureza ${natureza} (aplicável apenas a ${spec.natureza}) e foi ignorado no cálculo`;
  }
  if (!spec.modelos.has(tipoDocumento)) {
    return `Campo ${spec.tag} não compõe as bases para o documento modelo ${tipoDocumento} e foi ignorado no cálculo`;
  }
  return null;
}

/**
 * Computes the unified calculation bases (Regime Geral, Imposto Seletivo, and Simples Nacional)
 * for NF-e (55) and NFC-e (65) according to temporal validity windows, operation nature, and document model.
 */
export function calculateBaseUnificadaNfe(
  input: BaseCalculoUnificadaInput,
): BaseCalculoUnificadaOutput {
  if (input.tipoDocumento !== 55 && input.tipoDocumento !== 65) {
    throw new RangeError('Tipo de documento deve ser 55 (NF-e) ou 65 (NFC-e)');
  }

  const soma: Record<BaseKind, Decimal> = {
    RG: new FiscalDecimal(0),
    IS: new FiscalDecimal(0),
    SN: new FiscalDecimal(0),
  };
  const subtrai: Record<BaseKind, Decimal> = {
    RG: new FiscalDecimal(0),
    IS: new FiscalDecimal(0),
    SN: new FiscalDecimal(0),
  };
  const avisos: string[] = [];

  for (const spec of ELEMENTOS_NFE) {
    const raw = input[spec.key] as DecimalInput | undefined;
    const valor = toDecimalOrZero(raw);
    if (valor.isZero()) {
      continue;
    }

    const motivo = getMotivoNaoComposicao(
      spec,
      input.anoFatoGerador,
      input.natureza,
      input.tipoDocumento,
    );
    if (motivo !== null) {
      avisos.push(motivo);
      continue;
    }

    const bucket = spec.operacao === 'SOMA' ? soma : subtrai;
    for (const base of spec.bases) {
      bucket[base] = bucket[base].plus(valor);
    }
  }

  const vIpi = toDecimalOrZero(input.vIPI);
  if (!vIpi.isZero()) {
    avisos.push('Campo vIPI não compõe as bases de IBS/CBS/IS/SN e foi ignorado no cálculo');
  }

  const baseRG = roundInternal8(soma.RG.minus(subtrai.RG));
  const baseIS = roundInternal8(soma.IS.minus(subtrai.IS));
  const baseSN = roundInternal8(soma.SN.minus(subtrai.SN));

  return {
    baseRG: formatCurrency(baseRG),
    baseIS: formatCurrency(baseIS),
    baseSN: formatCurrency(baseSN),
    avisos,
  };
}

/**
 * Computes the unified calculation bases (Regime Geral and Simples Nacional) for NFS-e,
 * applying MEI short-circuiting, adjustment validations, and PIS/COFINS/ISSQN extinction schedules.
 */
export function calculateBaseUnificadaNfse(
  input: BaseCalculoUnificadaNfseInput,
): BaseCalculoUnificadaNfseOutput {
  const avisos: string[] = [];
  const erros: FiscalErrorItem[] = [];

  const vServ = toDecimalOrZero(input.vServ);
  const vDescIncond = toDecimalOrZero(input.vDescIncond);
  const vDescCond = toDecimalOrZero(input.vDescCond);
  const vDedRed = toDecimalOrZero(input.vDedRed);
  const vISS = toDecimalOrZero(input.vISS);
  const vPIS = toDecimalOrZero(input.vPIS);
  const vCOFINS = toDecimalOrZero(input.vCOFINS);
  const vOutrosAjustes = toDecimalOrZero(input.vOutrosAjustes);

  const vCalcAjuste = totalizeExact([vDedRed, vOutrosAjustes]);

  if (input.isMei) {
    avisos.push('E1302: Operação MEI: bases de cálculo não aplicáveis');
    if (vCalcAjuste.gt(0)) {
      erros.push({
        code: 'E0436',
        title: 'Documentos de ajuste não são permitidos para MEI',
        description: 'Documentos de ajuste não são permitidos para MEI',
        pointer: '#/vOutrosAjustes',
        severity: 'error',
      });
    }
    return {
      baseRG: '0.00',
      baseSN: '0.00',
      avisos,
      erros,
    };
  }

  if (vCalcAjuste.gt(0) && vCalcAjuste.gte(vServ)) {
    erros.push({
      code: 'E1534',
      title: 'Soma dos ajustes excede ou iguala o valor do serviço',
      description: `Soma dos ajustes (${formatCurrency(vCalcAjuste)}) excede ou iguala o valor do serviço (${formatCurrency(vServ)})`,
      pointer: '#/vOutrosAjustes',
      severity: 'error',
    });
  }

  if (vDescCond.gt(0)) {
    avisos.push(
      'Campo vDescCond (desconto condicionado) não reduz as bases de cálculo e foi ignorado no cálculo',
    );
  }

  const ehLocacao = Boolean(input.ehLocacao);
  const ano = input.anoFatoGerador;

  let deduzISS = new FiscalDecimal(0);
  if (!vISS.isZero()) {
    if (ehLocacao) {
      avisos.push('Campo vISS ignorado em contexto de locação de imóveis (sem incidência de ISSQN)');
    } else if (ano >= ANO_EXTINCAO_ISSQN) {
      avisos.push(
        `Campo vISS não compõe a base RG para o ano ${ano} (vigência 2026–2032) e foi ignorado no cálculo`,
      );
    } else {
      deduzISS = vISS;
    }
  }

  let deduzPIS = new FiscalDecimal(0);
  if (!vPIS.isZero()) {
    if (ano >= ANO_EXTINCAO_PIS_COFINS) {
      avisos.push(
        `Campo vPIS não compõe a base RG para o ano ${ano} (vigência 2026–2026) e foi ignorado no cálculo`,
      );
    } else {
      deduzPIS = vPIS;
    }
  }

  let deduzCOFINS = new FiscalDecimal(0);
  if (!vCOFINS.isZero()) {
    if (ano >= ANO_EXTINCAO_PIS_COFINS) {
      avisos.push(
        `Campo vCOFINS não compõe a base RG para o ano ${ano} (vigência 2026–2026) e foi ignorado no cálculo`,
      );
    } else {
      deduzCOFINS = vCOFINS;
    }
  }

  const baseRG = roundInternal8(
    vServ.minus(vDescIncond).minus(vCalcAjuste).minus(deduzISS).minus(deduzPIS).minus(deduzCOFINS),
  );
  const baseSN = roundInternal8(vServ.minus(vDescIncond).minus(vCalcAjuste));

  const baseRGFormatted = formatCurrency(baseRG);
  const baseSNFormatted = formatCurrency(baseSN);

  if (baseRG.lt(0)) {
    erros.push({
      code: 'BASE-NEGATIVA',
      title: 'Base de cálculo RG negativa',
      description: `Base de cálculo RG negativa: ${baseRGFormatted}`,
      pointer: '#/vServ',
      severity: 'error',
    });
  }
  if (baseSN.lt(0)) {
    erros.push({
      code: 'BASE-NEGATIVA',
      title: 'Base de cálculo SN negativa',
      description: `Base de cálculo SN negativa: ${baseSNFormatted}`,
      pointer: '#/vServ',
      severity: 'error',
    });
  }

  return {
    baseRG: baseRGFormatted,
    baseSN: baseSNFormatted,
    avisos,
    erros,
  };
}

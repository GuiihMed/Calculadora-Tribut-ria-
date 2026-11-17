import type { Decimal } from 'decimal.js';
import {
  FiscalDecimal,
  formatCurrency,
  roundInternal8,
} from '../../shared/rounding.js';
import type { FatorRAuxiliarOutput } from '../../shared/types/fiscal.js';

const FATOR_R_THRESHOLD = new FiscalDecimal('0.28');

const AVISO_LEGAL_FATOR_R =
  'Indicador meramente auxiliar e orientativo (LC 123/2006, art. 18, §§ 5º-J e 5º-M): ' +
  'aplicável apenas a atividades sujeitas ao Fator R (ex.: cAtivSN 09). Fator R >= 0,28 (28%) ' +
  'sugere enquadramento no Anexo III; inferior a 0,28 sugere Anexo V. Não substitui a apuração ' +
  'oficial no PGDAS-D/RFB nem altera a tributação assistida de IBS/CBS da NT 2026.005.';

function parseNonNegativeDecimal(raw: string): Decimal | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const dec = new FiscalDecimal(trimmed);
  if (dec.isNegative()) {
    return null;
  }
  return dec;
}

function formatRatio(ratio: Decimal): string {
  const rounded = roundInternal8(ratio);
  const fixed = rounded.toFixed(8);
  const [intPart = '0', decPart = '00000000'] = fixed.split('.');
  const trimmed = decPart.replace(/0+$/, '');
  const padded = trimmed.length < 2 ? trimmed.padEnd(2, '0') : trimmed;
  return `${intPart}.${padded}`;
}

/**
 * Auxiliary Fator R calculator (`Folha de Salários 12m / RBT 12m`) for Simples Nacional
 * guidance. Informational only: never overrides official PGDAS-D / RFB determination.
 */
export function calculateFatorRAuxiliar(
  folha12m: string,
  rbt12m: string,
): FatorRAuxiliarOutput {
  const folha = parseNonNegativeDecimal(folha12m);
  const rbt = parseNonNegativeDecimal(rbt12m);

  if (folha === null || rbt === null || rbt.lte(0)) {
    return {
      folha12m: folha !== null ? formatCurrency(folha) : String(folha12m ?? '').trim(),
      rbt12m: rbt !== null ? formatCurrency(rbt) : String(rbt12m ?? '').trim(),
      fatorR: '0.00',
      enquadramentoSugerido: 'INDISPONIVEL',
      avisoLegal:
        'Cálculo do Fator R indisponível: informe valores numéricos não negativos e RBT12 maior que zero. ' +
        AVISO_LEGAL_FATOR_R,
    };
  }

  const ratio = folha.div(rbt);
  const enquadramentoSugerido = ratio.gte(FATOR_R_THRESHOLD) ? 'Anexo III' : 'Anexo V';

  return {
    folha12m: formatCurrency(folha),
    rbt12m: formatCurrency(rbt),
    fatorR: formatRatio(ratio),
    enquadramentoSugerido,
    avisoLegal: AVISO_LEGAL_FATOR_R,
  };
}

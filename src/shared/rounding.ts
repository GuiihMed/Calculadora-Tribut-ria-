import { Decimal } from 'decimal.js';

/**
 * Dedicated Decimal constructor configured to mirror Receita Federal's
 * ArredondamentoUtils.java (LC 214/2025 art. 349 § 14):
 * - High intermediate precision (40 significant digits)
 * - Banker's rounding (ROUND_HALF_EVEN)
 */
export const FiscalDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -20,
  toExpPos: 30,
});

export const INTERNAL_DECIMAL_PLACES = 8;
export const CURRENCY_DECIMAL_PLACES = 2;
export const RATE_MAX_DECIMAL_PLACES = 4;
export const QUANTITY_DECIMAL_PLACES = 4;

function normalizeNegativeZero(val: Decimal): Decimal {
  return val.isZero() ? new FiscalDecimal(0) : val;
}

export function toFiscalDecimal(val: Decimal.Value): Decimal {
  return new FiscalDecimal(val);
}

/**
 * Rounds an intermediate value to 8 decimal places using HALF_EVEN.
 */
export function roundInternal8(val: Decimal.Value): Decimal {
  return normalizeNegativeZero(
    new FiscalDecimal(val).toDecimalPlaces(INTERNAL_DECIMAL_PLACES, Decimal.ROUND_HALF_EVEN),
  );
}

/**
 * Converts a percentage rate (e.g. "3.52") to its decimal factor ("0.0352").
 * Preserves full configured precision for downstream internal multiplication.
 */
export function divideBy100(val: Decimal.Value): Decimal {
  return normalizeNegativeZero(new FiscalDecimal(val).div(100));
}

/**
 * Multiplies two values and rounds the intermediate result to 8 decimal places (HALF_EVEN).
 */
export function multiplyInternal(a: Decimal.Value, b: Decimal.Value): Decimal {
  return roundInternal8(new FiscalDecimal(a).mul(new FiscalDecimal(b)));
}

/**
 * Divides two values and rounds the intermediate result to 8 decimal places (HALF_EVEN).
 */
export function divideInternal(a: Decimal.Value, b: Decimal.Value): Decimal {
  const divisor = new FiscalDecimal(b);
  if (divisor.isZero()) {
    throw new RangeError('Division by zero is not permitted in fiscal arithmetic.');
  }
  return roundInternal8(new FiscalDecimal(a).div(divisor));
}

/**
 * Subtracts b from a and rounds the intermediate result to 8 decimal places (HALF_EVEN).
 */
export function subtractInternal(a: Decimal.Value, b: Decimal.Value): Decimal {
  return roundInternal8(new FiscalDecimal(a).sub(new FiscalDecimal(b)));
}

/**
 * Sums unrounded intermediate values before any final currency presentation rounding,
 * matching ArredondamentoUtils.totalizar.
 */
export function totalizeExact(vals: Decimal.Value[]): Decimal {
  let acc = new FiscalDecimal(0);
  for (const val of vals) {
    acc = acc.add(new FiscalDecimal(val));
  }
  return normalizeNegativeZero(acc);
}

/**
 * Formats monetary values to 2 decimal places using HALF_EVEN.
 */
export function formatCurrency(val: Decimal.Value): string {
  const rounded = normalizeNegativeZero(
    new FiscalDecimal(val).toDecimalPlaces(CURRENCY_DECIMAL_PLACES, Decimal.ROUND_HALF_EVEN),
  );
  return rounded.toFixed(CURRENCY_DECIMAL_PLACES);
}

/**
 * Formats rates/percentages with 2 to 4 decimal places (HALF_EVEN),
 * stripping trailing zeros beyond the 2nd decimal place.
 */
export function formatRate(val: Decimal.Value): string {
  const rounded = normalizeNegativeZero(
    new FiscalDecimal(val).toDecimalPlaces(RATE_MAX_DECIMAL_PLACES, Decimal.ROUND_HALF_EVEN),
  );
  const fixed = rounded.toFixed(RATE_MAX_DECIMAL_PLACES);
  const [intPart = '0', decPart = '0000'] = fixed.split('.');
  const trimmed = decPart.replace(/0+$/, '');
  const padded = trimmed.length < 2 ? trimmed.padEnd(2, '0') : trimmed;
  return `${intPart}.${padded}`;
}

/**
 * Formats quantities as an integer when whole after 4-decimal HALF_EVEN rounding,
 * or with 4 decimal places otherwise.
 */
export function formatQuantity(val: Decimal.Value): string {
  const rounded = normalizeNegativeZero(
    new FiscalDecimal(val).toDecimalPlaces(QUANTITY_DECIMAL_PLACES, Decimal.ROUND_HALF_EVEN),
  );
  if (rounded.isInteger()) {
    return rounded.toFixed(0);
  }
  return rounded.toFixed(QUANTITY_DECIMAL_PLACES);
}

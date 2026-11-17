import { describe, expect, it } from 'vitest';
import {
  divideBy100,
  divideInternal,
  formatCurrency,
  formatQuantity,
  formatRate,
  multiplyInternal,
  roundInternal8,
  subtractInternal,
  totalizeExact,
} from '../../src/shared/rounding.js';

describe('ArredondamentoUtils parity (HALF_EVEN, 8 intermediate decimals)', () => {
  it('applies banker rounding (HALF_EVEN) on half-cent ties', () => {
    expect(formatCurrency('1.005')).toBe('1.00');
    expect(formatCurrency('1.015')).toBe('1.02');
    expect(roundInternal8('0.123456785').toFixed(8)).toBe('0.12345678');
    expect(roundInternal8('0.123456795').toFixed(8)).toBe('0.12345680');
  });

  it('formats rates between 2 and 4 decimals stripping trailing zeros', () => {
    expect(formatRate('0.2080')).toBe('0.208');
    expect(formatRate('0.2000')).toBe('0.20');
    expect(formatRate('60.0000')).toBe('60.00');
    expect(formatRate('3.5200')).toBe('3.52');
  });

  it('formats quantities as integer when whole or 4 decimals otherwise', () => {
    expect(formatQuantity('20.0000')).toBe('20');
    expect(formatQuantity('55.55')).toBe('55.5500');
  });

  it('sums unrounded intermediate values before final currency rounding', () => {
    const sum = totalizeExact(['0.165', '0.165']);
    expect(formatCurrency(sum)).toBe('0.33');
  });

  it('performs exact intermediate arithmetic helpers with 8-decimal HALF_EVEN rounding', () => {
    expect(divideBy100('3.52').toString()).toBe('0.0352');
    expect(multiplyInternal('1200', divideBy100('3.52')).toFixed(8)).toBe('42.24000000');
    expect(divideInternal('10', '3').toFixed(8)).toBe('3.33333333');
    expect(subtractInternal('100.005', '0.005').toFixed(8)).toBe('100.00000000');
  });
});

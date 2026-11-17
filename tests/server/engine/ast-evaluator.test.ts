import { describe, expect, it } from 'vitest';
import {
  ALLOWED_EXPRESSION_VARIABLES,
  AstSecurityError,
  evaluateTaxExpression,
} from '../../../src/server/engine/ast-evaluator.js';
import { FiscalDecimal } from '../../../src/shared/rounding.js';

describe('Safe AST Arithmetic Evaluator (AvaliadorExpressaoAritmetica)', () => {
  it('exposes the exact 21 whitelisted VariavelExpressao identifiers', () => {
    expect(ALLOWED_EXPRESSION_VARIABLES.size).toBe(21);
    expect(ALLOWED_EXPRESSION_VARIABLES.has('baseCalculo')).toBe(true);
    expect(ALLOWED_EXPRESSION_VARIABLES.has('pRedutorCompraGov')).toBe(true);
    expect(ALLOWED_EXPRESSION_VARIABLES.has('pBio')).toBe(true);
  });

  it('evaluates baseCalculoInformada-impostoSeletivoInformado+impostoSeletivoCalculado accurately', () => {
    const result = evaluateTaxExpression(
      'baseCalculoInformada-impostoSeletivoInformado+impostoSeletivoCalculado',
      {
        baseCalculoInformada: new FiscalDecimal('165.00'),
        impostoSeletivoInformado: new FiscalDecimal('15.00'),
        impostoSeletivoCalculado: new FiscalDecimal('15.00'),
      },
    );
    expect(result.toFixed(2)).toBe('165.00');
  });

  it('evaluates aliquota*(1-percentualReducao) and compra gov formula accurately', () => {
    const result = evaluateTaxExpression('aliquota*(1-percentualReducao)', {
      aliquota: new FiscalDecimal('0.088'),
      percentualReducao: new FiscalDecimal('0.6'),
    });
    expect(result.toFixed(4)).toBe('0.0352');

    const withGov = evaluateTaxExpression(
      'aliquota*(1-percentualReducao)*(1-pRedutorCompraGov/100)',
      {
        aliquota: new FiscalDecimal('0.088'),
        percentualReducao: new FiscalDecimal('0.6'),
        pRedutorCompraGov: new FiscalDecimal('10'),
      },
    );
    expect(withGov.toFixed(8)).toBe('0.03168000');
  });

  it('evaluates baseCalculo*aliquotaAdValorem+quantidade*aliquotaAdRem accurately', () => {
    const result = evaluateTaxExpression(
      'baseCalculo*aliquotaAdValorem+quantidade*aliquotaAdRem',
      {
        baseCalculo: new FiscalDecimal('150.00'),
        aliquotaAdValorem: new FiscalDecimal('0.1'),
        quantidade: new FiscalDecimal('12'),
        aliquotaAdRem: new FiscalDecimal('0'),
      },
    );
    expect(result.toFixed(2)).toBe('15.00');
  });

  it('uses high intermediate precision for division and rounds at expression end to 8 decimals (HALF_EVEN)', () => {
    const cancelled = evaluateTaxExpression('(1/3)*3', {});
    expect(cancelled.toFixed(8)).toBe('1.00000000');

    const truncated = evaluateTaxExpression('10/3', {});
    expect(truncated.toFixed(8)).toBe('3.33333333');

    const monoBio = evaluateTaxExpression('(pBio/(1-pBio))*quantidade*aliquotaAdRemSecundaria', {
      pBio: new FiscalDecimal('0.3'),
      quantidade: new FiscalDecimal('100'),
      aliquotaAdRemSecundaria: new FiscalDecimal('0.1922'),
    });
    expect(monoBio.toFixed(8)).toBe('8.23714286');
  });

  it('treats null values for whitelisted variables as zero', () => {
    const result = evaluateTaxExpression(
      'baseCalculoInformada-impostoSeletivoInformado+impostoSeletivoCalculado',
      {
        baseCalculoInformada: new FiscalDecimal('100'),
        impostoSeletivoInformado: null,
        impostoSeletivoCalculado: null,
      },
    );
    expect(result.toFixed(2)).toBe('100.00');
  });

  it.each([
    ['process.exit(1)', 'process.exit(1)'],
    ['Math.random()', 'Math.random()'],
    ['1;2', '1;2'],
    ['unknownVar + 1', 'unknownVar + 1'],
    ["eval('1')", "eval('1')"],
    ['division by zero literal', '100 / 0'],
    ['division by zero expression', 'baseCalculo / (1 - 1)'],
    ['prototype identifier constructor', 'constructor + 1'],
    ['empty expression', '   '],
    ['unbalanced parens', '(1 + 2'],
    ['trailing token', '1 2'],
  ])('rejects unsafe or invalid expression (%s) with AstSecurityError', (_label, expr) => {
    expect(() =>
      evaluateTaxExpression(expr, {
        baseCalculo: new FiscalDecimal('100'),
      }),
    ).toThrow(AstSecurityError);
  });
});

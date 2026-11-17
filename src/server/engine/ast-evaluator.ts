import type { Decimal } from 'decimal.js';
import { FiscalDecimal, roundInternal8 } from '../../shared/rounding.js';

/**
 * Error thrown whenever an arithmetic tax expression violates the strict
 * security sandbox (disallowed tokens, non-whitelisted variable names,
 * syntax errors, or division by zero).
 */
export class AstSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AstSecurityError';
  }
}

/**
 * Exact 21-variable whitelist from RFB `VariavelExpressao.java`.
 */
export const ALLOWED_EXPRESSION_VARIABLES: ReadonlySet<string> = new Set([
  'baseCalculo',
  'impostoSeletivoCalculado',
  'baseCalculoInformada',
  'impostoSeletivoInformado',
  'aliquotaEfetiva',
  'redutor',
  'ajuste',
  'aliquotaAdRem',
  'aliquotaAdValorem',
  'aliquotaReferencia',
  'aliquotaPadraoOuReferencia',
  'percentualReducao',
  'pRedutorCompraGov',
  'aliquota',
  'quantidade',
  'tributoCalculado',
  'percentualDiferimento',
  'aliquotaAdRemPrincipal',
  'aliquotaAdRemSecundaria',
  'variacaoPontoPercentual',
  'pBio',
]);

const MAX_EXPRESSION_LENGTH = 2000;
const MAX_AST_DEPTH = 64;

type Token =
  | { kind: 'NUMBER'; value: string; pos: number }
  | { kind: 'IDENT'; value: string; pos: number }
  | { kind: 'OP'; value: '+' | '-' | '*' | '/'; pos: number }
  | { kind: 'LPAREN'; pos: number }
  | { kind: 'RPAREN'; pos: number }
  | { kind: 'EOF'; pos: number };

type AstNode =
  | { kind: 'NUMBER'; value: Decimal }
  | { kind: 'IDENT'; name: string }
  | { kind: 'UNARY'; op: '+' | '-'; expr: AstNode }
  | { kind: 'BINARY'; op: '+' | '-' | '*' | '/'; left: AstNode; right: AstNode };

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i]!;

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }

    if (isDigit(ch)) {
      const start = i;
      while (i < expr.length && isDigit(expr[i]!)) {
        i += 1;
      }
      if (i < expr.length && expr[i] === '.') {
        i += 1;
        if (i >= expr.length || !isDigit(expr[i]!)) {
          throw new AstSecurityError(`Invalid numeric literal at position ${start}`);
        }
        while (i < expr.length && isDigit(expr[i]!)) {
          i += 1;
        }
      }
      if (i < expr.length && (expr[i] === '.' || isIdentStart(expr[i]!))) {
        throw new AstSecurityError(`Malformed numeric token at position ${start}`);
      }
      tokens.push({ kind: 'NUMBER', value: expr.slice(start, i), pos: start });
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      while (i < expr.length && isIdentPart(expr[i]!)) {
        i += 1;
      }
      const ident = expr.slice(start, i);
      if (!ALLOWED_EXPRESSION_VARIABLES.has(ident)) {
        throw new AstSecurityError(
          `Disallowed or unknown identifier '${ident}' at position ${start}`,
        );
      }
      tokens.push({ kind: 'IDENT', value: ident, pos: start });
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ kind: 'OP', value: ch, pos: i });
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ kind: 'LPAREN', pos: i });
      i += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ kind: 'RPAREN', pos: i });
      i += 1;
      continue;
    }

    throw new AstSecurityError(`Disallowed character '${ch}' at position ${i}`);
  }

  tokens.push({ kind: 'EOF', pos: expr.length });
  return tokens;
}

class ExpressionParser {
  private cursor = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): AstNode {
    const node = this.parseAdditive(0);
    const current = this.peek();
    if (current.kind !== 'EOF') {
      throw new AstSecurityError(`Unexpected token at position ${current.pos}`);
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.cursor] ?? { kind: 'EOF', pos: -1 };
  }

  private consume(): Token {
    const token = this.peek();
    this.cursor += 1;
    return token;
  }

  private checkDepth(depth: number): void {
    if (depth > MAX_AST_DEPTH) {
      throw new AstSecurityError(`Expression exceeds maximum nesting depth of ${MAX_AST_DEPTH}`);
    }
  }

  private parseAdditive(depth: number): AstNode {
    this.checkDepth(depth);
    let left = this.parseMultiplicative(depth + 1);

    while (true) {
      const token = this.peek();
      if (token.kind === 'OP' && (token.value === '+' || token.value === '-')) {
        this.consume();
        const right = this.parseMultiplicative(depth + 1);
        left = { kind: 'BINARY', op: token.value, left, right };
      } else {
        break;
      }
    }

    return left;
  }

  private parseMultiplicative(depth: number): AstNode {
    this.checkDepth(depth);
    let left = this.parseUnary(depth + 1);

    while (true) {
      const token = this.peek();
      if (token.kind === 'OP' && (token.value === '*' || token.value === '/')) {
        this.consume();
        const right = this.parseUnary(depth + 1);
        left = { kind: 'BINARY', op: token.value, left, right };
      } else {
        break;
      }
    }

    return left;
  }

  private parseUnary(depth: number): AstNode {
    this.checkDepth(depth);
    const token = this.peek();
    if (token.kind === 'OP' && (token.value === '+' || token.value === '-')) {
      this.consume();
      return { kind: 'UNARY', op: token.value, expr: this.parseUnary(depth + 1) };
    }
    return this.parsePrimary(depth + 1);
  }

  private parsePrimary(depth: number): AstNode {
    this.checkDepth(depth);
    const token = this.consume();

    if (token.kind === 'NUMBER') {
      return { kind: 'NUMBER', value: new FiscalDecimal(token.value) };
    }

    if (token.kind === 'IDENT') {
      return { kind: 'IDENT', name: token.value };
    }

    if (token.kind === 'LPAREN') {
      const inner = this.parseAdditive(depth + 1);
      const closing = this.consume();
      if (closing.kind !== 'RPAREN') {
        throw new AstSecurityError(`Expected ')' at position ${closing.pos}`);
      }
      return inner;
    }

    throw new AstSecurityError(`Unexpected token in expression at position ${token.pos}`);
  }
}

function buildSafeVarMap(vars: Record<string, Decimal | null>): Map<string, Decimal> {
  const safeMap = new Map<string, Decimal>();
  for (const [key, value] of Object.entries(vars)) {
    if (ALLOWED_EXPRESSION_VARIABLES.has(key) && value !== null && value !== undefined) {
      safeMap.set(key, new FiscalDecimal(value));
    }
  }
  return safeMap;
}

function evalNode(node: AstNode, safeVars: Map<string, Decimal>): Decimal {
  switch (node.kind) {
    case 'NUMBER':
      return node.value;
    case 'IDENT':
      return safeVars.get(node.name) ?? new FiscalDecimal(0);
    case 'UNARY': {
      const inner = evalNode(node.expr, safeVars);
      if (node.op === '-') {
        return inner.isZero() ? new FiscalDecimal(0) : inner.neg();
      }
      return inner;
    }
    case 'BINARY': {
      const left = evalNode(node.left, safeVars);
      const right = evalNode(node.right, safeVars);
      switch (node.op) {
        case '+':
          return left.plus(right);
        case '-':
          return left.minus(right);
        case '*':
          return left.mul(right);
        case '/':
          if (right.isZero()) {
            throw new AstSecurityError('Division by zero is not permitted in tax expression.');
          }
          return left.div(right);
      }
    }
  }
}

/**
 * Evaluates a declarative RFB tax formula safely via a recursive-descent AST parser.
 * Mirrors `AvaliadorExpressaoAritmetica.java`: high-precision intermediate division
 * using `FiscalDecimal` (40 digits, HALF_EVEN), rounded to 8 decimal places (`roundInternal8`)
 * at expression end (bare variable names return their mapped value directly).
 */
export function evaluateTaxExpression(
  expr: string,
  vars: Record<string, Decimal | null>,
): Decimal {
  if (typeof expr !== 'string') {
    throw new AstSecurityError('Tax expression must be a string.');
  }
  const trimmed = expr.trim();
  if (!trimmed) {
    throw new AstSecurityError('Tax expression cannot be empty.');
  }
  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    throw new AstSecurityError(
      `Tax expression exceeds maximum length of ${MAX_EXPRESSION_LENGTH} characters.`,
    );
  }

  const tokens = tokenize(trimmed);
  const ast = new ExpressionParser(tokens).parse();
  const safeVars = buildSafeVarMap(vars);

  if (ast.kind === 'IDENT') {
    return safeVars.get(ast.name) ?? new FiscalDecimal(0);
  }

  const raw = evalNode(ast, safeVars);
  return roundInternal8(raw);
}

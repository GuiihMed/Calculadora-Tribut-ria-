const ACCESS_KEY_RAW_RE = /\b\d{44}\b/g;
const ACCESS_KEY_FORMATTED_RE = /\b\d{4}(?:[\s.-]\d{4}){10}\b/g;
const CNPJ_FORMATTED_RE = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
const CNPJ_RAW_RE = /\b\d{14}\b/g;
const CPF_FORMATTED_RE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const CPF_RAW_RE = /\b\d{11}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(?<!\d)(?:\+?55[\s-]*)?(?:\(?\d{2}\)?[\s-]*)?\d{4,5}-\d{4}(?!\d)/g;

const SENSITIVE_HEADER_TOKENS_RE =
  /(^|_)(cpf|cnpj|chave|destinatario|emitente|razao_social|nome|email|telefone|endereco|ie|im)(_|$)/;
const SENSITIVE_HEADER_SUBSTR_RE =
  /(cpf|cnpj|chave|destinatario|emitente|razao_social|razaosocial|email|telefone|endereco|inscricao_estadual|inscricao_municipal)/;

function normalizeHeaderName(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function isSensitivePiiHeader(header: string): boolean {
  const normalized = normalizeHeaderName(header);
  if (!normalized) {
    return false;
  }
  return (
    SENSITIVE_HEADER_TOKENS_RE.test(normalized) ||
    SENSITIVE_HEADER_SUBSTR_RE.test(normalized)
  );
}

/**
 * Masks fiscal PII (44-digit NF-e access keys, CNPJ, CPF, email, Brazilian phones)
 * before sending any sample or text snippet to an LLM.
 */
export function maskFiscalPii(text: string): string {
  if (!text) {
    return text;
  }

  return text
    .replace(ACCESS_KEY_RAW_RE, '[CHAVE-ACESSO-REDACTED]')
    .replace(ACCESS_KEY_FORMATTED_RE, '[CHAVE-ACESSO-REDACTED]')
    .replace(CNPJ_FORMATTED_RE, '[CNPJ-REDACTED]')
    .replace(CNPJ_RAW_RE, '[CNPJ-REDACTED]')
    .replace(CPF_FORMATTED_RE, '[CPF-REDACTED]')
    .replace(CPF_RAW_RE, '[CPF-REDACTED]')
    .replace(EMAIL_RE, '[EMAIL-REDACTED]')
    .replace(PHONE_RE, '[PHONE-REDACTED]');
}

export function maskSpreadsheetRowsForLlm(
  rows: Record<string, string>[],
): Record<string, string>[] {
  return rows.map((row) => {
    const maskedRow: Record<string, string> = {};
    for (const [key, rawVal] of Object.entries(row)) {
      const value = rawVal ?? '';
      if (isSensitivePiiHeader(key)) {
        maskedRow[key] = value.trim().length > 0 ? '[PII-REDACTED]' : '';
      } else {
        maskedRow[key] = maskFiscalPii(value);
      }
    }
    return maskedRow;
  });
}

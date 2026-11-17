import crypto from 'node:crypto';
import { parse as parseCsvSync } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import type {
  AliquotasNominaisInput,
  ExtractionDraft,
  ExtractionDraftItem,
  FieldConfidence,
} from '../../shared/types/fiscal.js';
import { maskSpreadsheetRowsForLlm } from '../security/pii-masker.js';

export const MAX_SPREADSHEET_ROWS = 500;
export const MAX_SPREADSHEET_COLS = 50;
const MAX_XLSX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MiB zip-bomb ceiling
const MAX_XLSX_ENTRIES = 2000;

export interface SpreadsheetParseResult {
  draft: ExtractionDraft;
  headers: string[];
  maskedSampleRows: Record<string, string>[];
  unmappedColumns: boolean;
  rowCount: number;
  truncated: boolean;
}

/**
 * Neutralizes spreadsheet formula injection payloads by prefixing strings
 * that begin with =, +, -, @, \t, or \r (or whitespace followed by =, +, -, @)
 * with a leading single quote (').
 */
export function sanitizeSpreadsheetCell(val: string): string {
  if (!val) {
    return '';
  }
  const firstChar = val[0]!;
  if (
    firstChar === '=' ||
    firstChar === '+' ||
    firstChar === '-' ||
    firstChar === '@' ||
    firstChar === '\t' ||
    firstChar === '\r'
  ) {
    return `'${val}`;
  }
  const trimmed = val.trimStart();
  if (trimmed.length > 0) {
    const firstNonWs = trimmed[0]!;
    if (
      firstNonWs === '=' ||
      firstNonWs === '+' ||
      firstNonWs === '-' ||
      firstNonWs === '@'
    ) {
      return `'${val}`;
    }
  }
  return val;
}

function assertSafeXlsxZip(buffer: Buffer): void {
  // Scan End of Central Directory (PK\x05\x06) within the trailing 64 KiB + 22 bytes
  const minOffset = Math.max(0, buffer.byteLength - 65_557);
  let eocdOffset = -1;
  for (let i = buffer.byteLength - 22; i >= minOffset; i--) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    return; // Let exceljs validate structural ZIP errors if malformed
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  if (totalEntries > MAX_XLSX_ENTRIES) {
    throw new Error('Planilha XLSX excede o limite máximo de entradas ZIP (proteção anti-zip-bomb).');
  }

  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  let cursor = cdOffset;
  let totalUncompressed = 0;

  for (let entry = 0; entry < totalEntries; entry++) {
    if (cursor + 46 > buffer.byteLength) {
      break;
    }
    if (
      buffer[cursor] !== 0x50 ||
      buffer[cursor + 1] !== 0x4b ||
      buffer[cursor + 2] !== 0x01 ||
      buffer[cursor + 3] !== 0x02
    ) {
      break;
    }
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_XLSX_UNCOMPRESSED_BYTES) {
      throw new Error('Planilha XLSX excede o limite de descompressão de 50 MiB (proteção anti-zip-bomb).');
    }
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    cursor += 46 + nameLen + extraLen + commentLen;
  }
}

type CanonicalField =
  | 'descricao'
  | 'ncm'
  | 'nbs'
  | 'cst'
  | 'cClassTrib'
  | 'cAtivSN'
  | 'baseCalculo'
  | 'vProd'
  | 'quantidade'
  | 'unidade'
  | 'vFrete'
  | 'vSeg'
  | 'vOutro'
  | 'vDesc'
  | 'vICMS'
  | 'vPIS'
  | 'vCOFINS'
  | 'vIS'
  | 'pIBSSN'
  | 'pCBSSN'
  | 'pCBS'
  | 'pIBSUF'
  | 'pIBSMun';

const HEADER_ALIAS_MAP: Record<string, CanonicalField> = {
  descricao: 'descricao',
  descricaoproduto: 'descricao',
  descricaoservico: 'descricao',
  produto: 'descricao',
  servico: 'descricao',
  xprod: 'descricao',
  xdescserv: 'descricao',
  item: 'descricao',
  ncm: 'ncm',
  codncm: 'ncm',
  codigoncm: 'ncm',
  nbs: 'nbs',
  cnbs: 'nbs',
  codnbs: 'nbs',
  codigonbs: 'nbs',
  cst: 'cst',
  cstibscbs: 'cst',
  cclasstrib: 'cClassTrib',
  classificacao: 'cClassTrib',
  classificacaotributaria: 'cClassTrib',
  cativsn: 'cAtivSN',
  atividade: 'cAtivSN',
  atividadesn: 'cAtivSN',
  basecalculo: 'baseCalculo',
  basedecalculo: 'baseCalculo',
  vbc: 'baseCalculo',
  valor: 'baseCalculo',
  valoroperacao: 'baseCalculo',
  valortotal: 'baseCalculo',
  vserv: 'baseCalculo',
  vprod: 'vProd',
  valorproduto: 'vProd',
  quantidade: 'quantidade',
  qtd: 'quantidade',
  qtde: 'quantidade',
  qcom: 'quantidade',
  unidade: 'unidade',
  un: 'unidade',
  unid: 'unidade',
  ucom: 'unidade',
  vfrete: 'vFrete',
  frete: 'vFrete',
  vseg: 'vSeg',
  seguro: 'vSeg',
  voutro: 'vOutro',
  outros: 'vOutro',
  outrasdespesas: 'vOutro',
  vdesc: 'vDesc',
  desconto: 'vDesc',
  vicms: 'vICMS',
  icms: 'vICMS',
  vpis: 'vPIS',
  pis: 'vPIS',
  vcofins: 'vCOFINS',
  cofins: 'vCOFINS',
  vis: 'vIS',
  impostoseletivo: 'vIS',
  pibssn: 'pIBSSN',
  pcbssn: 'pCBSSN',
  pcbs: 'pCBS',
  pibsuf: 'pIBSUF',
  pibsmun: 'pIBSMun',
};

function normalizeCanonicalKey(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function cellValueToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    if ('result' in value && value.result !== undefined && value.result !== null) {
      return String(value.result).trim();
    }
    if ('formula' in value && typeof value.formula === 'string') {
      return `=${value.formula}`;
    }
    if ('text' in value && typeof value.text === 'string') {
      return value.text.trim();
    }
  }
  return String(value).trim();
}

function normalizeDecimalString(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  // Reject potential formula payloads as numeric inputs
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return undefined;
  }
  const cleaned = trimmed.replace(/\s+/g, '');
  // Handle Brazilian formatting e.g. 1.234,56 or 123,45
  let normalized = cleaned;
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+,\d+$/.test(cleaned)) {
    normalized = cleaned.replace(',', '.');
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function detectCsvDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const semiCount = (firstLine.match(/;/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  return semiCount > commaCount ? ';' : ',';
}

async function readRawSpreadsheetTable(
  buffer: Buffer,
  ext: 'xlsx' | 'csv',
): Promise<{ rows: string[][]; truncated: boolean; colTruncated: boolean }> {
  if (ext === 'csv') {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const delimiter = detectCsvDelimiter(text);
    const parsed = parseCsvSync(text, {
      columns: false,
      delimiter,
      relax_column_count: true,
      skip_empty_lines: true,
      to: MAX_SPREADSHEET_ROWS + 2,
    }) as string[][];

    const colTruncated = parsed.some((r) => r.length > MAX_SPREADSHEET_COLS);
    const boundedCols = parsed.map((r) =>
      r.slice(0, MAX_SPREADSHEET_COLS).map((cell) => String(cell ?? '').trim()),
    );
    const dataRows = boundedCols.slice(1);
    const truncated = dataRows.length > MAX_SPREADSHEET_ROWS;
    const rows =
      boundedCols.length > 0
        ? [boundedCols[0]!, ...dataRows.slice(0, MAX_SPREADSHEET_ROWS)]
        : [];
    return { rows, truncated, colTruncated };
  }

  assertSafeXlsxZip(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { rows: [], truncated: false, colTruncated: false };
  }

  const rows: string[][] = [];
  let truncated = false;
  let colTruncated = false;

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    if (rows.length >= MAX_SPREADSHEET_ROWS + 1) {
      truncated = true;
      return;
    }
    const rawValues = Array.isArray(row.values) ? row.values.slice(1) : [];
    if (rawValues.length > MAX_SPREADSHEET_COLS) {
      colTruncated = true;
    }
    const limited = rawValues
      .slice(0, MAX_SPREADSHEET_COLS)
      .map((cell) => cellValueToString(cell));
    if (limited.some((v) => v.length > 0)) {
      rows.push(limited);
    }
  });

  return { rows, truncated, colTruncated };
}

export async function parseSpreadsheetToDraft(
  buffer: Buffer,
  ext: 'xlsx' | 'csv',
  filename = `planilha.${ext}`,
): Promise<SpreadsheetParseResult> {
  const { rows: rawRows, truncated, colTruncated } = await readRawSpreadsheetTable(buffer, ext);

  const warnings: string[] = [];
  if (truncated) {
    warnings.push(
      `Planilha excede o limite de ${MAX_SPREADSHEET_ROWS} linhas de dados; apenas as primeiras ${MAX_SPREADSHEET_ROWS} linhas foram processadas.`,
    );
  }
  if (colTruncated) {
    warnings.push(
      `Planilha excede o limite de ${MAX_SPREADSHEET_COLS} colunas; apenas as primeiras ${MAX_SPREADSHEET_COLS} colunas foram lidas.`,
    );
  }

  if (rawRows.length === 0) {
    return {
      draft: {
        id: crypto.randomUUID(),
        sourceType: ext,
        filename,
        context: {},
        itens: [],
        warnings: [...warnings, 'Planilha sem cabeçalho ou linhas de dados.'],
        requiresReview: true,
        createdAt: new Date().toISOString(),
      },
      headers: [],
      maskedSampleRows: [],
      unmappedColumns: true,
      rowCount: 0,
      truncated,
    };
  }

  const rawHeaders = rawRows[0]!;
  const headers = rawHeaders.map((h, i) =>
    sanitizeSpreadsheetCell(h.trim() || `Coluna_${i + 1}`),
  );
  const dataRows = rawRows.slice(1);

  const columnToField = new Map<number, CanonicalField>();
  const matchedFields = new Set<CanonicalField>();

  rawHeaders.forEach((header, idx) => {
    const normalized = normalizeCanonicalKey(header);
    const field = HEADER_ALIAS_MAP[normalized];
    if (field && !matchedFields.has(field)) {
      columnToField.set(idx, field);
      matchedFields.add(field);
    }
  });

  const coreFields: CanonicalField[] = [
    'descricao',
    'ncm',
    'nbs',
    'cst',
    'cClassTrib',
    'cAtivSN',
    'baseCalculo',
    'vProd',
  ];
  const coreMatches = coreFields.filter((f) => matchedFields.has(f)).length;
  const unmappedColumns = coreMatches === 0;

  if (unmappedColumns) {
    warnings.push(
      'Colunas da planilha não correspondem ao padrão fiscal canônico; revise o mapeamento de colunas antes de calcular.',
    );
  }

  // Build up to 3 masked & formula-sanitized sample rows for LLM column mapping
  const rawSampleRecords: Record<string, string>[] = dataRows.slice(0, 3).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      record[header] = row[idx] ?? '';
    });
    return record;
  });
  const maskedSampleRows = maskSpreadsheetRowsForLlm(rawSampleRecords).map((row) => {
    const sanitized: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      sanitized[k] = sanitizeSpreadsheetCell(v);
    }
    return sanitized;
  });

  let requiresReview = unmappedColumns || truncated;
  const itens: ExtractionDraftItem[] = dataRows.map((row, idx) => {
    const confidence: Record<string, FieldConfidence> = {};
    const missingFields: string[] = [];
    const item: ExtractionDraftItem = {
      nObj: idx + 1,
      confidence,
      missingFields,
    };

    const aliquotasNominais: AliquotasNominaisInput = {};
    let hasAliquotas = false;

    const assignStringField = (key: 'descricao' | 'ncm' | 'nbs' | 'cst' | 'cClassTrib' | 'cAtivSN' | 'unidade', raw: string, sanitizeText = false) => {
      const val = raw.trim();
      if (!val) {
        return;
      }
      item[key] = sanitizeText ? sanitizeSpreadsheetCell(val) : val;
      confidence[key] = 'high';
    };

    const assignNumericField = (
      key:
        | 'baseCalculo'
        | 'vProd'
        | 'quantidade'
        | 'vFrete'
        | 'vSeg'
        | 'vOutro'
        | 'vDesc'
        | 'vICMS'
        | 'vPIS'
        | 'vCOFINS'
        | 'vIS'
        | 'pIBSSN'
        | 'pCBSSN',
      raw: string,
    ) => {
      if (!raw.trim()) {
        return;
      }
      const normalized = normalizeDecimalString(raw);
      if (normalized !== undefined) {
        item[key] = normalized;
        confidence[key] = 'high';
      } else {
        confidence[key] = 'low';
        requiresReview = true;
      }
    };

    for (const [colIdx, field] of columnToField.entries()) {
      const raw = row[colIdx] ?? '';
      switch (field) {
        case 'descricao':
          assignStringField('descricao', raw, true);
          break;
        case 'ncm':
          assignStringField('ncm', raw);
          break;
        case 'nbs':
          assignStringField('nbs', raw);
          break;
        case 'cst':
          assignStringField('cst', raw);
          break;
        case 'cClassTrib':
          assignStringField('cClassTrib', raw);
          break;
        case 'cAtivSN':
          assignStringField('cAtivSN', raw);
          break;
        case 'unidade':
          assignStringField('unidade', raw, true);
          break;
        case 'baseCalculo':
        case 'vProd':
        case 'quantidade':
        case 'vFrete':
        case 'vSeg':
        case 'vOutro':
        case 'vDesc':
        case 'vICMS':
        case 'vPIS':
        case 'vCOFINS':
        case 'vIS':
        case 'pIBSSN':
        case 'pCBSSN':
          assignNumericField(field, raw);
          break;
        case 'pCBS':
        case 'pIBSUF':
        case 'pIBSMun': {
          const norm = normalizeDecimalString(raw);
          if (norm !== undefined) {
            aliquotasNominais[field] = norm;
            hasAliquotas = true;
          }
          break;
        }
      }
    }

    if (hasAliquotas) {
      item.aliquotasNominais = aliquotasNominais;
    }

    if (!item.baseCalculo && item.vProd) {
      item.baseCalculo = item.vProd;
      confidence.baseCalculo = 'medium';
    }

    if (!item.cst && !item.cAtivSN) {
      missingFields.push('cst');
      confidence.cst = 'missing';
      requiresReview = true;
    }
    if (!item.cClassTrib) {
      missingFields.push('cClassTrib');
      confidence.cClassTrib = 'missing';
      requiresReview = true;
    }
    if (!item.baseCalculo) {
      missingFields.push('baseCalculo');
      confidence.baseCalculo = 'missing';
      requiresReview = true;
    }

    return item;
  });

  const draft: ExtractionDraft = {
    id: crypto.randomUUID(),
    sourceType: ext,
    filename,
    context: {},
    itens,
    warnings,
    requiresReview,
    createdAt: new Date().toISOString(),
  };

  return {
    draft,
    headers,
    maskedSampleRows,
    unmappedColumns,
    rowCount: itens.length,
    truncated,
  };
}

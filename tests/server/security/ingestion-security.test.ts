import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  FileTooLargeError,
  MAX_UPLOAD_BYTES,
  MagicBytesMismatchError,
  UnsupportedFileTypeError,
  XxeRejectedError,
  validateUploadedFile,
} from '../../../src/server/security/file-validator.js';
import {
  maskFiscalPii,
  maskSpreadsheetRowsForLlm,
} from '../../../src/server/security/pii-masker.js';
import {
  createZeroPiiLogger,
  generateRequestId,
} from '../../../src/server/security/zero-pii-logger.js';
import { sanitizeSpreadsheetCell } from '../../../src/server/parsers/spreadsheet-parser.js';
import { exportAuditXlsx } from '../../../src/server/parsers/xlsx-exporter.js';
import type { CalcRunSnapshot, ObservabilidadeRocOutput } from '../../../src/shared/types/fiscal.js';

describe('Security Ingestion Pipeline (Review Focus #3)', () => {
  describe('validateUploadedFile', () => {
    it('rejects files larger than MAX_UPLOAD_BYTES (5 MiB) with FileTooLargeError (413)', () => {
      const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x41);
      try {
        validateUploadedFile(oversized, 'nota.xml', 'application/xml');
        expect.fail('Expected FileTooLargeError');
      } catch (err) {
        expect(err).toBeInstanceOf(FileTooLargeError);
        expect((err as FileTooLargeError).statusCode).toBe(413);
      }
    });

    it('rejects empty buffers with MagicBytesMismatchError (400)', () => {
      try {
        validateUploadedFile(Buffer.alloc(0), 'empty.csv', 'text/csv');
        expect.fail('Expected MagicBytesMismatchError');
      } catch (err) {
        expect(err).toBeInstanceOf(MagicBytesMismatchError);
        expect((err as MagicBytesMismatchError).statusCode).toBe(400);
      }
    });

    it('rejects unsupported file extensions with UnsupportedFileTypeError (415)', () => {
      try {
        validateUploadedFile(Buffer.from('MZ\x90\x00'), 'malware.exe', 'application/octet-stream');
        expect.fail('Expected UnsupportedFileTypeError');
      } catch (err) {
        expect(err).toBeInstanceOf(UnsupportedFileTypeError);
        expect((err as UnsupportedFileTypeError).statusCode).toBe(415);
      }
    });

    it('rejects .exe (MZ) and PNG magic bytes disguised as .xlsx with MagicBytesMismatchError (400)', () => {
      const exeBuf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
      expect(() =>
        validateUploadedFile(
          exeBuf,
          'planilha.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ).toThrow(MagicBytesMismatchError);

      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      expect(() =>
        validateUploadedFile(
          pngHeader,
          'falsa.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ).toThrow(MagicBytesMismatchError);
    });

    it('validates magic bytes for xlsx, pdf, png, jpg/jpeg, webp, csv, and xml and sanitizes filenames', () => {
      const xlsx = validateUploadedFile(
        Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]),
        '../../etc/notas\x00\n2027.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(xlsx.extension).toBe('xlsx');
      expect(xlsx.sanitizedFilename).toBe('notas2027.xlsx');

      const pdf = validateUploadedFile(Buffer.from('%PDF-1.7\n...'), 'fatura.pdf', 'application/pdf');
      expect(pdf.extension).toBe('pdf');
      expect(pdf.detectedMime).toBe('application/pdf');

      const png = validateUploadedFile(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
        'danfe.png',
        'image/png',
      );
      expect(png.extension).toBe('png');

      const jpg = validateUploadedFile(
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]),
        'foto.jpeg',
        'image/jpeg',
      );
      expect(jpg.extension).toBe('jpg');

      const webp = validateUploadedFile(
        Buffer.from('RIFF\x24\x00\x00\x00WEBP'),
        'scan.webp',
        'image/webp',
      );
      expect(webp.extension).toBe('webp');

      const csv = validateUploadedFile(Buffer.from('ncm,valor\n10063021,100.00\n'), 'itens.csv', 'text/csv');
      expect(csv.extension).toBe('csv');

      const xml = validateUploadedFile(
        Buffer.from('\uFEFF  <?xml version="1.0"?><NFe><infNFe/></NFe>'),
        'nfe.xml',
        'application/xml',
      );
      expect(xml.extension).toBe('xml');
    });

    it('rejects XML containing <!DOCTYPE or <!ENTITY (XXE payload) with XxeRejectedError (400)', () => {
      const xxeDoctype = Buffer.from(
        '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><NFe/>',
      );
      try {
        validateUploadedFile(xxeDoctype, 'evil.xml', 'application/xml');
        expect.fail('Expected XxeRejectedError');
      } catch (err) {
        expect(err).toBeInstanceOf(XxeRejectedError);
        expect((err as XxeRejectedError).statusCode).toBe(400);
      }

      const xxeEntity = Buffer.from('<?xml version="1.0"?><!entity xxe "boom"><NFe/>');
      expect(() => validateUploadedFile(xxeEntity, 'evil2.xml', 'application/xml')).toThrow(
        XxeRejectedError,
      );
    });
  });

  describe('maskFiscalPii & maskSpreadsheetRowsForLlm', () => {
    it('redacts 44-digit NF-e access keys, CNPJs, CPFs, emails, and Brazilian phones', () => {
      const input = [
        'Chave 35270312345678000195550010000001231000001234',
        'Chave fmt 3527 0312 3456 7800 0195 5500 1000 0001 2310 0000 1234',
        'CNPJ 12.345.678/0001-95 ou 12345678000195',
        'CPF 123.456.789-00 ou 12345678900',
        'Email fiscal@empresa-teste.com.br',
        'Tel (11) 98765-4321 e +55 11 3333-4444 e +55 11 98765 4321 e (11) 3333 4444',
        'NCM 10063021 NBS 122011200 Valor 100.00',
      ].join(' | ');

      const masked = maskFiscalPii(input);
      expect(masked).not.toContain('35270312345678000195550010000001231000001234');
      expect(masked).not.toContain('3527 0312 3456');
      expect(masked).not.toContain('12.345.678/0001-95');
      expect(masked).not.toContain('12345678000195');
      expect(masked).not.toContain('123.456.789-00');
      expect(masked).not.toContain('12345678900');
      expect(masked).not.toContain('fiscal@empresa-teste.com.br');
      expect(masked).not.toContain('98765-4321');
      expect(masked).not.toContain('3333-4444');
      expect(masked).not.toContain('98765 4321');
      expect(masked).not.toContain('3333 4444');

      expect(masked).toContain('[CHAVE-ACESSO-REDACTED]');
      expect(masked).toContain('[CNPJ-REDACTED]');
      expect(masked).toContain('[CPF-REDACTED]');
      expect(masked).toContain('[EMAIL-REDACTED]');
      expect(masked).toContain('[PHONE-REDACTED]');
      // Non-PII fiscal codes/values remain intact
      expect(masked).toContain('NCM 10063021 NBS 122011200 Valor 100.00');
    });

    it('masks sensitive spreadsheet columns by header name and masks inline PII in other columns', () => {
      const rows = [
        {
          Razao_Social: 'Empresa Secreta Ltda',
          CNPJ_Emitente: '12345678000195',
          Nome_Destinatario: 'João da Silva',
          IE: '110042490114',
          Item_Descricao: 'Arroz branco contato joao@teste.com',
          NCM: '10063021',
        },
      ];

      const masked = maskSpreadsheetRowsForLlm(rows);
      expect(masked).toHaveLength(1);
      expect(masked[0]!.Razao_Social).not.toContain('Empresa Secreta');
      expect(masked[0]!.CNPJ_Emitente).not.toContain('12345678000195');
      expect(masked[0]!.Nome_Destinatario).not.toContain('João');
      expect(masked[0]!.IE).not.toContain('110042490114');
      expect(masked[0]!.Item_Descricao).toContain('Arroz branco');
      expect(masked[0]!.Item_Descricao).toContain('[EMAIL-REDACTED]');
      expect(masked[0]!.NCM).toBe('10063021');
    });
  });

  describe('sanitizeSpreadsheetCell & exportAuditXlsx formula neutralization', () => {
    it('neutralizes formula injection payloads with leading single quote', () => {
      expect(sanitizeSpreadsheetCell("=CMD|'/C calc'!A0")).toBe("'=CMD|'/C calc'!A0");
      expect(sanitizeSpreadsheetCell('+1+1')).toBe("'+1+1");
      expect(sanitizeSpreadsheetCell('-2')).toBe("'-2");
      expect(sanitizeSpreadsheetCell('@SUM(1,2)')).toBe("'@SUM(1,2)");
      expect(sanitizeSpreadsheetCell('\t=1')).toBe("'\t=1");
      expect(sanitizeSpreadsheetCell('\r=1')).toBe("'\r=1");
      expect(sanitizeSpreadsheetCell('Arroz Tipo 1')).toBe('Arroz Tipo 1');
    });

    it('prefixes formula-like strings inside exported exportAuditXlsx cells', async () => {
      const output: ObservabilidadeRocOutput = {
        modo: 'observabilidade',
        dhFatoGerador: '2027-03-10',
        xWarningDadosSimulados: true,
        avisos: ['=HYPERLINK("http://evil.example","clique")'],
        errosGlobais: [],
        itens: [
          {
            nObj: 1,
            estadoItem: 'CALCULO_SIMULADO',
            erros: [],
            descricao: "=CMD|'/C calc'!A0",
            ncm: '10063021',
            cst: '000',
            cClassTrib: '000001',
            memoriaCalculo: [
              {
                tributo: 'CBS',
                baseCalculo: '100.00',
                valorCalculado: '8.80',
                valorDevido: '8.80',
                memoriaTexto: '@SUM(1,2)',
              },
            ],
            fundamentacoesLegais: [
              {
                dispositivo: '+1+1',
                descricao: '-2',
              },
            ],
          },
        ],
      };

      const snapshot: CalcRunSnapshot = {
        id: 'run-sec-1',
        kind: 'regime_regular',
        engineMode: 'local-ts',
        dhFatoGerador: '2027-03-10',
        context: { regime: 'regime-regular', tipoDfe: '55', dhFatoGerador: '2027-03-10', uf: 'SP' },
        input: {},
        output,
        xWarningDadosSimulados: true,
        createdAt: '2027-03-10T12:00:00Z',
      };

      const buf = await exportAuditXlsx(snapshot);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);

      const itensSheet = wb.getWorksheet('Itens');
      expect(itensSheet).toBeDefined();
      const allCellValues: string[] = [];
      wb.eachSheet((ws) => {
        ws.eachRow((row) => {
          row.eachCell((cell) => {
            allCellValues.push(String(cell.value ?? ''));
          });
        });
      });

      expect(allCellValues).toContain("'=CMD|'/C calc'!A0");
      expect(allCellValues).toContain("'=HYPERLINK(\"http://evil.example\",\"clique\")");
      expect(allCellValues).toContain("'@SUM(1,2)");
      expect(allCellValues).toContain("'+1+1");
      expect(allCellValues).toContain("'-2");
    });
  });

  describe('createZeroPiiLogger & generateRequestId', () => {
    it('ignores incoming X-Request-Id and generates fresh 32-char lowercase hex ID', () => {
      const id1 = generateRequestId('attacker-supplied-id-123');
      const id2 = generateRequestId('attacker-supplied-id-123');
      expect(id1).toMatch(/^[0-9a-f]{32}$/);
      expect(id2).toMatch(/^[0-9a-f]{32}$/);
      expect(id1).not.toBe('attacker-supplied-id-123');
      expect(id1).not.toBe(id2);
    });

    it('drops accidental cnpj, cpf, xml, body, prompt, headers, items, file, message fields', () => {
      const lines: string[] = [];
      const logger = createZeroPiiLogger((line) => lines.push(line));

      logger.info({
        request_id: generateRequestId(),
        method: 'POST',
        route: '/api/upload',
        status: 200,
        duration_ms: 42,
        error_type: undefined,
        cnpj: '12345678000195',
        cpf: '12345678900',
        xml: '<NFe><infNFe>segredo</infNFe></NFe>',
        body: { segredo: true },
        prompt: 'Calcule o imposto do CPF 123.456.789-00',
        headers: { authorization: 'Bearer secret' },
        items: [{ descricao: 'Confidencial' }],
        file: 'secret.xml',
        message: 'Raw user message with CNPJ',
      });

      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(
        ['duration_ms', 'level', 'method', 'request_id', 'route', 'status', 'timestamp'].sort(),
      );
      expect(parsed.cnpj).toBeUndefined();
      expect(parsed.cpf).toBeUndefined();
      expect(parsed.xml).toBeUndefined();
      expect(parsed.body).toBeUndefined();
      expect(parsed.prompt).toBeUndefined();
      expect(parsed.headers).toBeUndefined();
      expect(parsed.items).toBeUndefined();
      expect(parsed.file).toBeUndefined();
      expect(parsed.message).toBeUndefined();
      expect(lines[0]).not.toContain('12345678000195');
      expect(lines[0]).not.toContain('segredo');
    });

    it('replaces non-ISO timestamp with a clean server ISO timestamp', () => {
      const lines: string[] = [];
      const logger = createZeroPiiLogger((line) => lines.push(line));
      logger.warn({
        timestamp: 'CNPJ 12.345.678/0001-95 leaked in timestamp',
        request_id: generateRequestId(),
        method: 'GET',
        route: '/api/health',
        status: 200,
      });

      const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(String(parsed.timestamp)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(lines[0]).not.toContain('12.345.678/0001-95');
    });
  });
});

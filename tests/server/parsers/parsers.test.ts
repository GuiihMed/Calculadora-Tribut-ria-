import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseDfeXmlToDraft } from '../../../src/server/parsers/xml-dfe-parser.js';
import { parseSpreadsheetToDraft } from '../../../src/server/parsers/spreadsheet-parser.js';
import { exportAuditXlsx } from '../../../src/server/parsers/xlsx-exporter.js';
import { XxeRejectedError } from '../../../src/server/security/file-validator.js';
import type {
  CalcRunSnapshot,
  ObservabilidadeRocOutput,
} from '../../../src/shared/types/fiscal.js';

describe('DF-e XML Parser, Spreadsheet Parser & Audit XLSX Exporter', () => {
  describe('parseDfeXmlToDraft', () => {
    it('rejects XXE DOCTYPE/ENTITY before parsing XML', () => {
      const evilXml = `<?xml version="1.0"?>
        <!DOCTYPE nfe [<!ENTITY secret SYSTEM "file:///etc/passwd">]>
        <NFe><infNFe><ide><dhEmi>2027-03-10</dhEmi></ide></infNFe></NFe>`;

      expect(() => parseDfeXmlToDraft(evilXml, 'evil.xml')).toThrow(XxeRejectedError);
    });

    it('parses NF-e <nfeProc><NFe><infNFe> preserving leading zeros and extracting IBSCBS and legacy taxes', () => {
      const nfeXml = `<?xml version="1.0" encoding="UTF-8"?>
        <nfeProc versao="4.00">
          <NFe>
            <infNFe Id="NFe35270312345678000195550010000001231000001234">
              <ide>
                <cUF>35</cUF>
                <mod>55</mod>
                <dhEmi>2027-03-10T10:15:00-03:00</dhEmi>
                <cMunFG>3550308</cMunFG>
              </ide>
              <emit>
                <CNPJ>01234567000189</CNPJ>
                <enderEmit><UF>SP</UF></enderEmit>
                <CRT>3</CRT>
              </emit>
              <det nItem="1">
                <prod>
                  <xProd>=CMD|'/C calc'!A0</xProd>
                  <NCM>04011010</NCM>
                  <uCom>KG</uCom>
                  <qCom>10.0000</qCom>
                  <vProd>200.00</vProd>
                  <vFrete>15.00</vFrete>
                  <vSeg>5.00</vSeg>
                  <vOutro>2.00</vOutro>
                  <vDesc>10.00</vDesc>
                </prod>
                <imposto>
                  <ICMS><ICMS00><vBC>200.00</vBC><vICMS>36.00</vICMS></ICMS00></ICMS>
                  <PIS><PISAliq><vPIS>3.30</vPIS></PISAliq></PIS>
                  <COFINS><COFINSAliq><vCOFINS>15.20</vCOFINS></COFINSAliq></COFINS>
                  <IS><vIS>12.00</vIS></IS>
                  <IBSCBS>
                    <CST>000</CST>
                    <cClassTrib>000001</cClassTrib>
                    <gIBSCBS>
                      <vBC>170.00</vBC>
                      <gIBSUF><pIBSUF>0.05</pIBSUF></gIBSUF>
                      <gIBSMun><pIBSMun>0.05</pIBSMun></gIBSMun>
                      <gCBS><pCBS>8.80</pCBS></gCBS>
                    </gIBSCBS>
                  </IBSCBS>
                </imposto>
              </det>
              <det nItem="2">
                <prod>
                  <xProd>Arroz Branco</xProd>
                  <NCM>10063021</NCM>
                  <uCom>KG</uCom>
                  <qCom>20</qCom>
                  <vProd>100.00</vProd>
                </prod>
                <imposto>
                  <ICMS><ICMS00><vICMS>7.00</vICMS></ICMS00></ICMS>
                </imposto>
              </det>
            </infNFe>
          </NFe>
        </nfeProc>`;

      const draft = parseDfeXmlToDraft(nfeXml, 'nota-55.xml');
      expect(draft.sourceType).toBe('xml');
      expect(draft.filename).toBe('nota-55.xml');
      expect(draft.context.dhFatoGerador).toBe('2027-03-10');
      expect(draft.context.tipoDfe).toBe('55');
      expect(draft.context.uf).toBe('SP');
      expect(draft.context.municipio).toBe(3550308);
      expect(draft.context.crt).toBe(3);
      expect(draft.itens).toHaveLength(2);

      const item1 = draft.itens[0]!;
      expect(item1.nObj).toBe(1);
      expect(item1.descricao).toBe("'=CMD|'/C calc'!A0");
      expect(item1.ncm).toBe('04011010'); // Leading zero preserved
      expect(item1.cst).toBe('000');
      expect(item1.cClassTrib).toBe('000001');
      expect(item1.vProd).toBe('200.00');
      expect(item1.vFrete).toBe('15.00');
      expect(item1.vSeg).toBe('5.00');
      expect(item1.vOutro).toBe('2.00');
      expect(item1.vDesc).toBe('10.00');
      expect(item1.vICMS).toBe('36.00');
      expect(item1.vPIS).toBe('3.30');
      expect(item1.vCOFINS).toBe('15.20');
      expect(item1.vIS).toBe('12.00');
      expect(item1.baseCalculo).toBe('170.00');
      expect(item1.aliquotasNominais).toEqual({
        pIBSUF: '0.05',
        pIBSMun: '0.05',
        pCBS: '8.80',
      });

      const item2 = draft.itens[1]!;
      expect(item2.nObj).toBe(2);
      expect(item2.missingFields).toContain('cst');
      expect(item2.missingFields).toContain('cClassTrib');
      expect(draft.requiresReview).toBe(true);
    });

    it('parses NFS-e <NFSe><infNFSe> extracting NBS, service description, values and IBSCBS', () => {
      const nfseXml = `<?xml version="1.0" encoding="UTF-8"?>
        <NFSe versao="1.00">
          <infNFSe Id="NFS3550308120000000001">
            <cLocIncid>3550308</cLocIncid>
            <xUFIncid>SP</xUFIncid>
            <DPS>
              <infDPS>
                <dCompet>2027-04-01</dCompet>
                <serv>
                  <cServ>
                    <cNBS>010203000</cNBS>
                    <xDescServ>Consultoria tributária especializada</xDescServ>
                  </cServ>
                </serv>
                <valores>
                  <vServPrest><vServ>1500.00</vServ></vServPrest>
                </valores>
              </infDPS>
            </DPS>
            <IBSCBS>
              <CST>200</CST>
              <cClassTrib>200028</cClassTrib>
              <valores><vBC>1500.00</vBC></valores>
            </IBSCBS>
          </infNFSe>
        </NFSe>`;

      const draft = parseDfeXmlToDraft(nfseXml, 'nfse.xml');
      expect(draft.context.tipoDfe).toBe('NFSE');
      expect(draft.context.dhFatoGerador).toBe('2027-04-01');
      expect(draft.context.uf).toBe('SP');
      expect(draft.context.municipio).toBe(3550308);
      expect(draft.itens).toHaveLength(1);
      expect(draft.itens[0]!.nbs).toBe('010203000');
      expect(draft.itens[0]!.descricao).toBe('Consultoria tributária especializada');
      expect(draft.itens[0]!.baseCalculo).toBe('1500.00');
      expect(draft.itens[0]!.cst).toBe('200');
      expect(draft.itens[0]!.cClassTrib).toBe('200028');

      const nfseMissingDate = nfseXml.replace('<dCompet>2027-04-01</dCompet>', '');
      const draftNoDate = parseDfeXmlToDraft(nfseMissingDate, 'nfse-sem-data.xml');
      expect(draftNoDate.requiresReview).toBe(true);
      expect(draftNoDate.warnings.some((w) => /data/i.test(w))).toBe(true);
    });
  });

  describe('parseSpreadsheetToDraft', () => {
    it('parses canonical CSV headers and caps at 500 rows with truncated=true warning', async () => {
      const lines = ['descricao,ncm,cst,cClassTrib,baseCalculo,quantidade,unidade'];
      for (let i = 1; i <= 520; i++) {
        const desc = i === 1 ? '=CMD|calc' : `Produto ${i}`;
        lines.push(`${desc},04011010,000,000001,100.00,2,UN`);
      }
      const csvBuf = Buffer.from(lines.join('\n'), 'utf8');

      const result = await parseSpreadsheetToDraft(csvBuf, 'csv', 'lote.csv');
      expect(result.unmappedColumns).toBe(false);
      expect(result.truncated).toBe(true);
      expect(result.draft.itens).toHaveLength(500);
      expect(result.draft.itens[0]!.descricao).toBe("'=CMD|calc");
      expect(result.draft.itens[0]!.ncm).toBe('04011010');
      expect(result.draft.itens[0]!.cst).toBe('000');
      expect(result.draft.itens[0]!.cClassTrib).toBe('000001');
      expect(result.draft.warnings.length).toBeGreaterThan(0);
    });

    it('parses XLSX with >500 rows capped safely and returns 3 masked sample rows when unmapped', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Dados');
      ws.addRow(['Coluna_A', 'Coluna_B', 'CNPJ_Cliente', 'Valor_Coluna']);
      for (let i = 1; i <= 510; i++) {
        ws.addRow([`=SUM(1,2)`, `Item ${i} 123.456.789-00`, '12345678000195', String(i * 10)]);
      }
      const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());

      const result = await parseSpreadsheetToDraft(xlsxBuf, 'xlsx', 'heterogenea.xlsx');
      expect(result.unmappedColumns).toBe(true);
      expect(result.draft.requiresReview).toBe(true);
      expect(result.truncated).toBe(true);
      expect(result.draft.itens.length).toBeLessThanOrEqual(500);
      expect(result.headers).toEqual(['Coluna_A', 'Coluna_B', 'CNPJ_Cliente', 'Valor_Coluna']);
      expect(result.maskedSampleRows).toHaveLength(3);
      expect(result.maskedSampleRows[0]!.Coluna_A).toBe("'=SUM(1,2)");
      expect(result.maskedSampleRows[0]!.Coluna_B).toContain('[CPF-REDACTED]');
      expect(result.maskedSampleRows[0]!.CNPJ_Cliente).not.toContain('12345678000195');
    });

    it('rejects malformed Central Directory, ZIP64 sentinels, and zip-bomb uncompressed sizes in XLSX', async () => {
      // 1. Out-of-bounds cdOffset in EOCD
      const badCdOffsetBuf = Buffer.alloc(64, 0);
      badCdOffsetBuf.write('PK\x03\x04', 0, 'ascii');
      const eocdOffset1 = 42;
      badCdOffsetBuf.writeUInt32LE(0x06054b50, eocdOffset1);
      badCdOffsetBuf.writeUInt16LE(1, eocdOffset1 + 8);
      badCdOffsetBuf.writeUInt16LE(1, eocdOffset1 + 10);
      badCdOffsetBuf.writeUInt32LE(46, eocdOffset1 + 12);
      badCdOffsetBuf.writeUInt32LE(9999, eocdOffset1 + 16); // out of bounds

      await expect(parseSpreadsheetToDraft(badCdOffsetBuf, 'xlsx', 'bad-offset.xlsx')).rejects.toThrow(
        /diretório central/i,
      );

      // 2. cdOffset pointing to non-PK\x01\x02 bytes
      const badCdSigBuf = Buffer.alloc(100, 0);
      badCdSigBuf.write('PK\x03\x04', 0, 'ascii');
      const eocdOffset2 = 78;
      badCdSigBuf.writeUInt32LE(0x06054b50, eocdOffset2);
      badCdSigBuf.writeUInt16LE(1, eocdOffset2 + 8);
      badCdSigBuf.writeUInt16LE(1, eocdOffset2 + 10);
      badCdSigBuf.writeUInt32LE(46, eocdOffset2 + 12);
      badCdSigBuf.writeUInt32LE(10, eocdOffset2 + 16); // points to zeros instead of PK\x01\x02

      await expect(parseSpreadsheetToDraft(badCdSigBuf, 'xlsx', 'bad-sig.xlsx')).rejects.toThrow(
        /assinatura de diretório central/i,
      );

      // 3. ZIP64 sentinel in EOCD (totalEntries === 0xffff)
      const zip64EocdBuf = Buffer.alloc(64, 0);
      zip64EocdBuf.write('PK\x03\x04', 0, 'ascii');
      const eocdOffset3 = 42;
      zip64EocdBuf.writeUInt32LE(0x06054b50, eocdOffset3);
      zip64EocdBuf.writeUInt16LE(0xffff, eocdOffset3 + 10);

      await expect(parseSpreadsheetToDraft(zip64EocdBuf, 'xlsx', 'zip64.xlsx')).rejects.toThrow(
        /ZIP64/i,
      );

      // 4. ZIP64 sentinel in Central Directory entry (uncompressedSize === 0xffffffff)
      const zip64EntryBuf = Buffer.alloc(120, 0);
      zip64EntryBuf.write('PK\x03\x04', 0, 'ascii');
      const cdOffset4 = 30;
      zip64EntryBuf.writeUInt32LE(0x02014b50, cdOffset4);
      zip64EntryBuf.writeUInt32LE(0xffffffff, cdOffset4 + 24);
      const eocdOffset4 = 98;
      zip64EntryBuf.writeUInt32LE(0x06054b50, eocdOffset4);
      zip64EntryBuf.writeUInt16LE(1, eocdOffset4 + 8);
      zip64EntryBuf.writeUInt16LE(1, eocdOffset4 + 10);
      zip64EntryBuf.writeUInt32LE(46, eocdOffset4 + 12);
      zip64EntryBuf.writeUInt32LE(cdOffset4, eocdOffset4 + 16);

      await expect(parseSpreadsheetToDraft(zip64EntryBuf, 'xlsx', 'zip64-entry.xlsx')).rejects.toThrow(
        /ZIP64/i,
      );

      // 5. Zip-bomb (> 50 MiB uncompressed size)
      const zipBombBuf = Buffer.alloc(120, 0);
      zipBombBuf.write('PK\x03\x04', 0, 'ascii');
      const cdOffset5 = 30;
      zipBombBuf.writeUInt32LE(0x02014b50, cdOffset5);
      zipBombBuf.writeUInt32LE(60 * 1024 * 1024, cdOffset5 + 24);
      const eocdOffset5 = 98;
      zipBombBuf.writeUInt32LE(0x06054b50, eocdOffset5);
      zipBombBuf.writeUInt16LE(1, eocdOffset5 + 8);
      zipBombBuf.writeUInt16LE(1, eocdOffset5 + 10);
      zipBombBuf.writeUInt32LE(46, eocdOffset5 + 12);
      zipBombBuf.writeUInt32LE(cdOffset5, eocdOffset5 + 16);

      await expect(parseSpreadsheetToDraft(zipBombBuf, 'xlsx', 'bomb.xlsx')).rejects.toThrow(
        /50 MiB/i,
      );
    });
  });

  describe('exportAuditXlsx', () => {
    it('exports CalcRunSnapshot with 3 sheets (Resumo, Itens, Memoria_Legal)', async () => {
      const output: ObservabilidadeRocOutput = {
        modo: 'observabilidade',
        dhFatoGerador: '2027-03-10',
        xWarningDadosSimulados: true,
        avisos: ['Dados simulados 2027'],
        errosGlobais: [],
        itens: [
          {
            nObj: 1,
            estadoItem: 'CALCULO_SIMULADO',
            erros: [],
            descricao: 'Cerveja pilsen',
            ncm: '22030000',
            cst: '000',
            cClassTrib: '000001',
            gIS: { vBCIS: '165.00', vIS: '15.00' },
            gIBSCBS: {
              CST: '000',
              cClassTrib: '000001',
              vBC: '180.00',
              vIBS: '0.18',
              gIBSUF: { pIBSUF: '0.05', pAliqEfet: '0.05', vIBSUF: '0.09' },
              gIBSMun: { pIBSMun: '0.05', pAliqEfet: '0.05', vIBSMun: '0.09' },
              gCBS: { pCBS: '8.80', pAliqEfet: '8.80', vCBS: '15.84' },
            },
            memoriaCalculo: [
              {
                tributo: 'CBS',
                baseCalculo: '180.00',
                aliquotaNominal: '8.80',
                aliquotaEfetiva: '8.80',
                valorCalculado: '15.84',
                valorDevido: '15.84',
                expressaoAplicada: 'vBC * pCBS',
              },
            ],
            fundamentacoesLegais: [
              {
                codigo: 'LC214',
                dispositivo: 'Art. 12 da LC 214/2025',
                descricao: 'Base de cálculo CBS/IBS',
              },
            ],
          },
        ],
        ISTot: { vIS: '15.00' },
        IBSCBSTot: {
          vBCIBSCBS: '180.00',
          gIBS: { vIBS: '0.18', gIBSUF: { vIBSUF: '0.09' }, gIBSMun: { vIBSMun: '0.09' } },
          gCBS: { vCBS: '15.84' },
        },
      };

      const snapshot: CalcRunSnapshot = {
        id: 'run-export-1',
        kind: 'regime_regular',
        engineMode: 'local-ts',
        dhFatoGerador: '2027-03-10',
        context: {
          regime: 'regime-regular',
          tipoDfe: '55',
          dhFatoGerador: '2027-03-10',
          uf: 'RS',
          municipio: 4314902,
        },
        input: {},
        output,
        xWarningDadosSimulados: true,
        createdAt: '2027-03-10T10:00:00Z',
      };

      const buf = await exportAuditXlsx(snapshot);
      expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);

      expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumo', 'Itens', 'Memoria_Legal']);
      expect(wb.getWorksheet('Resumo')!.rowCount).toBeGreaterThan(2);
      expect(wb.getWorksheet('Itens')!.rowCount).toBeGreaterThanOrEqual(2);
      expect(wb.getWorksheet('Memoria_Legal')!.rowCount).toBeGreaterThanOrEqual(2);
    });
  });
});

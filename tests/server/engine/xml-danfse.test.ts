import type Database from 'better-sqlite3';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DadosAbertosRepository } from '../../../src/server/db/dados-abertos-repo.js';
import { openOficialDbReadOnly } from '../../../src/server/db/oficial-db.js';
import {
  generateDanfsePreviewPdf,
  LOCAL_PREVIEW_NOTICE,
} from '../../../src/server/engine/danfse-preview.js';
import { RegimeRegularEngine } from '../../../src/server/engine/regime-regular-engine.js';
import { SimplesNacionalEngine } from '../../../src/server/engine/simples-nacional-engine.js';
import {
  generateTaxXmlFromCalcRun,
  validateTaxXmlStructure,
} from '../../../src/server/engine/xml-generator.js';
import type { CalcRunSnapshot, OperacaoInput } from '../../../src/shared/types/fiscal.js';

describe('Tax XML Generator, Structure Validator & DANFSe Local PDF Preview', () => {
  let db: Database.Database;
  let repo: DadosAbertosRepository;
  let rr: RegimeRegularEngine;
  let sn: SimplesNacionalEngine;

  beforeAll(() => {
    db = openOficialDbReadOnly();
    repo = new DadosAbertosRepository(db);
    rr = new RegimeRegularEngine(db, repo);
    sn = new SimplesNacionalEngine(db, repo);
  });

  afterAll(() => {
    db.close();
  });

  it('filters out REG-011 item on mixed 4-item Regime Regular snapshot and totals only valid items', () => {
    const operacao: OperacaoInput = {
      id: 'exemplos-md-4-items',
      versao: '1.0.0',
      dhFatoGerador: '2027-03-10T10:00:00-03:00',
      municipio: 4314902,
      uf: 'RS',
      itens: [
        {
          numero: 1,
          ncm: '10063021',
          cst: '200',
          cClassTrib: '200003',
          baseCalculo: 100.0,
          quantidade: 20,
          unidade: 'KG',
          aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
        },
        {
          numero: 2,
          ncm: '22030000',
          cst: '000',
          cClassTrib: '000001',
          baseCalculo: 165.0,
          quantidade: 12,
          unidade: 'LT',
          impostoSeletivo: {
            cstIS: '000',
            cClassTribIS: '000001',
            baseCalculo: 150.0,
            quantidade: 12,
            unidade: 'LT',
            aliquotaAdValorem: 10.0,
            valorInformado: 15.0,
          },
          aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
        },
        {
          numero: 3,
          nbs: '122011200',
          cst: '200',
          cClassTrib: '200028',
          baseCalculo: 1200.0,
          aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
        },
        {
          numero: 4,
          ncm: '02013000',
          cst: '200',
          cClassTrib: '200035',
          baseCalculo: 80.0,
          aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
        },
      ],
    };

    const rocOutput = rr.calculate(operacao, 'observabilidade');
    const snapshot: CalcRunSnapshot = {
      id: 'run-rr-1',
      kind: 'regime_regular',
      engineMode: 'local-ts',
      dhFatoGerador: operacao.dhFatoGerador,
      context: { regime: 'regime-regular', tipoDfe: '55', dhFatoGerador: operacao.dhFatoGerador },
      input: operacao,
      output: rocOutput,
      xWarningDadosSimulados: rocOutput.xWarningDadosSimulados,
      createdAt: '2027-03-10T10:00:00Z',
    };

    const result = generateTaxXmlFromCalcRun(snapshot, 'nfe');

    expect(result.supported).toBe(true);
    expect(result.excludedItems).toHaveLength(1);
    expect(result.excludedItems[0]).toMatchObject({
      nObj: 4,
      code: 'REG-011',
    });
    expect(result.xml).toBeDefined();
    expect(XMLValidator.validate(result.xml!)).toBe(true);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      processEntities: false,
      parseTagValue: false,
    });
    const parsed = parser.parse(result.xml!) as {
      infNFe: {
        det: Array<{ '@_nItem': string; imposto: { IS?: unknown; IBSCBS: unknown } }>;
        total: {
          ISTot?: { vIS: string };
          IBSCBSTot: {
            vBCIBSCBS: string;
            gIBS: { vIBS: string; gIBSUF: { vIBSUF: string }; gIBSMun: { vIBSMun: string } };
            gCBS: { vCBS: string };
          };
        };
      };
    };

    expect(parsed.infNFe.det).toHaveLength(3);
    expect(parsed.infNFe.det.map((d) => d['@_nItem'])).toEqual(['1', '2', '3']);
    expect(parsed.infNFe.det[1]!.imposto.IS).toBeDefined();
    expect(parsed.infNFe.total.ISTot?.vIS).toBe('15.00');
    expect(parsed.infNFe.total.IBSCBSTot.vBCIBSCBS).toBe('1465.00');
    expect(parsed.infNFe.total.IBSCBSTot.gCBS.vCBS).toBe('56.76');
    expect(parsed.infNFe.total.IBSCBSTot.gIBS.vIBS).toBe('0.64');

    const validation = validateTaxXmlStructure(result.xml!, 'nfe', 'nota');
    expect(validation).toEqual({
      valid: true,
      xsdValidationMode: 'structural-local',
      errors: [],
    });
  });

  it('returns supported=false on Simples Nacional CalcRunSnapshot and when 0 valid items remain', () => {
    const snOutput = sn.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 1,
      itens: [
        {
          nObj: 1,
          cAtivSN: '01',
          cClassTrib: '000001',
          baseCalculo: 1000,
          pIBSSN: 0.5,
          pCBSSN: 1.2,
        },
      ],
    });

    const snSnapshot: CalcRunSnapshot = {
      id: 'run-sn-1',
      kind: 'simples_nacional',
      engineMode: 'local-ts',
      dhFatoGerador: '2027-03-10',
      context: { regime: 'simples-nacional', tipoDfe: '55', dhFatoGerador: '2027-03-10' },
      input: {},
      output: snOutput,
      xWarningDadosSimulados: false,
      createdAt: '2027-03-10T10:00:00Z',
    };

    const snXml = generateTaxXmlFromCalcRun(snSnapshot, 'nfe');
    expect(snXml.supported).toBe(false);
    expect(snXml.reason).toContain('Regime Regular');
    expect(snXml.excludedItems).toEqual([]);

    const allFailedOp: OperacaoInput = {
      dhFatoGerador: '2027-03-10',
      itens: [
        {
          numero: 1,
          ncm: '02013000',
          cst: '200',
          cClassTrib: '200035',
          baseCalculo: 80.0,
          aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
        },
      ],
    };
    const allFailedOut = rr.calculate(allFailedOp, 'observabilidade');
    const allFailedSnapshot: CalcRunSnapshot = {
      id: 'run-rr-fail',
      kind: 'regime_regular',
      engineMode: 'local-ts',
      dhFatoGerador: '2027-03-10',
      context: { regime: 'regime-regular', tipoDfe: '55', dhFatoGerador: '2027-03-10' },
      input: allFailedOp,
      output: allFailedOut,
      xWarningDadosSimulados: true,
      createdAt: '2027-03-10T10:00:00Z',
    };

    const emptyXml = generateTaxXmlFromCalcRun(allFailedSnapshot, 'nfe');
    expect(emptyXml.supported).toBe(false);
    expect(emptyXml.excludedItems).toHaveLength(1);
    expect(emptyXml.excludedItems[0]!.code).toBe('REG-011');
  });

  it('rejects DOCTYPE/ENTITY in validateTaxXmlStructure and validates grupo XML', () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><infNFe><det nItem="1"><imposto><IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib></IBSCBS></imposto></det><total/></infNFe>`;
    const resXxe = validateTaxXmlStructure(xxe, 'nfe', 'nota');
    expect(resXxe.valid).toBe(false);
    expect(resXxe.xsdValidationMode).toBe('structural-local');
    expect(resXxe.errors.some((e) => /DOCTYPE|ENTITY/i.test(e))).toBe(true);

    const grupoOk = `<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib></IBSCBS>`;
    expect(validateTaxXmlStructure(grupoOk, 'nfe', 'grupo')).toEqual({
      valid: true,
      xsdValidationMode: 'structural-local',
      errors: [],
    });

    const notaSemTotal = `<infNFe><det nItem="1"><imposto><IBSCBS><CST>000</CST></IBSCBS></imposto></det></infNFe>`;
    const resMissingTotal = validateTaxXmlStructure(notaSemTotal, 'nfe', 'nota');
    expect(resMissingTotal.valid).toBe(false);
    expect(resMissingTotal.errors.length).toBeGreaterThan(0);
  });

  it('generates local DANFSe PDF preview from valid NFSe XML with local preview notice and rejects XXE', async () => {
    const nfseXml = `<NFSe versao="1.00">
      <infNFSe Id="NFS3550308120000000001" dhProc="2027-03-10T10:00:00-03:00">
        <nNFSe>1042</nNFSe>
        <xLocEmi>São Paulo</xLocEmi>
        <xLocIncid>São Paulo</xLocIncid>
        <xUFIncid>SP</xUFIncid>
        <DPS>
          <infDPS>
            <nDPS>42</nDPS>
            <serie>1</serie>
            <dhEmi>2027-03-10T09:55:00-03:00</dhEmi>
            <dCompet>2027-03-10</dCompet>
            <toma>
              <CNPJ>98765432000110</CNPJ>
              <xNome>Tomador Exemplo Ltda</xNome>
            </toma>
            <serv>
              <cServ>
                <cTribNac>010101</cTribNac>
                <cNBS>122011200</cNBS>
                <xDescServ>Serviços educacionais e consultoria técnica especializada</xDescServ>
              </cServ>
            </serv>
            <valores>
              <vServPrest><vServ>1200.00</vServ></vServPrest>
            </valores>
          </infDPS>
        </DPS>
        <emit>
          <CNPJ>12345678000195</CNPJ>
          <xNome>Prestador Modelo S.A.</xNome>
          <enderNac>
            <xLgr>Av Paulista</xLgr>
            <nro>1000</nro>
            <xBairro>Bela Vista</xBairro>
            <xMun>São Paulo</xMun>
            <UF>SP</UF>
            <CEP>01310100</CEP>
          </enderNac>
        </emit>
        <valores>
          <vBC>1200.00</vBC>
          <vLiq>1200.00</vLiq>
        </valores>
        <IBSCBS>
          <valores>
            <vBC>1200.00</vBC>
          </valores>
          <totCIBS>
            <gIBS>
              <vIBSTot>0.48</vIBSTot>
            </gIBS>
            <gCBS>
              <vCBS>42.24</vCBS>
            </gCBS>
            <vTotNF>1242.72</vTotNF>
          </totCIBS>
        </IBSCBS>
      </infNFSe>
    </NFSe>`;

    const pdf = await generateDanfsePreviewPdf(nfseXml, 0, true);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(500);
    expect(LOCAL_PREVIEW_NOTICE).toContain('PRÉVIA LOCAL');
    expect(pdf.toString('latin1')).toContain('PRÉVIA LOCAL');
    expect(pdf.toString('utf8')).toContain(
      'PREVIA LOCAL - Conecte o servico Go/WASM oficial da RFB para o PDF oficial',
    );

    const pdfCancelledNoCanhoto = await generateDanfsePreviewPdf(nfseXml, 1, false);
    expect(pdfCancelledNoCanhoto.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const xxeNfse = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><NFSe><infNFSe Id="1"/></NFSe>`;
    await expect(generateDanfsePreviewPdf(xxeNfse, 0, true)).rejects.toThrow(/DOCTYPE|ENTITY/i);
  });
});

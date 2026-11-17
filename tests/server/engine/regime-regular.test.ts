import fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openOficialDbReadOnly } from '../../../src/server/db/oficial-db.js';
import { DadosAbertosRepository } from '../../../src/server/db/dados-abertos-repo.js';
import { lookupErrorDescription } from '../../../src/server/engine/error-catalog.js';
import { RegimeRegularEngine } from '../../../src/server/engine/regime-regular-engine.js';
import { OperacaoInputSchema, type OperacaoInput } from '../../../src/shared/types/fiscal.js';

describe('Error Catalog & Regime Regular Engine (LocalTsEngine Part 1)', () => {
  let db: Database.Database;
  let repo: DadosAbertosRepository;
  let engine: RegimeRegularEngine;

  beforeAll(() => {
    db = openOficialDbReadOnly();
    repo = new DadosAbertosRepository(db);
    engine = new RegimeRegularEngine(db, repo);
  });

  afterAll(() => {
    db.close();
  });

  it('resolves REG-*, VAL-*, CAL-*, and VSN-* entries from the official error catalog', () => {
    const reg011 = lookupErrorDescription('REG-011');
    expect(reg011).not.toBeNull();
    expect(reg011?.titulo).toBe('NCM não vinculada');

    const reg036 = lookupErrorDescription('REG-036');
    expect(reg036).not.toBeNull();
    expect(reg036?.codigo).toBe('REG-036');

    const val001 = lookupErrorDescription('VAL-001');
    expect(val001?.titulo).toBe('Campo obrigatório não informado');

    const cal007 = lookupErrorDescription('CAL-007');
    expect(cal007?.estadoDefault).toBe('NAO_IMPLEMENTADO');

    const vsn023 = lookupErrorDescription('VSN-023');
    expect(vsn023?.codigo).toBe('VSN-023');

    expect(lookupErrorDescription('UNKNOWN-999')).toBeNull();
  });

  it('reproduces exact 4-item operation from RFB docs/exemplos.md with exact rounding and unrounded totalization', () => {
    const operacao: OperacaoInput = {
      id: '6194602ea71cbf9431c236de4409d920',
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

    const result = engine.calculate(operacao, 'observabilidade');

    expect(result.modo).toBe('observabilidade');
    expect(result.xWarningDadosSimulados).toBe(true);
    expect(result.errosGlobais).toHaveLength(0);
    expect(result.itens).toHaveLength(4);

    // Item 1: Cesta básica (100% reduction)
    const item1 = result.itens[0]!;
    expect(item1.nObj).toBe(1);
    expect(item1.estadoItem).toBe('CALCULO_SIMULADO');
    expect(item1.gIBSCBS?.vBC).toBe('100.00');
    expect(item1.gIBSCBS?.gIBSUF?.pRedAliq).toBe('100.00');
    expect(item1.gIBSCBS?.gIBSUF?.pAliqEfet).toBe('0.00');
    expect(item1.gIBSCBS?.vIBS).toBe('0.00');
    expect(item1.gIBSCBS?.gCBS?.vCBS).toBe('0.00');
    expect(item1.creditIndicators).toEqual(repo.getCreditIndicators('200003', '2027-03-10'));
    expect(item1.splitPaymentGuidance?.aplicavel).toBe(false);
    expect(item1.splitPaymentGuidance?.vCbsSujeito).toBe('0.00');
    expect(item1.splitPaymentGuidance?.vIbsSujeito).toBe('0.00');

    // Item 2: Cerveja com Imposto Seletivo (150 * 10% = 15.00; BC CBS/IBS = 165.00)
    const item2 = result.itens[1]!;
    expect(item2.nObj).toBe(2);
    expect(item2.estadoItem).toBe('CALCULO_SIMULADO');
    expect(item2.gIS?.vBCIS).toBe('150.00');
    expect(item2.gIS?.pIS).toBe('10.00');
    expect(item2.gIS?.vIS).toBe('15.00');
    expect(item2.gIBSCBS?.vBC).toBe('165.00');
    expect(item2.gIBSCBS?.gCBS?.vCBS).toBe('14.52');
    expect(item2.gIBSCBS?.gIBSUF?.vIBSUF).toBe('0.08');
    expect(item2.gIBSCBS?.gIBSMun?.vIBSMun).toBe('0.08');
    expect(item2.gIBSCBS?.vIBS).toBe('0.16');
    expect(item2.creditIndicators).toEqual(repo.getCreditIndicators('000001', '2027-03-10'));
    expect(item2.splitPaymentGuidance?.aplicavel).toBe(true);
    expect(item2.splitPaymentGuidance?.vCbsSujeito).toBe('14.52');
    expect(item2.splitPaymentGuidance?.vIbsSujeito).toBe('0.16');
    expect(item2.splitPaymentGuidance?.orientacao).toContain('14.52');
    expect(item2.splitPaymentGuidance?.orientacao).toContain('0.16');
    expect(item2.splitPaymentGuidance?.orientacao).not.toMatch(/\d+\s*%/);

    // Item 3: Educação NBS 122011200 (60% reduction)
    const item3 = result.itens[2]!;
    expect(item3.nObj).toBe(3);
    expect(item3.estadoItem).toBe('CALCULO_SIMULADO');
    expect(item3.gIBSCBS?.vBC).toBe('1200.00');
    expect(item3.gIBSCBS?.gIBSUF?.pRedAliq).toBe('60.00');
    expect(item3.gIBSCBS?.gIBSUF?.pAliqEfet).toBe('0.02');
    expect(item3.gIBSCBS?.gIBSUF?.vIBSUF).toBe('0.24');
    expect(item3.gIBSCBS?.gIBSMun?.pRedAliq).toBe('60.00');
    expect(item3.gIBSCBS?.gIBSMun?.pAliqEfet).toBe('0.02');
    expect(item3.gIBSCBS?.gIBSMun?.vIBSMun).toBe('0.24');
    expect(item3.gIBSCBS?.vIBS).toBe('0.48');
    expect(item3.gIBSCBS?.gCBS?.pRedAliq).toBe('60.00');
    expect(item3.gIBSCBS?.gCBS?.pAliqEfet).toBe('3.52');
    expect(item3.gIBSCBS?.gCBS?.vCBS).toBe('42.24');
    expect(item3.creditIndicators).toEqual(repo.getCreditIndicators('200028', '2027-03-10'));
    expect(item3.fundamentacoesLegais.length).toBeGreaterThan(0);
    expect(item3.memoriaCalculo.length).toBeGreaterThanOrEqual(3);
    expect(item3.splitPaymentGuidance?.vCbsSujeito).toBe('42.24');
    expect(item3.splitPaymentGuidance?.vIbsSujeito).toBe('0.48');

    // Item 4: NCM 02013000 não vinculada à cClassTrib 200035
    const item4 = result.itens[3]!;
    expect(item4.nObj).toBe(4);
    expect(item4.estadoItem).toBe('INCONSISTENCIA_ENTRADA');
    expect(item4.erros[0]?.code).toBe('REG-011');
    expect(item4.erros[0]?.pointer).toBe('#/itens/3/ncm');

    // Totals match exemplos.md (unrounded accumulation: 0.0825+0.0825+0.24+0.24 = 0.645 -> HALF_EVEN 0.64)
    expect(result.ISTot?.vIS).toBe('15.00');
    expect(result.IBSCBSTot?.vBCIBSCBS).toBe('1465.00');
    expect(result.IBSCBSTot?.gIBS.vIBS).toBe('0.64');
    expect(result.IBSCBSTot?.gIBS.gIBSUF.vIBSUF).toBe('0.32');
    expect(result.IBSCBSTot?.gIBS.gIBSMun.vIBSMun).toBe('0.32');
    expect(result.IBSCBSTot?.gCBS.vCBS).toBe('56.76');
    expect(result.splitPaymentGuidance?.vCbsSujeito).toBe('56.76');
    expect(result.splitPaymentGuidance?.vIbsSujeito).toBe('0.64');

    // Strict mode rejects partial totals when any item fails
    const strictResult = engine.calculate(operacao, 'estrito');
    expect(strictResult.modo).toBe('estrito');
    expect(strictResult.ISTot).toBeUndefined();
    expect(strictResult.IBSCBSTot).toBeUndefined();
    expect(strictResult.errosGlobais.some((e) => e.code === 'REG-011')).toBe(true);
  });

  it('derives CBS/IBS base from IS base + IS when baseCalculo is omitted on IS items (exemplos.md raw input)', () => {
    const rawBeer = OperacaoInputSchema.parse({
      id: 'beer-derived',
      versao: '1.0.0',
      dhFatoGerador: '2027-03-10T10:00:00-03:00',
      municipio: 4314902,
      uf: 'RS',
      itens: [
        {
          numero: 1,
          ncm: '22030000',
          cst: '000',
          cClassTrib: '000001',
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
      ],
    });

    const result = engine.calculate(rawBeer, 'observabilidade');
    const item1 = result.itens[0]!;
    expect(item1.estadoItem).toBe('CALCULO_SIMULADO');
    expect(item1.gIS?.vIS).toBe('15.00');
    expect(item1.gIBSCBS?.vBC).toBe('165.00');
    expect(item1.gIBSCBS?.gCBS?.vCBS).toBe('14.52');
  });

  it('pins 2026-12-31T23:59:59-03:00 vs 2027-01-01T00:00:00-03:00 temporal nominal rate boundary', () => {
    // 1) 2026-12-31T23:59:59-03:00 WITH aliquotasNominais -> error REG-036 (manual nominal rates prohibited before 2027)
    const pre2027WithManual: OperacaoInput = {
      dhFatoGerador: '2026-12-31T23:59:59-03:00',
      municipio: 4314902,
      uf: 'RS',
      itens: [
        {
          ncm: '10063021',
          cst: '000',
          cClassTrib: '000001',
          baseCalculo: 100.0,
          aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
        },
      ],
    };
    const resPreManual = engine.calculate(pre2027WithManual, 'observabilidade');
    expect(resPreManual.itens[0]?.estadoItem).toBe('INCONSISTENCIA_ENTRADA');
    expect(resPreManual.itens[0]?.erros[0]?.code).toBe('REG-036');

    // 2) 2026-12-31T23:59:59-03:00 WITHOUT aliquotasNominais -> uses 2026 DB reference rates (CALCULADO, no xWarningDadosSimulados)
    const pre2027Auto: OperacaoInput = {
      dhFatoGerador: '2026-12-31T23:59:59-03:00',
      municipio: 4314902,
      uf: 'RS',
      itens: [
        {
          ncm: '10063021',
          cst: '000',
          cClassTrib: '000001',
          baseCalculo: 1000.0,
        },
      ],
    };
    const resPreAuto = engine.calculate(pre2027Auto, 'observabilidade');
    expect(resPreAuto.xWarningDadosSimulados).toBe(false);
    expect(resPreAuto.itens[0]?.estadoItem).toBe('CALCULADO');
    expect(resPreAuto.itens[0]?.gIBSCBS?.gCBS?.pCBS).toBe('0.90');
    expect(resPreAuto.itens[0]?.gIBSCBS?.gCBS?.vCBS).toBe('9.00');
    expect(resPreAuto.itens[0]?.gIBSCBS?.gIBSUF?.pIBSUF).toBe('0.10');
    expect(resPreAuto.itens[0]?.gIBSCBS?.gIBSUF?.vIBSUF).toBe('1.00');
    expect(resPreAuto.itens[0]?.gIBSCBS?.gIBSMun?.pIBSMun).toBe('0.00');
    expect(resPreAuto.itens[0]?.gIBSCBS?.gIBSMun?.vIBSMun).toBe('0.00');
    expect(resPreAuto.itens[0]?.gIBSCBS?.vIBS).toBe('1.00');

    // 3) 2027-01-01T00:00:00-03:00 WITHOUT aliquotasNominais on CST 000 -> REG-037
    const post2027Missing: OperacaoInput = {
      dhFatoGerador: '2027-01-01T00:00:00-03:00',
      municipio: 4314902,
      uf: 'RS',
      itens: [
        {
          ncm: '10063021',
          cst: '000',
          cClassTrib: '000001',
          baseCalculo: 100.0,
        },
      ],
    };
    const resPostMissing = engine.calculate(post2027Missing, 'observabilidade');
    expect(resPostMissing.xWarningDadosSimulados).toBe(true);
    expect(resPostMissing.itens[0]?.estadoItem).toBe('INCONSISTENCIA_ENTRADA');
    expect(resPostMissing.itens[0]?.erros[0]?.code).toBe('REG-037');

    // 4) 2027-01-01T00:00:00-03:00 WITHOUT aliquotasNominais on CST 410 (Sem alíquota / SITR_IND_GIBSCBS=0) -> CALCULADO
    const post2027SemAliquota: OperacaoInput = {
      dhFatoGerador: '2027-01-01T00:00:00-03:00',
      municipio: 4314902,
      uf: 'RS',
      itens: [
        {
          ncm: '10063021',
          cst: '410',
          cClassTrib: '410001',
          baseCalculo: 200.0,
        },
      ],
    };
    const resSemAliq = engine.calculate(post2027SemAliquota, 'observabilidade');
    expect(resSemAliq.itens[0]?.estadoItem).toBe('CALCULADO');
    expect(resSemAliq.itens[0]?.gIBSCBS).toBeUndefined();
  });

  it('returns NAO_IMPLEMENTADO (CAL-007) when TRTR_IN_POSSUI_AJUSTE = 1', () => {
    const op: OperacaoInput = {
      dhFatoGerador: '2027-03-10T10:00:00-03:00',
      municipio: 4314902,
      uf: 'RS',
      itens: [
        {
          ncm: '27101259',
          cst: '620',
          cClassTrib: '620001',
          baseCalculo: 200.0,
        },
      ],
    };

    const result = engine.calculate(op, 'observabilidade');
    expect(result.itens[0]?.estadoItem).toBe('NAO_IMPLEMENTADO');
    expect(result.itens[0]?.erros[0]?.code).toBe('CAL-007');
  });

  it('validates REG-006 (CST mismatch), REG-015 (incomplete NCM), REG-026 (IS base inconsistency), REG-018, REG-021, and tpEnteGov=1', () => {
    // REG-006 without NCM/NBS
    const cstMismatch = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            cst: '000',
            cClassTrib: '200003',
            baseCalculo: 100,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(cstMismatch.itens[0]?.erros[0]?.code).toBe('REG-006');

    // REG-015 incomplete NCM for classification with NCM annex
    const incompleteNcm = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '1006',
            cst: '200',
            cClassTrib: '200003',
            baseCalculo: 100,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(incompleteNcm.itens[0]?.erros[0]?.code).toBe('REG-015');

    // REG-026 inconsistent baseCalculo with IS valorInformado
    const inconsistentIsBc = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '22030000',
            cst: '000',
            cClassTrib: '000001',
            baseCalculo: 150,
            impostoSeletivo: {
              cstIS: '000',
              cClassTribIS: '000001',
              baseCalculo: 150,
              aliquotaAdValorem: 10,
              valorInformado: 15,
            },
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(inconsistentIsBc.itens[0]?.erros[0]?.code).toBe('REG-026');

    // REG-018 municipio does not belong to UF
    const badMuniUf = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'SP',
        itens: [
          {
            ncm: '10063021',
            cst: '000',
            cClassTrib: '000001',
            baseCalculo: 100,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(badMuniUf.errosGlobais[0]?.code).toBe('REG-018');

    // REG-021 invalid calendar date
    const badDate = engine.calculate(
      {
        dhFatoGerador: '2027-02-30T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '10063021',
            cst: '000',
            cClassTrib: '000001',
            baseCalculo: 100,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(badDate.errosGlobais[0]?.code).toBe('REG-021');

    // Compra Governamental tpEnteGov = 1 (União) absorbs IBS into CBS in 2027+
    const compraGovUniao = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        tpEnteGov: 1,
        pRedCompraGov: 0,
        itens: [
          {
            ncm: '10063021',
            cst: '000',
            cClassTrib: '000001',
            baseCalculo: 1000,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    const cgItem = compraGovUniao.itens[0]!;
    expect(cgItem.estadoItem).toBe('CALCULO_SIMULADO');
    expect(cgItem.gIBSCBS?.vIBS).toBe('0.00');
    expect(cgItem.gIBSCBS?.gCBS?.pAliqEfet).toBe('8.90');
    expect(cgItem.gIBSCBS?.gCBS?.vCBS).toBe('89.00');
  });

  it('calculates diferimento (510001 and 515001) preserving pre-deferral valorCalculado and deducting valorDiferimento once', () => {
    // 510001 (TRTR_ID = 20): 100% deferral in 2027 with manual rates
    const dif510 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '10063021',
            cst: '510',
            cClassTrib: '510001',
            baseCalculo: 1000,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    const item510 = dif510.itens[0]!;
    expect(item510.estadoItem).toBe('CALCULO_SIMULADO');
    expect(item510.gIBSCBS?.gCBS?.vCBS).toBe('0.00');
    expect(item510.gIBSCBS?.gCBS?.vDif).toBe('88.00');
    expect(item510.gIBSCBS?.gIBSUF?.vIBSUF).toBe('0.00');
    expect(item510.gIBSCBS?.gIBSUF?.vDif).toBe('0.50');
    expect(item510.gIBSCBS?.gIBSMun?.vIBSMun).toBe('0.00');
    expect(item510.gIBSCBS?.gIBSMun?.vDif).toBe('0.50');
    expect(item510.gIBSCBS?.vIBS).toBe('0.00');
    expect(dif510.IBSCBSTot?.gCBS.vCBS).toBe('0.00');
    expect(dif510.IBSCBSTot?.gCBS.vDif).toBe('88.00');
    expect(dif510.IBSCBSTot?.gIBS.gIBSUF.vDif).toBe('0.50');
    expect(dif510.IBSCBSTot?.gIBS.gIBSMun.vDif).toBe('0.50');

    const memCbs510 = item510.memoriaCalculo.find((m) => m.tributo === 'CBS');
    const memUf510 = item510.memoriaCalculo.find((m) => m.tributo === 'IBSUF');
    const memMun510 = item510.memoriaCalculo.find((m) => m.tributo === 'IBSMun');
    expect(memCbs510?.valorCalculado).toBe('88.00');
    expect(memCbs510?.valorDiferimento).toBe('88.00');
    expect(memCbs510?.valorDevido).toBe('0.00');
    expect(memUf510?.valorCalculado).toBe('0.50');
    expect(memMun510?.valorCalculado).toBe('0.50');

    // 515001 (TRTR_ID = 21): 60% reduction + 100% deferral in 2026
    const dif515 = engine.calculate(
      {
        dhFatoGerador: '2026-06-01T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '31010000',
            cst: '515',
            cClassTrib: '515001',
            baseCalculo: 1000,
          },
        ],
      },
      'observabilidade',
    );
    const item515 = dif515.itens[0]!;
    expect(item515.estadoItem).toBe('CALCULADO');
    expect(item515.gIBSCBS?.gCBS?.pRedAliq).toBe('60.00');
    expect(item515.gIBSCBS?.gCBS?.pAliqEfet).toBe('0.36');
    expect(item515.gIBSCBS?.gCBS?.vDif).toBe('3.60');
    expect(item515.gIBSCBS?.gCBS?.vCBS).toBe('0.00');
    expect(item515.gIBSCBS?.gIBSUF?.pRedAliq).toBe('60.00');
    expect(item515.gIBSCBS?.gIBSUF?.pAliqEfet).toBe('0.04');
    expect(item515.gIBSCBS?.gIBSUF?.vDif).toBe('0.40');
    expect(item515.gIBSCBS?.gIBSUF?.vIBSUF).toBe('0.00');
    const memCbs515 = item515.memoriaCalculo.find((m) => m.tributo === 'CBS');
    expect(memCbs515?.valorCalculado).toBe('3.60');
    expect(memCbs515?.valorDiferimento).toBe('3.60');
    expect(memCbs515?.valorDevido).toBe('0.00');

    // Partial deferral regression guard on cloned DB (e.g. 40% deferral: valorCalculado 88.00, vDif 35.20, valorDevido 52.80)
    const memDb = new Database(fs.readFileSync('data/rtc-oficial.db'));
    try {
      memDb
        .prepare(
          `UPDATE TRATAMENTO_TRIBUTARIO
           SET TRTR_EXPRESSAO_PERCENTUAL_DIFERIMENTO = '0.40',
               TRTR_EXPRESSAO_VALOR_DIFERIMENTO = 'tributoCalculado*0.40'
           WHERE TRTR_ID = 20`,
        )
        .run();
      const memEngine = new RegimeRegularEngine(memDb);
      const partialRes = memEngine.calculate(
        {
          dhFatoGerador: '2027-03-10T10:00:00-03:00',
          municipio: 4314902,
          uf: 'RS',
          itens: [
            {
              ncm: '10063021',
              cst: '510',
              cClassTrib: '510001',
              baseCalculo: 1000,
              aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
            },
          ],
        },
        'observabilidade',
      );
      const pItem = partialRes.itens[0]!;
      expect(pItem.gIBSCBS?.gCBS?.vDif).toBe('35.20');
      expect(pItem.gIBSCBS?.gCBS?.vCBS).toBe('52.80');
      expect(pItem.memoriaCalculo.find((m) => m.tributo === 'CBS')?.valorCalculado).toBe('88.00');
      expect(pItem.gIBSCBS?.gIBSUF?.vDif).toBe('0.20');
      expect(pItem.gIBSCBS?.gIBSUF?.vIBSUF).toBe('0.30');
    } finally {
      memDb.close();
    }
  });

  it("evaluates expressaoAliquota = '0' even when aliquotasNominais is supplied", () => {
    // 820001 (TRTR_ID = 32, expressaoAliquota = '0') with nominal rates supplied
    const res820 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            nbs: '122011200',
            cst: '820',
            cClassTrib: '820001',
            baseCalculo: 1000,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(res820.itens[0]?.estadoItem).toBe('CALCULO_SIMULADO');
    expect(res820.itens[0]?.gIBSCBS).toBeUndefined();

    // Verify TRTR_EXPRESSAO_ALIQUOTA = '0' forces resultadoAliquota = 0 even when SITR_IND_GIBSCBS = 1 and aliquotasNominais is present
    const memDb = new Database(fs.readFileSync('data/rtc-oficial.db'));
    try {
      memDb.prepare(`UPDATE SITUACAO_TRIBUTARIA SET SITR_IND_GIBSCBS = 1 WHERE SITR_CD = '820'`).run();
      const memEngine = new RegimeRegularEngine(memDb);
      const resZeroExpr = memEngine.calculate(
        {
          dhFatoGerador: '2027-03-10T10:00:00-03:00',
          municipio: 4314902,
          uf: 'RS',
          itens: [
            {
              nbs: '122011200',
              cst: '820',
              cClassTrib: '820001',
              baseCalculo: 1000,
              aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
            },
          ],
        },
        'observabilidade',
      );
      const itemZero = resZeroExpr.itens[0]!;
      expect(itemZero.gIBSCBS?.gCBS?.pCBS).toBe('0.00');
      expect(itemZero.gIBSCBS?.gCBS?.pAliqEfet).toBe('0.00');
      expect(itemZero.gIBSCBS?.gCBS?.vCBS).toBe('0.00');
      expect(itemZero.gIBSCBS?.gIBSUF?.pIBSUF).toBe('0.00');
      expect(itemZero.gIBSCBS?.gIBSUF?.vIBSUF).toBe('0.00');
      expect(itemZero.gIBSCBS?.vIBS).toBe('0.00');
    } finally {
      memDb.close();
    }
  });

  it('handles desoneracao / tributacaoRegular (550001, 200022, REG-009, REG-010, and 550023 -> CAL-007)', () => {
    // Valid 550001 suspension with tributacaoRegular 000001
    const res550 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '10063021',
            cst: '550',
            cClassTrib: '550001',
            baseCalculo: 1000,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
            tributacaoRegular: { cst: '000', cClassTrib: '000001' },
          },
        ],
      },
      'observabilidade',
    );
    expect(res550.itens[0]?.estadoItem).toBe('CALCULO_SIMULADO');
    expect(res550.itens[0]?.gIBSCBS?.CST).toBe('550');
    expect(res550.itens[0]?.gIBSCBS?.cClassTrib).toBe('550001');
    expect(res550.itens[0]?.gIBSCBS?.gCBS?.pCBS).toBe('0.00');
    expect(res550.itens[0]?.gIBSCBS?.gCBS?.vCBS).toBe('0.00');
    expect(res550.itens[0]?.gIBSCBS?.vIBS).toBe('0.00');

    // Valid 200022 ZFM desoneration with tributacaoRegular 000001
    const res200022 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '10063021',
            cst: '200',
            cClassTrib: '200022',
            baseCalculo: 1000,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
            tributacaoRegular: { cst: '000', cClassTrib: '000001' },
          },
        ],
      },
      'observabilidade',
    );
    expect(res200022.itens[0]?.estadoItem).toBe('CALCULO_SIMULADO');
    expect(res200022.itens[0]?.gIBSCBS?.gCBS?.vCBS).toBe('0.00');
    expect(res200022.itens[0]?.gIBSCBS?.vIBS).toBe('0.00');

    // REG-009: missing tributacaoRegular on 550001
    const resReg009 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '10063021',
            cst: '550',
            cClassTrib: '550001',
            baseCalculo: 1000,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(resReg009.itens[0]?.estadoItem).toBe('INCONSISTENCIA_ENTRADA');
    expect(resReg009.itens[0]?.erros[0]?.code).toBe('REG-009');

    // REG-010: tributacaoRegular points to classification incompatible with suspension (550001)
    const resReg010 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '10063021',
            cst: '550',
            cClassTrib: '550001',
            baseCalculo: 1000,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
            tributacaoRegular: { cst: '550', cClassTrib: '550001' },
          },
        ],
      },
      'observabilidade',
    );
    expect(resReg010.itens[0]?.estadoItem).toBe('INCONSISTENCIA_ENTRADA');
    expect(resReg010.itens[0]?.erros[0]?.code).toBe('REG-010');

    // 550023 (TRTR_ID = 41, both inExigeGrupoDesoneracao=1 and inPossuiAjuste=1) -> CAL-007 / NAO_IMPLEMENTADO
    const res550023 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '27101259',
            cst: '550',
            cClassTrib: '550023',
            baseCalculo: 1000,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
            tributacaoRegular: { cst: '000', cClassTrib: '000001' },
          },
        ],
      },
      'observabilidade',
    );
    expect(res550023.itens[0]?.estadoItem).toBe('NAO_IMPLEMENTADO');
    expect(res550023.itens[0]?.erros[0]?.code).toBe('CAL-007');
  });

  it('validates tipoDfe rules (55, 65, NFSE, REG-028..REG-033, DERE -> CAL-007)', () => {
    // Valid tpDoc = 55 (NF-e) and tpDoc = 65 (NFC-e)
    for (const tpDoc of [55, 65] as const) {
      const okNfe = engine.calculate(
        {
          dhFatoGerador: '2027-03-10T10:00:00-03:00',
          municipio: 4314902,
          uf: 'RS',
          tipoDfe: tpDoc,
          itens: [
            {
              ncm: '10063021',
              cst: '200',
              cClassTrib: '200003',
              baseCalculo: 100,
              aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
            },
          ],
        },
        'observabilidade',
      );
      expect(okNfe.errosGlobais).toHaveLength(0);
      expect(okNfe.itens[0]?.estadoItem).toBe('CALCULO_SIMULADO');
    }

    // Valid tpDoc = 'NFSE'
    const okNfse = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        tipoDfe: 'NFSE',
        itens: [
          {
            nbs: '122011200',
            cst: '200',
            cClassTrib: '200028',
            baseCalculo: 1200,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(okNfse.errosGlobais).toHaveLength(0);
    expect(okNfse.itens[0]?.gIBSCBS?.gCBS?.vCBS).toBe('42.24');

    // REG-028: invalid or out-of-vigencia tipoDfe
    const badTpDoc = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        tipoDfe: 99,
        itens: [
          {
            ncm: '10063021',
            cst: '000',
            cClassTrib: '000001',
            baseCalculo: 100,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(badTpDoc.errosGlobais[0]?.code).toBe('REG-028');

    // REG-029: classification not linked to tipoDfe (200028 is NFS-e only, rejected on NF-e 55)
    const unlinkedDfe = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        tipoDfe: 55,
        itens: [
          {
            nbs: '122011200',
            cst: '200',
            cClassTrib: '200028',
            baseCalculo: 100,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(unlinkedDfe.itens[0]?.erros[0]?.code).toBe('REG-029');

    // REG-030: incompatible nomenclature (NBS supplied for NCM-only 200003 on NF-e 55; NCM supplied on NFSE)
    const reg030NfeNbs = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        tipoDfe: 55,
        itens: [
          {
            nbs: '122011200',
            cst: '200',
            cClassTrib: '200003',
            baseCalculo: 100,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(reg030NfeNbs.itens[0]?.erros[0]?.code).toBe('REG-030');

    const reg030NfseNcm = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        tipoDfe: 'NFSE',
        itens: [
          {
            ncm: '10063021',
            cst: '000',
            cClassTrib: '000001',
            baseCalculo: 100,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(reg030NfseNcm.itens[0]?.erros[0]?.code).toBe('REG-030');

    // REG-031 is RIGIDO-only in RFB ValidacaoNomenclaturaService (ProcessamentoItemService uses PERMISSIVO)
    expect(lookupErrorDescription('REG-031')?.codigo).toBe('REG-031');

    // REG-032: IS item on non-IS DFe (NFCom 62)
    const reg032 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        tipoDfe: 62,
        itens: [
          {
            ncm: '22030000',
            cst: '000',
            cClassTrib: '000001',
            baseCalculo: 165,
            impostoSeletivo: {
              cstIS: '000',
              cClassTribIS: '000001',
              baseCalculo: 150,
              aliquotaAdValorem: 10,
              valorInformado: 15,
            },
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(reg032.itens[0]?.erros[0]?.code).toBe('REG-032');

    // REG-033: MISTO classification (200043) on NFSE with neither NCM nor NBS provided
    const reg033 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        tipoDfe: 'NFSE',
        itens: [
          {
            cst: '200',
            cClassTrib: '200043',
            baseCalculo: 100,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(reg033.itens[0]?.erros[0]?.code).toBe('REG-033');

    // DERE -> CAL-007 (unimplemented document type)
    const dereRes = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        tipoDfe: 'DERE',
        itens: [
          {
            nbs: '122011200',
            cst: '010',
            cClassTrib: '010001',
            baseCalculo: 100,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(dereRes.errosGlobais[0]?.code).toBe('CAL-007');
    expect(lookupErrorDescription('CAL-007')?.estadoDefault).toBe('NAO_IMPLEMENTADO');
  });

  it('validates NBS annex errors (REG-012 and REG-016) and missing baseCalculo without IS (REG-025)', () => {
    // REG-012: valid 9-digit NBS not in 200028 annex
    const reg012 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            nbs: '109052100',
            cst: '200',
            cClassTrib: '200028',
            baseCalculo: 100,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(reg012.itens[0]?.erros[0]?.code).toBe('REG-012');

    // REG-016: incomplete NBS and omitted NBS for 200028
    const reg016Incomplete = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            nbs: '12201',
            cst: '200',
            cClassTrib: '200028',
            baseCalculo: 100,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(reg016Incomplete.itens[0]?.erros[0]?.code).toBe('REG-016');

    const reg016Omitted = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            cst: '200',
            cClassTrib: '200028',
            baseCalculo: 100,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(reg016Omitted.itens[0]?.erros[0]?.code).toBe('REG-016');

    // REG-025: runtime error when baseCalculo is omitted without impostoSeletivo
    const reg025 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '10063021',
            cst: '000',
            cClassTrib: '000001',
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(reg025.itens[0]?.erros[0]?.code).toBe('REG-025');
  });

  it('calculates 2026 fictitious CSTs (010, 221, and 220 -> CAL-007)', () => {
    // CST 010 (010001): 2026 DB uniform rates CBS 0.90%, IBSUF 0.10%, IBSMun 0.00%
    const res010 = engine.calculate(
      {
        dhFatoGerador: '2026-06-01T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            nbs: '122011200',
            cst: '010',
            cClassTrib: '010001',
            baseCalculo: 1000,
          },
        ],
      },
      'observabilidade',
    );
    expect(res010.itens[0]?.estadoItem).toBe('CALCULADO');
    expect(res010.itens[0]?.gIBSCBS?.gCBS?.pCBS).toBe('0.90');
    expect(res010.itens[0]?.gIBSCBS?.gCBS?.vCBS).toBe('9.00');
    expect(res010.itens[0]?.gIBSCBS?.gIBSUF?.pIBSUF).toBe('0.10');
    expect(res010.itens[0]?.gIBSCBS?.gIBSUF?.vIBSUF).toBe('1.00');

    // CST 221 (221001, TRTR_ID 43 Alíquota fixa fictícia): CBS 3.285%, IBSUF 0.365%, IBSMun 0.00%
    const res221 = engine.calculate(
      {
        dhFatoGerador: '2026-06-01T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            nbs: '122011200',
            cst: '221',
            cClassTrib: '221001',
            baseCalculo: 1000,
          },
        ],
      },
      'observabilidade',
    );
    expect(res221.itens[0]?.estadoItem).toBe('CALCULADO');
    expect(res221.itens[0]?.gIBSCBS?.gCBS?.pCBS).toBe('3.285');
    expect(res221.itens[0]?.gIBSCBS?.gCBS?.vCBS).toBe('32.85');
    expect(res221.itens[0]?.gIBSCBS?.gIBSUF?.pIBSUF).toBe('0.365');
    expect(res221.itens[0]?.gIBSCBS?.gIBSUF?.vIBSUF).toBe('3.65');
    expect(res221.itens[0]?.gIBSCBS?.gIBSMun?.vIBSMun).toBe('0.00');

    // CST 220 (220001 on 2026-01-01, TRTR_ID 34 has TRTR_IN_POSSUI_AJUSTE = 1) -> CAL-007 / NAO_IMPLEMENTADO
    const res220 = engine.calculate(
      {
        dhFatoGerador: '2026-01-01T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '10063021',
            cst: '220',
            cClassTrib: '220001',
            baseCalculo: 1000,
          },
        ],
      },
      'observabilidade',
    );
    expect(res220.itens[0]?.estadoItem).toBe('NAO_IMPLEMENTADO');
    expect(res220.itens[0]?.erros[0]?.code).toBe('CAL-007');
  });

  it('applies Compra Governamental CBS transfer for tpEnteGov 2, 3, and 4 in 2029+ (10% transfer)', () => {
    for (const tpEnteGov of [2, 3, 4] as const) {
      const res = engine.calculate(
        {
          dhFatoGerador: '2029-03-10T10:00:00-03:00',
          municipio: 4314902,
          uf: 'RS',
          tpEnteGov,
          pRedCompraGov: 0,
          itens: [
            {
              ncm: '10063021',
              cst: '000',
              cClassTrib: '000001',
              baseCalculo: 1000,
              aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
            },
          ],
        },
        'observabilidade',
      );
      const item = res.itens[0]!;
      expect(item.gIBSCBS?.gCBS?.pAliqEfet).toBe('7.92');
      expect(item.gIBSCBS?.gCBS?.vCBS).toBe('79.20');
      expect(item.gIBSCBS?.vIBS).toBe('9.80');
      if (tpEnteGov === 4) {
        expect(item.gIBSCBS?.gIBSUF?.pAliqEfet).toBe('0.00');
        expect(item.gIBSCBS?.gIBSUF?.vIBSUF).toBe('0.00');
        expect(item.gIBSCBS?.gIBSMun?.pAliqEfet).toBe('0.98');
        expect(item.gIBSCBS?.gIBSMun?.vIBSMun).toBe('9.80');
      } else {
        expect(item.gIBSCBS?.gIBSUF?.pAliqEfet).toBe('0.98');
        expect(item.gIBSCBS?.gIBSUF?.vIBSUF).toBe('9.80');
        expect(item.gIBSCBS?.gIBSMun?.pAliqEfet).toBe('0.00');
        expect(item.gIBSCBS?.gIBSMun?.vIBSMun).toBe('0.00');
      }
    }
  });

  it('validates Imposto Seletivo adRem, REG-035, REG-013, and REG-014', () => {
    // IS adRem on tobacco NCM 24021000 (2027)
    const adRemRes = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '24021000',
            cst: '000',
            cClassTrib: '000001',
            impostoSeletivo: {
              cstIS: '000',
              cClassTribIS: '000001',
              baseCalculo: 200,
              quantidade: 10,
              unidade: 'MIL',
              aliquotaAdRem: 21.3,
            },
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    const adRemItem = adRemRes.itens[0]!;
    expect(adRemItem.estadoItem).toBe('CALCULO_SIMULADO');
    expect(adRemItem.gIS?.pISEspec).toBe('21.30');
    expect(adRemItem.gIS?.qTrib).toBe('10');
    expect(adRemItem.gIS?.uTrib).toBe('MIL');
    expect(adRemItem.gIS?.vIS).toBe('213.00');
    expect(adRemItem.gIBSCBS?.vBC).toBe('413.00');

    // REG-035: NCM 87032100 has IS incidence in 2027 (rate null in DB), grupo IS sent without manual rate
    const reg035 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '87032100',
            cst: '000',
            cClassTrib: '000001',
            baseCalculo: 50000,
            impostoSeletivo: {
              cstIS: '000',
              cClassTribIS: '000001',
              baseCalculo: 50000,
            },
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(reg035.itens[0]?.erros[0]?.code).toBe('REG-035');

    // REG-013: NCM 87032100 in 2027 without impostoSeletivo group
    const reg013 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '87032100',
            cst: '000',
            cClassTrib: '000001',
            baseCalculo: 50000,
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(reg013.itens[0]?.erros[0]?.code).toBe('REG-013');

    // REG-014: impostoSeletivo (with valorInformado, no manual rates) on non-IS NCM 10063021 must raise REG-014, not silently subtract from vBC
    const reg014 = engine.calculate(
      {
        dhFatoGerador: '2027-03-10T10:00:00-03:00',
        municipio: 4314902,
        uf: 'RS',
        itens: [
          {
            ncm: '10063021',
            cst: '000',
            cClassTrib: '000001',
            baseCalculo: 110,
            impostoSeletivo: {
              cstIS: '000',
              cClassTribIS: '000001',
              baseCalculo: 100,
              valorInformado: 10,
            },
            aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          },
        ],
      },
      'observabilidade',
    );
    expect(reg014.itens[0]?.estadoItem).toBe('INCONSISTENCIA_ENTRADA');
    expect(reg014.itens[0]?.erros[0]?.code).toBe('REG-014');
  });
});

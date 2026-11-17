import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openOficialDbReadOnly } from '../../../src/server/db/oficial-db.js';
import { DadosAbertosRepository } from '../../../src/server/db/dados-abertos-repo.js';
import { lookupErrorDescription } from '../../../src/server/engine/error-catalog.js';
import { RegimeRegularEngine } from '../../../src/server/engine/regime-regular-engine.js';
import type { OperacaoInput } from '../../../src/shared/types/fiscal.js';

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
    const rawBeer = {
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
    } as unknown as OperacaoInput;

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
});

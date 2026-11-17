import type Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DadosAbertosRepository } from '../../../src/server/db/dados-abertos-repo.js';
import { openOficialDbReadOnly } from '../../../src/server/db/oficial-db.js';
import { compareRegimes } from '../../../src/server/engine/compare-regimes.js';
import { RegimeRegularEngine } from '../../../src/server/engine/regime-regular-engine.js';
import { SimplesNacionalEngine } from '../../../src/server/engine/simples-nacional-engine.js';
import type { CompareRegimesInput } from '../../../src/shared/types/fiscal.js';

describe('compareRegimes (Regime Regular vs Simples CRT=1 vs Simples Híbrido vs CRT=2)', () => {
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

  it('rejects pre-2027 dates with elegivel=false explaining Simples Nacional NT 2026.005 starts on 2027-01-01', () => {
    const input: CompareRegimesInput = {
      dhFatoGerador: '2026-06-01',
      tpDoc: 55,
      uf: 'RS',
      municipio: 4314902,
      itens: [
        {
          nObj: 1,
          ncm: '10063021',
          cst: '000',
          cClassTrib: '000001',
          cAtivSN: '01',
          baseCalculo: 1000,
          aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          pIBSSN: 0.5,
          pCBSSN: 1.2,
        },
      ],
    };

    const result = compareRegimes(input, rr, sn);

    expect(result.elegivel).toBe(false);
    expect(result.motivoInelegibilidade).toBeTruthy();
    expect(result.motivoInelegibilidade).toContain('2027-01-01');
    expect(result.motivoInelegibilidade).toContain('NT 2026.005');
    expect(result.dhFatoGerador).toBe('2026-06-01');
    expect(result.avisos.length).toBeGreaterThan(0);
  });

  it('runs Regime Regular, Simples CRT=1, and Simples Híbrido side by side on >= 2027-01-01', () => {
    const input: CompareRegimesInput = {
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      uf: 'RS',
      municipio: 4314902,
      itens: [
        {
          nObj: 1,
          descricao: 'Mercadoria tributada integralmente',
          ncm: '10063021',
          cst: '000',
          cClassTrib: '000001',
          cAtivSN: '01',
          baseCalculo: 1000,
          aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          pIBSSN: 0.5,
          pCBSSN: 1.2,
        },
      ],
    };

    const result = compareRegimes(input, rr, sn);

    expect(result.elegivel).toBe(true);
    expect(result.cenarios.map((c) => c.cenario)).toEqual([
      'regime_regular',
      'simples_crt1',
      'simples_hibrido',
    ]);

    const rrScenario = result.cenarios[0]!;
    expect(rrScenario.totalIS).toBe('0.00');
    expect(rrScenario.totalCBS).toBe('88.00');
    expect(rrScenario.totalIBS).toBe('1.00');
    expect(rrScenario.totalTributos).toBe('89.00');
    expect(rrScenario.erros).toHaveLength(0);
    expect(rrScenario.apropriacaoCreditoAdquirente).toMatch(/CBS.*IBS/i);

    const crt1Scenario = result.cenarios[1]!;
    expect(crt1Scenario.totalIS).toBe('0.00');
    expect(crt1Scenario.totalCBS).toBe('12.00');
    expect(crt1Scenario.totalIBS).toBe('5.00');
    expect(crt1Scenario.totalTributos).toBe('17.00');
    expect(crt1Scenario.erros).toHaveLength(0);
    expect(crt1Scenario.apropriacaoCreditoAdquirente).toMatch(/DAS|efetiva/i);

    const hibridoScenario = result.cenarios[2]!;
    expect(hibridoScenario.totalIS).toBe('0.00');
    expect(hibridoScenario.totalCBS).toBe('88.00');
    expect(hibridoScenario.totalIBS).toBe('1.00');
    expect(hibridoScenario.totalTributos).toBe('89.00');
    expect(hibridoScenario.erros).toHaveLength(0);
    expect(hibridoScenario.observacoes.some((o) => o.includes('VSN-019'))).toBe(true);
    expect(hibridoScenario.apropriacaoCreditoAdquirente).toMatch(/integral|B2B/i);
  });

  it('applies base bridge for Imposto Seletivo (RR derives 165.00 while SN receives 150.00 + vIS=15.00 with TRBS_IN_IS_COMPOE_RECEITA=0)', () => {
    const input: CompareRegimesInput = {
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      uf: 'RS',
      municipio: 4314902,
      itens: [
        {
          nObj: 1,
          descricao: 'Cerveja com Imposto Seletivo',
          ncm: '22030000',
          cst: '000',
          cClassTrib: '000001',
          cAtivSN: '01',
          baseCalculo: 150.0,
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
          pIBSSN: 0.5,
          pCBSSN: 1.2,
        },
      ],
    };

    const result = compareRegimes(input, rr, sn);

    expect(result.elegivel).toBe(true);

    const rrScenario = result.cenarios.find((c) => c.cenario === 'regime_regular')!;
    expect(rrScenario.erros).toHaveLength(0);
    expect(rrScenario.totalIS).toBe('15.00');
    expect(rrScenario.totalCBS).toBe('14.52');
    expect(rrScenario.totalIBS).toBe('0.16');
    expect(rrScenario.totalTributos).toBe('29.68');
    if (rrScenario.detalhe && 'itens' in rrScenario.detalhe && 'gIBSCBS' in rrScenario.detalhe.itens[0]!) {
      expect(rrScenario.detalhe.itens[0]!.gIBSCBS?.vBC).toBe('165.00');
      expect(rrScenario.detalhe.itens[0]!.gIS?.vIS).toBe('15.00');
    }

    const crt1Scenario = result.cenarios.find((c) => c.cenario === 'simples_crt1')!;
    expect(crt1Scenario.erros).toHaveLength(0);
    expect(crt1Scenario.totalIS).toBe('15.00');
    // 150.00 * 1.20% = 1.80; 150.00 * 0.50% = 0.75; IS = 15.00 -> total = 17.55
    expect(crt1Scenario.totalCBS).toBe('1.80');
    expect(crt1Scenario.totalIBS).toBe('0.75');
    expect(crt1Scenario.totalTributos).toBe('17.55');
    if (crt1Scenario.detalhe && 'totais' in crt1Scenario.detalhe) {
      expect(crt1Scenario.detalhe.itens[0]!.vBC).toBe('150.00');
      expect(crt1Scenario.detalhe.itens[0]!.vRBSNitem).toBe('150.00');
    }
    expect(
      [...result.avisos, ...crt1Scenario.observacoes].some((m) =>
        m.includes('TRBS_IN_IS_COMPOE_RECEITA'),
      ),
    ).toBe(true);
  });

  it('includes optional CRT=2 sublimite scenario combining Simples CBS + Regime Regular IBS', () => {
    const input: CompareRegimesInput = {
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      uf: 'RS',
      municipio: 4314902,
      incluirSublimiteCrt2: true,
      itens: [
        {
          nObj: 1,
          ncm: '10063021',
          cst: '000',
          cClassTrib: '000001',
          cAtivSN: '01',
          baseCalculo: 1000,
          aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
          pIBSSN: null,
          pCBSSN: 2.75,
        },
      ],
    };

    const result = compareRegimes(input, rr, sn);

    expect(result.elegivel).toBe(true);
    expect(result.cenarios.map((c) => c.cenario)).toEqual([
      'regime_regular',
      'simples_crt1',
      'simples_hibrido',
      'sublimite_crt2',
    ]);

    const crt2 = result.cenarios.find((c) => c.cenario === 'sublimite_crt2')!;
    expect(crt2.erros).toHaveLength(0);
    expect(crt2.totalCBS).toBe('27.50');
    expect(crt2.totalIBS).toBe('1.00');
    expect(crt2.totalIS).toBe('0.00');
    expect(crt2.totalTributos).toBe('28.50');
    expect(crt2.observacoes.some((o) => o.includes('RASN_IN_GERA_IBS'))).toBe(true);
  });

  it('never fabricates missing Simples rates (propagates VSN-004/VSN-006)', () => {
    const input: CompareRegimesInput = {
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      uf: 'RS',
      municipio: 4314902,
      itens: [
        {
          nObj: 1,
          ncm: '22030000',
          cst: '000',
          cClassTrib: '000001',
          cAtivSN: '01',
          baseCalculo: 1000,
          aliquotasNominais: { pCBS: 8.8, pIBSUF: 0.05, pIBSMun: 0.05 },
        },
      ],
    };

    const result = compareRegimes(input, rr, sn);
    const crt1 = result.cenarios.find((c) => c.cenario === 'simples_crt1')!;
    expect(crt1.erros.some((e) => e.code === 'VSN-004')).toBe(true);
    expect(crt1.erros.some((e) => e.code === 'VSN-006')).toBe(true);
  });
});

import type Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DadosAbertosRepository } from '../../../src/server/db/dados-abertos-repo.js';
import { openOficialDbReadOnly } from '../../../src/server/db/oficial-db.js';
import { calculateFatorRAuxiliar } from '../../../src/server/engine/fator-r.js';
import { SimplesNacionalEngine } from '../../../src/server/engine/simples-nacional-engine.js';
import type { OperacaoSimplesInput } from '../../../src/shared/types/fiscal.js';

describe('Simples Nacional Engine (NT 2026.005 v1.00) & Fator R', () => {
  let db: Database.Database;
  let repo: DadosAbertosRepository;
  let engine: SimplesNacionalEngine;

  beforeAll(() => {
    db = openOficialDbReadOnly();
    repo = new DadosAbertosRepository(db);
    engine = new SimplesNacionalEngine(db, repo);
  });

  afterAll(() => {
    db.close();
  });

  it('calculates CRT=1 item on 2027-03-10 with pIBSSN=0.5 and pCBSSN=1.2', () => {
    const input: OperacaoSimplesInput = {
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
    };

    const result = engine.calculate(input);

    expect(result.errosGlobais).toHaveLength(0);
    expect(result.itens).toHaveLength(1);
    const item = result.itens[0]!;
    expect(item.estadoItem).toBe('CALCULADO');
    expect(item.vBC).toBe('1000.00');
    expect(item.pIBSSN).toBe('0.50');
    expect(item.pCBSSN).toBe('1.20');
    expect(item.vIBSSN).toBe('5.00');
    expect(item.vCBSSN).toBe('12.00');
    expect(item.vIBSPendSusp).toBe('0.00');
    expect(item.vCBSPendSusp).toBe('0.00');
    expect(item.totalItem).toBe('17.00');
    expect(item.fundamentacoesLegais.length).toBeGreaterThan(0);
    expect(result.totais.vIBSSN).toBe('5.00');
    expect(result.totais.vCBSSN).toBe('12.00');
    expect(result.totais.totalGeral).toBe('17.00');
    expect(result.splitPaymentGuidance?.aplicavel).toBe(true);
  });

  it('suppresses IBS fields for CRT=2 (RASN_IN_GERA_IBS = 0) while calculating CBS', () => {
    const result = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 2,
      itens: [
        {
          nObj: 1,
          cAtivSN: '01',
          cClassTrib: '000001',
          baseCalculo: 1000,
          pIBSSN: null,
          pCBSSN: 2.75,
        },
      ],
    });

    expect(result.errosGlobais).toHaveLength(0);
    const item = result.itens[0]!;
    expect(item.estadoItem).toBe('CALCULADO');
    expect(item.vBC).toBe('1000.00');
    expect(item.pIBSSN).toBeNull();
    expect(item.vIBSSN).toBeNull();
    expect(item.vIBSPendSusp).toBeNull();
    expect(item.pCBSSN).toBe('2.75');
    expect(item.vCBSSN).toBe('27.50');
    expect(item.vCBSPendSusp).toBe('0.00');
    expect(item.totalItem).toBe('27.50');
    expect(result.totais.vIBSSN).toBe('0.00');
    expect(result.totais.vCBSSN).toBe('27.50');
  });

  it('applies literal ZERO destination in V0050 for CRT=3 + tpRegimeIBSCBS=2 with indirect export (tpRBSN=4)', () => {
    const result = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 3,
      tpRegimeIBSCBS: 2,
      itens: [
        {
          nObj: 1,
          cAtivSN: '01',
          cClassTrib: '550001', // tpRBSN=4 (exportacao indireta)
          baseCalculo: 1000,
          pIBSSN: 1.25,
          pCBSSN: 2.75,
        },
      ],
    });

    expect(result.errosGlobais).toHaveLength(0);
    const item = result.itens[0]!;
    expect(item.estadoItem).toBe('CALCULADO');
    expect(item.vIBSSN).toBe('0.00');
    expect(item.vCBSSN).toBe('0.00');
    expect(item.vIBSPendSusp).toBe('0.00');
    expect(item.vCBSPendSusp).toBe('0.00');
    expect(item.totalItem).toBe('0.00');
  });

  it('routes CRT=3 + tpRegimeIBSCBS=2 internal revenue (tpRBSN=1) to pendenteSuspenso', () => {
    const result = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 3,
      tpRegimeIBSCBS: 2,
      itens: [
        {
          nObj: 1,
          cAtivSN: '01',
          cClassTrib: '000001',
          baseCalculo: 1000,
          pIBSSN: 1.25,
          pCBSSN: 2.75,
        },
      ],
    });

    const item = result.itens[0]!;
    expect(item.estadoItem).toBe('CALCULADO');
    expect(item.vIBSSN).toBe('0.00');
    expect(item.vIBSPendSusp).toBe('12.50');
    expect(item.vCBSSN).toBe('0.00');
    expect(item.vCBSPendSusp).toBe('27.50');
    expect(item.totalItem).toBe('0.00');
    expect(result.totais.vIBSPendSusp).toBe('12.50');
    expect(result.totais.vCBSPendSusp).toBe('27.50');
  });

  it('applies compra governamental displacement for tpEnteGov=1 (União) and tpEnteGov=2 (transition factor 0 in 2027, 0.1 in 2029)', () => {
    const uniao = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 1,
      tpEnteGov: 1,
      itens: [
        {
          nObj: 1,
          cAtivSN: '01',
          cClassTrib: '000001',
          baseCalculo: 1000,
          pIBSSN: 1.25,
          pCBSSN: 2.75,
        },
      ],
    });
    const itemUniao = uniao.itens[0]!;
    expect(itemUniao.pIBSSN).toBe('0.00');
    expect(itemUniao.vIBSSN).toBe('0.00');
    expect(itemUniao.pCBSSN).toBe('4.00');
    expect(itemUniao.vCBSSN).toBe('40.00');

    const estado2027 = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 1,
      tpEnteGov: 2,
      itens: [
        {
          nObj: 1,
          cAtivSN: '01',
          cClassTrib: '000001',
          baseCalculo: 1000,
          pIBSSN: 1.25,
          pCBSSN: 2.75,
        },
      ],
    });
    expect(estado2027.itens[0]!.pIBSSN).toBe('1.25');
    expect(estado2027.itens[0]!.vIBSSN).toBe('12.50');
    expect(estado2027.itens[0]!.pCBSSN).toBe('2.75');
    expect(estado2027.itens[0]!.vCBSSN).toBe('27.50');

    const estado2029 = engine.calculate({
      dhFatoGerador: '2029-03-10',
      tpDoc: 55,
      CRT: 1,
      tpEnteGov: 2,
      itens: [
        {
          nObj: 1,
          cAtivSN: '01',
          cClassTrib: '000001',
          baseCalculo: 1000,
          pIBSSN: 1.25,
          pCBSSN: 2.75,
        },
      ],
    });
    // f = 0.10 => pIBS' = 1.25 + 0.275 = 1.525, pCBS' = 0.90 * 2.75 = 2.475
    expect(estado2029.itens[0]!.pIBSSN).toBe('1.525');
    expect(estado2029.itens[0]!.vIBSSN).toBe('15.25');
    expect(estado2029.itens[0]!.pCBSSN).toBe('2.475');
    expect(estado2029.itens[0]!.vCBSSN).toBe('24.75');
  });

  it('returns global errors VSN-026 for pre-2027 date and VSN-019 for tpRegimeIBSCBS=1', () => {
    const pre2027 = engine.calculate({
      dhFatoGerador: '2026-12-31',
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
    expect(pre2027.errosGlobais.some((e) => e.code === 'VSN-026')).toBe(true);
    expect(pre2027.itens).toHaveLength(0);

    const outOfScope = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 1,
      tpRegimeIBSCBS: 1,
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
    expect(outOfScope.errosGlobais.some((e) => e.code === 'VSN-019')).toBe(true);
    expect(outOfScope.itens).toHaveLength(0);
  });

  it('returns VSN-023 for cAtivSN=90 with tpRBSN=1 and NAO_IMPLEMENTADO (VSN-027) for TRTR_IN_POSSUI_AJUSTE=1', () => {
    const vsn023 = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 1,
      itens: [
        {
          nObj: 1,
          cAtivSN: '90',
          cClassTrib: '000001', // tpRBSN = 1
          baseCalculo: 1000,
          pIBSSN: 0.5,
          pCBSSN: 1.2,
        },
      ],
    });
    expect(vsn023.errosGlobais).toHaveLength(0);
    expect(vsn023.itens[0]!.estadoItem).toBe('INCONSISTENCIA_ENTRADA');
    expect(vsn023.itens[0]!.erros.some((e) => e.code === 'VSN-023')).toBe(true);

    const vsn027 = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 1,
      itens: [
        {
          nObj: 1,
          cAtivSN: '01',
          cClassTrib: '620001', // TRTR_IN_POSSUI_AJUSTE = 1
          baseCalculo: 1000,
          pIBSSN: null,
          pCBSSN: null,
        },
      ],
    });
    expect(vsn027.errosGlobais).toHaveLength(0);
    expect(vsn027.itens[0]!.estadoItem).toBe('NAO_IMPLEMENTADO');
    expect(vsn027.itens[0]!.erros.some((e) => e.code === 'VSN-027')).toBe(true);
  });

  it('handles unlinked/unknown cAtivSN as NAO_CALCULADO without errors and resolves Fator R modes', () => {
    const naoCalculado = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 1,
      itens: [
        {
          nObj: 1,
          cAtivSN: '09', // NFS-e only (tpDoc 91), inadmissible on NF-e (55)
          cClassTrib: '000001',
          baseCalculo: 1000,
          pIBSSN: 0.5,
          pCBSSN: 1.2,
        },
      ],
    });
    expect(naoCalculado.errosGlobais).toHaveLength(0);
    expect(naoCalculado.itens[0]!.estadoItem).toBe('NAO_CALCULADO');
    expect(naoCalculado.itens[0]!.erros).toHaveLength(0);
    expect(naoCalculado.itens[0]!.modoFatorR).toBe('OPCIONAL');
    expect(naoCalculado.itens[0]!.vIBSSN).toBeNull();
    expect(naoCalculado.itens[0]!.vCBSSN).toBeNull();

    const nfseFatorR = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 91,
      CRT: 1,
      itens: [
        {
          nObj: 1,
          cAtivSN: '09',
          cClassTrib: '000001',
          baseCalculo: 1000,
          pIBSSN: 0.5,
          pCBSSN: 1.2,
        },
      ],
    });
    expect(nfseFatorR.itens[0]!.estadoItem).toBe('CALCULADO');
    expect(nfseFatorR.itens[0]!.modoFatorR).toBe('OPCIONAL');
  });

  it('calculates auxiliary Fator R ratio (Anexo III >= 0.28 vs Anexo V < 0.28) with legal disclaimer', () => {
    const anexoIII = calculateFatorRAuxiliar('280000', '1000000');
    expect(anexoIII.fatorR).toBe('0.28');
    expect(anexoIII.enquadramentoSugerido).toBe('Anexo III');
    expect(anexoIII.avisoLegal.length).toBeGreaterThan(20);

    const anexoV = calculateFatorRAuxiliar('279999', '1000000');
    expect(anexoV.fatorR).toBe('0.279999');
    expect(anexoV.enquadramentoSugerido).toBe('Anexo V');
    expect(anexoV.avisoLegal.length).toBeGreaterThan(20);

    const indisponivel = calculateFatorRAuxiliar('10000', '0');
    expect(indisponivel.enquadramentoSugerido).toBe('INDISPONIVEL');
  });

  it('handles tpRBSN=5 (50% factor), tpRBSN=2 (rates dispensed), tpRBSN=0 with cAtivSN=90, IS pass-through, and CRT=2 + tpEnteGov=1', () => {
    // tpRBSN=5 (222001 on tpDoc=67 CT-e OS with cAtivSN=05): fatorReceita = 0.5
    const rbsn5 = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 67,
      CRT: 1,
      itens: [
        {
          nObj: 1,
          cAtivSN: '05',
          cClassTrib: '222001',
          baseCalculo: 1000,
          pIBSSN: 1.25,
          pCBSSN: 2.75,
        },
      ],
    });
    expect(rbsn5.itens[0]!.estadoItem).toBe('CALCULADO');
    expect(rbsn5.itens[0]!.vBC).toBe('500.00');
    expect(rbsn5.itens[0]!.vIBSSN).toBe('6.25');
    expect(rbsn5.itens[0]!.vCBSSN).toBe('13.75');

    // tpRBSN=2 (410008) with null rates dispensed -> CALCULADO with 0.00
    const rbsn2 = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 1,
      itens: [
        {
          nObj: 1,
          cAtivSN: '01',
          cClassTrib: '410008',
          baseCalculo: 1000,
          pIBSSN: null,
          pCBSSN: null,
        },
      ],
    });
    expect(rbsn2.itens[0]!.estadoItem).toBe('CALCULADO');
    expect(rbsn2.itens[0]!.pIBSSN).toBeNull();
    expect(rbsn2.itens[0]!.pCBSSN).toBeNull();
    expect(rbsn2.itens[0]!.vIBSSN).toBe('0.00');
    expect(rbsn2.itens[0]!.vCBSSN).toBe('0.00');

    // tpRBSN=0 (410001) with cAtivSN='90' -> allowed & CALCULADO with 0.00
    const rbsn0 = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 1,
      itens: [
        {
          nObj: 1,
          cAtivSN: '90',
          cClassTrib: '410001',
          baseCalculo: 1000,
          pIBSSN: null,
          pCBSSN: null,
        },
      ],
    });
    expect(rbsn0.itens[0]!.estadoItem).toBe('CALCULADO');
    expect(rbsn0.itens[0]!.vRBSNitem).toBe('0.00');
    expect(rbsn0.itens[0]!.vIBSSN).toBe('0.00');
    expect(rbsn0.itens[0]!.vCBSSN).toBe('0.00');

    // IS pass-through outside vRBSNitem, unrounded totalization: 11.875 + 26.125 + 50 = 88.00
    const withIs = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 1,
      itens: [
        {
          nObj: 1,
          cAtivSN: '01',
          cClassTrib: '000001',
          baseCalculo: 950,
          valorImpostoSeletivo: 50,
          pIBSSN: 1.25,
          pCBSSN: 2.75,
        },
      ],
    });
    expect(withIs.itens[0]!.vIBSSN).toBe('11.88');
    expect(withIs.itens[0]!.vCBSSN).toBe('26.12');
    expect(withIs.itens[0]!.totalItem).toBe('88.00');

    // CRT=2 + tpEnteGov=1 uses pIBSSN as input for pCBS' = pCBS + pIBS, still suppresses IBS output
    const crt2Uniao = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 2,
      tpEnteGov: 1,
      itens: [
        {
          nObj: 1,
          cAtivSN: '01',
          cClassTrib: '000001',
          baseCalculo: 1000,
          pIBSSN: 1.25,
          pCBSSN: 2.75,
        },
      ],
    });
    expect(crt2Uniao.itens[0]!.pIBSSN).toBeNull();
    expect(crt2Uniao.itens[0]!.vIBSSN).toBeNull();
    expect(crt2Uniao.itens[0]!.pCBSSN).toBe('4.00');
    expect(crt2Uniao.itens[0]!.vCBSSN).toBe('40.00');
  });

  it('aggregates totals only from CALCULADO items in mixed-state operations', () => {
    const mixed = engine.calculate({
      dhFatoGerador: '2027-03-10',
      tpDoc: 55,
      CRT: 1,
      itens: [
        {
          nObj: 1,
          cAtivSN: '01',
          cClassTrib: '620001', // NAO_IMPLEMENTADO (VSN-027)
          baseCalculo: 1000,
          pIBSSN: 0.5,
          pCBSSN: 1.2,
        },
        {
          nObj: 2,
          cAtivSN: '09', // NAO_CALCULADO on tpDoc=55
          cClassTrib: '000001',
          baseCalculo: 500,
          pIBSSN: 0.5,
          pCBSSN: 1.2,
        },
        {
          nObj: 3,
          cAtivSN: '01',
          cClassTrib: '999999', // INCONSISTENCIA_ENTRADA (VSN-021)
          baseCalculo: 200,
          pIBSSN: 0.5,
          pCBSSN: 1.2,
        },
        {
          nObj: 4,
          cAtivSN: '01',
          cClassTrib: '000001', // CALCULADO
          baseCalculo: 1000,
          pIBSSN: 0.5,
          pCBSSN: 1.2,
        },
      ],
    });

    expect(mixed.itens.map((i) => i.estadoItem)).toEqual([
      'NAO_IMPLEMENTADO',
      'NAO_CALCULADO',
      'INCONSISTENCIA_ENTRADA',
      'CALCULADO',
    ]);
    expect(mixed.totais.vBC).toBe('1000.00');
    expect(mixed.totais.vIBSSN).toBe('5.00');
    expect(mixed.totais.vCBSSN).toBe('12.00');
    expect(mixed.totais.totalGeral).toBe('17.00');
  });
});

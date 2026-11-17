import { describe, expect, it } from 'vitest';
import {
  calculateBaseUnificadaNfe,
  calculateBaseUnificadaNfse,
} from '../../../src/server/engine/base-unificada-engine.js';

describe('Base de Cálculo Unificada Engine (NF-e/NFC-e & NFS-e)', () => {
  describe('NF-e / NFC-e (calculateBaseUnificadaNfe)', () => {
    it('reproduces exact docs/exemplos.md calculation for 2027 NF-e (bem) with PIS/COFINS extinction warnings', () => {
      const result = calculateBaseUnificadaNfe({
        anoFatoGerador: 2027,
        tipoDocumento: 55,
        natureza: 'bem',
        vProd: 1000,
        vFrete: 50,
        vSeg: 20,
        vOutro: 10,
        vDesc: 50,
        vIS: 30,
        vPIS: 9.25,
        vCOFINS: 46.25,
        vICMS: 180,
        vFCP: 10,
      });

      expect(result.baseRG).toBe('870.00');
      expect(result.baseIS).toBe('840.00');
      expect(result.baseSN).toBe('1060.00');
      expect(result.avisos).toHaveLength(2);
      expect(result.avisos[0]).toContain('vPIS');
      expect(result.avisos[0]).toContain('2027');
      expect(result.avisos[1]).toContain('vCOFINS');
      expect(result.avisos[1]).toContain('2027');
    });

    it('deducts PIS and COFINS in 2026 and ignores vIS (vigencia 2027-2033) with warning', () => {
      const result = calculateBaseUnificadaNfe({
        anoFatoGerador: 2026,
        tipoDocumento: 55,
        natureza: 'bem',
        vProd: 1000,
        vFrete: 50,
        vSeg: 20,
        vOutro: 10,
        vDesc: 50,
        vIS: 30,
        vPIS: 9.25,
        vCOFINS: 46.25,
        vICMS: 180,
        vFCP: 10,
      });

      // Sums 2026: 1000 + 50 + 20 + 10 = 1080 (vIS ignored in 2026)
      // Subtracts RG & IS: 50 + 9.25 + 46.25 + 180 + 10 = 295.50 => 1080 - 295.50 = 784.50
      // Subtracts SN: 50 => 1080 - 50 = 1030.00
      expect(result.baseRG).toBe('784.50');
      expect(result.baseIS).toBe('784.50');
      expect(result.baseSN).toBe('1030.00');
      expect(result.avisos).toHaveLength(1);
      expect(result.avisos[0]).toContain('vIS');
      expect(result.avisos[0]).toContain('2026');
    });

    it('ignores ICMS, ISS, FCP, PIS, and COFINS in 2033 with warnings', () => {
      const resultBem = calculateBaseUnificadaNfe({
        anoFatoGerador: 2033,
        tipoDocumento: 55,
        natureza: 'bem',
        vProd: 1000,
        vIS: 30,
        vICMS: 180,
        vFCP: 10,
      });

      expect(resultBem.baseRG).toBe('1030.00');
      expect(resultBem.baseIS).toBe('1000.00');
      expect(resultBem.baseSN).toBe('1030.00');
      expect(resultBem.avisos).toHaveLength(2);
      expect(resultBem.avisos.some((a) => a.includes('vICMS'))).toBe(true);
      expect(resultBem.avisos.some((a) => a.includes('vFCP'))).toBe(true);

      const resultServico = calculateBaseUnificadaNfe({
        anoFatoGerador: 2033,
        tipoDocumento: 55,
        natureza: 'servico',
        vServ: 500,
        vISS: 25,
      });

      expect(resultServico.baseRG).toBe('500.00');
      expect(resultServico.baseIS).toBe('500.00');
      expect(resultServico.baseSN).toBe('500.00');
      expect(resultServico.avisos).toHaveLength(1);
      expect(resultServico.avisos[0]).toContain('vISS');
    });

    it('handles nature-specific and document-model-specific rules (vII only bem/55, vISS only servico)', () => {
      const nfceWithII = calculateBaseUnificadaNfe({
        anoFatoGerador: 2027,
        tipoDocumento: 65,
        natureza: 'bem',
        vProd: 1000,
        vII: 150,
      });
      expect(nfceWithII.baseRG).toBe('1000.00');
      expect(nfceWithII.avisos[0]).toContain('vII');

      const nfeServico = calculateBaseUnificadaNfe({
        anoFatoGerador: 2027,
        tipoDocumento: 55,
        natureza: 'servico',
        vProd: 1000,
        vISS: 50,
      });
      expect(nfeServico.baseRG).toBe('950.00');
      expect(nfeServico.baseIS).toBe('950.00');
      expect(nfeServico.baseSN).toBe('1000.00');
    });

    it('rejects unsupported tipoDocumento outside 55/65', () => {
      expect(() =>
        calculateBaseUnificadaNfe({
          anoFatoGerador: 2027,
          tipoDocumento: 57,
          natureza: 'bem',
          vProd: 1000,
        }),
      ).toThrow(/55.*65/);
    });
  });

  describe('NFS-e (calculateBaseUnificadaNfse)', () => {
    it('returns E1302 warning for MEI and E0436 error when adjustments are supplied', () => {
      const meiSemAjuste = calculateBaseUnificadaNfse({
        anoFatoGerador: 2027,
        isMei: true,
        vServ: 500,
      });
      expect(meiSemAjuste.baseRG).toBe('0.00');
      expect(meiSemAjuste.baseSN).toBe('0.00');
      expect(meiSemAjuste.avisos.some((a) => a.includes('E1302'))).toBe(true);
      expect(meiSemAjuste.erros).toHaveLength(0);

      const meiComAjuste = calculateBaseUnificadaNfse({
        anoFatoGerador: 2027,
        isMei: true,
        vServ: 500,
        vOutrosAjustes: 50,
      });
      expect(meiComAjuste.avisos.some((a) => a.includes('E1302'))).toBe(true);
      expect(meiComAjuste.erros.some((e) => e.code === 'E0436')).toBe(true);
    });

    it('deducts PIS/COFINS/ISS in 2026, ignores PIS/COFINS in 2027, and ignores ISS in 2033', () => {
      const nfse2026 = calculateBaseUnificadaNfse({
        anoFatoGerador: 2026,
        vServ: 1000,
        vDescIncond: 50,
        vDescCond: 20, // conditional discount is NOT deducted
        vDedRed: 30,
        vISS: 50,
        vPIS: 6.5,
        vCOFINS: 30,
      });
      // baseRG = 1000 - 50 - 30 - 50 - 6.5 - 30 = 833.50
      // baseSN = 1000 - 50 - 30 = 920.00
      expect(nfse2026.baseRG).toBe('833.50');
      expect(nfse2026.baseSN).toBe('920.00');
      expect(nfse2026.erros).toHaveLength(0);

      const nfse2027 = calculateBaseUnificadaNfse({
        anoFatoGerador: 2027,
        vServ: 1000,
        vDescIncond: 50,
        vISS: 50,
        vPIS: 6.5,
        vCOFINS: 30,
      });
      expect(nfse2027.baseRG).toBe('900.00');
      expect(nfse2027.baseSN).toBe('950.00');
      expect(nfse2027.avisos.some((a) => a.includes('vPIS'))).toBe(true);
      expect(nfse2027.avisos.some((a) => a.includes('vCOFINS'))).toBe(true);

      const nfse2033 = calculateBaseUnificadaNfse({
        anoFatoGerador: 2033,
        vServ: 1000,
        vISS: 50,
      });
      expect(nfse2033.baseRG).toBe('1000.00');
      expect(nfse2033.baseSN).toBe('1000.00');
      expect(nfse2033.avisos.some((a) => a.includes('vISS'))).toBe(true);
    });
  });
});

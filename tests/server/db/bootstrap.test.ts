import { describe, expect, it, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootstrapRfbDatabase } from '../../../scripts/bootstrap-rfb-db.js';
import { openOficialDbReadOnly } from '../../../src/server/db/oficial-db.js';
import { DadosAbertosRepository } from '../../../src/server/db/dados-abertos-repo.js';

describe('RFB Official SQLite Bootstrap & Read-Only Catalog', () => {
  const tmpDb = path.join(os.tmpdir(), `rtc-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);

  afterAll(() => {
    if (fs.existsSync(tmpDb)) {
      fs.unlinkSync(tmpDb);
    }
  });

  it('verifies MANIFEST.json SHA-256 digests match all copied RFB SQL files', () => {
    const migrationsDir = path.resolve('db/rfb-migrations');
    const manifestPath = path.join(migrationsDir, 'MANIFEST.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      totalSqlFiles: number;
      files: Array<{ path: string; bytes: number; sha256: string }>;
    };

    expect(manifest.totalSqlFiles).toBe(61);
    for (const entry of manifest.files) {
      const fullPath = path.join(migrationsDir, entry.path);
      expect(fs.existsSync(fullPath)).toBe(true);
      const buf = fs.readFileSync(fullPath);
      const digest = crypto.createHash('sha256').update(buf).digest('hex');
      expect(digest).toBe(entry.sha256);
    }
  });

  it('compiles all Flyway migrations cleanly and passes integrity & FK checks', () => {
    const report = bootstrapRfbDatabase(path.resolve('db/rfb-migrations'), tmpDb);
    expect(report.integrityOk).toBe(true);
    expect(report.foreignKeyErrors).toBe(0);
    expect(report.appliedMigrations).toBeGreaterThanOrEqual(59);
    expect(report.latestVersaoBaseDados).toBe('V0059');
    expect(fs.existsSync(tmpDb)).toBe(true);

    const db = openOficialDbReadOnly(tmpDb);
    expect(db.pragma('journal_mode', { simple: true })).toBe('delete');
    db.close();
  }, 20_000);

  it('opens in read-only mode and resolves official NCM, cClassTrib, credit indicators, and Simples activities', () => {
    expect(() => openOficialDbReadOnly(`${tmpDb}.missing`)).toThrow();

    const db = openOficialDbReadOnly(tmpDb);
    const repo = new DadosAbertosRepository(db);
    expect(() => db.prepare('DELETE FROM UF').run()).toThrow();

    const ufs = repo.listUfs();
    expect(ufs.length).toBeGreaterThanOrEqual(27);

    const municipiosSp = repo.listMunicipios(35);
    expect(municipiosSp.length).toBeGreaterThan(0);

    const ncm = repo.lookupNcm('10063021', '2027-03-10');
    expect(ncm.length).toBeGreaterThan(0);

    const nbs = repo.lookupNbs('101011100', '2027-03-10');
    expect(nbs.length).toBeGreaterThan(0);

    const cstsCbs = repo.lookupSituacoesTributarias(2, '2027-03-10');
    expect(cstsCbs.length).toBeGreaterThan(0);

    const classif000001 = repo.lookupClassificacao('000001', 2, '2027-03-10');
    expect(classif000001).not.toBeNull();
    expect(classif000001?.cst).toBe('000');
    expect(classif000001?.cltrId).toBe(1);

    // CLTR_CD='000001' collides between IS (tributeId=1) and CBS (tributeId=2)
    const classif000001Is = repo.lookupClassificacao('000001', 1, '2027-03-10');
    expect(classif000001Is).not.toBeNull();
    expect(classif000001Is?.cltrId).toBe(139);

    const searchRes = repo.searchClassificacoes('000001', '000', '2027-03-10');
    expect(searchRes.length).toBeGreaterThan(0);

    const compatFail = repo.checkNcmCompatByClassTrib('02013000', '200035', '2027-03-10');
    expect(compatFail).toBe(false);
    expect(repo.checkNcmCompatByClassTrib('10063021', '000001', '2027-03-10')).toBe(true);

    // Real RFB EXCECAO_NCM_APLICAVEL truth-table checks:
    // 200003 duplicates 0207 across NCMA_ID=58 (except 02074300) and NCMA_ID=59 (except 02075300)
    expect(repo.checkNcmCompatByClassTrib('02074300', '200003', '2027-03-10')).toBe(false);
    expect(repo.checkNcmCompatByClassTrib('02075300', '200003', '2027-03-10')).toBe(false);
    expect(repo.checkNcmCompatByClassTrib('02071100', '200003', '2027-03-10')).toBe(true);

    // 200034: multi-exception NCMA_ID=362 ('07' except '0711', '0714...') and (1,1,1) override ('07' except '0709', but '07095' allowed)
    expect(repo.checkNcmCompatByClassTrib('07112010', '200034', '2027-03-10')).toBe(false);
    expect(repo.checkNcmCompatByClassTrib('07095100', '200034', '2027-03-10')).toBe(true);

    // V0037 ENCM_ID=67: '07108000' on '200014' expires after 2026-01-01
    expect(repo.checkNcmCompatByClassTrib('07108000', '200014', '2026-01-01')).toBe(false);
    expect(repo.checkNcmCompatByClassTrib('07108000', '200014', '2026-01-02')).toBe(true);

    expect(repo.checkNbsCompatByClassTrib('122012000', '200028', '2027-03-10')).toBe(true);
    expect(repo.checkNbsCompatByClassTrib('101011100', '200028', '2027-03-10')).toBe(false);

    expect(repo.checkTipoDfeCompat('NFe', classif000001!.cltrId, '2027-03-10')).toBe(true);
    expect(repo.checkTipoDfeCompat('55', classif000001!.cltrId, '2027-03-10')).toBe(true);

    const tratamento = repo.getTratamentoParaClassificacao(classif000001!.cltrId, '2027-03-10');
    expect(tratamento).not.toBeNull();

    const reducaoZero = repo.getPercentualReducao(classif000001!.cltrId, 2, '2027-03-10');
    expect(reducaoZero === null || reducaoZero === 0).toBe(true);

    const credits = repo.getCreditIndicators('000001', '2027-03-10');
    expect(credits).not.toBeNull();

    const ref2026 = repo.getAliquotaReferencia(2, '2026-06-01'); // CBS
    const ref2027 = repo.getAliquotaReferencia(2, '2027-03-10');
    expect(ref2026).not.toBeNull();
    expect(ref2027).toBeNull(); // V0053 ends 2026-12-31

    const padrao2026 = repo.getAliquotaPadrao(2, null, null, '2026-06-01');
    expect(padrao2026).not.toBeNull();
    expect(padrao2026?.valorReferencia).toBe(ref2026);

    const redutorGov = repo.getRedutorCompraGov('2027-03-10');
    expect(redutorGov).not.toBeNull();

    const transfCbs2029 = repo.getTransferenciaCbs('2029-06-01');
    expect(transfCbs2029).toBe(10);

    const fundLegais = repo.getFundamentacoesLegais(classif000001!.cltrId, '2027-03-10');
    expect(fundLegais.length).toBeGreaterThan(0);

    const atividades = repo.getAtividadesSimples('2027-01-01');
    expect(atividades).toHaveLength(15);
    const ativ09 = atividades.find((a) => a.cAtivSN === '09');
    expect(ativ09?.modoFatorR).toBe('OPCIONAL');
    const ativ01 = atividades.find((a) => a.cAtivSN === '01');
    expect(ativ01?.modoFatorR).toBe('NAO_APLICAVEL');

    // ADR011 Fator R modes with configured anexos
    const atividadesOnlyV = repo.getAtividadesSimples('2027-01-01', { anexo: 'V' });
    expect(atividadesOnlyV.find((a) => a.cAtivSN === '09')?.modoFatorR).toBe('OBRIGATORIO');

    const atividadesOnlyIII = repo.getAtividadesSimples('2027-01-01', { anexo: 'III' });
    expect(atividadesOnlyIII.find((a) => a.cAtivSN === '09')?.modoFatorR).toBe('INDISPONIVEL');

    // Filtering by tpDoc=91 (NFSe) and cClassTrib='000001' (tpRBSN=1, vedadoNaoTributavel=1)
    const atividadesNfse = repo.getAtividadesSimples('2027-01-01', {
      tipoDocumento: 91,
      cClassTrib: '000001',
    });
    expect(atividadesNfse.find((a) => a.cAtivSN === '01')?.admissivelNoDocumento).toBe(false);
    expect(atividadesNfse.find((a) => a.cAtivSN === '90')?.compativelComClassTrib).toBe(false);

    // Simples Nacional parameters
    const regimeCrt1 = repo.getRegimeApuracaoSimples(1, null, '2027-01-01');
    expect(regimeCrt1?.destinoDevido).toBe('DEVIDO');
    const regimeCrt3 = repo.getRegimeApuracaoSimples(3, 2, '2027-01-01');
    expect(regimeCrt3?.destinoDevido).toBe('PENDENTE_SUSPENSO');
    expect(regimeCrt3?.destinoPendenteSuspenso).toBe('ZERO');

    const tpRbsn1 = repo.getTipoReceitaBrutaSimples(1, '2027-01-01');
    expect(tpRbsn1?.compoeReceita).toBe(true);
    expect(tpRbsn1?.fatorReceita).toBe(1);

    expect(repo.getFatorTransicaoCompraGovSimples('2027-01-01')).toBe(0);
    expect(repo.getFatorTransicaoCompraGovSimples('2029-01-01')).toBe(0.1);
    expect(repo.isTipoDfeHabilitadoSimples(55, '2027-01-01')).toBe(true);
    expect(repo.isTipoDfeHabilitadoSimples(57, '2027-01-01')).toBe(true);
    expect(repo.isTipoDfeHabilitadoSimples(66, '2027-01-01')).toBe(false);
    expect(repo.isTipoDfeHabilitadoSimples(55, '2026-12-31')).toBe(false);
    expect(repo.isAtividadeAdmissivelDocumentoSimples(1, 55, '2027-01-01')).toBe(true);
    expect(repo.isAtividadeAdmissivelDocumentoSimples(1, 91, '2027-01-01')).toBe(false);

    db.close();
  });

  it('handles NCM/NBS multi-exception edge cases and ALIQUOTA_PADRAO overrides (ACRESCIMO, DECRESCIMO, SUBSTITUICAO) with both ufCd and muniCd', () => {
    const copyPath = `${tmpDb}.overrides.db`;
    fs.copyFileSync(tmpDb, copyPath);
    try {
      const rwDb = new Database(copyPath);

      // 1. Multi-exception NCMA_ID=362: expire one unrelated exception (ENCM_ID=71 '07141000')
      //    while ENCM_ID=33 ('0711') remains active -> '07112010' MUST STILL be rejected.
      rwDb
        .prepare("UPDATE EXCECAO_NCM_APLICAVEL SET ENCM_FIM_VIGENCIA = '2026-12-31' WHERE ENCM_ID = 71")
        .run();

      // 2. Narrower active NCM_APLICAVEL row with an active exception for a DIFFERENT sub-code:
      //    CLTR_ID=45 ('200034') has '07' with exception '0709' (NCMA_ID=375) and '07095' (NCMA_ID=377).
      //    Adding an active exception '07095900' to NCMA_ID=377 must NOT reject '07095100'.
      rwDb
        .prepare(
          "INSERT INTO EXCECAO_NCM_APLICAVEL (ENCM_ID, ENCM_NCM_CD, ENCM_NCMA_ID, ENCM_INICIO_VIGENCIA, ENCM_FIM_VIGENCIA) VALUES (9901, '07095900', 377, '2026-01-01', NULL)",
        )
        .run();

      // 3. Expired NCM_APLICAVEL with active EXCECAO_NCM_APLICAVEL (0,1,0) -> MUST reject.
      //    CLTR_ID=14 ('200003') NCMA_ID=58 ('0207' except '02074300'): expire NCMA_ID=58 and 59;
      //    active ENCM_ID=1 ('02074300') must NOT bypass expired parent.
      rwDb
        .prepare("UPDATE NCM_APLICAVEL SET NCMA_FIM_VIGENCIA = '2026-12-31' WHERE NCMA_ID IN (58, 59)")
        .run();

      // 4. EXCECAO_NBS_APLICAVEL truth table on 200028 (NBSA_NBS_CD='12203', NBSA_ID for 12203):
      const nbsRow = rwDb
        .prepare(
          "SELECT NBSA_ID FROM NBS_APLICAVEL n JOIN CLASSIFICACAO_TRIBUTARIA ct ON ct.CLTR_ID = n.NBSA_CLTR_ID WHERE ct.CLTR_CD = '200028' AND n.NBSA_NBS_CD = '12203' LIMIT 1",
        )
        .get() as { NBSA_ID: number };
      rwDb
        .prepare(
          "INSERT INTO EXCECAO_NBS_APLICAVEL (ENBS_ID, ENBS_NBS_CD, ENBS_NBSA_ID, ENBS_INICIO_VIGENCIA, ENBS_FIM_VIGENCIA) VALUES (9901, '122031000', ?, '2026-01-01', NULL)",
        )
        .run(nbsRow.NBSA_ID);

      // 5. ALIQUOTA_REFERENCIA + ALIQUOTA_PADRAO overrides (SUBSTITUICAO, ACRESCIMO, DECRESCIMO)
      rwDb
        .prepare(
          "INSERT INTO ALIQUOTA_REFERENCIA (ALRE_ID, ALRE_VALOR, ALRE_INICIO_VIGENCIA, ALRE_FIM_VIGENCIA, ALRE_TBTO_ID) VALUES (9003, 10.0, '2028-01-01', NULL, 3)",
        )
        .run();
      rwDb
        .prepare(
          "INSERT INTO ALIQUOTA_REFERENCIA (ALRE_ID, ALRE_VALOR, ALRE_INICIO_VIGENCIA, ALRE_FIM_VIGENCIA, ALRE_TBTO_ID) VALUES (9004, 5.0, '2028-01-01', NULL, 4)",
        )
        .run();
      rwDb
        .prepare(
          "INSERT INTO ALIQUOTA_REFERENCIA (ALRE_ID, ALRE_VALOR, ALRE_INICIO_VIGENCIA, ALRE_FIM_VIGENCIA, ALRE_TBTO_ID) VALUES (9002, 8.8, '2028-01-01', NULL, 2)",
        )
        .run();

      // State override (TBTO_ID=3, UF=43, MUNI=NULL) -> SUBSTITUICAO 1.50
      rwDb
        .prepare(
          "INSERT INTO ALIQUOTA_PADRAO (ALPA_ID, ALPA_VALOR, ALPA_MUNI_CD, ALPA_UF_CD, ALPA_ALRE_ID, ALPA_FORMA_APLICACAO, ALPA_INICIO_VIGENCIA, ALPA_FIM_VIGENCIA) VALUES (9001, 1.5, NULL, 43, 9003, 'SUBSTITUICAO', '2028-01-01', NULL)",
        )
        .run();
      // Municipal override (TBTO_ID=4, UF=NULL, MUNI=4314902) -> ACRESCIMO 1.00
      rwDb
        .prepare(
          "INSERT INTO ALIQUOTA_PADRAO (ALPA_ID, ALPA_VALOR, ALPA_MUNI_CD, ALPA_UF_CD, ALPA_ALRE_ID, ALPA_FORMA_APLICACAO, ALPA_INICIO_VIGENCIA, ALPA_FIM_VIGENCIA) VALUES (9002, 1.0, 4314902, NULL, 9004, 'ACRESCIMO', '2028-01-01', NULL)",
        )
        .run();
      // National override (TBTO_ID=2, UF=NULL, MUNI=NULL) -> DECRESCIMO 0.30
      rwDb
        .prepare(
          "INSERT INTO ALIQUOTA_PADRAO (ALPA_ID, ALPA_VALOR, ALPA_MUNI_CD, ALPA_UF_CD, ALPA_ALRE_ID, ALPA_FORMA_APLICACAO, ALPA_INICIO_VIGENCIA, ALPA_FIM_VIGENCIA) VALUES (9003, 0.3, NULL, NULL, 9002, 'DECRESCIMO', '2028-01-01', NULL)",
        )
        .run();

      rwDb.close();

      const roDb = openOficialDbReadOnly(copyPath);
      const repo = new DadosAbertosRepository(roDb);

      expect(repo.checkNcmCompatByClassTrib('07112010', '200034', '2027-03-10')).toBe(false);
      expect(repo.checkNcmCompatByClassTrib('07095100', '200034', '2027-03-10')).toBe(true);
      expect(repo.checkNcmCompatByClassTrib('07095900', '200034', '2027-03-10')).toBe(false);
      expect(repo.checkNcmCompatByClassTrib('02074300', '200003', '2027-03-10')).toBe(false);
      expect(repo.checkNcmCompatByClassTrib('02071100', '200003', '2027-03-10')).toBe(false);

      expect(repo.checkNbsCompatByClassTrib('122031000', '200028', '2027-03-10')).toBe(false);
      expect(repo.checkNbsCompatByClassTrib('122032000', '200028', '2027-03-10')).toBe(true);

      // Both ufCd and muniCd supplied for UF (TBTO_ID=3) and Municipal (TBTO_ID=4) overrides
      const ibsUf = repo.getAliquotaPadrao(3, 43, 4314902, '2028-06-01');
      expect(ibsUf).toEqual({
        valorReferencia: 10.0,
        valorPadrao: 1.5,
        formaAplicacao: 'SUBSTITUICAO',
        valorAplicavel: 1.5,
      });

      const ibsMun = repo.getAliquotaPadrao(4, 43, 4314902, '2028-06-01');
      expect(ibsMun).toEqual({
        valorReferencia: 5.0,
        valorPadrao: 1.0,
        formaAplicacao: 'ACRESCIMO',
        valorAplicavel: 6.0,
      });

      const cbsDecrescimo = repo.getAliquotaPadrao(2, 43, 4314902, '2028-06-01');
      expect(cbsDecrescimo).toEqual({
        valorReferencia: 8.8,
        valorPadrao: 0.3,
        formaAplicacao: 'DECRESCIMO',
        valorAplicavel: 8.5,
      });

      // Fallback when UF has no override
      const ibsUfFallback = repo.getAliquotaPadrao(3, 35, 3550308, '2028-06-01');
      expect(ibsUfFallback).toEqual({
        valorReferencia: 10.0,
        valorPadrao: null,
        formaAplicacao: null,
        valorAplicavel: 10.0,
      });

      roDb.close();
    } finally {
      if (fs.existsSync(copyPath)) {
        fs.unlinkSync(copyPath);
      }
    }
  });
});

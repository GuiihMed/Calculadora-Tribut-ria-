import { describe, expect, it, afterAll } from 'vitest';
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
    expect(fs.existsSync(tmpDb)).toBe(true);
  });

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
});

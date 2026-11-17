import type Database from 'better-sqlite3';
import { Decimal } from 'decimal.js';
import type { CreditIndicators, FundamentacaoLegal, ModoFatorR } from '../../shared/types/fiscal.js';

export interface UfRow {
  ufCd: number;
  nome: string;
  sigla: string;
}

export interface MunicipioRow {
  muniCd: number;
  ufCd: number;
  nome: string;
  ufSigla: string;
}

export interface NcmRow {
  ncmCd: string;
  descricao: string;
  inicioVigencia: string;
  fimVigencia: string | null;
}

export interface NbsRow {
  nbsCd: string;
  descricao: string;
  lc116: string | null;
  inicioVigencia: string;
  fimVigencia: string | null;
}

export interface SituacaoTributariaRow {
  sitrId: number;
  cst: string;
  descricao: string;
  indGIbsCbs: boolean;
  indGIbsCbsMono: boolean;
  indGRed: boolean;
  indGDif: boolean;
  indGTransfCred: boolean;
  indGCredPresIbsZfm: boolean;
  indGAjusteCompet: boolean;
  inicioVigencia: string;
  fimVigencia: string | null;
}

export interface ClassificacaoTributariaRow {
  cltrId: number;
  cClassTrib: string;
  descricao: string;
  memoriaCalculo: string;
  sitrId: number;
  cst: string;
  cstDescricao: string;
  tributeId: number;
  tipoAliquota: string;
  nomenclatura: string | null;
  tpRbsn: number;
  creditoOperacaoAntecedente: string | null;
  apropriacaoCreditoCbs: boolean;
  apropriacaoCreditoIbs: boolean;
  creditoPresumidoFornecedor: boolean;
  creditoPresumidoAdquirente: boolean;
  indGCredPresOper: boolean;
  indGMonoPadrao: boolean;
  indGMonoReten: boolean;
  indGMonoRet: boolean;
  indGMonoDif: boolean;
  indGEstornoCred: boolean;
  anexo: string | null;
  sitrIndGIbsCbs: boolean;
  sitrIndGRed: boolean;
  sitrIndGDif: boolean;
  inicioVigencia: string;
  fimVigencia: string | null;
}

export interface TratamentoTributarioRow {
  trtrId: number;
  cltrId: number;
  descricao: string;
  expressaoAliquota: string | null;
  expressaoAliquotaEfetiva: string | null;
  expressaoBaseCalculo: string;
  expressaoTributoCalculado: string;
  expressaoTributoDevido: string;
  expressaoPercentualDiferimento: string | null;
  expressaoValorDiferimento: string | null;
  inIncompativelComSuspensao: boolean;
  inExigeGrupoDesoneracao: boolean;
  inPossuiPercentualReducao: boolean;
  inPossuiAjuste: boolean;
  inPossuiRedutor: boolean;
  inPossuiMonofasia: boolean;
}

export type FormaAplicacaoAliquota = 'SUBSTITUICAO' | 'ACRESCIMO' | 'DECRESCIMO';

export interface AliquotaPadraoRow {
  valorReferencia: number;
  valorPadrao: number | null;
  formaAplicacao: FormaAplicacaoAliquota | null;
  valorAplicavel: number;
}

export interface AtividadeSimplesRow {
  atsnId: number;
  cAtivSN: string;
  ordem: number;
  descricao: string;
  anexoSemFatorR: string | null;
  anexoComFatorR: string | null;
  sujeitaFatorR: boolean;
  naoTributavel: boolean;
  rotuloAnexo: string;
  rotuloCurtoAnexo: string;
  disponivel: boolean;
  anexosFaltantes: string[];
  modoFatorR: ModoFatorR;
  tpDocsAdmissiveis: number[];
  admissivelNoDocumento: boolean | null;
  compativelComClassTrib: boolean | null;
}

export interface RegimeApuracaoSimplesRow {
  rasnId: number;
  crt: number;
  tpRegimeIbsCbs: number | null;
  descricao: string;
  geraIbs: boolean;
  destinoDevido: 'DEVIDO' | 'PENDENTE_SUSPENSO';
  destinoPendenteSuspenso: 'PENDENTE_SUSPENSO' | 'ZERO';
}

export interface TipoReceitaBrutaSimplesRow {
  trbsId: number;
  tpRbsn: number;
  descricao: string;
  compoeReceita: boolean;
  isCompoeReceita: boolean;
  fatorReceita: number;
  pendenteSuspenso: boolean;
  exigeAliquota: boolean;
  vedadoNaoTributavel: boolean;
}

const ANEXOS_VALIDOS = ['I', 'II', 'III', 'IV', 'V'] as const;

interface NomenclatureSpec {
  table: 'NCM_APLICAVEL' | 'NBS_APLICAVEL';
  excTable: 'EXCECAO_NCM_APLICAVEL' | 'EXCECAO_NBS_APLICAVEL';
  idCol: string;
  codeCol: string;
  cltrCol: string;
  startCol: string;
  endCol: string;
  excFkCol: string;
  excCodeCol: string;
  excStartCol: string;
  excEndCol: string;
  requiredLength: number;
}

const NOMENCLATURE_SPECS: Record<'ncm' | 'nbs', NomenclatureSpec> = {
  ncm: {
    table: 'NCM_APLICAVEL',
    excTable: 'EXCECAO_NCM_APLICAVEL',
    idCol: 'NCMA_ID',
    codeCol: 'NCMA_NCM_CD',
    cltrCol: 'NCMA_CLTR_ID',
    startCol: 'NCMA_INICIO_VIGENCIA',
    endCol: 'NCMA_FIM_VIGENCIA',
    excFkCol: 'ENCM_NCMA_ID',
    excCodeCol: 'ENCM_NCM_CD',
    excStartCol: 'ENCM_INICIO_VIGENCIA',
    excEndCol: 'ENCM_FIM_VIGENCIA',
    requiredLength: 8,
  },
  nbs: {
    table: 'NBS_APLICAVEL',
    excTable: 'EXCECAO_NBS_APLICAVEL',
    idCol: 'NBSA_ID',
    codeCol: 'NBSA_NBS_CD',
    cltrCol: 'NBSA_CLTR_ID',
    startCol: 'NBSA_INICIO_VIGENCIA',
    endCol: 'NBSA_FIM_VIGENCIA',
    excFkCol: 'ENBS_NBSA_ID',
    excCodeCol: 'ENBS_NBS_CD',
    excStartCol: 'ENBS_INICIO_VIGENCIA',
    excEndCol: 'ENBS_FIM_VIGENCIA',
    requiredLength: 9,
  },
};

function normalizeDate(input: string): string {
  const isoDate = input.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`Invalid reference date '${input}'; expected YYYY-MM-DD`);
  }
  return isoDate;
}

function normalizeDfeSigla(sigla: string): string {
  return sigla.replace(/[\s\-_]/g, '').toUpperCase();
}

function parseConfiguredAnexos(anexoFilter?: string): Set<string> | null {
  if (anexoFilter === undefined) {
    return null;
  }
  const trimmed = anexoFilter.trim();
  if (!trimmed) {
    return new Set();
  }
  return new Set(
    trimmed
      .split(',')
      .map((part) => part.trim().toUpperCase())
      .filter((part) => part.length > 0),
  );
}

/**
 * Pure ADR011 Fator R and annex availability derivation matching `DerivacaoAnexosSimples`.
 */
function deriveAnexosSimples(
  anexoSemFatorR: string | null,
  anexoComFatorR: string | null,
  anexosConfigurados: Set<string> | null,
): { disponivel: boolean; anexosFaltantes: string[]; modoFatorR: ModoFatorR } {
  if (anexoComFatorR !== null && anexoSemFatorR === null) {
    throw new Error(
      `Inconsistent Simples Nacional activity: anexoComFatorR (${anexoComFatorR}) set without anexoSemFatorR`,
    );
  }

  const configurados = anexosConfigurados ?? new Set<string>(ANEXOS_VALIDOS);
  const anexosPossiveis = ANEXOS_VALIDOS.filter(
    (anexo) => anexo === anexoSemFatorR || anexo === anexoComFatorR,
  );
  const anexosFaltantes = anexosPossiveis.filter((anexo) => !configurados.has(anexo));
  const disponivel =
    anexosPossiveis.length === 0 || anexosPossiveis.some((anexo) => configurados.has(anexo));

  let modoFatorR: ModoFatorR;
  if (anexoComFatorR === null) {
    modoFatorR = 'NAO_APLICAVEL';
  } else if (configurados.has(anexoComFatorR)) {
    modoFatorR =
      anexoSemFatorR !== null && configurados.has(anexoSemFatorR) ? 'OPCIONAL' : 'OBRIGATORIO';
  } else {
    modoFatorR = 'INDISPONIVEL';
  }

  return { disponivel, anexosFaltantes, modoFatorR };
}

function toBool(value: number | null | undefined): boolean {
  return value === 1;
}

/**
 * Parameterized read-only repository over the official RFB SQLite database (`rtc-oficial.db`).
 * All temporal queries evaluate validity windows strictly against the caller-supplied reference date.
 */
export class DadosAbertosRepository {
  constructor(private readonly db: Database.Database) {}

  getDatabase(): Database.Database {
    return this.db;
  }

  listUfs(): UfRow[] {
    return this.db
      .prepare(
        `SELECT UF_CD AS ufCd, UF_NOME AS nome, UF_SIGLA AS sigla
         FROM UF
         ORDER BY UF_SIGLA ASC`,
      )
      .all() as UfRow[];
  }

  listMunicipios(ufCd?: number): MunicipioRow[] {
    if (ufCd !== undefined) {
      return this.db
        .prepare(
          `SELECT m.MUNI_CD AS muniCd, m.MUNI_UF_CD AS ufCd, m.MUNI_NOME AS nome, u.UF_SIGLA AS ufSigla
           FROM MUNICIPIO m
           JOIN UF u ON u.UF_CD = m.MUNI_UF_CD
           WHERE m.MUNI_UF_CD = ?
           ORDER BY m.MUNI_NOME ASC`,
        )
        .all(ufCd) as MunicipioRow[];
    }
    return this.db
      .prepare(
        `SELECT m.MUNI_CD AS muniCd, m.MUNI_UF_CD AS ufCd, m.MUNI_NOME AS nome, u.UF_SIGLA AS ufSigla
         FROM MUNICIPIO m
         JOIN UF u ON u.UF_CD = m.MUNI_UF_CD
         ORDER BY u.UF_SIGLA ASC, m.MUNI_NOME ASC`,
      )
      .all() as MunicipioRow[];
  }

  lookupNcm(codeOrTerm: string, date: string): NcmRow[] {
    const refDate = normalizeDate(date);
    const term = codeOrTerm.trim();
    if (!term) {
      return [];
    }
    const digitsOnly = term.replace(/\D/g, '');
    if (/^[\d.]+$/.test(term) && digitsOnly.length > 0) {
      return this.db
        .prepare(
          `SELECT NCM_CD AS ncmCd,
                  NCM_DESCRICAO AS descricao,
                  NCM_INICIO_VIGENCIA AS inicioVigencia,
                  NCM_FIM_VIGENCIA AS fimVigencia
           FROM NCM
           WHERE NCM_CD LIKE ? || '%'
             AND NCM_INICIO_VIGENCIA <= ?
             AND (NCM_FIM_VIGENCIA IS NULL OR NCM_FIM_VIGENCIA >= ?)
           ORDER BY NCM_CD ASC
           LIMIT 100`,
        )
        .all(digitsOnly, refDate, refDate) as NcmRow[];
    }

    return this.db
      .prepare(
        `SELECT NCM_CD AS ncmCd,
                NCM_DESCRICAO AS descricao,
                NCM_INICIO_VIGENCIA AS inicioVigencia,
                NCM_FIM_VIGENCIA AS fimVigencia
         FROM NCM
         WHERE NCM_DESCRICAO LIKE '%' || ? || '%'
           AND NCM_INICIO_VIGENCIA <= ?
           AND (NCM_FIM_VIGENCIA IS NULL OR NCM_FIM_VIGENCIA >= ?)
         ORDER BY NCM_CD ASC
         LIMIT 100`,
      )
      .all(term, refDate, refDate) as NcmRow[];
  }

  lookupNbs(codeOrTerm: string, date: string): NbsRow[] {
    const refDate = normalizeDate(date);
    const term = codeOrTerm.trim();
    if (!term) {
      return [];
    }
    const digitsOnly = term.replace(/\D/g, '');
    if (/^[\d.]+$/.test(term) && digitsOnly.length > 0) {
      return this.db
        .prepare(
          `SELECT NBS_CD AS nbsCd,
                  NBS_DESCRICAO AS descricao,
                  NBS_LC_116 AS lc116,
                  NBS_INICIO_VIGENCIA AS inicioVigencia,
                  NBS_FIM_VIGENCIA AS fimVigencia
           FROM NBS
           WHERE NBS_CD LIKE ? || '%'
             AND NBS_INICIO_VIGENCIA <= ?
             AND (NBS_FIM_VIGENCIA IS NULL OR NBS_FIM_VIGENCIA >= ?)
           ORDER BY NBS_CD ASC
           LIMIT 100`,
        )
        .all(digitsOnly, refDate, refDate) as NbsRow[];
    }

    return this.db
      .prepare(
        `SELECT NBS_CD AS nbsCd,
                NBS_DESCRICAO AS descricao,
                NBS_LC_116 AS lc116,
                NBS_INICIO_VIGENCIA AS inicioVigencia,
                NBS_FIM_VIGENCIA AS fimVigencia
         FROM NBS
         WHERE NBS_DESCRICAO LIKE '%' || ? || '%'
           AND NBS_INICIO_VIGENCIA <= ?
           AND (NBS_FIM_VIGENCIA IS NULL OR NBS_FIM_VIGENCIA >= ?)
         ORDER BY NBS_CD ASC
         LIMIT 100`,
      )
      .all(term, refDate, refDate) as NbsRow[];
  }

  lookupSituacoesTributarias(tributeId: number, date: string): SituacaoTributariaRow[] {
    const refDate = normalizeDate(date);
    const rows = this.db
      .prepare(
        `SELECT st.SITR_ID AS sitrId,
                st.SITR_CD AS cst,
                st.SITR_DESCRICAO AS descricao,
                st.SITR_IND_GIBSCBS AS indGIbsCbs,
                st.SITR_IND_GIBSCBSMONO AS indGIbsCbsMono,
                st.SITR_IND_GRED AS indGRed,
                st.SITR_IND_GDIF AS indGDif,
                st.SITR_IND_GTRANSFCRED AS indGTransfCred,
                st.SITR_IND_GCREDPRESIBSZFM AS indGCredPresIbsZfm,
                st.SITR_IND_GAJUSTECOMPET AS indGAjusteCompet,
                st.SITR_INICIO_VIGENCIA AS inicioVigencia,
                st.SITR_FIM_VIGENCIA AS fimVigencia
         FROM SITUACAO_TRIBUTARIA st
         JOIN TRIBUTO_SITUACAO_TRIBUTARIA tst ON tst.TRST_SITR_ID = st.SITR_ID
         JOIN TRIBUTO tb ON tb.TBTO_ID = tst.TRST_TBTO_ID
         WHERE tb.TBTO_ID = ?
           AND st.SITR_INICIO_VIGENCIA <= ?
           AND (st.SITR_FIM_VIGENCIA IS NULL OR st.SITR_FIM_VIGENCIA >= ?)
           AND tst.TRST_INICIO_VIGENCIA <= ?
           AND (tst.TRST_FIM_VIGENCIA IS NULL OR tst.TRST_FIM_VIGENCIA >= ?)
           AND tb.TBTO_INICIO_VIGENCIA <= ?
           AND (tb.TBTO_FIM_VIGENCIA IS NULL OR tb.TBTO_FIM_VIGENCIA >= ?)
         ORDER BY st.SITR_CD ASC`,
      )
      .all(tributeId, refDate, refDate, refDate, refDate, refDate, refDate) as Array<{
      sitrId: number;
      cst: string;
      descricao: string;
      indGIbsCbs: number;
      indGIbsCbsMono: number;
      indGRed: number;
      indGDif: number;
      indGTransfCred: number;
      indGCredPresIbsZfm: number;
      indGAjusteCompet: number;
      inicioVigencia: string;
      fimVigencia: string | null;
    }>;

    return rows.map((row) => ({
      sitrId: row.sitrId,
      cst: row.cst,
      descricao: row.descricao,
      indGIbsCbs: toBool(row.indGIbsCbs),
      indGIbsCbsMono: toBool(row.indGIbsCbsMono),
      indGRed: toBool(row.indGRed),
      indGDif: toBool(row.indGDif),
      indGTransfCred: toBool(row.indGTransfCred),
      indGCredPresIbsZfm: toBool(row.indGCredPresIbsZfm),
      indGAjusteCompet: toBool(row.indGAjusteCompet),
      inicioVigencia: row.inicioVigencia,
      fimVigencia: row.fimVigencia,
    }));
  }

  lookupClassificacao(
    cClassTrib: string,
    tributeId: number,
    date: string,
  ): ClassificacaoTributariaRow | null {
    const refDate = normalizeDate(date);
    const code = cClassTrib.trim();
    if (!code) {
      return null;
    }

    const row = this.db
      .prepare(
        `SELECT ct.CLTR_ID AS cltrId,
                ct.CLTR_CD AS cClassTrib,
                ct.CLTR_DESCRICAO AS descricao,
                ct.CLTR_MEMORIA_CALCULO AS memoriaCalculo,
                st.SITR_ID AS sitrId,
                st.SITR_CD AS cst,
                st.SITR_DESCRICAO AS cstDescricao,
                tb.TBTO_ID AS tributeId,
                ct.CLTR_TIPO_ALIQUOTA AS tipoAliquota,
                ct.CLTR_NOMENCLATURA AS nomenclatura,
                ct.CLTR_TPRBSN AS tpRbsn,
                ct.CLTR_CREDITO_OPERACAO_ANTECEDENTE AS creditoOperacaoAntecedente,
                ct.CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_CBS AS apropriacaoCreditoCbs,
                ct.CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_IBS AS apropriacaoCreditoIbs,
                ct.CLTR_IN_CREDITO_PRESUMIDO_FORNECEDOR AS creditoPresumidoFornecedor,
                ct.CLTR_IN_CREDITO_PRESUMIDO_ADQUIRENTE AS creditoPresumidoAdquirente,
                ct.CLTR_IND_GCREDPRESOPER AS indGCredPresOper,
                ct.CLTR_IND_GMONOPADRAO AS indGMonoPadrao,
                ct.CLTR_IND_GMONORETEN AS indGMonoReten,
                ct.CLTR_IND_GMONORET AS indGMonoRet,
                ct.CLTR_IND_GMONODIF AS indGMonoDif,
                ct.CLTR_IND_GESTORNOCRED AS indGEstornoCred,
                ct.CLTR_ANEXO AS anexo,
                st.SITR_IND_GIBSCBS AS sitrIndGIbsCbs,
                st.SITR_IND_GRED AS sitrIndGRed,
                st.SITR_IND_GDIF AS sitrIndGDif,
                ct.CLTR_INICIO_VIGENCIA AS inicioVigencia,
                ct.CLTR_FIM_VIGENCIA AS fimVigencia
         FROM CLASSIFICACAO_TRIBUTARIA ct
         JOIN SITUACAO_TRIBUTARIA st ON st.SITR_ID = ct.CLTR_SITR_ID
         JOIN TRIBUTO_SITUACAO_TRIBUTARIA tst ON tst.TRST_SITR_ID = st.SITR_ID
         JOIN TRIBUTO tb ON tb.TBTO_ID = tst.TRST_TBTO_ID
         WHERE ct.CLTR_CD = ?
           AND tb.TBTO_ID = ?
           AND ct.CLTR_INICIO_VIGENCIA <= ?
           AND (ct.CLTR_FIM_VIGENCIA IS NULL OR ct.CLTR_FIM_VIGENCIA >= ?)
           AND st.SITR_INICIO_VIGENCIA <= ?
           AND (st.SITR_FIM_VIGENCIA IS NULL OR st.SITR_FIM_VIGENCIA >= ?)
           AND tst.TRST_INICIO_VIGENCIA <= ?
           AND (tst.TRST_FIM_VIGENCIA IS NULL OR tst.TRST_FIM_VIGENCIA >= ?)
           AND tb.TBTO_INICIO_VIGENCIA <= ?
           AND (tb.TBTO_FIM_VIGENCIA IS NULL OR tb.TBTO_FIM_VIGENCIA >= ?)
         ORDER BY ct.CLTR_INICIO_VIGENCIA DESC
         LIMIT 1`,
      )
      .get(
        code,
        tributeId,
        refDate,
        refDate,
        refDate,
        refDate,
        refDate,
        refDate,
        refDate,
        refDate,
      ) as RawClassificacaoRow | undefined;

    return row ? mapClassificacaoRow(row) : null;
  }

  searchClassificacoes(
    termOrCode: string,
    cst?: string,
    date?: string,
  ): ClassificacaoTributariaRow[] {
    const term = termOrCode.trim();
    const cstTrimmed = cst?.trim() || null;
    const refDate = date !== undefined ? normalizeDate(date) : null;

    const rows = this.db
      .prepare(
        `SELECT ct.CLTR_ID AS cltrId,
                ct.CLTR_CD AS cClassTrib,
                ct.CLTR_DESCRICAO AS descricao,
                ct.CLTR_MEMORIA_CALCULO AS memoriaCalculo,
                st.SITR_ID AS sitrId,
                st.SITR_CD AS cst,
                st.SITR_DESCRICAO AS cstDescricao,
                MIN(tst.TRST_TBTO_ID) AS tributeId,
                ct.CLTR_TIPO_ALIQUOTA AS tipoAliquota,
                ct.CLTR_NOMENCLATURA AS nomenclatura,
                ct.CLTR_TPRBSN AS tpRbsn,
                ct.CLTR_CREDITO_OPERACAO_ANTECEDENTE AS creditoOperacaoAntecedente,
                ct.CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_CBS AS apropriacaoCreditoCbs,
                ct.CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_IBS AS apropriacaoCreditoIbs,
                ct.CLTR_IN_CREDITO_PRESUMIDO_FORNECEDOR AS creditoPresumidoFornecedor,
                ct.CLTR_IN_CREDITO_PRESUMIDO_ADQUIRENTE AS creditoPresumidoAdquirente,
                ct.CLTR_IND_GCREDPRESOPER AS indGCredPresOper,
                ct.CLTR_IND_GMONOPADRAO AS indGMonoPadrao,
                ct.CLTR_IND_GMONORETEN AS indGMonoReten,
                ct.CLTR_IND_GMONORET AS indGMonoRet,
                ct.CLTR_IND_GMONODIF AS indGMonoDif,
                ct.CLTR_IND_GESTORNOCRED AS indGEstornoCred,
                ct.CLTR_ANEXO AS anexo,
                st.SITR_IND_GIBSCBS AS sitrIndGIbsCbs,
                st.SITR_IND_GRED AS sitrIndGRed,
                st.SITR_IND_GDIF AS sitrIndGDif,
                ct.CLTR_INICIO_VIGENCIA AS inicioVigencia,
                ct.CLTR_FIM_VIGENCIA AS fimVigencia
         FROM CLASSIFICACAO_TRIBUTARIA ct
         JOIN SITUACAO_TRIBUTARIA st ON st.SITR_ID = ct.CLTR_SITR_ID
         JOIN TRIBUTO_SITUACAO_TRIBUTARIA tst ON tst.TRST_SITR_ID = st.SITR_ID
         WHERE (? IS NULL OR st.SITR_CD = ?)
           AND (? = '' OR ct.CLTR_CD LIKE ? || '%' OR ct.CLTR_DESCRICAO LIKE '%' || ? || '%')
           AND (? IS NULL OR (
                ct.CLTR_INICIO_VIGENCIA <= ? AND (ct.CLTR_FIM_VIGENCIA IS NULL OR ct.CLTR_FIM_VIGENCIA >= ?)
            AND st.SITR_INICIO_VIGENCIA <= ? AND (st.SITR_FIM_VIGENCIA IS NULL OR st.SITR_FIM_VIGENCIA >= ?)
            AND tst.TRST_INICIO_VIGENCIA <= ? AND (tst.TRST_FIM_VIGENCIA IS NULL OR tst.TRST_FIM_VIGENCIA >= ?)
           ))
         GROUP BY ct.CLTR_ID
         ORDER BY st.SITR_CD ASC, ct.CLTR_CD ASC
         LIMIT 100`,
      )
      .all(
        cstTrimmed,
        cstTrimmed,
        term,
        term,
        term,
        refDate,
        refDate,
        refDate,
        refDate,
        refDate,
        refDate,
        refDate,
      ) as RawClassificacaoRow[];

    return rows.map(mapClassificacaoRow);
  }

  checkNcmCompatByClassTrib(ncm: string, cClassTrib: string, date: string): boolean {
    return this.checkNomenclatureCompat(NOMENCLATURE_SPECS.ncm, ncm, cClassTrib, date);
  }

  checkNbsCompatByClassTrib(nbs: string, cClassTrib: string, date: string): boolean {
    return this.checkNomenclatureCompat(NOMENCLATURE_SPECS.nbs, nbs, cClassTrib, date);
  }

  /**
   * Evaluates the RFB NCM/NBS annex truth table (A / E / S predicates) against
   * `NCM_APLICAVEL` / `NBS_APLICAVEL` and their exception tables at `date`.
   */
  private checkNomenclatureCompat(
    spec: NomenclatureSpec,
    code: string,
    cClassTrib: string,
    date: string,
  ): boolean {
    const refDate = normalizeDate(date);
    const cltrId = this.resolveCltrIdForCompat(cClassTrib, refDate);
    if (cltrId === null) {
      return false;
    }

    const hasAnnex = this.hasActiveRow(
      `SELECT 1 FROM ${spec.table}
       WHERE ${spec.cltrCol} = ?
         AND ${spec.startCol} <= ?
         AND (${spec.endCol} IS NULL OR ${spec.endCol} >= ?)
       LIMIT 1`,
      [cltrId, refDate, refDate],
    );
    if (!hasAnnex) {
      return true;
    }

    const digits = code.replace(/\D/g, '');
    if (digits.length !== spec.requiredLength) {
      return false;
    }

    const matchesApplicable = this.hasActiveRow(
      `SELECT 1 FROM ${spec.table} n
       WHERE n.${spec.codeCol} = SUBSTR(?, 1, LENGTH(n.${spec.codeCol}))
         AND n.${spec.cltrCol} = ?
         AND n.${spec.startCol} <= ?
         AND (n.${spec.endCol} IS NULL OR n.${spec.endCol} >= ?)
       LIMIT 1`,
      [digits, cltrId, refDate, refDate],
    );
    if (!matchesApplicable) {
      return false;
    }

    const matchesException = this.hasActiveRow(
      `SELECT 1
       FROM ${spec.excTable} e
       JOIN ${spec.table} n ON n.${spec.idCol} = e.${spec.excFkCol}
       WHERE n.${spec.codeCol} = SUBSTR(?, 1, LENGTH(n.${spec.codeCol}))
         AND e.${spec.excCodeCol} = SUBSTR(?, 1, LENGTH(e.${spec.excCodeCol}))
         AND n.${spec.cltrCol} = ?
         AND n.${spec.startCol} <= ?
         AND (n.${spec.endCol} IS NULL OR n.${spec.endCol} >= ?)
         AND e.${spec.excStartCol} <= ?
         AND (e.${spec.excEndCol} IS NULL OR e.${spec.excEndCol} >= ?)
       LIMIT 1`,
      [digits, digits, cltrId, refDate, refDate, refDate, refDate],
    );
    if (!matchesException) {
      return true;
    }

    return this.hasActiveRow(
      `SELECT 1
       FROM ${spec.table} n
       WHERE n.${spec.codeCol} = SUBSTR(?, 1, LENGTH(n.${spec.codeCol}))
         AND n.${spec.cltrCol} = ?
         AND n.${spec.startCol} <= ?
         AND (n.${spec.endCol} IS NULL OR n.${spec.endCol} >= ?)
         AND NOT EXISTS (
           SELECT 1
           FROM ${spec.table} n2
           JOIN ${spec.excTable} e ON e.${spec.excFkCol} = n2.${spec.idCol}
           WHERE n2.${spec.cltrCol} = n.${spec.cltrCol}
             AND n2.${spec.codeCol} = n.${spec.codeCol}
             AND n2.${spec.startCol} <= ?
             AND (n2.${spec.endCol} IS NULL OR n2.${spec.endCol} >= ?)
             AND e.${spec.excCodeCol} = SUBSTR(?, 1, LENGTH(e.${spec.excCodeCol}))
             AND e.${spec.excStartCol} <= ?
             AND (e.${spec.excEndCol} IS NULL OR e.${spec.excEndCol} >= ?)
         )
       LIMIT 1`,
      [digits, cltrId, refDate, refDate, refDate, refDate, digits, refDate, refDate],
    );
  }

  checkTipoDfeCompat(siglaDfe: string, cltrId: number, date: string): boolean {
    const refDate = normalizeDate(date);
    const trimmed = siglaDfe.trim();
    if (!trimmed) {
      return false;
    }

    if (/^\d+$/.test(trimmed)) {
      const tpDoc = Number.parseInt(trimmed, 10);
      return this.hasActiveRow(
        `SELECT 1
         FROM TIPO_DFE_CLASSIFICACAO tdcl
         JOIN TIPO_DFE td ON td.TPDF_ID = tdcl.TDCL_TPDF_ID
         WHERE tdcl.TDCL_CLTR_ID = ?
           AND td.TPDF_TIPO = ?
           AND tdcl.TDCL_INICIO_VIGENCIA <= ?
           AND (tdcl.TDCL_FIM_VIGENCIA IS NULL OR tdcl.TDCL_FIM_VIGENCIA >= ?)
           AND td.TPDF_INICIO_VIGENCIA <= ?
           AND (td.TPDF_FIM_VIGENCIA IS NULL OR td.TPDF_FIM_VIGENCIA >= ?)
         LIMIT 1`,
        [cltrId, tpDoc, refDate, refDate, refDate, refDate],
      );
    }

    const normalizedSigla = normalizeDfeSigla(trimmed);
    return this.hasActiveRow(
      `SELECT 1
       FROM TIPO_DFE_CLASSIFICACAO tdcl
       JOIN TIPO_DFE td ON td.TPDF_ID = tdcl.TDCL_TPDF_ID
       WHERE tdcl.TDCL_CLTR_ID = ?
         AND UPPER(REPLACE(REPLACE(REPLACE(td.TPDF_SIGLA, ' ', ''), '-', ''), '_', '')) = ?
         AND tdcl.TDCL_INICIO_VIGENCIA <= ?
         AND (tdcl.TDCL_FIM_VIGENCIA IS NULL OR tdcl.TDCL_FIM_VIGENCIA >= ?)
         AND td.TPDF_INICIO_VIGENCIA <= ?
         AND (td.TPDF_FIM_VIGENCIA IS NULL OR td.TPDF_FIM_VIGENCIA >= ?)
       LIMIT 1`,
      [cltrId, normalizedSigla, refDate, refDate, refDate, refDate],
    );
  }

  getTratamentoParaClassificacao(cltrId: number, date: string): TratamentoTributarioRow | null {
    const refDate = normalizeDate(date);
    const row = this.db
      .prepare(
        `SELECT tt.TRTR_ID AS trtrId,
                tc.TRCL_CLTR_ID AS cltrId,
                tt.TRTR_DESCRICAO AS descricao,
                tt.TRTR_EXPRESSAO_ALIQUOTA AS expressaoAliquota,
                tt.TRTR_EXPRESSAO_ALIQUOTA_EFETIVA AS expressaoAliquotaEfetiva,
                tt.TRTR_EXPRESSAO_BASE_CALCULO AS expressaoBaseCalculo,
                tt.TRTR_EXPRESSAO_TRIBUTO_CALCULADO AS expressaoTributoCalculado,
                tt.TRTR_EXPRESSAO_TRIBUTO_DEVIDO AS expressaoTributoDevido,
                tt.TRTR_EXPRESSAO_PERCENTUAL_DIFERIMENTO AS expressaoPercentualDiferimento,
                tt.TRTR_EXPRESSAO_VALOR_DIFERIMENTO AS expressaoValorDiferimento,
                tt.TRTR_IN_INCOMPATIVEL_COM_SUSPENSAO AS inIncompativelComSuspensao,
                tt.TRTR_IN_EXIGE_GRUPO_DESONERACAO AS inExigeGrupoDesoneracao,
                tt.TRTR_IN_POSSUI_PERCENTUAL_REDUCAO AS inPossuiPercentualReducao,
                tt.TRTR_IN_POSSUI_AJUSTE AS inPossuiAjuste,
                tt.TRTR_IN_POSSUI_REDUTOR AS inPossuiRedutor,
                tt.TRTR_IN_POSSUI_MONOFASIA AS inPossuiMonofasia
         FROM TRATAMENTO_CLASSIFICACAO tc
         JOIN TRATAMENTO_TRIBUTARIO tt ON tt.TRTR_ID = tc.TRCL_TRTR_ID
         WHERE tc.TRCL_CLTR_ID = ?
           AND tc.TRCL_INICIO_VIGENCIA <= ?
           AND (tc.TRCL_FIM_VIGENCIA IS NULL OR tc.TRCL_FIM_VIGENCIA >= ?)
           AND tt.TRTR_INICIO_VIGENCIA <= ?
           AND (tt.TRTR_FIM_VIGENCIA IS NULL OR tt.TRTR_FIM_VIGENCIA >= ?)
         ORDER BY tc.TRCL_INICIO_VIGENCIA DESC
         LIMIT 1`,
      )
      .get(cltrId, refDate, refDate, refDate, refDate) as
      | {
          trtrId: number;
          cltrId: number;
          descricao: string;
          expressaoAliquota: string | null;
          expressaoAliquotaEfetiva: string | null;
          expressaoBaseCalculo: string;
          expressaoTributoCalculado: string;
          expressaoTributoDevido: string;
          expressaoPercentualDiferimento: string | null;
          expressaoValorDiferimento: string | null;
          inIncompativelComSuspensao: number;
          inExigeGrupoDesoneracao: number;
          inPossuiPercentualReducao: number;
          inPossuiAjuste: number;
          inPossuiRedutor: number;
          inPossuiMonofasia: number;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      trtrId: row.trtrId,
      cltrId: row.cltrId,
      descricao: row.descricao,
      expressaoAliquota: row.expressaoAliquota,
      expressaoAliquotaEfetiva: row.expressaoAliquotaEfetiva,
      expressaoBaseCalculo: row.expressaoBaseCalculo,
      expressaoTributoCalculado: row.expressaoTributoCalculado,
      expressaoTributoDevido: row.expressaoTributoDevido,
      expressaoPercentualDiferimento: row.expressaoPercentualDiferimento,
      expressaoValorDiferimento: row.expressaoValorDiferimento,
      inIncompativelComSuspensao: toBool(row.inIncompativelComSuspensao),
      inExigeGrupoDesoneracao: toBool(row.inExigeGrupoDesoneracao),
      inPossuiPercentualReducao: toBool(row.inPossuiPercentualReducao),
      inPossuiAjuste: toBool(row.inPossuiAjuste),
      inPossuiRedutor: toBool(row.inPossuiRedutor),
      inPossuiMonofasia: toBool(row.inPossuiMonofasia),
    };
  }

  getPercentualReducao(cltrId: number, tributeId: number, date: string): number | null {
    const refDate = normalizeDate(date);
    const row = this.db
      .prepare(
        `SELECT PERE_VALOR AS valor
         FROM PERCENTUAL_REDUCAO
         WHERE PERE_CLTR_ID = ?
           AND PERE_TBTO_ID = ?
           AND PERE_INICIO_VIGENCIA <= ?
           AND (PERE_FIM_VIGENCIA IS NULL OR PERE_FIM_VIGENCIA >= ?)
         ORDER BY PERE_INICIO_VIGENCIA DESC
         LIMIT 1`,
      )
      .get(cltrId, tributeId, refDate, refDate) as { valor: number } | undefined;

    return row?.valor ?? null;
  }

  getAliquotaReferencia(tributeId: number, date: string): number | null {
    const refDate = normalizeDate(date);
    const row = this.db
      .prepare(
        `SELECT ALRE_VALOR AS valor
         FROM ALIQUOTA_REFERENCIA
         WHERE ALRE_TBTO_ID = ?
           AND ALRE_INICIO_VIGENCIA <= ?
           AND (ALRE_FIM_VIGENCIA IS NULL OR ALRE_FIM_VIGENCIA >= ?)
         ORDER BY ALRE_INICIO_VIGENCIA DESC
         LIMIT 1`,
      )
      .get(tributeId, refDate, refDate) as { valor: number } | undefined;

    return row?.valor ?? null;
  }

  getAliquotaPadrao(
    tributeId: number,
    ufCd: number | null,
    muniCd: number | null,
    date: string,
  ): AliquotaPadraoRow | null {
    const refDate = normalizeDate(date);
    const row = this.db
      .prepare(
        `SELECT r.ALRE_VALOR AS valorReferencia,
                p.ALPA_VALOR AS valorPadrao,
                p.ALPA_FORMA_APLICACAO AS formaAplicacao
         FROM ALIQUOTA_REFERENCIA r
         LEFT JOIN ALIQUOTA_PADRAO p
           ON p.ALPA_ALRE_ID = r.ALRE_ID
          AND (
            (p.ALPA_MUNI_CD IS NOT NULL AND ? IS NOT NULL AND p.ALPA_MUNI_CD = ? AND (p.ALPA_UF_CD IS NULL OR p.ALPA_UF_CD = ?))
            OR (p.ALPA_MUNI_CD IS NULL AND p.ALPA_UF_CD IS NOT NULL AND ? IS NOT NULL AND p.ALPA_UF_CD = ?)
            OR (p.ALPA_MUNI_CD IS NULL AND p.ALPA_UF_CD IS NULL)
          )
          AND p.ALPA_INICIO_VIGENCIA <= ?
          AND (p.ALPA_FIM_VIGENCIA IS NULL OR p.ALPA_FIM_VIGENCIA >= ?)
         WHERE r.ALRE_TBTO_ID = ?
           AND r.ALRE_INICIO_VIGENCIA <= ?
           AND (r.ALRE_FIM_VIGENCIA IS NULL OR r.ALRE_FIM_VIGENCIA >= ?)
         ORDER BY r.ALRE_INICIO_VIGENCIA DESC,
                  CASE
                    WHEN p.ALPA_MUNI_CD IS NOT NULL THEN 0
                    WHEN p.ALPA_UF_CD IS NOT NULL THEN 1
                    ELSE 2
                  END ASC,
                  p.ALPA_INICIO_VIGENCIA DESC
         LIMIT 1`,
      )
      .get(
        muniCd,
        muniCd,
        ufCd,
        ufCd,
        ufCd,
        refDate,
        refDate,
        tributeId,
        refDate,
        refDate,
      ) as
      | {
          valorReferencia: number;
          valorPadrao: number | null;
          formaAplicacao: FormaAplicacaoAliquota | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const ref = new Decimal(row.valorReferencia);
    let aplicavel = ref;
    if (row.valorPadrao !== null) {
      const padrao = new Decimal(row.valorPadrao);
      if (row.formaAplicacao === 'ACRESCIMO') {
        aplicavel = ref.plus(padrao);
      } else if (row.formaAplicacao === 'DECRESCIMO') {
        aplicavel = ref.minus(padrao);
      } else if (row.formaAplicacao === 'SUBSTITUICAO') {
        aplicavel = padrao;
      }
    }

    return {
      valorReferencia: row.valorReferencia,
      valorPadrao: row.valorPadrao,
      formaAplicacao: row.formaAplicacao,
      valorAplicavel: aplicavel.toNumber(),
    };
  }

  getRedutorCompraGov(date: string): number | null {
    const refDate = normalizeDate(date);
    const row = this.db
      .prepare(
        `SELECT RCGO_VALOR AS valor
         FROM REDUTOR_COMPRA_GOVERNAMENTAL
         WHERE RCGO_INICIO_VIGENCIA <= ?
           AND (RCGO_FIM_VIGENCIA IS NULL OR RCGO_FIM_VIGENCIA >= ?)
         ORDER BY RCGO_INICIO_VIGENCIA DESC
         LIMIT 1`,
      )
      .get(refDate, refDate) as { valor: number } | undefined;

    return row?.valor ?? null;
  }

  getTransferenciaCbs(date: string): number | null {
    const refDate = normalizeDate(date);
    const row = this.db
      .prepare(
        `SELECT TCEG_VALOR AS valor
         FROM TRANSFERENCIA_CBS_ENTE_GOV
         WHERE TCEG_INICIO_VIGENCIA <= ?
           AND (TCEG_FIM_VIGENCIA IS NULL OR TCEG_FIM_VIGENCIA >= ?)
         ORDER BY TCEG_INICIO_VIGENCIA DESC
         LIMIT 1`,
      )
      .get(refDate, refDate) as { valor: number } | undefined;

    return row?.valor ?? null;
  }

  getFundamentacoesLegais(cltrId: number, date: string): FundamentacaoLegal[] {
    const refDate = normalizeDate(date);
    const rows = this.db
      .prepare(
        `SELECT fl.FDLG_ID AS id,
                fl.FDLG_REFERENCIA_NORMATIVA AS dispositivo,
                fl.FDLG_TEXTO_CURTO AS descricao,
                fl.FDLG_TEXTO AS texto
         FROM FUNDAMENTACAO_CLASSIFICACAO fc
         JOIN FUNDAMENTACAO_LEGAL fl ON fl.FDLG_ID = fc.FDCL_FDLG_ID
         WHERE fc.FDCL_CLTR_ID = ?
           AND fc.FDCL_INICIO_VIGENCIA <= ?
           AND (fc.FDCL_FIM_VIGENCIA IS NULL OR fc.FDCL_FIM_VIGENCIA >= ?)
           AND fl.FDLG_INICIO_VIGENCIA <= ?
           AND (fl.FDLG_FIM_VIGENCIA IS NULL OR fl.FDLG_FIM_VIGENCIA >= ?)
         ORDER BY fl.FDLG_ID ASC`,
      )
      .all(cltrId, refDate, refDate, refDate, refDate) as Array<{
      id: number;
      dispositivo: string;
      descricao: string;
      texto: string;
    }>;

    return rows.map((row) => ({
      codigo: String(row.id),
      dispositivo: row.dispositivo,
      descricao: row.descricao,
      texto: row.texto,
    }));
  }

  getCreditIndicators(cClassTrib: string, date: string): CreditIndicators | null {
    const classificacao = this.lookupClassificacao(cClassTrib, 2, date);
    if (!classificacao) {
      return null;
    }

    const parts = [
      `Apropriação CBS: ${classificacao.apropriacaoCreditoCbs ? 'Sim' : 'Não'}`,
      `Apropriação IBS: ${classificacao.apropriacaoCreditoIbs ? 'Sim' : 'Não'}`,
      `Créd. Presumido Fornecedor: ${classificacao.creditoPresumidoFornecedor ? 'Sim' : 'Não'}`,
      `Créd. Presumido Adquirente: ${classificacao.creditoPresumidoAdquirente ? 'Sim' : 'Não'}`,
      `Operação Antecedente: ${classificacao.creditoOperacaoAntecedente ?? 'N/A'}`,
    ];

    return {
      cClassTrib: classificacao.cClassTrib,
      cst: classificacao.cst,
      descricaoClassificacao: classificacao.descricao,
      apropriacaoCreditoCbs: classificacao.apropriacaoCreditoCbs,
      apropriacaoCreditoIbs: classificacao.apropriacaoCreditoIbs,
      creditoPresumidoFornecedor: classificacao.creditoPresumidoFornecedor,
      creditoPresumidoAdquirente: classificacao.creditoPresumidoAdquirente,
      creditoOperacaoAntecedente: classificacao.creditoOperacaoAntecedente,
      resumoTexto: parts.join(' | '),
    };
  }

  getAtividadesSimples(
    date: string,
    filters?: { anexo?: string; cClassTrib?: string; tipoDocumento?: number },
  ): AtividadeSimplesRow[] {
    const refDate = normalizeDate(date);
    const anexosConfigurados = parseConfiguredAnexos(filters?.anexo);

    let vedadoNaoTributavel: boolean | null = null;
    if (filters?.cClassTrib !== undefined && filters.cClassTrib.trim().length > 0) {
      const classificacao = this.lookupClassificacao(filters.cClassTrib.trim(), 2, refDate);
      if (!classificacao) {
        throw new Error(
          `Classificação tributária '${filters.cClassTrib}' não encontrada ou fora de vigência no grupo CBS na data ${refDate}`,
        );
      }
      const trbs = this.getTipoReceitaBrutaSimples(classificacao.tpRbsn, refDate);
      if (!trbs) {
        throw new Error(
          `Parametrização de efeito vigente não encontrada para tpRBSN=${classificacao.tpRbsn} na data ${refDate}`,
        );
      }
      vedadoNaoTributavel = trbs.vedadoNaoTributavel;
    }

    const vinculos = this.db
      .prepare(
        `SELECT t.TDAS_ATSN_ID AS atsnId, td.TPDF_TIPO AS tpDoc
         FROM TIPO_DFE_ATIVIDADE_SIMPLES_NACIONAL t
         JOIN TIPO_DFE td ON td.TPDF_ID = t.TDAS_TPDF_ID
         WHERE t.TDAS_INICIO_VIGENCIA <= ?
           AND (t.TDAS_FIM_VIGENCIA IS NULL OR t.TDAS_FIM_VIGENCIA >= ?)
           AND td.TPDF_INICIO_VIGENCIA <= ?
           AND (td.TPDF_FIM_VIGENCIA IS NULL OR td.TPDF_FIM_VIGENCIA >= ?)
         ORDER BY td.TPDF_TIPO ASC`,
      )
      .all(refDate, refDate, refDate, refDate) as Array<{ atsnId: number; tpDoc: number | null }>;

    const tpDocsByAtividade = new Map<number, number[]>();
    for (const v of vinculos) {
      if (v.tpDoc === null) {
        continue;
      }
      const list = tpDocsByAtividade.get(v.atsnId) ?? [];
      list.push(v.tpDoc);
      tpDocsByAtividade.set(v.atsnId, list);
    }

    const rows = this.db
      .prepare(
        `SELECT ATSN_ID AS atsnId,
                ATSN_CATIVSN AS cAtivSN,
                ATSN_ORDEM AS ordem,
                ATSN_DESCRICAO AS descricao,
                ATSN_ANEXO_SEM_FATOR_R AS anexoSemFatorR,
                ATSN_ANEXO_COM_FATOR_R AS anexoComFatorR,
                ATSN_IN_NAO_TRIBUTAVEL AS naoTributavel,
                ATSN_ROTULO AS rotuloAnexo,
                ATSN_ROTULO_CURTO AS rotuloCurtoAnexo
         FROM ATIVIDADE_SIMPLES_NACIONAL
         WHERE ATSN_INICIO_VIGENCIA <= ?
           AND (ATSN_FIM_VIGENCIA IS NULL OR ATSN_FIM_VIGENCIA >= ?)
         ORDER BY ATSN_ORDEM ASC`,
      )
      .all(refDate, refDate) as Array<{
      atsnId: number;
      cAtivSN: string;
      ordem: number;
      descricao: string;
      anexoSemFatorR: string | null;
      anexoComFatorR: string | null;
      naoTributavel: number;
      rotuloAnexo: string;
      rotuloCurtoAnexo: string;
    }>;

    const tpDocFilter = filters?.tipoDocumento;

    return rows.map((row) => {
      const derivacao = deriveAnexosSimples(
        row.anexoSemFatorR,
        row.anexoComFatorR,
        anexosConfigurados,
      );
      const naoTributavel = toBool(row.naoTributavel);
      const tpDocsAdmissiveis = tpDocsByAtividade.get(row.atsnId) ?? [];
      const admissivelNoDocumento =
        tpDocFilter === undefined ? null : tpDocsAdmissiveis.includes(tpDocFilter);
      const compativelComClassTrib =
        vedadoNaoTributavel === null ? null : !(vedadoNaoTributavel && naoTributavel);
      const disponivel =
        derivacao.disponivel &&
        admissivelNoDocumento !== false &&
        compativelComClassTrib !== false;

      return {
        atsnId: row.atsnId,
        cAtivSN: row.cAtivSN,
        ordem: row.ordem,
        descricao: row.descricao,
        anexoSemFatorR: row.anexoSemFatorR,
        anexoComFatorR: row.anexoComFatorR,
        sujeitaFatorR: row.anexoComFatorR !== null,
        naoTributavel,
        rotuloAnexo: row.rotuloAnexo,
        rotuloCurtoAnexo: row.rotuloCurtoAnexo,
        disponivel,
        anexosFaltantes: derivacao.anexosFaltantes,
        modoFatorR: derivacao.modoFatorR,
        tpDocsAdmissiveis,
        admissivelNoDocumento,
        compativelComClassTrib,
      };
    });
  }

  getRegimeApuracaoSimples(
    crt: number,
    tpRegimeIbsCbs: number | null,
    date: string,
  ): RegimeApuracaoSimplesRow | null {
    const refDate = normalizeDate(date);
    const row = this.db
      .prepare(
        `SELECT RASN_ID AS rasnId,
                RASN_CRT AS crt,
                RASN_TPREGIMEIBSCBS AS tpRegimeIbsCbs,
                RASN_DESCRICAO AS descricao,
                RASN_IN_GERA_IBS AS geraIbs,
                RASN_DESTINO_DEVIDO AS destinoDevido,
                RASN_DESTINO_PENDENTE_SUSPENSO AS destinoPendenteSuspenso
         FROM REGIME_APURACAO_SIMPLES_NACIONAL
         WHERE RASN_CRT = ?
           AND ((? IS NULL AND RASN_TPREGIMEIBSCBS IS NULL) OR RASN_TPREGIMEIBSCBS = ?)
           AND RASN_INICIO_VIGENCIA <= ?
           AND (RASN_FIM_VIGENCIA IS NULL OR RASN_FIM_VIGENCIA >= ?)
         ORDER BY RASN_INICIO_VIGENCIA DESC
         LIMIT 1`,
      )
      .get(crt, tpRegimeIbsCbs, tpRegimeIbsCbs, refDate, refDate) as
      | {
          rasnId: number;
          crt: number;
          tpRegimeIbsCbs: number | null;
          descricao: string;
          geraIbs: number;
          destinoDevido: 'DEVIDO' | 'PENDENTE_SUSPENSO';
          destinoPendenteSuspenso: 'PENDENTE_SUSPENSO' | 'ZERO';
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      rasnId: row.rasnId,
      crt: row.crt,
      tpRegimeIbsCbs: row.tpRegimeIbsCbs,
      descricao: row.descricao,
      geraIbs: toBool(row.geraIbs),
      destinoDevido: row.destinoDevido,
      destinoPendenteSuspenso: row.destinoPendenteSuspenso,
    };
  }

  getTipoReceitaBrutaSimples(tpRbsn: number, date: string): TipoReceitaBrutaSimplesRow | null {
    const refDate = normalizeDate(date);
    const row = this.db
      .prepare(
        `SELECT TRBS_ID AS trbsId,
                TRBS_CD AS tpRbsn,
                TRBS_DESCRICAO AS descricao,
                TRBS_IN_COMPOE_RECEITA AS compoeReceita,
                TRBS_IN_IS_COMPOE_RECEITA AS isCompoeReceita,
                TRBS_FATOR_RECEITA AS fatorReceita,
                TRBS_IN_PENDENTE_SUSPENSO AS pendenteSuspenso,
                TRBS_IN_EXIGE_ALIQUOTA AS exigeAliquota,
                TRBS_IN_VEDADO_NAO_TRIBUTAVEL AS vedadoNaoTributavel
         FROM TIPO_RECEITA_BRUTA_SIMPLES_NACIONAL
         WHERE TRBS_CD = ?
           AND TRBS_INICIO_VIGENCIA <= ?
           AND (TRBS_FIM_VIGENCIA IS NULL OR TRBS_FIM_VIGENCIA >= ?)
         ORDER BY TRBS_INICIO_VIGENCIA DESC
         LIMIT 1`,
      )
      .get(tpRbsn, refDate, refDate) as
      | {
          trbsId: number;
          tpRbsn: number;
          descricao: string;
          compoeReceita: number;
          isCompoeReceita: number;
          fatorReceita: number;
          pendenteSuspenso: number;
          exigeAliquota: number;
          vedadoNaoTributavel: number;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      trbsId: row.trbsId,
      tpRbsn: row.tpRbsn,
      descricao: row.descricao,
      compoeReceita: toBool(row.compoeReceita),
      isCompoeReceita: toBool(row.isCompoeReceita),
      fatorReceita: row.fatorReceita,
      pendenteSuspenso: toBool(row.pendenteSuspenso),
      exigeAliquota: toBool(row.exigeAliquota),
      vedadoNaoTributavel: toBool(row.vedadoNaoTributavel),
    };
  }

  getFatorTransicaoCompraGovSimples(date: string): number | null {
    const refDate = normalizeDate(date);
    const row = this.db
      .prepare(
        `SELECT TACG_FATOR AS fator
         FROM TRANSICAO_ALIQUOTA_COMPRA_GOV_SIMPLES_NACIONAL
         WHERE TACG_INICIO_VIGENCIA <= ?
           AND (TACG_FIM_VIGENCIA IS NULL OR TACG_FIM_VIGENCIA >= ?)
         ORDER BY TACG_INICIO_VIGENCIA DESC
         LIMIT 1`,
      )
      .get(refDate, refDate) as { fator: number } | undefined;

    return row?.fator ?? null;
  }

  isTipoDfeHabilitadoSimples(tpDoc: number, date: string): boolean {
    const refDate = normalizeDate(date);
    return this.hasActiveRow(
      `SELECT 1
       FROM TIPO_DFE_CALCULO_SIMPLES_NACIONAL t
       JOIN TIPO_DFE td ON td.TPDF_ID = t.TDCS_TPDF_ID
       WHERE td.TPDF_TIPO = ?
         AND t.TDCS_INICIO_VIGENCIA <= ?
         AND (t.TDCS_FIM_VIGENCIA IS NULL OR t.TDCS_FIM_VIGENCIA >= ?)
         AND td.TPDF_INICIO_VIGENCIA <= ?
         AND (td.TPDF_FIM_VIGENCIA IS NULL OR td.TPDF_FIM_VIGENCIA >= ?)
       LIMIT 1`,
      [tpDoc, refDate, refDate, refDate, refDate],
    );
  }

  isAtividadeAdmissivelDocumentoSimples(atsnId: number, tpDoc: number, date: string): boolean {
    const refDate = normalizeDate(date);
    return this.hasActiveRow(
      `SELECT 1
       FROM TIPO_DFE_ATIVIDADE_SIMPLES_NACIONAL t
       JOIN TIPO_DFE td ON td.TPDF_ID = t.TDAS_TPDF_ID
       WHERE t.TDAS_ATSN_ID = ?
         AND td.TPDF_TIPO = ?
         AND t.TDAS_INICIO_VIGENCIA <= ?
         AND (t.TDAS_FIM_VIGENCIA IS NULL OR t.TDAS_FIM_VIGENCIA >= ?)
         AND td.TPDF_INICIO_VIGENCIA <= ?
         AND (td.TPDF_FIM_VIGENCIA IS NULL OR td.TPDF_FIM_VIGENCIA >= ?)
       LIMIT 1`,
      [atsnId, tpDoc, refDate, refDate, refDate, refDate],
    );
  }

  private resolveCltrIdForCompat(cClassTrib: string, refDate: string): number | null {
    const cbs = this.lookupClassificacao(cClassTrib, 2, refDate);
    if (cbs) {
      return cbs.cltrId;
    }
    const is = this.lookupClassificacao(cClassTrib, 1, refDate);
    return is ? is.cltrId : null;
  }

  private hasActiveRow(sql: string, params: unknown[]): boolean {
    const row = this.db.prepare(sql).get(...params);
    return row !== undefined;
  }
}

interface RawClassificacaoRow {
  cltrId: number;
  cClassTrib: string;
  descricao: string;
  memoriaCalculo: string;
  sitrId: number;
  cst: string;
  cstDescricao: string;
  tributeId: number;
  tipoAliquota: string;
  nomenclatura: string | null;
  tpRbsn: number;
  creditoOperacaoAntecedente: string | null;
  apropriacaoCreditoCbs: number | null;
  apropriacaoCreditoIbs: number | null;
  creditoPresumidoFornecedor: number | null;
  creditoPresumidoAdquirente: number | null;
  indGCredPresOper: number | null;
  indGMonoPadrao: number | null;
  indGMonoReten: number | null;
  indGMonoRet: number | null;
  indGMonoDif: number | null;
  indGEstornoCred: number | null;
  anexo: string | null;
  sitrIndGIbsCbs: number | null;
  sitrIndGRed: number | null;
  sitrIndGDif: number | null;
  inicioVigencia: string;
  fimVigencia: string | null;
}

function mapClassificacaoRow(row: RawClassificacaoRow): ClassificacaoTributariaRow {
  return {
    cltrId: row.cltrId,
    cClassTrib: row.cClassTrib,
    descricao: row.descricao,
    memoriaCalculo: row.memoriaCalculo,
    sitrId: row.sitrId,
    cst: row.cst,
    cstDescricao: row.cstDescricao,
    tributeId: row.tributeId,
    tipoAliquota: row.tipoAliquota,
    nomenclatura: row.nomenclatura,
    tpRbsn: row.tpRbsn,
    creditoOperacaoAntecedente: row.creditoOperacaoAntecedente,
    apropriacaoCreditoCbs: toBool(row.apropriacaoCreditoCbs),
    apropriacaoCreditoIbs: toBool(row.apropriacaoCreditoIbs),
    creditoPresumidoFornecedor: toBool(row.creditoPresumidoFornecedor),
    creditoPresumidoAdquirente: toBool(row.creditoPresumidoAdquirente),
    indGCredPresOper: toBool(row.indGCredPresOper),
    indGMonoPadrao: toBool(row.indGMonoPadrao),
    indGMonoReten: toBool(row.indGMonoReten),
    indGMonoRet: toBool(row.indGMonoRet),
    indGMonoDif: toBool(row.indGMonoDif),
    indGEstornoCred: toBool(row.indGEstornoCred),
    anexo: row.anexo,
    sitrIndGIbsCbs: toBool(row.sitrIndGIbsCbs),
    sitrIndGRed: toBool(row.sitrIndGRed),
    sitrIndGDif: toBool(row.sitrIndGDif),
    inicioVigencia: row.inicioVigencia,
    fimVigencia: row.fimVigencia,
  };
}

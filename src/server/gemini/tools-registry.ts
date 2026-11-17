import crypto from 'node:crypto';
import {
  BaseCalculoUnificadaInputSchema,
  BaseCalculoUnificadaNfseInputSchema,
  type CalcRunSnapshot,
  CompareRegimesInputSchema,
  OperacaoInputSchema,
  OperacaoSimplesInputSchema,
  type OperationContext,
} from '../../shared/types/fiscal.js';
import type { DadosAbertosRepository } from '../db/dados-abertos-repo.js';
import type { WorkspaceStore } from '../db/workspace-db.js';
import type { FiscalEngineRouter } from '../engine/engine-router.js';
import { lookupErrorDescription } from '../engine/error-catalog.js';

export interface GeminiFunctionDeclaration {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface FiscalToolExecutionDeps {
  repo: DadosAbertosRepository;
  router: FiscalEngineRouter;
  store: WorkspaceStore;
  sessionId?: string;
}

export interface FiscalToolExecutionResult {
  output: unknown;
  summary: string;
  isError: boolean;
  calcRunId?: string;
  snapshot?: CalcRunSnapshot;
}

const DEFAULT_REF_DATE = '2026-01-01';

function normalizeRefDate(raw: unknown): string {
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.trim())) {
    return raw.trim().slice(0, 10);
  }
  return DEFAULT_REF_DATE;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export const FISCAL_TOOL_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    type: 'function',
    name: 'lookup_ncm',
    description:
      'Consulta códigos NCM e descrições oficiais na tabela vigente da RFB para a data do fato gerador.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Código NCM (prefixo ou 8 dígitos) ou termo descritivo.' },
        dhFatoGerador: { type: 'string', description: 'Data de referência YYYY-MM-DD (padrão 2026-01-01).' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'lookup_nbs',
    description:
      'Consulta códigos NBS de serviços e vínculo LC 116 na tabela oficial da RFB.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Código NBS (prefixo ou 9 dígitos) ou termo descritivo.' },
        dhFatoGerador: { type: 'string', description: 'Data de referência YYYY-MM-DD (padrão 2026-01-01).' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'search_cclasstrib',
    description:
      'Pesquisa classificações tributárias (cClassTrib) e CSTs oficiais da LC 214/2025, incluindo indicadores de crédito.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Código cClassTrib ou termo na descrição.' },
        cst: { type: 'string', description: 'Filtro opcional de CST (ex.: 000, 200, 410).' },
        dhFatoGerador: { type: 'string', description: 'Data de referência YYYY-MM-DD.' },
      },
    },
  },
  {
    type: 'function',
    name: 'validate_ncm_nbs_cclasstrib',
    description:
      'Valida se um NCM, NBS ou tipo de DF-e é compatível com uma classificação tributária (cClassTrib) na data do fato gerador.',
    parameters: {
      type: 'object',
      properties: {
        cClassTrib: { type: 'string', description: 'Código cClassTrib (6 dígitos).' },
        ncm: { type: 'string', description: 'Código NCM de 8 dígitos (opcional).' },
        nbs: { type: 'string', description: 'Código NBS de 9 dígitos (opcional).' },
        tipoDfe: { type: 'string', description: 'Sigla ou código do DF-e (ex.: 55, 65, NFSE).' },
        dhFatoGerador: { type: 'string', description: 'Data de referência YYYY-MM-DD.' },
      },
      required: ['cClassTrib'],
    },
  },
  {
    type: 'function',
    name: 'lookup_aliquotas_referencia',
    description:
      'Consulta alíquotas de referência e alíquotas padrão vigentes (CBS, IBS UF, IBS Municipal) por UF/município e data.',
    parameters: {
      type: 'object',
      properties: {
        dhFatoGerador: { type: 'string', description: 'Data de referência YYYY-MM-DD.' },
        uf: { type: 'string', description: 'Sigla UF (ex.: RS, SP).' },
        ufCd: { type: 'number', description: 'Código numérico IBGE da UF (opcional).' },
        municipio: { type: 'number', description: 'Código IBGE do município (7 dígitos, opcional).' },
      },
    },
  },
  {
    type: 'function',
    name: 'lookup_atividade_simples',
    description:
      'Consulta atividades do Simples Nacional (cAtivSN), anexos, exigência de Fator R e compatibilidade com cClassTrib e tipoDocumento (NT 2026.005).',
    parameters: {
      type: 'object',
      properties: {
        dhFatoGerador: { type: 'string', description: 'Data de referência YYYY-MM-DD.' },
        cAtivSN: { type: 'string', description: 'Filtro opcional pelo código cAtivSN (ex.: 11, 21, 90).' },
        anexo: { type: 'string', description: 'Filtro opcional de anexo (I, II, III, IV, V).' },
        cClassTrib: { type: 'string', description: 'Filtro opcional de compatibilidade com cClassTrib.' },
        tipoDocumento: { type: 'number', description: 'Código numérico tpDoc do documento fiscal.' },
      },
    },
  },
  {
    type: 'function',
    name: 'calculate_fator_r',
    description:
      'Calcula o Fator R (Folha de Salários 12m ÷ RBT12) e sugere enquadramento no Anexo III (>= 0,28) ou Anexo V (< 0,28).',
    parameters: {
      type: 'object',
      properties: {
        folha12m: { type: ['number', 'string'], description: 'Folha de salários acumulada nos últimos 12 meses.' },
        rbt12m: { type: ['number', 'string'], description: 'Receita Bruta Total acumulada nos últimos 12 meses.' },
      },
      required: ['folha12m', 'rbt12m'],
    },
  },
  {
    type: 'function',
    name: 'calculate_base_unificada',
    description:
      'Calcula de forma determinística a Base de Cálculo Unificada (baseRG, baseIS, baseSN) para NF-e/NFC-e ou NFS-e considerando transição de PIS/COFINS/ICMS/ISS/IPI.',
    parameters: {
      type: 'object',
      properties: {
        modelo: { type: 'string', enum: ['nfe', 'nfse'], description: 'Modelo de apuração de base (padrão nfe).' },
        anoFatoGerador: { type: 'number', description: 'Ano do fato gerador (>= 2026).' },
        tipoDocumento: { type: 'number', description: 'Código tpDoc (ex.: 55 para NF-e, 65 para NFC-e).' },
        natureza: { type: 'string', enum: ['bem', 'servico'], description: 'Natureza da operação para NF-e/NFC-e.' },
        vProd: { type: ['number', 'string'] },
        vServ: { type: ['number', 'string'] },
        vFrete: { type: ['number', 'string'] },
        vSeg: { type: ['number', 'string'] },
        vOutro: { type: ['number', 'string'] },
        vDesc: { type: ['number', 'string'] },
        vIS: { type: ['number', 'string'] },
        vPIS: { type: ['number', 'string'] },
        vCOFINS: { type: ['number', 'string'] },
        vICMS: { type: ['number', 'string'] },
        vFCP: { type: ['number', 'string'] },
        vISS: { type: ['number', 'string'] },
        vII: { type: ['number', 'string'] },
        vIPI: { type: ['number', 'string'] },
        isMei: { type: 'boolean' },
        vDescIncond: { type: ['number', 'string'] },
        vDescCond: { type: ['number', 'string'] },
        vDedRed: { type: ['number', 'string'] },
        vOutrosAjustes: { type: ['number', 'string'] },
        ehLocacao: { type: 'boolean' },
      },
      required: ['anoFatoGerador'],
    },
  },
  {
    type: 'function',
    name: 'calculate_regime_regular',
    description:
      'Executa o motor determinístico do Regime Regular (CBS, IBS Estadual, IBS Municipal e Imposto Seletivo), salva CalcRunSnapshot e retorna calcRunId + output completo.',
    parameters: {
      type: 'object',
      properties: {
        dhFatoGerador: { type: 'string', description: 'Data/hora ISO YYYY-MM-DD ou YYYY-MM-DDTHH:mm:ss-03:00.' },
        uf: { type: 'string', description: 'Sigla UF (2 letras).' },
        ufCd: { type: 'number' },
        municipio: { type: 'number', description: 'Código IBGE do município (7 dígitos).' },
        tipoDfe: { type: ['string', 'number'], description: 'Tipo DF-e (55, 65, NFSE).' },
        tpEnteGov: { type: 'number', description: '1=União, 2=Estado, 3=DF, 4=Município (opcional).' },
        pRedCompraGov: { type: ['number', 'string'] },
        modo: { type: 'string', enum: ['observabilidade', 'estrito'] },
        itens: {
          type: 'array',
          items: { type: 'object' },
          description: 'Lista de itens com cst, cClassTrib, ncm/nbs, baseCalculo, aliquotasNominais (para >= 2027), impostoSeletivo, diferimento.',
        },
      },
      required: ['dhFatoGerador', 'itens'],
    },
  },
  {
    type: 'function',
    name: 'calculate_simples_nacional',
    description:
      'Executa o motor determinístico do Simples Nacional (NT 2026.005 v1.00), salva CalcRunSnapshot e retorna calcRunId + output completo.',
    parameters: {
      type: 'object',
      properties: {
        dhFatoGerador: { type: 'string', description: 'Data/hora ISO YYYY-MM-DD.' },
        tpDoc: { type: 'number', description: 'Código tpDoc (ex.: 55, 65, 99).' },
        CRT: { type: 'number', enum: [1, 2, 3], description: '1=Simples, 2=Excesso sublimite, 3=Regime Normal.' },
        tpRegimeIBSCBS: { type: 'number', enum: [1, 2], description: '1=Optante regular, 2=Apuração pelo Simples.' },
        tpEnteGov: { type: 'number' },
        itens: {
          type: 'array',
          items: { type: 'object' },
          description: 'Itens com cAtivSN, cClassTrib, baseCalculo, pIBSSN, pCBSSN, valorImpostoSeletivo.',
        },
      },
      required: ['dhFatoGerador', 'tpDoc', 'CRT', 'itens'],
    },
  },
  {
    type: 'function',
    name: 'compare_regimes',
    description:
      'Compara lado a lado Regime Regular, Simples Nacional CRT=1, Simples Híbrido (tpRegimeIBSCBS=1) e opcionalmente Excesso Sublimite CRT=2 para datas >= 2027-01-01.',
    parameters: {
      type: 'object',
      properties: {
        dhFatoGerador: { type: 'string', description: 'Data >= 2027-01-01.' },
        tpDoc: { type: 'number', description: 'Código numérico tpDoc (ex.: 55).' },
        uf: { type: 'string' },
        ufCd: { type: 'number' },
        municipio: { type: 'number' },
        tpEnteGov: { type: 'number' },
        incluirSublimiteCrt2: { type: 'boolean' },
        itens: {
          type: 'array',
          items: { type: 'object' },
        },
      },
      required: ['dhFatoGerador', 'tpDoc', 'itens'],
    },
  },
  {
    type: 'function',
    name: 'lookup_error_code',
    description:
      'Consulta a descrição oficial de um código de erro fiscal (REG-*, VSN-*, CAL-*, VAL-*).',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Código do erro (ex.: REG-011, VSN-019).' },
      },
      required: ['code'],
    },
  },
  {
    type: 'function',
    name: 'generate_tax_xml',
    description:
      'Gera XML NF-e ou NFC-e dos grupos IBSCBS/IS a partir de um CalcRunSnapshot existente no Regime Regular.',
    parameters: {
      type: 'object',
      properties: {
        calcRunId: { type: 'string', description: 'ID do CalcRunSnapshot salvo.' },
        tipo: { type: 'string', enum: ['nfe', 'nfce'], description: 'Modelo de documento XML (padrão nfe).' },
      },
      required: ['calcRunId'],
    },
  },
];

function buildContextFromCalculation(
  regime: OperationContext['regime'],
  dhFatoGerador: string,
  extra?: { tipoDfe?: unknown; uf?: string; ufCd?: number; municipio?: number; crt?: 1 | 2 | 3; tpRegimeIBSCBS?: 1 | 2; tpEnteGov?: 1 | 2 | 3 | 4 | null },
): Partial<OperationContext> {
  const tipoDfeStr =
    extra?.tipoDfe === 65 || extra?.tipoDfe === '65'
      ? '65'
      : extra?.tipoDfe === 'NFSE' || extra?.tipoDfe === 99 || extra?.tipoDfe === '99'
        ? 'NFSE'
        : '55';

  return {
    regime,
    dhFatoGerador,
    tipoDfe: tipoDfeStr,
    uf: extra?.uf,
    ufCd: extra?.ufCd,
    municipio: extra?.municipio,
    crt: extra?.crt,
    tpRegimeIBSCBS: extra?.tpRegimeIBSCBS,
    tpEnteGov: extra?.tpEnteGov,
  };
}

/**
 * Executes one of the 13 deterministic fiscal tools against the RFB SQLite repository,
 * dual-engine router, and workspace persistence store.
 */
export async function executeFiscalTool(
  name: string,
  args: Record<string, unknown>,
  deps: FiscalToolExecutionDeps,
): Promise<FiscalToolExecutionResult> {
  const { repo, router, store, sessionId } = deps;

  try {
    switch (name) {
      case 'lookup_ncm': {
        const query = asOptionalString(args.query) ?? '';
        const date = normalizeRefDate(args.dhFatoGerador);
        const rows = repo.lookupNcm(query, date);
        return {
          output: { dhFatoGerador: date, count: rows.length, items: rows.slice(0, 20) },
          summary: `NCM "${query}": ${rows.length} resultado(s)`,
          isError: false,
        };
      }

      case 'lookup_nbs': {
        const query = asOptionalString(args.query) ?? '';
        const date = normalizeRefDate(args.dhFatoGerador);
        const rows = repo.lookupNbs(query, date);
        return {
          output: { dhFatoGerador: date, count: rows.length, items: rows.slice(0, 20) },
          summary: `NBS "${query}": ${rows.length} resultado(s)`,
          isError: false,
        };
      }

      case 'search_cclasstrib': {
        const query = asOptionalString(args.query) ?? '';
        const cst = asOptionalString(args.cst);
        const date = args.dhFatoGerador !== undefined ? normalizeRefDate(args.dhFatoGerador) : undefined;
        const rows = repo.searchClassificacoes(query, cst, date);
        return {
          output: {
            count: rows.length,
            items: rows.slice(0, 20).map((r) => ({
              cClassTrib: r.cClassTrib,
              cst: r.cst,
              cstDescricao: r.cstDescricao,
              descricao: r.descricao,
              tipoAliquota: r.tipoAliquota,
              nomenclatura: r.nomenclatura,
              anexo: r.anexo,
              tpRbsn: r.tpRbsn,
              apropriacaoCreditoCbs: r.apropriacaoCreditoCbs,
              apropriacaoCreditoIbs: r.apropriacaoCreditoIbs,
              creditoPresumidoFornecedor: r.creditoPresumidoFornecedor,
              creditoPresumidoAdquirente: r.creditoPresumidoAdquirente,
              creditoOperacaoAntecedente: r.creditoOperacaoAntecedente,
            })),
          },
          summary: `cClassTrib "${query || cst || '*'}": ${rows.length} resultado(s)`,
          isError: false,
        };
      }

      case 'validate_ncm_nbs_cclasstrib': {
        const cClassTrib = asOptionalString(args.cClassTrib);
        if (!cClassTrib) {
          return {
            output: { error: 'cClassTrib é obrigatório.' },
            summary: 'Erro: cClassTrib ausente',
            isError: true,
          };
        }
        const date = normalizeRefDate(args.dhFatoGerador);
        const ncm = asOptionalString(args.ncm);
        const nbs = asOptionalString(args.nbs);
        const tipoDfe = asOptionalString(args.tipoDfe);

        const classif =
          repo.lookupClassificacao(cClassTrib, 2, date) ??
          repo.lookupClassificacao(cClassTrib, 1, date);
        if (!classif) {
          return {
            output: { valid: false, cClassTrib, dhFatoGerador: date, reason: 'cClassTrib não encontrado na vigência.' },
            summary: `cClassTrib ${cClassTrib} não vigente em ${date}`,
            isError: false,
          };
        }

        const ncmCompatible = ncm ? repo.checkNcmCompatByClassTrib(ncm, cClassTrib, date) : null;
        const nbsCompatible = nbs ? repo.checkNbsCompatByClassTrib(nbs, cClassTrib, date) : null;
        const tipoDfeCompatible = tipoDfe
          ? repo.checkTipoDfeCompat(tipoDfe, classif.cltrId, date)
          : null;

        const valid =
          ncmCompatible !== false && nbsCompatible !== false && tipoDfeCompatible !== false;

        return {
          output: {
            valid,
            dhFatoGerador: date,
            cClassTrib: classif.cClassTrib,
            cst: classif.cst,
            descricao: classif.descricao,
            ncmCompatible,
            nbsCompatible,
            tipoDfeCompatible,
            creditIndicators: repo.getCreditIndicators(cClassTrib, date),
            fundamentacoesLegais: repo.getFundamentacoesLegais(classif.cltrId, date),
          },
          summary: `Validação ${cClassTrib}: ${valid ? 'compatível' : 'incompatível'}`,
          isError: false,
        };
      }

      case 'lookup_aliquotas_referencia': {
        const date = normalizeRefDate(args.dhFatoGerador);
        const ufSigla = asOptionalString(args.uf)?.toUpperCase();
        let ufCd = asOptionalNumber(args.ufCd) ?? null;
        if (ufCd === null && ufSigla) {
          const matchUf = repo.listUfs().find((u) => u.sigla.toUpperCase() === ufSigla);
          if (matchUf) {
            ufCd = matchUf.ufCd;
          }
        }
        const muniCd = asOptionalNumber(args.municipio) ?? null;

        const cbsRef = repo.getAliquotaReferencia(2, date);
        const ibsUfRef = repo.getAliquotaReferencia(3, date);
        const ibsMunRef = repo.getAliquotaReferencia(4, date);

        const cbsPadrao = repo.getAliquotaPadrao(2, ufCd, muniCd, date);
        const ibsUfPadrao = repo.getAliquotaPadrao(3, ufCd, null, date);
        const ibsMunPadrao = repo.getAliquotaPadrao(4, ufCd, muniCd, date);

        return {
          output: {
            dhFatoGerador: date,
            uf: ufSigla ?? null,
            ufCd,
            municipio: muniCd,
            cbs: { referencia: cbsRef, padrao: cbsPadrao },
            ibsUf: { referencia: ibsUfRef, padrao: ibsUfPadrao },
            ibsMun: { referencia: ibsMunRef, padrao: ibsMunPadrao },
            redutorCompraGov: repo.getRedutorCompraGov(date),
            transferenciaCbs: repo.getTransferenciaCbs(date),
          },
          summary: `Alíquotas em ${date}: CBS=${cbsPadrao?.valorAplicavel ?? cbsRef ?? 'N/A'}`,
          isError: false,
        };
      }

      case 'lookup_atividade_simples': {
        const date = normalizeRefDate(args.dhFatoGerador);
        const cAtivSN = asOptionalString(args.cAtivSN);
        const anexo = asOptionalString(args.anexo);
        const cClassTrib = asOptionalString(args.cClassTrib);
        const tipoDocumento = asOptionalNumber(args.tipoDocumento);

        let items = repo.getAtividadesSimples(date, { anexo, cClassTrib, tipoDocumento });
        if (cAtivSN) {
          items = items.filter((item) => item.cAtivSN === cAtivSN);
        }

        return {
          output: { dhFatoGerador: date, count: items.length, items },
          summary: `Atividades Simples: ${items.length} registro(s)`,
          isError: false,
        };
      }

      case 'calculate_fator_r': {
        const folha12m = args.folha12m as string | number | undefined;
        const rbt12m = args.rbt12m as string | number | undefined;
        if (folha12m === undefined || rbt12m === undefined) {
          return {
            output: { error: 'folha12m e rbt12m são obrigatórios.' },
            summary: 'Erro: parâmetros de Fator R ausentes',
            isError: true,
          };
        }
        const out = router.calculateFatorR({ folha12m, rbt12m });
        return {
          output: out,
          summary: `Fator R = ${out.fatorR} (${out.enquadramentoSugerido})`,
          isError: false,
        };
      }

      case 'calculate_base_unificada': {
        const modelo = asOptionalString(args.modelo)?.toLowerCase() === 'nfse' ? 'nfse' : 'nfe';
        const anoFatoGerador = asOptionalNumber(args.anoFatoGerador) ?? 2027;
        const dhFatoGerador = `${anoFatoGerador}-01-01`;

        if (modelo === 'nfse') {
          const parsed = BaseCalculoUnificadaNfseInputSchema.parse({
            ...args,
            anoFatoGerador,
          });
          const { output, engineMode } = await router.calculateBaseUnificadaNfse(parsed);
          const normalizedOutput = {
            baseRG: output.baseRG,
            baseIS: '0.00',
            baseSN: output.baseSN,
            avisos: output.avisos,
          };
          const snapshot = store.saveCalcRun({
            id: crypto.randomUUID(),
            sessionId,
            kind: 'base_unificada',
            engineMode,
            dhFatoGerador,
            context: { regime: 'regime-regular', dhFatoGerador, tipoDfe: 'NFSE' },
            input: parsed,
            output: normalizedOutput,
            xWarningDadosSimulados: false,
            createdAt: new Date().toISOString(),
          });
          return {
            output: { calcRunId: snapshot.id, snapshot, nfseDetail: output },
            summary: `Base Unificada NFS-e: RG=${output.baseRG}, SN=${output.baseSN}`,
            isError: false,
            calcRunId: snapshot.id,
            snapshot,
          };
        }

        const parsed = BaseCalculoUnificadaInputSchema.parse({
          ...args,
          anoFatoGerador,
          tipoDocumento: asOptionalNumber(args.tipoDocumento) ?? 55,
          natureza: asOptionalString(args.natureza) === 'servico' ? 'servico' : 'bem',
        });
        const { output, engineMode } = await router.calculateBaseUnificadaNfe(parsed);
        const snapshot = store.saveCalcRun({
          id: crypto.randomUUID(),
          sessionId,
          kind: 'base_unificada',
          engineMode,
          dhFatoGerador,
          context: {
            regime: 'regime-regular',
            dhFatoGerador,
            tipoDfe: parsed.tipoDocumento === 65 ? '65' : '55',
          },
          input: parsed,
          output,
          xWarningDadosSimulados: false,
          createdAt: new Date().toISOString(),
        });
        return {
          output: { calcRunId: snapshot.id, snapshot },
          summary: `Base Unificada: RG=${output.baseRG}, IS=${output.baseIS}, SN=${output.baseSN}`,
          isError: false,
          calcRunId: snapshot.id,
          snapshot,
        };
      }

      case 'calculate_regime_regular': {
        const modo = asOptionalString(args.modo) === 'estrito' ? 'estrito' : 'observabilidade';
        const parsed = OperacaoInputSchema.parse(args);
        const { output, engineMode } = await router.calculateRegimeRegular(parsed, { modo });

        const snapshot = store.saveCalcRun({
          id: crypto.randomUUID(),
          sessionId,
          kind: 'regime_regular',
          engineMode,
          dhFatoGerador: output.dhFatoGerador,
          context: buildContextFromCalculation('regime-regular', output.dhFatoGerador, {
            tipoDfe: parsed.tipoDfe,
            uf: parsed.uf,
            ufCd: parsed.ufCd,
            municipio: parsed.municipio,
            tpEnteGov: parsed.tpEnteGov,
          }),
          input: parsed,
          output,
          xWarningDadosSimulados: output.xWarningDadosSimulados,
          createdAt: new Date().toISOString(),
        });

        return {
          output: { calcRunId: snapshot.id, snapshot },
          summary: `Regime Regular (${output.itens.length} item(ns)): CBS=${output.IBSCBSTot?.gCBS?.vCBS ?? '0.00'}, IBS=${output.IBSCBSTot?.gIBS?.vIBS ?? '0.00'}`,
          isError: false,
          calcRunId: snapshot.id,
          snapshot,
        };
      }

      case 'calculate_simples_nacional': {
        const parsed = OperacaoSimplesInputSchema.parse(args);
        const { output, engineMode } = await router.calculateSimplesNacional(parsed);

        const snapshot = store.saveCalcRun({
          id: crypto.randomUUID(),
          sessionId,
          kind: 'simples_nacional',
          engineMode,
          dhFatoGerador: output.dhFatoGerador,
          context: buildContextFromCalculation('simples-nacional', output.dhFatoGerador, {
            tipoDfe: parsed.tpDoc,
            crt: parsed.CRT,
            tpRegimeIBSCBS: parsed.tpRegimeIBSCBS ?? undefined,
            tpEnteGov: parsed.tpEnteGov,
          }),
          input: parsed,
          output,
          xWarningDadosSimulados: false,
          createdAt: new Date().toISOString(),
        });

        return {
          output: { calcRunId: snapshot.id, snapshot },
          summary: `Simples Nacional (${output.itens.length} item(ns)): CBSSN=${output.totais.vCBSSN}, IBSSN=${output.totais.vIBSSN}`,
          isError: false,
          calcRunId: snapshot.id,
          snapshot,
        };
      }

      case 'compare_regimes': {
        const parsed = CompareRegimesInputSchema.parse(args);
        const { output, engineMode } = await router.compareRegimes(parsed);

        const snapshot = store.saveCalcRun({
          id: crypto.randomUUID(),
          sessionId,
          kind: 'comparativo',
          engineMode,
          dhFatoGerador: output.dhFatoGerador,
          context: buildContextFromCalculation('comparativo', output.dhFatoGerador, {
            tipoDfe: parsed.tpDoc,
            uf: parsed.uf,
            ufCd: parsed.ufCd,
            municipio: parsed.municipio,
            tpEnteGov: parsed.tpEnteGov,
          }),
          input: parsed,
          output,
          xWarningDadosSimulados: false,
          createdAt: new Date().toISOString(),
        });

        return {
          output: { calcRunId: snapshot.id, snapshot },
          summary: output.elegivel
            ? `Comparativo de Regimes: ${output.cenarios.length} cenário(s) calculado(s)`
            : `Comparativo inelegível: ${output.motivoInelegibilidade ?? 'fora da vigência'}`,
          isError: false,
          calcRunId: snapshot.id,
          snapshot,
        };
      }

      case 'lookup_error_code': {
        const code = asOptionalString(args.code) ?? '';
        const entry = lookupErrorDescription(code);
        return {
          output: entry ?? { found: false, code, message: 'Código de erro não encontrado no catálogo oficial.' },
          summary: entry ? `${entry.codigo}: ${entry.titulo}` : `Código ${code} não encontrado`,
          isError: false,
        };
      }

      case 'generate_tax_xml': {
        const calcRunId = asOptionalString(args.calcRunId);
        if (!calcRunId) {
          return {
            output: { error: 'calcRunId é obrigatório para gerar XML.' },
            summary: 'Erro: calcRunId ausente',
            isError: true,
          };
        }
        const snapshot = store.getCalcRun(calcRunId);
        if (!snapshot) {
          return {
            output: { error: `CalcRunSnapshot '${calcRunId}' não encontrado.` },
            summary: `CalcRun ${calcRunId} não encontrado`,
            isError: true,
          };
        }
        const tipo = asOptionalString(args.tipo)?.toLowerCase() === 'nfce' ? 'nfce' : 'nfe';
        const xmlResult = await router.generateTaxXml(snapshot, tipo);
        return {
          output: xmlResult,
          summary: xmlResult.supported
            ? `XML ${tipo.toUpperCase()} gerado (${xmlResult.excludedItems.length} item(ns) excluído(s))`
            : `XML indisponível: ${xmlResult.reason ?? 'não suportado'}`,
          isError: false,
          calcRunId,
        };
      }

      default:
        return {
          output: { error: `Ferramenta desconhecida: ${name}` },
          summary: `Ferramenta desconhecida: ${name}`,
          isError: true,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: { error: message },
      summary: `Erro em ${name}: ${message}`,
      isError: true,
    };
  }
}

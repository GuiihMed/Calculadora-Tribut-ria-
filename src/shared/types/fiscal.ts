import { z } from 'zod';

// ============================================================================
// Core Enumerations & Primitives
// ============================================================================

export const EstadoItemSchema = z.enum([
  'CALCULADO',
  'CALCULO_SIMULADO',
  'INCONSISTENCIA_ENTRADA',
  'NAO_IMPLEMENTADO',
  'NAO_CALCULADO',
  'FALHA_TECNICA',
]);
export type EstadoItem = z.infer<typeof EstadoItemSchema>;

export const ModoFatorRSchema = z.enum([
  'NAO_APLICAVEL',
  'OPCIONAL',
  'OBRIGATORIO',
  'INDISPONIVEL',
]);
export type ModoFatorR = z.infer<typeof ModoFatorRSchema>;

export const EngineModeSchema = z.enum(['local-ts', 'remote-official']);
export type EngineMode = z.infer<typeof EngineModeSchema>;

export const EngineCapabilityKeySchema = z.enum([
  'regimeRegular',
  'simplesNacional',
  'danfse',
]);
export type EngineCapabilityKey = z.infer<typeof EngineCapabilityKeySchema>;

export const FieldConfidenceSchema = z.enum(['high', 'medium', 'low', 'missing']);
export type FieldConfidence = z.infer<typeof FieldConfidenceSchema>;

export const DecimalInputSchema = z.union([
  z.number().finite(),
  z.string().trim().regex(/^-?\d+(\.\d+)?$/, 'Valor numérico decimal inválido'),
]);
export type DecimalInput = z.infer<typeof DecimalInputSchema>;

export const IsoDateTimeOrDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'Data deve iniciar no formato YYYY-MM-DD');

// ============================================================================
// Engine Capabilities & Diagnostics
// ============================================================================

export interface EngineCapabilityStatus {
  capability: EngineCapabilityKey;
  mode: EngineMode;
  label: string;
  endpointConfigured: boolean;
  healthy?: boolean;
  detail?: string;
}

export interface EngineStatusMap {
  regimeRegular: EngineCapabilityStatus;
  simplesNacional: EngineCapabilityStatus;
  danfse: EngineCapabilityStatus;
}

export interface FiscalErrorItem {
  code: string;
  title?: string;
  description?: string;
  pointer?: string;
  severity?: 'error' | 'warning';
}

export interface FundamentacaoLegal {
  codigo?: string;
  dispositivo: string;
  descricao?: string;
  texto?: string;
  url?: string;
}

export interface MemoriaCalculoTributo {
  tributo: 'IS' | 'CBS' | 'IBSUF' | 'IBSMun' | 'IBSSN' | 'CBSSN';
  baseCalculo: string;
  aliquotaNominal?: string;
  percentualReducao?: string;
  aliquotaEfetiva?: string;
  valorCalculado: string;
  valorDiferimento?: string;
  valorDevido: string;
  expressaoAplicada?: string;
  memoriaTexto?: string;
}

export interface CreditIndicators {
  cClassTrib: string;
  cst?: string;
  descricaoClassificacao?: string;
  apropriacaoCreditoCbs: boolean;
  apropriacaoCreditoIbs: boolean;
  creditoPresumidoFornecedor: boolean;
  creditoPresumidoAdquirente: boolean;
  creditoOperacaoAntecedente: 'Manutenção' | 'Anulação' | string | null;
  resumoTexto: string;
}

export interface SplitPaymentGuidance {
  aplicavel: boolean;
  vCbsSujeito: string;
  vIbsSujeito: string;
  vTotalSujeito: string;
  orientacao: string;
  observacaoLegal: string;
}

// ============================================================================
// Regime Regular (CBS / IBS / Imposto Seletivo)
// ============================================================================

export const AliquotasNominaisInputSchema = z.object({
  pCBS: DecimalInputSchema.optional(),
  pIBSUF: DecimalInputSchema.optional(),
  pIBSMun: DecimalInputSchema.optional(),
});
export type AliquotasNominaisInput = z.infer<typeof AliquotasNominaisInputSchema>;

export const ImpostoSeletivoItemInputSchema = z.object({
  cstIS: z.string().trim().optional(),
  cClassTribIS: z.string().trim().optional(),
  baseCalculo: DecimalInputSchema.optional(),
  quantidade: DecimalInputSchema.optional(),
  unidade: z.string().trim().optional(),
  aliquotaAdValorem: DecimalInputSchema.optional(),
  aliquotaAdRem: DecimalInputSchema.optional(),
  valorInformado: DecimalInputSchema.optional(),
});
export type ImpostoSeletivoItemInput = z.infer<typeof ImpostoSeletivoItemInputSchema>;

export const OperacaoItemInputSchema = z.object({
  nObj: z.number().int().positive().optional(),
  numero: z.number().int().positive().optional(),
  descricao: z.string().trim().optional(),
  ncm: z.string().trim().optional(),
  nbs: z.string().trim().optional(),
  cst: z.string().trim().min(1),
  cClassTrib: z.string().trim().min(1),
  baseCalculo: DecimalInputSchema.optional(),
  quantidade: DecimalInputSchema.optional(),
  unidade: z.string().trim().optional(),
  aliquotasNominais: AliquotasNominaisInputSchema.optional(),
  impostoSeletivo: ImpostoSeletivoItemInputSchema.optional(),
  impostoSeletivoInformado: DecimalInputSchema.optional(),
  tributacaoRegular: z
    .object({
      cst: z.string().trim().optional(),
      cClassTrib: z.string().trim().optional(),
    })
    .optional(),
  diferimento: z
    .object({
      pDifCBS: DecimalInputSchema.optional(),
      pDifIBSUF: DecimalInputSchema.optional(),
      pDifIBSMun: DecimalInputSchema.optional(),
    })
    .optional(),
});
export type OperacaoItemInput = z.infer<typeof OperacaoItemInputSchema>;

export const OperacaoInputSchema = z.object({
  id: z.string().trim().optional(),
  versao: z.string().trim().optional(),
  dhFatoGerador: IsoDateTimeOrDateSchema,
  municipio: z.number().int().positive().optional(),
  uf: z.string().trim().length(2).optional(),
  ufCd: z.number().int().positive().optional(),
  tipoDfe: z.union([z.string().trim(), z.number().int()]).optional(),
  tpEnteGov: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
  pRedCompraGov: DecimalInputSchema.nullable().optional(),
  itens: z.array(OperacaoItemInputSchema).min(1),
});
export type OperacaoInput = z.infer<typeof OperacaoInputSchema>;

export interface ObservabilidadeRocItemOutput {
  nObj: number;
  estadoItem: EstadoItem;
  erros: FiscalErrorItem[];
  descricao?: string;
  ncm?: string;
  nbs?: string;
  cst: string;
  cClassTrib: string;
  gIS?: {
    cstIS?: string;
    cClassTribIS?: string;
    vBCIS: string;
    pIS?: string;
    pISEspec?: string;
    uTrib?: string;
    qTrib?: string;
    vIS: string;
  };
  gIBSCBS?: {
    CST: string;
    cClassTrib: string;
    vBC: string;
    gIBSUF?: {
      pIBSUF: string;
      pRedAliq?: string;
      pAliqEfet: string;
      vIBSUF: string;
      vDif?: string;
    };
    gIBSMun?: {
      pIBSMun: string;
      pRedAliq?: string;
      pAliqEfet: string;
      vIBSMun: string;
      vDif?: string;
    };
    vIBS: string;
    gCBS?: {
      pCBS: string;
      pRedAliq?: string;
      pAliqEfet: string;
      vCBS: string;
      vDif?: string;
    };
  };
  creditIndicators?: CreditIndicators | null;
  splitPaymentGuidance?: SplitPaymentGuidance;
  memoriaCalculo: MemoriaCalculoTributo[];
  fundamentacoesLegais: FundamentacaoLegal[];
}

export interface ObservabilidadeRocOutput {
  modo: 'observabilidade' | 'estrito';
  dhFatoGerador: string;
  xWarningDadosSimulados: boolean;
  avisos: string[];
  errosGlobais: FiscalErrorItem[];
  itens: ObservabilidadeRocItemOutput[];
  ISTot?: {
    vIS: string;
  };
  IBSCBSTot?: {
    vBCIBSCBS: string;
    gIBS: {
      vIBS: string;
      gIBSUF: {
        vIBSUF: string;
        vDif?: string;
      };
      gIBSMun: {
        vIBSMun: string;
        vDif?: string;
      };
    };
    gCBS: {
      vCBS: string;
      vDif?: string;
    };
  };
  splitPaymentGuidance?: SplitPaymentGuidance;
}

// ============================================================================
// Simples Nacional (NT 2026.005 v1.00) & Fator R
// ============================================================================

export const OperacaoSimplesItemInputSchema = z.object({
  nObj: z.number().int().positive().optional(),
  descricao: z.string().trim().optional(),
  cAtivSN: z.string().trim().min(1),
  cClassTrib: z.string().trim().min(1),
  cst: z.string().trim().optional(),
  tpRBSN: z.number().int().positive().optional(),
  baseCalculo: DecimalInputSchema,
  valorImpostoSeletivo: DecimalInputSchema.optional(),
  pIBSSN: DecimalInputSchema.nullable().optional(),
  pCBSSN: DecimalInputSchema.nullable().optional(),
});
export type OperacaoSimplesItemInput = z.infer<typeof OperacaoSimplesItemInputSchema>;

export const OperacaoSimplesInputSchema = z.object({
  dhFatoGerador: IsoDateTimeOrDateSchema,
  tpDoc: z.number().int().positive(),
  CRT: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  tpRegimeIBSCBS: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
  tpEnteGov: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
  itens: z.array(OperacaoSimplesItemInputSchema).min(1),
});
export type OperacaoSimplesInput = z.infer<typeof OperacaoSimplesInputSchema>;

export interface ObservabilidadeSimplesItemOutput {
  nObj: number;
  estadoItem: EstadoItem;
  descricao?: string;
  cAtivSN: string;
  cClassTrib: string;
  modoFatorR: ModoFatorR;
  vRBSNitem?: string;
  tpRBSN?: number;
  tpRBSNDescricao?: string;
  vBC: string;
  pIBSSN: string | null;
  pCBSSN: string | null;
  vIBSSN: string | null;
  vCBSSN: string | null;
  vIBSPendSusp: string | null;
  vCBSPendSusp: string | null;
  totalItem: string;
  erros: FiscalErrorItem[];
  avisos: string[];
  memoriaCalculo: MemoriaCalculoTributo[];
  fundamentacoesLegais: FundamentacaoLegal[];
  creditIndicators?: CreditIndicators | null;
}

export interface ObservabilidadeSimplesOutput {
  dhFatoGerador: string;
  tpDoc: number;
  CRT: number;
  tpRegimeIBSCBS?: 1 | 2 | null;
  tpEnteGov?: 1 | 2 | 3 | 4 | null;
  errosGlobais: FiscalErrorItem[];
  avisos: string[];
  itens: ObservabilidadeSimplesItemOutput[];
  totais: {
    vBC: string;
    vIBSSN: string;
    vCBSSN: string;
    vIBSPendSusp: string;
    vCBSPendSusp: string;
    totalGeral: string;
  };
  splitPaymentGuidance?: SplitPaymentGuidance;
}

export interface FatorRAuxiliarOutput {
  folha12m: string;
  rbt12m: string;
  fatorR: string;
  enquadramentoSugerido: 'Anexo III' | 'Anexo V' | 'INDISPONIVEL';
  avisoLegal: string;
}

// ============================================================================
// Base de Cálculo Unificada (NF-e / NFC-e / NFS-e)
// ============================================================================

export const BaseCalculoUnificadaInputSchema = z.object({
  anoFatoGerador: z.number().int().min(2026).max(2100),
  tipoDocumento: z.number().int().positive(),
  natureza: z.enum(['bem', 'servico']),
  vProd: DecimalInputSchema.optional(),
  vServ: DecimalInputSchema.optional(),
  vFrete: DecimalInputSchema.optional(),
  vSeg: DecimalInputSchema.optional(),
  vOutro: DecimalInputSchema.optional(),
  vDesc: DecimalInputSchema.optional(),
  vIS: DecimalInputSchema.optional(),
  vPIS: DecimalInputSchema.optional(),
  vCOFINS: DecimalInputSchema.optional(),
  vICMS: DecimalInputSchema.optional(),
  vFCP: DecimalInputSchema.optional(),
  vISS: DecimalInputSchema.optional(),
  vII: DecimalInputSchema.optional(),
  vIPI: DecimalInputSchema.optional(),
});
export type BaseCalculoUnificadaInput = z.infer<typeof BaseCalculoUnificadaInputSchema>;

/**
 * Currency-formatted 2-decimal outputs via formatCurrency (HALF_EVEN).
 */
export interface BaseCalculoUnificadaOutput {
  baseRG: string;
  baseIS: string;
  baseSN: string;
  avisos: string[];
}

export const BaseCalculoUnificadaNfseInputSchema = z.object({
  anoFatoGerador: z.number().int().min(2026).max(2100),
  isMei: z.boolean().optional(),
  vServ: DecimalInputSchema,
  vDescIncond: DecimalInputSchema.optional(),
  vDescCond: DecimalInputSchema.optional(),
  vDedRed: DecimalInputSchema.optional(),
  vISS: DecimalInputSchema.optional(),
  vPIS: DecimalInputSchema.optional(),
  vCOFINS: DecimalInputSchema.optional(),
  vOutrosAjustes: DecimalInputSchema.optional(),
  ehLocacao: z.boolean().optional(),
});
export type BaseCalculoUnificadaNfseInput = z.infer<typeof BaseCalculoUnificadaNfseInputSchema>;

export interface BaseCalculoUnificadaNfseOutput {
  baseRG: string;
  baseSN: string;
  avisos: string[];
  erros: FiscalErrorItem[];
}

// ============================================================================
// Compare Regimes
// ============================================================================

export const CompareRegimesItemInputSchema = z.object({
  nObj: z.number().int().positive().optional(),
  descricao: z.string().trim().optional(),
  ncm: z.string().trim().optional(),
  nbs: z.string().trim().optional(),
  cst: z.string().trim().min(1),
  cClassTrib: z.string().trim().min(1),
  cAtivSN: z.string().trim().min(1),
  tpRBSN: z.number().int().positive().optional(),
  baseCalculo: DecimalInputSchema,
  quantidade: DecimalInputSchema.optional(),
  unidade: z.string().trim().optional(),
  aliquotasNominais: AliquotasNominaisInputSchema,
  impostoSeletivo: ImpostoSeletivoItemInputSchema.optional(),
  pIBSSN: DecimalInputSchema.nullable().optional(),
  pCBSSN: DecimalInputSchema.nullable().optional(),
});
export type CompareRegimesItemInput = z.infer<typeof CompareRegimesItemInputSchema>;

export const CompareRegimesInputSchema = z.object({
  dhFatoGerador: IsoDateTimeOrDateSchema,
  tpDoc: z.number().int().positive(),
  uf: z.string().trim().length(2).optional(),
  ufCd: z.number().int().positive().optional(),
  municipio: z.number().int().positive().optional(),
  tpEnteGov: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
  incluirSublimiteCrt2: z.boolean().optional(),
  itens: z.array(CompareRegimesItemInputSchema).min(1),
});
export type CompareRegimesInput = z.infer<typeof CompareRegimesInputSchema>;

export interface RegimeComparisonScenario {
  cenario: 'regime_regular' | 'simples_crt1' | 'simples_hibrido' | 'sublimite_crt2';
  titulo: string;
  totalIS: string;
  totalCBS: string;
  totalIBS: string;
  totalTributos: string;
  apropriacaoCreditoAdquirente: string;
  observacoes: string[];
  erros: FiscalErrorItem[];
  detalhe?: ObservabilidadeRocOutput | ObservabilidadeSimplesOutput;
}

export interface CompareRegimesOutput {
  elegivel: boolean;
  motivoInelegibilidade?: string;
  dhFatoGerador: string;
  cenarios: RegimeComparisonScenario[];
  avisos: string[];
}

// ============================================================================
// Staging / Extraction Draft & Immutable CalcRunSnapshot
// ============================================================================

export const OperationContextSchema = z.object({
  regime: z.enum(['regime-regular', 'simples-nacional', 'comparativo']),
  dhFatoGerador: IsoDateTimeOrDateSchema,
  tipoDfe: z.enum(['55', '65', 'NFSE']),
  uf: z.string().trim().length(2).optional(),
  ufCd: z.number().int().positive().optional(),
  municipio: z.number().int().positive().optional(),
  crt: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  tpRegimeIBSCBS: z.union([z.literal(1), z.literal(2)]).optional(),
  tpEnteGov: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
});
export type OperationContext = z.infer<typeof OperationContextSchema>;

export interface ExtractionDraftItem {
  nObj: number;
  descricao?: string;
  ncm?: string;
  nbs?: string;
  cst?: string;
  cClassTrib?: string;
  cAtivSN?: string;
  baseCalculo?: string;
  quantidade?: string;
  unidade?: string;
  vProd?: string;
  vFrete?: string;
  vSeg?: string;
  vOutro?: string;
  vDesc?: string;
  vICMS?: string;
  vPIS?: string;
  vCOFINS?: string;
  vIS?: string;
  aliquotasNominais?: AliquotasNominaisInput;
  pIBSSN?: string;
  pCBSSN?: string;
  confidence: Record<string, FieldConfidence>;
  missingFields: string[];
}

export interface ExtractionDraft {
  id: string;
  sessionId?: string;
  sourceType: 'xml' | 'xlsx' | 'csv' | 'pdf' | 'image' | 'manual';
  filename: string;
  context: Partial<OperationContext>;
  itens: ExtractionDraftItem[];
  warnings: string[];
  requiresReview: boolean;
  createdAt: string;
}

export interface CalcRunSnapshot {
  id: string;
  sessionId?: string;
  kind: 'regime_regular' | 'simples_nacional' | 'comparativo' | 'base_unificada';
  engineMode: EngineMode;
  dhFatoGerador: string;
  context: Partial<OperationContext>;
  input: unknown;
  output:
    | ObservabilidadeRocOutput
    | ObservabilidadeSimplesOutput
    | CompareRegimesOutput
    | BaseCalculoUnificadaOutput;
  xWarningDadosSimulados: boolean;
  createdAt: string;
}

// ============================================================================
// XML Generation & Validation Contracts
// ============================================================================

export interface XmlGenerationResult {
  supported: boolean;
  reason?: string;
  xml?: string;
  excludedItems: Array<{
    nObj: number;
    code: string;
    message?: string;
  }>;
}

export interface XmlValidationResult {
  valid: boolean;
  xsdValidationMode: 'xsd-official' | 'structural-local';
  errors: string[];
}

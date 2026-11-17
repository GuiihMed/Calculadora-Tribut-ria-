import type {
  BaseCalculoUnificadaInput,
  BaseCalculoUnificadaNfseInput,
  BaseCalculoUnificadaNfseOutput,
  BaseCalculoUnificadaOutput,
  CalcRunSnapshot,
  CompareRegimesInput,
  CompareRegimesOutput,
  DecimalInput,
  EngineCapabilityKey,
  EngineMode,
  EngineStatusMap,
  FatorRAuxiliarOutput,
  ObservabilidadeRocOutput,
  ObservabilidadeSimplesOutput,
  OperacaoInput,
  OperacaoSimplesInput,
  XmlGenerationResult,
  XmlValidationResult,
} from '../../shared/types/fiscal.js';

export interface EngineCallOptions {
  forceLocal?: boolean;
}

export interface RegimeRegularCallOptions extends EngineCallOptions {
  modo?: 'observabilidade' | 'estrito';
}

export interface FatorRAuxiliarInput {
  folha12m: DecimalInput;
  rbt12m: DecimalInput;
}

export interface EngineRouterConfig {
  rtcRegimeRegularUrl?: string;
  rtcSimplesNacionalUrl?: string;
  danfseServiceUrl?: string;
  danfseWasmPath?: string;
  danfseWasmExecJsPath?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface DanfseGenerationResult {
  pdf: Buffer;
  engineMode: EngineMode;
  isLocalPreview: boolean;
}

/**
 * Thrown when a configured remote RFB official engine fails, times out,
 * or returns a non-2xx HTTP status. Callers must NOT silently fall back to local TS.
 */
export class RemoteEngineUnavailableError extends Error {
  readonly capability: EngineCapabilityKey;
  readonly endpoint: string;
  readonly statusCode?: number;
  readonly causeError?: unknown;

  constructor(
    capability: EngineCapabilityKey,
    endpoint: string,
    statusCode?: number,
    causeError?: unknown,
  ) {
    const statusSuffix = statusCode !== undefined ? ` (HTTP ${statusCode})` : '';
    super(
      `Motor oficial remoto (${capability}) indisponível em ${endpoint}${statusSuffix}. ` +
        'A operação falhou de forma segura (fail-closed) sem fallback silencioso. ' +
        'Para usar o motor local TypeScript, confirme explicitamente { forceLocal: true }.',
    );
    this.name = 'RemoteEngineUnavailableError';
    this.capability = capability;
    this.endpoint = endpoint;
    this.statusCode = statusCode;
    this.causeError = causeError;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Strictly validates static service URLs configured via environment or router config
 * at startup to prevent SSRF, protocol smuggling, or embedded credentials.
 */
export function validateStaticServiceUrl(
  rawUrl: string | undefined,
  envVarName: string,
): string | undefined {
  if (rawUrl === undefined) {
    return undefined;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error(
      `URL inválida configurada em ${envVarName}: '${trimmed}'. Esperado http:// ou https://.`,
      { cause: err },
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Protocolo não permitido em ${envVarName}: '${parsed.protocol}'. Apenas http: e https: são aceitos.`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      `Credenciais embutidas na URL não são permitidas em ${envVarName}.`,
    );
  }

  if (!parsed.hostname) {
    throw new Error(`Host inválido configurado em ${envVarName}.`);
  }

  if (parsed.search || parsed.hash) {
    throw new Error(
      `URL base em ${envVarName} não deve conter query string ou fragmento.`,
    );
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${normalizedPath}`;
}

export interface FiscalEnginePort {
  getStatus(): EngineStatusMap;
  getCapabilityMode(capability: EngineCapabilityKey, options?: EngineCallOptions): EngineMode;

  calculateRegimeRegular(
    input: OperacaoInput,
    options?: RegimeRegularCallOptions,
  ): Promise<{ output: ObservabilidadeRocOutput; engineMode: EngineMode }>;

  calculateSimplesNacional(
    input: OperacaoSimplesInput,
    options?: EngineCallOptions,
  ): Promise<{ output: ObservabilidadeSimplesOutput; engineMode: EngineMode }>;

  calculateBaseUnificadaNfe(
    input: BaseCalculoUnificadaInput,
    options?: EngineCallOptions,
  ): Promise<{ output: BaseCalculoUnificadaOutput; engineMode: EngineMode }>;

  calculateBaseUnificadaNfse(
    input: BaseCalculoUnificadaNfseInput,
    options?: EngineCallOptions,
  ): Promise<{ output: BaseCalculoUnificadaNfseOutput; engineMode: EngineMode }>;

  calculateFatorR(input: FatorRAuxiliarInput): FatorRAuxiliarOutput;

  compareRegimes(
    input: CompareRegimesInput,
    options?: EngineCallOptions,
  ): Promise<{ output: CompareRegimesOutput; engineMode: EngineMode }>;

  generateTaxXml(
    snapshot: CalcRunSnapshot,
    tipo?: 'nfe' | 'nfce',
    options?: EngineCallOptions,
  ): Promise<XmlGenerationResult & { engineMode: EngineMode }>;

  validateXml(
    xml: string,
    tipo: string,
    subtipo: 'grupo' | 'nota',
    options?: EngineCallOptions,
  ): Promise<XmlValidationResult & { engineMode: EngineMode }>;

  generateDanfse(
    nfseXml: string,
    stc?: 0 | 1 | 2,
    canhoto?: boolean,
    options?: EngineCallOptions,
  ): Promise<DanfseGenerationResult>;
}

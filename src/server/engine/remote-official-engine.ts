import fs from 'node:fs';
import type {
  BaseCalculoUnificadaInput,
  BaseCalculoUnificadaNfseInput,
  BaseCalculoUnificadaNfseOutput,
  BaseCalculoUnificadaOutput,
  CalcRunSnapshot,
  EngineCapabilityKey,
  ObservabilidadeRocOutput,
  ObservabilidadeSimplesOutput,
  OperacaoInput,
  OperacaoSimplesInput,
  XmlGenerationResult,
  XmlValidationResult,
} from '../../shared/types/fiscal.js';
import { RemoteEngineUnavailableError } from './engine-port.js';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface RemoteOfficialEngineOptions {
  rtcRegimeRegularUrl?: string;
  rtcSimplesNacionalUrl?: string;
  danfseServiceUrl?: string;
  danfseWasmPath?: string;
  danfseWasmExecJsPath?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * HTTP & optional Go-WASM connector for the official RFB Java/Go services.
 * Strictly fail-closed: any network failure, timeout, or non-2xx HTTP response
 * throws `RemoteEngineUnavailableError` without silent local fallback.
 */
export class RemoteOfficialEngine {
  private readonly rtcRegimeRegularUrl?: string;
  private readonly rtcSimplesNacionalUrl?: string;
  private readonly danfseServiceUrl?: string;
  private readonly danfseWasmPath?: string;
  private readonly danfseWasmExecJsPath?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RemoteOfficialEngineOptions) {
    this.rtcRegimeRegularUrl = options.rtcRegimeRegularUrl;
    this.rtcSimplesNacionalUrl = options.rtcSimplesNacionalUrl;
    this.danfseServiceUrl = options.danfseServiceUrl;
    this.danfseWasmPath = options.danfseWasmPath;
    this.danfseWasmExecJsPath = options.danfseWasmExecJsPath;
    this.timeoutMs =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  hasDanfseWasmFiles(): boolean {
    if (!this.danfseWasmPath || !this.danfseWasmExecJsPath) {
      return false;
    }
    return fs.existsSync(this.danfseWasmPath) && fs.existsSync(this.danfseWasmExecJsPath);
  }

  private requireBaseUrl(baseUrl: string | undefined, capability: EngineCapabilityKey): string {
    if (!baseUrl) {
      throw new RemoteEngineUnavailableError(
        capability,
        '<unconfigured>',
        undefined,
        new Error(`Endpoint remoto para '${capability}' não configurado.`),
      );
    }
    return baseUrl;
  }

  private async fetchWithTimeout(
    capability: EngineCapabilityKey,
    endpoint: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const timeoutErr = new Error(`Tempo limite de ${this.timeoutMs}ms excedido.`);
        controller.abort(timeoutErr);
        reject(timeoutErr);
      }, this.timeoutMs);
    });

    try {
      const response = await Promise.race([
        this.fetchImpl(endpoint, { ...init, signal: controller.signal }),
        timeoutPromise,
      ]);

      if (!response.ok) {
        throw new RemoteEngineUnavailableError(
          capability,
          endpoint,
          response.status,
          new Error(`HTTP ${response.status} ${response.statusText}`.trim()),
        );
      }

      return response;
    } catch (err) {
      if (err instanceof RemoteEngineUnavailableError) {
        throw err;
      }
      throw new RemoteEngineUnavailableError(capability, endpoint, undefined, err);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private async postJson<TResponse>(
    capability: EngineCapabilityKey,
    endpoint: string,
    payload: unknown,
  ): Promise<TResponse> {
    const response = await this.fetchWithTimeout(capability, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    try {
      return (await response.json()) as TResponse;
    } catch (err) {
      throw new RemoteEngineUnavailableError(capability, endpoint, response.status, err);
    }
  }

  async calculateRegimeRegular(input: OperacaoInput): Promise<ObservabilidadeRocOutput> {
    const baseUrl = this.requireBaseUrl(this.rtcRegimeRegularUrl, 'regimeRegular');
    const endpoint = `${baseUrl}/api/calculadora/observabilidade/regime-geral`;
    return this.postJson<ObservabilidadeRocOutput>('regimeRegular', endpoint, input);
  }

  async calculateBaseUnificadaNfe(
    input: BaseCalculoUnificadaInput,
  ): Promise<BaseCalculoUnificadaOutput> {
    const baseUrl = this.requireBaseUrl(this.rtcRegimeRegularUrl, 'regimeRegular');
    const endpoint = `${baseUrl}/api/calculadora/base-calculo/base-calculo-unificada`;
    return this.postJson<BaseCalculoUnificadaOutput>('regimeRegular', endpoint, input);
  }

  async generateTaxXml(
    snapshot: CalcRunSnapshot,
    tipo: 'nfe' | 'nfce' = 'nfe',
  ): Promise<XmlGenerationResult> {
    if (snapshot.kind !== 'regime_regular') {
      return {
        supported: false,
        reason:
          'Geração de XML RTC (<IBSCBS>/<IS>) disponível apenas para apurações do Regime Regular (NfeXmlService).',
        excludedItems: [],
      };
    }

    const baseUrl = this.requireBaseUrl(this.rtcRegimeRegularUrl, 'regimeRegular');
    const endpoint = `${baseUrl}/api/calculadora/xml/generate?tipo=${encodeURIComponent(tipo)}`;
    const response = await this.fetchWithTimeout('regimeRegular', endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/xml, application/json, text/xml',
      },
      body: JSON.stringify(snapshot.output),
    });

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('application/json')) {
      try {
        const parsed = (await response.json()) as Partial<XmlGenerationResult> & { xml?: string };
        return {
          supported: parsed.supported ?? Boolean(parsed.xml),
          reason: parsed.reason,
          xml: parsed.xml,
          excludedItems: Array.isArray(parsed.excludedItems) ? parsed.excludedItems : [],
        };
      } catch (err) {
        throw new RemoteEngineUnavailableError('regimeRegular', endpoint, response.status, err);
      }
    }

    const xml = await response.text();
    if (!xml.trim()) {
      throw new RemoteEngineUnavailableError(
        'regimeRegular',
        endpoint,
        response.status,
        new Error('Resposta XML vazia do serviço oficial.'),
      );
    }

    return {
      supported: true,
      xml,
      excludedItems: [],
    };
  }

  async validateXml(
    xml: string,
    tipo: string,
    subtipo: 'grupo' | 'nota',
  ): Promise<XmlValidationResult> {
    const baseUrl = this.requireBaseUrl(this.rtcRegimeRegularUrl, 'regimeRegular');
    const endpoint = `${baseUrl}/api/calculadora/xml/validate?tipo=${encodeURIComponent(tipo)}&subtipo=${encodeURIComponent(subtipo)}`;

    const response = await this.fetchWithTimeout('regimeRegular', endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        Accept: 'application/json',
      },
      body: xml,
    });

    try {
      const data = (await response.json()) as {
        valid?: boolean;
        valido?: boolean;
        errors?: unknown[];
        erros?: unknown[];
      };
      const rawErrors = Array.isArray(data.errors)
        ? data.errors
        : Array.isArray(data.erros)
          ? data.erros
          : [];
      const errors = rawErrors.map((e) => (typeof e === 'string' ? e : JSON.stringify(e)));
      const valid = data.valid ?? data.valido ?? errors.length === 0;
      return {
        valid: Boolean(valid),
        xsdValidationMode: 'xsd-official',
        errors,
      };
    } catch (err) {
      throw new RemoteEngineUnavailableError('regimeRegular', endpoint, response.status, err);
    }
  }

  async calculateSimplesNacional(
    input: OperacaoSimplesInput,
  ): Promise<ObservabilidadeSimplesOutput> {
    const baseUrl = this.requireBaseUrl(this.rtcSimplesNacionalUrl, 'simplesNacional');
    const endpoint = `${baseUrl}/api/calculadora/observabilidade/simples-nacional`;
    return this.postJson<ObservabilidadeSimplesOutput>('simplesNacional', endpoint, input);
  }

  async calculateBaseUnificadaNfse(
    input: BaseCalculoUnificadaNfseInput,
  ): Promise<BaseCalculoUnificadaNfseOutput> {
    const baseUrl = this.requireBaseUrl(this.rtcSimplesNacionalUrl, 'simplesNacional');
    const endpoint = `${baseUrl}/api/calculadora/base-calculo-unificada/nfse`;
    return this.postJson<BaseCalculoUnificadaNfseOutput>('simplesNacional', endpoint, input);
  }

  async generateDanfse(
    nfseXml: string,
    stc: 0 | 1 | 2 = 0,
    canhoto = true,
  ): Promise<Buffer> {
    if (this.danfseServiceUrl) {
      const endpoint = `${this.danfseServiceUrl}/api/danfse?stc=${encodeURIComponent(String(stc))}&canhoto=${encodeURIComponent(String(canhoto))}`;
      const response = await this.fetchWithTimeout('danfse', endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          Accept: 'application/pdf',
        },
        body: nfseXml,
      });

      const arrayBuf = await response.arrayBuffer();
      const pdf = Buffer.from(arrayBuf);
      if (pdf.byteLength === 0) {
        throw new RemoteEngineUnavailableError(
          'danfse',
          endpoint,
          response.status,
          new Error('PDF retornado pelo serviço oficial está vazio.'),
        );
      }
      return pdf;
    }

    if (this.hasDanfseWasmFiles()) {
      return this.generateDanfseViaWasm(nfseXml, stc, canhoto);
    }

    throw new RemoteEngineUnavailableError(
      'danfse',
      '<unconfigured>',
      undefined,
      new Error('Nenhum conector oficial DANFSe (HTTP ou WASM) está configurado.'),
    );
  }

  private async generateDanfseViaWasm(
    _nfseXml: string,
    _stc: 0 | 1 | 2,
    _canhoto: boolean,
  ): Promise<Buffer> {
    const wasmPath = this.danfseWasmPath ?? '<missing>';
    const execJsPath = this.danfseWasmExecJsPath ?? '<missing>';

    if (!fs.existsSync(wasmPath) || !fs.existsSync(execJsPath)) {
      throw new RemoteEngineUnavailableError(
        'danfse',
        wasmPath,
        undefined,
        new Error(`Arquivos Go WASM não encontrados (${wasmPath}, ${execJsPath}).`),
      );
    }

    // Adapter stub for Go wasm_exec.js runtime: fail-closed until full Go WASM bridge is wired.
    throw new RemoteEngineUnavailableError(
      'danfse',
      wasmPath,
      undefined,
      new Error(
        'Execução direta de binário Go WASM requer runtime Go wasm_exec.js ativo; configure DANFSE_SERVICE_URL ou use { forceLocal: true }.',
      ),
    );
  }
}

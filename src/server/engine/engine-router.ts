import type Database from 'better-sqlite3';
import type {
  BaseCalculoUnificadaInput,
  BaseCalculoUnificadaNfseInput,
  BaseCalculoUnificadaNfseOutput,
  BaseCalculoUnificadaOutput,
  CalcRunSnapshot,
  CompareRegimesInput,
  CompareRegimesOutput,
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
import { DadosAbertosRepository } from '../db/dados-abertos-repo.js';
import {
  calculateBaseUnificadaNfe as localCalculateBaseUnificadaNfe,
  calculateBaseUnificadaNfse as localCalculateBaseUnificadaNfse,
} from './base-unificada-engine.js';
import {
  compareRegimes as localCompareRegimes,
  compareRegimesAsync,
} from './compare-regimes.js';
import { generateDanfsePreviewPdf } from './danfse-preview.js';
import {
  type DanfseGenerationResult,
  type EngineCallOptions,
  type EngineRouterConfig,
  type FatorRAuxiliarInput,
  type FiscalEnginePort,
  type RegimeRegularCallOptions,
  validateStaticServiceUrl,
} from './engine-port.js';
import { calculateFatorRAuxiliar } from './fator-r.js';
import { RegimeRegularEngine } from './regime-regular-engine.js';
import { RemoteOfficialEngine } from './remote-official-engine.js';
import { SimplesNacionalEngine } from './simples-nacional-engine.js';
import { generateTaxXmlFromCalcRun, validateTaxXmlStructure } from './xml-generator.js';

export interface FiscalEngineRouterDeps {
  repo?: DadosAbertosRepository;
  db?: Database.Database;
  config?: EngineRouterConfig;
}

function readConfigFromEnv(): EngineRouterConfig {
  return {
    rtcRegimeRegularUrl: process.env.RTC_REGIME_REGULAR_URL,
    rtcSimplesNacionalUrl:
      process.env.RTC_SIMPLES_NACIONAL_URL ?? process.env.RTC_SIMPLES_URL,
    danfseServiceUrl: process.env.DANFSE_SERVICE_URL,
    danfseWasmPath: process.env.DANFSE_WASM_PATH,
    danfseWasmExecJsPath: process.env.DANFSE_WASM_EXEC_JS_PATH,
  };
}

/**
 * Dual-engine capability router (`LocalTsEngine` vs `RemoteOfficialEngine`).
 * Routes each capability independently and enforces strict fail-closed semantics
 * when a remote official endpoint is configured unless `{ forceLocal: true }` is passed.
 */
export class FiscalEngineRouter implements FiscalEnginePort {
  private readonly rrEngine: RegimeRegularEngine;
  private readonly snEngine: SimplesNacionalEngine;
  private readonly remoteEngine: RemoteOfficialEngine;

  private readonly rtcRegimeRegularUrl?: string;
  private readonly rtcSimplesNacionalUrl?: string;
  private readonly danfseServiceUrl?: string;

  constructor(deps: FiscalEngineRouterDeps) {
    const db = deps.db ?? deps.repo?.getDatabase();
    if (!db) {
      throw new Error('FiscalEngineRouter requer { repo } ou { db }.');
    }
    const repo = deps.repo ?? new DadosAbertosRepository(db);

    const rawConfig = deps.config ?? readConfigFromEnv();
    this.rtcRegimeRegularUrl = validateStaticServiceUrl(
      rawConfig.rtcRegimeRegularUrl,
      'RTC_REGIME_REGULAR_URL',
    );
    this.rtcSimplesNacionalUrl = validateStaticServiceUrl(
      rawConfig.rtcSimplesNacionalUrl,
      'RTC_SIMPLES_NACIONAL_URL',
    );
    this.danfseServiceUrl = validateStaticServiceUrl(
      rawConfig.danfseServiceUrl,
      'DANFSE_SERVICE_URL',
    );

    this.rrEngine = new RegimeRegularEngine(db, repo);
    this.snEngine = new SimplesNacionalEngine(db, repo);
    this.remoteEngine = new RemoteOfficialEngine({
      rtcRegimeRegularUrl: this.rtcRegimeRegularUrl,
      rtcSimplesNacionalUrl: this.rtcSimplesNacionalUrl,
      danfseServiceUrl: this.danfseServiceUrl,
      danfseWasmPath: rawConfig.danfseWasmPath?.trim() || undefined,
      danfseWasmExecJsPath: rawConfig.danfseWasmExecJsPath?.trim() || undefined,
      timeoutMs: rawConfig.timeoutMs,
      fetchImpl: rawConfig.fetchImpl,
    });
  }

  private isRemoteConfigured(capability: EngineCapabilityKey): boolean {
    switch (capability) {
      case 'regimeRegular':
        return Boolean(this.rtcRegimeRegularUrl);
      case 'simplesNacional':
        return Boolean(this.rtcSimplesNacionalUrl);
      case 'danfse':
        return Boolean(this.danfseServiceUrl) || this.remoteEngine.hasDanfseWasmFiles();
    }
  }

  getCapabilityMode(capability: EngineCapabilityKey, options?: EngineCallOptions): EngineMode {
    if (options?.forceLocal === true) {
      return 'local-ts';
    }
    return this.isRemoteConfigured(capability) ? 'remote-official' : 'local-ts';
  }

  getStatus(): EngineStatusMap {
    const rrConfigured = this.isRemoteConfigured('regimeRegular');
    const snConfigured = this.isRemoteConfigured('simplesNacional');
    const danfseConfigured = this.isRemoteConfigured('danfse');

    return {
      regimeRegular: {
        capability: 'regimeRegular',
        mode: rrConfigured ? 'remote-official' : 'local-ts',
        label: rrConfigured
          ? 'Motor Oficial RFB (Remoto)'
          : 'Motor Determinístico Local (TS + SQLite RFB)',
        endpointConfigured: rrConfigured,
      },
      simplesNacional: {
        capability: 'simplesNacional',
        mode: snConfigured ? 'remote-official' : 'local-ts',
        label: snConfigured
          ? 'Motor Oficial RFB (Remoto)'
          : 'Motor Determinístico Local (TS + SQLite RFB)',
        endpointConfigured: snConfigured,
      },
      danfse: {
        capability: 'danfse',
        mode: danfseConfigured ? 'remote-official' : 'local-ts',
        label: danfseConfigured
          ? this.danfseServiceUrl
            ? 'Gerador Oficial DANFSe Go (Remoto)'
            : 'Gerador Oficial DANFSe WASM'
          : 'Prévia Local PDF (PDFKit)',
        endpointConfigured: danfseConfigured,
      },
    };
  }

  async calculateRegimeRegular(
    input: OperacaoInput,
    options?: RegimeRegularCallOptions,
  ): Promise<{ output: ObservabilidadeRocOutput; engineMode: EngineMode }> {
    const engineMode = this.getCapabilityMode('regimeRegular', options);
    if (engineMode === 'remote-official') {
      const output = await this.remoteEngine.calculateRegimeRegular(input);
      return { output, engineMode };
    }
    const output = this.rrEngine.calculate(input, options?.modo ?? 'observabilidade');
    return { output, engineMode };
  }

  async calculateSimplesNacional(
    input: OperacaoSimplesInput,
    options?: EngineCallOptions,
  ): Promise<{ output: ObservabilidadeSimplesOutput; engineMode: EngineMode }> {
    const engineMode = this.getCapabilityMode('simplesNacional', options);
    if (engineMode === 'remote-official') {
      const output = await this.remoteEngine.calculateSimplesNacional(input);
      return { output, engineMode };
    }
    const output = this.snEngine.calculate(input);
    return { output, engineMode };
  }

  async calculateBaseUnificadaNfe(
    input: BaseCalculoUnificadaInput,
    options?: EngineCallOptions,
  ): Promise<{ output: BaseCalculoUnificadaOutput; engineMode: EngineMode }> {
    const engineMode = this.getCapabilityMode('regimeRegular', options);
    if (engineMode === 'remote-official') {
      const output = await this.remoteEngine.calculateBaseUnificadaNfe(input);
      return { output, engineMode };
    }
    const output = localCalculateBaseUnificadaNfe(input);
    return { output, engineMode };
  }

  async calculateBaseUnificadaNfse(
    input: BaseCalculoUnificadaNfseInput,
    options?: EngineCallOptions,
  ): Promise<{ output: BaseCalculoUnificadaNfseOutput; engineMode: EngineMode }> {
    const engineMode = this.getCapabilityMode('simplesNacional', options);
    if (engineMode === 'remote-official') {
      const output = await this.remoteEngine.calculateBaseUnificadaNfse(input);
      return { output, engineMode };
    }
    const output = localCalculateBaseUnificadaNfse(input);
    return { output, engineMode };
  }

  calculateFatorR(input: FatorRAuxiliarInput): FatorRAuxiliarOutput {
    const folha = typeof input.folha12m === 'number' ? String(input.folha12m) : input.folha12m;
    const rbt = typeof input.rbt12m === 'number' ? String(input.rbt12m) : input.rbt12m;
    return calculateFatorRAuxiliar(folha, rbt);
  }

  async compareRegimes(
    input: CompareRegimesInput,
    options?: EngineCallOptions,
  ): Promise<{ output: CompareRegimesOutput; engineMode: EngineMode }> {
    const rrMode = this.getCapabilityMode('regimeRegular', options);
    const snMode = this.getCapabilityMode('simplesNacional', options);

    if (rrMode === 'local-ts' && snMode === 'local-ts') {
      const output = localCompareRegimes(input, this.rrEngine, this.snEngine);
      return { output, engineMode: 'local-ts' };
    }

    const output = await compareRegimesAsync(input, {
      calculateRegimeRegular: async (op) =>
        rrMode === 'remote-official'
          ? this.remoteEngine.calculateRegimeRegular(op)
          : this.rrEngine.calculate(op, 'observabilidade'),
      calculateSimplesNacional: async (op) =>
        snMode === 'remote-official'
          ? this.remoteEngine.calculateSimplesNacional(op)
          : this.snEngine.calculate(op),
    });

    return { output, engineMode: 'remote-official' };
  }

  async generateTaxXml(
    snapshot: CalcRunSnapshot,
    tipo: 'nfe' | 'nfce' = 'nfe',
    options?: EngineCallOptions,
  ): Promise<XmlGenerationResult & { engineMode: EngineMode }> {
    const engineMode = this.getCapabilityMode('regimeRegular', options);
    if (snapshot.kind !== 'regime_regular') {
      const localUnsupported = generateTaxXmlFromCalcRun(snapshot, tipo);
      return { ...localUnsupported, engineMode };
    }

    if (engineMode === 'remote-official') {
      const result = await this.remoteEngine.generateTaxXml(snapshot, tipo);
      return { ...result, engineMode };
    }

    const result = generateTaxXmlFromCalcRun(snapshot, tipo);
    return { ...result, engineMode };
  }

  async validateXml(
    xml: string,
    tipo: string,
    subtipo: 'grupo' | 'nota',
    options?: EngineCallOptions,
  ): Promise<XmlValidationResult & { engineMode: EngineMode }> {
    const engineMode = this.getCapabilityMode('regimeRegular', options);
    if (engineMode === 'remote-official') {
      const result = await this.remoteEngine.validateXml(xml, tipo, subtipo);
      return { ...result, engineMode };
    }
    const result = validateTaxXmlStructure(xml, tipo, subtipo);
    return { ...result, engineMode };
  }

  async generateDanfse(
    nfseXml: string,
    stc: 0 | 1 | 2 = 0,
    canhoto = true,
    options?: EngineCallOptions,
  ): Promise<DanfseGenerationResult> {
    const engineMode = this.getCapabilityMode('danfse', options);
    if (engineMode === 'remote-official') {
      const pdf = await this.remoteEngine.generateDanfse(nfseXml, stc, canhoto);
      return {
        pdf,
        engineMode,
        isLocalPreview: false,
      };
    }

    const pdf = await generateDanfsePreviewPdf(nfseXml, stc, canhoto);
    return {
      pdf,
      engineMode,
      isLocalPreview: true,
    };
  }
}

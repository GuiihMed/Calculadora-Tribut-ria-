import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type {
  CalcRunSnapshot,
  OperationContext,
  XmlGenerationResult,
  XmlValidationResult,
} from '../../shared/types/fiscal';
import {
  ApiError,
  downloadDanfsePdf,
  generateAndValidateXml,
  getExportJsonUrl,
  getExportXlsxUrl,
} from '../api/client';

export interface XmlDanfseTabProps {
  snapshot: CalcRunSnapshot | null;
  activeContext: Partial<OperationContext>;
  onNavigateStaging?: () => void;
}

interface RemoteFailureState {
  target: 'xml' | 'danfse';
  message: string;
}

const SAMPLE_NFSE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe versao="1.00">
  <infNFSe Id="NFS43149022200000000000001">
    <xLocEmi>Porto Alegre</xLocEmi>
    <xLocIncid>Porto Alegre</xLocIncid>
    <xUFIncid>RS</xUFIncid>
    <nNFSe>2027000001</nNFSe>
    <dhProc>2027-02-01T10:30:00-03:00</dhProc>
    <emit>
      <CNPJ>12345678000195</CNPJ>
      <xNome>Exemplo Serviços Contábeis Ltda</xNome>
      <enderNac>
        <xLgr>Av. Borges de Medeiros</xLgr>
        <nro>1500</nro>
        <xBairro>Centro Histórico</xBairro>
        <xMun>Porto Alegre</xMun>
        <UF>RS</UF>
        <CEP>90020025</CEP>
      </enderNac>
    </emit>
    <valores>
      <vBC>5000.00</vBC>
      <vISSQN>100.00</vISSQN>
      <vLiq>4900.00</vLiq>
    </valores>
    <DPS versao="1.00">
      <infDPS Id="DPS43149022200000000000001">
        <dhEmi>2027-02-01T10:25:00-03:00</dhEmi>
        <dCompet>2027-02-01</dCompet>
        <nDPS>1</nDPS>
        <serie>1</serie>
        <toma>
          <CNPJ>98765432000110</CNPJ>
          <xNome>Tomador Exemplo S/A</xNome>
          <end>
            <xLgr>Rua da Praia</xLgr>
            <nro>300</nro>
            <xBairro>Centro</xBairro>
            <endNac>
              <xMun>Porto Alegre</xMun>
              <UF>RS</UF>
              <CEP>90010000</CEP>
            </endNac>
          </end>
        </toma>
        <serv>
          <cServ>
            <cTribNac>171901</cTribNac>
            <cNBS>1.1301.10.00</cNBS>
            <xDescServ>Consultoria contábil e tributária LC 214/2025</xDescServ>
          </cServ>
        </serv>
        <valores>
          <vServPrest>
            <vServ>5000.00</vServ>
          </vServPrest>
        </valores>
      </infDPS>
    </DPS>
    <IBSCBS>
      <valores>
        <vBC>5000.00</vBC>
      </valores>
      <totCIBS>
        <vTotNF>5000.00</vTotNF>
        <gIBS>
          <gIBSUFTot><vIBSUF>885.00</vIBSUFTot></gIBSUFTot>
          <gIBSMunTot><vIBSMun>0.00</vIBSMun></gIBSMunTot>
          <vIBSTot>885.00</vIBSTot>
        </gIBS>
        <gCBS>
          <vCBS>440.00</vCBS>
        </gCBS>
      </totCIBS>
    </IBSCBS>
  </infNFSe>
</NFSe>`;

function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof URL.createObjectURL !== 'function') {
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export function XmlDanfseTab({
  snapshot,
  activeContext,
  onNavigateStaging,
}: XmlDanfseTabProps) {
  const [tipo, setTipo] = useState<'nfe' | 'nfce'>(
    activeContext.tipoDfe === '65' ? 'nfce' : 'nfe',
  );
  const [xmlLoading, setXmlLoading] = useState(false);
  const [xmlError, setXmlError] = useState<string | null>(null);
  const [generation, setGeneration] = useState<XmlGenerationResult | null>(null);
  const [validation, setValidation] = useState<XmlValidationResult | null>(null);
  const [copiedXml, setCopiedXml] = useState(false);

  // DANFSe state
  const [nfseXml, setNfseXml] = useState('');
  const [stc, setStc] = useState<0 | 1 | 2>(0);
  const [canhoto, setCanhoto] = useState(true);
  const [danfseLoading, setDanfseLoading] = useState(false);
  const [danfseError, setDanfseError] = useState<string | null>(null);
  const [danfseResult, setDanfseResult] = useState<{
    pdfUrl: string;
    engineMode: string;
    isLocalPreview: boolean;
  } | null>(null);

  const [remoteFailure, setRemoteFailure] = useState<RemoteFailureState | null>(null);

  useEffect(() => {
    setGeneration(null);
    setValidation(null);
    setXmlError(null);
    setRemoteFailure((prev) => (prev?.target === 'xml' ? null : prev));
  }, [snapshot?.id]);

  useEffect(() => {
    return () => {
      if (danfseResult?.pdfUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(danfseResult.pdfUrl);
      }
    };
  }, [danfseResult]);

  const isSimplesSnapshot = snapshot?.kind === 'simples_nacional';
  const isRegimeRegularSnapshot = snapshot?.kind === 'regime_regular';
  const xmlGenerationDisabled = !snapshot || !isRegimeRegularSnapshot || xmlLoading;

  const handleGenerateXml = async (forceLocal = false) => {
    if (!snapshot || !isRegimeRegularSnapshot) {
      return;
    }

    setXmlLoading(true);
    setXmlError(null);
    if (forceLocal) {
      setRemoteFailure(null);
    }

    try {
      const res = await generateAndValidateXml({
        snapshot,
        tipo,
        forceLocal,
      });
      setGeneration(res.generation);
      setValidation(res.validation);
      setRemoteFailure(null);
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 503 || err.canForceLocal || err.code === 'REMOTE_ENGINE_UNAVAILABLE')
      ) {
        setRemoteFailure({ target: 'xml', message: err.message });
      } else {
        setXmlError(
          err instanceof Error
            ? err.message
            : 'Falha ao gerar e validar XML tributário.',
        );
      }
    } finally {
      setXmlLoading(false);
    }
  };

  const handleCopyXml = async () => {
    if (!generation?.xml) return;
    try {
      await navigator.clipboard?.writeText(generation.xml);
      setCopiedXml(true);
      setTimeout(() => setCopiedXml(false), 1800);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  const handleDownloadXml = () => {
    if (!generation?.xml || !snapshot) return;
    const blob = new Blob([generation.xml], { type: 'application/xml;charset=utf-8' });
    triggerBlobDownload(blob, `rtc-${tipo}-${snapshot.id}.xml`);
  };

  const handleGenerateDanfse = async (forceLocal = false) => {
    if (!nfseXml.trim()) {
      setDanfseError('Cole um XML de NFS-e ou carregue o exemplo antes de gerar o PDF.');
      return;
    }

    setDanfseLoading(true);
    setDanfseError(null);
    if (forceLocal) {
      setRemoteFailure(null);
    }

    try {
      const res = await downloadDanfsePdf({
        xml: nfseXml,
        stc,
        canhoto,
        forceLocal,
      });

      const pdfUrl =
        typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(res.blob)
          : '#danfse-pdf';

      setDanfseResult({
        pdfUrl,
        engineMode: res.engineMode,
        isLocalPreview: res.isLocalPreview,
      });
      setRemoteFailure(null);
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 503 || err.canForceLocal || err.code === 'REMOTE_ENGINE_UNAVAILABLE')
      ) {
        setRemoteFailure({ target: 'danfse', message: err.message });
      } else {
        setDanfseError(
          err instanceof Error
            ? err.message
            : 'Falha ao gerar PDF DANFSe a partir do XML informado.',
        );
      }
    } finally {
      setDanfseLoading(false);
    }
  };

  return (
    <div className="stack">
      {/* Audit Exports Bar */}
      <article className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">
              <FileCode2
                size={16}
                aria-hidden="true"
                style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
              />
              XML RTC (NF-e / NFC-e) &amp; DANFSe
            </h3>
            <span className="card__meta">
              {snapshot ? (
                <>
                  Snapshot ativo: <code>{snapshot.id}</code> ({snapshot.kind})
                </>
              ) : (
                'Nenhum snapshot de cálculo ativo — DANFSe e XML avulsos disponíveis.'
              )}
            </span>
          </div>

          {snapshot ? (
            <div className="staging-header-actions">
              <a
                href={getExportXlsxUrl(snapshot.id)}
                download
                className="btn btn--sm"
              >
                <FileSpreadsheet size={14} aria-hidden="true" />
                <span>Baixar .xlsx</span>
              </a>
              <a
                href={getExportJsonUrl(snapshot.id)}
                download
                className="btn btn--sm"
              >
                <Download size={14} aria-hidden="true" />
                <span>Baixar .json</span>
              </a>
            </div>
          ) : (
            onNavigateStaging && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={onNavigateStaging}
              >
                Ir para Prévia &amp; Lote
              </button>
            )
          )}
        </div>
      </article>

      {/* Section 1: Tax XML Generation & Validation */}
      <article className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">
              Geração &amp; Validação Estrutural de XML (&lt;IBSCBS&gt; / &lt;IS&gt;)
            </h3>
            <span className="card__meta">
              Serializa apenas itens válidos (CALCULADO / CALCULO_SIMULADO) em Regime Regular.
            </span>
          </div>

          <div className="staging-header-actions">
            <label htmlFor="xml-tipo-select" className="sr-only">
              Tipo DF-e
            </label>
            <select
              id="xml-tipo-select"
              value={tipo}
              disabled={xmlGenerationDisabled}
              onChange={(e) => setTipo(e.target.value as 'nfe' | 'nfce')}
            >
              <option value="nfe">NF-e (Modelo 55)</option>
              <option value="nfce">NFC-e (Modelo 65)</option>
            </select>

            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={xmlGenerationDisabled}
              onClick={() => {
                void handleGenerateXml(false);
              }}
            >
              <ShieldCheck size={14} aria-hidden="true" />
              <span>{xmlLoading ? 'Gerando...' : 'Gerar & Validar XML RTC'}</span>
            </button>
          </div>
        </div>

        {isSimplesSnapshot && (
          <div className="banner banner--warning" role="status">
            <span>
              <AlertTriangle
                size={15}
                aria-hidden="true"
                style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
              />
              <strong>Indisponível para Simples Nacional (CRT=1/2/3):</strong> A geração de
              XML <code>&lt;IBSCBS&gt;</code>/<code>&lt;IS&gt;</code> no{' '}
              <code>NfeXmlService</code> aplica-se exclusivamente ao Regime Regular (este
              motor não gera evento <code>tpEvento 412140</code>; utilize os links{' '}
              <code>.xlsx</code>/<code>.json</code> ou simule em Regime Regular / Híbrido).
            </span>
          </div>
        )}

        {snapshot && !isRegimeRegularSnapshot && !isSimplesSnapshot && (
          <div className="banner banner--info" role="status">
            <span>
              O snapshot ativo é do tipo <code>{snapshot.kind}</code>. Para gerar grupos XML
              NF-e/NFC-e, execute uma apuração no <strong>Regime Regular</strong>.
            </span>
          </div>
        )}

        {!snapshot && (
          <p className="aux-panel__hint">
            Execute uma simulação em Regime Regular para habilitar a geração do XML RTC.
          </p>
        )}

        {xmlError && (
          <div className="banner banner--danger" role="alert">
            <span>{xmlError}</span>
          </div>
        )}

        {remoteFailure?.target === 'xml' && (
          <div className="recovery-card" role="alert">
            <div className="recovery-card__header">
              <AlertTriangle size={15} aria-hidden="true" />
              <strong>Serviço Oficial de XML Indisponível (Fail-Closed)</strong>
            </div>
            <p className="recovery-card__body">{remoteFailure.message}</p>
            <div className="recovery-card__actions">
              <button
                type="button"
                className="btn btn--warning btn--sm"
                onClick={() => {
                  void handleGenerateXml(true);
                }}
              >
                <RefreshCw size={13} aria-hidden="true" />
                <span>Usar Motor Local (TS)</span>
              </button>
            </div>
          </div>
        )}

        {generation && (
          <div className="stack" style={{ marginBlockStart: 'var(--space-3)' }}>
            {!generation.supported && generation.reason && (
              <div className="banner banner--warning" role="status">
                <span>{generation.reason}</span>
              </div>
            )}

            {generation.excludedItems.length > 0 && (
              <div className="banner banner--warning" role="alert">
                <div>
                  <strong>
                    Itens excluídos do XML ({generation.excludedItems.length}):
                  </strong>
                  <ul className="xml-excluded-list">
                    {generation.excludedItems.map((ex, idx) => (
                      <li key={`excl-${ex.nObj}-${ex.code}-${idx}`} className="tabular-nums">
                        <strong>Item #{ex.nObj}</strong> ({ex.code}):{' '}
                        {ex.message ?? 'Item inválido excluído da serialização.'}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {validation && (
              <div className="staging-header-actions">
                <span
                  className={`badge ${
                    validation.xsdValidationMode === 'xsd-official'
                      ? 'badge--info'
                      : 'badge--neutral'
                  }`}
                >
                  {validation.xsdValidationMode === 'xsd-official'
                    ? 'XSD Oficial RFB'
                    : 'Validação Estrutural Local'}
                </span>
                <span
                  className={`badge ${
                    validation.valid ? 'badge--success' : 'badge--danger'
                  }`}
                >
                  {validation.valid ? 'XML Válido' : 'XML Inválido'}
                </span>
              </div>
            )}

            {validation && validation.errors.length > 0 && (
              <div className="banner banner--danger" role="alert">
                <ul className="xml-excluded-list">
                  {validation.errors.map((err, i) => (
                    <li key={`xml-val-err-${i}`}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {generation.xml && (
              <>
                <div className="staging-header-actions">
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => {
                      void handleCopyXml();
                    }}
                  >
                    {copiedXml ? (
                      <Check size={14} aria-hidden="true" />
                    ) : (
                      <Copy size={14} aria-hidden="true" />
                    )}
                    <span>{copiedXml ? 'XML Copiado!' : 'Copiar XML'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={handleDownloadXml}
                  >
                    <Download size={14} aria-hidden="true" />
                    <span>Baixar .xml</span>
                  </button>
                </div>

                <pre className="xml-code-surface">
                  <code>{generation.xml}</code>
                </pre>
              </>
            )}
          </div>
        )}
      </article>

      {/* Section 2: DANFSe PDF Preview / Generation */}
      <article className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">
              <FileText
                size={16}
                aria-hidden="true"
                style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
              />
              Gerador de PDF DANFSe (NFS-e Nacional)
            </h3>
            <span className="card__meta">
              Cole o XML da NFS-e (protegido contra XXE) para gerar o PDF via Go/WASM
              oficial ou Prévia Local PDFKit.
            </span>
          </div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              setNfseXml(SAMPLE_NFSE_XML);
              setDanfseError(null);
            }}
          >
            Carregar XML NFS-e de Exemplo
          </button>
        </div>

        <div className="stack">
          <div className="staging-field">
            <label htmlFor="danfse-xml-input">XML da NFS-e</label>
            <textarea
              id="danfse-xml-input"
              rows={6}
              className="danfse-textarea"
              value={nfseXml}
              onChange={(e) => setNfseXml(e.target.value)}
              placeholder="Cole aqui o XML <NFSe><infNFSe>...</infNFSe></NFSe>"
            />
          </div>

          <div className="staging-grid">
            <div className="staging-field">
              <label htmlFor="danfse-stc">Situação (stc)</label>
              <select
                id="danfse-stc"
                value={stc}
                onChange={(e) => setStc(Number(e.target.value) as 0 | 1 | 2)}
              >
                <option value={0}>0 — Normal</option>
                <option value={1}>1 — Cancelada</option>
                <option value={2}>2 — Substituída</option>
              </select>
            </div>

            <div className="staging-field" style={{ justifyContent: 'flex-end' }}>
              <label className="compare-checkbox-label">
                <input
                  type="checkbox"
                  checked={canhoto}
                  onChange={(e) => setCanhoto(e.target.checked)}
                />
                <span>Incluir Canhoto de Recebimento</span>
              </label>
            </div>
          </div>

          <div className="staging-header-actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={danfseLoading}
              onClick={() => {
                void handleGenerateDanfse(false);
              }}
            >
              <FileText size={14} aria-hidden="true" />
              <span>{danfseLoading ? 'Gerando PDF...' : 'Gerar PDF DANFSe'}</span>
            </button>
          </div>

          {danfseError && (
            <div className="banner banner--danger" role="alert">
              <span>{danfseError}</span>
            </div>
          )}

          {remoteFailure?.target === 'danfse' && (
            <div className="recovery-card" role="alert">
              <div className="recovery-card__header">
                <AlertTriangle size={15} aria-hidden="true" />
                <strong>Serviço Oficial DANFSe Indisponível (Fail-Closed)</strong>
              </div>
              <p className="recovery-card__body">{remoteFailure.message}</p>
              <div className="recovery-card__actions">
                <button
                  type="button"
                  className="btn btn--warning btn--sm"
                  onClick={() => {
                    void handleGenerateDanfse(true);
                  }}
                >
                  <RefreshCw size={13} aria-hidden="true" />
                  <span>Usar Motor Local (TS)</span>
                </button>
              </div>
            </div>
          )}

          {danfseResult && (
            <div className="danfse-result-box">
              <div className="staging-header-actions">
                <span
                  className={`badge ${
                    danfseResult.isLocalPreview ? 'badge--warning' : 'badge--success'
                  }`}
                >
                  {danfseResult.isLocalPreview
                    ? 'Prévia Local (PDFKit)'
                    : 'Go/WASM Oficial RFB'}
                </span>

                <a
                  href={danfseResult.pdfUrl}
                  download="danfse-preview.pdf"
                  className="btn btn--sm"
                >
                  <Download size={14} aria-hidden="true" />
                  <span>Baixar PDF DANFSe</span>
                </a>
              </div>

              {danfseResult.pdfUrl.startsWith('blob:') && (
                <iframe
                  title="Pré-visualização DANFSe PDF"
                  src={danfseResult.pdfUrl}
                  className="danfse-preview-frame"
                />
              )}
            </div>
          )}
        </div>
      </article>
    </div>
  );
}

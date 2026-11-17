import { useEffect, useState } from 'react';
import type { OperationContext } from '../../shared/types/fiscal';
import {
  listMunicipios,
  listUfs,
  type MunicipioLookupItem,
  type UfLookupItem,
} from '../api/client';

export interface ContextBarProps {
  context: Partial<OperationContext>;
  onContextPatch: (patch: Partial<OperationContext>) => void;
}

export interface TransitionBadgeInfo {
  label: string;
  detail: string;
  tone: string;
}

export function getTransitionBadge(dhFatoGerador?: string): TransitionBadgeInfo {
  const year = dhFatoGerador ? Number.parseInt(dhFatoGerador.slice(0, 4), 10) : 2026;
  if (!Number.isFinite(year) || year <= 2026) {
    return {
      label: '2026 Teste',
      detail: '0,9% CBS / 0,1% IBS — Compensável com PIS/COFINS',
      tone: 'badge--info',
    };
  }
  if (year >= 2033) {
    return {
      label: '2033+ Pleno',
      detail: 'Vigência Plena IBS/CBS — Extinção ICMS/ISS',
      tone: 'badge--success',
    };
  }
  return {
    label: '2027+ Sem PIS/COFINS',
    detail: 'CBS Plena + Transição ICMS/ISS',
    tone: 'badge--warning',
  };
}

export function ContextBar({ context, onContextPatch }: ContextBarProps) {
  const [ufs, setUfs] = useState<UfLookupItem[]>([]);
  const [municipios, setMunicipios] = useState<MunicipioLookupItem[]>([]);

  const uf = (context.uf ?? 'RS').trim();
  const regime = context.regime ?? 'regime-regular';
  const transitionBadge = getTransitionBadge(context.dhFatoGerador);

  useEffect(() => {
    let cancelled = false;
    void listUfs()
      .then((items) => {
        if (!cancelled) {
          setUfs(items);
        }
      })
      .catch(() => {
        // Optional lookup; manual UF entry remains active
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (uf.length !== 2) {
      return;
    }
    let cancelled = false;
    void listMunicipios(uf)
      .then((items) => {
        if (!cancelled) {
          setMunicipios(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMunicipios([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [uf]);

  const currentMunicipio = context.municipio;
  const hasCurrentMunicipioInList =
    currentMunicipio !== undefined &&
    municipios.some((m) => m.muniCd === currentMunicipio);

  return (
    <div className="context-bar">
      <div className="context-bar__fields">
        <div className="context-field">
          <label htmlFor="ctx-regime">Regime</label>
          <select
            id="ctx-regime"
            value={regime}
            onChange={(e) => {
              onContextPatch({
                regime: e.target.value as OperationContext['regime'],
              });
            }}
          >
            <option value="regime-regular">Regime Regular</option>
            <option value="simples-nacional">Simples Nacional</option>
            <option value="comparativo">Comparativo Regimes</option>
          </select>
        </div>

        <div className="context-field">
          <label htmlFor="ctx-date">Fato Gerador</label>
          <input
            id="ctx-date"
            type="date"
            className="tabular-nums"
            value={(context.dhFatoGerador ?? '2026-07-01').slice(0, 10)}
            onChange={(e) => {
              if (e.target.value) {
                onContextPatch({ dhFatoGerador: e.target.value });
              }
            }}
          />
        </div>

        <div className="context-field">
          <label htmlFor="ctx-dfe">DF-e</label>
          <select
            id="ctx-dfe"
            value={context.tipoDfe ?? '55'}
            onChange={(e) => {
              onContextPatch({
                tipoDfe: e.target.value as OperationContext['tipoDfe'],
              });
            }}
          >
            <option value="55">NF-e (55)</option>
            <option value="65">NFC-e (65)</option>
            <option value="NFSE">NFS-e</option>
          </select>
        </div>

        <div className="context-field">
          <label htmlFor="ctx-uf">UF</label>
          <input
            id="ctx-uf"
            type="text"
            list="ctx-uf-list"
            maxLength={2}
            style={{ inlineSize: '3.5rem', textTransform: 'uppercase' }}
            value={context.uf ?? 'RS'}
            onChange={(e) => {
              onContextPatch({ uf: e.target.value.toUpperCase() });
            }}
          />
          {ufs.length > 0 && (
            <datalist id="ctx-uf-list">
              {ufs.map((item) => (
                <option key={item.ufCd} value={item.sigla}>
                  {item.nome}
                </option>
              ))}
            </datalist>
          )}
        </div>

        <div className="context-field">
          <label htmlFor="ctx-municipio">Município</label>
          {municipios.length > 0 ? (
            <select
              id="ctx-municipio"
              className="tabular-nums"
              value={currentMunicipio ? String(currentMunicipio) : ''}
              onChange={(e) => {
                const code = Number.parseInt(e.target.value, 10);
                onContextPatch({
                  municipio: Number.isFinite(code) && code > 0 ? code : undefined,
                });
              }}
            >
              <option value="">Selecionar IBGE...</option>
              {!hasCurrentMunicipioInList && currentMunicipio !== undefined && (
                <option value={String(currentMunicipio)}>IBGE {currentMunicipio}</option>
              )}
              {municipios.map((m) => (
                <option key={m.muniCd} value={String(m.muniCd)}>
                  {m.nome} ({m.muniCd})
                </option>
              ))}
            </select>
          ) : (
            <input
              id="ctx-municipio"
              type="text"
              inputMode="numeric"
              className="tabular-nums"
              placeholder="Cód. IBGE"
              style={{ inlineSize: '6.5rem' }}
              value={currentMunicipio !== undefined ? String(currentMunicipio) : ''}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '');
                const code = Number.parseInt(digits, 10);
                onContextPatch({
                  municipio: digits && Number.isFinite(code) && code > 0 ? code : undefined,
                });
              }}
            />
          )}
        </div>

        {regime === 'simples-nacional' && (
          <>
            <div className="context-field">
              <label htmlFor="ctx-crt">CRT</label>
              <select
                id="ctx-crt"
                value={String(context.crt ?? 1)}
                onChange={(e) => {
                  const crt = Number.parseInt(e.target.value, 10) as 1 | 2 | 3;
                  onContextPatch({ crt });
                }}
              >
                <option value="1">1 — Simples Nacional</option>
                <option value="2">2 — Excesso de Sublimite</option>
                <option value="3">3 — Regime Normal</option>
              </select>
            </div>

            <div className="context-field">
              <label htmlFor="ctx-tp-regime-ibscbs">Regime IBS/CBS</label>
              <select
                id="ctx-tp-regime-ibscbs"
                value={String(context.tpRegimeIBSCBS ?? 2)}
                onChange={(e) => {
                  const tpRegimeIBSCBS = Number.parseInt(e.target.value, 10) as 1 | 2;
                  onContextPatch({ tpRegimeIBSCBS });
                }}
              >
                <option value="2">2 — DAS (Simples)</option>
                <option value="1">1 — Híbrido (Regular)</option>
              </select>
            </div>
          </>
        )}
      </div>

      <span
        className={`badge ${transitionBadge.tone}`}
        data-testid="transition-badge"
        title={transitionBadge.detail}
      >
        <strong>{transitionBadge.label}</strong>
        <span>&bull; {transitionBadge.detail}</span>
      </span>
    </div>
  );
}

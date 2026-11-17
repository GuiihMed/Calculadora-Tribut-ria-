import crypto from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type {
  AliquotasNominaisInput,
  ExtractionDraft,
  ExtractionDraftItem,
  FieldConfidence,
  OperationContext,
} from '../../shared/types/fiscal.js';
import { XXE_DTD_OR_ENTITY_RE, XxeRejectedError } from '../security/file-validator.js';
import { sanitizeSpreadsheetCell } from './spreadsheet-parser.js';

type XmlNode = Record<string, unknown>;

function asNode(val: unknown): XmlNode | undefined {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val as XmlNode;
  }
  return undefined;
}

function asArray(val: unknown): XmlNode[] {
  if (Array.isArray(val)) {
    return val.map(asNode).filter((n): n is XmlNode => n !== undefined);
  }
  const single = asNode(val);
  return single ? [single] : [];
}

function readText(val: unknown): string | undefined {
  if (val === undefined || val === null) {
    return undefined;
  }
  if (typeof val === 'object') {
    if (Array.isArray(val)) {
      return val.length > 0 ? readText(val[0]) : undefined;
    }
    const obj = val as XmlNode;
    if ('#text' in obj) {
      return readText(obj['#text']);
    }
    return undefined;
  }
  const s = String(val).trim();
  return s.length > 0 ? s : undefined;
}

function firstText(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    const resolved = readText(v);
    if (resolved !== undefined) {
      return resolved;
    }
  }
  return undefined;
}

function extractIsoDate(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const match = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : undefined;
}

function findFirstNestedChild(parent: XmlNode | undefined): XmlNode | undefined {
  if (!parent) {
    return undefined;
  }
  for (const [key, val] of Object.entries(parent)) {
    if (key.startsWith('@_')) {
      continue;
    }
    const child = asNode(val);
    if (child) {
      return child;
    }
  }
  return undefined;
}

function parseNfeDraft(infNFe: XmlNode, filename: string): ExtractionDraft {
  const warnings: string[] = [];
  const ide = asNode(infNFe.ide);
  const emit = asNode(infNFe.emit);
  const dest = asNode(infNFe.dest);
  const enderEmit = asNode(emit?.enderEmit);
  const enderDest = asNode(dest?.enderDest);

  const dhFatoGerador = extractIsoDate(firstText(ide?.dhEmi, ide?.dEmi));
  const mod = firstText(ide?.mod);
  const tipoDfe: OperationContext['tipoDfe'] = mod === '65' ? '65' : '55';
  const ufRaw = firstText(enderEmit?.UF, enderDest?.UF);
  const uf = ufRaw && ufRaw.length === 2 ? ufRaw.toUpperCase() : undefined;
  const cMunFG = firstText(ide?.cMunFG, enderEmit?.cMun);
  const municipio = cMunFG && /^\d+$/.test(cMunFG) ? Number.parseInt(cMunFG, 10) : undefined;
  const crtRaw = firstText(emit?.CRT);
  const crt =
    crtRaw === '1' ? 1 : crtRaw === '2' ? 2 : crtRaw === '3' ? 3 : undefined;

  const context: Partial<OperationContext> = {
    tipoDfe,
    ...(dhFatoGerador ? { dhFatoGerador } : {}),
    ...(uf ? { uf } : {}),
    ...(municipio ? { municipio } : {}),
    ...(crt ? { crt, regime: crt === 1 ? 'simples-nacional' : 'regime-regular' } : { regime: 'regime-regular' }),
  };

  let requiresReview = !dhFatoGerador;
  if (!dhFatoGerador) {
    warnings.push('Data de emissão (dhEmi) não encontrada no XML; informe a data do fato gerador.');
  }

  const detList = asArray(infNFe.det);
  const itens: ExtractionDraftItem[] = detList.map((det, idx) => {
    const prod = asNode(det.prod);
    const imposto = asNode(det.imposto);
    const nItemAttr = readText(det['@_nItem']);
    const nObj = nItemAttr && /^\d+$/.test(nItemAttr) ? Number.parseInt(nItemAttr, 10) : idx + 1;

    const icmsGroup = findFirstNestedChild(asNode(imposto?.ICMS));
    const pisGroup = findFirstNestedChild(asNode(imposto?.PIS));
    const cofinsGroup = findFirstNestedChild(asNode(imposto?.COFINS));
    const isNode = asNode(imposto?.IS);
    const ibsCbsNode = asNode(imposto?.IBSCBS) ?? asNode(imposto?.gIBSCBS);
    const gIbsCbsNode = asNode(ibsCbsNode?.gIBSCBS) ?? ibsCbsNode;

    const rawDesc = firstText(prod?.xProd);
    const descricao = rawDesc ? sanitizeSpreadsheetCell(rawDesc) : undefined;
    const ncm = firstText(prod?.NCM);
    const nbs = firstText(prod?.NBS, prod?.cNBS);
    const vProd = firstText(prod?.vProd);
    const vFrete = firstText(prod?.vFrete);
    const vSeg = firstText(prod?.vSeg);
    const vOutro = firstText(prod?.vOutro);
    const vDesc = firstText(prod?.vDesc);
    const quantidade = firstText(prod?.qCom, prod?.qTrib);
    const unidade = firstText(prod?.uCom, prod?.uTrib);

    const vICMS = firstText(icmsGroup?.vICMS);
    const vPIS = firstText(pisGroup?.vPIS);
    const vCOFINS = firstText(cofinsGroup?.vCOFINS);
    const vIS = firstText(isNode?.vIS);

    const cst = firstText(ibsCbsNode?.CST);
    const cClassTrib = firstText(ibsCbsNode?.cClassTrib);
    const baseCalculo = firstText(gIbsCbsNode?.vBC, vProd);

    const pIBSUF = firstText(asNode(gIbsCbsNode?.gIBSUF)?.pIBSUF);
    const pIBSMun = firstText(asNode(gIbsCbsNode?.gIBSMun)?.pIBSMun);
    const pCBS = firstText(asNode(gIbsCbsNode?.gCBS)?.pCBS);
    const aliquotasNominais: AliquotasNominaisInput | undefined =
      pIBSUF || pIBSMun || pCBS
        ? {
            ...(pCBS ? { pCBS } : {}),
            ...(pIBSUF ? { pIBSUF } : {}),
            ...(pIBSMun ? { pIBSMun } : {}),
          }
        : undefined;

    const confidence: Record<string, FieldConfidence> = {};
    const missingFields: string[] = [];

    const mark = (field: string, value: string | undefined, required = false) => {
      if (value !== undefined) {
        confidence[field] = 'high';
      } else if (required) {
        confidence[field] = 'missing';
        missingFields.push(field);
        requiresReview = true;
      }
    };

    mark('descricao', descricao);
    mark('ncm', ncm);
    if (nbs) {
      confidence.nbs = 'high';
    }
    mark('cst', cst, true);
    mark('cClassTrib', cClassTrib, true);
    mark('baseCalculo', baseCalculo, true);
    mark('vProd', vProd);
    mark('quantidade', quantidade);
    mark('unidade', unidade);

    return {
      nObj,
      ...(descricao !== undefined ? { descricao } : {}),
      ...(ncm !== undefined ? { ncm } : {}),
      ...(nbs !== undefined ? { nbs } : {}),
      ...(cst !== undefined ? { cst } : {}),
      ...(cClassTrib !== undefined ? { cClassTrib } : {}),
      ...(baseCalculo !== undefined ? { baseCalculo } : {}),
      ...(quantidade !== undefined ? { quantidade } : {}),
      ...(unidade !== undefined ? { unidade } : {}),
      ...(vProd !== undefined ? { vProd } : {}),
      ...(vFrete !== undefined ? { vFrete } : {}),
      ...(vSeg !== undefined ? { vSeg } : {}),
      ...(vOutro !== undefined ? { vOutro } : {}),
      ...(vDesc !== undefined ? { vDesc } : {}),
      ...(vICMS !== undefined ? { vICMS } : {}),
      ...(vPIS !== undefined ? { vPIS } : {}),
      ...(vCOFINS !== undefined ? { vCOFINS } : {}),
      ...(vIS !== undefined ? { vIS } : {}),
      ...(aliquotasNominais ? { aliquotasNominais } : {}),
      confidence,
      missingFields,
    };
  });

  if (itens.length === 0) {
    requiresReview = true;
    warnings.push('Nenhum elemento <det> encontrado no XML da NF-e/NFC-e.');
  } else if (itens.some((i) => i.missingFields.length > 0)) {
    warnings.push(
      'XML não contém CST/cClassTrib do grupo IBSCBS em um ou mais itens; revise antes de calcular.',
    );
  }

  return {
    id: crypto.randomUUID(),
    sourceType: 'xml',
    filename,
    context,
    itens,
    warnings,
    requiresReview,
    createdAt: new Date().toISOString(),
  };
}

function parseNfseDraft(infNFSe: XmlNode, filename: string): ExtractionDraft {
  const warnings: string[] = [];
  const dps = asNode(infNFSe.DPS);
  const infDPS = asNode(dps?.infDPS);

  const emit = asNode(infNFSe.emit) ?? asNode(infDPS?.prest);
  const enderEmit = asNode(emit?.enderNac) ?? asNode(emit?.end);

  const serv = asNode(infDPS?.serv) ?? asNode(infNFSe.serv);
  const cServ = asNode(serv?.cServ);

  const valoresDps = asNode(infDPS?.valores);
  const vServPrest = asNode(valoresDps?.vServPrest);
  const valoresNfse = asNode(infNFSe.valores);
  const ibsCbsNode = asNode(infNFSe.IBSCBS) ?? asNode(infDPS?.IBSCBS);
  const ibsVals = asNode(ibsCbsNode?.valores);
  const gIbsCbs = asNode(ibsCbsNode?.gIBSCBS);

  const dhFatoGerador = extractIsoDate(
    firstText(infDPS?.dCompet, infDPS?.dhEmi, infNFSe.dCompet, infNFSe.dhProc),
  );
  const ufRaw = firstText(infNFSe.xUFIncid, enderEmit?.UF);
  const uf = ufRaw && ufRaw.length === 2 ? ufRaw.toUpperCase() : undefined;
  const cLocRaw = firstText(infNFSe.cLocIncid, infDPS?.cLocEmi, enderEmit?.cMun);
  const municipio = cLocRaw && /^\d+$/.test(cLocRaw) ? Number.parseInt(cLocRaw, 10) : undefined;

  const context: Partial<OperationContext> = {
    tipoDfe: 'NFSE',
    regime: 'regime-regular',
    ...(dhFatoGerador ? { dhFatoGerador } : {}),
    ...(uf ? { uf } : {}),
    ...(municipio ? { municipio } : {}),
  };

  const rawDesc = firstText(cServ?.xDescServ, serv?.xDescServ, infNFSe.xDescServ);
  const descricao = rawDesc ? sanitizeSpreadsheetCell(rawDesc) : undefined;
  const nbs = firstText(cServ?.cNBS, serv?.cNBS, serv?.NBS);
  const cst = firstText(ibsCbsNode?.CST);
  const cClassTrib = firstText(ibsCbsNode?.cClassTrib);
  const vServ = firstText(vServPrest?.vServ, valoresNfse?.vBC, valoresNfse?.vLiq);
  const baseCalculo = firstText(ibsVals?.vBC, gIbsCbs?.vBC, vServ);
  const vPIS = firstText(asNode(valoresDps?.trib)?.vPIS, valoresNfse?.vPIS);
  const vCOFINS = firstText(asNode(valoresDps?.trib)?.vCOFINS, valoresNfse?.vCOFINS);

  const pIBSUF = firstText(asNode(gIbsCbs?.gIBSUF)?.pIBSUF);
  const pIBSMun = firstText(asNode(gIbsCbs?.gIBSMun)?.pIBSMun);
  const pCBS = firstText(asNode(gIbsCbs?.gCBS)?.pCBS);
  const aliquotasNominais: AliquotasNominaisInput | undefined =
    pIBSUF || pIBSMun || pCBS
      ? {
          ...(pCBS ? { pCBS } : {}),
          ...(pIBSUF ? { pIBSUF } : {}),
          ...(pIBSMun ? { pIBSMun } : {}),
        }
      : undefined;

  const confidence: Record<string, FieldConfidence> = {};
  const missingFields: string[] = [];
  let requiresReview = !dhFatoGerador;

  const mark = (field: string, value: string | undefined, required = false) => {
    if (value !== undefined) {
      confidence[field] = 'high';
    } else if (required) {
      confidence[field] = 'missing';
      missingFields.push(field);
      requiresReview = true;
    }
  };

  mark('descricao', descricao);
  mark('nbs', nbs);
  mark('cst', cst, true);
  mark('cClassTrib', cClassTrib, true);
  mark('baseCalculo', baseCalculo, true);

  if (missingFields.length > 0) {
    warnings.push(
      'XML de NFS-e não possui todos os campos IBSCBS (CST/cClassTrib/base); revise antes de calcular.',
    );
  }

  return {
    id: crypto.randomUUID(),
    sourceType: 'xml',
    filename,
    context,
    itens: [
      {
        nObj: 1,
        ...(descricao !== undefined ? { descricao } : {}),
        ...(nbs !== undefined ? { nbs } : {}),
        ...(cst !== undefined ? { cst } : {}),
        ...(cClassTrib !== undefined ? { cClassTrib } : {}),
        ...(baseCalculo !== undefined ? { baseCalculo } : {}),
        ...(vServ !== undefined ? { vProd: vServ } : {}),
        ...(vPIS !== undefined ? { vPIS } : {}),
        ...(vCOFINS !== undefined ? { vCOFINS } : {}),
        ...(aliquotasNominais ? { aliquotasNominais } : {}),
        confidence,
        missingFields,
      },
    ],
    warnings,
    requiresReview,
    createdAt: new Date().toISOString(),
  };
}

export function parseDfeXmlToDraft(xml: string, filename = 'documento.xml'): ExtractionDraft {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new Error('Conteúdo XML vazio.');
  }
  if (XXE_DTD_OR_ENTITY_RE.test(xml)) {
    throw new XxeRejectedError();
  }

  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new Error(`XML malformado: ${valid.err?.msg ?? 'erro de sintaxe'}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    trimValues: true,
    processEntities: false,
  });

  const parsed = parser.parse(xml) as XmlNode;

  const nfeProc = asNode(parsed.nfeProc);
  const nfe = asNode(nfeProc?.NFe) ?? asNode(parsed.NFe);
  const infNFe = asNode(nfe?.infNFe) ?? asNode(parsed.infNFe);
  if (infNFe) {
    return parseNfeDraft(infNFe, filename);
  }

  const nfse = asNode(parsed.NFSe);
  const infNFSe = asNode(nfse?.infNFSe) ?? asNode(parsed.infNFSe);
  if (infNFSe) {
    return parseNfseDraft(infNFSe, filename);
  }

  throw new Error(
    'Estrutura DF-e não reconhecida no XML. Esperado <NFe><infNFe> (NF-e/NFC-e) ou <NFSe><infNFSe> (NFS-e).',
  );
}

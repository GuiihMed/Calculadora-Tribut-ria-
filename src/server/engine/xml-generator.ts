import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { formatCurrency, totalizeExact } from '../../shared/rounding.js';
import type {
  CalcRunSnapshot,
  ObservabilidadeRocItemOutput,
  ObservabilidadeRocOutput,
  XmlGenerationResult,
  XmlValidationResult,
} from '../../shared/types/fiscal.js';

const DTD_OR_ENTITY_RE = /<!\s*(DOCTYPE|ENTITY)\b/i;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tag(name: string, value: string, indent: string): string {
  return `${indent}<${name}>${escapeXml(value)}</${name}>`;
}

function isValidItemForXml(item: ObservabilidadeRocItemOutput): boolean {
  return (
    (item.estadoItem === 'CALCULADO' || item.estadoItem === 'CALCULO_SIMULADO') &&
    item.erros.length === 0
  );
}

function serializeIsGroup(gIS: NonNullable<ObservabilidadeRocItemOutput['gIS']>): string[] {
  const lines: string[] = ['      <IS>'];
  if (gIS.cstIS) {
    lines.push(tag('CSTIS', gIS.cstIS, '        '));
  }
  if (gIS.cClassTribIS) {
    lines.push(tag('cClassTribIS', gIS.cClassTribIS, '        '));
  }
  lines.push(tag('vBCIS', gIS.vBCIS, '        '));
  if (gIS.pIS !== undefined) {
    lines.push(tag('pIS', gIS.pIS, '        '));
  }
  if (gIS.pISEspec !== undefined) {
    lines.push(tag('pISEspec', gIS.pISEspec, '        '));
  }
  if (gIS.uTrib !== undefined) {
    lines.push(tag('uTrib', gIS.uTrib, '        '));
  }
  if (gIS.qTrib !== undefined) {
    lines.push(tag('qTrib', gIS.qTrib, '        '));
  }
  lines.push(tag('vIS', gIS.vIS, '        '));
  lines.push('      </IS>');
  return lines;
}

function serializeIbsCbsGroup(item: ObservabilidadeRocItemOutput): string[] {
  const lines: string[] = ['      <IBSCBS>'];
  const g = item.gIBSCBS;
  lines.push(tag('CST', g?.CST ?? item.cst, '        '));
  lines.push(tag('cClassTrib', g?.cClassTrib ?? item.cClassTrib, '        '));

  if (g) {
    lines.push('        <gIBSCBS>');
    lines.push(tag('vBC', g.vBC, '          '));

    if (g.gIBSUF) {
      lines.push('          <gIBSUF>');
      lines.push(tag('pIBSUF', g.gIBSUF.pIBSUF, '            '));
      if (g.gIBSUF.vDif !== undefined) {
        lines.push('            <gDif>');
        lines.push(tag('vDif', g.gIBSUF.vDif, '              '));
        lines.push('            </gDif>');
      }
      if (g.gIBSUF.pRedAliq !== undefined) {
        lines.push('            <gRed>');
        lines.push(tag('pRedAliq', g.gIBSUF.pRedAliq, '              '));
        lines.push(tag('pAliqEfet', g.gIBSUF.pAliqEfet, '              '));
        lines.push('            </gRed>');
      }
      lines.push(tag('vIBSUF', g.gIBSUF.vIBSUF, '            '));
      lines.push('          </gIBSUF>');
    }

    if (g.gIBSMun) {
      lines.push('          <gIBSMun>');
      lines.push(tag('pIBSMun', g.gIBSMun.pIBSMun, '            '));
      if (g.gIBSMun.vDif !== undefined) {
        lines.push('            <gDif>');
        lines.push(tag('vDif', g.gIBSMun.vDif, '              '));
        lines.push('            </gDif>');
      }
      if (g.gIBSMun.pRedAliq !== undefined) {
        lines.push('            <gRed>');
        lines.push(tag('pRedAliq', g.gIBSMun.pRedAliq, '              '));
        lines.push(tag('pAliqEfet', g.gIBSMun.pAliqEfet, '              '));
        lines.push('            </gRed>');
      }
      lines.push(tag('vIBSMun', g.gIBSMun.vIBSMun, '            '));
      lines.push('          </gIBSMun>');
    }

    lines.push(tag('vIBS', g.vIBS, '          '));

    if (g.gCBS) {
      lines.push('          <gCBS>');
      lines.push(tag('pCBS', g.gCBS.pCBS, '            '));
      if (g.gCBS.vDif !== undefined) {
        lines.push('            <gDif>');
        lines.push(tag('vDif', g.gCBS.vDif, '              '));
        lines.push('            </gDif>');
      }
      if (g.gCBS.pRedAliq !== undefined) {
        lines.push('            <gRed>');
        lines.push(tag('pRedAliq', g.gCBS.pRedAliq, '              '));
        lines.push(tag('pAliqEfet', g.gCBS.pAliqEfet, '              '));
        lines.push('            </gRed>');
      }
      lines.push(tag('vCBS', g.gCBS.vCBS, '            '));
      lines.push('          </gCBS>');
    }

    lines.push('        </gIBSCBS>');
  }

  lines.push('      </IBSCBS>');
  return lines;
}

/**
 * Generates NF-e / NFC-e RTC XML groups (<infNFe><det><imposto><IS>/<IBSCBS> and <total>)
 * strictly from valid Regime Regular items in an immutable CalcRunSnapshot.
 */
export function generateTaxXmlFromCalcRun(
  snapshot: CalcRunSnapshot,
  tipo: 'nfe' | 'nfce' = 'nfe',
): XmlGenerationResult {
  if (snapshot.kind !== 'regime_regular') {
    return {
      supported: false,
      reason:
        'Geração de XML RTC (<IBSCBS>/<IS>) disponível apenas para apurações do Regime Regular (NfeXmlService).',
      excludedItems: [],
    };
  }

  const rocOutput = snapshot.output as ObservabilidadeRocOutput;
  const itens = Array.isArray(rocOutput?.itens) ? rocOutput.itens : [];

  const validItems: ObservabilidadeRocItemOutput[] = [];
  const excludedItems: XmlGenerationResult['excludedItems'] = [];

  for (const item of itens) {
    if (isValidItemForXml(item)) {
      validItems.push(item);
    } else {
      const firstErr = item.erros[0];
      excludedItems.push({
        nObj: item.nObj,
        code: firstErr?.code ?? item.estadoItem,
        message: firstErr?.description ?? firstErr?.title ?? `Item em estado ${item.estadoItem}`,
      });
    }
  }

  if (validItems.length === 0) {
    return {
      supported: false,
      reason: 'Nenhum item válido (CALCULADO) para geração de XML.',
      excludedItems,
    };
  }

  const isItems = validItems.map((it) => it.gIS).filter((g): g is NonNullable<typeof g> => Boolean(g));
  const ibsCbsItems = validItems
    .map((it) => it.gIBSCBS)
    .filter((g): g is NonNullable<typeof g> => Boolean(g));

  const totVIS = isItems.length > 0 ? formatCurrency(totalizeExact(isItems.map((g) => g.vIS))) : null;
  const totVBC = formatCurrency(totalizeExact(ibsCbsItems.map((g) => g.vBC)));
  const totVIBSUF = formatCurrency(
    totalizeExact(ibsCbsItems.map((g) => g.gIBSUF?.vIBSUF ?? '0')),
  );
  const totVDifIBSUF = formatCurrency(
    totalizeExact(ibsCbsItems.map((g) => g.gIBSUF?.vDif ?? '0')),
  );
  const totVIBSMun = formatCurrency(
    totalizeExact(ibsCbsItems.map((g) => g.gIBSMun?.vIBSMun ?? '0')),
  );
  const totVDifIBSMun = formatCurrency(
    totalizeExact(ibsCbsItems.map((g) => g.gIBSMun?.vDif ?? '0')),
  );
  const totVIBS = formatCurrency(totalizeExact([totVIBSUF, totVIBSMun]));
  const totVCBS = formatCurrency(totalizeExact(ibsCbsItems.map((g) => g.gCBS?.vCBS ?? '0')));
  const totVDifCBS = formatCurrency(
    totalizeExact(ibsCbsItems.map((g) => g.gCBS?.vDif ?? '0')),
  );

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<infNFe versao="1.00" tipoDfe="${escapeXml(tipo)}">`,
  ];

  for (const item of validItems) {
    lines.push(`  <det nItem="${escapeXml(String(item.nObj))}">`);
    lines.push('    <imposto>');
    if (item.gIS) {
      lines.push(...serializeIsGroup(item.gIS));
    }
    lines.push(...serializeIbsCbsGroup(item));
    lines.push('    </imposto>');
    lines.push('  </det>');
  }

  lines.push('  <total>');
  if (totVIS !== null) {
    lines.push('    <ISTot>');
    lines.push(tag('vIS', totVIS, '      '));
    lines.push('    </ISTot>');
  }
  lines.push('    <IBSCBSTot>');
  lines.push(tag('vBCIBSCBS', totVBC, '      '));
  lines.push('      <gIBS>');
  lines.push('        <gIBSUF>');
  lines.push(tag('vDif', totVDifIBSUF, '          '));
  lines.push(tag('vDevTrib', '0.00', '          '));
  lines.push(tag('vIBSUF', totVIBSUF, '          '));
  lines.push('        </gIBSUF>');
  lines.push('        <gIBSMun>');
  lines.push(tag('vDif', totVDifIBSMun, '          '));
  lines.push(tag('vDevTrib', '0.00', '          '));
  lines.push(tag('vIBSMun', totVIBSMun, '          '));
  lines.push('        </gIBSMun>');
  lines.push(tag('vIBS', totVIBS, '        '));
  lines.push(tag('vCredPres', '0.00', '        '));
  lines.push(tag('vCredPresCondSus', '0.00', '        '));
  lines.push('      </gIBS>');
  lines.push('      <gCBS>');
  lines.push(tag('vDif', totVDifCBS, '        '));
  lines.push(tag('vDevTrib', '0.00', '        '));
  lines.push(tag('vCBS', totVCBS, '        '));
  lines.push(tag('vCredPres', '0.00', '        '));
  lines.push(tag('vCredPresCondSus', '0.00', '        '));
  lines.push('      </gCBS>');
  lines.push('    </IBSCBSTot>');
  lines.push('  </total>');
  lines.push('</infNFe>');

  return {
    supported: true,
    xml: lines.join('\n'),
    excludedItems,
  };
}

function hasKeyDeep(node: unknown, targetKey: string): boolean {
  if (node === null || typeof node !== 'object') {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some((el) => hasKeyDeep(el, targetKey));
  }
  const obj = node as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(obj, targetKey)) {
    return true;
  }
  return Object.values(obj).some((val) => hasKeyDeep(val, targetKey));
}

function getByPath(node: unknown, key: string): unknown {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return undefined;
  }
  return (node as Record<string, unknown>)[key];
}

/**
 * Validates XML well-formedness, rejects XXE (DOCTYPE/ENTITY), and checks
 * required structural RTC tags for 'nota' or 'grupo' subtypes locally.
 */
export function validateTaxXmlStructure(
  xml: string,
  _tipo: string,
  subtipo: 'grupo' | 'nota',
): XmlValidationResult {
  const errors: string[] = [];

  if (typeof xml !== 'string' || !xml.trim()) {
    return {
      valid: false,
      xsdValidationMode: 'structural-local',
      errors: ['XML vazio ou inválido.'],
    };
  }

  if (DTD_OR_ENTITY_RE.test(xml)) {
    return {
      valid: false,
      xsdValidationMode: 'structural-local',
      errors: ['XML contém declaração DOCTYPE ou ENTITY proibida (proteção anti-XXE).'],
    };
  }

  const wellFormed = XMLValidator.validate(xml);
  if (wellFormed !== true) {
    return {
      valid: false,
      xsdValidationMode: 'structural-local',
      errors: [wellFormed.err?.msg ?? 'XML malformado.'],
    };
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
    parseTagValue: false,
  });

  const parsed = parser.parse(xml) as Record<string, unknown>;

  if (subtipo === 'grupo') {
    const hasGroup = hasKeyDeep(parsed, 'IBSCBS') || hasKeyDeep(parsed, 'IS');
    if (!hasGroup) {
      errors.push('Grupo XML deve conter ao menos <IBSCBS> ou <IS>.');
    }
    return {
      valid: errors.length === 0,
      xsdValidationMode: 'structural-local',
      errors,
    };
  }

  // subtipo === 'nota'
  const nfeRoot = getByPath(parsed, 'NFe');
  const infNFe = getByPath(parsed, 'infNFe') ?? getByPath(nfeRoot, 'infNFe');
  const nfceRoot = getByPath(parsed, 'NFCe');
  const infNfce = infNFe ?? getByPath(nfceRoot, 'infNFe');
  const nfseRoot = getByPath(parsed, 'NFSe');
  const infNfse = getByPath(nfseRoot, 'infNFSe');

  if (infNfce) {
    if (!hasKeyDeep(infNfce, 'det')) {
      errors.push('Nota fiscal deve conter ao menos um grupo <det>.');
    }
    if (!hasKeyDeep(infNfce, 'IBSCBS')) {
      errors.push('Nota fiscal deve conter o grupo <IBSCBS>.');
    }
    if (!hasKeyDeep(infNfce, 'total')) {
      errors.push('Nota fiscal deve conter o grupo <total>.');
    }
  } else if (nfceRoot) {
    if (!hasKeyDeep(nfceRoot, 'det')) {
      errors.push('NFC-e deve conter ao menos um grupo <det>.');
    }
    if (!hasKeyDeep(nfceRoot, 'IBSCBS')) {
      errors.push('NFC-e deve conter o grupo <IBSCBS>.');
    }
    if (!hasKeyDeep(nfceRoot, 'total')) {
      errors.push('NFC-e deve conter o grupo <total>.');
    }
  } else if (infNfse) {
    if (!hasKeyDeep(infNfse, 'IBSCBS')) {
      errors.push('NFS-e deve conter o grupo <IBSCBS>.');
    }
  } else {
    errors.push('Elemento raiz esperado não encontrado (<infNFe>, <NFCe> ou <NFSe><infNFSe>).');
  }

  return {
    valid: errors.length === 0,
    xsdValidationMode: 'structural-local',
    errors,
  };
}

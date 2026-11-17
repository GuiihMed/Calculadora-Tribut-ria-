import { XMLParser, XMLValidator } from 'fast-xml-parser';
import PDFDocument from 'pdfkit';

export const LOCAL_PREVIEW_NOTICE =
  'PRÉVIA LOCAL — Conecte o serviço Go/WASM oficial da RFB para o PDF oficial';
const LOCAL_PREVIEW_NOTICE_ASCII =
  'PREVIA LOCAL - Conecte o servico Go/WASM oficial da RFB para o PDF oficial';
const MAX_XML_BYTES = 5 * 1024 * 1024;
const DTD_OR_ENTITY_RE = /<!\s*(DOCTYPE|ENTITY)\b/i;

type XmlNode = Record<string, unknown>;

function asNode(val: unknown): XmlNode | undefined {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val as XmlNode;
  }
  return undefined;
}

function str(val: unknown, fallback = '—'): string {
  if (val === undefined || val === null) {
    return fallback;
  }
  if (typeof val === 'object') {
    if (Array.isArray(val)) {
      return val.length > 0 ? str(val[0], fallback) : fallback;
    }
    const obj = val as Record<string, unknown>;
    if ('#text' in obj) {
      return str(obj['#text'], fallback);
    }
    return fallback;
  }
  const s = String(val).trim();
  return s.length > 0 ? s : fallback;
}

function firstStr(...vals: unknown[]): string {
  for (const v of vals) {
    const resolved = str(v, '');
    if (resolved.length > 0) {
      return resolved;
    }
  }
  return '—';
}

function formatAddress(ender: XmlNode | undefined): string {
  if (!ender) {
    return '—';
  }
  const nestedNac = asNode(ender.endNac) ?? asNode(ender.enderNac) ?? ender;
  const parts = [
    firstStr(ender.xLgr, nestedNac.xLgr),
    firstStr(ender.nro, nestedNac.nro),
    firstStr(ender.xBairro, nestedNac.xBairro),
    firstStr(nestedNac.xMun, nestedNac.cMun),
    firstStr(nestedNac.UF),
    firstStr(nestedNac.CEP),
  ].filter((p) => p !== '—');
  return parts.length > 0 ? parts.join(', ') : '—';
}

interface ParsedNfseData {
  idNfse: string;
  nNFSe: string;
  dhEmi: string;
  dCompet: string;
  nDPS: string;
  serie: string;
  localIncid: string;
  emitNome: string;
  emitDoc: string;
  emitEnd: string;
  tomaNome: string;
  tomaDoc: string;
  tomaEnd: string;
  cTribNac: string;
  cNBS: string;
  xDescServ: string;
  vServ: string;
  vBC: string;
  vISSQN: string;
  vLiq: string;
  ibsCbs?: {
    vBC: string;
    vIBSUF: string;
    vIBSMun: string;
    vIBSTot: string;
    vCBS: string;
    vTotNF: string;
  };
}

function extractNfseData(xml: string): ParsedNfseData {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new Error('XML de NFS-e vazio.');
  }
  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) {
    throw new Error('XML de NFS-e excede o limite máximo de 5 MiB.');
  }
  if (DTD_OR_ENTITY_RE.test(xml)) {
    throw new Error('XML contém declaração DOCTYPE ou ENTITY proibida (proteção anti-XXE).');
  }

  const wellFormed = XMLValidator.validate(xml);
  if (wellFormed !== true) {
    throw new Error(`XML de NFS-e malformado: ${wellFormed.err?.msg ?? 'erro de sintaxe'}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
    parseTagValue: false,
  });

  const parsed = parser.parse(xml) as XmlNode;
  const nfse = asNode(parsed.NFSe);
  const infNFSe = asNode(nfse?.infNFSe);
  if (!nfse || !infNFSe) {
    throw new Error('Estrutura esperada <NFSe><infNFSe> não encontrada no XML.');
  }

  const dps = asNode(infNFSe.DPS);
  const infDPS = asNode(dps?.infDPS);

  const emit = asNode(infNFSe.emit) ?? asNode(infDPS?.prest);
  const toma =
    asNode(infDPS?.toma) ?? asNode(infNFSe.toma) ?? asNode(infNFSe.tomador);

  const serv = asNode(infDPS?.serv) ?? asNode(infNFSe.serv);
  const cServ = asNode(serv?.cServ);

  const valoresDps = asNode(infDPS?.valores);
  const vServPrest = asNode(valoresDps?.vServPrest);
  const valoresNfse = asNode(infNFSe.valores);

  const ibsCbsNode = asNode(infNFSe.IBSCBS);
  let ibsCbs: ParsedNfseData['ibsCbs'];
  if (ibsCbsNode) {
    const ibsVals = asNode(ibsCbsNode.valores);
    const totCIBS = asNode(ibsCbsNode.totCIBS);
    const gIBS = asNode(totCIBS?.gIBS);
    const gIBSUFTot = asNode(gIBS?.gIBSUFTot);
    const gIBSMunTot = asNode(gIBS?.gIBSMunTot);
    const gCBS = asNode(totCIBS?.gCBS);
    ibsCbs = {
      vBC: str(ibsVals?.vBC),
      vIBSUF: str(gIBSUFTot?.vIBSUF),
      vIBSMun: str(gIBSMunTot?.vIBSMun),
      vIBSTot: str(gIBS?.vIBSTot),
      vCBS: str(gCBS?.vCBS),
      vTotNF: str(totCIBS?.vTotNF),
    };
  }

  const locIncid = [str(infNFSe.xLocIncid, ''), str(infNFSe.xUFIncid, '')]
    .filter(Boolean)
    .join(' - ');

  return {
    idNfse: str(infNFSe['@_Id']),
    nNFSe: str(infNFSe.nNFSe),
    dhEmi: firstStr(infDPS?.dhEmi, infNFSe.dhProc),
    dCompet: firstStr(infDPS?.dCompet, infNFSe.dCompet),
    nDPS: str(infDPS?.nDPS),
    serie: str(infDPS?.serie),
    localIncid: locIncid || str(infNFSe.xLocEmi),
    emitNome: firstStr(emit?.xNome, emit?.xFant),
    emitDoc: firstStr(emit?.CNPJ, emit?.CPF, emit?.NIF),
    emitEnd: formatAddress(asNode(emit?.enderNac)),
    tomaNome: str(toma?.xNome),
    tomaDoc: firstStr(toma?.CNPJ, toma?.CPF, toma?.NIF),
    tomaEnd: formatAddress(asNode(toma?.end)),
    cTribNac: firstStr(cServ?.cTribNac, serv?.cTribNac),
    cNBS: firstStr(cServ?.cNBS, serv?.cNBS),
    xDescServ: firstStr(cServ?.xDescServ, serv?.xDescServ),
    vServ: firstStr(vServPrest?.vServ, valoresNfse?.vLiq, valoresNfse?.vBC),
    vBC: firstStr(valoresNfse?.vBC, vServPrest?.vServ),
    vISSQN: str(valoresNfse?.vISSQN),
    vLiq: firstStr(valoresNfse?.vLiq, vServPrest?.vServ),
    ...(ibsCbs ? { ibsCbs } : {}),
  };
}

function drawSectionHeader(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown(0.5);
  const y = doc.y;
  doc
    .rect(36, y, doc.page.width - 72, 16)
    .fillAndStroke('#e2e8f0', '#94a3b8');
  doc
    .fillColor('#0f172a')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(title, 42, y + 4);
  doc.y = y + 20;
  doc.font('Helvetica').fontSize(9).fillColor('#1e293b');
}

/**
 * Generates a structured local DANFSe PDF preview from NFS-e XML using pdfkit.
 * Always displays the prominent local-preview notice reminding users to connect
 * the official RFB Go/WASM DANFSe service for the authoritative layout.
 */
export async function generateDanfsePreviewPdf(
  nfseXml: string,
  stc: 0 | 1 | 2 = 0,
  canhoto: boolean = true,
): Promise<Buffer> {
  const data = extractNfseData(nfseXml);

  const situacaoLabel =
    stc === 1 ? 'CANCELADA' : stc === 2 ? 'SUBSTITUÍDA' : 'VÁLIDA';

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 36,
      compress: false,
      info: {
        Title: `DANFSe Preview ${data.nNFSe}`,
        Subject: LOCAL_PREVIEW_NOTICE_ASCII,
        Keywords: `DANFSe; NFSe; ${LOCAL_PREVIEW_NOTICE_ASCII}`,
        Producer: 'Calculadora RTC (LocalDanfsePreviewEngine)',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Embed verbatim ASCII notice in uncompressed PDF stream comment for deterministic inspection
    doc.addContent(`% ${LOCAL_PREVIEW_NOTICE_ASCII}`);

    // Top local-preview warning banner
    const bannerY = doc.y;
    doc
      .rect(36, bannerY, doc.page.width - 72, 24)
      .fillAndStroke('#fef3c7', '#d97706');
    doc
      .fillColor('#92400e')
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(LOCAL_PREVIEW_NOTICE, 42, bannerY + 7, {
        width: doc.page.width - 84,
        align: 'center',
      });
    doc.y = bannerY + 30;

    // Document header
    doc
      .fillColor('#0f172a')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text('DANFSe — Documento Auxiliar da Nota Fiscal de Serviço Eletrônica');
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(stc === 0 ? '#166534' : '#b91c1c')
      .text(`Situação da Nota: ${situacaoLabel} (stc=${stc})`);
    doc.fillColor('#1e293b');

    drawSectionHeader(doc, 'IDENTIFICAÇÃO DA NFS-e');
    doc.text(`Número NFS-e: ${data.nNFSe}   |   Chave/Id: ${data.idNfse}`);
    doc.text(`Data/Hora Emissão: ${data.dhEmi}   |   Competência: ${data.dCompet}`);
    doc.text(`DPS: ${data.nDPS} (Série ${data.serie})   |   Local de Incidência: ${data.localIncid}`);

    drawSectionHeader(doc, 'PRESTADOR DE SERVIÇOS');
    doc.text(`Razão Social: ${data.emitNome}`);
    doc.text(`CNPJ/CPF: ${data.emitDoc}`);
    doc.text(`Endereço: ${data.emitEnd}`);

    drawSectionHeader(doc, 'TOMADOR DE SERVIÇOS');
    doc.text(`Nome/Razão Social: ${data.tomaNome}`);
    doc.text(`CNPJ/CPF: ${data.tomaDoc}`);
    doc.text(`Endereço: ${data.tomaEnd}`);

    drawSectionHeader(doc, 'DISCRIMINAÇÃO DO SERVIÇO');
    doc.text(`Código Tributação Nacional: ${data.cTribNac}   |   NBS: ${data.cNBS}`);
    doc.moveDown(0.2);
    doc.text(`Descrição: ${data.xDescServ}`);

    drawSectionHeader(doc, 'VALORES E TRIBUTAÇÃO');
    doc.text(
      `Valor do Serviço: R$ ${data.vServ}   |   Base de Cálculo: R$ ${data.vBC}   |   ISSQN: R$ ${data.vISSQN}   |   Valor Líquido: R$ ${data.vLiq}`,
    );

    if (data.ibsCbs) {
      drawSectionHeader(doc, 'REFORMA TRIBUTÁRIA (IBS / CBS)');
      doc.text(
        `Base IBS/CBS: R$ ${data.ibsCbs.vBC}   |   IBS UF: R$ ${data.ibsCbs.vIBSUF}   |   IBS Mun: R$ ${data.ibsCbs.vIBSMun}   |   IBS Total: R$ ${data.ibsCbs.vIBSTot}`,
      );
      doc.text(`CBS: R$ ${data.ibsCbs.vCBS}   |   Total da Nota (vTotNF): R$ ${data.ibsCbs.vTotNF}`);
    }

    if (canhoto) {
      doc.moveDown(1.2);
      const cutY = doc.y;
      doc
        .moveTo(36, cutY)
        .lineTo(doc.page.width - 36, cutY)
        .dash(4, { space: 3 })
        .stroke('#64748b')
        .undash();
      doc.moveDown(0.4);
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('#334155')
        .text(
          `CANHOTO DE RECEBIMENTO — NFS-e nº ${data.nNFSe} | Valor Líquido: R$ ${data.vLiq} | Prestador: ${data.emitNome}`,
        );
      doc
        .font('Helvetica')
        .fontSize(8)
        .text('Data de Recebimento: ____/____/________     Assinatura / Identificação: ____________________________________');
    }

    doc.end();
  });
}

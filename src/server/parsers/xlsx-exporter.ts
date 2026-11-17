import ExcelJS from 'exceljs';
import type {
  BaseCalculoUnificadaOutput,
  CalcRunSnapshot,
  CompareRegimesOutput,
  FundamentacaoLegal,
  MemoriaCalculoTributo,
  ObservabilidadeRocOutput,
  ObservabilidadeSimplesOutput,
} from '../../shared/types/fiscal.js';
import { sanitizeSpreadsheetCell } from './spreadsheet-parser.js';

function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return sanitizeSpreadsheetCell(String(value));
}

function addSanitizedRow(sheet: ExcelJS.Worksheet, values: unknown[]): void {
  sheet.addRow(values.map((v) => (typeof v === 'number' ? v : cellText(v))));
}

function isRocOutput(
  kind: CalcRunSnapshot['kind'],
  _output: CalcRunSnapshot['output'],
): _output is ObservabilidadeRocOutput {
  return kind === 'regime_regular';
}

function isSimplesOutput(
  kind: CalcRunSnapshot['kind'],
  _output: CalcRunSnapshot['output'],
): _output is ObservabilidadeSimplesOutput {
  return kind === 'simples_nacional';
}

function isCompareOutput(
  kind: CalcRunSnapshot['kind'],
  _output: CalcRunSnapshot['output'],
): _output is CompareRegimesOutput {
  return kind === 'comparativo';
}

function isBaseUnificadaOutput(
  kind: CalcRunSnapshot['kind'],
  _output: CalcRunSnapshot['output'],
): _output is BaseCalculoUnificadaOutput {
  return kind === 'base_unificada';
}

function appendMemoriaRows(
  sheet: ExcelJS.Worksheet,
  nObj: number | string,
  memoria: MemoriaCalculoTributo[],
  fundamentacoes: FundamentacaoLegal[],
): void {
  const rowCount = Math.max(memoria.length, fundamentacoes.length);
  for (let i = 0; i < rowCount; i++) {
    const m = memoria[i];
    const f = fundamentacoes[i];
    addSanitizedRow(sheet, [
      nObj,
      m?.tributo ?? '',
      m?.baseCalculo ?? '',
      m?.aliquotaNominal ?? '',
      m?.percentualReducao ?? '',
      m?.aliquotaEfetiva ?? '',
      m?.valorCalculado ?? '',
      m?.valorDiferimento ?? '',
      m?.valorDevido ?? '',
      m ? (m.memoriaTexto ?? m.expressaoAplicada ?? '') : '',
      f ? [f.codigo, f.dispositivo].filter(Boolean).join(' - ') : '',
      f?.descricao ?? '',
    ]);
  }
}

export async function exportAuditXlsx(snapshot: CalcRunSnapshot): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Copiloto Fiscal RTC';
  workbook.created = new Date();

  const resumoSheet = workbook.addWorksheet('Resumo');
  const itensSheet = workbook.addWorksheet('Itens');
  const memoriaSheet = workbook.addWorksheet('Memoria_Legal');

  // --- Sheet 1: Resumo ---
  addSanitizedRow(resumoSheet, ['Campo', 'Valor']);
  addSanitizedRow(resumoSheet, ['ID Execução', snapshot.id]);
  addSanitizedRow(resumoSheet, ['Tipo Cálculo', snapshot.kind]);
  addSanitizedRow(resumoSheet, ['Motor', snapshot.engineMode]);
  addSanitizedRow(resumoSheet, ['Data Fato Gerador', snapshot.dhFatoGerador]);
  addSanitizedRow(resumoSheet, ['Regime', snapshot.context.regime ?? '']);
  addSanitizedRow(resumoSheet, ['Tipo DF-e', snapshot.context.tipoDfe ?? '']);
  addSanitizedRow(resumoSheet, ['UF', snapshot.context.uf ?? '']);
  addSanitizedRow(resumoSheet, ['Município IBGE', snapshot.context.municipio ?? '']);
  addSanitizedRow(resumoSheet, ['Dados Simulados', snapshot.xWarningDadosSimulados ? 'Sim' : 'Não']);
  addSanitizedRow(resumoSheet, ['Criado em', snapshot.createdAt]);

  // --- Sheet 2 & 3 Headers ---
  addSanitizedRow(memoriaSheet, [
    'Item',
    'Tributo',
    'Base de Cálculo',
    'Alíquota Nominal',
    'Redução (%)',
    'Alíquota Efetiva',
    'Valor Calculado',
    'Diferimento',
    'Valor Devido',
    'Expressão / Memória',
    'Dispositivo Legal',
    'Descrição Legal',
  ]);

  if (isRocOutput(snapshot.kind, snapshot.output)) {
    const out = snapshot.output;
    addSanitizedRow(resumoSheet, ['Modo', out.modo]);
    addSanitizedRow(resumoSheet, ['Total IS', out.ISTot?.vIS ?? '0.00']);
    addSanitizedRow(resumoSheet, ['Base CBS/IBS', out.IBSCBSTot?.vBCIBSCBS ?? '0.00']);
    addSanitizedRow(resumoSheet, ['Total IBS UF', out.IBSCBSTot?.gIBS.gIBSUF.vIBSUF ?? '0.00']);
    addSanitizedRow(resumoSheet, ['Total IBS Mun', out.IBSCBSTot?.gIBS.gIBSMun.vIBSMun ?? '0.00']);
    addSanitizedRow(resumoSheet, ['Total IBS', out.IBSCBSTot?.gIBS.vIBS ?? '0.00']);
    addSanitizedRow(resumoSheet, ['Total CBS', out.IBSCBSTot?.gCBS.vCBS ?? '0.00']);
    for (const aviso of out.avisos) {
      addSanitizedRow(resumoSheet, ['Aviso', aviso]);
    }
    for (const err of out.errosGlobais) {
      addSanitizedRow(resumoSheet, ['Erro Global', `${err.code}: ${err.description ?? err.title ?? ''}`]);
    }

    addSanitizedRow(itensSheet, [
      'nObj',
      'Estado',
      'Descrição',
      'NCM',
      'NBS',
      'CST',
      'cClassTrib',
      'Base CBS/IBS',
      'vIS',
      'vIBSUF',
      'vIBSMun',
      'vIBS',
      'vCBS',
      'Erros',
    ]);

    for (const item of out.itens) {
      addSanitizedRow(itensSheet, [
        item.nObj,
        item.estadoItem,
        item.descricao ?? '',
        item.ncm ?? '',
        item.nbs ?? '',
        item.cst,
        item.cClassTrib,
        item.gIBSCBS?.vBC ?? '',
        item.gIS?.vIS ?? '0.00',
        item.gIBSCBS?.gIBSUF?.vIBSUF ?? '0.00',
        item.gIBSCBS?.gIBSMun?.vIBSMun ?? '0.00',
        item.gIBSCBS?.vIBS ?? '0.00',
        item.gIBSCBS?.gCBS?.vCBS ?? '0.00',
        item.erros.map((e) => `${e.code}${e.description ? `: ${e.description}` : ''}`).join(' | '),
      ]);
      appendMemoriaRows(memoriaSheet, item.nObj, item.memoriaCalculo, item.fundamentacoesLegais);
    }
  } else if (isSimplesOutput(snapshot.kind, snapshot.output)) {
    const out = snapshot.output;
    addSanitizedRow(resumoSheet, ['CRT', out.CRT]);
    addSanitizedRow(resumoSheet, ['Total Base', out.totais.vBC]);
    addSanitizedRow(resumoSheet, ['Total IBS SN', out.totais.vIBSSN]);
    addSanitizedRow(resumoSheet, ['Total CBS SN', out.totais.vCBSSN]);
    addSanitizedRow(resumoSheet, ['Total Geral', out.totais.totalGeral]);
    for (const aviso of out.avisos) {
      addSanitizedRow(resumoSheet, ['Aviso', aviso]);
    }

    addSanitizedRow(itensSheet, [
      'nObj',
      'Estado',
      'Descrição',
      'cAtivSN',
      'cClassTrib',
      'Modo Fator R',
      'vBC',
      'pIBSSN',
      'vIBSSN',
      'pCBSSN',
      'vCBSSN',
      'Total Item',
      'Erros',
    ]);

    for (const item of out.itens) {
      addSanitizedRow(itensSheet, [
        item.nObj,
        item.estadoItem,
        item.descricao ?? '',
        item.cAtivSN,
        item.cClassTrib,
        item.modoFatorR,
        item.vBC,
        item.pIBSSN ?? '',
        item.vIBSSN ?? '',
        item.pCBSSN ?? '',
        item.vCBSSN ?? '',
        item.totalItem,
        item.erros.map((e) => `${e.code}${e.description ? `: ${e.description}` : ''}`).join(' | '),
      ]);
      appendMemoriaRows(memoriaSheet, item.nObj, item.memoriaCalculo, item.fundamentacoesLegais);
    }
  } else if (isCompareOutput(snapshot.kind, snapshot.output)) {
    const out = snapshot.output;
    addSanitizedRow(resumoSheet, ['Elegível', out.elegivel ? 'Sim' : 'Não']);
    if (out.motivoInelegibilidade) {
      addSanitizedRow(resumoSheet, ['Motivo Inelegibilidade', out.motivoInelegibilidade]);
    }
    for (const aviso of out.avisos) {
      addSanitizedRow(resumoSheet, ['Aviso', aviso]);
    }

    addSanitizedRow(itensSheet, [
      'Cenário',
      'Título',
      'Total IS',
      'Total CBS',
      'Total IBS',
      'Total Tributos',
      'Crédito Adquirente',
      'Observações',
      'Erros',
    ]);

    for (const cen of out.cenarios) {
      addSanitizedRow(itensSheet, [
        cen.cenario,
        cen.titulo,
        cen.totalIS,
        cen.totalCBS,
        cen.totalIBS,
        cen.totalTributos,
        cen.apropriacaoCreditoAdquirente,
        cen.observacoes.join(' | '),
        cen.erros.map((e) => `${e.code}${e.description ? `: ${e.description}` : ''}`).join(' | '),
      ]);
    }
  } else if (isBaseUnificadaOutput(snapshot.kind, snapshot.output)) {
    const out = snapshot.output;
    addSanitizedRow(resumoSheet, ['Base Regime Regular', out.baseRG]);
    addSanitizedRow(resumoSheet, ['Base Imposto Seletivo', out.baseIS]);
    addSanitizedRow(resumoSheet, ['Base Simples Nacional', out.baseSN]);
    for (const aviso of out.avisos) {
      addSanitizedRow(resumoSheet, ['Aviso', aviso]);
    }

    addSanitizedRow(itensSheet, ['Base RG', 'Base IS', 'Base SN', 'Avisos']);
    addSanitizedRow(itensSheet, [out.baseRG, out.baseIS, out.baseSN, out.avisos.join(' | ')]);
  }

  const rawBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(rawBuffer);
}

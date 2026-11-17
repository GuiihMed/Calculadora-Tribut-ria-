import type { EstadoItem } from '../../shared/types/fiscal.js';

export interface ErrorCatalogEntry {
  codigo: string;
  titulo: string;
  descricao: string;
  categoria: 'REG' | 'CAL' | 'VAL' | 'VSN';
  campoDefault?: string | null;
  estadoDefault?: EstadoItem;
}

const CATALOG_ENTRIES: readonly ErrorCatalogEntry[] = [
  // === REG ===
  {
    codigo: 'REG-001',
    titulo: 'NCM e NBS informadas simultaneamente',
    descricao:
      'Apenas uma nomenclatura (NCM ou NBS) deve ser informada por item. A presença simultânea impede a classificação.',
    categoria: 'REG',
    campoDefault: null,
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-002',
    titulo: 'NCM não encontrada',
    descricao:
      'O código NCM informado não foi localizado na base de nomenclaturas vigente para a data do fato gerador.',
    categoria: 'REG',
    campoDefault: 'ncm',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-003',
    titulo: 'NBS não encontrada',
    descricao:
      'O código NBS informado não foi localizado na base de nomenclaturas vigente para a data do fato gerador.',
    categoria: 'REG',
    campoDefault: 'nbs',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-004',
    titulo: 'Situação tributária não encontrada',
    descricao:
      'A situação tributária (CST) informada não existe na base de dados para o tributo e data do fato gerador.',
    categoria: 'REG',
    campoDefault: 'cst',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-005',
    titulo: 'Classificação tributária não encontrada',
    descricao:
      'A classificação tributária informada não foi localizada na base vigente para a data do fato gerador.',
    categoria: 'REG',
    campoDefault: 'cClassTrib',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-006',
    titulo: 'Classificação tributária não vinculada à situação tributária',
    descricao:
      'A classificação tributária informada não está vinculada à situação tributária selecionada.',
    categoria: 'REG',
    campoDefault: 'cClassTrib',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-007',
    titulo: 'Erro de nomenclatura',
    descricao:
      'A nomenclatura informada apresenta inconsistência com as regras de classificação tributária vigentes.',
    categoria: 'REG',
    campoDefault: 'ncm',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-008',
    titulo: 'Tratamento de classificação não encontrado',
    descricao:
      'Não foi encontrado tratamento de classificação tributária para os parâmetros informados.',
    categoria: 'REG',
    campoDefault: 'cClassTrib',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-009',
    titulo: 'Grupo de tributação regular não informado',
    descricao:
      'O grupo de tributação regular é obrigatório para a situação tributária selecionada e não foi informado.',
    categoria: 'REG',
    campoDefault: 'tributacaoRegular',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-010',
    titulo: 'Incompatibilidade com suspensão',
    descricao:
      'A classificação tributária informada é incompatível com a situação de suspensão aplicada ao item.',
    categoria: 'REG',
    campoDefault: 'tributacaoRegular/cClassTrib',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-011',
    titulo: 'NCM não vinculada',
    descricao:
      'O código NCM informado não está vinculado a nenhuma classificação tributária vigente.',
    categoria: 'REG',
    campoDefault: 'ncm',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-012',
    titulo: 'NBS não vinculada',
    descricao:
      'O código NBS informado não está vinculado a nenhuma classificação tributária vigente.',
    categoria: 'REG',
    campoDefault: 'nbs',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-013',
    titulo: 'Dados do Imposto Seletivo não informados',
    descricao:
      'Os dados do Imposto Seletivo são obrigatórios para a classificação tributária selecionada e não foram informados.',
    categoria: 'REG',
    campoDefault: 'impostoSeletivo',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-014',
    titulo: 'Dados do Imposto Seletivo informados indevidamente',
    descricao:
      'Os dados do Imposto Seletivo foram informados, mas a classificação tributária selecionada não prevê incidência.',
    categoria: 'REG',
    campoDefault: 'impostoSeletivo',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-015',
    titulo: 'NCM completo não informado',
    descricao:
      'O código NCM deve ser informado com todos os dígitos (completo) para a operação solicitada.',
    categoria: 'REG',
    campoDefault: 'ncm',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-016',
    titulo: 'NBS completo não informado',
    descricao:
      'O código NBS deve ser informado com todos os dígitos (completo) para a operação solicitada.',
    categoria: 'REG',
    campoDefault: 'nbs',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-018',
    titulo: 'Município não pertencente à UF',
    descricao: 'O município informado não pertence à UF indicada na operação.',
    categoria: 'REG',
    campoDefault: null,
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-019',
    titulo: 'Município não encontrado',
    descricao: 'O código do município informado não foi localizado na base de dados.',
    categoria: 'REG',
    campoDefault: null,
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-020',
    titulo: 'UF não encontrada',
    descricao: 'A UF informada para a operação não foi encontrada na base de dados.',
    categoria: 'REG',
    campoDefault: null,
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-021',
    titulo: 'Data do fato gerador não informada',
    descricao: 'A data do fato gerador é obrigatória e não foi informada na requisição.',
    categoria: 'REG',
    campoDefault: null,
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-022',
    titulo: 'Grupo de tributação regular informado indevidamente',
    descricao:
      'O grupo de tributação regular foi informado, mas a situação tributária selecionada não o exige.',
    categoria: 'REG',
    campoDefault: 'tributacaoRegular',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-023',
    titulo: 'Erro genérico de validação',
    descricao: 'Erro de validação que não se enquadra em nenhuma categoria específica.',
    categoria: 'REG',
    campoDefault: null,
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-024',
    titulo: 'Campo inválido',
    descricao: 'O valor informado para o campo não é válido conforme as regras de negócio.',
    categoria: 'REG',
    campoDefault: null,
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-025',
    titulo: 'Base de cálculo não informada',
    descricao:
      'A base de cálculo de CBS e IBS é obrigatória quando o grupo do Imposto Seletivo não é informado.',
    categoria: 'REG',
    campoDefault: 'baseCalculo',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-026',
    titulo: 'Base de cálculo inconsistente',
    descricao:
      'A base de cálculo de CBS e IBS informada difere da soma da base de cálculo do Imposto Seletivo com o Imposto Seletivo informado.',
    categoria: 'REG',
    campoDefault: 'baseCalculo',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-027',
    titulo: 'Base de cálculo menor que a base de cálculo do Imposto Seletivo',
    descricao:
      'A base de cálculo de CBS e IBS informada é menor que a base de cálculo do Imposto Seletivo.',
    categoria: 'REG',
    campoDefault: 'baseCalculo',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-028',
    titulo: 'Tipo de documento fiscal não encontrado',
    descricao:
      'O tipo de documento fiscal (tpDoc) informado na operação não existe ou está fora de vigência na data do fato gerador.',
    categoria: 'REG',
    campoDefault: 'tpDoc',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-029',
    titulo: 'Classificação tributária não vinculada ao tipo de documento',
    descricao:
      'A classificação tributária informada não possui vínculo vigente com o tipo de documento fiscal (tpDoc) da operação.',
    categoria: 'REG',
    campoDefault: 'cClassTrib',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-030',
    titulo: 'Nomenclatura incompatível com o tipo de documento',
    descricao:
      'A nomenclatura informada (NCM ou NBS) não é aceita para a classificação tributária no tipo de documento fiscal (tpDoc) da operação.',
    categoria: 'REG',
    campoDefault: null,
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-031',
    titulo: 'Nomenclatura não permitida para o tipo de documento',
    descricao: 'O tipo de documento fiscal (tpDoc) da operação não admite o preenchimento de NCM ou NBS.',
    categoria: 'REG',
    campoDefault: null,
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-032',
    titulo: 'Imposto Seletivo não admitido pelo tipo de documento',
    descricao:
      'O NCM/NBS informado é tributado pelo Imposto Seletivo, mas o tipo de documento fiscal (tpDoc) da operação não admite Imposto Seletivo.',
    categoria: 'REG',
    campoDefault: 'impostoSeletivo',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-033',
    titulo: 'Nomenclatura obrigatória não informada',
    descricao:
      'A classificação tributária possui anexo com NCM e NBS aplicáveis e exige o preenchimento de um deles, completo, para o tipo de documento fiscal (tpDoc) da operação.',
    categoria: 'REG',
    campoDefault: null,
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-034',
    titulo: 'Base de cálculo inconsistente',
    descricao:
      'A base de cálculo declarada no item diverge da base calculada a partir dos componentes informados.',
    categoria: 'REG',
    campoDefault: 'baseCalculo',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-035',
    titulo: 'Alíquota do Imposto Seletivo não informada',
    descricao:
      'A NCM/NBS possui incidência do Imposto Seletivo, mas a alíquota ainda não foi definida em lei e não foi informada pelo usuário.',
    categoria: 'REG',
    campoDefault: 'aliquotasNominais/impostoSeletivo',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-036',
    titulo: 'Alíquotas nominais informadas indevidamente',
    descricao:
      'As alíquotas nominais não podem ser informadas para fato gerador anterior a 01/01/2027, pois a calculadora resolve as alíquotas vigentes.',
    categoria: 'REG',
    campoDefault: 'aliquotasNominais',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'REG-037',
    titulo: 'Alíquotas nominais não informadas',
    descricao:
      'As alíquotas nominais (cbs, ibsEstadual e ibsMunicipal) devem ser informadas para fato gerador a partir de 01/01/2027.',
    categoria: 'REG',
    campoDefault: 'aliquotasNominais',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },

  // === CAL ===
  {
    codigo: 'CAL-001',
    titulo: 'Alíquota não encontrada',
    descricao:
      'Não foi possível localizar a alíquota aplicável para os parâmetros tributários informados.',
    categoria: 'CAL',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },
  {
    codigo: 'CAL-002',
    titulo: 'Alíquota padrão não encontrada',
    descricao:
      'A alíquota padrão (de referência) não foi encontrada na base para o tributo e período informados.',
    categoria: 'CAL',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },
  {
    codigo: 'CAL-003',
    titulo: 'Alíquota de referência não encontrada',
    descricao:
      'A alíquota de referência necessária para o cálculo não está disponível na base de dados.',
    categoria: 'CAL',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },
  {
    codigo: 'CAL-004',
    titulo: 'Alíquota ad rem não encontrada',
    descricao:
      'A alíquota ad rem (valor fixo por unidade) não foi localizada para o produto e período informados.',
    categoria: 'CAL',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },
  {
    codigo: 'CAL-005',
    titulo: 'Alíquota negativa',
    descricao:
      'O cálculo resultou em uma alíquota negativa, o que indica inconsistência nos parâmetros tributários.',
    categoria: 'CAL',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },
  {
    codigo: 'CAL-006',
    titulo: 'Tipo de alíquota desconhecido',
    descricao: 'O tipo de alíquota retornado pela base de dados não é reconhecido pelo sistema.',
    categoria: 'CAL',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },
  {
    codigo: 'CAL-007',
    titulo: 'Classificação tributária em desenvolvimento',
    descricao:
      'A classificação tributária informada ainda não possui implementação completa no sistema.',
    categoria: 'CAL',
    campoDefault: 'cClassTrib',
    estadoDefault: 'NAO_IMPLEMENTADO',
  },
  {
    codigo: 'CAL-008',
    titulo: 'Erro no avaliador de expressão aritmética',
    descricao: 'Ocorreu um erro ao avaliar a expressão aritmética utilizada no cálculo do tributo.',
    categoria: 'CAL',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },
  {
    codigo: 'CAL-009',
    titulo: 'Tratamento tributário não encontrado',
    descricao:
      'O tratamento tributário aplicável não foi localizado para a combinação de parâmetros informada.',
    categoria: 'CAL',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },
  {
    codigo: 'CAL-010',
    titulo: 'Percentual de redução não encontrado',
    descricao:
      'O percentual de redução de alíquota previsto para a classificação não foi encontrado na base.',
    categoria: 'CAL',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },
  {
    codigo: 'CAL-011',
    titulo: 'Fundamentação não encontrada',
    descricao:
      'A fundamentação legal para a classificação tributária não foi localizada na base de dados.',
    categoria: 'CAL',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },
  {
    codigo: 'CAL-012',
    titulo: 'Tributo/situação tributária não encontrado',
    descricao:
      'A combinação de tributo e situação tributária informada não foi localizada na base.',
    categoria: 'CAL',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },
  {
    codigo: 'CAL-999',
    titulo: 'Erro interno do sistema',
    descricao:
      'Erro interno inesperado durante o processamento do cálculo. Contate o suporte se o problema persistir.',
    categoria: 'CAL',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },

  // === VAL ===
  {
    codigo: 'VAL-000',
    titulo: 'Erro de validação não categorizado',
    descricao: 'O tipo de validação aplicado não possui uma categoria específica.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-001',
    titulo: 'Campo obrigatório não informado',
    descricao: 'O campo marcado como obrigatório não foi preenchido na requisição.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-002',
    titulo: 'Campo obrigatório em branco',
    descricao: 'O campo não pode estar em branco ou conter apenas espaços.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-003',
    titulo: 'Lista ou campo não pode estar vazio',
    descricao: 'O campo ou lista informado não pode estar vazio.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-004',
    titulo: 'Tamanho fora do intervalo permitido',
    descricao: 'O valor informado não atende aos limites de tamanho mínimo e/ou máximo definidos.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-005',
    titulo: 'Valor abaixo do mínimo permitido',
    descricao: 'O valor informado é inferior ao mínimo aceito para o campo.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-006',
    titulo: 'Valor acima do máximo permitido',
    descricao: 'O valor informado é superior ao máximo aceito para o campo.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-007',
    titulo: 'Valor decimal abaixo do mínimo permitido',
    descricao: 'O valor decimal informado é inferior ao mínimo aceito para o campo.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-008',
    titulo: 'Valor decimal acima do máximo permitido',
    descricao: 'O valor decimal informado é superior ao máximo aceito para o campo.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-009',
    titulo: 'Formato inválido',
    descricao: 'O valor informado não atende ao padrão (formato) exigido para o campo.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-010',
    titulo: 'Quantidade de dígitos inválida',
    descricao:
      'O valor informado não possui a quantidade de dígitos inteiros e/ou decimais esperada.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-011',
    titulo: 'E-mail inválido',
    descricao: 'O endereço de e-mail informado não é válido.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-012',
    titulo: 'Valor deve ser positivo',
    descricao: 'O valor informado deve ser um número positivo (maior que zero).',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-013',
    titulo: 'Valor deve ser positivo ou zero',
    descricao: 'O valor informado deve ser um número positivo ou zero.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-014',
    titulo: 'Condição não atendida',
    descricao: 'A condição de validação (assert true) não foi atendida pelo valor informado.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VAL-015',
    titulo: 'Condição atendida indevidamente',
    descricao: 'A condição de validação (assert false) foi atendida quando não deveria.',
    categoria: 'VAL',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },

  // === VSN (Simples Nacional NT 2026.005 v1.00) ===
  {
    codigo: 'VSN-000',
    titulo: 'Erro de validação não categorizado',
    descricao: 'O tipo de validação aplicado não possui uma categoria específica.',
    categoria: 'VSN',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-001',
    titulo: 'Base de cálculo do Simples ausente',
    descricao: 'A base de cálculo do Simples Nacional é obrigatória e não foi informada.',
    categoria: 'VSN',
    campoDefault: 'baseCalculo',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-002',
    titulo: 'Base de cálculo do Simples inválida (negativa/não numérica)',
    descricao: 'A base de cálculo informada não é um número decimal válido ou é negativa.',
    categoria: 'VSN',
    campoDefault: 'baseCalculo',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-003',
    titulo: 'Valor do Imposto Seletivo inválido (negativo/não numérico)',
    descricao:
      'O valor do Imposto Seletivo (vIS) informado não é um número decimal válido ou é negativo.',
    categoria: 'VSN',
    campoDefault: 'valorImpostoSeletivo',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-004',
    titulo: 'Alíquota pCBSSN ausente',
    descricao:
      'A alíquota efetiva de CBS do Simples Nacional (pCBSSN) é exigida para o cálculo do item e não foi informada.',
    categoria: 'VSN',
    campoDefault: 'pCBSSN',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-005',
    titulo: 'Alíquota pCBSSN inválida (negativa/não numérica)',
    descricao:
      'A alíquota efetiva de CBS do Simples Nacional (pCBSSN) informada não é um número decimal válido ou é negativa.',
    categoria: 'VSN',
    campoDefault: 'pCBSSN',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-006',
    titulo: 'Alíquota pIBSSN ausente',
    descricao:
      'A alíquota efetiva de IBS do Simples Nacional (pIBSSN) é exigida para o cálculo do item e não foi informada.',
    categoria: 'VSN',
    campoDefault: 'pIBSSN',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-007',
    titulo: 'Alíquota pIBSSN inválida (negativa/não numérica)',
    descricao:
      'A alíquota efetiva de IBS do Simples Nacional (pIBSSN) informada não é um número decimal válido ou é negativa.',
    categoria: 'VSN',
    campoDefault: 'pIBSSN',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-010',
    titulo: 'Número do item ausente',
    descricao: 'O número (identificador) do item é obrigatório e não foi informado.',
    categoria: 'VSN',
    campoDefault: 'nObj',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-011',
    titulo: 'Lista de itens vazia',
    descricao: 'A lista de itens da operação é obrigatória e não pode estar vazia.',
    categoria: 'VSN',
    campoDefault: 'itens',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-012',
    titulo: 'Data do fato gerador ausente/inválida',
    descricao: 'A data do fato gerador é obrigatória e deve estar no formato de data (YYYY-MM-DD).',
    categoria: 'VSN',
    campoDefault: 'dhFatoGerador',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-013',
    titulo: 'Dado global obrigatório ausente',
    descricao: 'Um campo global obrigatório da operação (id ou versao) não foi informado.',
    categoria: 'VSN',
    campoDefault: null,
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-014',
    titulo: 'Tipo de documento fiscal (tpDoc) ausente',
    descricao: 'O tipo de documento fiscal (tpDoc) é obrigatório e não foi informado.',
    categoria: 'VSN',
    campoDefault: 'tpDoc',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-015',
    titulo: 'Tipo de documento fiscal (tpDoc) não suportado',
    descricao:
      'O tipo de documento fiscal (tpDoc) informado não está habilitado para o cálculo do Simples Nacional na data do fato gerador. A habilitação de documentos é parametrizada em banco de dados (tabela de tipos de DFe do cálculo do Simples), conforme as NTs publicadas.',
    categoria: 'VSN',
    campoDefault: 'tpDoc',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-016',
    titulo: 'Código de Regime Tributário (CRT) ausente/inválido',
    descricao: 'O Código de Regime Tributário (CRT) é obrigatório e deve ser 1, 2, 3 ou 4.',
    categoria: 'VSN',
    campoDefault: 'CRT',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-017',
    titulo: 'Tipo de regime do IBS/CBS (tpRegimeIBSCBS) inválido',
    descricao: 'O tipo de regime de apuração do IBS/CBS (tpRegimeIBSCBS), quando informado, deve ser 1 ou 2.',
    categoria: 'VSN',
    campoDefault: 'tpRegimeIBSCBS',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-018',
    titulo: 'tpRegimeIBSCBS incompatível com o CRT',
    descricao:
      'A combinação de CRT e tpRegimeIBSCBS informada é incoerente (regras C21a-10/20/30 da NT 2026.005): CRT 1, 2 ou 4 não admite tpRegimeIBSCBS=2; CRT 3 não admite tpRegimeIBSCBS=1; CRT 4 não admite tpRegimeIBSCBS algum.',
    categoria: 'VSN',
    campoDefault: 'tpRegimeIBSCBS',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-019',
    titulo: 'Operação fora do escopo do cálculo assistido do Simples Nacional',
    descricao:
      'A operação não é calculada por este endpoint: optante pelo regime regular do IBS/CBS (tpRegimeIBSCBS=1), MEI (CRT=4) ou regime normal puro (CRT=3 sem tpRegimeIBSCBS=2).',
    categoria: 'VSN',
    campoDefault: null,
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-020',
    titulo: 'Código de Classificação Tributária (cClassTrib) ausente',
    descricao: 'O código de classificação tributária do IBS/CBS (cClassTrib) é obrigatório e não foi informado.',
    categoria: 'VSN',
    campoDefault: 'cClassTrib',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-021',
    titulo: 'cClassTrib desconhecido ou fora de vigência',
    descricao:
      'O cClassTrib informado não existe ou não está vigente na data do fato gerador: o Tipo de Receita Bruta do Simples Nacional (tpRBSN) não pôde ser determinado.',
    categoria: 'VSN',
    campoDefault: 'cClassTrib',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-022',
    titulo: 'cClassTrib incompatível com o tpDoc',
    descricao: 'O cClassTrib informado não é admissível para o tipo de documento fiscal (tpDoc) da operação.',
    categoria: 'VSN',
    campoDefault: 'cClassTrib',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-023',
    titulo: 'Código de Atividade do Simples Nacional incompatível com cClassTrib',
    descricao:
      "O código de atividade cAtivSN='90' (Operações não Tributáveis) é incompatível com cClassTrib cujo tpRBSN esteja entre 1 e 5 (regra UB14-90 da NT 2026.005).",
    categoria: 'VSN',
    campoDefault: 'cAtivSN',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-024',
    titulo: 'Tipo de ente governamental (tpEnteGov) inválido',
    descricao:
      'O tipo de ente governamental (tpEnteGov), quando informado, deve ser 1 (União), 2 (Estado), 3 (Distrito Federal) ou 4 (Município). O campo é da operação e sua invalidade rejeita a operação inteira.',
    categoria: 'VSN',
    campoDefault: 'tpEnteGov',
    estadoDefault: 'INCONSISTENCIA_ENTRADA',
  },
  {
    codigo: 'VSN-025',
    titulo: 'Parametrização de compra governamental indisponível para a data',
    descricao:
      'A data do fato gerador está fora de todas as vigências do parâmetro de transição de alíquotas de compra governamental do Simples Nacional (NT 2026.005, seção 5.3.3; arts. 372 e 473 da LC 214/2025).',
    categoria: 'VSN',
    campoDefault: 'dhFatoGerador',
    estadoDefault: 'FALHA_TECNICA',
  },
  {
    codigo: 'VSN-026',
    titulo: 'Parametrização do cálculo do Simples Nacional indisponível para a data',
    descricao:
      'Não há linha vigente, na data do fato gerador, em uma tabela de parametrização do cálculo do Simples Nacional (efeito do tipo de receita bruta ou matriz de regime de apuração).',
    categoria: 'VSN',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },
  {
    codigo: 'VSN-027',
    titulo: 'cClassTrib sem tratamento implementado no cálculo do Simples Nacional',
    descricao:
      'A classificação tributária (cClassTrib) informada está vinculada, na data do fato gerador, a tratamento tributário marcado como ainda não implementado na Calculadora.',
    categoria: 'VSN',
    campoDefault: 'cClassTrib',
    estadoDefault: 'NAO_IMPLEMENTADO',
  },
  {
    codigo: 'VSN-999',
    titulo: 'Falha técnica no cálculo do item',
    descricao: 'Ocorreu uma falha técnica inesperada durante o cálculo do item.',
    categoria: 'VSN',
    campoDefault: null,
    estadoDefault: 'FALHA_TECNICA',
  },
];

const ERROR_CATALOG_MAP = new Map<string, ErrorCatalogEntry>(
  CATALOG_ENTRIES.map((entry) => [entry.codigo, entry]),
);

/**
 * Looks up an official error code (`REG-*`, `CAL-*`, `VAL-*`, or `VSN-*`).
 */
export function lookupErrorDescription(codigo: string): ErrorCatalogEntry | null {
  if (typeof codigo !== 'string') {
    return null;
  }
  const normalized = codigo.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  return ERROR_CATALOG_MAP.get(normalized) ?? null;
}

/**
 * Lists all catalog entries, optionally filtered by category prefix.
 */
export function listErrorCatalog(
  categoria?: ErrorCatalogEntry['categoria'],
): readonly ErrorCatalogEntry[] {
  if (!categoria) {
    return CATALOG_ENTRIES;
  }
  return CATALOG_ENTRIES.filter((entry) => entry.categoria === categoria);
}

# Design Document — Copiloto Fiscal & Calculadora da Reforma Tributária (LC 214/2025)

**Data:** 2026-11-17  
**Status:** Pronto para aprovação do usuário (revisado via builder-check)  
**Escopo:** Projeto completo (Frontend Web + BFF Seguro Node/TypeScript + Bootstrap SQLite Oficial RFB + Motor Dual-Engine + Pipeline Multimodal Gemini)

---

## 1. Intenção e Propósito ("Why")

Construir uma **Calculadora e Copiloto Fiscal da Reforma Tributária sobre o Consumo (LC 214/2025 e NT 2026.005)** que combina:
- **Interface conversacional multimodal com Gemini** (chat que aceita linguagem natural, planilhas `.xlsx`/`.csv`, XMLs de NF-e/NFC-e/NFS-e, PDFs e imagens de notas/faturas), e
- **Motor determinístico rigorosamente aterrado nos 3 repositórios oficiais da Receita Federal (Release 15 — Outubro/2026)**:
  1. `ReceitaFederal/calculadora-rtc-regime-regular` (CBS, IBS, Imposto Seletivo, Base Unificada NF-e/NFC-e/NFS-e, Dados Abertos, Geração/Validação de XML)
  2. `ReceitaFederal/calculadora-rtc-simples-nacional` (Simples Nacional, Excesso de Sublimite `CRT=2`, NT 2026.005 v1.00, `ModoFatorR`)
  3. `ReceitaFederal/calculadora-rtc-gerador-danfse` (Geração de PDF DANFSe a partir de XML de NFS-e via serviço Go HTTP ou WebAssembly)

O projeto concretiza exatamente a diretriz prevista no roadmap oficial da Receita Federal: **a IA generativa atua exclusivamente na interpretação documental, extração estruturada, auxílio ao enquadramento e explicação contábil dos resultados — sem nunca substituir ou alterar o caráter determinístico do cálculo tributário**.

---

## 2. Objetivos, Não-Objetivos e Anti-Objetivos

### 2.1 Objetivos (Goals)
1. **Zero Alucinação nos Números e Regras:** toda alíquota, redução percentual, base de cálculo, `vIS`, `vIBS`, `vCBS`, indicador de crédito (`CLASSIFICACAO_TRIBUTARIA`), código de erro (`REG-*` / `VSN-*`), regra de Fator R (`ModoFatorR`) e fundamentação legal provém exclusivamente do banco SQLite oficial da Receita e do motor determinístico.
2. **Ingestão Multimodal com Revisão Humana (Human-in-the-Loop):** aceitar `.xlsx`, `.csv`, `.xml` (NF-e/NFC-e/NFS-e), `.pdf` e imagens (`png`/`jpg`/`webp`), extrair itens e parâmetros em uma **Prévia Editável (Staging)** com indicador de confiança por campo antes de efetivar o cálculo final.
3. **Execução Imediata em Node 24 + Conector Plugável Oficial por Capacidade (Dual-Engine):**
   - Rodar imediatamente no ambiente local atual (`Node.js v24.14.0` + `sqlite3`, sem Java/Go/Docker) por meio de um motor determinístico em TypeScript + `decimal.js` conectado ao SQLite oficial gerado a partir das migrações SQL (`flyway/`) do repositório da Receita.
   - Rotear **por capacidade** (`regimeRegular`, `simplesNacional`, `danfse`) via variáveis de ambiente (`RTC_REGIME_REGULAR_URL`, `RTC_SIMPLES_URL`, `DANFSE_SERVICE_URL` ou `DANFSE_WASM_PATH` + `DANFSE_WASM_EXEC_JS_PATH`) para os serviços oficiais Java/Go quando configurados, com comportamento *fail-closed* explícito.
4. **Visão Contábil Completa (Contador Especializado):**
   - Simulador comparativo lado a lado para operações `>= 2027-01-01`: **Regime Regular** × **Simples Nacional (`CRT=1`)** × **Simples Híbrido / Optante pelo Regime Regular (`tpRegimeIBSCBS=1`)** (e opção de incluir **Excesso de Sublimite `CRT=2`**).
   - Validador de **Base de Cálculo Unificada** com vigências anuais (2026, 2027–2032, 2033+: extinção de PIS/COFINS em 2027, extinção de ICMS/ISS em 2033).
   - Consulta e tradução prática dos **indicadores de crédito oficiais** do banco `CLASSIFICACAO_TRIBUTARIA` (`CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_*`, `CLTR_IN_CREDITO_PRESUMIDO_*`, `CLTR_CREDITO_OPERACAO_ANTECEDENTE`) e orientação informativa (não especulativa) sobre **Split Payment** derivada de `vCBS` e `vIBS`.
   - **Memória de cálculo auditável** e exportação de planilha `.xlsx` auditada, XML dos grupos tributários e DANFSe.
5. **Segurança e Privacidade em Profundidade:** proteção de `GEMINI_API_KEY` no BFF, **`store: false` obrigatório** na Interactions API do Gemini (histórico reconstruído via turn-replay no BFF sem retenção na nuvem), mascaramento local de CPF/CNPJ/chaves em planilhas/XMLs antes do Gemini, envio multimodal direto de PDF/imagem apenas sob `store: false`, defesa contra XXE, zip-bomb, CSV/Formula Injection, Prompt Injection indireto, zero-PII em logs, CORS explícito, CSP e rate limiting.

### 2.2 Não-Objetivos (Non-Goals)
- **Não** substitui os autorizadores oficiais de DF-e (SEFAZ / Plataforma Nacional NFS-e) nem o PGDAS-D para apuração oficial do RBT12 e cálculo de alíquotas efetivas do Simples Nacional.
- **Não** inclui tabelas inventadas/extraoficiais de alíquotas de 1ª faixa dos Anexos I–V (o catálogo da Release 15 aposentou `VSN-008`/`VSN-009` e exige `pIBSSN`/`pCBSSN` explícitos).
- **Não** cria fórmulas extraoficiais de retenção de Split Payment (exibe apenas orientação qualitativa baseada nos tributos calculados).
- **Não** gera XML do evento `tpEvento 412140` do Simples Nacional (não presente em `calculadora-rtc-simples-nacional`).
- **Não** implementa autenticação multi-usuário/RBAC nesta v1 (uso em workspace local single-tenant).
- **Não** integra o Receita Integra via certificado mTLS (previsto apenas para Release 16).
- **Não** inventa ou aproxima cálculos para `cClassTrib` com `TRTR_IN_POSSUI_AJUSTE = 1` ainda não implementados pela Receita (deve reportar `NAO_IMPLEMENTADO` / `VSN-027` fielmente).
- **Não** embute binários Java/Go no repositório; os repositórios oficiais permanecem conectores externos opcionais.

### 2.3 Anti-Objetivos (Critérios de Falha)
- Gemini gerar valores monetários, alíquotas efetivas ou fundamentações legais de memória sem retorno verificado de ferramenta determinística.
- Gemini Interactions API operar com `store: true` (retendo prompts ou documentos fiscais na API).
- Usar aritmética binária IEEE-754 (`number` do JS) para cálculo tributário em vez de aritmética decimal exata com `HALF_EVEN` (8 casas internas).
- Um único item inválido em uma planilha/XML de 100 itens abortar toda a operação (deve operar em modo observabilidade por item).
- Fallback silencioso entre motor oficial configurado e motor local TS em caso de erro de rede/timeout.
- Gravar CNPJ, CPF, XML completo, conteúdo de notas ou prompts fiscais em logs de servidor.
- Expor `GEMINI_API_KEY` no bundle do navegador ou permitir que arquivos enviados executem entidades XML (`DOCTYPE`), fórmulas em planilhas exportadas ou ações de sistema pelo LLM.

---

## 3. Restrições e Contexto Técnico Verificado

- **Ambiente local atual:** Node.js `v24.14.0`, `npm`, `sqlite3`, `python3`. Sem Java 21, Go 1.27 ou Docker instalados.
- **Fonte oficial de dados tributários:**
  - `calculadora-rtc-regime-regular/flyway/sql/criacao/beforeMigrate.sql`, `B0001__sistema_tributario_completo.sql`, `flyway/sql/manutencao/V0002..V0059*.sql`, `afterMigrate.sql`.
  - Schema puro SQLite (sem placeholders `${...}`), usando `PRAGMA journal_mode = DELETE` e `PRAGMA foreign_keys = ON` após o `B0001` para permitir abertura `mode=ro` sem arquivos `-wal/-shm`.
  - **Vigências observadas no banco oficial:**
    - `ALIQUOTA_REFERENCIA` / `ALIQUOTA_AD_VALOREM` / `ALIQUOTA_AD_REM` de CBS/IBS têm vigência até `2026-12-31` (`V0053`), exigindo `aliquotasNominais` explícitas a partir de `2027-01-01`.
    - Tabelas do Simples Nacional (`REGIME_APURACAO_SIMPLES_NACIONAL`, `TRANSICAO_ALIQUOTA_COMPRA_GOV_SIMPLES_NACIONAL`, etc. em `V0049`/`V0050`) iniciam vigência em `2027-01-01`, sem tabela de alíquota de 1ª faixa por Anexo (`VSN-008`/`VSN-009` aposentados em `CodigoValidacaoSimples.java`).
    - Indicadores de crédito residem em `CLASSIFICACAO_TRIBUTARIA`: `CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_CBS`, `CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_IBS`, `CLTR_IN_CREDITO_PRESUMIDO_FORNECEDOR`, `CLTR_IN_CREDITO_PRESUMIDO_ADQUIRENTE`, `CLTR_CREDITO_OPERACAO_ANTECEDENTE` (`'Manutenção'` | `'Anulação'`).
- **Precisão Numérica Oficial (`ArredondamentoUtils.java`, art. 349 § 14 da LC 214/2025):**
  - Precisão intermediária: **8 casas decimais** com modo **`HALF_EVEN`** (arredondamento bancário).
  - Escalas de apresentação (aplicadas apenas na saída/formatação): Moeda `2` casas; Alíquotas/percentuais `2` a `4` casas; Quantidades `4` casas.
- **Gemini SDK e Modelo:**
  - SDK obrigatório: `@google/genai` (`>= 3.2.0`) usando a **Interactions API** (`client.interactions.create(...)` com `store: false`, streaming SSE e function calling stateless).
  - Modelo padrão: `gemini-4-hydrogen` (1M tokens, suporte multimodal nativo para imagens e documentos PDF + tool calling). Nunca usar modelos legados (`gemini-1.5-*`, `2.0-*`, `2.5-*`).

---

## 4. Abordagens Avaliadas e Escolha Arquitetural

| Abordagem | Descrição | Tradeoffs | Decisão |
|---|---|---|---|
| **1. Proxy Puro (BFF + APIs Java/Go)** | O Node apenas conecta o Gemini às APIs Java (`8080`, `8082`) e Go (`8080`). | Fidelidade total aos binários RFB, porém **impossível rodar localmente** hoje sem instalar Java 21, Go 1.27 e Docker. | Descartada como única via |
| **2. 100% Standalone Node/TS + SQLite** | Motor todo reescrito em TypeScript usando o SQLite oficial. | Roda de imediato em Node 24, porém perde conexão automática caso os serviços oficiais Java/Go sejam ativados em servidor/Docker (e não gera PDF DANFSe idêntico ao Go/WASM). | Incorporada como modo local |
| **3. Dual-Engine Determinístico por Capacidade (`FiscalEnginePort`) + Copiloto Gemini Blindado (`store: false`)** | Cada capacidade (`regimeRegular`, `simplesNacional`, `danfse`) roteia independentemente entre **LocalTsEngine** (imediato em Node 24 sobre o SQLite oficial) e **RemoteOfficialEngine** (serviços Java/Go/WASM por `.env`), sem fallback silencioso, acoplado ao pipeline stateless `store: false` do Gemini. | Combina execução imediata zero-setup com caminho direto para paridade binária oficial em produção; exige suíte de testes de paridade contra os fixtures/exemplos dos repositórios da Receita. | **ESCOLHIDA** |

---

## 5. Arquitetura do Sistema

### 5.1 Topologia (Monorepo Unificado Local)

```text
[ Browser (React + Vite + TS) ]
   │  UI Split-View: Chat Copiloto (SSE) + Mesa Fiscal Determinística
   │  (Sem API keys, sem lógica de imposto no client, CSP estrita)
   ▼  HTTPS / HTTP Local (Same-Origin em prod; CORS explícito em dev)
[ BFF & Orquestrador (Node 24 + Fastify + TypeScript) ]
   ├── Security Middleware (CORS sem '*', Rate Limit, Zero-PII Logger, Headers)
   ├── File Ingestion Pipeline (<= 5 MiB, Magic Bytes, Anti-XXE, Anti-Formula Inj., Masking PII)
   ├── Gemini Orchestrator (@google/genai -> gemini-4-hydrogen, store: false, Stateless Turn-Replay)
   ├── FiscalEngineRouter (roteamento por capacidade, fail-closed c/ botão manual p/ local)
   │     ├── LocalTsEngine (decimal.js HALF_EVEN 8d, AST Evaluator, NT 2026.005, Prévia DANFSe)
   │     └── RemoteOfficialEngine (Java Regime Regular / Java Simples / Go HTTP ou WASM DANFSe)
   ├── data/rtc-oficial.db   (SQLite READ-ONLY mode=ro, compilado do flyway/ RFB)
   └── data/workspace.db     (SQLite READ-WRITE: sessões, turns/tool-traces, calc_runs, drafts)
```

**Decisões explícitas de engenharia (our calls):**
- **Stack:** Node.js 24 + TypeScript + **Fastify** no BFF + **React + Vite + TypeScript** no frontend (em produção, Fastify serve o build estático na mesma origem).
- **Roteamento por capacidade (`FiscalEngineRouter`) [Decisão do Revisor #5]:** cada uma das 3 capacidades (`regimeRegular`, `simplesNacional`, `danfse`) lê sua configuração própria de `.env`:
  - `RTC_REGIME_REGULAR_URL` → se ausente, usa `LocalTsEngine`; se presente, usa serviço Java oficial.
  - `RTC_SIMPLES_URL` → se ausente, usa `LocalTsEngine`; se presente, usa serviço Java oficial.
  - `DANFSE_SERVICE_URL` ou par (`DANFSE_WASM_PATH` + `DANFSE_WASM_EXEC_JS_PATH`) → se ausentes, usa `LocalDanfsePreviewEngine`; se configurados, usa serviço Go HTTP ou runtime WASM (`wasm_exec.js`).
  - **Política Fail-Closed:** se um provedor remoto configurado falhar ou der timeout, o BFF **não** faz fallback silencioso. Retorna erro explícito informando a indisponibilidade do serviço oficial configurado e oferece na UI a ação manual `Reprocessar no Motor Local TS` (registrando no `calc_runs` o motor utilizado).

---

### 5.2 Pipeline de Dados Oficiais (`rtc-oficial.db`)

1. Os scripts SQL oficiais (`calculadora-rtc-regime-regular/flyway/sql/criacao/beforeMigrate.sql`, `B0001__sistema_tributario_completo.sql`, `manutencao/V0002..V0059`, `criacao/afterMigrate.sql`) são versionados localmente em `db/rfb-migrations/` (com atribuição de licença MIT/RFB e manifesto SHA-256) ou referenciados pelo bootstrap `npm run db:bootstrap`.
2. O script executa `beforeMigrate.sql` → `B0001` → `V0002..V0059` em ordem numérica → `afterMigrate.sql` e executa `PRAGMA integrity_check` e `PRAGMA foreign_key_check`.
3. Em runtime, o BFF abre `data/rtc-oficial.db` estritamente em **modo somente leitura (`mode=ro`)**.

---

### 5.3 Motor Fiscal Determinístico (`FiscalEnginePort`)

#### A. Operações Suportadas no Contrato Unificado
1. **`calculateRegimeRegular(operacao, modo: 'observabilidade' | 'estrito')`**
   - Implementa a pipeline de `ProcessamentoItemService` + `CalculoTributoService` + `CalculoImpostoSeletivoService` + `CalculoCbsIbsService`:
     - Valida vigência da data (`dhFatoGerador`): antes de `2027-01-01` proíbe `aliquotasNominais` manuais (usa alíquotas de referência 2026 do SQLite); a partir de `2027-01-01` exige `aliquotasNominais` e marca `CALCULO_SIMULADO` + flag `xWarningDadosSimulados`.
     - Verifica compatibilidade NCM/NBS × `cClassTrib` (`REG-011` quando não vinculada) e `tipoDfe` (`55`, `65`, NFS-e, etc.).
     - Se `TRTR_IN_POSSUI_AJUSTE = 1`, retorna `NAO_IMPLEMENTADO` sem calcular.
     - Calcula Imposto Seletivo primeiro (quando aplicável) para compor a base do CBS/IBS (`BC IS + IS calculado`).
     - Avalia expressões de `TRATAMENTO_TRIBUTARIO` (`expressaoAliquota`, `expressaoBaseCalculo`, `expressaoAliquotaEfetiva`, `expressaoTributoCalculado`, `expressaoTributoDevido`, `expressaoPercentualDiferimento`, `expressaoValorDiferimento`) com **Avaliador AST Seguro** (tokenizador + parser recursivo descendente aceitando apenas `+`, `-`, `*`, `/`, `( )`, literais numéricos decimais e a lista branca dos 21 nomes de `VariavelExpressao.java` — **proibido `eval`/`Function`**).
     - **Enriquecimento de Créditos (`rtc-oficial.db`) [Decisão do Revisor #3]:** consulta `CLASSIFICACAO_TRIBUTARIA` por `cClassTrib` + data e anexa deterministicamente os campos oficiais de crédito (`apropriacaoCreditoCbs`, `apropriacaoCreditoIbs`, `creditoPresumidoFornecedor`, `creditoPresumidoAdquirente`, `creditoOperacaoAntecedente`: `'Manutenção' | 'Anulação'`), além das fundamentações legais e `memoriaCalculo`.
     - **Split Payment [Decisão do Revisor #3]:** como nenhum dos 3 repositórios RFB possui fórmula/alíquota de retenção de Split Payment, o campo retornado traz exclusivamente **orientação qualitativa derivada** dos valores calculados (`vCBS` + `vIBS` sujeitos à liquidação apartada na regulamentação da LC 214/2025), sem inventar percentuais ou fluxos financeiros fictícios.
2. **`calculateBaseUnificadaNfe(input)` & `calculateBaseUnificadaNfse(input)`**
   - Implementa `BaseCalculoUnificadaService` (`tpDoc` `55`/`65`, `bem`/`servico`, retornando `baseRG`, `baseIS`, `baseSN` e `avisos` por vigência anual: PIS/COFINS extintos em `2027`, ICMS/ISS extintos em `2033`) e `BaseCalculoUnificadaNfseService` (regras MEI `E1302`/`E0436`, ajustes de documento, `E1534`, locação).
3. **`calculateSimplesNacional(operacao)`**
   - Implementa a NT 2026.005 v1.00 (`SimplesNacionalCalculoService` + `SimplesNacionalObservabilidadeService`):
     - Valida escopo global (`tpDoc`, `CRT`, `tpRegimeIBSCBS`, `tpEnteGov`) e resolve matriz `REGIME_APURACAO_SIMPLES_NACIONAL` e `TIPO_RECEITA_BRUTA_SIMPLES_NACIONAL` vigentes na data (`>= 2027-01-01`).
     - Trata `TRTR_IN_POSSUI_AJUSTE = 1` com `VSN-027` (`NAO_IMPLEMENTADO`).
     - Exige `pCBSSN` / `pIBSSN` explícitos quando `TRBS_IN_EXIGE_ALIQUOTA = 1` e o regime gera o tributo (`VSN-004`/`VSN-006`).
     - Aplica pipeline de compra governamental (`tpEnteGov = 1` União → `pCBS' = pCBS + pIBS, pIBS' = 0`; `tpEnteGov ∈ {2,3,4}` → fator da tabela `TRANSICAO_ALIQUOTA_COMPRA_GOV_SIMPLES_NACIONAL`).
     - Suporta consulta de atividades vigentes por data/anexo/documento/`cClassTrib` e derivação explícita de `ModoFatorR` (`NAO_APLICAVEL`, `OPCIONAL`, `OBRIGATORIO`, `INDISPONIVEL`).
     - Inclui **Calculadora Auxiliar de Fator R** (`Folha Salarial 12m ÷ RBT12 >= 0,28` → indicação de enquadramento Anexo III vs. Anexo V e código `cAtivSN` sugerido), explicitamente marcada como *auxílio de enquadramento (não calcula RBT12/alíquotas do PGDAS-D)*.
4. **`compareRegimes(inputComparativo)` [Decisão do Revisor #1]**
   - **Vigência:** compara operações para `dhFatoGerador >= 2027-01-01` (quando ambas as parametrizações — Regime Regular com alíquotas nominais e Simples Nacional da NT 2026.005 — coexistem no banco oficial; se a data selecionada for `< 2027-01-01`, informa claramente que as tabelas do Simples Nacional iniciam em `2027-01-01`).
   - **Entradas explícitas (sem alíquota alucinada):** a cesta unificada recebe por item `ncm`/`nbs`, `cst`, `cClassTrib`, `baseCalculo` (sem `vIS`), opcional `impostoSeletivo`, `cAtivSN`, `aliquotasNominais` (CBS/IBS UF/IBS Mun para Regime Regular) e `pIBSSN`/`pCBSSN` (alíquotas efetivas informadas pelo usuário/PGDAS-D para Simples Nacional).
   - **Ponte de Base de Cálculo:** para Regime Regular e Simples Híbrido, quando há Imposto Seletivo informado/calculado, o adaptador compõe a base de CBS/IBS como `baseCalculo + vIS`; para o motor Simples Nacional, repassa `baseCalculo` sem `vIS` e `valorImpostoSeletivo` separadamente (`TRBS_IN_IS_COMPOE_RECEITA = 0` em `V0050`).
   - **Cenários comparados lado a lado:**
     1. **Regime Regular** (CBS + IBS + IS pelo motor Regime Regular + indicadores de crédito B2B).
     2. **Simples Nacional (`CRT=1`)** (pelo motor Simples Nacional com `pIBSSN` e `pCBSSN` informados).
     3. **Simples Híbrido / Optante pelo Regime Regular (`tpRegimeIBSCBS=1`)** (CBS + IBS + IS calculados pelo motor Regime Regular com apropriação integral de crédito pelo adquirente — regra `VSN-019` respeitada).
     4. *(Opcional quando aplicável)* **Excesso de Sublimite (`CRT=2`)**: composição explícita de CBS pelo motor Simples (`RASN_IN_GERA_IBS = 0`) + IBS pelo motor Regime Regular, rotulada como cenários combinados por tributo.
5. **`lookupDadosAbertos(...)`**
   - Consultas indexadas a CST, `cClassTrib`, NCM, NBS, compatibilidade NCM/NBS × `cClassTrib`, fundamentação legal, UF/Município IBGE, alíquotas 2026, atividades Simples Nacional (`ModoFatorR`), glossário de códigos de erro `REG-*` e `VSN-*`.
6. **`generateTaxXml(calcRunId, tipo, incluirApenasValidos)` & `validateXml(xml, tipo, subtipo)` [Decisão do Revisor #4]**
   - **Apenas Regime Regular / Híbrido:** para `ObservabilidadeROCDomain` com itens mistos, filtra apenas os itens `CALCULADO`/`CALCULO_SIMULADO` para montar um `ROCDomain` válido antes de serializar o XML (`InfNFe`/`det`/`imposto`/`IBSCBS`/`IS`/`total`), retornando a lista explícita `excludedItems` dos itens em erro/não implementados para exibição na UI (nunca gerando XML silenciosamente incompleto sem avisar).
   - **Simples Nacional (`CRT=1/2/3`):** geração de XML desabilitada na aba `XML & DANFSe` com aviso claro (*"O motor oficial do Simples Nacional não gera XML de evento tpEvento 412140; exporte via JSON/XLSX ou compare em Regime Regular/Híbrido"*).
   - Validação: via `RemoteOfficialEngine` (`POST /xml/validate` XSD oficial) quando conectado, ou validação estrutural bem-formado + campos obrigatórios em `LocalTsEngine` (flag `xsdValidationMode: 'xsd-official' | 'structural-local'`).
7. **`generateDanfse(nfseXml, stc, canhoto)`**
   - Via serviço Go HTTP (`POST /api/danfse`) ou WASM oficial (`danfse.wasm` + `wasm_exec.js`) quando configurados; caso contrário, `LocalDanfsePreviewEngine` gera prévia estruturada em PDF baseada nos campos de `NFSe`/`infNFSe`/`DPS`/`IBSCBS` extraídos com parser anti-XXE, contendo faixa de aviso explícita *"Prévia Local — conecte o serviço Go/WASM oficial para o PDF padrão RFB"*.

---

## 6. Orquestração do Gemini, Privacidade (`store: false`) e Pipeline Anti-Alucinação

### 6.1 Política de Privacidade & `store: false` [Decisão do Usuário: Opção A]
1. **`store: false` obrigatório:** toda chamada `client.interactions.create(...)` envia `store: false` para impedir retenção de documentos fiscais e prompts nos servidores da API.
2. **Stateless Turn-Replay via `workspace.db`:** como `store: false` desabilita `previous_interaction_id`, o BFF mantém o histórico estruturado da conversa (mensagens do usuário sanitizadas, passos `function_call`/`function_result` das rodadas determinísticas e respostas do assistente) em `workspace.db` e reconstrói a janela de contexto de entrada em cada turno.
3. **Mascaramento local em planilhas e XMLs:** antes de enviar cabeçalhos/amostras de `.xlsx`/`.csv` ou resumos de `.xml` ao Gemini, o BFF aplica mascaramento determinístico de CPFs (`***.***.***-XX`), CNPJs (`**.***.***/XXXX-**`), chaves de acesso e e-mails/telefones. Os dados completos permanecem exclusivamente no BFF/SQLite local (`workspace.db`) para cálculo determinístico, XML e DANFSe.
4. **PDFs e Imagens multimodais:** enviados diretamente ao `gemini-4-hydrogen` apenas durante a chamada `store: false` (para manter alta precisão na leitura de faturas, DANFEs e tabelas complexas), com limpeza imediata do payload em memória após a extração para o `ExtractionDraft`.

### 6.2 Fluxo Anti-Alucinação
1. **Ingestão Determinística Primeiro:** `.xlsx`, `.csv` e `.xml` são parseados no backend sem LLM; Gemini só auxilia no mapeamento de colunas de planilhas heterogêneas (usando cabeçalhos + até 3 linhas mascaradas via Structured Output) ou na extração visual de PDFs/imagens (`ExtractedOperationDraft` com `confidence: 'high' | 'medium' | 'low' | 'missing'`).
2. **Staging Gate (Revisão Obrigatória):** extrações de PDF/imagem, novos mapeamentos de planilha ou operações com campos faltantes críticos (ex.: `aliquotasNominais` em 2027+, `pIBSSN`/`pCBSSN` no Simples, NCM sem `cClassTrib`) vão para a aba **Prévia & Lote** para confirmação/ajuste do usuário — o Gemini é proibido de preencher valores faltantes por suposição.
3. **Tool Calling Determinístico:** ferramentas disponíveis ao Gemini:
   - `lookup_ncm`, `lookup_nbs`, `search_cclasstrib`, `validate_ncm_nbs_cclasstrib`, `lookup_aliquotas_referencia`
   - `lookup_atividade_simples`, `calculate_fator_r`, `calculate_base_unificada`
   - `calculate_regime_regular`, `calculate_simples_nacional`, `compare_regimes` (retornam `calcRunId` + JSON completo)
   - `lookup_error_code`, `generate_tax_xml`
   - Limite de 8 rodadas de *tool calling* por turno com timeout explícito.
4. **Grounding Guard & UI Desacoplada:**
   - Todos os `calcRunId` gerados no turno são vinculados ao registro da mensagem em `workspace.db`.
   - KPIs, tabelas de itens, indicadores de crédito, `memoriaCalculo`, códigos de erro (`REG-*` / `VSN-*`), XML e DANFSe na interface são renderizados **diretamente do JSON imutável `CalcRunSnapshot`**, jamais extraídos do texto markdown do Gemini.

---

## 7. Controles de Segurança (`anthropic-cybersecurity-skills`)

| Vetor de Risco | Controle Obrigatório |
|---|---|
| **Segredos & API Key** | `GEMINI_API_KEY` lida somente no processo Node do BFF via `.env`; nunca enviada em endpoints ou bundle client. |
| **Retenção na API IA** | `store: false` obrigatório em todas as chamadas `@google/genai`; replay stateless gerenciado apenas no `workspace.db` local. |
| **Uploads Maliciosos / DoS** | Limite rígido de **5 MiB** (`5_242_880` bytes, alinhado ao `gerador-danfse`) por arquivo; verificação de extensão + magic bytes (ZIP signature `.xlsx`, `%PDF-`, PNG/JPEG/WEBP, UTF-8 para CSV/XML); limite de 500 linhas / 50 colunas por planilha e teto de razão de descompressão anti-zip-bomb. |
| **XXE & XML Bombing** | Rejeitar imediatamente XML contendo `<!DOCTYPE`, `<!ENTITY` ou `SYSTEM`/`PUBLIC` DTD antes do parsing; `processEntities: false` no parser XML; checagem de tamanho antes e depois da sanitização. |
| **CSV / Excel Formula Injection** | Células string iniciadas com `=`, `+`, `-`, `@`, `\t`, `\r` são neutralizadas na ingestão/exibição e escapadas com prefixo `'` na exportação `.xlsx`/`.csv`. |
| **Prompt Injection Indireto** | Textos extraídos de PDFs, imagens, planilhas e XMLs vão para o Gemini encapsulados em `<untrusted_document_data>` com instrução estrita de sistema ignorando comandos embutidos; tools são exclusivamente de consulta/cálculo fiscal (sem shell, filesystem arbitrário ou rede). |
| **SSRF no Conector Oficial** | URLs (`RTC_REGIME_REGULAR_URL`, `RTC_SIMPLES_URL`, `DANFSE_SERVICE_URL`) lidas apenas de `.env` no startup (nunca de input HTTP). |
| **Eval / RCE em Fórmulas** | Expressões de `TRATAMENTO_TRIBUTARIO` avaliadas exclusivamente por parser AST aritmético com whitelist dos 4 operadores e das 21 variáveis de `VariavelExpressao.java`; zero `eval`/`new Function`. |
| **Privacidade & Logs (Zero-PII)** | Logs JSON estruturados registram apenas `timestamp`, `request_id` (UUID gerado no servidor; `X-Request-ID` externo descartado), `method`, `route`, `status`, `duration_ms` e código de erro técnico genérico. Nunca logar XML, PDF, CNPJ/CPF, valores financeiros ou prompts. |
| **HTTP Hardening** | CORS restrito via `APP_CORS_ALLOWED_ORIGINS` (nunca `*`), `Content-Security-Policy` (`script-src 'self'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, e rate limiting nas rotas `/api/chat` e `/api/upload`. |

---

## 8. Experiência do Usuário e Design Frontend

### 8.1 Layout Split-View ("Chat Copiloto + Mesa Fiscal")
- **Desktop (`>= 1024px`):** 2 colunas (~42% Chat Copiloto à esquerda / ~58% Mesa Fiscal à direita).
- **Mobile/Tablet (`< 1024px`):** alternância por abas superiores (`Copiloto Chat` | `Mesa Fiscal`) com indicador de atualização.

#### Coluna Esquerda — Copiloto Fiscal (Chat Gemini)
- **Header:** seletor de sessões salvas (`<dialog>` / drawer), badges de status por capacidade (`Regime Regular`, `Simples`, `DANFSe` — indicando `Local TS` ou `RFB Oficial`), botão `+ Nova Simulação`.
- **Mensagens:** bolhas do usuário com chips de anexos; bolhas do assistente com badge de aterramento determinístico, explicação contábil e botões de navegação rápida para a aba correspondente na Mesa Fiscal (e botão manual `Reprocessar no Motor Local TS` caso um serviço remoto configurado tenha falhado em modo fail-closed).
- **Composer:** área de texto + drag-and-drop para até 5 arquivos (`.xlsx`, `.csv`, `.xml`, `.pdf`, imagens) + chips de cenários rápidos.

#### Coluna Direita — Mesa Fiscal Determinística
- **Barra de Contexto:** Regime (`Regime Regular`, `Simples Nacional`, `Comparativo`), Data do Fato Gerador (badge de transição `2026 Teste` | `2027+ Sem PIS/COFINS` | `2033+ Pleno`), UF/Município IBGE e Tipo DF-e (`55`, `65`, `NFS-e`). Banner amarelo explícito sempre que `xWarningDadosSimulados` estiver ativo.
- **5 Abas:**
  1. **`Prévia & Lote`:** grade editável de itens extraídos com badges de confiança (`Alta`, `Revisar`, `Faltante`), autocomplete oficial NCM/NBS/`cClassTrib`/`cAtivSN` e botão `Calcular Operação`.
  2. **`Resultado & Créditos`:** KPIs tabulares (`CBS`, `IBS UF`, `IBS Mun`, `Imposto Seletivo`, `Carga Efetiva`), tabela item a item com status (`CALCULADO`, `CALCULO_SIMULADO`, `INCONSISTENCIA_ENTRADA`, `NAO_IMPLEMENTADO`) e explicação clicável de erros (`REG-*` / `VSN-*`), cards de **Indicadores de Crédito Oficiais** (de `CLASSIFICACAO_TRIBUTARIA`) e card informativo de **Split Payment**.
  3. **`Comparativo Regimes`:** tabela comparativa lado a lado para datas `>= 2027-01-01` (**Regime Regular** × **Simples Nacional `CRT=1`** × **Simples Híbrido `tpRegimeIBSCBS=1`**, mais opção **Excesso de Sublimite `CRT=2`**), bloco auxiliar de **Fator R** (`Folha 12m ÷ RBT12`) e comparativo de **Base Unificada** (`baseRG`, `baseIS`, `baseSN` + avisos de vigência).
  4. **`Memória & Base Legal`:** `memoriaCalculo` passo a passo, fórmulas do `TRATAMENTO_TRIBUTARIO`, CST/`cClassTrib` e fundamentações legais da LC 214/2025.
  5. **`XML & DANFSe`:** XML gerado para NF-e/NFC-e apenas dos itens válidos (com aviso explícito de eventuais `excludedItems`, ou mensagem explicativa de indisponibilidade em Simples Nacional puro), status `xsdValidationMode`, visualizador/download da **DANFSe em PDF** (com selo `Prévia Local` vs. `Go/WASM Oficial`) e exportação **`.xlsx` auditado**, **`.json`**, **`.xml`**.

### 8.2 Diretrizes Frontend (`modern-web-guidance`)
- Seguir o workflow da skill `modern-web-guidance` ao implementar a camada web: elementos nativos (`<dialog>`, `<details>`), Container Queries, `font-variant-numeric: tabular-nums` em todas as colunas monetárias, contraste WCAG AA e navegação completa por teclado.

---

## 9. Verificação e Critérios de Aceitação (Testing Strategy)

1. **Testes Unitários do Motor Matemático:**
   - Precisão decimal (`HALF_EVEN`, 8 casas internas, arredondamento de saída 2/4 casas) e parser AST seguro (rejeitando qualquer token/função fora da whitelist).
   - Paridade exata dos 4 itens do exemplo oficial `calculadora-rtc-regime-regular/docs/exemplos.md` (cesta básica 100%, cerveja com IS derivando base de CBS/IBS, serviço educação redução 60%, item 4 erro `REG-011`) e do exemplo de Base Unificada 2027 (`baseRG=870`, `baseIS=840`, `baseSN=1060` + avisos de PIS/COFINS).
   - Paridade de cálculo do Simples Nacional (NT 2026.005 v1.00: `CRT=1/2/3`, `tpRegimeIBSCBS=2`, `tpEnteGov=1..4`, `ModoFatorR`, `VSN-019`, `VSN-027`).
   - Comparativo de regimes (`compareRegimes`) validando ponte de `baseCalculo` com/sem `vIS`, `tpRegimeIBSCBS=1` (Simples Híbrido) e `CRT=2` (sublimite), e rejeição amigável para datas `< 2027-01-01`.
2. **Testes de Segurança e Privacidade:**
   - Verificação de chamada `@google/genai` com `store: false` e mascaramento de CPF/CNPJ/chaves antes do envio de amostras de planilhas/XMLs.
   - XML com `<!DOCTYPE` ou `<!ENTITY` rejeitado com `400` antes de parsear; planilhas com fórmulas (`=CMD|...`) neutralizadas; upload `> 5 MiB` ou magic bytes inválidos rejeitados.
   - Testes de logger garantindo zero PII/XML/valores financeiros nos logs e testes de política fail-closed quando serviço remoto configurado falha.
3. **Testes do Pipeline Anti-Alucinação & XML:**
   - Mock de resposta Gemini verificando que números da UI/Snapshot vêm 100% do motor determinístico e campos ausentes abrem `ExtractionDraft`.
   - `generateTaxXml` filtrando itens com erro e retornando `excludedItems`, e bloqueando geração no Simples Nacional puro.
4. **Build, Typecheck e E2E:**
   - `npm run db:bootstrap` em ambiente limpo cria `rtc-oficial.db` sem erros de FK/integridade (`PRAGMA integrity_check` e `foreign_key_check` OK).
   - `npm run typecheck`, `npm run test` e `npm run build` passando integralmente.

---

## 10. O Que Fica a Critério do Implementador ("Left to the Builder")

- Escolha específica de bibliotecas npm dentro das restrições descritas (ex.: `node:sqlite` vs. `better-sqlite3`, `exceljs` vs. `xlsx`, `fast-xml-parser` com entidades desabilitadas, `pdf-lib`/`pdfkit`, `lucide-react`).
- Estrutura interna de pastas (`apps/web`, `apps/api` ou `src/server` + `src/client`), schema exato das tabelas de `workspace.db` e scripts npm.
- Paleta visual exata e tokens CSS (priorizando alto contraste e legibilidade contábil).
- Estratégia de mocks do Gemini para execução da suíte automatizada offline.

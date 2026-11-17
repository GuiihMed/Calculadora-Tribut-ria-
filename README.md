# Copiloto Fiscal & Calculadora da Reforma Tributária (RTC)

Aplicação web full-stack para apuração, simulação, auditoria e geração de XML da **Reforma Tributária sobre o Consumo** (**LC 214/2025** e **Nota Técnica 2026.005 v1.00**), unindo motores fiscais **100% determinísticos** em TypeScript (`LocalTsEngine`), conectores opcionais *fail-closed* para os serviços oficiais Java/Go da Receita Federal (`RemoteOfficialEngine`) e um Copiloto conversacional baseado em **Gemini (`gemini-4-hydrogen`)** com tolerância zero a alucinações numéricas.

---

## 1. Visão Geral & Arquitetura Dual-Engine

A aplicação separa estritamente **orquestração conversacional / extração documental (LLM)** de **cálculo tributário (motor determinístico)**:

- **`LocalTsEngine` (100% determinístico)**: Implementado em `src/server/engine/` utilizando `decimal.js` com precisão interna de 40 dígitos, arredondamento intermediário de 8 casas decimais (`roundInternal8`) e arredondamento bancário `HALF_EVEN` (2 casas monetárias, 2–4 casas para alíquotas).
- **`RemoteOfficialEngine` (*fail-closed*)**: Conector HTTP/Go-WASM (`src/server/engine/remote-official-engine.ts`) roteado por capacidade via `FiscalEngineRouter` (`src/server/engine/engine-router.ts`). Quando uma URL oficial está configurada (`RTC_REGIME_REGULAR_URL`, `RTC_SIMPLES_NACIONAL_URL`, `DANFSE_SERVICE_URL`), qualquer indisponibilidade ou erro HTTP retorna `503 REMOTE_ENGINE_UNAVAILABLE` sem fallback silencioso — exigindo confirmação explícita (`forceLocal: true`) para operar no motor local.
- **Base Oficial RFB Somente Leitura (`data/rtc-oficial.db`)**: Compilada localmente a partir das migrações SQL Flyway oficiais da Receita Federal (`db/rfb-migrations/`: `beforeMigrate.sql`, baseline `B0001__sistema_tributario_completo.sql`, 58 migrações de manutenção `V0002` a `V0059` e `afterMigrate.sql`, totalizando 61 scripts executados / 59 migrações aplicadas), aberta com `{ readonly: true }` via `openOficialDbReadOnly()` (`src/server/db/oficial-db.ts`).
- **Workspace Local (`data/workspace.db`)**: Banco SQLite com modo `WAL` (`src/server/db/workspace-db.ts`) que persiste sessões, histórico de mensagens, rascunhos de extração (`ExtractionDraft`) e snapshots imutáveis de cálculo (`CalcRunSnapshot`).

---

## 2. Funcionalidades Contábeis e Fiscais (LC 214/2025 & NT 2026.005 v1.00)

### 2.1 Regime Regular (`RegimeRegularEngine`)
- **Tributos contemplados**: `CBS` (Contribuição sobre Bens e Serviços), `IBS UF`, `IBS Mun` e `Imposto Seletivo (IS)` (*ad valorem* e *ad rem* por unidade tributável).
- **Avaliador AST Seguro (`ast-evaluator.ts`)**: Avalia expressões matemáticas oficiais das tabelas da RFB (`EXF_EXPRESSAO`, `EXFR_EXPRESSAO`) por meio de lexer/parser/AST próprios e `FiscalDecimal`, **sem `eval()` ou `new Function()`**.
- **Precisão & Totalização**: Soma exata dos valores não arredondados dos itens (`totalizeExact`) com aplicação de `HALF_EVEN` apenas no total final (`IBSCBSTot` e `ISTot`), evitando propagação de erros de arredondamento intermediário.
- **Crédito B2B (`CLASSIFICACAO_TRIBUTARIA`)**: Exibe indicadores oficiais de apropriação de crédito para CBS/IBS e crédito presumido do fornecedor/adquirente (`IND_APROPRIACAO_CREDITO_CBS`, `IND_APROPRIACAO_CREDITO_IBS`, etc.).
- **Orientação de Split Payment (Arts. 31–35 da LC 214/2025)**: Análise qualitativa baseada exclusivamente nos débitos efetivamente apurados de CBS e IBS (`splitPaymentGuidance`), sem aplicação de alíquota de retenção presumida.
- **Modos de apuração**: `observabilidade` (mantém itens inválidos sinalizados com códigos `REG-*` / `CAL-*` / `VAL-*` e totaliza os válidos) e `estrito` (rejeita totais parciais quando há inconsistências).

### 2.2 Simples Nacional (`SimplesNacionalEngine`)
- **Enquadramentos**: `CRT=1` (Simples Nacional), `CRT=2` (excesso de sublimite de receita bruta) e **Simples Híbrido / Opção Regular** (`tpRegimeIBSCBS=1`).
- **Catálogo de Erros `VSN-001` a `VSN-027`**: Validação completa de documento (`NF-e`/`NFC-e`/`NFS-e`), atividade (`cAtivSN`), `cClassTrib`, incompatibilidade com NCM/NBS, ajustes tributários não implementados (`VSN-027`) e alíquotas informadas.
- **Simulador Auxiliar de Fator R 28% (`fator-r.ts`)**: Calcula `Folha 12m / RBT 12m` para orientação entre Anexo III (`>= 0,28`) e Anexo V (`< 0,28`), com aviso legal explícito de caráter meramente orientativo (LC 123/2006, art. 18, §§ 5º-J e 5º-M).

### 2.3 Base de Cálculo Unificada (`BaseUnificadaEngine`)
- Apuração padronizada para **NF-e / NFC-e** (modelos 55 e 65) e **NFS-e** (incluindo locação e MEI) com regras de transição por ano do fato gerador:
  - **2026**: exclusão de ICMS, PIS, COFINS e ISS conforme modelo e natureza.
  - **2027–2032**: transição gradual (extinção de PIS/COFINS, manutenção de exclusão do ICMS/ISS durante o período de transição e tratamento de IPI/IS).
  - **2033+**: incidência plena sobre a base líquida sem os tributos extintos.

### 2.4 Comparador de Regimes Lado a Lado (`compare-regimes.ts`)
- Disponível para operações a partir de **2027+** (`elegivel: true` para `ano >= 2027`), comparando **Simples Nacional (Apuração Unificada)**, **Simples Híbrido (`tpRegimeIBSCBS=1`)** e **Regime Regular**.
- **Ponte Automática de Base do Imposto Seletivo (`TRBS_IN_IS_COMPOE_RECEITA = 0`)**: No Regime Regular o IS compõe a base de cálculo de CBS/IBS (`baseCalculo + vIS`), enquanto no Simples Nacional a `baseCalculo` é mantida sem o IS e o `valorImpostoSeletivo` é repassado separadamente sem compor a receita bruta interna.

### 2.5 Geração de XML RTC & Prévia Local de DANFSe PDF
- **XML RTC (`xml-generator.ts`)**: Gera os grupos `<infNFe><det><imposto><IS>/<IBSCBS>` e `<total><ISTot>/<IBSCBSTot>` exclusivamente a partir de itens válidos (`CALCULADO` / `CALCULO_SIMULADO`) de um `CalcRunSnapshot` do Regime Regular, registrando eventuais itens rejeitados (ex.: `REG-011`) em `excludedItems` e executando validação estrutural local.
- **DANFSe PDF (`danfse-preview.ts`)**: Gera prévia local em PDF (`%PDF-`) via `pdfkit` com cabeçalho `X-Danfse-Local-Preview: true` (ou delega ao serviço oficial/WASM da RFB quando configurado).
- **Exportações de Auditoria (`POST /api/export/xml`, `POST /api/export/danfse`, `GET /api/export/xlsx/:calcRunId`, `GET /api/export/json/:calcRunId`)**: Pasta de trabalho XLSX com abas `Resumo`, `Itens` e `Memoria_Legal` e neutralização de fórmulas de planilha.

---

## 3. Copiloto Gemini (`gemini-4-hydrogen`) — Zero Alucinação & Privacidade

- **SDK & Modelo**: `@google/genai` (`>= 3.2.0`, instalado `^3.4.0`) com Interactions API usando o modelo **`gemini-4-hydrogen`**.
- **Modo 100% Stateless (`store: false`)**: Todas as chamadas em `GeminiOrchestrator` (`src/server/gemini/orchestrator.ts`) definem `store: false` e omitem `previous_interaction_id`, realizando *replay* completo do histórico de turnos (`user_input`, `function_call`, `function_result`, `model_output`) a partir do `data/workspace.db` local.
- **13 Ferramentas Determinísticas (`tools-registry.ts`)**: `lookup_ncm`, `lookup_nbs`, `search_cclasstrib`, `validate_ncm_nbs_cclasstrib`, `lookup_aliquotas_referencia`, `lookup_atividade_simples`, `lookup_error_code`, `calculate_regime_regular`, `calculate_simples_nacional`, `compare_regimes`, `calculate_base_unificada`, `calculate_fator_r` e `generate_tax_xml`. Limite máximo de `MAX_TOOL_ITERATIONS = 8` por turno.
- **Verificação Numérica Anti-Alucinação (`verifyNumericGrounding`)**: Compara os valores monetários citados na prosa gerada pelo modelo contra o `CalcRunSnapshot` determinístico e emite `groundingWarning` em caso de divergência.
- **Mascaramento de PII & Isolamento de Documentos (`pii-masker.ts`, `prompt-guard.ts`)**: Mascara localmente **CPF**, **CNPJ**, **chave de acesso de 44 dígitos**, **e-mail** e **telefone** antes de enviar resumos ou amostras de planilhas ao modelo, envolvendo todo conteúdo documental em `<untrusted_document_data>` com neutralização de tentativas de fechamento prematuro de tag.

---

## 4. Pré-requisitos

- **Node.js `>= 24`** (ESM nativo e `--experimental-sqlite`/módulos nativos compatíveis com `better-sqlite3`)
- **npm `>= 10`**
- Chave da API Gemini (`GEMINI_API_KEY`) para uso do Copiloto conversacional e extração visual de PDF/imagens (os cálculos fiscais determinísticos e consultas às tabelas da RFB funcionam localmente mesmo sem `GEMINI_API_KEY`).

---

## 5. Instalação e Comandos

```bash
# 1. Instalar dependências
npm install

# 2. Compilar o banco oficial da Receita Federal (data/rtc-oficial.db)
npm run db:bootstrap

# 3. Configurar variáveis de ambiente
cp .env.example .env
# Edite .env e preencha GEMINI_API_KEY (opcional para cálculos locais, obrigatório para o Copiloto)

# 4. Executar em modo desenvolvimento (BFF Fastify + Vite HMR)
npm run dev

# 5. Verificações de qualidade e testes
npm run typecheck
npm test

# 6. Build de produção e execução do servidor integrado (API + SPA dist/client)
npm run build
npm start
```

Scripts adicionais disponíveis em `package.json`:
- `npm run dev:server` — inicia apenas o BFF Fastify (`src/server/server.ts`) com `tsx watch`.
- `npm run dev:client` — inicia apenas o servidor Vite de desenvolvimento.

---

## 6. Variáveis de Ambiente (`.env.example`)

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Para Copiloto/OCR | — | Chave da API Gemini mantida exclusivamente no BFF Node (nunca exposta ao navegador). |
| `PORT` | Não | `3001` (server) / `3000` (`.env.example`) | Porta HTTP do servidor Fastify. |
| `APP_CORS_ALLOWED_ORIGINS` | Não | `http://localhost:5173` | Lista separada por vírgula de origens CORS permitidas (curinga `*` é proibido). |
| `RTC_OFICIAL_DB_PATH` | Não | `./data/rtc-oficial.db` | Caminho do SQLite oficial compilado da RFB (aberto somente leitura). |
| `WORKSPACE_DB_PATH` | Não | `./data/workspace.db` | Caminho do SQLite local de sessões, rascunhos e snapshots. |
| `RTC_REGIME_REGULAR_URL` | Não | — | URL opcional do serviço oficial Java do Regime Regular (*fail-closed* quando definida). |
| `RTC_SIMPLES_NACIONAL_URL` | Não | — | URL opcional do serviço oficial Java do Simples Nacional (*fail-closed* quando definida; aceita também alias legado `RTC_SIMPLES_URL`). |
| `DANFSE_SERVICE_URL` | Não | — | URL opcional do serviço oficial Go/HTTP de DANFSe PDF (*fail-closed* quando definida). |
| `DANFSE_WASM_PATH` | Não | — | Caminho opcional para módulo Go-WASM da DANFSe oficial. |
| `DANFSE_WASM_EXEC_JS_PATH` | Não | — | Caminho opcional para runtime `wasm_exec.js` da DANFSe oficial. |

---

## 7. Checklist de Segurança Auditável

- [x] **Segredo restrito ao servidor**: `GEMINI_API_KEY` lida exclusivamente no BFF Node (`src/server/gemini/orchestrator.ts`); ausente no bundle `dist/client`.
- [x] **Interactions API stateless**: `store: false` obrigatório e ausência de `previous_interaction_id` em 100% das chamadas.
- [x] **Mascaramento de PII antes da LLM**: `maskFiscalPii` e `maskSpreadsheetRowsForLlm` removem CPF, CNPJ, chave de 44 dígitos, e-mail, telefone e colunas sensíveis antes de montar prompts/resumos.
- [x] **Isolamento contra Prompt Injection**: Dados extraídos e amostras são encapsulados em `<untrusted_document_data>` com escape de tags de fechamento e tags `<system>` (`prompt-guard.ts`).
- [x] **Zero `eval()` / `new Function()`**: Expressões tributárias avaliadas exclusivamente pelo lexer/parser AST determinístico (`ast-evaluator.ts`).
- [x] **Proteção contra Formula Injection (CSV/XLSX)**: Valores iniciados por `=`, `+`, `-`, `@`, `\t`, `\r` (inclusive precedidos de espaços) são neutralizados com apóstrofo inicial `'` na ingestão (`spreadsheet-parser.ts`) e na exportação XLSX (`xlsx-exporter.ts`).
- [x] **Proteção anti-XXE & Zip-Bomb**: XMLs com `<!DOCTYPE` ou `<!ENTITY` são rejeitados com `400 XXE_REJECTED` no upload e na prévia DANFSe; planilhas `.xlsx` validam assinatura ZIP, EOCD, rejeitam ZIP64 e limitam entradas (`2000`) e tamanho descomprimido (`50 MiB`).
- [x] **Validação estrita de upload**: Limite de `5 MiB` por arquivo (`413 FILE_TOO_LARGE`), máximo de 5 arquivos, lista de extensões permitidas (`415`) e checagem de *magic bytes* (`400 MAGIC_BYTES_MISMATCH`).
- [x] **CORS sem curinga & Headers defensivos**: Proibição explícita de `*` em `allowedOrigins` (`403` para origens não listadas) e aplicação de `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` e `Referrer-Policy: no-referrer` em todas as respostas.
- [x] **Zero-PII Logger & Request ID do servidor**: `ZeroPiiLogger` registra apenas metadados (`level`, `timestamp`, `request_id`, `method`, `route`, `status`, `duration_ms`, `error_type`), ignorando cabeçalhos `X-Request-Id` enviados pelo cliente e gerando IDs criptográficos de 32 hexadecimais no servidor.
- [x] **Rate Limiting & Sem Fallback Silencioso**: `/api/upload` e `/api/chat` protegidos por `@fastify/rate-limit`; URLs remotas configuradas falham de forma explícita (`503 REMOTE_ENGINE_UNAVAILABLE`) até confirmação explícita do usuário (`forceLocal: true`).

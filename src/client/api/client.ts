import type {
  AssistantTurnRecord,
  BaseCalculoUnificadaNfseOutput,
  BaseCalculoUnificadaOutput,
  CalcRunSnapshot,
  ChatStreamEvent,
  ColumnMappingSuggestion,
  CompareRegimesInput,
  EngineCapabilityKey,
  EngineStatusMap,
  ExtractionDraft,
  FatorRAuxiliarOutput,
  ModoFatorR,
  OperationContext,
  WorkspaceMessageRecord,
  WorkspaceSession,
  XmlGenerationResult,
  XmlValidationResult,
} from '../../shared/types/fiscal';

export interface FatorRAuxiliarInput {
  folha12m: string | number;
  rbt12m: string | number;
}

export interface HealthResponse {
  status: string;
  engines: EngineStatusMap;
  oficialDb: { ready: boolean };
}

export interface NcmLookupItem {
  ncmCd: string;
  descricao: string;
  inicioVigencia: string;
  fimVigencia: string | null;
}

export interface NbsLookupItem {
  nbsCd: string;
  descricao: string;
  lc116: string | null;
  inicioVigencia: string;
  fimVigencia: string | null;
}

export interface ClassTribLookupItem {
  cltrId: number;
  cClassTrib: string;
  descricao: string;
  cst: string;
  cstDescricao?: string;
  tipoAliquota?: string;
  apropriacaoCreditoCbs?: boolean;
  apropriacaoCreditoIbs?: boolean;
  creditoPresumidoFornecedor?: boolean;
  creditoPresumidoAdquirente?: boolean;
  creditoOperacaoAntecedente?: string | null;
}

export interface UfLookupItem {
  ufCd: number;
  nome: string;
  sigla: string;
}

export interface MunicipioLookupItem {
  muniCd: number;
  ufCd: number;
  nome: string;
  ufSigla: string;
}

export interface AtividadeSimplesLookupItem {
  atsnId: number;
  cAtivSN: string;
  ordem: number;
  descricao: string;
  anexoSemFatorR: string | null;
  anexoComFatorR: string | null;
  sujeitaFatorR: boolean;
  naoTributavel: boolean;
  rotuloAnexo: string;
  rotuloCurtoAnexo: string;
  disponivel: boolean;
  modoFatorR: ModoFatorR;
}

export interface ErrorCatalogLookupItem {
  codigo: string;
  titulo: string;
  descricao: string;
  categoria: 'REG' | 'CAL' | 'VAL' | 'VSN';
  campoDefault?: string | null;
}

export interface ErrorLookupResponse {
  item?: ErrorCatalogLookupItem | null;
  items: ErrorCatalogLookupItem[];
  count: number;
}

export interface ApiErrorOptions {
  status: number;
  code: string;
  message: string;
  canForceLocal?: boolean;
  capability?: EngineCapabilityKey;
  endpoint?: string;
  issues?: unknown[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly canForceLocal: boolean;
  readonly capability?: EngineCapabilityKey;
  readonly endpoint?: string;
  readonly issues?: unknown[];

  constructor(opts: ApiErrorOptions) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.canForceLocal = opts.canForceLocal ?? false;
    this.capability = opts.capability;
    this.endpoint = opts.endpoint;
    this.issues = opts.issues;
  }
}

interface RawErrorPayload {
  code?: string;
  message?: string;
  error?: string;
  canForceLocal?: boolean;
  capability?: EngineCapabilityKey;
  endpoint?: string;
  issues?: unknown[];
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  let data: RawErrorPayload = {};
  try {
    data = (await res.json()) as RawErrorPayload;
  } catch {
    // Response is not valid JSON
  }

  return new ApiError({
    status: res.status,
    code: data.code ?? `HTTP_${res.status}`,
    message: data.message ?? data.error ?? `Erro na requisição (${res.status}).`,
    canForceLocal: Boolean(data.canForceLocal),
    capability: data.capability,
    endpoint: data.endpoint,
    issues: data.issues,
  });
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return (await res.json()) as T;
}

// ============================================================================
// Health & Sessions
// ============================================================================

export function fetchHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/api/health');
}

export function listSessions(): Promise<{ sessions: WorkspaceSession[] }> {
  return requestJson<{ sessions: WorkspaceSession[] }>('/api/sessions');
}

export function createSession(payload?: {
  title?: string;
  context?: Partial<OperationContext>;
}): Promise<{ session: WorkspaceSession }> {
  return requestJson<{ session: WorkspaceSession }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  });
}

export function getSession(id: string): Promise<{
  session: WorkspaceSession;
  messages: WorkspaceMessageRecord[];
  calcRuns: CalcRunSnapshot[];
}> {
  return requestJson(`/api/sessions/${encodeURIComponent(id)}`);
}

export function updateSessionContext(
  id: string,
  context: Partial<OperationContext>,
  title?: string,
): Promise<{ session: WorkspaceSession }> {
  return requestJson<{ session: WorkspaceSession }>(
    `/api/sessions/${encodeURIComponent(id)}/context`,
    {
      method: 'PATCH',
      body: JSON.stringify({ context, ...(title !== undefined ? { title } : {}) }),
    },
  );
}

// ============================================================================
// Drafts & CalcRuns
// ============================================================================

export function getDraft(id: string): Promise<{ draft: ExtractionDraft }> {
  return requestJson<{ draft: ExtractionDraft }>(`/api/drafts/${encodeURIComponent(id)}`);
}

export function updateDraft(
  id: string,
  patch: Partial<ExtractionDraft>,
): Promise<{ draft: ExtractionDraft }> {
  return requestJson<{ draft: ExtractionDraft }>(`/api/drafts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export function getCalcRun(id: string): Promise<{ snapshot: CalcRunSnapshot }> {
  return requestJson<{ snapshot: CalcRunSnapshot }>(`/api/calc-runs/${encodeURIComponent(id)}`);
}

// ============================================================================
// File Upload & Chat SSE
// ============================================================================

export async function uploadFiles(
  files: File[],
  sessionId?: string,
): Promise<{
  drafts: ExtractionDraft[];
  attachmentSummary: string;
  columnMappings?: Record<string, ColumnMappingSuggestion>;
}> {
  const formData = new FormData();
  if (sessionId) {
    formData.append('sessionId', sessionId);
  }
  for (const file of files) {
    formData.append('files', file, file.name);
  }

  return requestJson('/api/upload', {
    method: 'POST',
    body: formData,
  });
}

interface RawSseErrorEvent {
  type: 'error';
  code?: string;
  message?: string;
  canForceLocal?: boolean;
  capability?: EngineCapabilityKey;
  endpoint?: string;
}

function toStreamApiError(parsed: RawSseErrorEvent): ApiError {
  return new ApiError({
    status: parsed.canForceLocal ? 503 : 500,
    code: parsed.code ?? 'CHAT_STREAM_ERROR',
    message: parsed.message ?? 'Falha ao processar turno no Copiloto Gemini.',
    canForceLocal: Boolean(parsed.canForceLocal),
    capability: parsed.capability,
    endpoint: parsed.endpoint,
  });
}

function dispatchSseBlock(block: string, onEvent: (ev: ChatStreamEvent) => void): void {
  const dataLines: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    if (rawLine.startsWith('data:')) {
      dataLines.push(rawLine.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return;
  }

  const rawJson = dataLines.join('\n').trim();
  if (!rawJson || rawJson === '[DONE]') {
    return;
  }

  const parsed = JSON.parse(rawJson) as ChatStreamEvent | RawSseErrorEvent;
  if (parsed.type === 'error') {
    throw toStreamApiError(parsed);
  }
  onEvent(parsed);
}

export async function streamChatTurn(
  payload: {
    sessionId?: string;
    message: string;
    attachmentSummary?: string;
    activeContext?: Partial<OperationContext>;
    stream?: boolean;
    signal?: AbortSignal;
  },
  onEvent: (ev: ChatStreamEvent) => void,
): Promise<{ sessionId?: string }> {
  const { signal, ...bodyPayload } = payload;
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
    },
    body: JSON.stringify(bodyPayload),
    signal,
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  const headerSessionId = res.headers.get('X-Session-ID') ?? undefined;
  const contentType = res.headers.get('Content-Type') ?? '';

  if (contentType.includes('application/json')) {
    const json = (await res.json()) as {
      sessionId?: string;
      turn?: AssistantTurnRecord;
      events?: ChatStreamEvent[];
    };

    if (Array.isArray(json.events) && json.events.length > 0) {
      for (const ev of json.events) {
        if ((ev as { type: string }).type === 'error') {
          throw toStreamApiError(ev as unknown as RawSseErrorEvent);
        }
        onEvent(ev);
      }
    } else if (json.turn) {
      if (json.turn.snapshot) {
        onEvent({ type: 'calc_run', snapshot: json.turn.snapshot });
      }
      if (json.turn.draft) {
        onEvent({ type: 'draft_ready', draft: json.turn.draft });
      }
      if (json.turn.content) {
        onEvent({ type: 'text_delta', delta: json.turn.content });
      }
      onEvent({
        type: 'done',
        messageId: json.turn.messageId,
        calcRunId: json.turn.calcRunId,
        groundingWarning: json.turn.groundingWarning,
      });
    }

    return { sessionId: json.sessionId ?? headerSessionId };
  }

  if (!res.body) {
    return { sessionId: headerSessionId };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      if (part.trim().length > 0) {
        dispatchSseBlock(part, onEvent);
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    dispatchSseBlock(buffer, onEvent);
  }

  return { sessionId: headerSessionId };
}

// ============================================================================
// Fiscal Calculation Endpoints
// ============================================================================

export function calculateFiscal(payload: {
  regime: 'regime-regular' | 'simples-nacional';
  input: unknown;
  sessionId?: string;
  context?: Partial<OperationContext>;
  modo?: 'observabilidade' | 'estrito';
  forceLocal?: boolean;
}): Promise<{ calcRunId: string; snapshot: CalcRunSnapshot }> {
  return requestJson('/api/fiscal/calculate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function compareFiscalRegimes(payload: {
  input: CompareRegimesInput;
  sessionId?: string;
  context?: Partial<OperationContext>;
  forceLocal?: boolean;
}): Promise<{ calcRunId: string; snapshot: CalcRunSnapshot }> {
  return requestJson('/api/fiscal/compare', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function calculateBaseUnificada(payload: {
  modelo?: 'nfe' | 'nfse';
  input: unknown;
  sessionId?: string;
  context?: Partial<OperationContext>;
  forceLocal?: boolean;
}): Promise<{
  calcRunId: string;
  snapshot: CalcRunSnapshot;
  output: BaseCalculoUnificadaOutput | BaseCalculoUnificadaNfseOutput;
}> {
  return requestJson('/api/fiscal/base-unificada', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function calculateFatorR(
  payload: FatorRAuxiliarInput,
): Promise<{ output: FatorRAuxiliarOutput }> {
  return requestJson('/api/fiscal/fator-r', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ============================================================================
// XML, DANFSe & Export Endpoints
// ============================================================================

export function generateAndValidateXml(payload: {
  calcRunId?: string;
  snapshot?: CalcRunSnapshot;
  tipo?: 'nfe' | 'nfce';
  forceLocal?: boolean;
}): Promise<{ generation: XmlGenerationResult; validation: XmlValidationResult | null }> {
  return requestJson('/api/export/xml', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function downloadDanfsePdf(payload: {
  xml: string;
  stc?: 0 | 1 | 2;
  canhoto?: boolean;
  forceLocal?: boolean;
}): Promise<{ blob: Blob; engineMode: string; isLocalPreview: boolean }> {
  const res = await fetch('/api/export/danfse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/pdf, application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  const blob = await res.blob();
  const engineMode = res.headers.get('X-Danfse-Engine-Mode') ?? 'local-ts';
  const isLocalPreview = res.headers.get('X-Danfse-Local-Preview') === 'true';
  return { blob, engineMode, isLocalPreview };
}

export function getExportXlsxUrl(calcRunId: string): string {
  return `/api/export/xlsx/${encodeURIComponent(calcRunId)}`;
}

export function getExportJsonUrl(calcRunId: string): string {
  return `/api/export/json/${encodeURIComponent(calcRunId)}`;
}

// ============================================================================
// Dados Abertos Lookup Endpoints
// ============================================================================

export async function searchNcm(q: string, data?: string): Promise<NcmLookupItem[]> {
  const params = new URLSearchParams({ q });
  if (data) params.set('data', data);
  const res = await requestJson<{ items: NcmLookupItem[] }>(
    `/api/dados-abertos/ncm?${params.toString()}`,
  );
  return res.items;
}

export async function searchNbs(q: string, data?: string): Promise<NbsLookupItem[]> {
  const params = new URLSearchParams({ q });
  if (data) params.set('data', data);
  const res = await requestJson<{ items: NbsLookupItem[] }>(
    `/api/dados-abertos/nbs?${params.toString()}`,
  );
  return res.items;
}

export async function searchClassTrib(
  q: string,
  cst?: string,
  data?: string,
): Promise<ClassTribLookupItem[]> {
  const params = new URLSearchParams({ q });
  if (cst) params.set('cst', cst);
  if (data) params.set('data', data);
  const res = await requestJson<{ items: ClassTribLookupItem[] }>(
    `/api/dados-abertos/classtrib?${params.toString()}`,
  );
  return res.items;
}

export async function listUfs(): Promise<UfLookupItem[]> {
  const res = await requestJson<{ items: UfLookupItem[] }>('/api/dados-abertos/uf');
  return res.items;
}

export async function listMunicipios(uf: string): Promise<MunicipioLookupItem[]> {
  const params = new URLSearchParams();
  if (uf.trim()) {
    params.set(/^\d+$/.test(uf.trim()) ? 'ufCd' : 'uf', uf.trim());
  }
  const query = params.toString();
  const res = await requestJson<{ items: MunicipioLookupItem[] }>(
    `/api/dados-abertos/municipios${query ? `?${query}` : ''}`,
  );
  return res.items;
}

export async function listAtividadesSimples(
  data?: string,
  opts?: { anexo?: string; cClassTrib?: string; tipoDocumento?: number },
): Promise<AtividadeSimplesLookupItem[]> {
  const params = new URLSearchParams();
  if (data) params.set('data', data);
  if (opts?.anexo) params.set('anexo', opts.anexo);
  if (opts?.cClassTrib) params.set('cClassTrib', opts.cClassTrib);
  if (opts?.tipoDocumento !== undefined) {
    params.set('tipoDocumento', String(opts.tipoDocumento));
  }
  const query = params.toString();
  const res = await requestJson<{ items: AtividadeSimplesLookupItem[] }>(
    `/api/dados-abertos/atividades-simples${query ? `?${query}` : ''}`,
  );
  return res.items;
}

export async function lookupErros(
  code?: string,
  categoria?: string,
): Promise<ErrorLookupResponse> {
  const params = new URLSearchParams();
  if (code) params.set('code', code);
  if (categoria) params.set('categoria', categoria);
  const query = params.toString();
  return requestJson<ErrorLookupResponse>(
    `/api/dados-abertos/erros${query ? `?${query}` : ''}`,
  );
}

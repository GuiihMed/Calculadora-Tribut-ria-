import { useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Loader2, PanelLeftOpen, Sparkles, Wrench } from 'lucide-react';
import type {
  CalcRunSnapshot,
  ExtractionDraft,
  OperationContext,
  WorkspaceMessageRecord,
} from '../../shared/types/fiscal';
import {
  ApiError,
  calculateFiscal,
  compareFiscalRegimes,
  streamChatTurn,
  uploadFiles,
} from '../api/client';
import {
  DEFAULT_QUICK_PROMPTS,
  FileDropComposer,
  type StagedAttachment,
} from './FileDropComposer';
import {
  type ChatMessageItem,
  MessageBubble,
  type RemoteEngineErrorInfo,
  type ToolActivityBadge,
  type WorkbenchTabId,
} from './MessageBubble';

export interface ChatPaneProps {
  sessionId: string | null;
  activeContext: Partial<OperationContext>;
  messages: WorkspaceMessageRecord[];
  snapshotsById?: Record<string, CalcRunSnapshot>;
  draftsById?: Record<string, ExtractionDraft>;
  activeDraft?: ExtractionDraft | null;
  statusMessage?: string | null;
  onMessagesChange?: (messages: ChatMessageItem[]) => void;
  onSessionResolved?: (sessionId: string) => void;
  onSnapshotCreated?: (snapshot: CalcRunSnapshot) => void;
  onDraftReady?: (draft: ExtractionDraft) => void;
  onSelectSnapshot?: (snapshot: CalcRunSnapshot) => void;
  onSelectDraft?: (draft: ExtractionDraft) => void;
  onNavigateWorkbench?: (tab: WorkbenchTabId) => void;
  onRetryForceLocal?: (error: RemoteEngineErrorInfo, originalPrompt?: string) => void;
  showOpenHistoryButton?: boolean;
  onOpenHistory?: () => void;
}

interface UploadedBatch {
  attachmentIds: string[];
  summary: string;
}

function createLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toRemoteEngineError(err: unknown): RemoteEngineErrorInfo | null {
  if (err instanceof ApiError && (err.canForceLocal || err.code === 'REMOTE_ENGINE_UNAVAILABLE')) {
    return {
      code: err.code,
      capability: err.capability,
      endpoint: err.endpoint,
      message: err.message,
      canForceLocal: true,
    };
  }
  if (
    err instanceof Error &&
    (err.message.includes('REMOTE_ENGINE_UNAVAILABLE') ||
      err.message.includes('forceLocal'))
  ) {
    return {
      code: 'REMOTE_ENGINE_UNAVAILABLE',
      message: err.message,
      canForceLocal: true,
    };
  }
  return null;
}

export function ChatPane({
  sessionId,
  activeContext,
  messages,
  snapshotsById = {},
  draftsById = {},
  activeDraft = null,
  statusMessage = null,
  onMessagesChange,
  onSessionResolved,
  onSnapshotCreated,
  onDraftReady,
  onSelectSnapshot,
  onSelectDraft,
  onNavigateWorkbench,
  onRetryForceLocal,
  showOpenHistoryButton = false,
  onOpenHistory,
}: ChatPaneProps) {
  const [internalMessages, setInternalMessages] = useState<ChatMessageItem[]>(messages);
  const [localSnapshotsById, setLocalSnapshotsById] = useState<Record<string, CalcRunSnapshot>>({});
  const [localDraftsById, setLocalDraftsById] = useState<Record<string, ExtractionDraft>>({});
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [uploadedBatches, setUploadedBatches] = useState<UploadedBatch[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTools, setActiveTools] = useState<ToolActivityBadge[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string | undefined>(undefined);

  const messagesRef = useRef<ChatMessageItem[]>(messages);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamRunIdRef = useRef(0);
  const uploadRunIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
    setInternalMessages(messages);
  }, [messages]);

  useEffect(() => {
    streamRunIdRef.current += 1;
    uploadRunIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    setAttachments([]);
    setUploadedBatches([]);
    setChatError(null);
    setLastPrompt(undefined);
    setActiveTools([]);
    setIsStreaming(false);
    setIsUploading(false);
    setLocalSnapshotsById({});
    setLocalDraftsById({});
  }, [sessionId]);

  const commitMessages = (
    updater: (prev: ChatMessageItem[]) => ChatMessageItem[],
  ) => {
    const next = updater(messagesRef.current);
    messagesRef.current = next;
    setInternalMessages(next);
    onMessagesChange?.(next);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [internalMessages.length, activeTools.length]);

  const handleFilesSelected = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    const uploadRunId = ++uploadRunIdRef.current;
    setChatError(null);
    setIsUploading(true);

    const newAttachments: StagedAttachment[] = files.map((file) => ({
      id: createLocalId('att'),
      name: file.name,
      sizeBytes: file.size,
      status: 'uploading',
    }));
    const batchIds = newAttachments.map((a) => a.id);

    setAttachments((prev) => [...prev, ...newAttachments]);

    try {
      const res = await uploadFiles(files, sessionId ?? undefined);
      if (uploadRunIdRef.current !== uploadRunId) {
        return;
      }

      const returnedDrafts = res.drafts ?? [];

      setAttachments((prev) =>
        prev.map((att) => {
          const idx = batchIds.indexOf(att.id);
          if (idx === -1) return att;
          return {
            ...att,
            status: 'uploaded',
            draftId: returnedDrafts[idx]?.id ?? returnedDrafts[0]?.id,
          };
        }),
      );

      if (res.attachmentSummary) {
        setUploadedBatches((prev) => [
          ...prev,
          { attachmentIds: batchIds, summary: res.attachmentSummary },
        ]);
      }

      if (returnedDrafts.length > 0) {
        const draftMap: Record<string, ExtractionDraft> = {};
        for (const d of returnedDrafts) {
          draftMap[d.id] = d;
          onDraftReady?.(d);
        }
        setLocalDraftsById((prev) => ({ ...prev, ...draftMap }));

        if (returnedDrafts.some((d) => d.requiresReview)) {
          onNavigateWorkbench?.('staging');
        }
      }
    } catch (err) {
      if (uploadRunIdRef.current !== uploadRunId) {
        return;
      }
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Não foi possível enviar os arquivos para análise.';
      setChatError(msg);
      setAttachments((prev) =>
        prev.map((att) =>
          batchIds.includes(att.id)
            ? { ...att, status: 'error', error: msg }
            : att,
        ),
      );
    } finally {
      if (uploadRunIdRef.current === uploadRunId) {
        setIsUploading(false);
      }
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
    setUploadedBatches((prev) =>
      prev
        .map((batch) => ({
          ...batch,
          attachmentIds: batch.attachmentIds.filter((attId) => attId !== id),
        }))
        .filter((batch) => batch.attachmentIds.length > 0),
    );
  };

  const handleSendMessage = async (rawMessage: string) => {
    const trimmed = rawMessage.trim();
    if (!trimmed || isStreaming) {
      return;
    }

    const runId = ++streamRunIdRef.current;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setChatError(null);
    setLastPrompt(trimmed);
    setIsStreaming(true);
    setActiveTools([]);

    const attachmentNames = attachments.map((a) => a.name);
    const combinedSummary = uploadedBatches
      .map((b) => b.summary)
      .filter((s) => s.trim().length > 0)
      .join('\n\n');

    setAttachments([]);
    setUploadedBatches([]);

    const nowIso = new Date().toISOString();
    const userMsg: ChatMessageItem = {
      id: createLocalId('user'),
      sessionId: sessionId ?? 'pending',
      role: 'user',
      content: trimmed,
      attachmentNames: attachmentNames.length > 0 ? attachmentNames : undefined,
      createdAt: nowIso,
    };

    const assistantTempId = createLocalId('assistant');
    const assistantMsg: ChatMessageItem = {
      id: assistantTempId,
      sessionId: sessionId ?? 'pending',
      role: 'assistant',
      content: '',
      toolActivities: [],
      isStreaming: true,
      createdAt: nowIso,
    };

    commitMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      const result = await streamChatTurn(
        {
          sessionId: sessionId ?? undefined,
          message: trimmed,
          attachmentSummary: combinedSummary || undefined,
          activeContext,
          stream: true,
          signal: abortController.signal,
        },
        (ev) => {
          if (streamRunIdRef.current !== runId) {
            return;
          }

          if (ev.type === 'text_delta') {
            commitMessages((prev) =>
              prev.map((m) =>
                m.id === assistantTempId
                  ? { ...m, content: `${m.content}${ev.delta}` }
                  : m,
              ),
            );
            return;
          }

          if (ev.type === 'tool_start') {
            const badge: ToolActivityBadge = {
              callId: ev.callId,
              toolName: ev.toolName,
              status: 'running',
            };
            setActiveTools((prev) => [...prev, badge]);
            commitMessages((prev) =>
              prev.map((m) =>
                m.id === assistantTempId
                  ? {
                      ...m,
                      toolActivities: [...(m.toolActivities ?? []), badge],
                    }
                  : m,
              ),
            );
            return;
          }

          if (ev.type === 'tool_done') {
            setActiveTools((prev) =>
              prev.map((t) =>
                t.callId === ev.callId
                  ? {
                      ...t,
                      status: 'done',
                      resultSummary: ev.resultSummary,
                      calcRunId: ev.calcRunId,
                    }
                  : t,
              ),
            );
            commitMessages((prev) =>
              prev.map((m) =>
                m.id === assistantTempId
                  ? {
                      ...m,
                      calcRunId: ev.calcRunId ?? m.calcRunId,
                      toolActivities: (m.toolActivities ?? []).map((t) =>
                        t.callId === ev.callId
                          ? {
                              ...t,
                              status: 'done',
                              resultSummary: ev.resultSummary,
                              calcRunId: ev.calcRunId,
                            }
                          : t,
                      ),
                    }
                  : m,
              ),
            );
            return;
          }

          if (ev.type === 'calc_run') {
            setLocalSnapshotsById((prev) => ({
              ...prev,
              [ev.snapshot.id]: ev.snapshot,
            }));
            onSnapshotCreated?.(ev.snapshot);
            commitMessages((prev) =>
              prev.map((m) =>
                m.id === assistantTempId
                  ? {
                      ...m,
                      calcRunId: ev.snapshot.id,
                      snapshot: ev.snapshot,
                    }
                  : m,
              ),
            );
            return;
          }

          if (ev.type === 'draft_ready') {
            setLocalDraftsById((prev) => ({
              ...prev,
              [ev.draft.id]: ev.draft,
            }));
            onDraftReady?.(ev.draft);
            commitMessages((prev) =>
              prev.map((m) =>
                m.id === assistantTempId
                  ? {
                      ...m,
                      draftId: ev.draft.id,
                      draft: ev.draft,
                    }
                  : m,
              ),
            );
            return;
          }

          if (ev.type === 'done') {
            commitMessages((prev) =>
              prev.map((m) =>
                m.id === assistantTempId
                  ? {
                      ...m,
                      id: ev.messageId || m.id,
                      calcRunId: ev.calcRunId ?? m.calcRunId,
                      groundingWarning: ev.groundingWarning,
                      isStreaming: false,
                    }
                  : m,
              ),
            );
          }
        },
      );

      if (streamRunIdRef.current !== runId) {
        return;
      }

      if (result.sessionId && result.sessionId !== sessionId) {
        onSessionResolved?.(result.sessionId);
      }

      commitMessages((prev) =>
        prev.map((m) =>
          m.id === assistantTempId ? { ...m, isStreaming: false } : m,
        ),
      );
    } catch (err) {
      if (
        streamRunIdRef.current !== runId ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        return;
      }

      const remoteErr = toRemoteEngineError(err);
      const errMessage =
        err instanceof Error
          ? err.message
          : 'Erro inesperado ao se comunicar com o Copiloto Gemini.';

      if (remoteErr) {
        commitMessages((prev) =>
          prev.map((m) =>
            m.id === assistantTempId
              ? {
                  ...m,
                  isStreaming: false,
                  content:
                    m.content ||
                    'O cálculo determinístico não pôde ser concluído no motor oficial remoto configurado.',
                  remoteEngineError: remoteErr,
                }
              : m,
          ),
        );
      } else {
        setChatError(errMessage);
        commitMessages((prev) =>
          prev.map((m) =>
            m.id === assistantTempId
              ? {
                  ...m,
                  isStreaming: false,
                  content: m.content || `Falha no turno: ${errMessage}`,
                }
              : m,
          ),
        );
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      if (streamRunIdRef.current === runId) {
        setIsStreaming(false);
        setActiveTools([]);
      }
    }
  };

  const handleDefaultForceLocal = async (
    err: RemoteEngineErrorInfo,
    promptForRetry?: string,
  ) => {
    if (onRetryForceLocal) {
      onRetryForceLocal(err, promptForRetry);
      return;
    }

    if (activeDraft && activeDraft.itens.length > 0) {
      const regime = activeContext.regime ?? 'regime-regular';
      const validItems =
        regime === 'simples-nacional'
          ? activeDraft.itens.filter((it) => Boolean(it.cClassTrib))
          : activeDraft.itens.filter((it) => Boolean(it.cst && it.cClassTrib));

      if (validItems.length > 0) {
        try {
          setChatError(null);
          const res =
            regime === 'comparativo'
              ? await compareFiscalRegimes({
                  sessionId: sessionId ?? undefined,
                  context: activeContext,
                  forceLocal: true,
                  input: {
                    dhFatoGerador: activeContext.dhFatoGerador ?? '2027-01-01',
                    tpDoc: Number(
                      activeContext.tipoDfe === '65'
                        ? 65
                        : activeContext.tipoDfe === 'NFSE'
                          ? 99
                          : 55,
                    ),
                    uf: activeContext.uf ?? 'RS',
                    municipio: activeContext.municipio,
                    tpEnteGov: activeContext.tpEnteGov,
                    itens: validItems.map((it) => ({
                      nObj: it.nObj,
                      descricao: it.descricao,
                      ncm: it.ncm,
                      nbs: it.nbs,
                      cst: it.cst!,
                      cClassTrib: it.cClassTrib!,
                      cAtivSN: it.cAtivSN ?? '11',
                      baseCalculo: it.baseCalculo ?? '0.00',
                      aliquotasNominais: it.aliquotasNominais ?? {},
                      pIBSSN: it.pIBSSN ?? null,
                      pCBSSN: it.pCBSSN ?? null,
                    })),
                  },
                })
              : await calculateFiscal({
                  regime:
                    regime === 'simples-nacional' ? 'simples-nacional' : 'regime-regular',
                  sessionId: sessionId ?? undefined,
                  context: activeContext,
                  forceLocal: true,
                  input:
                    regime === 'simples-nacional'
                      ? {
                          dhFatoGerador: activeContext.dhFatoGerador ?? '2027-01-01',
                          tpDoc: Number(
                            activeContext.tipoDfe === '65'
                              ? 65
                              : activeContext.tipoDfe === 'NFSE'
                                ? 99
                                : 55,
                          ),
                          CRT: activeContext.crt ?? 1,
                          tpRegimeIBSCBS: activeContext.tpRegimeIBSCBS ?? 2,
                          tpEnteGov: activeContext.tpEnteGov,
                          itens: validItems.map((it) => ({
                            nObj: it.nObj,
                            descricao: it.descricao,
                            cAtivSN: it.cAtivSN ?? '11',
                            cClassTrib: it.cClassTrib!,
                            ...(it.cst ? { cst: it.cst } : {}),
                            baseCalculo: it.baseCalculo ?? '0.00',
                            pIBSSN: it.pIBSSN ?? null,
                            pCBSSN: it.pCBSSN ?? null,
                          })),
                        }
                      : {
                          dhFatoGerador: activeContext.dhFatoGerador ?? '2026-07-01',
                          uf: activeContext.uf ?? 'RS',
                          municipio: activeContext.municipio,
                          tipoDfe: activeContext.tipoDfe ?? '55',
                          itens: validItems.map((it) => ({
                            nObj: it.nObj,
                            descricao: it.descricao,
                            ncm: it.ncm,
                            nbs: it.nbs,
                            cst: it.cst!,
                            cClassTrib: it.cClassTrib!,
                            baseCalculo: it.baseCalculo ?? '0.00',
                            aliquotasNominais: it.aliquotasNominais,
                          })),
                        },
                });

          setLocalSnapshotsById((prev) => ({
            ...prev,
            [res.snapshot.id]: res.snapshot,
          }));
          onSnapshotCreated?.(res.snapshot);

          commitMessages((prev) => [
            ...prev,
            {
              id: createLocalId('assistant'),
              sessionId: sessionId ?? 'pending',
              role: 'assistant',
              content: `Cálculo reprocessado com sucesso no **Motor Local TS** (${err.capability ?? 'fiscal'}).`,
              calcRunId: res.calcRunId,
              snapshot: res.snapshot,
              createdAt: new Date().toISOString(),
            },
          ]);
          return;
        } catch (retryErr) {
          setChatError(
            retryErr instanceof Error
              ? retryErr.message
              : 'Falha ao reprocessar no Motor Local TS.',
          );
          return;
        }
      }
    }

    if (promptForRetry) {
      await handleSendMessage(
        `${promptForRetry} (confirmado uso manual do Motor Local TS)`,
      );
    }
  };

  const mergedSnapshots: Record<string, CalcRunSnapshot> = {
    ...snapshotsById,
    ...localSnapshotsById,
  };
  const mergedDrafts: Record<string, ExtractionDraft> = {
    ...draftsById,
    ...localDraftsById,
  };

  return (
    <>
      <div className="pane-header">
        <div className="pane-header__brand" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
          {showOpenHistoryButton && onOpenHistory && (
            <button
              type="button"
              className="history-sidebar__close"
              aria-label="Abrir histórico"
              aria-expanded={false}
              title="Abrir histórico"
              onClick={onOpenHistory}
            >
              <PanelLeftOpen size={16} aria-hidden="true" />
            </button>
          )}
          <h2 className="pane-header__title">
            <Bot
              size={16}
              aria-hidden="true"
              style={{ verticalAlign: 'text-bottom', marginInlineEnd: '0.375rem' }}
            />
            Copiloto Fiscal Gemini &bull; Zero Alucinação
          </h2>
        </div>
      </div>

      <div ref={scrollRef} className="pane-scroll" aria-live="polite">
        {statusMessage && (
          <div className="banner banner--danger" role="alert">
            <span>{statusMessage}</span>
          </div>
        )}

        {chatError && (
          <div className="banner banner--danger" role="alert">
            <span>{chatError}</span>
          </div>
        )}

        {activeTools.length > 0 && (
          <div className="tool-activity-bar" aria-label="Execução de ferramentas em andamento">
            {activeTools.map((tool) => (
              <span
                key={tool.callId}
                className={`badge ${tool.status === 'running' ? 'badge--info' : 'badge--success'}`}
              >
                {tool.status === 'running' ? (
                  <Loader2 size={12} className="spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={12} aria-hidden="true" />
                )}
                <Wrench size={11} aria-hidden="true" />
                <span>
                  {tool.toolName}
                  {tool.resultSummary ? `: ${tool.resultSummary}` : ' (executando...)'}
                </span>
              </span>
            ))}
          </div>
        )}

        <div className="stack">
          {internalMessages.length === 0 ? (
            <div className="chat-welcome">
              <div className="chat-welcome__icon" aria-hidden="true">
                <Sparkles size={20} />
              </div>
              <h3 className="chat-welcome__title">
                O que você gostaria de analisar hoje?
              </h3>
              <p className="chat-welcome__desc">
                Envie um documento (<code>.xlsx</code>, <code>.csv</code>, <code>.xml</code>,{' '}
                <code>.pdf</code> ou imagem) ou escolha um cenário abaixo.
              </p>
              <div className="chat-welcome__prompts" aria-label="Sugestões iniciais">
                {DEFAULT_QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="chat-welcome__prompt-btn"
                    disabled={isStreaming || isUploading}
                    onClick={() => {
                      void handleSendMessage(prompt);
                    }}
                  >
                    <Sparkles size={13} aria-hidden="true" />
                    <span>{prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            internalMessages.map((msg) => {
              const snap =
                msg.snapshot ??
                (msg.calcRunId ? mergedSnapshots[msg.calcRunId] : undefined) ??
                null;
              const dr =
                msg.draft ??
                (msg.draftId ? mergedDrafts[msg.draftId] : undefined) ??
                null;
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  snapshot={snap}
                  draft={dr}
                  onNavigateTab={onNavigateWorkbench}
                  onSelectSnapshot={onSelectSnapshot}
                  onSelectDraft={onSelectDraft}
                  onRetryForceLocal={(err) => {
                    void handleDefaultForceLocal(err, lastPrompt);
                  }}
                />
              );
            })
          )}
        </div>
      </div>

      <div className="pane-footer">
        <FileDropComposer
          attachments={attachments}
          isUploading={isUploading}
          isStreaming={isStreaming}
          onFilesSelected={handleFilesSelected}
          onRemoveAttachment={handleRemoveAttachment}
          onSend={handleSendMessage}
        />
      </div>
    </>
  );
}
